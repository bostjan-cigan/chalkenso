import 'server-only';

import { withoutOrgScope } from './org-context';
import { prisma } from './prisma';

/**
 * Small things an organisation's app remembers: a guide section marked done (for everyone), or a
 * hint one person hid (`personalKey`). Kept as the organisation's setting rows, so they go with it.
 */
const SCOPE = 'organization';

/** A key for one person's choice in an organisation, e.g. that they hid Getting started. */
export const personalKey = (name: string, userId: string) => `hidden:${name}:${userId}`;

/** Which of these keys are remembered for the organisation. */
export async function rememberedKeys(organizationId: string, keys: string[]): Promise<Set<string>> {
  const rows = await withoutOrgScope(() =>
    prisma.setting.findMany({ where: { scope: SCOPE, scopeId: organizationId, key: { in: keys } }, select: { key: true } })
  );
  return new Set(rows.map((row) => row.key));
}

/** Remembers a key for the organisation (`on`), or forgets it. */
export async function remember(organizationId: string, key: string, on: boolean) {
  await withoutOrgScope(async () => {
    if (on) {
      await prisma.setting.upsert({
        where: { scope_scopeId_key: { scope: SCOPE, scopeId: organizationId, key } },
        update: { value: true },
        create: { scope: SCOPE, scopeId: organizationId, key, value: true },
      });
    } else {
      await prisma.setting.deleteMany({ where: { scope: SCOPE, scopeId: organizationId, key } });
    }
  });
}
