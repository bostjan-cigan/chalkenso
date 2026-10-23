import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which organisation a request works in, for the database scoping in `prisma.ts`.
 *
 * Signed-in browser requests need nothing here: the scope comes from the session. Requests that
 * authenticate another way (Obsidian sync with an API token) call `setRequestOrganization` once
 * they know the token's organisation. `withoutOrgScope` runs trusted cross-organisation work
 * (sign-up, joining a team, platform admin), and must never wrap anything driven by user input
 * about other organisations' records.
 */
type OrgScope = { organizationId: string | null; bypass: boolean };

// One store for the whole process. Next loads this module more than once (server actions and pages
// are separate bundles, and again after a hot reload), while the database client in prisma.ts is
// created once and kept on globalThis: with a store per copy, a page's `withoutOrgScope` would set
// a store the client never reads.
const globalForScope = globalThis as typeof globalThis & { organizationScope?: AsyncLocalStorage<OrgScope> };
const storage = (globalForScope.organizationScope ??= new AsyncLocalStorage<OrgScope>());

export function setRequestOrganization(organizationId: string) {
  storage.enterWith({ organizationId, bypass: false });
}

/**
 * Runs `fn` scoped to one organisation, whatever the session says: for requests that reach data
 * through their own token (a learner link) once that token has said which organisation it is in.
 * Unlike `setRequestOrganization` this works from inside a helper or a component, not only at the
 * top of a route handler: the scope is set for exactly what `fn` awaits.
 */
export function withOrgScope<T>(organizationId: string, fn: () => PromiseLike<T> | T): Promise<T> {
  return storage.run({ organizationId, bypass: false }, async () => await fn());
}

export function withoutOrgScope<T>(fn: () => PromiseLike<T> | T): Promise<T> {
  // Awaited inside the run: Prisma queries are lazy and start when awaited, so returning the
  // query unawaited would run it outside the bypass (and re-scope it, recursing for API tokens).
  return storage.run({ organizationId: null, bypass: true }, async () => await fn());
}

export function currentOrgScope(): OrgScope | undefined {
  return storage.getStore();
}
