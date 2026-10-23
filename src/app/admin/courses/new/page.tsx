import { getTranslations } from 'next-intl/server';
import { FiAlertTriangle, FiBookOpen } from 'react-icons/fi';
import AdminNotice from '../../components/ui/AdminNotice';
import AdminSectionCard from '../../components/ui/AdminSectionCard';
import CourseManagementFrame from '../components/CourseManagementFrame';
import CourseForm from '../components/CourseForm';
import { createCourseAction } from '../actions';
import { listPartnersForCourseForm } from '../data';
import { courseFlashMessage } from '../messages';
import { Permission } from '@prisma/client';
import { requireSection } from '@/lib/admin-auth';
import styles from '../../admin.module.css';

type SearchParams = Promise<{
  error?: string;
}>;

export default async function NewCoursePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireSection('courses', [Permission.WRITE]);

  const [params, partnerOptions] = await Promise.all([
    searchParams,
    listPartnersForCourseForm(),
  ]);
  const [flashMessage, t] = await Promise.all([courseFlashMessage(params), getTranslations('courses.newCourse')]);

  return (
    <CourseManagementFrame
      activeSection="courses"
      pageContext={{
        title: t('title'),
        subtitle: t('subtitle'),
        back: { href: '/admin/courses', label: t('back') },
      }}
      notice={
        flashMessage ? (
          <AdminNotice
            className={styles.statusNotice}
            icon={<FiAlertTriangle size={18} />}
            variant="banner"
          >
            {flashMessage}
          </AdminNotice>
        ) : null
      }
    >
      <section className={styles.editorPageSection}>
        <AdminSectionCard
          kicker={t('kicker')}
          title=""
          icon={<FiBookOpen size={18} />}
        >
          <CourseForm
            action={createCourseAction}
            partnerOptions={partnerOptions}
            pendingText={t('pending')}
            submitLabel={t('submit')}
          />
        </AdminSectionCard>
      </section>
    </CourseManagementFrame>
  );
}
