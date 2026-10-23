import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Permission } from '@prisma/client';
import { FiAlertTriangle } from 'react-icons/fi';
import Dropdown from '@/components/Dropdown';
import AdminField from '../../../components/ui/AdminField';
import AdminNotice from '../../../components/ui/AdminNotice';
import AdminTextareaField from '../../../components/ui/AdminTextareaField';
import { SheetControlRow, SheetRow, SheetRows } from '../../../components/ui/Sheet';
import CourseCoverField from '../../components/CourseCoverField';
import CourseManagementFrame from '../../components/CourseManagementFrame';
import { CourseJoinFields, CourseSettingsForm, CourseSettingSwitch, CourseTitleFields } from '../../components/CourseSettingsSheets';
import PartnerListField from '../../components/PartnerListField';
import { getCourseDetail, listPartnersForCourseForm } from '../../data';
import { courseFlashMessage } from '../../messages';
import { requireCourseAccess } from '@/lib/crm-access';
import { canAccessSection } from '@/lib/permissions';
import { EDITION } from '@/lib/site';
import { LANGUAGES, LOCALES, isLocale } from '@/i18n/config';
import styles from '../../../admin.module.css';

type PageParams = Promise<{
  courseId: string;
}>;

type SearchParams = Promise<{
  error?: string;
  status?: string;
}>;

/**
 * A course's Settings, the way Apple groups settings: rows with their value that open a sheet for
 * the part they name, saved on its own; on/off settings are switches in their row. Owners, admins
 * and unrestricted members only.
 */
