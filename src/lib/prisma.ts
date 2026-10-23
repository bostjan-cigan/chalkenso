import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';
import { currentOrgScope, withoutOrgScope } from './org-context';

/**
 * Single PrismaClient per process (or serverless function).
 * Always attach to `globalThis` so warm invocations reuse one client + DB pool slot.
 *
 * Behind a pooler: put the **pooled** URL on `DATABASE_URL`; `DATABASE_URL_UNPOOLED` carries the
 * direct (non-pooled) URL that migrations and introspection need — see prisma/schema.prisma.
 */
const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: ReturnType<typeof createPrismaClient>;
};

/**
 * A pooled endpoint is PgBouncer in transaction mode: Prisma has to give up prepared statements
 * (`pgbouncer=true`). A serverless Postgres may also scale to zero after a few idle minutes, so the
 * first query after a quiet spell waits on the compute waking up — more than the 5s
 * `connect_timeout` default allows.
 *
 * Each isolate keeps several connections to the pooler, never one: any query made outside a running
 * transaction (a helper that uses `prisma` instead of the transaction) would otherwise wait for the
 * one connection the transaction holds until it expires ("Transaction already closed"). And one
 * instance may serve many requests at once, so a few long transactions (publishing a version)
 * mustn't leave the rest waiting for a connection ("Timed out fetching a new connection").
 * Connections to the pooler are cheap; it queues them onto its own small set of Postgres ones.
 */
const POOLED_PARAMS: Record<string, string> = {
  pgbouncer: 'true',
  connection_limit: '10',
  connect_timeout: '15',
};

/** Fewer connections than this deadlock every transaction that writes scoped data (see above). */
const MIN_CONNECTION_LIMIT = 2;

/** Hosted Postgres providers commonly expose the pooler as a `-pooler` host; an explicit flag counts too. */
function isPooled(url: URL): boolean {
  return url.hostname.includes('-pooler') || url.searchParams.get('pgbouncer') === 'true';
}

/**
 * Fills in the PgBouncer-safe params a pooled URL needs, leaving anything already spelled out in
 * the env var alone, except a `connection_limit` too small to run a transaction (on any URL).
 * Otherwise non-pooled URLs (local docker, the direct endpoint) pass through untouched.
 */
export function normalizeDatabaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw; // Let Prisma report a malformed URL with its own error.
  }

  let changed = false;
  if (isPooled(url)) {
    for (const [key, value] of Object.entries(POOLED_PARAMS)) {
      if (url.searchParams.has(key)) continue;
      url.searchParams.set(key, value);
      changed = true;
    }
  }

  const limit = url.searchParams.has('connection_limit') ? Number(url.searchParams.get('connection_limit')) : NaN;
  if (Number.isFinite(limit) && limit < MIN_CONNECTION_LIMIT) {
    console.warn(
      `[prisma] connection_limit=${url.searchParams.get('connection_limit')} in DATABASE_URL would time out ` +
        `transactions; using ${POOLED_PARAMS.connection_limit}. Remove it from the URL to silence this.`
    );
    url.searchParams.set('connection_limit', POOLED_PARAMS.connection_limit);
    changed = true;
  }

  return changed ? url.toString() : raw;
}

/**
 * Cheap cold-start check: a direct URL in production means every isolate opens its own Postgres
 * connection, which is what exhausts a small instance long before traffic does.
 */
function warnIfUnpooled(raw: string): void {
  if (process.env.NODE_ENV !== 'production') return;
  try {
    if (isPooled(new URL(raw))) return;
  } catch {
    return;
  }
  console.warn(
    '[prisma] DATABASE_URL does not look pooled — set it to the pooler endpoint and keep the ' +
      'direct URL on DATABASE_URL_UNPOOLED for migrations.',
  );
}

/** One line in production logs with what the pool actually uses (no host, no credentials). */
function logPoolSettings(datasourceUrl: string): void {
  if (process.env.NODE_ENV !== 'production') return;
  try {
    const url = new URL(datasourceUrl);
    console.info(
      `[prisma] ${isPooled(url) ? 'pooled' : 'direct'} database URL, ` +
        `connection_limit=${url.searchParams.get('connection_limit') ?? 'Prisma default'}`
    );
  } catch {
    // A malformed URL is reported by Prisma itself.
  }
}

/**
 * Interactive transactions get 15s instead of Prisma's 5s, and may wait 10s for a connection: the
 * functions and the database can be an ocean apart (~90ms a query), and a scale-to-zero database
 * wakes up slowly.
 */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

