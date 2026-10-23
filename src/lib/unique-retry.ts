import 'server-only';

import { Prisma } from '@prisma/client';

/**
 * Racing for a unique value: the next position, the next version number, a free slug. Two requests
 * at the same moment can pick the same one, and the database refuses the second (P2002). These
 * helpers turn that refusal into another try with a fresh pick, instead of an error page.
 */

/** A column or constraint name, compared without case or underscores (`owner_group_id` = `ownerGroupId`). */
function normalise(name: string) {
  return name.toLowerCase().replace(/_/g, '');
}

/**
 * Whether `error` is a unique-key violation (P2002) and, with `fields`, one on a key that includes
 * one of them. Prisma names the key by its columns (`['curriculum_version_id', 'position']`) or, with
 * some drivers, by its constraint's name; both are matched. A key it doesn't name matches any field.
 */
export function isUniqueViolation(error: unknown, fields: string[] = []): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  if (fields.length === 0) {
    return true;
  }
  const wanted = fields.map(normalise);
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.some((column) => wanted.includes(normalise(String(column))));
  }
  if (typeof target === 'string') {
    const constraint = normalise(target);
    return wanted.some((field) => constraint.includes(field));
  }
  return true;
}

/**
 * Runs `work`, and again (up to `attempts` tries in all) while it fails on a unique key named in
 * `fields`. Each try must pick its value afresh (`max + 1`, a free slug), so the loser of a race
 * simply takes the next one. Anything else, and the last refusal, is thrown as it is. A transaction
 * inside `work` is retried whole.
 */
export async function retryOnUniqueViolation<T>(
  work: (attempt: number) => Promise<T>,
  options: { fields?: string[]; attempts?: number } = {}
): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work(attempt);
    } catch (error) {
      if (attempt >= attempts || !isUniqueViolation(error, options.fields)) {
        throw error;
      }
    }
  }
}
