import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Permission, type Prisma } from '@prisma/client';
import {
  accessScope,
  canEditVersion,
  canPreviewVersion,
  canWorkOnFeedback,
  commentScopeWhere,
  type CrmViewer,
} from '@/lib/crm-access';
import { countFeedback, listFeedback } from '@/lib/feedback-list';
import type { FeedbackRoster } from '@/app/admin/courses/groups/components/LinkFeedbackModal';
import SegmentedControl from '../ui/SegmentedControl';
import FeedbackItem from './FeedbackItem';
import type { FeedbackItemView, FeedbackShow } from './feedback-view';
import styles from './feedback.module.css';

/** How many items a list shows, the newest first (open feedback is rarely more; done piles up). */
const OPEN_SHOWN = 100;
const DONE_SHOWN = 50;

function withParams(base: string, params: Record<string, string | null>) {
  const [path, query = ''] = base.split('?');
  const search = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params)) {
    if (value === null) search.delete(key);
    else search.set(key, value);
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/**
 * Feedback as one list, for a group, a course or a lesson: Open (anything not done yet), To change
 * (the changes being made, as tasks: `changes`), and Done. Each item is a closed card with Reply, Fix
 * the lesson, Make a task and Done (`FeedbackItem`).
 */
export default async function FeedbackList({
  viewer,
  where,
  show,
  baseHref,
  lessonId = null,
  showGroup = false,
  changes = null,
  changeCount = 0,
  emptyText,
  top = null,
  filters = null,
  roster = null,
}: {
  viewer: CrmViewer;
  /** Which feedback (a group's, a course's); limited here to what the viewer may see. */
  where: Prisma.CurriculumCommentWhereInput;
  show: FeedbackShow;
  /** This list's page; the filters add `show` and `lesson` to it. */
  baseHref: string;
  /** Only this lesson's feedback, with its group copies' (`?lesson=`). */
  lessonId?: string | null;
  /** Name each item's group (a course's list mixes them). */
  showGroup?: boolean;
  /** What "To change" shows: the tasks of this group or course. */
  changes?: ReactNode;
  changeCount?: number;
  emptyText: string;
  /** Above the filters (e.g. the message to the group). */
  top?: ReactNode;
  /** Next to Open / To change / Done (e.g. which group). */
  filters?: ReactNode;
  /** A group's roster, when the viewer may put feedback that isn't on its learner's current link on one. */
  roster?: FeedbackRoster | null;
}) {
  const scoped: Prisma.CurriculumCommentWhereInput = {
    // One lesson: its feedback, and its group copies' (insights count them together).
    AND: [commentScopeWhere(accessScope(viewer, 'comments')), where, lessonId ? { OR: [{ lessonId }, { lesson: { baseLessonId: lessonId } }] } : {}],
  };
  const [counts, rows, t] = await Promise.all([
    countFeedback(scoped),
    show === 'change' ? Promise.resolve([]) : listFeedback(scoped, show, { take: show === 'done' ? DONE_SHOWN : OPEN_SHOWN }),
    getTranslations('app.feedback.list'),
  ]);

  const items: FeedbackItemView[] = rows.map((row) => {
    const version = { id: row.versionId, courseId: row.courseId, ownerGroupId: row.copyOfGroupId };
    const editorHref = `/admin/courses/${row.courseId}/lessons/${row.lessonId}`;
    const canEdit = canEditVersion(viewer, version, [Permission.WRITE]);
    return {
      ...row,
      lessonHref: canEdit
        ? editorHref
        : canPreviewVersion(viewer, version)
          ? `/admin/courses/${row.courseId}/versions/${row.versionId}/preview${row.groupId ? `?group=${row.groupId}` : ''}`
          : null,
      improvementsHref: canEdit ? `${editorHref}/improvements` : null,
      copyLabel:
        showGroup && row.copyOfGroupId ? (row.groupName ? t('copyOf', { group: row.groupName }) : t('copyOfUnnamed')) : null,
    };
  });

  // New, Improvements and Done are the list's parts, not filters: a segmented control.
  const segment = (value: FeedbackShow, label: string, count: number | null) => ({
    key: value,
    label,
    count,
    href: withParams(baseHref, { show: value === 'open' ? null : value }),
    active: show === value,
  });

  return (
    <div data-testid="feedback-list">
      {top}
      <div className={styles.filters}>
        <SegmentedControl
          label={t('show')}
          testId="feedback-sections"
          segments={[
            segment('open', t('open'), counts.open),
            ...(changes ? [segment('change', t('change'), changeCount)] : []),
            segment('done', t('done'), counts.done),
          ]}
        />
        {filters ? <div className={styles.filtersEnd}>{filters}</div> : null}
      </div>

      {lessonId ? (
        <p className={styles.note}>
          {t.rich('oneLesson', {
            link: (chunks) => <Link href={withParams(baseHref, { lesson: null, show: show === 'open' ? null : show })}>{chunks}</Link>,
          })}
        </p>
      ) : null}

      {show === 'change' ? (
        changes
      ) : items.length ? (
        <>
          {(show === 'done' ? counts.done : counts.open) > items.length ? (
            <p className={styles.note}>{t('newest', { shown: items.length, total: show === 'done' ? counts.done : counts.open })}</p>
          ) : null}
          <div className={styles.list} data-testid={show === 'done' ? 'resolved-comments' : 'open-comments'}>
            {items.map((item) => {
              const ref = { courseId: item.courseId, groupIds: item.groupIds };
              return (
                <FeedbackItem
                  key={item.id}
                  item={item}
                  canWork={canWorkOnFeedback(viewer, ref)}
                  canDelete={canWorkOnFeedback(viewer, ref, 'comments', [Permission.DELETE])}
                  roster={roster && item.needsLink && item.groupId === roster.groupId ? roster : null}
                />
              );
            })}
          </div>
        </>
      ) : (
        <p className={styles.empty}>{show === 'done' ? t('nothingDone') : emptyText}</p>
      )}
    </div>
  );
}
