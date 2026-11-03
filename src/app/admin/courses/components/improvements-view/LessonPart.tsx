'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { TbChevronDown, TbChevronUp, TbLayoutColumns, TbPencil, TbPlus } from 'react-icons/tb';
import { transformObsidianCallouts } from '@/lib/content/callouts';
import { buildTextIndex, findQuoteRange } from '@/lib/content/quote-range';
import { resolveLessonMarkdownAssetUrls } from '@/lib/course-markdown';
import { lessonSections } from '@/lib/lesson-sections';
import { renderCourseMarkdownToHtml } from '@/lib/markdown';
import CompareSheet, { editableOf } from '../workspace/CompareSheet';
import { renderedInlineDiff } from '../workspace/rendered-diff';
import { actionable, changeSteps, isImageBlocks, splitBlocks, stepKind, type ChangeDecision, type ChangeState, type ProposedChange } from '../workspace/revision';
import TextEditor, { type TextEditorHandle } from './TextEditor';
import workspace from '../workspace/workspace.module.css';
import styles from './improvements-view.module.css';
import './passage-highlights.css';

/** A passage feedback quoted, marked in the lesson: solid when it's ticked (fixed with AI), dotted when it's still to decide. */
export type PassageMark = { id: string; text: string; used: boolean };

/** The names the passages are painted under (CSS Custom Highlight API; the colours are in the view's CSS). */
const HIGHLIGHTS = { used: 'improve-used', open: 'improve-open', selected: 'improve-selected' } as const;

type HighlightRegistry = { set: (name: string, highlight: unknown) => void; delete: (name: string) => void };
const highlightApi = () => {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return null;
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const Highlight = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
};

export const normalBlock = (block: string) => block.replace(/\s+/g, ' ').trim();

const render = (text: string, assets: Map<string, string>) =>
  renderCourseMarkdownToHtml(resolveLessonMarkdownAssetUrls(text, assets), { hastTransforms: [transformObsidianCallouts] });

