import 'server-only';

import { prisma } from './prisma';

/**
 * "Don't show this again": prompts a person can turn off for themself. Kept on their account
 * (`User.dismissedPrompts`), so it holds on every device, and only ever their own row changes.
 * Each key is one prompt:
 * - `courseMapAi`: the course map's "Check all lessons with AI?" before its first check with AI.
 */
export const PROMPTS = ['courseMapAi'] as const;
export type PromptKey = (typeof PROMPTS)[number];

/** Whether this person asked never to see the prompt again. */
export async function promptDismissed(userId: string, key: PromptKey) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dismissedPrompts: true } });
  return user?.dismissedPrompts.includes(key) ?? false;
}

/** This person never sees the prompt again. */
export async function dismissPrompt(userId: string, key: PromptKey) {
  if (await promptDismissed(userId, key)) return;
  await prisma.user.update({ where: { id: userId }, data: { dismissedPrompts: { push: key } } });
}
