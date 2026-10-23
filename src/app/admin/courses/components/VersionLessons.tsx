import { CurriculumVersionStatus, Permission } from '@prisma/client';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { FiPlus } from 'react-icons/fi';
import AdminBadge from '../../components/ui/AdminBadge';
import AdminButton from '../../components/ui/AdminButton';
import AdminCard from '../../components/ui/AdminCard';
import AdminSectionCard from '../../components/ui/AdminSectionCard';
import { SheetRow, SheetRows } from '../../components/ui/Sheet';
import ArcManagerPanel from './ArcManagerPanel';
import CourseListInfo from './CourseListInfo';
import { courseListMetaGroupStyle } from './courseListShared';
import LessonDeleteButton from './LessonDeleteButton';
import VersionActions from './VersionActions';
import VersionPreviewLinksPanel from './VersionPreviewLinksPanel';
import VersionRenameForm from './VersionRenameForm';
import { listArcsForVersion } from '../arcs/data';
import { getVersionDetail, listPreviewLinksForVersion } from '../versions/data';
import { getPreviewLinkStatus } from '../versions/preview-link-view';
import { formatDateTimeLocalValue } from '@/lib/access-links';
import { accessScope, canEditVersion, canWorkOnFeedback, commentScopeWhere, taskScopeWhere, type CrmViewer } from '@/lib/crm-access';
import { countOpenFeedbackByLesson } from '@/lib/feedback-list';
import { getGroupCurriculumChanges } from '@/lib/group-curricula';
import { hasUnpublishedChanges } from '@/lib/lesson-publishing';
import { prisma } from '@/lib/prisma';
import { TASK_ENTITY_TYPE } from '@/lib/tasks';
import { currentLearnerLinkTemplate } from '@/lib/learner-link-address';
import styles from '../../admin.module.css';

const DEFAULT_PREVIEW_LINK_DAYS = 7;

function getDefaultPreviewExpiryValue() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + DEFAULT_PREVIEW_LINK_DAYS);
  expiry.setSeconds(0, 0);
  return formatDateTimeLocalValue(expiry);
}

/** The version's lessons as `getVersionDetail` loads them. */
export type VersionDetail = NonNullable<Awaited<ReturnType<typeof getVersionDetail>>>;

/**
 * One version's lessons for someone who edits them: the course's own lessons (the course's Lessons
 * tab, a version's page) or a group's copy (the group's Lessons tab). Each lesson shows its open
 * feedback and improvements (Improve opens the lesson's Improvements view, where they're worked
 * through) and, on a copy, whether it differs from the course's; Delete is in each row's "⋯" menu.
 * Below: sharing a preview, sections, and (the course's own) the version's name.
 */
