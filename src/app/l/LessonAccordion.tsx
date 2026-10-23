'use client';

import { useTranslations } from 'next-intl';
import { useState, type MouseEvent } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import LoadingFillCircle from '@/components/LoadingFillCircle';
import { lessonAnchorId } from '@/lib/lesson-wikilinks';
import { cn } from '@/utils/cn';
import LessonContentHtml from './components/LessonContentHtml';
import LessonCommentLayer, { type LessonCommentView } from './components/LessonCommentLayer';
import type { ArcGroup } from './components/CourseAccessView';
import { buildLessonRequest, type LessonSource } from './components/lesson-source';
import { learnerUi } from '@/extensions/learner';
import styles from './access.module.css';

/**
 * Enables Medium-style margin comments on each lesson. `viewer` = a personal access-link holder who
 * can add + see their own comments; `admin` = the version preview, showing all comments read-only
 * with links out to triage. `null`/absent leaves the lesson content untouched.
 */
export type LessonCommenting =
  | {
      role: 'viewer';
      token: string;
      proposerName: string;
      /** Team members annotate through `/api/team/*` (session) instead of an access link. */
      api?: { comment: string; note: string };
      feedbackCopy?: { label: string; placeholder: string; submit: string };
      /** False hides adding feedback (instructor notes) for read-only team members; default true. */
      canComment?: boolean;
    }
  | {
      role: 'admin';
      courseId: string;
      versionId: string;
      commentsByLessonId: Record<string, LessonCommentView[]>;
    };

interface LessonAccordionItem {
  id: string;
  position: number;
  title: string;
  shortDescription?: string | null;
}

interface LessonAccordionProps {
  /** Lessons with no arc; rendered as a flat list above the arc sections. */
  lessons: LessonAccordionItem[];
  /** Optional arc sections in display order, each with its assigned lessons. */
  arcGroups?: ArcGroup[];
  source: LessonSource;
  /** Optional Medium-style margin commenting; absent leaves lessons read-only. */
  commenting?: LessonCommenting | null;
  /** Show the edition's learner signals around each lesson (personal learner links only). */
  signals?: boolean;
}

type LoadedLessonState = {
  error: string | null;
  html: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
};

