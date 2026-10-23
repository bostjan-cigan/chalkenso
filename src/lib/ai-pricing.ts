/**
 * What an AI call costs, from the tokens Anthropic reports. Prices are US dollars per million
 * tokens, which is the same number as micro-dollars per token, so a call's cost in micro-dollars is
 * tokens × price. Used for a monthly cap on the platform's key and to show organisations what their
 * own key spends. Pure.
 *
 * Update when Anthropic's prices change; an unknown model is priced as the most expensive one we
 * use, so a cap is never under-counted.
 */

export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

const FALLBACK_PRICE = MODEL_PRICES['claude-fable-5-1'];

export type TokenUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** The price for a model id, matching dated ids (`claude-opus-5-5-20260901`) to their family. */
export function priceFor(model: string): ModelPrice {
  const id = model.trim().toLowerCase();
  const match = Object.keys(MODEL_PRICES)
    .sort((a, b) => b.length - a.length)
    .find((known) => id === known || id.startsWith(`${known}-`));
  return match ? MODEL_PRICES[match] : FALLBACK_PRICE;
}

/** Cost of one call in micro-dollars (US dollars × 1,000,000), rounded up. */
export function costMicros(model: string, usage: TokenUsage): number {
  const price = priceFor(model);
  const cost =
    (usage.input_tokens ?? 0) * price.input +
    (usage.output_tokens ?? 0) * price.output +
    (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite;
  return Math.ceil(cost);
}

/** "Claude Sonnet 5.5" for `claude-sonnet-5-5` (dated ids too); unknown ids as they are. */
export function modelName(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?$/.exec(model.trim().toLowerCase());
  if (!match) return model;
  const [, family, major, minor] = match;
  return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`;
}

/** Whether a month's spend on the platform's key has reached its cap (in US cents; null = no cap). */
export function capReached(spentMicros: number, capCents: number | null): boolean {
  return capCents !== null && spentMicros >= capCents * 10_000;
}

/** The first moment of the month `date` falls in (UTC): caps reset on the 1st. */
export function monthStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
