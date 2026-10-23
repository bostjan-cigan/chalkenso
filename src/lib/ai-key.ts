import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';
import { serverExtensions } from '@/extensions/server';
import { getCurrentUserSession } from './admin-auth';
import { currentOrgScope } from './org-context';
import { prisma } from './prisma';
import type { Result } from './organizations';
import { decryptSecret, encryptSecret } from './secret-crypto';
import { chooseAiKey, type AiKeyChoice, type AiKeyFallback, type AiKeySource, type AiUnavailableReason } from './ai-rules';

export type { AiKeyFallback, AiKeySource, AiUnavailableReason };

/**
 * Who pays for an AI call made by the app, in this order:
 *
 * 1. The organisation's own Anthropic key (when the edition lets organisations bring one): Anthropic
 *    bills the organisation.
 * 2. The edition's fallback key (`serverExtensions.aiKeyFallback`): the installation's
 *    `ANTHROPIC_API_KEY` in the local edition; an edition may give the platform's key instead,
 *    under a monthly cap.
 * 3. Otherwise no AI in the app.
 *
 * Keys never leave the server; pages only see the last four characters.
 */

const PURPOSE = 'ai-api-key';

export type AiKey = AiKeyChoice & { organizationId: string | null };

export function isAiMock() {
  return process.env.AI_MOCK === '1';
}

/** Whether pages say AI gives sample answers: only to developers running it locally (`next dev`). */
export function showsAiMockNote() {
  return isAiMock() && process.env.NODE_ENV === 'development';
}

export async function currentOrganizationId() {
  const session = await getCurrentUserSession();
  return session?.user.organization?.id ?? currentOrgScope()?.organizationId ?? null;
}

export async function currentUserId() {
  const session = await getCurrentUserSession();
  return session?.user.id ?? null;
}

const organizationAiState = cache(async (organizationId: string) =>
  prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      aiApiKeyEncrypted: true,
      aiApiKeyHint: true,
      aiApiKeyCheckedAt: true,
      aiApiKeyInvalidAt: true,
      connectorEnabled: true,
    },
  })
);

/** Anthropic refused the key in a call since it was last accepted. */
function keyRefused(state: { aiApiKeyCheckedAt: Date | null; aiApiKeyInvalidAt: Date | null }) {
  return Boolean(state.aiApiKeyInvalidAt && (!state.aiApiKeyCheckedAt || state.aiApiKeyInvalidAt > state.aiApiKeyCheckedAt));
}

/** The key for this request's organisation and who pays, or why there is none. */
export const resolveAiKeyState = cache(async (): Promise<{ key: AiKey | null; reason: AiUnavailableReason | null }> => {
  const organizationId = await currentOrganizationId();
  // Paused, AI is off, on any key.
  if (organizationId && (await serverExtensions.isPaused(organizationId))) {
    return { key: null, reason: 'paused' };
  }
  let own: { apiKey: string | null; refused: boolean } | null = null;
  if (serverExtensions.aiOrganizationKeys && organizationId) {
    const state = await organizationAiState(organizationId);
    if (state?.aiApiKeyEncrypted) {
      const refused = keyRefused(state);
      own = { apiKey: refused ? null : decryptSecret(state.aiApiKeyEncrypted, PURPOSE), refused };
    }
  }
  // The fallback is only asked when it is needed (a capped one reads this month's spend).
  const fallback: AiKeyFallback = own?.apiKey && !own.refused ? { key: null, reason: 'no-key' } : await serverExtensions.aiKeyFallback(organizationId);
  const choice = chooseAiKey(own, fallback);
  return { key: choice.key ? { ...choice.key, organizationId } : null, reason: choice.reason };
});

/** The key for this request's organisation, and where it came from; null when the app has no AI. */
export async function resolveAiKey(): Promise<AiKey | null> {
  return (await resolveAiKeyState()).key;
}

/** The edition's fallback alone (after the organisation's own key was refused mid-call). */
export async function fallbackAiKey(organizationId: string | null): Promise<AiKey | null> {
  const fallback = await serverExtensions.aiKeyFallback(organizationId);
  return fallback.key ? { ...fallback.key, organizationId } : null;
}

