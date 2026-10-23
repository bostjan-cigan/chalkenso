import { getTranslations } from 'next-intl/server';
import SettingsFrame from '../settings/SettingsFrame';
import { requireMember } from '@/lib/admin-auth';
import ApiTokensManager from './components/ApiTokensManager';
import ObsidianConnect from './components/ObsidianConnect';
import { lastSyncedToken, listApiTokens } from './data';

export const dynamic = 'force-dynamic';

/**
 * Settings → Tokens: the person's sync tokens (Obsidian), under how to connect a vault. Sync tokens
 * work in one organisation: members only (a platform admin, as themselves, goes to their own pages).
 */
export default async function ApiTokensPage() {
  const user = await requireMember();
  const t = await getTranslations('account.apiTokens.page');

  const [tokens, synced] = await Promise.all([listApiTokens(user), lastSyncedToken(user.id, user.organization.id)]);

  const tokenViews = tokens.map((token) => ({
    id: token.id,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    ownerName: token.ownerId === user.id ? t('you') : token.ownerName,
    lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
    revokedAt: token.revokedAt ? token.revokedAt.toISOString() : null,
    createdAt: token.createdAt.toISOString(),
  }));

  return (
    <SettingsFrame active="tokens" title={t('title')} description={t('description')}>
      <ObsidianConnect synced={synced} />
      <ApiTokensManager tokens={tokenViews} />
    </SettingsFrame>
  );
}
