'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { TbX } from 'react-icons/tb';
import { transformObsidianCallouts } from '@/lib/content/callouts';
import { renderCourseMarkdownToHtml } from '@/lib/markdown';
import { resolveLessonMarkdownAssetUrls } from '@/lib/course-markdown';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import type { ChangeState, ProposedChange, RevisionCheck, RevisionCheckKey } from './revision';
import styles from './workspace.module.css';

/** Keep (the change goes in; for a conflict, the proposal replaces yours) or skip it. */
export type ChangeDecision = 'keep' | 'skip';

/** The checks that can fail, each with a sentence for the review. */
type ProblemKey = Exclude<RevisionCheckKey, 'headingsKept' | 'codeKept' | 'imagesAndLinksKept' | 'sameLength'>;

const when = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleString(INTL_LOCALES[locale], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Changes that still need a decision: ones already in the text, or with nowhere to go, don't. */
export const actionable = (state: ChangeState | undefined) => state === 'clean' || state === 'conflict';

/** Paragraphs as learners see them (the learner pages' renderer, so callouts and code look right): new, or struck out. */
export function Preview({ blocks, assets, removed = false }: { blocks: string[]; assets: Map<string, string>; removed?: boolean }) {
  const html = renderCourseMarkdownToHtml(resolveLessonMarkdownAssetUrls(blocks.join('\n\n'), assets), {
    hastTransforms: [transformObsidianCallouts],
  });
  return (
    <div
      className={`${styles.prose} ${removed ? styles.changePreviewRemoved : styles.changePreview}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** What changes, word by word: removed words struck through, new ones marked. */
export function ChangeText({ change }: { change: ProposedChange }) {
  if (change.kind === 'edit' && change.words) {
    return (
      <p className={styles.changeText}>
        {change.words.map((word, index) =>
          word.kind === 'same' ? (
            <span key={index}>{word.text}</span>
          ) : word.kind === 'removed' ? (
            <del key={index} className={styles.wordRemoved}>
              {word.text}
            </del>
          ) : (
            <ins key={index} className={styles.wordAdded}>
              {word.text}
            </ins>
          )
        )}
      </p>
    );
  }
  return (
    <div className={styles.changeText}>
      {change.before.map((block, index) => (
        <del key={`b${index}`} className={`${styles.wordRemoved} ${styles.changeBlock}`}>
          {block}
        </del>
      ))}
      {change.after.map((block, index) => (
        <ins key={`a${index}`} className={`${styles.wordAdded} ${styles.changeBlock}`}>
          {block}
        </ins>
      ))}
    </div>
  );
}

/**
 * Proposed changes, beside the lesson: what a draft would change, one change at a time, word by
 * word, each kept or skipped. Nothing in the lesson changes until Apply; the lesson next to it is
 * read-only meanwhile and shows where the focused change goes. Close keeps the draft waiting;
 * Discard drops it. Keys work inside the sheet only (↑ ↓ move, Space keeps or skips, Esc closes),
 * so nothing applies by accident.
 */
export default function ProposedChanges({
  changes,
  states,
  decisions,
  onDecide,
  focusedId,
  onFocus,
  summary,
  meta,
  failed,
  assets,
  onApply,
  onDiscard,
  onClose,
}: {
  changes: ProposedChange[];
  states: Record<string, ChangeState>;
  decisions: Record<string, ChangeDecision>;
  onDecide: (id: string, decision: ChangeDecision) => void;
  focusedId: string | null;
  onFocus: (id: string) => void;
  /** What the draft does, in a sentence or two (the AI's). */
  summary: string;
  /** Who and when: someone's Claude (and for which task), or drafted here. */
  meta: { kind: 'claude'; by: string | null; at: string; task: string | null } | { kind: 'app'; at: string };
  /** Checks on the whole draft that failed (headings, code, images, length). */
  failed: RevisionCheck[];
  assets: Map<string, string>;
  onApply: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('editor.review');
  const tc = useTranslations('editor.revision');
  const locale = useLocale() as Locale;
  // New and removed paragraphs show as learners see them, an edit as its changed words; each can switch.
  const [switched, setSwitched] = useState<Set<string>>(new Set());
  const cards = useRef(new Map<string, HTMLElement>());

  const open = changes.filter((change) => actionable(states[change.id]));
  const kept = open.filter((change) => decisions[change.id] === 'keep').length;

  // The first change that needs a decision has the focus when the sheet opens.
  useEffect(() => {
    const first = open[0];
    if (first) cards.current.get(first.id)?.focus({ preventScroll: true });
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (step: number) => {
    const index = Math.max(0, changes.findIndex((change) => change.id === focusedId));
    const next = changes[Math.min(changes.length - 1, Math.max(0, index + step))];
    if (next) cards.current.get(next.id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if ((event.target as HTMLElement).closest('[data-change-card]') === null) return;
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === ' ' && focusedId && (event.target as HTMLElement).hasAttribute('data-change-card')) {
      event.preventDefault();
      if (actionable(states[focusedId])) onDecide(focusedId, decisions[focusedId] === 'keep' ? 'skip' : 'keep');
    }
  };

  return (
    <section className={styles.sheet} aria-label={t('title')} data-testid="proposed-changes" onKeyDown={onKeyDown}>
      <header className={styles.sheetHeader}>
        <div className={styles.sheetTitleRow}>
          <h2 className={styles.sheetTitle}>{t('title')}</h2>
          <span className={styles.sheetTag}>{t('notYet')}</span>
          <button type="button" className={styles.sheetClose} onClick={onClose} aria-label={t('close')}>
            <TbX size={18} aria-hidden />
          </button>
        </div>
        <p className={styles.sheetMeta} data-testid="review-from">
          {meta.kind === 'app'
            ? t('fromHere', { when: when(meta.at, locale) })
            : `${meta.by ? t('fromBy', { name: meta.by, when: when(meta.at, locale) }) : t('fromClaude', { when: when(meta.at, locale) })}${
                meta.task ? ` · ${t('forTask', { task: meta.task })}` : ''
              }`}
        </p>
        {summary ? <p className={styles.sheetSummary}>{summary}</p> : null}
        {failed.map((check) => (
          <p key={check.label} className={styles.sheetWarning}>
            {check.problem ? tc(`problems.${check.key as ProblemKey}`, check.values) : tc(`checks.${check.key}`, check.values)}
          </p>
        ))}
      </header>

      {!changes.length ? <p className={styles.sheetEmpty}>{t('nothing')}</p> : !open.length ? <p className={styles.sheetEmpty}>{t('nothingLeft')}</p> : null}

      <ol className={styles.changeList}>
        {changes.map((change, index) => {
          const state = states[change.id] ?? 'clean';
          const decision = decisions[change.id] ?? 'skip';
          const rendered = (change.kind !== 'edit') !== switched.has(change.id);
          return (
            <li
              key={change.id}
              ref={(element) => {
                if (element) cards.current.set(change.id, element);
                else cards.current.delete(change.id);
              }}
              tabIndex={0}
              data-change-card=""
              data-testid="proposed-change"
              data-state={state}
              data-decision={actionable(state) ? decision : undefined}
              className={`${styles.changeCard} ${change.id === focusedId ? styles.changeCardFocused : ''} ${
                actionable(state) && decision === 'skip' ? styles.changeCardSkipped : ''
              }`}
              onFocus={() => onFocus(change.id)}
            >
              <p className={styles.changeHead}>
                <span>
                  {t('position', { index: index + 1, total: changes.length })}
                  {change.section ? ` · ${t('inSection', { section: change.section })}` : ''}
                </span>
                <span className={styles.changeKind}>{t(`kinds.${change.kind}`)}</span>
              </p>
              {rendered ? (
                change.kind === 'remove' ? (
                  <Preview blocks={change.before} assets={assets} removed />
                ) : (
                  <Preview blocks={change.after} assets={assets} />
                )
              ) : (
                <ChangeText change={change} />
              )}
              {state === 'conflict' ? <p className={styles.changeNote}>{t('conflict')}</p> : null}
              {state === 'gone' ? <p className={styles.changeNote}>{t('gone')}</p> : null}
              {state === 'done' ? <p className={styles.changeNote}>{t('done')}</p> : null}
              <div className={styles.changeActions}>
                {actionable(state) ? (
                  <div className={styles.segmented} role="group" aria-label={t('position', { index: index + 1, total: changes.length })}>
                    <button
                      type="button"
                      aria-pressed={decision === 'keep'}
                      className={decision === 'keep' ? styles.segmentActive : styles.segment}
                      onClick={() => onDecide(change.id, 'keep')}
                    >
                      {state === 'conflict' ? t('useProposed') : t('keep')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={decision === 'skip'}
                      className={decision === 'skip' ? styles.segmentActive : styles.segment}
                      onClick={() => onDecide(change.id, 'skip')}
                    >
                      {state === 'conflict' ? t('keepYours') : t('skip')}
                    </button>
                  </div>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() =>
                    setSwitched((current) => {
                      const next = new Set(current);
                      if (next.has(change.id)) next.delete(change.id);
                      else next.add(change.id);
                      return next;
                    })
                  }
                >
                  {rendered ? (change.kind === 'edit' ? t('showChanges') : t('showMarkdown')) : t('preview')}
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <footer className={styles.sheetFooter}>
        <button type="button" className={styles.dangerText} onClick={onDiscard}>
          {t('discard')}
        </button>
        <div className={styles.sheetApply}>
          {open.length && !kept ? <span className={styles.sheetHint}>{t('applyNone')}</span> : null}
          <button type="button" className={styles.primaryButton} onClick={onApply} disabled={!kept} data-testid="apply-changes">
            {kept === open.length ? t('applyAll', { total: kept }) : t('applySome', { count: kept, total: open.length })}
          </button>
        </div>
      </footer>
      {open.length ? <p className={styles.sheetKeys}>{t('keys')}</p> : null}
    </section>
  );
}
