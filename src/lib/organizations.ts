import 'server-only';

import { OrgPlan, OrgRole, Prisma } from '@prisma/client';
import { getLocale, getTranslations } from 'next-intl/server';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import { lockFor } from './advisory-locks';
import { isThrowawayEmail } from './email-domains';
import { passwordProblem } from './password-strength';
import { withoutOrgScope } from './org-context';
import { prisma, type DbClient, type TransactionClient } from './prisma';
import { createPublicAccessToken, hashPasswordAsync, hashSessionToken } from './security';
import { EDITION } from './site';
import { serverExtensions } from '@/extensions/server';
import { applyInviteAccess, inviteAccessData, type AccessInput } from './member-access';
import { HANDLE_MAX, HANDLE_MIN, handleUnavailableKey, normalizeHandle, suggestHandle } from './handles';

export const MIN_PASSWORD_LENGTH = 8;
export const INVITE_TTL_HOURS = 24 * 7;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 80;

export type AccountInput = {
  /** Their name; may be empty at sign-up (they add it in Profile later). */
  name: string;
  email: string;
  password: string;
  /** The person's handle (src/lib/handles.ts); suggested from their name (or email) when left out. */
  handle?: string;
};

/** The part of an email before the @ (and any +tag): what a handle is suggested from when there's no name. */
const emailName = (email: string) => email.trim().split('@')[0].split('+')[0];

/**
 * What signing up, signing up from an invite and starting an organisation say when something is
 * wrong (`auth.accountErrors`, and the handle's problems in `common.handle.problems`): in the language
 * of the page that asks, English for the app's own callers (the platform admin).
 */
async function wordsIn(locale: Locale) {
  const [t, handle] = await Promise.all([
    getTranslations({ locale, namespace: 'auth' }),
    getTranslations({ locale, namespace: 'common.handle.problems' }),
  ]);
  return { t, handle };
}

type Words = Awaited<ReturnType<typeof wordsIn>>;

/** What's wrong with a handle, in the words' language (null: it can be used). */
async function handleIssue(words: Words, handle: string) {
  const problem = await handleUnavailableKey(handle);
  return problem ? words.handle(problem, { min: HANDLE_MIN, max: HANDLE_MAX }) : null;
}

/**
 * The person's handle as given (checked: its form, and that nobody else has it), or one suggested from
 * their name.
 */
async function personalHandle(input: AccountInput, words: Words): Promise<Result<string>> {
  const given = input.handle?.trim();
  const from = input.name.trim() || emailName(input.email);
  if (!given) {
    return { ok: true, value: await suggestHandle(from, 'me') };
  }
  const handle = normalizeHandle(given);
  const problem = await handleIssue(words, handle);
  if (problem && handle === normalizeHandle(from)) {
    // They kept the suggestion from their name (or email) and someone has it: the next free one.
    return { ok: true, value: await suggestHandle(from, 'me') };
  }
  return problem ? { ok: false, message: words.t('accountErrors.handle', { problem }), field: 'handles' } : { ok: true, value: handle };
}

/**
 * What came of it, or what's wrong in words; `field` says which part of a form it's about (sign-up's
 * steps: the account, the organisation, the handles).
 */
export type Result<T> = { ok: true; value: T } | { ok: false; message: string; field?: 'account' | 'organization' | 'handles' };

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') || null };
}

function validateAccount(input: AccountInput, { t }: Words, options: { nameOptional?: boolean } = {}): string | null {
  const name = input.name.trim();
  if (!name && !options.nameOptional) {
    return t('accountErrors.nameMissing');
  }
  if (name.length > MAX_NAME_LENGTH) {
    return t('accountErrors.nameTooLong');
  }
  if (!EMAIL_PATTERN.test(input.email.trim())) {
    return t('accountErrors.emailInvalid');
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return t('accountErrors.passwordTooShort', { min: MIN_PASSWORD_LENGTH });
  }
  // The same rule the sign-up form checks as they type (src/lib/password-strength.ts).
  if (passwordProblem(input.password, { email: input.email, min: MIN_PASSWORD_LENGTH })) {
    return t('accountErrors.passwordEasy');
  }
  return null;
}

