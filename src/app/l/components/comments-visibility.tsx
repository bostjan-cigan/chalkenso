'use client';

import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import './lesson-comments.css';

/** The two annotation kinds a reader can leave on a passage. */
export type AnnotationKind = 'comment' | 'note';

export type AnnotationCounts = Record<AnnotationKind, number>;

const ZERO_COUNTS: AnnotationCounts = { comment: 0, note: 0 };

type AnnotationVisibilityValue = {
  /** Whether each kind's highlights + gutter bubbles are shown across all lessons. */
  visible: Record<AnnotationKind, boolean>;
  toggle: (kind: AnnotationKind) => void;
  /** Show a kind because the reader just added to it — writing something then losing sight of it is
   * disorienting, and notes in particular are the reader's own working material. */
  reveal: (kind: AnnotationKind) => void;
  /** Totals across every mounted lesson, so each toggle only appears when it has something to hide. */
  counts: AnnotationCounts;
  /** Lessons report how many of each kind they've loaded; a lesson reports zeroes as it unmounts. */
  reportCount: (lessonId: string, counts: AnnotationCounts) => void;
};

const AnnotationVisibilityContext = createContext<AnnotationVisibilityValue>({
  visible: { comment: false, note: false },
  toggle: () => undefined,
  reveal: () => undefined,
  counts: ZERO_COUNTS,
  reportCount: () => undefined,
});

export function useAnnotationVisibility() {
  return useContext(AnnotationVisibilityContext);
}

const EYE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EYE_OFF_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.5 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

/** Leading glyph on the notes row, so the two rows read apart at a glance. */
const PENCIL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

/** The collapsed circle icon — a chat bubble to signal "feedback and notes". */
const CHAT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

/**
 * Provides one shared annotation-visibility state to every lesson on the page, and renders a single
 * fixed floating toggle (bottom-right) with a row per kind. Both kinds start hidden. On a personal
 * link (`kinds`) the toggle is always there, with a row for each kind the link can leave, so the
 * reader decides what to show from the start; elsewhere only kinds with anything loaded get a row.
 */
export default function CommentsVisibilityProvider({
  children,
  kinds = null,
}: {
  children: ReactNode;
  /** What this personal link can leave on a passage; null: not a personal link. */
  kinds?: Record<AnnotationKind, boolean> | null;
}) {
  const t = useTranslations('learner.annotations');
  const [visible, setVisible] = useState<Record<AnnotationKind, boolean>>({
    comment: false,
    note: false,
  });
  const [counts, setCounts] = useState<AnnotationCounts>(ZERO_COUNTS);
  const [menuOpen, setMenuOpen] = useState(false);
  const countsByLesson = useRef<Map<string, AnnotationCounts>>(new Map());
  const fabRef = useRef<HTMLDivElement>(null);

  const reportCount = useCallback((lessonId: string, lessonCounts: AnnotationCounts) => {
    countsByLesson.current.set(lessonId, lessonCounts);
    const sum: AnnotationCounts = { comment: 0, note: 0 };
    countsByLesson.current.forEach((entry) => {
      sum.comment += entry.comment;
      sum.note += entry.note;
    });
    setCounts(sum);
  }, []);

  const toggle = useCallback((kind: AnnotationKind) => {
    setVisible((current) => ({ ...current, [kind]: !current[kind] }));
  }, []);

  const reveal = useCallback((kind: AnnotationKind) => {
    setVisible((current) => (current[kind] ? current : { ...current, [kind]: true }));
  }, []);

  const value = useMemo<AnnotationVisibilityValue>(
    () => ({ visible, toggle, reveal, counts, reportCount }),
    [visible, toggle, reveal, counts, reportCount]
  );

  // Close the speed-dial on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const rows: Record<AnnotationKind, boolean> = {
    comment: Boolean(kinds?.comment) || counts.comment > 0,
    note: Boolean(kinds?.note) || counts.note > 0,
  };

  return (
    <AnnotationVisibilityContext.Provider value={value}>
      {children}
      {rows.comment || rows.note ? (
        <div className="alc-fab-wrap" ref={fabRef}>
          {menuOpen ? (
            <div className="alc-fab-menu" role="menu">
              {rows.comment ? (
                <button
                  type="button"
                  role="menuitem"
                  className="alc-fab-action"
                  onClick={() => {
                    toggle('comment');
                    setMenuOpen(false);
                  }}
                >
                  {visible.comment ? EYE_OFF_ICON : EYE_ICON}
                  {visible.comment ? t('hideFeedback') : t('showFeedback')}
                </button>
              ) : null}

              {rows.note ? (
                <button
                  type="button"
                  role="menuitem"
                  className="alc-fab-action"
                  data-alc-kind="note"
                  onClick={() => {
                    toggle('note');
                    setMenuOpen(false);
                  }}
                >
                  {visible.note ? EYE_OFF_ICON : EYE_ICON}
                  {visible.note ? t('hideNotes') : t('showNotes')}
                  <span className="alc-fab-kind-glyph" aria-hidden>
                    {PENCIL_ICON}
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            className="alc-fab-circle"
            data-on={visible.comment || visible.note}
            data-notes-on={visible.note}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={t('toggleTitle')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {CHAT_ICON}
          </button>
        </div>
      ) : null}
    </AnnotationVisibilityContext.Provider>
  );
}