export default async function EditCoursePage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { courseId } = await params;
  const viewer = await requireCourseAccess(courseId, [Permission.READ]);
  if (!canAccessSection(viewer, 'courses', [Permission.WRITE])) {
    redirect(`/admin/courses/${courseId}`);
  }
  const [search, course, partnerOptions] = await Promise.all([
    searchParams,
    getCourseDetail(courseId),
    listPartnersForCourseForm(),
  ]);

  if (!course) {
    notFound();
  }

  const [flashMessage, t, form] = await Promise.all([
    courseFlashMessage(search),
    getTranslations('courses.edit'),
    getTranslations('courses.form'),
  ]);
  const none = t('none');
  const joinPartner = partnerOptions.find((partner) => partner.id === course.joinPartnerId);
  const joinValue =
    course.joinTarget === 'PARTNER' && joinPartner
      ? joinPartner.name
      : course.joinTarget === 'LINK'
        ? form('joinTarget.link')
        : form('joinTarget.default');

  return (
    <CourseManagementFrame
      activeSection="courses"
      pageContext={{
        title: course.title,
        subtitle: t('subtitle'),
        back: { href: '/admin/courses', label: t('back') },
      }}
      courseTabs={{ courseId: course.id, active: 'settings' }}
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
      <section className={styles.editorPageSection} data-testid="course-settings">
        <SheetRows title={t('course')} testId="course-details">
          <SheetRow label={form('title')} title={t('titleSheet')} value={course.title} testId="course-title-row">
            <CourseSettingsForm courseId={course.id}>
              <CourseTitleFields initialTitle={course.title} initialSlug={course.slug} />
            </CourseSettingsForm>
          </SheetRow>
          <SheetRow label={form('summary')} value={course.summary || none} testId="course-summary-row">
            <CourseSettingsForm courseId={course.id}>
              <AdminTextareaField
                id="course-summary"
                name="summary"
                label={form('summary')}
                hint={form('summaryHint')}
                placeholder={form('summaryPlaceholder')}
                defaultValue={course.summary ?? ''}
              />
            </CourseSettingsForm>
          </SheetRow>
          <SheetRow
            label={t('language')}
            value={isLocale(course.language) ? LANGUAGES[course.language].name : course.language}
            testId="course-language-row"
          >
            <CourseSettingsForm courseId={course.id}>
              <Dropdown
                id="course-language"
                name="language"
                label={form('language')}
                hint={form('languageHint')}
                options={LOCALES.map((code) => ({ value: code, label: LANGUAGES[code].name }))}
                defaultValue={course.language}
              />
            </CourseSettingsForm>
          </SheetRow>
          <SheetRow label={form('partners')} value={course.partners.length || none} testId="course-partners-row">
            <CourseSettingsForm courseId={course.id}>
              <PartnerListField
                id="course-partners"
                label={form('partners')}
                hint={form('partnersHint')}
                options={partnerOptions}
                initialPartnerIds={course.partners.map((partner) => partner.partnerId)}
              />
            </CourseSettingsForm>
          </SheetRow>
          <SheetRow
            label={t('github')}
            value={course.githubUrl ? course.githubUrl.replace(/^https:\/\/github\.com\//, '') : none}
            testId="course-github-row"
          >
            <CourseSettingsForm courseId={course.id}>
              <AdminField
                id="course-github-url"
                name="githubUrl"
                label={form('github')}
                hint={form('githubHint')}
                placeholder="https://github.com/your-org/course-materials"
                defaultValue={course.githubUrl ?? ''}
              />
            </CourseSettingsForm>
          </SheetRow>
        </SheetRows>

        {/* Not in the local edition. */}
        {EDITION === 'cloud' ? (
          <SheetRows title={form('website')} footer={form('websiteHint')} testId="course-website">
            <SheetControlRow label={form('publicListed')}>
              <CourseSettingSwitch courseId={course.id} setting="publicListed" on={course.publicListed} label={form('publicListed')} />
            </SheetControlRow>
            {course.publicListed ? (
              <SheetControlRow label={form('pinned')}>
                <CourseSettingSwitch courseId={course.id} setting="pinned" on={course.pinned} label={form('pinned')} />
              </SheetControlRow>
            ) : null}
            <SheetControlRow label={t('allLessonsFree')}>
              <CourseSettingSwitch courseId={course.id} setting="allLessonsFree" on={course.allLessonsFree} label={form('allLessonsFree')} />
            </SheetControlRow>
            {course.allLessonsFree ? null : (
              <SheetRow label={form('freeLessons')} value={course.freeLessonCount} testId="course-free-lessons-row">
                <CourseSettingsForm courseId={course.id}>
                  <AdminField
                    id="course-free-lessons"
                    name="freeLessonCount"
                    type="number"
                    min={0}
                    label={form('freeLessons')}
                    hint={form('freeLessonsHint')}
                    defaultValue={String(course.freeLessonCount)}
                  />
                </CourseSettingsForm>
              </SheetRow>
            )}
            <SheetRow label={t('card')} testId="course-card-row">
              <CourseSettingsForm courseId={course.id}>
                <CourseCoverField courseId={course.id} initialAssetId={course.coverAssetId || ''} initialAlt={course.coverAsset?.altText || ''} />
                <AdminField
                  id="course-outcome"
                  name="outcome"
                  label={form('outcome')}
                  placeholder={form('outcomePlaceholder')}
                  defaultValue={course.outcome || ''}
                />
                <AdminField
                  id="course-tags"
                  name="tags"
                  label={form('tags')}
                  hint={form('tagsHint')}
                  placeholder="Python, Docker, SQL"
                  defaultValue={course.tags.join(', ')}
                />
              </CourseSettingsForm>
            </SheetRow>
            <SheetRow label={form('join')} value={joinValue} testId="course-join-row">
              <CourseSettingsForm courseId={course.id}>
                <CourseJoinFields
                  initialJoinTarget={course.joinTarget}
                  initialJoinPartnerId={course.joinPartnerId || ''}
                  initialEnrolUrl={course.enrolUrl || ''}
                  partnerOptions={partnerOptions}
                />
              </CourseSettingsForm>
            </SheetRow>
          </SheetRows>
        ) : null}
      </section>
    </CourseManagementFrame>
  );
}
