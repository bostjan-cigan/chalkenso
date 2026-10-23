import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { FiAlertTriangle, FiPlus } from 'react-icons/fi';
import AdminNotice from '../../components/ui/AdminNotice';
import SettingsFrame from '../../settings/SettingsFrame';
import InfoTip from '../../settings/ui/InfoTip';
import { SettingsGroup, SettingsRow, settingsStyles } from '../../settings/ui/SettingsList';
import { listPartnersForIndex } from '../data';
import { courseFlashMessage } from '../messages';
import { requireSection } from '@/lib/admin-auth';
import styles from '../../admin.module.css';

type SearchParams = Promise<{
  error?: string;
  status?: string;
}>;

/** The organisation's partners: shown on learner pages and, through the website API, on its own site. */
export default async function PartnersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection('courses');

  const [search, partners, t] = await Promise.all([searchParams, listPartnersForIndex(), getTranslations('courses.partners')]);
  const flashMessage = await courseFlashMessage(search);

  return (
    <SettingsFrame active="partners" title={t('title')} description={t('description')}>
      {flashMessage ? (
        <AdminNotice className={styles.statusNotice} icon={<FiAlertTriangle size={18} />} variant="banner">
          {flashMessage}
        </AdminNotice>
      ) : null}
      <SettingsGroup title={t('title')} info={<InfoTip label={t('title')}>{t('description')}</InfoTip>}>
        {partners.map((partner) => {
          const courses = partner._count.coursePartners;
          const groups = partner._count.groupPartners;
          return (
            <SettingsRow
              key={partner.id}
              label={partner.name}
              detail={[`${t('courses', { count: courses })}${groups ? `, ${t('groups', { count: groups })}` : ''}`, partner.websiteUrl].filter(Boolean).join(' · ')}
            >
              <Link href={`/admin/courses/partners/${partner.id}`} className={settingsStyles.action}>
                {t('edit')} ›
              </Link>
            </SettingsRow>
          );
        })}
        {!partners.length ? <SettingsRow label={t('emptyTitle')} /> : null}
        <SettingsRow
          label={
            <Link href="/admin/courses/partners/new" className={settingsStyles.action} style={{ marginLeft: '-0.4rem' }}>
              <FiPlus size={15} /> {t('add')}
            </Link>
          }
        />
      </SettingsGroup>
    </SettingsFrame>
  );
}