export default async function VersionLessons({
  viewer,
  version,
  selectedLessonId,
  feedbackHref,
  intro,
}: {
  viewer: CrmViewer;
  version: VersionDetail;
  /** The lesson to mark (the one just saved). */
  selectedLessonId?: string;
  /** Where a lesson's open feedback is listed (a group's or course's Feedback tab). */
  feedbackHref?: (lessonId: string) => string;
  /** A line above the lessons (e.g. whose lessons these are). */
  intro?: React.ReactNode;
}) {
  const courseId = version.course.id;
  const versionRef = { id: version.id, courseId, ownerGroupId: version.ownerGroup?.id ?? null };
  const [t, arcs, previewLinks, learnerLinkTemplate, openFeedback, changes] = await Promise.all([
    getTranslations('courses.lessons'),
    listArcsForVersion(version.id),
    listPreviewLinksForVersion(version.id),
    currentLearnerLinkTemplate(),
    countOpenFeedbackByLesson({ AND: [commentScopeWhere(accessScope(viewer, 'comments')), { curriculumVersionId: version.id }] }),
    version.ownerGroup ? getGroupCurriculumChanges(version.id) : null,
  ]);
  const changeByLesson = new Map((changes?.lessons ?? []).map((lesson) => [lesson.id, lesson.change]));
  // Open improvements per lesson, for whoever works on this version's feedback.
  const canImprove = canWorkOnFeedback(viewer, { courseId, groupIds: version.ownerGroup ? [version.ownerGroup.id] : [] }, 'tasks');
  const improvementCounts = canImprove
    ? new Map(
        (
          await prisma.taskEntityLink.groupBy({
            by: ['entityId'],
            where: {
              entityType: TASK_ENTITY_TYPE.lesson,
              entityId: { in: version.lessons.map((lesson) => lesson.id) },
              task: { AND: [taskScopeWhere(accessScope(viewer, 'tasks')), { status: { in: ['TODO', 'IN_PROGRESS'] } }] },
            },
            _count: { _all: true },
          })
        ).map((row) => [row.entityId, row._count._all])
      )
    : new Map<string, number>();
  const canDeleteLessons = canEditVersion(viewer, versionRef, [Permission.DELETE]);
  const canDeleteVersion = version._count.groups === 0 && version.status === CurriculumVersionStatus.DRAFT;
  const versionQuery = `?version=${version.id}`;
  const liveLinks = previewLinks.filter((link) => ['active', 'opened'].includes(getPreviewLinkStatus(link))).length;

  const renderLesson = (lesson: VersionDetail['lessons'][number]) => {
    const pendingRefs = lesson.assetReferences.filter((reference) => !reference.assetId).length;
    const open = openFeedback.get(lesson.id) ?? 0;
    const improving = improvementCounts.get(lesson.id) ?? 0;
    const change = changeByLesson.get(lesson.id);
    const editHref = `/admin/courses/${courseId}/lessons/${lesson.id}${versionQuery}`;
    return (
      <AdminCard
        key={lesson.id}
        variant={lesson.id === selectedLessonId ? 'selected' : 'compact'}
        className={`${styles.entityRow} ${styles.courseListRow}`}
      >
        <Link href={editHref} className={`${styles.entityRowMainLink} ${styles.courseListMainLink}`}>
          <div className={`${styles.entityRowBody} ${styles.courseListBody}`}>
            <div className={styles.courseListTitleRow}>
              <h3 className={styles.courseListTitle}>
                {lesson.position}. {lesson.title}
                <AdminBadge
                  variant={!lesson.publishedAt ? 'warning' : hasUnpublishedChanges(lesson) ? 'muted' : 'accent'}
                  className={styles.inlineBadgeSpacing}
                >
                  {!lesson.publishedAt ? t('draft') : hasUnpublishedChanges(lesson) ? t('publishedWithChanges') : t('published')}
                </AdminBadge>
                {change ? (
                  <AdminBadge variant="muted" className={styles.inlineBadgeSpacing}>
                    {change === 'added' ? t('addedInGroup') : t('changedFromCourse')}
                  </AdminBadge>
                ) : null}
              </h3>
              {open || improving || pendingRefs ? (
                <div style={courseListMetaGroupStyle}>
                  {open ? <CourseListInfo>{t('openFeedback', { count: open })}</CourseListInfo> : null}
                  {improving ? <CourseListInfo>{t('improvementsOpen', { count: improving })}</CourseListInfo> : null}
                  {pendingRefs ? <CourseListInfo>{t('imagesToUpload', { count: pendingRefs })}</CourseListInfo> : null}
                </div>
              ) : null}
            </div>
          </div>
        </Link>

        <div className={`${styles.entityRowActions} ${styles.courseListActions}`}>
          {canImprove && (open || improving) ? (
            <AdminButton href={`/admin/courses/${courseId}/lessons/${lesson.id}/improvements`} tone="plain" size="compact">
              {t('improve')}
            </AdminButton>
          ) : open && feedbackHref ? (
            <AdminButton href={feedbackHref(lesson.id)} tone="plain" size="compact">
              {t('feedback')}
            </AdminButton>
          ) : null}
          <AdminButton href={editHref} tone="plain" size="compact">
            {t('edit')}
          </AdminButton>
          {canDeleteLessons ? <LessonDeleteButton courseId={courseId} lessonId={lesson.id} lessonTitle={lesson.title} inMenu /> : null}
        </div>
      </AdminCard>
    );
  };

  const ungroupedLessons = version.lessons.filter((lesson) => !lesson.arcId);
  const arcGroups = arcs.map((arc) => ({ arc, lessons: version.lessons.filter((lesson) => lesson.arcId === arc.id) }));

  return (
    <>
      <AdminSectionCard
        kicker={t('kicker')}
        title=""
        kickerAction={
          <AdminButton href={`/admin/courses/${courseId}/lessons/new${versionQuery}`} size="compact">
            <FiPlus size={15} />
            {t('add')}
          </AdminButton>
        }
      >
        {intro}
        {version.lessons.length > 0 ? (
          <>
            {ungroupedLessons.length > 0 ? <div className={styles.entityList}>{ungroupedLessons.map(renderLesson)}</div> : null}
            {arcGroups.map(({ arc, lessons }) => (
              <div key={arc.id} className={styles.lessonGroup}>
                <div className={styles.lessonGroupHeading}>
                  <span className={styles.lessonGroupTitle}>{arc.title}</span>
                  <span className={styles.lessonGroupMeta}>{t('count', { count: lessons.length })}</span>
                  {arc.description ? <span className={styles.lessonGroupDescription}>{arc.description}</span> : null}
                </div>
                {lessons.length > 0 ? (
                  <div className={styles.entityList}>{lessons.map(renderLesson)}</div>
                ) : (
                  <p className={styles.helperText}>{t('emptySection')}</p>
                )}
              </div>
            ))}
          </>
        ) : (
          <div className={styles.emptyState}>
            <h3 className={styles.emptyStateTitle}>{t('emptyTitle')}</h3>
            <p className={styles.emptyStateText}>{t('emptyText')}</p>
          </div>
        )}

        {version.ownerGroup ? null : (
          <VersionActions courseId={courseId} versionId={version.id} status={version.status} canDelete={canDeleteVersion} />
        )}
      </AdminSectionCard>

      {/* Set-up used now and then: rows that open sheets, not cards that fold out. */}
      <SheetRows testId="version-setup">
        <SheetRow label={t('sharePreview')} value={liveLinks} testId="share-preview">
          <VersionPreviewLinksPanel
            courseId={courseId}
            versionId={version.id}
            links={previewLinks}
            defaultExpiryValue={getDefaultPreviewExpiryValue()}
            learnerLinkTemplate={learnerLinkTemplate}
          />
        </SheetRow>
        <SheetRow label={t('sections')} value={arcs.length} testId="version-sections">
          <ArcManagerPanel courseId={courseId} versionId={version.id} arcs={arcs} />
        </SheetRow>
        {version.ownerGroup ? null : (
          <SheetRow label={t('versionName')} value={version.label} testId="version-name">
            <VersionRenameForm courseId={courseId} versionId={version.id} label={version.label} />
          </SheetRow>
        )}
      </SheetRows>
    </>
  );
}