/** Blocks as learners see them (the learner pages' renderer), for the parts that don't change. */
function Prose({ text, assets, className }: { text: string; assets: Map<string, string>; className?: string }) {
  const html = useMemo(() => render(text, assets), [text, assets]);
  return <div className={`${workspace.prose} ${styles.proseBlock} ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Proposed changes shown in place, each kept or skipped (read-only once the work is done). */
export type InlineChanges = {
  list: ProposedChange[];
  states: Record<string, ChangeState>;
  decisionOf: (change: ProposedChange) => ChangeDecision;
  /** Without it the changes are a record (what was done), not a choice. */
  onDecide?: (change: ProposedChange, decision: ChangeDecision) => void;
  /** Rewrites a suggestion by hand (its new text, Markdown); it's then kept as written. */
  onEdit?: (change: ProposedChange, text: string) => void;
  /** A suggestion rewritten by hand: it's labelled as yours. */
  isEdited?: (change: ProposedChange) => boolean;
  /** A change the person has decided on, here or from its row. */
  isLooked?: (change: ProposedChange) => boolean;
  /** The last change is decided: what comes next is the caller's. */
  onAllLooked?: () => void;
};

/** How the lesson reads while reviewing: changes marked, as it is now, or as it will be (Pages' model). */
export type ReviewView = 'markup' | 'original' | 'final';

/** Where the reader is: this far down the window (the change across it is the one being read). */
const READING_LINE = 0.4;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One step of the changes, tracked in the text as track changes shows it: new words and paragraphs
 * green, removed ones struck through in red, a skipped change as the lesson has it now (so the page
 * reads as it will after Apply). Its number sits in the margin; a click makes it the one being read.
 * Being read, it says what it answers, and is rewritten by hand in place. Original and Final read
 * without marks: the lesson as it is, and as it will be with the changes kept.
 */
function TrackedStep({
  step,
  number,
  total,
  states,
  decisions,
  label,
  current,
  flash,
  view,
  note,
  editing,
  assets,
  onOpen,
  onEdited,
  onCancelEdit,
  register,
}: {
  step: ProposedChange[];
  number: number;
  total: number;
  states: ChangeState[];
  /** Each change's decision; null for a record (everything in it was done). */
  decisions: (ChangeDecision | null)[];
  label: string;
  current: boolean;
  flash: boolean;
  view: ReviewView;
  /** What it answers, under it while it's read. */
  note?: ReactNode;
  editing: boolean;
  assets: Map<string, string>;
  onOpen: () => void;
  onEdited: (text: string) => void;
  onCancelEdit: () => void;
  register: (element: HTMLDivElement | null) => void;
}) {
  const t = useTranslations('editor.improvements');
  const editor = useRef<TextEditorHandle>(null);
  const html = useMemo(
    () =>
      step.map((change) => ({
        before: change.before.length ? render(change.before.join('\n\n'), assets) : '',
        after: change.after.length ? render(change.after.join('\n\n'), assets) : '',
        inline:
          change.kind === 'edit'
            ? renderedInlineDiff(change.before.join('\n\n'), change.after.join('\n\n'), assets, { removed: workspace.wordRemoved, added: workspace.wordAdded })
            : '',
      })),
    [step, assets]
  );
  const kind = stepKind(step);
  // The step as a whole: kept, skipped, some of each, or nothing left to decide (done or gone).
  const chosen = decisions.filter((decision, k) => decision !== null && actionable(states[k]));
  const decision = !chosen.length ? (decisions.every((value) => value === null) ? 'keep' : 'none') : chosen.every((value) => value === chosen[0]) ? chosen[0] : 'mixed';
  const goesIn = (k: number) => (decisions[k] === null ? true : actionable(states[k]) ? decisions[k] === 'keep' : states[k] === 'done');
  const nearby = states.includes('nearby');

  const plain = (content: string, key: string) => (content ? <div key={key} className={`${workspace.prose} ${styles.proseBlock}`} dangerouslySetInnerHTML={{ __html: content }} /> : null);
  const part = (change: ProposedChange, k: number) => {
    const shown = html[k];
    if (view === 'original') return plain(shown.before, change.id);
    if (view === 'final') return plain(goesIn(k) ? shown.after : shown.before, change.id);
    if (change.kind === 'add') {
      // One to check still shows what it would add: it's skipped only until it's been looked at.
      return goesIn(k) || nearby ? (
        <div key={change.id} className={`${workspace.prose} ${styles.proseBlock} ${styles.trackedAdd}`} dangerouslySetInnerHTML={{ __html: shown.after }} />
      ) : (
        <p key={change.id} className={styles.trackedSkipped}>
          <TbPlus aria-hidden size={14} /> {t('addSkipped', { count: change.after.length })}
        </p>
      );
    }
    if (!goesIn(k) && !nearby) return plain(shown.before, change.id);
    if (change.kind === 'remove') return <div key={change.id} className={`${workspace.prose} ${styles.proseBlock} ${styles.trackedRemove}`} dangerouslySetInnerHTML={{ __html: shown.before }} />;
    return plain(shown.inline, change.id);
  };
  const parts = step.map(part);
  const editable = editableOf(step);

  return (
    <div
      ref={register}
      className={styles.tracked}
      data-step={number - 1}
      data-kind={kind}
      data-decision={decision}
      data-view={view}
      data-current={current || undefined}
      data-flash={flash || undefined}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-current={current ? 'true' : undefined}
      data-testid="inline-change"
      onClick={() => {
        // Selecting text to copy isn't a click on the change.
        if (editing || window.getSelection()?.toString()) return;
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }}
    >
      {nearby && decision !== 'keep' && view === 'markup' ? <span className={styles.checkTag} data-testid="check-place">{t('nearby.tag')}</span> : null}
      {editing && editable ? (
        <div data-testid="edit-in-place">
          <TextEditor ref={editor} initial={editable.after.join('\n\n')} assets={assets} label={t('yourVersion')} />
          <div className={styles.actionsEnd}>
            <button type="button" className={workspace.ghostButton} onClick={onCancelEdit}>
              {t('cancel')}
            </button>
            <button type="button" className={workspace.primaryButton} onClick={() => onEdited(editor.current?.read() ?? editable.after.join('\n\n'))} data-testid="keep-edited">
              {t('keepEdited')}
            </button>
          </div>
        </div>
      ) : parts.some(Boolean) ? (
        parts
      ) : current ? (
        <p className={styles.unseen}>{view === 'original' ? t('views.notInOriginal') : t('views.leftOut')}</p>
      ) : null}
      {current && !editing && note ? <p className={styles.changeNote} data-testid="change-answers">{note}</p> : null}
      <span className={styles.pin} aria-hidden title={t('compareTitle', { index: number, total })}>
        {number}
      </span>
    </div>
  );
}

/**
 * The lesson, whole, as learners see it: the passages feedback quoted marked in it (a click on one
 * opens it), the sections an improvement is about marked while there's nothing to review (and the
 * one AI is writing now), and its proposed changes tracked in place while there is, each with its
 * number in the margin. They're reviewed here, one at a time: a bar stays in view to keep or skip the
 * one being read (⏎ ⌫, and ↑ ↓ between them), which moves on to the next not looked at, to rewrite it
 * in place, or to open it side by side (`CompareSheet`). The one being read (across the reading line
 * as the window scrolls) is told to the caller, which marks it in its list.
 */
export default function LessonPart({
  text,
  focus,
  writing = null,
  changes,
  view = 'markup',
  goToStep = null,
  appliedBlocks,
  assets,
  comparing = null,
  onCompare,
  onReading,
  note,
  passages,
  selectedPassage = null,
  onPassage,
}: {
  text: string;
  focus: number[];
  /** The section AI is writing now, by its heading (undefined: none; null: the part before the first heading). */
  writing?: string | null;
  changes?: InlineChanges | null;
  view?: ReviewView;
  /** A step to bring into view and read (asked from the caller's list; `at` tells one ask from the next). */
  goToStep?: { index: number; at: number } | null;
  appliedBlocks?: Set<string>;
  assets: Map<string, string>;
  /** The change open side by side (by its step's index); null: none. */
  comparing?: number | null;
  onCompare?: (index: number | null) => void;
  /** The change across the reading line as the window scrolls (null: none near it). */
  onReading?: (index: number | null) => void;
  /** A quiet line under the change being read, and in its sheet (the feedback it answers). */
  note?: (step: ProposedChange[]) => ReactNode;
  passages?: PassageMark[];
  selectedPassage?: string | null;
  onPassage?: (id: string) => void;
}) {
  const t = useTranslations('editor.improvements');
  const blocks = useMemo(() => splitBlocks(text), [text]);
  const sectionCount = useMemo(() => lessonSections(text).length, [text]);
  // Which section each block is in, counted the way `lessonSections` counts them.
  const sectionOfBlock = useMemo(() => {
    let section = blocks.length && !/^##\s/.test(blocks[0]) ? 0 : -1;
    return blocks.map((block) => {
      if (/^##\s/.test(block)) section += 1;
      return Math.max(0, section);
    });
  }, [blocks]);
  const list = changes?.list;
  const steps = useMemo(() => (list ? changeSteps(list) : []), [list]);
  const choosing = Boolean(changes?.onDecide);
  const [current, setCurrent] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [editingAt, setEditingAt] = useState<number | null>(null);
  const [said, setSaid] = useState('');
  const elements = useRef(new Map<number, HTMLDivElement>());
  // A change was chosen: scrolling to it doesn't choose another on the way.
  const heldUntil = useRef(0);

  // The change across the reading line, as the window scrolls: the nearest one.
  const follow = useCallback(() => {
    if (Date.now() < heldUntil.current) return;
    const line = window.innerHeight * READING_LINE;
    let best: number | null = null;
    let distance = Infinity;
    elements.current.forEach((element, index) => {
      const box = element.getBoundingClientRect();
      const away = line < box.top ? box.top - line : line > box.bottom ? line - box.bottom : 0;
      if (away < distance) {
        distance = away;
        best = index;
      }
    });
    if (best !== null) setCurrent(best);
  }, []);
  useEffect(() => {
    if (!choosing || !steps.length) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(follow);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [choosing, steps, follow]);
  useEffect(() => {
    onReading?.(choosing && steps.length ? current : null);
    // Told when the change being read changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, choosing, steps.length]);

  /** Scrolls a step to just under the reading line, and makes it the one being read. */
  const goTo = useCallback((index: number) => {
    const element = elements.current.get(index);
    if (!element) return;
    heldUntil.current = Date.now() + 700;
    const top = element.getBoundingClientRect().top + window.scrollY - window.innerHeight * READING_LINE + 12;
    window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
    setCurrent(index);
  }, []);
  useEffect(() => {
    if (goToStep) goTo(goToStep.index);
  }, [goToStep, goTo]);

  // A new draft to review: its first change brought into view when it's below the fold (one to check
  // the place of comes first), as is the first section an improvement is about before there's
  // anything to review.
  const firstKey = steps[0]?.[0]?.id ?? (focus.length ? `focus-${focus[0]}` : '');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = Math.max(0, steps.findIndex((step) => step.some((change) => changes?.states[change.id] === 'nearby')));
    if (steps.length) setCurrent(first);
    const element = steps.length ? elements.current.get(first) : body.current?.querySelector(`.${styles.focus}`);
    if (!firstKey || !element) return;
    const box = element.getBoundingClientRect();
    if (box.top > window.innerHeight * 0.85) {
      window.scrollTo({ top: Math.max(0, box.top + window.scrollY - window.innerHeight * READING_LINE + 12), behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    // Only when there's another draft (or improvement) to look at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey]);

  const closeSheet = () => {
    const index = comparing;
    onCompare?.(null);
    if (index === null) return;
    // After the sheet has given focus back: the change it was on, in view and marked for a moment.
    requestAnimationFrame(() => {
      goTo(index);
      elements.current.get(index)?.focus({ preventScroll: true });
      setFlash(index);
      window.setTimeout(() => setFlash((value) => (value === index ? null : value)), 1400);
    });
  };

  /** The paragraphs around a step in the lesson, for the sheet: where it is. */
  const contextOf = useCallback(
    (step: ProposedChange[]) => {
      const start = step[0].at;
      const end = start + step[0].before.length;
      return { before: blocks[start - 1] ?? null, after: blocks[end] ?? null };
    },
    [blocks]
  );

  const stepLabel = (step: ProposedChange[], index: number) =>
    t('pinLabel', { index: index + 1, total: steps.length, kind: changes?.isEdited?.(step.find((change) => change.kind !== 'remove') ?? step[0]) ? t('yourVersion') : t(`kinds.${stepKind(step)}`) });

  const renderStep = (index: number) => {
    const step = steps[index];
    return (
      <TrackedStep
        key={step[0].id}
        step={step}
        number={index + 1}
        total={steps.length}
        states={step.map((change) => changes!.states[change.id] ?? 'clean')}
        decisions={step.map((change) => (choosing ? changes!.decisionOf(change) : null))}
        label={stepLabel(step, index)}
        current={choosing && current === index}
        flash={flash === index}
        assets={assets}
        view={view}
        note={note?.(step)}
        editing={editingAt === index}
        onOpen={() => goTo(index)}
        onEdited={(written) => {
          setEditingAt(null);
          const editable = editableOf(step);
          if (editable) changes!.onEdit?.(editable, written);
        }}
        onCancelEdit={() => setEditingAt(null)}
        register={(element) => {
          if (element) elements.current.set(index, element);
          else elements.current.delete(index);
        }}
      />
    );
  };

  // --- Deciding, from the bar or the keyboard: the one being read, then on to the next not looked at ---
  const reading = current !== null && steps[current] ? current : 0;
  const readingStep = choosing ? (steps[reading] ?? null) : null;
  const choosableOf = (step: ProposedChange[]) => step.filter((change) => actionable(changes?.states[change.id]));
  const readingChoosable = readingStep ? choosableOf(readingStep) : [];
  const readingDecision = readingChoosable.length
    ? readingChoosable.every((change) => changes!.decisionOf(change) === 'keep')
      ? 'keep'
      : readingChoosable.every((change) => changes!.decisionOf(change) === 'skip')
        ? 'skip'
        : null
    : null;
  const move = (by: number) => {
    const next = Math.min(steps.length - 1, Math.max(0, reading + by));
    setEditingAt(null);
    goTo(next);
  };
  const decide = (value: ChangeDecision) => {
    if (!readingStep || !readingChoosable.length) return;
    // Out of sight, the key only brings it back: nothing is decided on a change nobody can see.
    const box = elements.current.get(reading)?.getBoundingClientRect();
    if (box && (box.bottom < 0 || box.top > window.innerHeight)) {
      goTo(reading);
      return;
    }
    readingChoosable.forEach((change) => changes!.onDecide!(change, value));
    setSaid(t('review.said', { index: reading + 1, total: steps.length, decision: value }));
    const done = (step: ProposedChange[], index: number) => index === reading || !choosableOf(step).length || choosableOf(step).every((change) => changes!.isLooked?.(change));
    const order = steps.map((_, index) => (reading + 1 + index) % steps.length);
    const next = order.find((index) => !done(steps[index], index));
    if (next === undefined) changes!.onAllLooked?.();
    else goTo(next);
  };
  const readingEditable = readingStep ? editableOf(readingStep) : null;
  const canRewrite = Boolean(readingEditable && changes?.onEdit && !isImageBlocks(readingEditable.after) && actionable(changes.states[readingEditable.id]));
  const decideRef = useRef(decide);
  decideRef.current = decide;
  const moveRef = useRef(move);
  moveRef.current = move;
  useEffect(() => {
    if (!choosing || !steps.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (comparing !== null || editingAt !== null || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return;
      if (event.key === 'ArrowDown') moveRef.current(1);
      else if (event.key === 'ArrowUp') moveRef.current(-1);
      else if (event.key === 'Backspace') decideRef.current('skip');
      else if (event.key === 'Enter' && !target?.closest('button, a')) decideRef.current('keep');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choosing, steps.length, comparing, editingAt]);

  // The passages feedback quoted, found in the lesson as it's shown and painted over its text (the
  // DOM isn't touched, so the rendered lesson stays as React wrote it). Found again whenever the
  // lesson's text, its marked sections or the passages change.
  const found = useRef<Array<{ id: string; range: Range }>>([]);
  const passageKey = (passages ?? []).map((one) => `${one.id}:${one.used ? 1 : 0}:${one.text}`).join('\n');
  const focusKey = focus.join(',');
  useEffect(() => {
    const root = body.current;
    const api = highlightApi();
    found.current = [];
    if (!root || !passages?.length) return;
    const index = buildTextIndex(root);
    const located = passages.flatMap((one) => {
      const range = findQuoteRange(root, one.text, index);
      return range ? [{ ...one, range }] : [];
    });
    found.current = located;
    if (!api) return;
    const paint = (name: string, ranges: Range[]) => api.registry.set(name, new api.Highlight(...ranges));
    paint(HIGHLIGHTS.used, located.filter((one) => one.used).map((one) => one.range));
    paint(HIGHLIGHTS.open, located.filter((one) => !one.used).map((one) => one.range));
    paint(HIGHLIGHTS.selected, located.filter((one) => one.id === selectedPassage).map((one) => one.range));
    return () => {
      for (const name of Object.values(HIGHLIGHTS)) api.registry.delete(name);
    };
    // The passages by their key; the rendered lesson by its text, assets and marked sections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passageKey, selectedPassage, text, assets, focusKey, steps.length]);

  /** The passage under the pointer, if any. */
  const passageAt = (event: MouseEvent<HTMLDivElement>) => {
    if (!onPassage || !found.current.length) return null;
    for (const one of found.current) {
      for (const rect of Array.from(one.range.getClientRects())) {
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return one.id;
      }
    }
    return null;
  };

  // Where each step goes: new paragraphs before a block (or at the end), the rest on the blocks they change.
  const { startsAt, addsBefore } = useMemo(() => {
    const starts = new Map<number, number>();
    const adds = new Map<number, number[]>();
    steps.forEach((step, index) => {
      if (step[0].kind === 'add') adds.set(step[0].at, [...(adds.get(step[0].at) ?? []), index]);
      else starts.set(step[0].at, index);
    });
    return { startsAt: starts, addsBefore: adds };
  }, [steps]);
  // The sections an improvement is about are marked while there's nothing to review (not when it's all of them).
  const marked = (index: number) => !steps.length && focus.length > 0 && focus.length < sectionCount && focus.includes(sectionOfBlock[index]);
  // The section AI is writing now, by its place among the lesson's sections.
  const writingAt = useMemo(() => (writing === undefined ? -1 : lessonSections(text).findIndex((section) => section.heading === writing)), [text, writing]);
  const toneOf = (index: number) => (writingAt >= 0 && sectionOfBlock[index] === writingAt ? styles.writing : marked(index) ? styles.focus : undefined);

  const out: ReactNode[] = [];
  let run: string[] = [];
  let runTone: string | undefined;
  const flushRun = (key: string) => {
    if (run.length) {
      out.push(
        <div key={`p${key}`} className={runTone}>
          <Prose text={run.join('\n\n')} assets={assets} />
        </div>
      );
    }
    run = [];
  };
  let skipUntil = -1;
  for (let index = 0; index <= blocks.length; index += 1) {
    const adds = addsBefore.get(index);
    if (adds) {
      flushRun(String(index));
      for (const step of adds) out.push(renderStep(step));
    }
    if (index === blocks.length) break;
    if (index < skipUntil) continue;
    const starting = startsAt.get(index);
    if (starting !== undefined) {
      flushRun(String(index));
      out.push(renderStep(starting));
      skipUntil = index + steps[starting][0].before.length;
      continue;
    }
    const block = blocks[index];
    if (appliedBlocks?.has(normalBlock(block))) {
      flushRun(String(index));
      out.push(<Prose key={`a${index}`} text={block} assets={assets} className={styles.applied} />);
      continue;
    }
    if (run.length && toneOf(index) !== runTone) flushRun(String(index));
    runTone = toneOf(index);
    run.push(block);
  }
  flushRun('end');

  return (
    <>
      <div
        ref={body}
        className={styles.partBody}
        data-layout={steps.length ? 'tracked' : undefined}
        onClick={(event) => {
          // Selecting text to copy isn't a click on a passage.
          if (window.getSelection()?.toString()) return;
          const id = passageAt(event);
          if (id) onPassage?.(id);
        }}
        onMouseMove={(event) => {
          if (!onPassage) return;
          event.currentTarget.style.cursor = passageAt(event) ? 'pointer' : '';
        }}
      >
        {out}
      </div>
      {readingStep ? (
        <div className={styles.reviewBar} role="toolbar" aria-label={t('review.label')} data-testid="review-bar">
          <button type="button" className={styles.barIcon} onClick={() => move(-1)} disabled={reading === 0} aria-label={t('previousChange')} title={t('previousChange')} data-testid="review-prev">
            <TbChevronUp aria-hidden size={18} />
          </button>
          <button type="button" className={styles.barIcon} onClick={() => move(1)} disabled={reading === steps.length - 1} aria-label={t('nextChange')} title={t('nextChange')} data-testid="review-next">
            <TbChevronDown aria-hidden size={18} />
          </button>
          <span className={styles.barCount} data-testid="review-position">
            {t('review.position', { index: reading + 1, total: steps.length })}
          </span>
          <span className={styles.barSpace} />
          <button type="button" className={`${styles.barIcon} ${styles.barSideBySide}`} onClick={() => onCompare?.(reading)} aria-label={t('review.sideBySide')} title={t('review.sideBySide')} data-testid="side-by-side">
            <TbLayoutColumns aria-hidden size={18} />
          </button>
          {canRewrite ? (
            <button type="button" className={workspace.ghostButton} onClick={() => setEditingAt(reading)} disabled={editingAt !== null} aria-label={t('edit')} data-testid="edit-change">
              <TbPencil aria-hidden size={15} /> <span className={styles.barLabel}>{t('edit')}</span>
            </button>
          ) : null}
          {readingChoosable.length ? (
            <div className={workspace.segmented} role="group" aria-label={t('review.label')}>
              <button type="button" aria-pressed={readingDecision === 'skip'} className={readingDecision === 'skip' ? workspace.segmentActive : workspace.segment} onClick={() => decide('skip')} data-testid="review-skip">
                {t(readingStep.some((change) => changes?.states[change.id] === 'conflict') ? 'keepYours' : 'skip')}
                <kbd className={styles.keyHint}>⌫</kbd>
              </button>
              <button type="button" aria-pressed={readingDecision === 'keep'} className={readingDecision === 'keep' ? workspace.segmentActive : workspace.segment} onClick={() => decide('keep')} data-testid="review-keep">
                {t(readingStep.some((change) => changes?.states[change.id] === 'conflict') ? 'useProposed' : 'keep')}
                <kbd className={styles.keyHint}>⏎</kbd>
              </button>
            </div>
          ) : null}
          <span className={styles.srOnly} role="status">
            {said}
          </span>
        </div>
      ) : null}
      {changes ? (
        <CompareSheet
          steps={steps}
          index={comparing}
          onIndex={(index) => onCompare?.(index)}
          onClose={closeSheet}
          contextOf={contextOf}
          assets={assets}
          note={note}
          review={choosing ? { states: changes.states, decisionOf: changes.decisionOf, onDecide: changes.onDecide!, onEdit: changes.onEdit, isEdited: changes.isEdited } : null}
        />
      ) : null}
    </>
  );
}