function createPrismaClient() {
  const rawUrl = process.env.DATABASE_URL;
  if (rawUrl) warnIfUnpooled(rawUrl);
  const datasourceUrl = rawUrl ? normalizeDatabaseUrl(rawUrl) : undefined;
  if (datasourceUrl) logPoolSettings(datasourceUrl);

  return withTransactionContext(
    withChangeTrail(
      scopedClient(
        new PrismaClient({
          ...(datasourceUrl ? { datasourceUrl } : {}),
          transactionOptions: TRANSACTION_OPTIONS,
          log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
        })
      )
    )
  );
}

/**
 * The interactive transaction the current code runs in, and the organisation it works for. The
 * organisation layer below must never query outside an open transaction: with one connection per
 * isolate that query waits for the connection the transaction holds, until the transaction
 * expires. So the organisation is resolved before the transaction opens, and the ownership checks
 * on writes run inside it.
 */
type OpenTransaction = {
  client: PrismaClient;
  organizationId: string | null;
  /** Work that only counts once the transaction commits (the "log in as" change trail). */
  afterCommit: Array<() => Promise<void>>;
};

// One store for the process, like the organisation scope in org-context.ts.
const globalForTransaction = globalThis as typeof globalThis & {
  openTransaction?: AsyncLocalStorage<OpenTransaction>;
};
const openTransaction = (globalForTransaction.openTransaction ??= new AsyncLocalStorage<OpenTransaction>());

/** Wraps `$transaction(async (tx) => …)` so the callback runs with its transaction in `openTransaction`. */
function withTransactionContext<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== '$transaction' || typeof value !== 'function') {
        return value;
      }
      return async (input: unknown, options?: unknown) => {
        if (typeof input !== 'function') {
          return value.call(target, input, options); // a batch of queries: one statement, nothing to track
        }
        const organizationId = await requestOrganizationId();
        const afterCommit: OpenTransaction['afterCommit'] = [];
        const result = await value.call(
          target,
          (transaction: PrismaClient) =>
            openTransaction.run({ client: transaction, organizationId, afterCommit }, () => input(transaction)),
          options
        );
        for (const work of afterCommit) await work();
        return result;
      };
    },
  });
}

/**
 * Organisation scoping. Every model below belongs to one organisation, reached through the path
 * on the right; queries on them get that filter added whenever the request has an organisation
 * (a signed-in session, or an API token via `setRequestOrganization`). Requests without one
 * (learner links, public pages) are not scoped: they reach data through their own tokens.
 */
const SCOPES: Record<string, (organizationId: string) => Record<string, unknown>> = {
  Course: (organizationId) => ({ organizationId }),
  Partner: (organizationId) => ({ organizationId }),
  CurriculumVersion: (organizationId) => ({ course: { organizationId } }),
  Lesson: (organizationId) => ({ course: { organizationId } }),
  LessonArc: (organizationId) => ({ curriculumVersion: { course: { organizationId } } }),
  CourseGroup: (organizationId) => ({ course: { organizationId } }),
  CourseGroupMember: (organizationId) => ({ group: { course: { organizationId } } }),
  CourseGroupInstructor: (organizationId) => ({ group: { course: { organizationId } } }),
  CurriculumComment: (organizationId) => ({ curriculumVersion: { course: { organizationId } } }),
  LessonAssetReference: (organizationId) => ({ lesson: { course: { organizationId } } }),
  Task: (organizationId) => ({ organizationId }),
  TaskComment: (organizationId) => ({ task: { organizationId } }),
  TaskEntityLink: (organizationId) => ({ task: { organizationId } }),
  ApiToken: (organizationId) => ({ organizationId }),
  LessonPublication: (organizationId) => ({ lesson: { course: { organizationId } } }),
  LessonChange: (organizationId) => ({ lesson: { course: { organizationId } } }),
  LessonPulse: (organizationId) => ({ lesson: { course: { organizationId } } }),
  LessonCheck: (organizationId) => ({ lesson: { course: { organizationId } } }),
  LessonReadingSession: (organizationId) => ({ lesson: { course: { organizationId } } }),
  CourseSurveyResponse: (organizationId) => ({ group: { course: { organizationId } } }),
  LessonTaught: (organizationId) => ({ group: { course: { organizationId } } }),
  FeedbackSettingChange: (organizationId) => ({ organizationId }),
  AnswerRemoval: (organizationId) => ({ organizationId }),
  TermReport: (organizationId) => ({ organizationId }),
  AiUsage: (organizationId) => ({ organizationId }),
  AiTopUp: (organizationId) => ({ organizationId }),
  AiProposal: (organizationId) => ({ organizationId }),
  PlanChange: (organizationId) => ({ organizationId }),
  LeavingNotice: (organizationId) => ({ organizationId }),
  ConnectorConnection: (organizationId) => ({ organizationId }),
  ConnectorCall: (organizationId) => ({ organizationId }),
  // A safety net only: access code filters grants by organisation explicitly everywhere.
  UserGrant: (organizationId) => ({ organizationId }),
};

