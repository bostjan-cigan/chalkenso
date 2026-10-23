import { CurriculumVersionStatus } from '@prisma/client';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import AdminBadge from '../../components/ui/AdminBadge';
import AdminCard from '../../components/ui/AdminCard';
import type { CourseVersionSummary } from '../versions/data';
import VersionDeleteButton from './VersionDeleteButton';
import styles from '../../admin.module.css';

interface CourseVersionsSectionProps {
  courseId: string;
  versions: CourseVersionSummary[];
  /** How many groups' copies were made from each version (they keep it from being deleted). */
  forkCounts: Map<string, number>;
  /** Delete draft versions nobody uses. */
  canEdit?: boolean;
  canDelete?: boolean;
}

/**
 * A course's versions, each opening in the Lessons tab; a draft nobody uses can be deleted from its
 * "⋯" menu. The groups' copies and what they suggest are on the course's Groups tab.
 */
export default async function CourseVersionsSection({
  courseId,
  versions,
  forkCounts,
  canEdit = true,
  canDelete: canDeleteVersions = true,
}: CourseVersionsSectionProps) {
  const t = await getTranslations('courses.versions');
  if (versions.length === 0) {
    return (
      <div className={styles.emptyState}>
        <h3 className={styles.emptyStateTitle}>{t('emptyTitle')}</h3>
        <p className={styles.emptyStateText}>{t('emptyText')}</p>
      </div>
    );
  }
  /** Its lessons, the groups that read it, and the groups' copies made from it. */
  const versionMeta = (version: CourseVersionSummary, copies: number) =>
    [
      t('lessons', { count: version.lessonCount }),
      version.groupCount ? t('readBy', { count: version.groupCount }) : null,
      copies ? t('copiesMade', { count: copies }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <div className={styles.entityList}>
      {versions.map((version) => {
        const isPublished = version.status === CurriculumVersionStatus.PUBLISHED;
        const copies = forkCounts.get(version.id) ?? 0;
        const canDelete = canEdit && canDeleteVersions && !isPublished && version.groupCount === 0 && copies === 0;
        return (
          <AdminCard key={version.id} variant="compact" className={`${styles.entityRow} ${styles.courseListRow}`}>
            <Link href={`/admin/courses/${courseId}?version=${version.id}`} className={`${styles.entityRowMainLink} ${styles.courseListMainLink}`}>
              <div className={`${styles.entityRowBody} ${styles.courseListBody}`}>
                <div className={styles.courseListTitleRow}>
                  <h3 className={styles.courseListTitle}>
                    {version.label}
                    <AdminBadge variant={isPublished ? 'accent' : 'warning'} className={styles.inlineBadgeSpacing}>
                      {isPublished ? t('published') : t('draft')}
                    </AdminBadge>
                  </h3>
                  <span className={styles.fieldHint}>{versionMeta(version, copies)}</span>
                </div>
              </div>
            </Link>
            {canDelete ? (
              <div className={`${styles.entityRowActions} ${styles.courseListActions}`}>
                <VersionDeleteButton courseId={courseId} versionId={version.id} versionLabel={version.label} inMenu />
              </div>
            ) : null}
          </AdminCard>
        );
      })}
    </div>
  );
}
