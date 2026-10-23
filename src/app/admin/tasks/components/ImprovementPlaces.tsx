'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import AdminButton from '../../components/ui/AdminButton';
import AdminSearchableSelectField from '../../components/ui/AdminSearchableSelectField';
import { addImprovementLessonAction, leaveCourseAsItIsAction, moveTaskAction, removeImprovementLessonAction } from '../actions';
import type { ImprovementMove } from '@/lib/task-flow';

export type PlaceLesson = { id: string; position: number; title: string; href: string; saved: boolean };

const rowStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: '0.35rem 0.75rem',
  minHeight: 44,
  borderBottom: '1px solid rgba(var(--foreground-rgb), 0.08)',
};

const quietButton = {
  minHeight: 44,
  border: 0,
  padding: '0 0.25rem',
  background: 'none',
  color: 'rgba(var(--foreground-rgb), 0.65)',
  font: 'inherit',
  fontSize: '0.84rem',
  cursor: 'pointer',
};

/**
 * The lessons an improvement changes, on its page: each one (to open it with the plan), "Add a
 * lesson" from the same course or group copy, and taking one back out (not its last one, nor one
 * already saved). For a group's improvement that also changes the main course: "Leave the main
 * course as it is". Each change shows at once; a move it causes comes with Undo.
 */
export default function ImprovementPlaces({
  taskId,
  lessons,
  addable,
  canWork,
  toCourse,
}: {
  taskId: string;
  lessons: PlaceLesson[];
  /** Lessons of the same course or copy it doesn't change yet. */
  addable: Array<{ id: string; position: number; title: string }>;
  canWork: boolean;
  /** Its plan takes it to the main course too (and the course's part hasn't been handed over). */
  toCourse: boolean;
}) {
  const t = useTranslations('tasks.detail.places');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState('');
  const [message, setMessage] = useState<{ text: string; moved?: ImprovementMove | null } | null>(null);

  const run = (work: () => Promise<{ text: string; moved?: ImprovementMove | null } | null>) =>
    startTransition(async () => {
      const next = await work();
      setMessage(next);
      router.refresh();
    });

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} aria-label={t('lessonsLabel')} data-testid="improvement-lessons">
        {lessons.map((lesson) => (
          <li key={lesson.id} style={rowStyle}>
            <Link href={lesson.href} style={{ color: 'rgb(var(--accent-color))', fontWeight: 500, textDecoration: 'none' }}>
              {t('lesson', { position: lesson.position, title: lesson.title })}
            </Link>
            {lesson.saved ? <span style={{ fontSize: '0.82rem', opacity: 0.6 }}>{t('saved')}</span> : null}
            {canWork && lessons.length > 1 && !lesson.saved ? (
              <button
                type="button"
                style={{ ...quietButton, marginLeft: 'auto' }}
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await removeImprovementLessonAction(taskId, lesson.id);
                    return result.ok ? { text: t('removed', { position: lesson.position }), moved: result.moved } : null;
                  })
                }
              >
                {t('remove')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {canWork && addable.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.5rem' }}>
          <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
            <AdminSearchableSelectField
              id={`improvement-add-${taskId}`}
              name="lessonId"
              label={t('addLabel')}
              options={addable.map((lesson) => ({ value: lesson.id, label: t('lesson', { position: lesson.position, title: lesson.title }) }))}
              value={adding}
              onValueChange={setAdding}
              placeholder={t('addPlaceholder')}
              searchable={addable.length > 8}
              compact
            />
          </div>
          <AdminButton
            type="button"
            size="compact"
            tone="secondary"
            disabled={!adding || pending}
            onClick={() =>
              run(async () => {
                const lesson = addable.find((candidate) => candidate.id === adding);
                const result = await addImprovementLessonAction(taskId, adding);
                setAdding('');
                return result.ok && lesson ? { text: t('added', { position: lesson.position }) } : null;
              })
            }
          >
            {t('add')}
          </AdminButton>
        </div>
      ) : null}

      {canWork && toCourse ? (
        <div style={{ display: 'grid', gap: '0.35rem', justifyItems: 'start' }}>
          <AdminButton
            type="button"
            size="compact"
            tone="secondary"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await leaveCourseAsItIsAction(taskId);
                return { text: t('leftCourse'), moved: result.moved };
              })
            }
          >
            {t('leaveCourse')}
          </AdminButton>
          <span style={{ fontSize: '0.82rem', opacity: 0.65 }}>{t('leaveCourseHint')}</span>
        </div>
      ) : null}

      {message ? (
        <p style={{ margin: 0, opacity: 0.75 }} role="status">
          {message.text}
          {message.moved ? (
            <>
              {' '}
              {t('moved', { title: message.moved.title })}{' '}
              <button
                type="button"
                style={{ ...quietButton, minHeight: 0, padding: 0, color: 'rgb(var(--accent-color))', textDecoration: 'underline' }}
                onClick={() => {
                  const moved = message.moved;
                  if (!moved) return;
                  setMessage(null);
                  void moveTaskAction(moved.taskId, moved.from).then(() => router.refresh());
                }}
              >
                {t('undo')}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
