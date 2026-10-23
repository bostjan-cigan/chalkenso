import 'server-only';

import { lockFor } from './advisory-locks';
import { withoutOrgScope } from './org-context';
import { prisma } from './prisma';
import { capReached, costMicros, monthStart, type TokenUsage } from './ai-pricing';
import type { AiKeySource } from './ai-key';

/**
 * Every AI call the app makes, with its cost: organisations see what their own key spends, and a
 * monthly cap on the platform's key is checked against it (`reserveHostedAiUsage`). Nothing is
 * recorded under AI_MOCK.
 */

export type AiFeature = 'revise' | 'plan' | 'check' | 'themes' | 'report' | 'wording' | 'courseMap';

/** In English; pages say them in the person's language with `editor.ai.features.<feature>`. */
export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  revise: 'Lesson revisions',
  plan: 'Revision plans',
  check: 'Check questions',
  themes: 'Feedback themes',
  report: 'Report summaries',
  wording: 'Wording checks',
  courseMap: 'Course map analyses',
};

export async function recordAiUsage(input: {
  organizationId: string;
  userId: string | null;
  feature: AiFeature;
  model: string;
  source: AiKeySource;
  usage: TokenUsage;
}) {
  await prisma.aiUsage.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      feature: input.feature,
      model: input.model,
      source: input.source,
      inputTokens: input.usage.input_tokens ?? 0,
      outputTokens: input.usage.output_tokens ?? 0,
      cacheReadTokens: input.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: input.usage.cache_creation_input_tokens ?? 0,
      costMicros: costMicros(input.model, input.usage),
    },
  });
}

/** The calls paid from an organisation's top-ups, ever. */
const topUpUseWhere = (organizationId: string) => ({ organizationId, source: 'hosted', fromTopUp: true });

/**
 * The most a call can cost before it is made: every output token it may write, and its prompt at a
 * generous two characters a token (text runs nearer four), at the model's prices.
 */
export function maxCallCostMicros(model: string, prompt: string, maxTokens: number) {
  return costMicros(model, { input_tokens: Math.ceil(prompt.length / 2), output_tokens: maxTokens });
}

/**
 * Holds the cost of a call on the platform's key against the monthly cap before the call is made: a
 * usage row at the most the call can cost, written only while this month's spend (other calls' holds
 * included) is under the cap, or, once it isn't, while the organisation's top-ups have something
 * left (the row is then `fromTopUp`); all under the organisation's lock. Calls made at the same
 * moment so see each other's holds, and together overshoot the cap or the top-ups by one call at
 * most, as a single call always could. `settleAiUsage` puts in what the call really cost; until
 * then, or if that never happens, the hold counts at its maximum, which errs on the side of the
 * cap. Returns the row's id, or null when the cap is reached and no top-up is left.
 */
export async function reserveHostedAiUsage(input: {
  organizationId: string;
  userId: string | null;
  feature: AiFeature;
  model: string;
  maxCostMicros: number;
  /** The cap in US cents (null: no cap), as the edition gave the platform's key. */
  capCents: number | null;
  /** Since when the cap counts (null: this calendar month). */
  capSince?: Date | null;
}): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await lockFor(tx, 'hostedAi', input.organizationId);
    const spent = await tx.aiUsage.aggregate({
      where: { organizationId: input.organizationId, source: 'hosted', fromTopUp: false, createdAt: { gte: input.capSince ?? monthStart() } },
      _sum: { costMicros: true },
    });
    let fromTopUp = false;
    if (capReached(spent._sum.costMicros ?? 0, input.capCents)) {
      const bought = await tx.aiTopUp.aggregate({ where: { organizationId: input.organizationId }, _sum: { amountCents: true } });
      const used = await tx.aiUsage.aggregate({ where: topUpUseWhere(input.organizationId), _sum: { costMicros: true } });
      if ((bought._sum.amountCents ?? 0) * 10_000 - (used._sum.costMicros ?? 0) <= 0) {
        return null;
      }
      fromTopUp = true;
    }
    const hold = await tx.aiUsage.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        feature: input.feature,
        model: input.model,
        source: 'hosted',
        costMicros: input.maxCostMicros,
        fromTopUp,
      },
      select: { id: true },
    });
    return hold.id;
  });
}

