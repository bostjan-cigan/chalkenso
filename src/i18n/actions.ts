'use server';

import { getCurrentUserSession } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';
import { isLocale } from './config';

/**
 * Saves a language picked in the menu on the signed-in person's own account, so it follows them to
 * other devices and into their emails. Signed out it does nothing (the browser's cookie is the pick).
 */
export async function rememberLocale(locale: string) {
  if (!isLocale(locale)) return;
  const session = await getCurrentUserSession();
  // "Log in as" shows someone else's app: the platform admin's pick isn't theirs to save.
  if (!session || session.user.impersonator) return;
  await prisma.user.update({ where: { id: session.user.id }, data: { locale } });
}
