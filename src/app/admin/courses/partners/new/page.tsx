import { getTranslations } from 'next-intl/server';
import { FiAlertTriangle } from 'react-icons/fi';
import AdminNotice from '../../../components/ui/AdminNotice';
import SettingsFrame from '../../../settings/SettingsFrame';
import { SettingsBlock, SettingsGroup } from '../../../settings/ui/SettingsList';
import { courseFlashMessage } from '../../messages';
import { requireSection } from '@/lib/admin-auth';
import { createPartnerAction } from '../actions';
import PartnerForm from '../components/PartnerForm';
import styles from '../../../admin.module.css';

type SearchParams = Promise<{
  error?: string;
  status?: string;
}>;

/** A new partner, in Settings like the list it is added from (Settings → Partners). */
export default async function NewPartnerPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection('courses');

  const [flashMessage, t] = await Promise.all([courseFlashMessage(await searchParams), getTranslations('courses.partners')]);

  return (
    <SettingsFrame active="partners" title={t('newTitle')}>
      {flashMessage ? (
        <AdminNotice className={styles.statusNotice} icon={<FiAlertTriangle size={18} />} variant="banner">
          {flashMessage}
        </AdminNotice>
      ) : null}
      <SettingsGroup title={t('partner')} footer={t('newSubtitle')}>
        <SettingsBlock>
          <PartnerForm action={createPartnerAction} pendingText={t('adding')} submitLabel={t('add')} />
        </SettingsBlock>
      </SettingsGroup>
    </SettingsFrame>
  );
}