export type AiAvailability = {
  /** AI can run inside the app (Revise with AI and the other buttons work here). */
  inApp: boolean;
  source: AiKeySource | 'mock' | null;
  reason: AiUnavailableReason | null;
  /** People can open the work in their own Claude instead (an edition's connector). */
  connector: boolean;
};

/** What every AI button can offer on this page: run here, open in Claude, or both. */
export const aiAvailability = cache(async (): Promise<AiAvailability> => {
  const organizationId = await currentOrganizationId();
  const state = organizationId ? await organizationAiState(organizationId) : null;
  const { key, reason } = await resolveAiKeyState();
  // Paused, Claude can still read through the connector, but nothing is drafted for review.
  const connector = serverExtensions.claudeConnector && Boolean(state?.connectorEnabled ?? true) && reason !== 'paused';
  if (isAiMock()) {
    // Sample output stands in for a missing key; a reached cap or a refused key still shows.
    return reason === 'cap' || reason === 'key-invalid' || reason === 'paused'
      ? { inApp: false, source: null, reason, connector }
      : { inApp: true, source: 'mock', reason: null, connector };
  }
  return { inApp: Boolean(key), source: key?.source ?? null, reason, connector };
});

/** Remembers that Anthropic refused the organisation's key, so owners see it and calls fall back. */
export async function markOrganizationKeyRefused(organizationId: string) {
  await prisma.organization.updateMany({ where: { id: organizationId }, data: { aiApiKeyInvalidAt: new Date() } });
}

/** For the settings card: whether the organisation has its own key, how it ends, and whether it works. */
export async function organizationAiKeyHint(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiApiKeyEncrypted: true, aiApiKeyHint: true, aiApiKeyCheckedAt: true, aiApiKeyInvalidAt: true },
  });
  if (!organization?.aiApiKeyEncrypted) {
    return null;
  }
  return {
    hint: organization.aiApiKeyHint ?? '',
    // A key saved under another server secret can't be read any more: say so instead of using it.
    readable: decryptSecret(organization.aiApiKeyEncrypted, PURPOSE) !== null,
    refused: keyRefused(organization),
    checkedAt: organization.aiApiKeyCheckedAt?.toISOString() ?? null,
  };
}

/** What saving a key says when it can't (`account.settings.aiKey.errors`): Settings → AI's, in its language. */
const keyErrors = () => getTranslations('account.settings.aiKey.errors');

/**
 * Asks Anthropic whether a key works, without spending tokens (it lists models). Under AI_MOCK no
 * request is made: a key containing "invalid" is refused, any other accepted (tests and demos).
 */
export async function checkAnthropicKey(apiKey: string): Promise<Result<null>> {
  if (isAiMock()) {
    return apiKey.includes('invalid') ? { ok: false, message: (await keyErrors())('refusedMock') } : { ok: true, value: null };
  }
  try {
    await new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 }).models.list({ limit: 1 });
    return { ok: true, value: null };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, message: (await keyErrors())('refused') };
    }
    return { ok: false, message: (await keyErrors())('unreachable') };
  }
}

/** Saves (after Anthropic accepts it) or, with null, removes the organisation's own key. */
export async function setOrganizationAiKey(organizationId: string, apiKey: string | null, userId?: string): Promise<Result<null>> {
  if (!serverExtensions.aiOrganizationKeys) {
    return { ok: false, message: (await keyErrors())('managed') };
  }
  if (apiKey === null) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { aiApiKeyEncrypted: null, aiApiKeyHint: null, aiApiKeyCheckedAt: null, aiApiKeyInvalidAt: null, aiApiKeySetById: null },
    });
    return { ok: true, value: null };
  }
  if (!(await serverExtensions.ownAiKeyAllowed(organizationId))) {
    return { ok: false, message: (await keyErrors())('notInPlan') };
  }
  const key = apiKey.trim();
  if (key.length < 20 || /\s/.test(key)) {
    return { ok: false, message: (await keyErrors())('incomplete') };
  }
  const check = await checkAnthropicKey(key);
  if (!check.ok) {
    return check;
  }
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      aiApiKeyEncrypted: encryptSecret(key, PURPOSE),
      aiApiKeyHint: key.slice(-4),
      aiApiKeyCheckedAt: new Date(),
      aiApiKeyInvalidAt: null,
      aiApiKeySetById: userId ?? null,
    },
  });
  return { ok: true, value: null };
}
