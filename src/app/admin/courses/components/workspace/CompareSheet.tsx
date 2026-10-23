'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { TbChevronLeft, TbChevronRight, TbPencil } from 'react-icons/tb';
import AccessLinkModalPortal from '@/app/admin/courses/groups/components/AccessLinkModalPortal';
import modalStyles from '@/app/admin/courses/groups/components/MemberLinkModal.module.css';
import sheetStyles from '@/app/admin/components/ui/Sheet.module.css';
import { transformObsidianCallouts } from '@/lib/content/callouts';
import { resolveLessonMarkdownAssetUrls } from '@/lib/course-markdown';
import { renderCourseMarkdownToHtml } from '@/lib/markdown';
import TextEditor, { type TextEditorHandle } from '../improvements-view/TextEditor';
import { actionable, type ChangeDecision } from './ProposedChanges';
import { renderedDiff } from './rendered-diff';
import { stepKind, type ChangeState, type ProposedChange } from './revision';
import styles from './compare-sheet.module.css';
import workspace from './workspace.module.css';

/** Keeping or skipping changes from the sheet, and rewriting one by hand: present only while reviewing. */
export type CompareReview = {
  states: Record<string, ChangeState>;
  decisionOf: (change: ProposedChange) => ChangeDecision;
  onDecide: (change: ProposedChange, decision: ChangeDecision) => void;
  /** Rewrites a suggestion by hand (its new text, Markdown); it's then kept as written. */
  onEdit?: (change: ProposedChange, text: string) => void;
  isEdited?: (change: ProposedChange) => boolean;
};

const render = (markdown: string, assets: Map<string, string>) =>
  markdown.trim() ? renderCourseMarkdownToHtml(resolveLessonMarkdownAssetUrls(markdown, assets), { hastTransforms: [transformObsidianCallouts] }) : '';

/** A block that is only an image (a diagram a draft adds, say): nothing in it to rewrite by hand. */
const IMAGE_ONLY = /^(?:!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]+\))$/;

/** The new text a step puts in, which Edit rewrites: an edited paragraph's, or the new paragraphs'. */
export const editableOf = (step: ProposedChange[]) => step.find((change) => change.kind !== 'remove') ?? null;

/**
 * One change at a time, the old and the new side by side as learners see them (changed words
 * marked, a paragraph either side, dimmed, to say where it is), ‹ › through all of them. While
 * reviewing, Keep | Skip decides it here (a rewrite's removal and new paragraphs together) and
 * Edit rewrites the new text in place; deciding doesn't move on. Without `review` it's a record.
 */
