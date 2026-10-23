import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { requireOrgAdmin } from '@/lib/admin-auth';
import { serverExtensions } from '@/extensions/server';
import { ui } from '@/extensions/ui';
import { organizationAiKeyHint, resolveAiKeyState, showsAiMockNote } from '@/lib/ai-key';
import { modelFor } from '@/lib/ai';
import { modelName } from '@/lib/ai-pricing';
import { usageThisMonth, type UsageSummary } from '@/lib/ai-usage';
import SettingsFrame from '../SettingsFrame';
import { AiKeyForm } from '../SettingsForms';
import InfoTip from '../ui/InfoTip';
import { SettingsBlock, SettingsGroup, SettingsRow, SettingsStatus, UsageBar } from '../ui/SettingsList';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('account.settings.ai'))('metaTitle') };
}
export const dynamic = 'force-dynamic';

const words = () => getTranslations('account.settings.ai');
type Words = Awaited<ReturnType<typeof words>>;

/** Anthropic's terms for API keys, which don't let it train models on what they send (checked 18 Oct 2026). */
const ANTHROPIC_COMMERCIAL_TERMS = 'https://www.anthropic.com/legal/commercial-terms';

/**
 * Dollars as the page's language writes them: "$3.20", "3,20 $"; "under $0.01" for less than a cent;
 * `whole`: "$30" for whole dollars, in a sentence. No thousands separator.
 */
