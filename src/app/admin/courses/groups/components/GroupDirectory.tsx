'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FiSearch, FiUsers } from 'react-icons/fi';
import AdminBadge from '@/app/admin/components/ui/AdminBadge';
import AdminCard from '@/app/admin/components/ui/AdminCard';
import CourseListInfo from '../../components/CourseListInfo';
import { groupListMetaGroupStyle } from '../../components/courseListShared';
import GroupDeleteButton from './GroupDeleteButton';
import styles from '../../../admin.module.css';

export type GroupDirectoryRow = {
  id: string;
  name: string;
  courseTitle: string;
  /** "Own copy of v1", "Reads v1" (in the page's language). */
  lessons: string | null;
  dates: string | null;
  learners: number;
  openFeedback: number;
  /** Its instructors' names in a sentence, and how many they are. */
  taughtBy: { names: string; count: number } | null;
  state: 'running' | 'upcoming' | 'finished' | 'undated';
  canDelete: boolean;
  hasOwnCopy: boolean;
};

const SECTIONS: Array<GroupDirectoryRow['state']> = ['running', 'upcoming', 'undated', 'finished'];

/**
 * The groups, by when they run (running now first), each with its course, lessons, dates, learners
 * and open feedback. A search box narrows them when there are many. Delete is in each row's "⋯".
 */
export default function GroupDirectory({ rows }: { rows: GroupDirectoryRow[] }) {
  const t = useTranslations('groups.directory');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => `${row.name} ${row.courseTitle} ${row.taughtBy?.names ?? ''}`.toLowerCase().includes(needle))
    : rows;

  return (
    <div>
      {rows.length > 6 ? (
        <div className={styles.usersToolbarSearchControl} style={{ marginBottom: '1rem' }}>
          <FiSearch aria-hidden className={styles.usersToolbarSearchIcon} />
          <input
            type="search"
            className={styles.textInput}
            placeholder={t('searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('searchLabel')}
          />
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p className={styles.helperText}>{t('noMatch', { query })}</p>
      ) : (
        SECTIONS.map((section) => {
          const sectionRows = shown.filter((row) => row.state === section);
          if (!sectionRows.length) return null;
          return (
            <div key={section} className={styles.lessonGroup} data-testid={`groups-${section}`}>
              <div className={styles.lessonGroupHeading}>
                <span className={styles.lessonGroupTitle}>{t(`sections.${section}`)}</span>
                <span className={styles.lessonGroupMeta}>{sectionRows.length}</span>
              </div>
              <div className={styles.entityList}>
                {sectionRows.map((row) => (
                  <AdminCard key={row.id} variant="compact" className={`${styles.entityRow} ${styles.courseListRow}`}>
                    <Link href={`/admin/courses/groups/${row.id}`} className={`${styles.entityRowMainLink} ${styles.courseListMainLink}`}>
                      <div className={`${styles.entityRowBody} ${styles.courseListBody}`}>
                        <div className={styles.courseListTitleRow}>
                          <h3 className={styles.courseListTitle}>
                            {row.name}
                            {row.openFeedback ? (
                              <AdminBadge variant="accent" className={styles.inlineBadgeSpacing}>
                                {t('openFeedback', { count: row.openFeedback })}
                              </AdminBadge>
                            ) : null}
                          </h3>
                          <div style={groupListMetaGroupStyle}>
                            <CourseListInfo>{row.courseTitle}</CourseListInfo>
                            {row.lessons ? <CourseListInfo>{row.lessons}</CourseListInfo> : null}
                            {row.dates ? <CourseListInfo>{row.dates}</CourseListInfo> : null}
                            <CourseListInfo>
                              <FiUsers size={10} aria-hidden="true" />
                              {t('learners', { count: row.learners })}
                            </CourseListInfo>
                            {row.taughtBy ? <CourseListInfo>{t('taughtBy', row.taughtBy)}</CourseListInfo> : null}
                          </div>
                        </div>
                      </div>
                    </Link>
                    {row.canDelete ? (
                      <div className={`${styles.entityRowActions} ${styles.courseListActions}`}>
                        <GroupDeleteButton groupId={row.id} groupName={row.name} hasGroupCurriculum={row.hasOwnCopy} inMenu />
                      </div>
                    ) : null}
                  </AdminCard>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
