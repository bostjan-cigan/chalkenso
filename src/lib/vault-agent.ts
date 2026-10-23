import 'server-only';

import { serverExtensions } from '@/extensions/server';
import { prisma } from './prisma';

/**
 * Whether the Obsidian vault and its Claude Code agent are part of how this organisation works, so
 * "Ready for the AI agent" (handing a task's revision to the vault agent) means something: always
 * in the local edition; in an edition with a Claude connector, only once someone there has an
 * Obsidian sync token.
 */
export async function usesVaultAgent(organizationId: string | null | undefined) {
  if (!serverExtensions.claudeConnector) return true;
  if (!organizationId) return false;
  return (await prisma.apiToken.count({ where: { organizationId, revokedAt: null, scopes: { has: 'sync' } } })) > 0;
}