const FILTERED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

/** The organisation of the current request, or null when it is not scoped. */
async function requestOrganizationId(): Promise<string | null> {
  const scope = currentOrgScope();
  if (scope) {
    return scope.bypass ? null : scope.organizationId;
  }
  const open = openTransaction.getStore();
  if (open) {
    return open.organizationId;
  }
  try {
    // Lazy import: admin-auth itself queries through this client (on unscoped models only).
    const { getCurrentUserSession } = await import('./admin-auth');
    const session = await getCurrentUserSession();
    if (session) {
      return session.user.organization?.id ?? null;
    }
    return await bearerTokenOrganizationId();
  } catch {
    // Outside a request (build time, scripts): nothing to scope by.
    return null;
  }
}

const tokenOrganizationCache = new Map<string, { organizationId: string | null; until: number }>();

/** Requests from the Obsidian plugin carry an API token: they work in the token's organisation. */
async function bearerTokenOrganizationId(): Promise<string | null> {
  const { headers } = await import('next/headers');
  const authorization = (await headers()).get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const { hashApiToken } = await import('./security');
  const tokenHash = hashApiToken(match[1].trim());
  const cached = tokenOrganizationCache.get(tokenHash);
  if (cached && cached.until > Date.now()) {
    return cached.organizationId;
  }
  // Static import on purpose: a dynamically imported copy of org-context has its own storage, so
  // the bypass wouldn't be seen and this lookup would scope itself, recursing forever.
  let organizationId: string | null = null;
  if (match[1].trim().startsWith('mcp_')) {
    // A connector token (`/mcp` checks it fully on every request; this is only the backstop).
    const token = await withoutOrgScope(() =>
      prisma.oAuthToken.findUnique({
        where: { tokenHash },
        select: { revokedAt: true, expiresAt: true, connection: { select: { organizationId: true, revokedAt: true } } },
      })
    );
    organizationId =
      token && !token.revokedAt && token.expiresAt > new Date() && !token.connection.revokedAt ? token.connection.organizationId : null;
  } else {
    const token = await withoutOrgScope(() =>
      prisma.apiToken.findUnique({ where: { tokenHash }, select: { organizationId: true, revokedAt: true } })
    );
    organizationId = token && !token.revokedAt ? token.organizationId : null;
  }
  if (tokenOrganizationCache.size >= 10_000) {
    // Long-lived instances see many tokens: drop the expired ones before keeping another.
    const now = Date.now();
    tokenOrganizationCache.forEach((entry, key) => {
      if (entry.until <= now) tokenOrganizationCache.delete(key);
    });
  }
  tokenOrganizationCache.set(tokenHash, { organizationId, until: Date.now() + 60_000 });
  return organizationId;
}

function withScope(where: unknown, scope: Record<string, unknown>) {
  const base = (where ?? {}) as Record<string, unknown>;
  const existing = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  return { ...base, AND: [...existing, scope] };
}

/**
 * Foreign keys that point into an organisation's data. On writes (create, update, upsert) every
 * such id in the data must belong to the request's organisation, so a crafted id can't attach a
 * group, lesson, link, comment or partner to another organisation's course.
 */
type ReferenceCheck = {
  /** Which of these ids are inside the organisation. */
  owned: (client: PrismaClient, ids: string[], organizationId: string) => Promise<Array<{ id: string }>>;
  /** How many of these ids exist anywhere (committed). */
  exists: (client: PrismaClient, ids: string[]) => Promise<number>;
};

