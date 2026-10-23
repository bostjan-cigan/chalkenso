import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FiAlertTriangle } from 'react-icons/fi';
import AdminNotice from '../../../components/ui/AdminNotice';
import SettingsFrame from '../../../settings/SettingsFrame';
import { SettingsBlock, SettingsGroup, SettingsRow, settingsStyles } from '../../../settings/ui/SettingsList';
import { getPartnerDetail } from '../../data';
import { courseFlashMessage } from '../../messages';
import { requireSection } from '@/lib/admin-auth';
import { updatePartnerAction } from '../actions';
import PartnerDeleteButton from '../components/PartnerDeleteButton';
import PartnerForm from '../components/PartnerForm';
import styles from '../../../admin.module.css';

type PageParams = Promise<{
  partnerId: string;
}>;

type SearchParams = Promise<{
  error?: string;
  status?: string;
}>;

/**
 * A partner, in Settings like the list it comes from (Settings → Partners): its details, where it
 * shows (each course or group a row that opens it) and Delete, in Settings' grouped lists.
 */
export default async function PartnerDetailPage({ params, searchParams }: { params: PageParams; searchParams: SearchParams }) {
  await requireSection('courses');

  const { partnerId } = await params;
  const [search, partner] = await Promise.all([searchParams, getPartnerDetail(partnerId)]);

  if (!partner) {
    notFound();
  }

  const [flashMessage, t] = await Promise.all([courseFlashMessage(search), getTranslations('courses.partners')]);
  const usedBy = [
    ...partner.coursePartners.map(({ course }) => ({ href: `/admin/courses/${course.id}/edit`, label: course.title })),
    ...partner.joinFor.map((course) => ({
      href: `/admin/courses/${course.id}/edit`,
      label: t('joinButtonOf', { course: course.title }),
    })),
    ...partner.groupPartners.map(({ group }) => ({
      href: `/admin/courses/groups/${group.id}?tab=settings`,
      label: `${group.name} (${group.course.title})`,
    })),
  ];

  return (
    <SettingsFrame active="partners" title={partner.name}>
      {flashMessage ? (
        <AdminNotice className={styles.statusNotice} icon={<FiAlertTriangle size={18} />} variant="banner">
          {flashMessage}
        </AdminNotice>
      ) : null}

      <SettingsGroup title={t('partner')}>
        <SettingsBlock>
          <PartnerForm
            action={updatePartnerAction}
            initialDescription={partner.description || ''}
            initialLogoUrl={partner.logoUrl || ''}
            initialName={partner.name}
            initialWebsiteUrl={partner.websiteUrl || ''}
            partnerId={partner.id}
            pendingText={t('saving')}
            submitLabel={t('saveChanges')}
          />
        </SettingsBlock>
      </SettingsGroup>

      <SettingsGroup title={t('whereItShows')} footer={usedBy.length ? undefined : t('unused')} testId="partner-used-by">
        {usedBy.length ? (
          usedBy.map((entry) => (
            <SettingsRow key={`${entry.href}-${entry.label}`} label={entry.label}>
              <Link href={entry.href} className={settingsStyles.action}>
                {t('open')} ›
              </Link>
            </SettingsRow>
          ))
        ) : (
          <SettingsRow label={t('nowhere')} />
        )}
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow label={<PartnerDeleteButton partnerId={partner.id} partnerName={partner.name} />} />
      </SettingsGroup>
    </SettingsFrame>
  );
}
