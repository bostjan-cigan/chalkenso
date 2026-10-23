'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { refuseWhileImpersonating, requireOrgAdmin } from '@/lib/admin-auth';
import { setOrganizationAiKey } from '@/lib/ai-key';
import { isOrgColorKey, isOrgIconKey } from '@/lib/organization-identity';
import { renameOrganization } from '@/lib/organizations';
import { prisma } from '@/lib/prisma';
import { buildOrganizationLogoKey, deleteObjectFromR2, uploadImageToR2 } from '@/lib/r2';

/** What Settings' forms say back, in the page's language (`account.settings.actions`). */
export type SettingsActionState = { error: string | null; message: string | null };

const words = () => getTranslations('account.settings.actions');

export async function renameOrganizationAction(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const user = await requireOrgAdmin();
  const result = await renameOrganization(user.organization.id, String(formData.get('name') ?? ''));
  revalidatePath('/admin', 'layout');
  return result.ok ? { error: null, message: (await words())('saved') } : { error: result.message, message: null };
}

/** The organisation's own Anthropic API key (bring your own key). */
export async function saveAiKeyAction(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const user = await requireOrgAdmin();
  const refused = await refuseWhileImpersonating();
  if (refused) {
    return { error: refused, message: null };
  }
  const result = await setOrganizationAiKey(user.organization.id, String(formData.get('apiKey') ?? ''), user.id);
  revalidatePath('/admin', 'layout');
  return result.ok ? { error: null, message: (await words())('keySaved') } : { error: result.message, message: null };
}

export async function removeAiKeyAction(_state: SettingsActionState, _formData: FormData): Promise<SettingsActionState> {
  const user = await requireOrgAdmin();
  const refused = await refuseWhileImpersonating();
  if (refused) {
    return { error: refused, message: null };
  }
  const result = await setOrganizationAiKey(user.organization.id, null);
  revalidatePath('/admin', 'layout');
  return result.ok ? { error: null, message: (await words())('keyRemoved') } : { error: result.message, message: null };
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
/** Raster images only: an SVG served from the app could carry scripts. */
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** The organisation's logo, shown in the sidebar and the switcher instead of its icon. */
export async function updateOrganizationLogoAction(formData: FormData): Promise<SettingsActionState> {
  const user = await requireOrgAdmin();
  const t = await words();
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return { error: t('logoMissing'), message: null };
  }
  if (!LOGO_TYPES.has(file.type)) {
    return { error: t('logoType'), message: null };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { error: t('logoTooLarge', { max: MAX_LOGO_BYTES / 1024 / 1024 }), message: null };
  }
  const organizationId = user.organization.id;
  const existing = await prisma.organization.findUnique({ where: { id: organizationId }, select: { logoKey: true } });
  const key = buildOrganizationLogoKey(organizationId, randomUUID(), file.name);
  try {
    await uploadImageToR2(file, key);
  } catch {
    return { error: t('logoUploadFailed'), message: null };
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { logoKey: key } });
  if (existing?.logoKey && existing.logoKey !== key) {
    await deleteObjectFromR2(existing.logoKey).catch(() => undefined);
  }
  revalidatePath('/admin', 'layout');
  return { error: null, message: t('logoSaved') };
}

export async function removeOrganizationLogoAction(): Promise<SettingsActionState> {
  const user = await requireOrgAdmin();
  const t = await words();
  const organizationId = user.organization.id;
  const existing = await prisma.organization.findUnique({ where: { id: organizationId }, select: { logoKey: true } });
  if (!existing?.logoKey) {
    return { error: null, message: t('logoNone') };
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { logoKey: null } });
  await deleteObjectFromR2(existing.logoKey).catch(() => undefined);
  revalidatePath('/admin', 'layout');
  return { error: null, message: t('logoRemoved') };
}

/** The icon and colour shown without a logo. */
export async function setOrganizationIconAction(icon: string, color: string): Promise<SettingsActionState> {
  const user = await requireOrgAdmin();
  const t = await words();
  if (!isOrgIconKey(icon) || !isOrgColorKey(color)) {
    return { error: t('pickIcon'), message: null };
  }
  await prisma.organization.update({ where: { id: user.organization.id }, data: { iconName: icon, iconColor: color } });
  revalidatePath('/admin', 'layout');
  return { error: null, message: t('saved') };
}