const OWNED_REFERENCES: Record<string, ReferenceCheck> = {
  courseId: {
    owned: (client, ids, organizationId) => client.course.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } }),
    exists: (client, ids) => client.course.count({ where: { id: { in: ids } } }),
  },
  curriculumVersionId: {
    owned: (client, ids, organizationId) =>
      client.curriculumVersion.findMany({ where: { id: { in: ids }, course: { organizationId } }, select: { id: true } }),
    exists: (client, ids) => client.curriculumVersion.count({ where: { id: { in: ids } } }),
  },
  baseVersionId: {
    owned: (client, ids, organizationId) =>
      client.curriculumVersion.findMany({ where: { id: { in: ids }, course: { organizationId } }, select: { id: true } }),
    exists: (client, ids) => client.curriculumVersion.count({ where: { id: { in: ids } } }),
  },
  groupId: {
    owned: (client, ids, organizationId) =>
      client.courseGroup.findMany({ where: { id: { in: ids }, course: { organizationId } }, select: { id: true } }),
    exists: (client, ids) => client.courseGroup.count({ where: { id: { in: ids } } }),
  },
  ownerGroupId: {
    owned: (client, ids, organizationId) =>
      client.courseGroup.findMany({ where: { id: { in: ids }, course: { organizationId } }, select: { id: true } }),
    exists: (client, ids) => client.courseGroup.count({ where: { id: { in: ids } } }),
  },
  lessonId: {
    owned: (client, ids, organizationId) => client.lesson.findMany({ where: { id: { in: ids }, course: { organizationId } }, select: { id: true } }),
    exists: (client, ids) => client.lesson.count({ where: { id: { in: ids } } }),
  },
  arcId: {
    owned: (client, ids, organizationId) =>
      client.lessonArc.findMany({ where: { id: { in: ids }, curriculumVersion: { course: { organizationId } } }, select: { id: true } }),
    exists: (client, ids) => client.lessonArc.count({ where: { id: { in: ids } } }),
  },
  memberId: {
    owned: (client, ids, organizationId) =>
      client.courseGroupMember.findMany({ where: { id: { in: ids }, group: { course: { organizationId } } }, select: { id: true } }),
    exists: (client, ids) => client.courseGroupMember.count({ where: { id: { in: ids } } }),
  },
  taskId: {
    owned: (client, ids, organizationId) => client.task.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } }),
    exists: (client, ids) => client.task.count({ where: { id: { in: ids } } }),
  },
  partnerId: {
    owned: (client, ids, organizationId) => client.partner.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } }),
    exists: (client, ids) => client.partner.count({ where: { id: { in: ids } } }),
  },
  joinPartnerId: {
    owned: (client, ids, organizationId) => client.partner.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } }),
    exists: (client, ids) => client.partner.count({ where: { id: { in: ids } } }),
  },
  accessLinkId: {
    owned: (client, ids, organizationId) =>
      client.accessLink.findMany({
        where: {
          id: { in: ids },
          OR: [{ group: { course: { organizationId } } }, { curriculumVersion: { course: { organizationId } } }],
        },
        select: { id: true },
      }),
    exists: (client, ids) => client.accessLink.count({ where: { id: { in: ids } } }),
  },
};

/** Models whose writes are checked against `OWNED_REFERENCES` (scoped and link models). */
const CHECKED_WRITE_MODELS = new Set([
  ...Object.keys(SCOPES),
  'AccessLink',
  'LessonNote',
  'GroupAssetUrlCache',
  'CoursePartner',
  'CourseGroupPartner',
]);

const WRITE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert']);

/** Every id the rows refer to, by field, each once. */
function referencedIds(payloads: unknown[]): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const payload of payloads) {
    for (const row of Array.isArray(payload) ? payload : [payload]) {
      if (!row || typeof row !== 'object') continue;
      for (const [field, value] of Object.entries(row as Record<string, unknown>)) {
        if (field in OWNED_REFERENCES && typeof value === 'string' && value) {
          const ids = found.get(field) ?? new Set<string>();
          ids.add(value);
          found.set(field, ids);
        }
      }
    }
  }
  return found;
}

/**
 * One query per referenced field, however many rows the write has: a bulk insert of a course's
 * lessons is checked with a query or two, not two per row (inside a transaction, ~90ms each).
 * Outside a transaction the fields are checked at once; inside one, one after another, as a
 * transaction runs its queries.
 */