/** What a held call really cost (`reserveHostedAiUsage`), once it has answered. */
export async function settleAiUsage(id: string, input: { model: string; usage: TokenUsage }) {
  await prisma.aiUsage.update({
    where: { id },
    data: {
      model: input.model,
      inputTokens: input.usage.input_tokens ?? 0,
      outputTokens: input.usage.output_tokens ?? 0,
      cacheReadTokens: input.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: input.usage.cache_creation_input_tokens ?? 0,
      costMicros: costMicros(input.model, input.usage),
    },
  });
}

/** Gives a hold back: Anthropic refused the call outright, so it cost nothing. */
export async function releaseAiUsage(id: string) {
  await prisma.aiUsage.deleteMany({ where: { id } });
}

/**
 * This month's spend of one organisation on the platform's key (micro-dollars; top-ups apart), or
 * since `since`.
 */
export async function hostedSpendThisMonth(organizationId: string, since: Date | null = null) {
  const sum = await withoutOrgScope(() =>
    prisma.aiUsage.aggregate({
      where: { organizationId, source: 'hosted', fromTopUp: false, createdAt: { gte: since ?? monthStart() } },
      _sum: { costMicros: true },
    })
  );
  return sum._sum.costMicros ?? 0;
}

/**
 * What's left of an organisation's top-ups (micro-dollars): what they bought, less the calls paid
 * from it. Below zero by a call at most (a call's hold can overshoot), which the next top-up covers.
 */
export async function topUpLeftMicros(organizationId: string) {
  const [bought, used] = await withoutOrgScope(() =>
    Promise.all([
      prisma.aiTopUp.aggregate({ where: { organizationId }, _sum: { amountCents: true } }),
      prisma.aiUsage.aggregate({ where: topUpUseWhere(organizationId), _sum: { costMicros: true } }),
    ])
  );
  return (bought._sum.amountCents ?? 0) * 10_000 - (used._sum.costMicros ?? 0);
}

export type UsageSummary = {
  calls: number;
  costMicros: number;
  byFeature: Array<{ feature: AiFeature; label: string; calls: number; costMicros: number }>;
};

/**
 * This month's calls and cost for an organisation, for one key source (their own key, or the
 * platform's); on the platform's key, the calls within the cap, or with `topUp` the top-ups'.
 */
export async function usageThisMonth(organizationId: string, source: AiKeySource, topUp = false): Promise<UsageSummary> {
  const rows = await prisma.aiUsage.groupBy({
    by: ['feature'],
    where: { organizationId, source, ...(source === 'hosted' ? { fromTopUp: topUp } : {}), createdAt: { gte: monthStart() } },
    _count: { _all: true },
    _sum: { costMicros: true },
  });
  const byFeature = rows
    .map((row) => ({
      feature: row.feature as AiFeature,
      label: AI_FEATURE_LABELS[row.feature as AiFeature] ?? row.feature,
      calls: row._count._all,
      costMicros: row._sum.costMicros ?? 0,
    }))
    .sort((a, b) => b.costMicros - a.costMicros);
  return {
    calls: byFeature.reduce((sum, row) => sum + row.calls, 0),
    costMicros: byFeature.reduce((sum, row) => sum + row.costMicros, 0),
    byFeature,
  };
}

/** Spend on the platform's key per organisation this month, within the cap (across organisations on purpose). */
export async function hostedSpendByOrganization(): Promise<Map<string, number>> {
  const rows = await withoutOrgScope(() =>
    prisma.aiUsage.groupBy({
      by: ['organizationId'],
      where: { source: 'hosted', fromTopUp: false, createdAt: { gte: monthStart() } },
      _sum: { costMicros: true },
    })
  );
  return new Map(rows.map((row) => [row.organizationId, row._sum.costMicros ?? 0]));
}
