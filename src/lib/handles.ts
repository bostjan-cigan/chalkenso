import 'server-only';

import { withoutOrgScope } from './org-context';
import { prisma } from './prisma';
import {
  HANDLE_MAX,
  HANDLE_MIN,
  RESERVED_HANDLES,
  type HandleProblem,
  handleProblemKey,
  handleProblemText,
  normalizeHandle as normalizeFormat,
} from './handle-format';
import { ensureUniqueSlug } from './slugs';

export { HANDLE_MAX, HANDLE_MIN, type HandleProblem, handleProblem, handleProblemKey, normalizeHandle } from './handle-format';

/**
 * Handles: a person's (`User.handle`) and an organisation's (its `slug`), in one namespace, like
 * GitHub's users and organisations, so a future `chalkenso.com/<handle>` can never be both.
 */

/** What not to count when checking: the person or organisation the handle is already theirs. */
export type HandleOwner = { userId?: string | null; organizationId?: string | null };

/** Whether someone else has this handle: a person or an organisation. */
export async function handleTaken(handle: string, owner: HandleOwner = {}): Promise<boolean> {
  const [user, organization] = await withoutOrgScope(() =>
    Promise.all([
      prisma.user.findFirst({ where: { handle, ...(owner.userId ? { id: { not: owner.userId } } : {}) }, select: { id: true } }),
      prisma.organization.findFirst({
        where: { slug: handle, ...(owner.organizationId ? { id: { not: owner.organizationId } } : {}) },
        select: { id: true },
      }),
    ])
  );
  return Boolean(user || organization);
}

/** A problem with the handle, or that it's taken (its key in `common.handle.problems`); null when it can be used. */
export async function handleUnavailableKey(handle: string, owner: HandleOwner = {}): Promise<HandleProblem | null> {
  return handleProblemKey(handle) ?? ((await handleTaken(handle, owner)) ? 'taken' : null);
}

/** The same in English (the app's profile page, an edition's handle check). */
export async function handleUnavailable(handle: string, owner: HandleOwner = {}): Promise<string | null> {
  const problem = await handleUnavailableKey(handle, owner);
  return problem ? handleProblemText(problem) : null;
}

/** A free handle from a name: the name's own, or with -2, -3… (never reserved, never short). */
export async function suggestHandle(name: string, fallback: string, owner: HandleOwner = {}) {
  let base = normalizeFormat(name);
  if (base.length < HANDLE_MIN || RESERVED_HANDLES.has(base)) {
    base = normalizeFormat(`${base}-${fallback}`.replace(/^-/, ''));
  }
  if (base.length < HANDLE_MIN) {
    base = fallback;
  }
  return ensureUniqueSlug(base.slice(0, HANDLE_MAX - 3), async (candidate) => RESERVED_HANDLES.has(candidate) || (await handleTaken(candidate, owner)));
}
