'use client';

import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';
import styles from '../admin.module.css';
import { LEARNING_NOTES } from './learning-notes';

/** Chosen once per page load, in the browser (the server draws the space empty, so both agree). */
let firstIndex: number | null = null;
const pickFirst = () => (firstIndex ??= Math.floor(Math.random() * LEARNING_NOTES.length));
const noSubscription = () => () => {};

/**
 * Beside the sign-in form: a learning quote or bit of trivia in the red-pen hand, like the margin
 * notes on the front page, with "Another one" to draw the next. The notes stay as they were said, in
 * English; only the card's own words follow the page's language.
 */
export default function LearningNoteCard() {
  const t = useTranslations('auth.note');
  const first = useSyncExternalStore(noSubscription, pickFirst, () => null);
  const [step, setStep] = useState(0);
  const note = first === null ? null : LEARNING_NOTES[(first + step) % LEARNING_NOTES.length];

  return (
    <div className={styles.authNote} aria-live="polite">
      {note ? (
        <figure key={note.text} className={styles.authNoteFigure} data-testid="learning-note">
          {note.kind === 'trivia' ? <p className={styles.authNoteLabel}>{t('didYouKnow')}</p> : null}
          {/* `lang`: read out as English on a page in another language. */}
          {note.kind === 'quote' ? (
            <blockquote className={styles.authNoteText} lang="en">“{note.text}”</blockquote>
          ) : (
            <p className={styles.authNoteText} lang="en">{note.text}</p>
          )}
          {note.kind === 'quote' ? <figcaption className={styles.authNoteBy}>— {note.by}</figcaption> : null}
        </figure>
      ) : null}
      <button type="button" className={styles.authNoteNext} onClick={() => setStep((current) => current + 1)} hidden={!note}>
        {t('another')}
      </button>
    </div>
  );
}
