'use server';

import { requireMember } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

/** Home showed the person what happened to their instructor notes: from now on, only what happens later. */
export async function markNotesSeenAction(): Promise<void> {
  const viewer = await requireMember();
  await prisma.user.update({ where: { id: viewer.id }, data: { notesSeenAt: new Date() } });
}
