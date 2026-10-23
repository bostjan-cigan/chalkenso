import { capReached } from './ai-pricing';

/**
 * The rules for who pays for an AI call, as pure functions. ai-key.ts and an edition's fallback key
 * apply them.
 */

export type AiKeySource = 'organization' | 'hosted' | 'installation';
/**
 * Why the app can't run AI itself: no key at all, the platform key's cap is reached, Anthropic
 * refused the organisation's key, the organisation is paused, or its plan includes neither AI in the
 * app nor a key of its own (the last two only in an edition with plans).
 */
export type AiUnavailableReason = 'no-key' | 'cap' | 'key-invalid' | 'paused' | 'plan';
/**
 * A key and who pays; on the platform's key, also its cap in US cents (null: no cap) and since when
 * it counts (`capSince`; null or absent: this calendar month).
 */
export type AiKeyChoice = { apiKey: string; source: AiKeySource; capCents?: number | null; capSince?: Date | null };
export type AiKeyFallback = { key: AiKeyChoice } | { key: null; reason: AiUnavailableReason };

/**
 * The organisation's own key first (when it can be read and Anthropic hasn't refused it), then the
 * edition's fallback; without either, why not (a refused own key says so even when the fallback has
 * its own reason).
 */
export function chooseAiKey(
  own: { apiKey: string | null; refused: boolean } | null,
  fallback: AiKeyFallback
): { key: AiKeyChoice | null; reason: AiUnavailableReason | null } {
  if (own?.apiKey && !own.refused) return { key: { apiKey: own.apiKey, source: 'organization' }, reason: null };
  if (fallback.key) return { key: fallback.key, reason: null };
  return { key: null, reason: own?.refused ? 'key-invalid' : fallback.reason };
}

/**
 * The platform's key as an edition's fallback: only where it is `enabled`, under this month's cap
 * (`spentMicros` is the spend within it), then on top-ups while any are left (`topUpMicros`).
 */
export function hostedDecision(input: {
  enabled: boolean;
  platformKey: string | null;
  spentMicros: number;
  capCents: number | null;
  capSince?: Date | null;
  topUpMicros?: number;
}): AiKeyFallback {
  if (!input.enabled || !input.platformKey) return { key: null, reason: 'no-key' };
  if (capReached(input.spentMicros, input.capCents) && !((input.topUpMicros ?? 0) > 0)) return { key: null, reason: 'cap' };
  return { key: { apiKey: input.platformKey, source: 'hosted', capCents: input.capCents, capSince: input.capSince ?? null } };
}