async function emailTaken(email: string) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { identifier: { equals: email, mode: 'insensitive' } },
        { email: { equals: email, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  return Boolean(user);
}

/** An organisation's handle from its name: free among people's and organisations' handles (src/lib/handles.ts). */
async function uniqueOrganizationSlug(name: string) {
  return suggestHandle(name, 'team');
}

const MAX_ORGANIZATION_NAME_LENGTH = 120;
/** How many organisations one person may create for themselves and own (platform admins: no cap). */
export const MAX_SELF_CREATED_ORGANIZATIONS = 10;
/** Any constant: the advisory lock that makes "is there an organisation yet?" and the create one step. */
const LOCAL_ORGANIZATION_LOCK = 7316011;

class OrganizationRefused extends Error {}

/**
 * The local edition runs exactly one organisation. Inside the creating transaction, so two sign-ups
 * at the same moment can't both see an empty installation.
 */
async function guardNewOrganization(tx: TransactionClient, { t }: Words) {
  if (EDITION !== 'local') {
    return;
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCAL_ORGANIZATION_LOCK})`;
  if (await tx.organization.count()) {
    throw new OrganizationRefused(t('accountErrors.installationHasOrganization'));
  }
}

/** Runs a creating transaction, turning a refusal from `guardNewOrganization` into a message. */
async function refusalOr<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof OrganizationRefused) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

function organizationNameProblem(name: string, { t }: Words) {
  if (!name) {
    return t('accountErrors.organizationNameMissing');
  }
  return name.length > MAX_ORGANIZATION_NAME_LENGTH ? t('accountErrors.organizationNameTooLong') : null;
}

/**
 * Whether /signup may create an account with a new organisation, as the edition decides. The local
 * edition runs one organisation (sign-up is open until it exists).
 */
export async function isSignupOpen() {
  return serverExtensions.isSignupOpen();
}

/**
 * Sign-up: a new account and a new organisation it owns, in one transaction. Returns the ids the
 * caller needs to start a session. What's wrong is said in `locale` (the sign-up page's language).
 */
export async function signUp(
  input: AccountInput & { organizationName: string; organizationHandle?: string; plan?: string },
  locale: Locale = DEFAULT_LOCALE
): Promise<Result<{ userId: string; organizationId: string }>> {
  const words = await wordsIn(locale);
  // Their name comes later (Profile), so sign-up asks only for the email and a password.
  const problem = validateAccount(input, words, { nameOptional: true });
  if (problem) {
    return { ok: false, message: problem, field: 'account' };
  }
  if (isThrowawayEmail(input.email)) {
    return { ok: false, message: words.t('accountErrors.throwawayEmail'), field: 'account' };
  }
  if (!input.organizationName.trim()) {
    return { ok: false, message: words.t('accountErrors.organizationMissing'), field: 'organization' };
  }
  if (!(await isSignupOpen())) {
    return { ok: false, message: words.t('accountErrors.installationSetUp') };
  }
  return createAccountWithOrganization(input, { signsInNow: true, locale, startingPlan: input.plan, nameOptional: true });
}

/**
 * A new account and the organisation it owns, whether or not sign-up is open: sign-up uses it, and
 * so does a platform admin setting up an organisation for someone. `plan` defaults to the edition's
 * (`startingPlan`: the one picked at sign-up, which the edition checks);
 * `signsInNow` when the new owner is the one signing up (their first sign-in is now); `createdById`
 * when someone else (the platform admin) sets it up, otherwise the new owner created it. What's wrong
 * is said in `locale` (English unless the page asking is in another language).
 */
export async function createAccountWithOrganization(
  input: AccountInput & { organizationName: string; organizationHandle?: string },
  options: {
    plan?: OrgPlan;
    startingPlan?: string | null;
    signsInNow?: boolean;
    createdById?: string;
    locale?: Locale;
    /** Sign-up: the name may wait (they add it in Profile). */
    nameOptional?: boolean;
  } = {}
): Promise<Result<{ userId: string; organizationId: string }>> {
  const words = await wordsIn(options.locale ?? DEFAULT_LOCALE);
  const { t } = words;
  const problem = validateAccount(input, words, { nameOptional: options.nameOptional });
  if (problem) {
    return { ok: false, message: problem, field: 'account' };
  }
  const organizationName = input.organizationName.trim();
  const nameProblem = organizationNameProblem(organizationName, words);
  if (nameProblem) {
    return { ok: false, message: nameProblem, field: 'organization' };
  }

  const email = input.email.trim().toLowerCase();
  if (await emailTaken(email)) {
    return { ok: false, message: t('accountErrors.emailTaken'), field: 'account' };
  }

  // Handles: the person's and the organisation's, from one namespace (and never the same one).
  const handle = await personalHandle(input, words);
  if (!handle.ok) {
    return handle;
  }
  let slug: string;
  if (input.organizationHandle?.trim()) {
    slug = normalizeHandle(input.organizationHandle);
    const problem = await handleIssue(words, slug);
    if (problem && slug === normalizeHandle(organizationName)) {
      // The suggestion from its name, taken: the next free one.
      slug = await suggestHandle(organizationName, 'team');
    } else if (problem) {
      return { ok: false, message: t('accountErrors.organizationHandle', { problem }), field: 'handles' };
    }
  } else {
    slug = await uniqueOrganizationSlug(organizationName);
  }
  if (slug === handle.value) {
    return { ok: false, message: t('accountErrors.handlesSame'), field: 'handles' };
  }
  // No name yet (sign-up): none, until they add it in Profile.
  const { firstName, lastName } = input.name.trim() ? splitName(input.name) : { firstName: null, lastName: null };
  // Before the transaction: hashing takes a while, and the transaction would hold its connection.
  const passwordHash = await hashPasswordAsync(input.password);

  try {
    return await refusalOr(() =>
      withoutOrgScope(() =>
        prisma.$transaction(async (tx) => {
          await guardNewOrganization(tx, words);
          const user = await tx.user.create({
            data: {
              identifier: email,
              displayUsername: email,
              email,
              name: input.name.trim() || email,
              handle: handle.value,
              firstName,
              lastName,
              lastLoginAt: options.signsInNow ? new Date() : null,
            },
            select: { id: true },
          });
          await createCredentialAccount(tx, user.id, passwordHash);
          const organization = await tx.organization.create({
            data: {
              name: organizationName,
              slug,
              // A plan the platform admin picked, or what someone's own organisation starts on.
              ...(options.plan ? { plan: options.plan } : serverExtensions.newOrganizationPlan(options.startingPlan)),
              createdById: options.createdById ?? user.id,
              members: { create: { userId: user.id, role: OrgRole.OWNER } },
            },
            select: { id: true },
          });
          return { userId: user.id, organizationId: organization.id };
        })
      )
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Someone took the email or a handle a moment before.
      return { ok: false, message: t('accountErrors.justTaken'), field: 'handles' };
    }
    throw error;
  }
}

/**
 * A new organisation owned by an existing account, in one transaction (behind the local guard).
 * `capped`: someone creating it for themselves, who may own MAX_SELF_CREATED_ORGANIZATIONS they
 * created; counted under their own lock, so creating several at once can't get past the cap.
 */
async function createOwnedOrganization(
  userId: string,
  name: string,
  plan: OrgPlan | null,
  createdById: string,
  words: Words,
  options: { capped?: boolean } = {}
) {
  const slug = await uniqueOrganizationSlug(name);
  // A plan the platform admin picked, or what someone's own organisation starts on.
  const planData = plan ? { plan } : serverExtensions.newOrganizationPlan();
  return refusalOr(() =>
    withoutOrgScope(() =>
      prisma.$transaction(async (tx) => {
        await guardNewOrganization(tx, words);
        if (options.capped) {
          await lockFor(tx, 'user', userId);
          const owned = await tx.organizationMember.count({
            where: { userId, role: OrgRole.OWNER, organization: { createdById: userId } },
          });
          if (owned >= MAX_SELF_CREATED_ORGANIZATIONS) {
            throw new OrganizationRefused(words.t('accountErrors.ownedCap', { max: MAX_SELF_CREATED_ORGANIZATIONS }));
          }
        }
        const organization = await tx.organization.create({
          data: { name, slug, ...planData, createdById, members: { create: { userId, role: OrgRole.OWNER } } },
          select: { id: true },
        });
        return { organizationId: organization.id };
      })
    )
  );
}

/**
 * Someone signed in starts an organisation of their own: their first (onboarding), or another one
 * where the edition allows it. Open while sign-up is; each person may own up to
 * MAX_SELF_CREATED_ORGANIZATIONS they created themselves. What's wrong is said in `locale` (the
 * page's language).
 */
export async function createOrganizationForUser(
  userId: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE
): Promise<Result<{ organizationId: string }>> {
  const words = await wordsIn(locale);
  const trimmed = name.trim();
  const problem = organizationNameProblem(trimmed, words);
  if (problem) {
    return { ok: false, message: problem };
  }
  if (!(await isSignupOpen())) {
    return {
      ok: false,
      message: words.t(EDITION === 'local' ? 'accountErrors.installationHasOrganization' : 'accountErrors.organizationsAtLaunch'),
    };
  }
  // The cap is checked in the creating transaction itself (`capped`).
  return createOwnedOrganization(userId, trimmed, null, userId, words, { capped: true });
}

/**
 * The platform admin sets up an organisation for an existing account, which owns it from now on.
 * Whatever sign-up's state and the person's cap; the local edition still runs one organisation.
 */
export async function createOrganizationForExistingUser(input: {
  email: string;
  organizationName: string;
  plan: OrgPlan;
  createdById: string;
}): Promise<Result<{ userId: string; organizationId: string }>> {
  // The platform admin's page, in its language.
  const words = await wordsIn((await getLocale()) as Locale);
  const name = input.organizationName.trim();
  const problem = organizationNameProblem(name, words);
  if (problem) {
    return { ok: false, message: problem };
  }
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      isActive: true,
      OR: [{ identifier: { equals: email, mode: 'insensitive' } }, { email: { equals: email, mode: 'insensitive' } }],
    },
    select: { id: true },
  });
  if (!user) {
    return { ok: false, message: words.t('accountErrors.noAccountForEmail') };
  }
  const created = await createOwnedOrganization(user.id, name, input.plan, input.createdById, words);
  return created.ok ? { ok: true, value: { userId: user.id, organizationId: created.value.organizationId } } : created;
}

/** Settings → General: the organisation's new name. What's wrong is said in the page's language. */
export async function renameOrganization(organizationId: string, name: string): Promise<Result<null>> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) {
    return { ok: false, message: (await getTranslations('account.settings.errors'))('nameLength', { max: 120 }) };
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { name: trimmed } });
  return { ok: true, value: null };
}

// ---------------------------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------------------------

export async function listTeam(organizationId: string) {
  const [members, invites] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        role: true,
        access: true,
        createdAt: true,
        user: {
          select: { id: true, identifier: true, email: true, firstName: true, lastName: true, lastLoginAt: true },
        },
      },
    }),
    prisma.userInvite.findMany({
      where: { organizationId, claimedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, label: true, orgRole: true, access: true, grants: true, expiresAt: true, createdAt: true },
    }),
  ]);
  return { members, invites };
}

const ROLE_RANK: Record<OrgRole, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

/**
 * A new account's password, where Better Auth keeps it (src/lib/auth.ts): its "credential"
 * account. Made in the same transaction as the account, so it's never half there; Better Auth then
 * signs the person in with it.
 */
async function createCredentialAccount(tx: TransactionClient, userId: string, passwordHash: string) {
  await tx.authAccount.create({ data: { accountId: userId, providerId: 'credential', userId, password: passwordHash } });
}

/** What the Team page says when a change to someone is refused (`account.team.errors`), in the page's language. */
const teamErrors = () => getTranslations('account.team.errors');

/**
 * Changes a member's role. Owners can change anyone; admins can change members and admins but
 * never touch owners or make someone an owner. The last owner can't be demoted.
 */
export async function changeMemberRole(
  actor: { id: string; orgRole: OrgRole },
  organizationId: string,
  memberId: string,
  role: OrgRole
): Promise<Result<null>> {
  const t = await teamErrors();
  if (!serverExtensions.team.roleChanges) {
    return { ok: false, message: t('rolesFixed') };
  }
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, role: true, userId: true },
  });
  if (!member) {
    return { ok: false, message: t('notMember') };
  }
  if (actor.orgRole !== OrgRole.OWNER && (member.role === OrgRole.OWNER || role === OrgRole.OWNER)) {
    return { ok: false, message: t('ownersOnly') };
  }
  return keepingAnOwner(
    organizationId,
    member.id,
    async (tx) => {
      await tx.organizationMember.update({ where: { id: member.id }, data: { role } });
    },
    { demotes: role !== OrgRole.OWNER, message: t('lastOwner'), gone: t('notMember') }
  );
}

const LAST_OWNER_MESSAGE = 'An organisation needs at least one owner.';

/**
 * Runs `change` to a member (demoting or removing them) only if the organisation keeps an owner.
 * The count and the change are one transaction under the organisation's lock: two owners demoting
 * or removing each other at the same moment can't leave it with none. `demotes`: whether the change
 * takes the member's owner role away (removing always does). Refuses with `message` otherwise, and
 * with `gone` when the member left meanwhile.
 */
async function keepingAnOwner(
  organizationId: string,
  memberId: string,
  change: (tx: TransactionClient) => Promise<void>,
  options: { demotes?: boolean; message?: string; gone?: string } = {}
): Promise<Result<null>> {
  const outcome = await prisma.$transaction(async (tx) => {
    await lockFor(tx, 'organization', organizationId);
    // Read again under the lock: they may have left, or their role changed, since the caller looked.
    const member = await tx.organizationMember.findFirst({
      where: { id: memberId, organizationId },
      select: { role: true },
    });
    if (!member) {
      return 'gone' as const;
    }
    if (member.role === OrgRole.OWNER && options.demotes !== false) {
      const owners = await tx.organizationMember.count({ where: { organizationId, role: OrgRole.OWNER } });
      if (owners <= 1) {
        return 'last-owner' as const;
      }
    }
    await change(tx);
    return 'done' as const;
  });
  if (outcome === 'gone') {
    return { ok: false, message: options.gone ?? 'That person is not in this organisation.' };
  }
  return outcome === 'done' ? { ok: true, value: null } : { ok: false, message: options.message ?? LAST_OWNER_MESSAGE };
}

export async function removeMember(
  actor: { id: string; orgRole: OrgRole },
  organizationId: string,
  memberId: string
): Promise<Result<null>> {
  const t = await teamErrors();
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, role: true, userId: true },
  });
  if (!member) {
    return { ok: false, message: t('notMember') };
  }
  if (ROLE_RANK[member.role] < ROLE_RANK[actor.orgRole]) {
    return { ok: false, message: t('removeRank') };
  }
  return keepingAnOwner(organizationId, member.id, (tx) => detachMember(tx, organizationId, member), {
    message: t('lastOwner'),
    gone: t('notMember'),
  });
}

/**
 * "Sign out" from the Team page: ends a member's sessions in this organisation, and any session of
 * theirs that began before now can't open it again (they sign in once more). Their sessions in their
 * other organisations go on. Owners and admins, for people with their role or below, never themselves.
 */
export async function signOutMember(
  actor: { id: string; orgRole: OrgRole },
  organizationId: string,
  memberId: string
): Promise<Result<{ ended: number }>> {
  const t = await teamErrors();
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, role: true, userId: true },
  });
  if (!member) {
    return { ok: false, message: t('notMember') };
  }
  if (member.userId === actor.id) {
    return { ok: false, message: t('signOutSelf') };
  }
  if (ROLE_RANK[member.role] < ROLE_RANK[actor.orgRole]) {
    return { ok: false, message: t('signOutRank') };
  }
  await prisma.organizationMember.update({ where: { id: member.id }, data: { signedOutAt: new Date() } });
  // Their open sessions working here end now, through Better Auth (the rest at their next page).
  const sessions = await prisma.authSession.findMany({
    where: { userId: member.userId, organizationId, impersonatedBy: null },
    select: { id: true, token: true },
  });
  const { endSessionsByToken } = await import('./admin-auth');
  return { ok: true, value: { ended: await endSessionsByToken(sessions, 'organization') } };
}

/**
 * Takes someone off a team: their membership, and with it their sync tokens, connected apps, the
 * groups they teach and their instructor links for this organisation and their access rules there
 * (rejoining starts from the new invite). Inside the caller's transaction (`keepingAnOwner`).
 */
async function detachMember(tx: TransactionClient, organizationId: string, member: { id: string; userId: string }) {
  const now = new Date();
  await tx.organizationMember.delete({ where: { id: member.id } });
  // Their sync tokens for this organisation stop working with them.
  await tx.apiToken.updateMany({
    where: { ownerId: member.userId, organizationId, revokedAt: null },
    data: { revokedAt: now },
  });
  // So do apps they connected to it.
  await tx.oAuthToken.updateMany({
    where: { connection: { userId: member.userId, organizationId }, revokedAt: null },
    data: { revokedAt: now },
  });
  await tx.connectorConnection.updateMany({
    where: { userId: member.userId, organizationId, revokedAt: null },
    data: { revokedAt: now },
  });
  // They no longer teach this organisation's groups.
  await tx.courseGroupInstructor.deleteMany({ where: { userId: member.userId, group: { course: { organizationId } } } });
  // Their instructor links would stop answering anyway (checked per request); revoke them outright.
  await tx.accessLink.updateMany({
    where: { instructorUserId: member.userId, group: { course: { organizationId } }, revokedAt: null },
    data: { revokedAt: now },
  });
  await tx.userGrant.deleteMany({ where: { userId: member.userId, organizationId } });
}

/** Someone leaves an organisation themselves. The last owner can't: there must be one. */
export async function leaveOrganization(userId: string, organizationId: string): Promise<Result<{ name: string }>> {
  const member = await withoutOrgScope(() =>
    prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, userId: true, role: true, organization: { select: { name: true } } },
    })
  );
  const t = await getTranslations('app.organizations.errors');
  if (!member) {
    return { ok: false, message: t('notMember') };
  }
  const left = await withoutOrgScope(() =>
    keepingAnOwner(organizationId, member.id, (tx) => detachMember(tx, organizationId, member), {
      message: t('onlyOwner'),
    })
  );
  return left.ok ? { ok: true, value: { name: member.organization.name } } : left;
}

// ---------------------------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------------------------

export type InviteInput = {
  organizationId: string;
  createdById: string;
  label: string;
  role: OrgRole;
  /** A member's access (checked by the caller); owners and admins always join with full access. */
  access?: AccessInput | null;
  /** From a group's page: they become one of its instructors when they join (checked by the caller). */
  teachesGroupId?: string | null;
};

/** The invite row, in the caller's transaction (`createInviteWithinSeats`). */
async function insertInvite(db: DbClient, input: InviteInput) {
  const token = createPublicAccessToken();
  const { inviteRoles } = serverExtensions.team;
  const role = inviteRoles.includes(input.role) ? input.role : inviteRoles[0];
  await db.userInvite.create({
    data: {
      tokenHash: hashSessionToken(token),
      label: input.label.trim().slice(0, 120) || 'Team invite',
      organizationId: input.organizationId,
      orgRole: role,
      ...inviteAccessData(role, input.access ?? null),
      teachesGroupId: input.teachesGroupId ?? null,
      expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
      createdById: input.createdById,
    },
  });
  return token;
}

/**
 * Mints an invite link for the organisation; the raw token is returned once, its hash is stored.
 * A role the edition doesn't let invites give (never owner) becomes its default invite role. Behind
 * the plan's seat check (`serverExtensions.limits.seat`), as one step under the organisation's
 * lock: two invites made at the same moment can't both take the last seat. The check reads what is
 * committed, which once the lock is held includes an invite made a moment before.
 */
export async function createInviteWithinSeats(
  input: InviteInput
): Promise<Result<string> | { ok: false; message: string; code: string }> {
  return prisma.$transaction(async (tx) => {
    await lockFor(tx, 'organization', input.organizationId);
    const seat = await serverExtensions.limits.seat(input.organizationId);
    if (!seat.ok) {
      return { ok: false, message: seat.message, code: seat.code };
    }
    return { ok: true, value: await insertInvite(tx, input) };
  });
}

export async function revokeInvite(organizationId: string, inviteId: string) {
  const result = await prisma.userInvite.updateMany({
    where: { id: inviteId, organizationId, claimedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/** A pending invite for a raw token, with its organisation, or null. */
export async function findPendingInvite(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const invite = await withoutOrgScope(() =>
    prisma.userInvite.findUnique({
      where: { tokenHash: hashSessionToken(trimmed) },
      select: {
        id: true,
        label: true,
        orgRole: true,
        access: true,
        grants: true,
        teachesGroupId: true,
        expiresAt: true,
        revokedAt: true,
        claimedAt: true,
        organization: { select: { id: true, name: true } },
      },
    })
  );
  if (!invite || !invite.organization || invite.claimedAt || invite.revokedAt || invite.expiresAt <= new Date()) {
    return null;
  }
  return { ...invite, organization: invite.organization };
}

async function claimInvite(
  tx: TransactionClient,
  inviteId: string,
  userId: string,
  organizationId: string,
  role: OrgRole
) {
  const now = new Date();
  const guarded = await tx.userInvite.updateMany({
    where: { id: inviteId, claimedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { claimedAt: now },
  });
  if (guarded.count === 0) {
    return false;
  }
  // Someone already on the team keeps their role and access; a new member gets the invite's.
  const existing = await tx.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true },
  });
  const invite = await tx.userInvite.findUnique({
    where: { id: inviteId },
    select: { orgRole: true, access: true, grants: true, createdById: true, teachesGroupId: true },
  });
  if (!existing) {
    await tx.organizationMember.create({ data: { organizationId, userId, role } });
    if (invite) {
      await applyInviteAccess(tx, invite, userId, organizationId);
    }
  }
  // An invite from a group's page: they teach it (with what they need there, if they were on the team).
  const group = invite?.teachesGroupId
    ? await tx.courseGroup.findFirst({ where: { id: invite.teachesGroupId, course: { organizationId } }, select: { id: true, courseId: true } })
    : null;
  if (group) {
    // Lazily: group-instructors reaches this module back through the access checks.
    const { assignGroupInstructor } = await import('./group-instructors');
    await assignGroupInstructor(tx, { organizationId, group, userId, actorId: invite?.createdById ?? null });
  }
  return true;
}

/** A signed-in user joins the invite's organisation. */
/** Why someone couldn't join with a valid invite: the team has no free seat (the invite page says so). */
export const TEAM_FULL = 'team-full';

export async function acceptInvite(
  token: string,
  userId: string
): Promise<Result<{ organizationId: string }> | { ok: false; message: string; code: typeof TEAM_FULL }> {
  const invite = await findPendingInvite(token);
  if (!invite) {
    return { ok: false, message: 'This invite is no longer valid. Ask for a new link.' };
  }
  // Someone joining takes the seat their invite held; the team must still have room (the plan can
  // change after an invite is made). People already on the team take no new seat.
  const alreadyMember = await withoutOrgScope(() =>
    prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: invite.organization.id, userId } },
      select: { id: true },
    })
  );
  if (!alreadyMember) {
    const seat = await serverExtensions.limits.seat(invite.organization.id, { claimingInvite: true });
    if (!seat.ok) {
      return { ok: false, message: seat.message, code: TEAM_FULL };
    }
  }
  const joined = await withoutOrgScope(() =>
    prisma.$transaction((tx) =>
      claimInvite(tx, invite.id, userId, invite.organization.id, invite.orgRole)
    )
  );
  if (!joined) {
    return { ok: false, message: 'This invite is no longer valid. Ask for a new link.' };
  }
  return { ok: true, value: { organizationId: invite.organization.id } };
}

/** A new account created from an invite, joining its organisation. What's wrong is said in `locale` (the invite page's). */
export async function signUpWithInvite(
  token: string,
  input: AccountInput,
  locale: Locale = DEFAULT_LOCALE
): Promise<Result<{ userId: string; organizationId: string }>> {
  const words = await wordsIn(locale);
  const { t } = words;
  const problem = validateAccount(input, words);
  if (problem) {
    return { ok: false, message: problem };
  }
  const invite = await findPendingInvite(token);
  if (!invite) {
    return { ok: false, message: t('accountErrors.inviteGone') };
  }
  const email = input.email.trim().toLowerCase();
  if (await emailTaken(email)) {
    return { ok: false, message: t('accountErrors.emailTakenInvite') };
  }
  // Before the account is made: the team must still have the seat this invite held. No free seat
  // is said as the invite page says it; the plan's other refusals (it ended) are the edition's words.
  const seat = await serverExtensions.limits.seat(invite.organization.id, { claimingInvite: true });
  if (!seat.ok) {
    return { ok: false, message: seat.code === 'seats' ? t('invite.teamFull') : seat.message };
  }
  const handle = await personalHandle(input, words);
  if (!handle.ok) {
    return handle;
  }
  const { firstName, lastName } = splitName(input.name);
  // Before the transaction: hashing takes a while, and the transaction would hold its connection.
  const passwordHash = await hashPasswordAsync(input.password);

  const userId = await withoutOrgScope(() =>
    prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          identifier: email,
          displayUsername: email,
          email,
          name: input.name.trim() || email,
          handle: handle.value,
          firstName,
          lastName,
          lastLoginAt: new Date(),
        },
        select: { id: true },
      });
      await createCredentialAccount(tx, user.id, passwordHash);
      const joined = await claimInvite(
        tx,
        invite.id,
        user.id,
        invite.organization.id,
        invite.orgRole
      );
      if (!joined) {
        throw new Error('invite-gone');
      }
      return user.id;
    })
  ).catch((error: unknown) => {
    if (error instanceof Error && error.message === 'invite-gone') {
      return null;
    }
    throw error;
  });

  if (!userId) {
    return { ok: false, message: t('accountErrors.inviteGone') };
  }
  return { ok: true, value: { userId, organizationId: invite.organization.id } };
}
