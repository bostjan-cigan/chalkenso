'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { requireUser, refuseWhileImpersonating } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';
import {
  canManageApiToken,
  deleteApiToken,
  mintApiToken,
  revokeApiToken,
} from '@/lib/api-tokens';

const ADMIN_API_TOKENS_PATH = '/admin/api-tokens';

export type CreateApiTokenResult = {
  ok: boolean;
  message: string;
  /** Present only on success — the raw token, shown to the owner exactly once. */
  token?: string;
  tokenName?: string;
};

export type RevokeApiTokenResult = {
  ok: boolean;
  message: string;
};

export type DeleteApiTokenResult = {
  ok: boolean;
  message: string;
};

/** What the page's forms say back (`account.apiTokens.actions`), in its language. */
const words = () => getTranslations('account.apiTokens.actions');

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

export async function createApiTokenAction(
  formData: FormData
): Promise<CreateApiTokenResult> {
  const refusal = await refuseWhileImpersonating();
  if (refusal) return { ok: false, message: refusal };
  const user = await requireUser();
  const t = await words();

  const name = getFormValue(formData, 'name');

  if (!name) {
    return { ok: false, message: t('nameMissing') };
  }

  if (!user.organization) {
    return { ok: false, message: t('noOrganization') };
  }

  const minted = await mintApiToken({
    name,
    ownerId: user.id,
    organizationId: user.organization.id,
  });

  revalidatePath(ADMIN_API_TOKENS_PATH);

  return {
    ok: true,
    message: t('created'),
    token: minted.token,
    tokenName: minted.name,
  };
}

/** Loads the token named by the form and checks the current user may manage it. */
async function findManageableTokenId(formData: FormData): Promise<string | null> {
  const user = await requireUser();
  const tokenId = getFormValue(formData, 'tokenId');

  if (!tokenId) {
    return null;
  }

  const token = await prisma.apiToken.findUnique({
    where: { id: tokenId },
    select: { id: true, ownerId: true },
  });

  return token && canManageApiToken(user, token) ? token.id : null;
}

export async function revokeApiTokenAction(
  formData: FormData
): Promise<RevokeApiTokenResult> {
  const tokenId = await findManageableTokenId(formData);
  const t = await words();

  if (!tokenId) {
    return { ok: false, message: t('notFound') };
  }

  const count = await revokeApiToken(tokenId);

  revalidatePath(ADMIN_API_TOKENS_PATH);

  if (count === 0) {
    return { ok: false, message: t('alreadyRevoked') };
  }

  return { ok: true, message: t('revoked') };
}

export async function deleteApiTokenAction(
  formData: FormData
): Promise<DeleteApiTokenResult> {
  const tokenId = await findManageableTokenId(formData);
  const t = await words();

  if (!tokenId) {
    return { ok: false, message: t('notFound') };
  }

  const count = await deleteApiToken(tokenId);

  revalidatePath(ADMIN_API_TOKENS_PATH);

  if (count === 0) {
    return { ok: false, message: t('onlyRevoked') };
  }

  return { ok: true, message: t('deleted') };
}
