import { getTranslations } from 'next-intl/server';
import { FiAlertTriangle, FiUsers } from 'react-icons/fi';
import AdminNotice from '../../../components/ui/AdminNotice';
import AdminSectionCard from '../../../components/ui/AdminSectionCard';
import CourseManagementFrame from '../../components/CourseManagementFrame';
import { createGroupAction } from '../actions';
import GroupForm from '../components/GroupForm';
import { listCoursesForGroupForm, listVersionsByCourseForGroupForm } from '../data';
import { getGroupFlashMessage } from '../messages';
import { Permission } from '@prisma/client';
import { accessScope, courseScopeWhere, isUnrestricted, requireCrmAccess } from '@/lib/crm-access';
import { courseGrantIds } from '@/lib/permissions';
import styles from '../../../admin.module.css';

type SearchParams = Promise<{
  error?: string;
  /** The course to start with (from a course's Groups tab). */
  course?: string;
}>;

export default async function NewGroupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Whoever can edit a whole course may start a group in it (as `createGroupAction` checks).
  const viewer = await requireCrmAccess((candidate) => {
    const editable = courseGrantIds(candidate.grants, [Permission.WRITE]);
    return isUnrestricted(candidate) || editable === '*' || editable.length > 0;
  });
  const editableCourses = courseScopeWhere(accessScope(viewer, 'courses', [Permission.WRITE]));

  const [params, courses, versionsByCourseId, t] = await Promise.all([
    searchParams,
    listCoursesForGroupForm(editableCourses),
    listVersionsByCourseForGroupForm(editableCourses),
    getTranslations('groups.newGroup'),
  ]);
  const initialCourseId = courses.find((course) => course.id === params.course)?.id;
  const flashMessage = await getGroupFlashMessage(params);

  return (
    <CourseManagementFrame
      activeSection="groups"
      pageContext={{
        title: t('title'),
        subtitle: t('subtitle'),
        back: { href: '/admin/courses/groups', label: t('back') },
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
          kicker={t('title')}
          title=""
          icon={<FiUsers size={18} />}
        >
          <GroupForm
            action={createGroupAction}
            courses={courses}
            versionsByCourseId={versionsByCourseId}
            initialCourseId={initialCourseId}
          />
        </AdminSectionCard>
      </section>
    </CourseManagementFrame>
  );
}