export default function LessonAccordion({
  lessons,
  arcGroups = [],
  source,
  commenting = null,
  signals = false,
}: LessonAccordionProps) {
  const t = useTranslations('learner.lessons');
  const [openLessonIds, setOpenLessonIds] = useState<string[]>([]);
  const [loadedLessonsById, setLoadedLessonsById] = useState<
    Record<string, LoadedLessonState>
  >({});

  async function loadLessonIfNeeded(lessonId: string) {
    const currentLessonState = loadedLessonsById[lessonId];

    if (
      currentLessonState?.status === 'loading' ||
      currentLessonState?.status === 'ready'
    ) {
      return;
    }

    setLoadedLessonsById((currentLessons) => ({
      ...currentLessons,
      [lessonId]: {
        error: null,
        html: null,
        status: 'loading',
      },
    }));

    try {
      const request = buildLessonRequest(source, lessonId);
      const response = await fetch(request.url, {
        cache: 'no-store',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request.body),
      });

      if (!response.ok) {
        throw new Error('Unable to load lesson content.');
      }

      const payload = (await response.json()) as {
        lesson?: {
          html: string;
        };
      };

      if (!payload.lesson?.html) {
        throw new Error('Lesson content is unavailable.');
      }

      setLoadedLessonsById((currentLessons) => ({
        ...currentLessons,
        [lessonId]: {
          error: null,
          html: payload.lesson?.html ?? null,
          status: 'ready',
        },
      }));
    } catch {
      setLoadedLessonsById((currentLessons) => ({
        ...currentLessons,
        [lessonId]: {
          error: t('loadError'),
          html: null,
          status: 'error',
        },
      }));
    }
  }

  function toggleLesson(lessonId: string) {
    const willOpen = !openLessonIds.includes(lessonId);

    setOpenLessonIds((currentLessonIds) =>
      currentLessonIds.includes(lessonId)
        ? currentLessonIds.filter((currentId) => currentId !== lessonId)
        : [...currentLessonIds, lessonId]
    );

    if (willOpen) {
      void loadLessonIfNeeded(lessonId);
    }
  }

  /** Links to other lessons (from `[[wikilinks]]`) open that lesson and scroll to it. */
  function handleLessonLinkClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as Element | null)?.closest?.('a[data-lesson-link]');
    const lessonId = link?.getAttribute('data-lesson-link');

    if (!lessonId || event.defaultPrevented || event.metaKey || event.ctrlKey) {
      return;
    }

    event.preventDefault();

    if (!openLessonIds.includes(lessonId)) {
      toggleLesson(lessonId);
    }

    requestAnimationFrame(() => {
      document
        .getElementById(lessonAnchorId(lessonId))
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const { LessonTag, LessonStart, LessonContent, LessonEnd } = learnerUi;

  function renderLesson(lesson: LessonAccordionItem) {
    const isOpen = openLessonIds.includes(lesson.id);
    const contentId = `lesson-content-${lesson.id}`;
    const loadedLesson = loadedLessonsById[lesson.id];
    const ready = loadedLesson?.status === 'ready' && Boolean(loadedLesson.html);

    return (
      <li
        key={lesson.id}
        id={lessonAnchorId(lesson.id)}
        className={cn(styles.lessonRow, isOpen && styles.lessonRowOpen)}
      >
        <button
          type="button"
          className={styles.lessonRowButton}
          aria-controls={contentId}
          aria-expanded={isOpen}
          onClick={() => toggleLesson(lesson.id)}
        >
          <span className={styles.lessonNumber}>{String(lesson.position).padStart(2, '0')}</span>
          <span className={styles.lessonText}>
            <span className={styles.lessonTitle}>
              {lesson.title}
              {signals && LessonTag ? <LessonTag lessonId={lesson.id} /> : null}
            </span>
            {lesson.shortDescription ? (
              <span className={styles.lessonDescription}>{lesson.shortDescription}</span>
            ) : null}
          </span>
          <FiChevronDown className={styles.lessonChevron} aria-hidden />
        </button>

        {isOpen ? (
          <div id={contentId} className={styles.lessonBody}>
            {signals && ready && LessonStart ? <LessonStart lessonId={lesson.id} /> : null}
            {loadedLesson?.status === 'ready' && loadedLesson.html ? (
              signals && LessonContent ? (
                <LessonContent lessonId={lesson.id}>{renderContent(lesson.id, loadedLesson.html)}</LessonContent>
              ) : (
                renderContent(lesson.id, loadedLesson.html)
              )
            ) : loadedLesson?.status === 'error' ? (
              <p className={styles.lessonError}>{loadedLesson.error}</p>
            ) : (
              <LoadingFillCircle
                centered
                ariaLabel={t('loading')}
                className={styles.lessonLoading}
              />
            )}
            {signals && ready && LessonEnd ? <LessonEnd lessonId={lesson.id} /> : null}
          </div>
        ) : null}
      </li>
    );
  }

  function renderContent(lessonId: string, html: string) {
    return commenting ? (
      <LessonCommentLayer
        html={html}
        lessonId={lessonId}
        mode={
          commenting.role === 'viewer'
            ? {
                kind: 'viewer',
                token: commenting.token,
                proposerName: commenting.proposerName,
                api: commenting.api,
                feedbackCopy: commenting.feedbackCopy,
                canComment: commenting.canComment,
              }
            : {
                kind: 'admin',
                comments: commenting.commentsByLessonId[lessonId] ?? [],
                inboxHref: `/admin/courses/comments/${commenting.versionId}`,
                lessonEditHref: `/admin/courses/${commenting.courseId}/lessons/${lessonId}`,
              }
        }
      />
    ) : (
      <LessonContentHtml html={html} />
    );
  }

  // Only show arc sections that actually have lessons assigned.
  const visibleArcGroups = arcGroups.filter((arc) => arc.lessons.length > 0);

  // Same outline as the course page on /courses: numbered rows, arcs as plain headings.
  return (
    <section className={styles.outline} onClick={handleLessonLinkClick}>
      {lessons.length > 0 ? <ol className={styles.lessons}>{lessons.map(renderLesson)}</ol> : null}

      {visibleArcGroups.map((arc) => (
        <section key={arc.id} className={styles.arc}>
          <h2>{arc.title}</h2>
          {arc.description ? <p className={styles.arcDescription}>{arc.description}</p> : null}
          <ol className={styles.lessons}>{arc.lessons.map(renderLesson)}</ol>
        </section>
      ))}
    </section>
  );
}
