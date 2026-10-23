import { getLocale, getTranslations } from 'next-intl/server';
import { SiObsidian } from 'react-icons/si';
import { TbDownload } from 'react-icons/tb';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import { SettingsBlock, SettingsGroup, SettingsRow } from '@/app/admin/settings/ui/SettingsList';
import { serverExtensions } from '@/extensions/server';
import type { Locale } from '@/i18n/config';
import { formatAccessDate } from '@/lib/access-links';
import { OBSIDIAN_PLUGIN_URL, SITE_URL } from '@/lib/site';
import CopyText from './CopyText';
import styles from './obsidian-connect.module.css';

/**
 * Settings → Tokens' Obsidian card. Until one of the person's tokens has synced in this organisation:
 * the three steps to connect a vault (install the plugin, create a token, add it in Obsidian). Then
 * one row: connected, and when it last synced.
 */
export default async function ObsidianConnect({ synced }: { synced: { name: string; lastUsedAt: Date | null } | null }) {
  const t = await getTranslations('account.apiTokens.obsidian');
  const locale = (await getLocale()) as Locale;
  const guides = serverExtensions.obsidianGuides;
  const download = OBSIDIAN_PLUGIN_URL ? (
    <AdminButton href={OBSIDIAN_PLUGIN_URL} tone="secondary" size="compact">
      <TbDownload aria-hidden />
      {t('download')}
    </AdminButton>
  ) : null;
  const icon = (
    <span className={styles.gem} aria-hidden>
      <SiObsidian />
    </span>
  );

  if (synced?.lastUsedAt) {
    return (
      <SettingsGroup title={t('kicker')} testId="obsidian-connect">
        <SettingsRow
          label={
            <span className={styles.connected}>
              {icon}
              {t('connected')}
            </span>
          }
          detail={t('connectedDetail', { date: formatAccessDate(synced.lastUsedAt, locale), name: synced.name })}
          testId="obsidian-connected"
        >
          {download}
          {guides.plugin ? (
            <AdminButton href={guides.plugin} tone="secondary" size="compact">
              {t('guide')}
            </AdminButton>
          ) : null}
        </SettingsRow>
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title={t('kicker')} testId="obsidian-connect">
      <SettingsBlock>
        <div className={styles.head}>
          {icon}
          <div>
            <h3>{t('title')}</h3>
            <p>{t('lead')}</p>
          </div>
        </div>
        <ol className={styles.steps}>
          <li>
            <div>
              <strong>{t('install.title')}</strong>
              <span>{t.rich('install.text', { code: (chunks) => <code>{chunks}</code> })}</span>
            </div>
            {download}
          </li>
          <li>
            <div>
              <strong>{t('token.title')}</strong>
              <span>{t.rich('token.text', { link: (chunks) => <a href="#create-token">{chunks}</a> })}</span>
            </div>
          </li>
          <li>
            <div>
              <strong>{t('add.title')}</strong>
              <span>{t('add.text')}</span>
              <CopyText text={SITE_URL} copy={t('copy')} copied={t('copied')} />
            </div>
          </li>
        </ol>
        <p className={styles.foot}>
          <span>{t('then')}</span>
          {guides.plugin ? <a href={guides.plugin}>{t('pluginGuide')}</a> : null}
          {guides.claude ? <a href={guides.claude}>{t('claudeGuide')}</a> : null}
        </p>
      </SettingsBlock>
    </SettingsGroup>
  );
}
