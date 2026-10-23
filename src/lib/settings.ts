import 'server-only';

import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Generic scoped settings (see `Setting` in schema.prisma). `scope` + `scopeId` name what the
 * settings belong to, without a foreign key, so any feature can store settings without a migration.
 */

export async function getSettings(scope: string, scopeId: string): Promise<Record<string, unknown>> {
  const rows = await prisma.setting.findMany({
    where: { scope, scopeId },
    select: { key: true, value: true },
  });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/** Upserts the given keys; `null` removes a key (falling back to the caller's default). */
export async function setSettings(
  scope: string,
  scopeId: string,
  values: Record<string, Prisma.InputJsonValue | null>
) {
  await prisma.$transaction(
    Object.entries(values).map(([key, value]) =>
      value === null
        ? prisma.setting.deleteMany({ where: { scope, scopeId, key } })
        : prisma.setting.upsert({
            where: { scope_scopeId_key: { scope, scopeId, key } },
            create: { scope, scopeId, key, value },
            update: { value },
          })
    )
  );
}
