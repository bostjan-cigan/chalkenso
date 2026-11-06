'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { FeedbackOutcome } from '@/lib/curriculum-comments';

/** Opens a note on the page: its lesson opens and scrolls into view, and the note's popover opens. */
export const OPEN_NOTE_EVENT = 'chalkenso:open-note';
export type OpenNoteDetail = { lessonId: string; commentId: string };

/** The note last asked for, for a lesson whose comments only mount once it has opened. */
let asked: OpenNoteDetail | null = null;
export function askedNote(lessonId: string): string | null {
  return asked?.lessonId === lessonId ? asked.commentId : null;
}

/**
 * On someone's next visit, one line on what happened to their feedback since they last looked:
 * "2 of your notes changed the lesson · 1 got a reply". Each opens into its notes, and each note
 * opens on its lesson (with its status and the reply). Seen once it shows: the line is gone next time.
 */
export default function FeedbackOutcomes({ token, items, lessons }: { token: string; items: FeedbackOutcome[]; lessons: Array<{ id: string; position: number }> }) {
  const t = useTranslations('learner.outcomes');
  const [open, setOpen] = useState<'changed' | 'replied' | null>(null);
  useEffect(() => {
    void fetch('/api/access/outcomes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }).catch(() => undefined);
  }, [token]);
  const changed = items.filter((item) => item.outcome === 'changed');
  const replied = items.filter((item) => item.outcome === 'replied');
  const position = new Map(lessons.map((lesson) => [lesson.id, lesson.position]));
  const show = (item: FeedbackOutcome) => {
    asked = { lessonId: item.lessonId, commentId: item.id };
    window.dispatchEvent(new CustomEvent<OpenNoteDetail>(OPEN_NOTE_EVENT, { detail: asked }));
  };
  const list = open === 'changed' ? changed : open === 'replied' ? replied : [];
  return (
    <section className="alc-outcomes" aria-label={t('label')} data-testid="feedback-outcomes">
      <p className="alc-outcomes-line">
        {changed.length ? (
          <button type="button" className="alc-outcomes-count" aria-expanded={open === 'changed'} onClick={() => setOpen(open === 'changed' ? null : 'changed')} data-testid="outcomes-changed">
            {t('changed', { count: changed.length })}
          </button>
        ) : null}
        {changed.length && replied.length ? ' · ' : null}
        {replied.length ? (
          <button type="button" className="alc-outcomes-count" aria-expanded={open === 'replied'} onClick={() => setOpen(open === 'replied' ? null : 'replied')} data-testid="outcomes-replied">
            {t('replied', { count: replied.length })}
          </button>
        ) : null}
      </p>
      {list.length ? (
        <ul className="alc-outcomes-list">
          {list.map((item) => (
            <li key={item.id}>
              <button type="button" className="alc-outcomes-note" onClick={() => show(item)} data-testid="outcomes-note">
                {t('lesson', { position: position.get(item.lessonId) ?? 0 })} · “{item.quote}”
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