export default function CompareSheet({
  steps,
  index,
  onIndex,
  onClose,
  contextOf,
  assets,
  review,
  labels,
  actions,
  note: footerNote,
}: {
  steps: ProposedChange[][];
  /** The step shown; null: closed. */
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** The paragraphs around a step in the lesson (Markdown), shown dimmed. */
  contextOf?: (step: ProposedChange[]) => { before: string | null; after: string | null };
  assets: Map<string, string>;
  review?: CompareReview | null;
  /** The columns' names when they aren't the lesson's before and after ("In the Spring group's copy, before"). */
  labels?: { before: string; after: string };
  /** A record's own footer for the step shown (Copy the new text). */
  actions?: (step: ProposedChange[]) => ReactNode;
  /** A quiet line at the footer's start for the step shown (the feedback it answers). */
  note?: (step: ProposedChange[]) => ReactNode;
}) {
  const t = useTranslations('editor.improvements');
  const tUi = useTranslations('app.ui');
  const titleId = useId();
  const open = index !== null && Boolean(steps[index]);
  const step = open ? steps[index] : null;
  // The step whose new text is being rewritten: moving to another step (or closing) leaves it.
  const [editingAt, setEditingAt] = useState<number | null>(null);
  const editing = open && editingAt === index;
  const setEditing = (on: boolean) => setEditingAt(on ? index : null);
  const editor = useRef<TextEditorHandle>(null);

  const shown = useMemo(() => {
    if (!step) return null;
    const removed = step.find((change) => change.kind === 'remove');
    const kind = stepKind(step);
    if (kind === 'edit') {
      const diff = renderedDiff(step[0].before.join('\n\n'), step[0].after.join('\n\n'), assets, { removed: workspace.wordRemoved, added: workspace.wordAdded });
      return { before: diff.before, after: diff.after };
    }
    const added = editableOf(step);
    return { before: removed ? render(removed.before.join('\n\n'), assets) : null, after: added ? render(added.after.join('\n\n'), assets) : null };
  }, [step, assets]);
  const context = useMemo(() => {
    const around = step && contextOf ? contextOf(step) : null;
    return { before: around?.before ? render(around.before, assets) : '', after: around?.after ? render(around.after, assets) : '' };
  }, [step, contextOf, assets]);

  const total = steps.length;
  useEffect(() => {
    if (!open || editing) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, [contenteditable="true"]') || event.metaKey || event.ctrlKey || event.altKey)) return;
      if (event.key === 'ArrowLeft' && index! > 0) onIndex(index! - 1);
      else if (event.key === 'ArrowRight' && index! < total - 1) onIndex(index! + 1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editing, index, total, onIndex]);

  if (!step || !shown) return <AccessLinkModalPortal open={false} onClose={onClose}>{null}</AccessLinkModalPortal>;

  const kind = stepKind(step);
  const states = step.map((change) => review?.states[change.id] ?? 'clean');
  const choosable = review ? step.filter((change, k) => actionable(states[k])) : [];
  const decisions = choosable.map((change) => review!.decisionOf(change));
  const decision = decisions.length && decisions.every((value) => value === decisions[0]) ? decisions[0] : null;
  const conflict = states.includes('conflict');
  const editable = editableOf(step);
  const imageOnly = Boolean(editable?.after.length && editable.after.every((block) => IMAGE_ONLY.test(block.trim())));
  const mine = Boolean(editable && review?.isEdited?.(editable));
  const note = !review ? null : states[0] === 'gone' ? t('gone') : states[0] === 'done' ? t('alreadyIn') : conflict ? t('conflict') : null;
  const where = step[0].section ? ` · ${t('inSection', { section: step[0].section })}` : '';
  const decide = (value: ChangeDecision) => choosable.forEach((change) => review!.onDecide(change, value));
  const quiet = footerNote?.(step) ?? null;
  // The footer's start: the step's note, else room before the buttons at its end.
  const start = quiet ? <p className={styles.footerNote}>{quiet}</p> : <span className={styles.spacer} />;

  const column = (label: string, html: string | null, side: 'before' | 'after', empty: string) => (
    <section className={styles.column} aria-label={label}>
      <h3 className={styles.columnLabel}>{label}</h3>
      {context.before ? <div className={`${workspace.prose} ${styles.prose} ${styles.context}`} dangerouslySetInnerHTML={{ __html: context.before }} /> : null}
      {editing && side === 'after' && editable ? (
        <TextEditor ref={editor} initial={editable.after.join('\n\n')} assets={assets} label={t('yourVersion')} />
      ) : html ? (
        <div className={`${workspace.prose} ${styles.prose} ${styles.field}`} data-side={side} data-kind={kind} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className={styles.placeholder}>{empty}</p>
      )}
      {context.after ? <div className={`${workspace.prose} ${styles.prose} ${styles.context}`} dangerouslySetInnerHTML={{ __html: context.after }} /> : null}
    </section>
  );

  return (
    <AccessLinkModalPortal open onClose={onClose} titleId={titleId} large>
      <div className={`${modalStyles.modalHeader} ${styles.header}`}>
        <div className={styles.heading}>
          <h2 id={titleId} className={modalStyles.modalTitle}>
            {t('compareTitle', { index: index! + 1, total })}
          </h2>
          <p className={styles.subtitle}>{note ?? `${mine ? t('yourVersion') : imageOnly && kind === 'add' ? t('kinds.image') : t(`kinds.${kind}`)}${where}`}</p>
        </div>
        <button type="button" className={styles.nav} onClick={() => onIndex(index! - 1)} disabled={index === 0 || editing} aria-label={t('previousChange')}>
          <TbChevronLeft aria-hidden size={20} />
        </button>
        <button type="button" className={styles.nav} onClick={() => onIndex(index! + 1)} disabled={index === total - 1 || editing} aria-label={t('nextChange')}>
          <TbChevronRight aria-hidden size={20} />
        </button>
        <button type="button" className={sheetStyles.done} onClick={onClose} data-autofocus>
          {tUi('done')}
        </button>
      </div>
      <div className={`${modalStyles.modalBody} ${styles.body}`} data-testid="compare-sheet">
        <div className={styles.columns}>
          {column(labels?.before ?? (review ? t('now') : t('before')), shown.before, 'before', review ? t('notYetIn') : t('notBefore'))}
          {column(editing ? t('yourVersion') : (labels?.after ?? (review ? t('withChange') : t('after'))), shown.after, 'after', t('takenOut'))}
        </div>
      </div>
      {review && choosable.length ? (
        <div className={`${modalStyles.modalFooter} ${styles.footer}`}>
          {editing ? (
            <>
              <span className={styles.spacer} />
              <button type="button" className={workspace.ghostButton} onClick={() => setEditing(false)}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className={workspace.primaryButton}
                onClick={() => {
                  const text = editor.current?.read() ?? editable!.after.join('\n\n');
                  setEditing(false);
                  review.onEdit!(editable!, text);
                }}
                data-testid="keep-edited"
              >
                {t('keepEdited')}
              </button>
            </>
          ) : (
            <>
              {start}
              {editable && !imageOnly && review.onEdit && actionable(review.states[editable.id] ?? 'clean') ? (
                <button type="button" className={workspace.ghostButton} onClick={() => setEditing(true)} data-testid="edit-change">
                  <TbPencil aria-hidden size={15} /> {t('edit')}
                </button>
              ) : null}
              <div className={workspace.segmented} role="group" aria-label={t(`kinds.${kind}`)}>
                <button type="button" aria-pressed={decision === 'keep'} className={decision === 'keep' ? workspace.segmentActive : workspace.segment} onClick={() => decide('keep')}>
                  {conflict ? t('useProposed') : t('keep')}
                </button>
                <button type="button" aria-pressed={decision === 'skip'} className={decision === 'skip' ? workspace.segmentActive : workspace.segment} onClick={() => decide('skip')}>
                  {conflict ? t('keepYours') : t('skip')}
                </button>
              </div>
            </>
          )}
        </div>
      ) : !review && (actions || quiet) ? (
        <div className={`${modalStyles.modalFooter} ${styles.footer}`}>
          {start}
          {actions?.(step)}
        </div>
      ) : null}
    </AccessLinkModalPortal>
  );
}
