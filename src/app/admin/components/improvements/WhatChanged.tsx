'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { TbChevronRight, TbCircleCheck, TbClockHour4 } from 'react-icons/tb';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { excerpt } from '@/lib/improvement-label';
import type { ImprovementRecord, SavedChangeRecord } from '@/lib/improvement-record';
import CompareSheet from '../../courses/components/workspace/CompareSheet';
import { changeSteps, plainText, stepKind, type ProposedChange } from '../../courses/components/workspace/revision';
import PublishLessonsButton from './PublishLessonsButton';
import styles from './improvements.module.css';

const NO_ASSETS = new Map<string, string>();

/** A step's first words, as a row says them: what went in, or what went out. */
const firstWords = (step: ProposedChange[]) => {
  const shown = step.find((change) => change.after.length) ?? step[0];
  return excerpt(plainText((shown.after.length ? shown.after : shown.before).join('\n\n')) || shown.after.concat(shown.before).join(' '), 90);
};

/**
 * What a finished improvement changed, read-only: per lesson (or group's copy) a row per change
 * (what kind, where, its first words) that opens it side by side (`CompareSheet`), who saved them
 * and when, and whether learners see them yet (with Publish when they don't). Changes still
 * waiting for review elsewhere are listed after.
 */
export default function WhatChanged({
  taskId,
  record,
  hereLessonId = null,
  assets = NO_ASSETS,
}: {
  taskId: string;
  record: ImprovementRecord | null;
  /** The lesson the page is about: called "This lesson". */
  hereLessonId?: string | null;
  assets?: Map<string, string>;
}) {
  const t = useTranslations('tasks.record');
  const locale = useLocale() as Locale;
  // Each save's changes as a reader takes them (a rewrite is one), and the one open side by side.
  const steps = useMemo(() => new Map((record?.saved ?? []).map((saved) => [saved.id, saved.changes ? changeSteps(saved.changes) : []])), [record]);
  const [open, setOpen] = useState<{ saveId: string; index: number } | null>(null);
  const date = (iso: string) => new Date(iso).toLocaleDateString(INTL_LOCALES[locale], { day: 'numeric', month: 'short' });
  const place = (lesson: { lessonId: string; lessonPosition: number; lessonTitle: string; groupName: string | null }) =>
    lesson.lessonId === hereLessonId
      ? t('here')
      : `${t('lesson', { position: lesson.lessonPosition, title: lesson.lessonTitle })} · ${lesson.groupName ? t('copy', { group: lesson.groupName }) : t('course')}`;

  if (!record || (!record.saved.length && !record.waiting.length)) {
    return <p className={styles.recordQuiet}>{t('nothing')}</p>;
  }

  const status = (saved: SavedChangeRecord) => (
    <div className={styles.recordStatus} data-seen={saved.seen ? 'yes' : 'no'} data-testid="record-status">
      {saved.seen ? <TbCircleCheck aria-hidden size={16} /> : <TbClockHour4 aria-hidden size={16} />}
      <span>
        {saved.savedBy ? t('saved', { date: date(saved.savedAt), name: saved.savedBy }) : t('savedNoName', { date: date(saved.savedAt) })}
        {' · '}
        <strong>{saved.seen ? t('seen', { date: date(saved.seenSince ?? saved.savedAt) }) : t('draft')}</strong>
      </span>
      {saved.canPublish ? (
        <PublishLessonsButton
          lessonIds={[saved.lessonId]}
          words={{ button: t('publish'), title: t('publishTitle'), description: t('publishDescription'), confirm: t('publish'), cancel: t('cancel') }}
        />
      ) : null}
    </div>
  );

  // Saves grouped by lesson, in the order they were made: the place is named once per lesson.
  const lessons = Array.from(new Set(record.saved.map((saved) => saved.lessonId)));
  const named = lessons.length > 1 || lessons[0] !== hereLessonId || record.waiting.length > 0;

  return (
    <div className={styles.record} data-testid="what-changed">
      {lessons.map((lessonId) => {
        const saves = record.saved.filter((saved) => saved.lessonId === lessonId);
        return (
          <section key={lessonId} className={styles.recordLesson}>
            {named ? <p className={styles.recordPlace}>{place(saves[0])}</p> : null}
            {saves.map((saved) => (
              <div key={saved.id} className={styles.recordSave}>
                {saved.changes === null ? (
                  <p className={styles.recordQuiet}>{t('notRecorded')}</p>
                ) : (
                  <ul className={styles.recordRows}>
                    {(steps.get(saved.id) ?? []).map((step, index) => (
                      <li key={step[0].id}>
                        <button type="button" className={styles.recordRow} data-kind={stepKind(step)} aria-haspopup="dialog" onClick={() => setOpen({ saveId: saved.id, index })} data-testid="record-change">
                          <span className={styles.recordDot} aria-hidden />
                          <span className={styles.recordKind}>
                            {t(`kinds.${stepKind(step)}`)}
                            {step[0].section ? ` · ${t('section', { section: step[0].section })}` : ''}
                          </span>
                          <span className={styles.recordWords}>{firstWords(step)}</span>
                          <TbChevronRight aria-hidden size={16} className={styles.recordChevron} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {status(saved)}
              </div>
            ))}
          </section>
        );
      })}
      {record.waiting.map((waiting) => (
        <p key={waiting.lessonId} className={styles.recordWaiting}>
          <TbClockHour4 aria-hidden size={16} />
          <span>{t('waiting', { place: place(waiting) })}</span>
          <Link href={`/admin/courses/${waiting.courseId}/lessons/${waiting.lessonId}/improvements?i=${encodeURIComponent(taskId)}`}>{t('review')}</Link>
        </p>
      ))}
      <CompareSheet
        steps={open ? (steps.get(open.saveId) ?? []) : []}
        index={open?.index ?? null}
        onIndex={(index) => setOpen((value) => (value ? { ...value, index } : value))}
        onClose={() => setOpen(null)}
        assets={assets}
      />
    </div>
  );
}
