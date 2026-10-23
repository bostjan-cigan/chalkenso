import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { lessonWork, type ImprovementRow, type LessonWork, type NewFeedbackLesson } from './data';
import PublishLessonsButton from './PublishLessonsButton';
import styles from './improvements.module.css';

/** The improvements still being worked on, for a count next to the list's name. */
export const openImprovements = (rows: ImprovementRow[]) => rows.filter((row) => row.status === 'TODO' || row.status === 'IN_PROGRESS').length;

/**
 * A group's (or a course's) improvements, summed up by lesson: one row per lesson with what waits
 * there and its one next step (Review, Decide, Plan, Update plan, Draft, Improve or Publish). The work itself happens in the
 * lesson's Improve mode, which the row opens. Under them, quieter, Done: the finished improvements,
 * each saying whether learners see what it changed. Above both, the lessons saved with changes
 * learners don't see yet, with one button to publish them. One list, no filters: the Feedback
 * tab's own New / Improvements / Done is the only switch.
 */
export default async function ImprovementsList({
  rows,
  feedback,
  boardHref,
}: {
  rows: ImprovementRow[];
  /** New feedback per lesson that no improvement covers yet. */
  feedback: NewFeedbackLesson[];
  boardHref: string | null;
}) {
  const [t, tRecord, locale] = await Promise.all([getTranslations('tasks.improvements'), getTranslations('tasks.record'), getLocale() as Promise<Locale>]);
  const lessons = lessonWork(rows, feedback);
  // Places are named only when the list mixes them (the main course's lessons and a group's copy),
  // under the lesson's name so the name always shows first.
  const mixed = new Set(lessons.map((lesson) => lesson.copyOf)).size > 1;
  const place = (lesson: LessonWork) => (mixed ? (lesson.copyOf ? t('copyOf', { group: lesson.copyOf }) : t('mainCourse')) : null);
  const done = rows.filter((row) => row.status === 'DONE').slice(0, 50);
  const unpublished = Array.from(new Set(rows.flatMap((row) => row.path?.unpublishedLessonIds ?? [])));
  const date = (iso: string) => new Date(iso).toLocaleDateString(INTL_LOCALES[locale], { day: 'numeric', month: 'short' });

  // What waits in a lesson, in one quiet line.
  const line = (lesson: LessonWork) =>
    [
      place(lesson),
      lesson.mine ? t('work.yours') : null,
      // One improvement per lesson: what it uses; several (made before), how many.
      lesson.improvements > 1 ? t('work.improvements', { count: lesson.improvements }) : lesson.used ? t('work.used', { count: lesson.used }) : null,
      lesson.toReview ? t('work.toReview', { count: lesson.toReview }) : null,
      lesson.plansToWrite ? t('work.plans', { count: lesson.plansToWrite }) : null,
      lesson.plansToUpdate ? t('work.plansToUpdate', { count: lesson.plansToUpdate }) : null,
      lesson.plansReady && !lesson.toReview ? t('work.plansReady', { count: lesson.plansReady }) : null,
      lesson.writing ? t('work.writing') : null,
      lesson.newFeedback ? t('work.feedback', { count: lesson.newFeedback }) : null,
      lesson.unpublished ? t('work.unpublished') : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const action = (lesson: LessonWork) => {
    if (lesson.next.kind === 'publish') {
      return (
        <PublishLessonsButton
          lessonIds={[lesson.lessonId]}
          buttonClassName={styles.cta}
          words={{
            button: t('cta.publish'),
            title: t('publishTitle', { count: 1 }),
            description: t('publishDescription'),
            confirm: t('publishConfirm'),
            cancel: t('cancel'),
          }}
        />
      );
    }
    return lesson.next.href ? (
      <Link href={lesson.next.href} className={styles.cta} data-testid="lesson-cta">
        {t(`cta.${lesson.next.kind}`)}
      </Link>
    ) : null;
  };

  // A finished one in plain words: whether learners see what it changed.
  const outcome = (row: ImprovementRow) =>
    row.outcome?.state === 'seen'
      ? tRecord('statusSeen', { date: date(row.outcome.since ?? new Date().toISOString()) })
      : row.outcome?.state === 'draft'
        ? tRecord('statusDraft')
        : row.outcome?.state === 'waiting'
          ? tRecord('statusWaiting')
          : t('doneNoChange');

  return (
    <div className={styles.list} data-testid="improvements">
      {unpublished.length > 1 ? (
        <div className={styles.publishBar} data-testid="publish-bar">
          <span>{t('publishBar', { count: unpublished.length })}</span>
          <PublishLessonsButton
            lessonIds={unpublished}
            words={{
              button: t('publishButton', { count: unpublished.length }),
              title: t('publishTitle', { count: unpublished.length }),
              description: t('publishDescription'),
              confirm: t('publishConfirm'),
              cancel: t('cancel'),
            }}
          />
        </div>
      ) : null}

      {lessons.length ? (
        <ul className={styles.lessonRows}>
          {lessons.map((lesson) => {
            const body = (
              <span className={styles.lessonText}>
                <span className={styles.lessonTitle}>{lesson.label}</span>
                <span className={styles.lessonLine}>{line(lesson)}</span>
              </span>
            );
            return (
              <li key={lesson.lessonId} className={styles.lessonRow} data-testid="lesson-work" data-next={lesson.next.kind}>
                {lesson.href ? (
                  <Link href={lesson.href} className={styles.lessonMain}>
                    {body}
                  </Link>
                ) : (
                  <div className={styles.lessonMain}>{body}</div>
                )}
                <span className={styles.lessonAction}>{action(lesson)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.empty}>{t('empty')}</p>
      )}

      {done.length ? (
        <section className={styles.doneSection} data-testid="improvements-done">
          <h3 className={styles.sectionHead}>{t('doneTitle')}</h3>
          <ul className={styles.lessonRows}>
            {done.map((row) => (
              <li key={row.id} className={styles.lessonRow} data-testid="improvement-row">
                {/* Opens it in its lesson's Improve mode, on What changed. */}
                <Link href={row.workHref} className={styles.lessonMain}>
                  <span className={styles.lessonText}>
                    <span className={styles.lessonTitle}>{row.label}</span>
                    <span className={styles.lessonLine}>
                      {row.lessons.length === 1
                        ? t('lesson', { position: row.lessons[0].position, title: row.lessons[0].title })
                        : row.lessons.length
                          ? t('lessons', { positions: row.lessons.map((lesson) => lesson.position).join(', ') })
                          : t('noLesson')}
                      {' · '}
                      <span data-testid="improvement-outcome" data-state={row.outcome?.state}>
                        {outcome(row)}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {boardHref ? (
        <p className={styles.board}>
          <Link href={boardHref}>{t('openBoard')}</Link>
        </p>
      ) : null}
    </div>
  );
}