function usd(micros: number, locale: Locale, t: Words, whole = false) {
  const amount = (value: number, digits: number) =>
    new Intl.NumberFormat(INTL_LOCALES[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(value);
  if (micros <= 0) return t('usage.amount', { amount: amount(0, 2) });
  if (micros < 10_000) return t('usage.under', { amount: amount(0.01, 2) });
  return t('usage.amount', { amount: amount(micros / 1_000_000, whole && micros % 1_000_000 === 0 ? 0 : 2) });
}

/** One source's month: its calls and cost, and what they were for under it. */
async function UsageRow({ label, usage }: { label: string; usage: UsageSummary }) {
  const [t, features, locale] = await Promise.all([words(), getTranslations('editor.ai.features'), getLocale() as Promise<Locale>]);
  return (
    <SettingsRow
      label={label}
      detail={usage.byFeature.map((row) => t('usage.feature', { label: features.has(row.feature) ? features(row.feature) : row.label, calls: row.calls })).join(' · ')}
    >
      {t('usage.short', { calls: usage.calls, cost: usd(usage.costMicros, locale, t) })}
    </SettingsRow>
  );
}

/** The 1st of next month, when the included AI starts again (caps reset on the 1st, UTC). */
function nextMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * Settings → AI, as Apple's settings are: no paragraphs, explanations behind ⓘ.
 * - The AI the edition includes (`aiAllowance`): how much of it this month has used, as a bar
 *   (percent and money, about how many drafts it covers), whether it's the one running, and the
 *   edition's own below it (`ui.AiTopUp`).
 * - The organisation's own Anthropic key: active or not, set it, replace it, remove it (where the
 *   edition allows it; otherwise a line saying so).
 * - The edition's own panels.
 * - This month's calls per source.
 */
export default async function AiSettingsPage() {
  const viewer = await requireOrgAdmin();
  if (!serverExtensions.aiOrganizationKeys) notFound();
  const organizationId = viewer.organization.id;
  const [t, locale, current, ownKeyAllowed, allowance, { key, reason }, own, hosted, toppedUp] = await Promise.all([
    words(),
    getLocale() as Promise<Locale>,
    organizationAiKeyHint(organizationId),
    serverExtensions.ownAiKeyAllowed(organizationId),
    serverExtensions.aiAllowance(organizationId),
    resolveAiKeyState(),
    usageThisMonth(organizationId, 'organization'),
    usageThisMonth(organizationId, 'hosted'),
    usageThisMonth(organizationId, 'hosted', true),
  ]);
  const ownActive = key?.source === 'organization';
  const capMicros = allowance?.capCents ? allowance.capCents * 10_000 : null;
  const percent = capMicros ? (allowance!.spentMicros / capMicros) * 100 : 0;
  const usedUp = capMicros !== null && allowance!.spentMicros >= capMicros;
  const topUpLeft = allowance && allowance.topUpMicros > 0 ? allowance.topUpMicros : 0;
  // What the plan's AI is doing: running, standing by behind your key, used up, or paused.
  const planState =
    reason === 'paused'
      ? { on: false, warning: false, text: t('plan.paused') }
      : ownActive
        ? { on: false, warning: false, text: t('plan.standby') }
        : key?.source === 'hosted'
          ? { on: true, warning: false, text: usedUp ? t('plan.inUseTopUp') : t('plan.inUse') }
          : reason === 'cap'
            ? { on: false, warning: true, text: t(allowance?.forTrial ? 'plan.usedUpTrial' : 'plan.usedUp') }
            : { on: false, warning: false, text: t('plan.off') };

  return (
    <SettingsFrame active="ai" title={t('title')} description={t('description')}>
      {allowance ? (
        <SettingsGroup
          title={t('plan.title')}
          info={<InfoTip label={t('plan.title')}>{t('plan.info')}</InfoTip>}
          testId="ai-in-use"
          footer={showsAiMockNote() ? t('sample') : undefined}
        >
          <SettingsRow label={t('plan.state')}>
            <SettingsStatus on={planState.on} warning={planState.warning}>
              {planState.text}
            </SettingsStatus>
          </SettingsRow>
          {capMicros ? (
            <SettingsBlock testId="ai-plan-usage">
              <UsageBar
                label={t('plan.title')}
                percent={percent}
                money={t(allowance.forTrial ? 'plan.moneyTrial' : 'plan.money', { spent: usd(allowance.spentMicros, locale, t), cap: usd(capMicros, locale, t) })}
                detail={
                  allowance.drafts && allowance.forTrial
                    ? t('plan.draftsTrial', { drafts: allowance.drafts })
                    : allowance.drafts
                    ? t('plan.drafts', {
                        drafts: allowance.drafts,
                        date: new Intl.DateTimeFormat(INTL_LOCALES[locale], { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(nextMonthStart()),
                      })
                    : undefined
                }
              />
            </SettingsBlock>
          ) : (
            <SettingsRow label={t(allowance.forTrial ? 'plan.spentTrial' : 'plan.spent')}>{usd(allowance.spentMicros, locale, t)}</SettingsRow>
          )}
          {/* The edition's own below the bar; not while their own key is the one running. */}
          {ui.AiTopUp && capMicros && allowance.canTopUp && !ownActive ? (
            <ui.AiTopUp left={topUpLeft ? usd(topUpLeft, locale, t) : null} included={usd(capMicros, locale, t, true)} usedUp={usedUp} />
          ) : null}
        </SettingsGroup>
      ) : key?.source === 'installation' ? (
        <SettingsGroup title={t('installation.title')} testId="ai-in-use">
          <SettingsRow label={t('plan.state')}>
            <SettingsStatus on={!ownActive}>{ownActive ? t('plan.standby') : t('plan.inUse')}</SettingsStatus>
          </SettingsRow>
        </SettingsGroup>
      ) : null}

      <SettingsGroup
        title={t('key.title')}
        testId="ai-own-key"
        info={
          <InfoTip label={t('key.title')}>
            <p>{t('key.info')}</p>
            <p>{t('key.models', { revise: modelName(modelFor('revise')), plan: modelName(modelFor('plan')) })}</p>
            <p>
              {t.rich('noTraining', {
                terms: (chunks) => (
                  <a href={ANTHROPIC_COMMERCIAL_TERMS} target="_blank" rel="noreferrer">
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </InfoTip>
        }
      >
        {ownKeyAllowed ? (
          <AiKeyForm current={current} />
        ) : (
          <SettingsRow label={t('key.notInPlan')} testId="ai-key-not-in-plan">
            <Link href="/admin/settings/plan">{t('key.seePlans')}</Link>
          </SettingsRow>
        )}
      </SettingsGroup>

      {ui.AiSettingsPanels ? <ui.AiSettingsPanels organizationId={organizationId} /> : null}

      <SettingsGroup title={t('usage.title')} testId="ai-usage">
        {own.calls ? <UsageRow label={t('usage.own')} usage={own} /> : null}
        {hosted.calls ? <UsageRow label={t('usage.hosted')} usage={hosted} /> : null}
        {toppedUp.calls ? <UsageRow label={t('usage.topUp')} usage={toppedUp} /> : null}
        {!own.calls && !hosted.calls && !toppedUp.calls ? <SettingsRow label={t('usage.none')} /> : null}
      </SettingsGroup>
    </SettingsFrame>
  );
}