async function assertOwnedReferences(
  client: PrismaClient,
  args: Record<string, unknown>,
  organizationId: string,
  inTransaction: boolean
) {
  const payloads = [args.data, args.create, args.update].filter((value) => value !== undefined);
  const check = async ([field, idSet]: [string, Set<string>]) => {
    const reference = OWNED_REFERENCES[field];
    const ids = Array.from(idSet);
    // Inside a transaction `client` is that transaction (it sees its own new rows); outside it, a
    // row that is not committed yet can't be referenced anyway. Either way only rows that exist
    // outside the organisation are refused. Unscoped: `exists` has to see every organisation.
    const foreign = await withoutOrgScope(async () => {
      const owned = new Set((await reference.owned(client, ids, organizationId)).map((row) => row.id));
      const others = ids.filter((id) => !owned.has(id));
      return others.length ? await reference.exists(client, others) : 0;
    });
    if (foreign > 0) {
      throw new Prisma.PrismaClientValidationError(`Cannot reference ${field} outside the organisation.`, {
        clientVersion: Prisma.prismaVersion.client,
      });
    }
  };
  const fields = Array.from(referencedIds(payloads));
  if (inTransaction) {
    for (const field of fields) await check(field);
  } else {
    await Promise.all(fields.map(check));
  }
}

function scopedClient(client: PrismaClient) {
  return client.$extends({
    name: 'organization-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scopeFor = model ? SCOPES[model] : undefined;
          const checksWrites = model ? CHECKED_WRITE_MODELS.has(model) : false;
          if (!scopeFor && !checksWrites) {
            return query(args);
          }
          const organizationId = await requestOrganizationId();
          if (!organizationId) {
            return query(args);
          }
          const input = (args ?? {}) as Record<string, unknown>;
          if (checksWrites && WRITE_OPERATIONS.has(operation)) {
            // In a transaction the checks run in it: a query outside would wait for its connection.
            const open = openTransaction.getStore();
            await assertOwnedReferences(open?.client ?? client, input, organizationId, Boolean(open));
          }
          if (!scopeFor) {
            return query(args);
          }
          const scope = scopeFor(organizationId);
          if (FILTERED_OPERATIONS.has(operation)) {
            return query({ ...input, where: withScope(input.where, scope) } as typeof args);
          }
          if ((operation === 'create' || operation === 'createMany') && 'organizationId' in scope) {
            const rows = Array.isArray(input.data) ? input.data : [input.data];
            for (const row of rows as Record<string, unknown>[]) {
              if (row && row.organizationId && row.organizationId !== organizationId) {
                throw new Prisma.PrismaClientValidationError('Cannot create a record in another organisation.', {
                  clientVersion: Prisma.prismaVersion.client,
                });
              }
            }
          }
          return query(args);
        },
      },
    },
  });
}

const TRAIL_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/**
 * Writes made while a platform admin is logged in as someone are recorded, after they succeed
 * (src/lib/impersonated-changes.ts). Loaded lazily: that module reads the session cookies through
 * admin-auth, which queries through this client.
 */
function withChangeTrail<T extends ReturnType<typeof scopedClient>>(client: T) {
  return client.$extends({
    name: 'impersonation-trail',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(args);
          if (model && TRAIL_OPERATIONS.has(operation)) {
            const note = async () => {
              try {
                const { noteWrite } = await import('./impersonated-changes');
                await noteWrite(model, operation, args, result);
              } catch {
                // Outside the app (scripts): there is no visit to record.
              }
            };
            // A write in a transaction is recorded once it commits: a rolled-back one never happened.
            const open = openTransaction.getStore();
            if (open) open.afterCommit.push(note);
            else await note();
          }
          return result;
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}

/**
 * Runs `work` once the transaction the caller is in has committed (never, if it rolls back), or at
 * once outside a transaction: for what may only follow writes that happened, like clearing a cache.
 */
export async function afterCommit(work: () => void | Promise<void>) {
  const open = openTransaction.getStore();
  if (open) {
    open.afterCommit.push(async () => {
      await work();
    });
  } else {
    await work();
  }
}

/**
 * A write made in raw SQL, for the "log in as" change log, which only sees Prisma's own writes:
 * `args` as a Prisma call would have them (the fields written in `data`, the rows in `where`), and
 * how many rows it changed. Recorded once the transaction commits, like every other write.
 */
export function noteRawWrite(model: string, operation: string, args: Record<string, unknown>, count: number) {
  return afterCommit(async () => {
    try {
      const { noteWrite } = await import('./impersonated-changes');
      await noteWrite(model, operation, args, { count });
    } catch {
      // Outside the app (scripts): there is no visit to record.
    }
  });
}

/** The client inside `prisma.$transaction(async (tx) => …)`. */
export type TransactionClient = Parameters<
  Extract<Parameters<typeof prisma.$transaction>[0], (...args: never[]) => unknown>
>[0];

/** Either the client or a transaction, for helpers that run in both. */
export type DbClient = TransactionClient | typeof prisma;
