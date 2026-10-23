'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { TbPlus } from 'react-icons/tb';
import { transformObsidianCallouts } from '@/lib/content/callouts';
import { buildTextIndex, findQuoteRange } from '@/lib/content/quote-range';
import { resolveLessonMarkdownAssetUrls } from '@/lib/course-markdown';
import { lessonSections } from '@/lib/lesson-sections';
import { renderCourseMarkdownToHtml } from '@/lib/markdown';
import CompareSheet from '../workspace/CompareSheet';
import { actionable, type ChangeDecision } from '../workspace/ProposedChanges';
import { renderedInlineDiff } from '../workspace/rendered-diff';
import { changeSteps, splitBlocks, stepKind, type ChangeState, type ProposedChange } from '../workspace/revision';
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
};

/** Where the reader is: this far down the window (the change across it is the one being read). */
const READING_LINE = 0.4;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One step of the changes, tracked in the text as track changes shows it: new words and paragraphs
 * green, removed ones struck through in red, a skipped change as the lesson has it now (so the page
 * reads as it will after Apply). Its number sits in the margin; a click opens it side by side.
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
  assets,
  onOpen,
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
  assets: Map<string, string>;
  onOpen: () => void;
  register: (element: HTMLDivElement | null) => void;
}) {
  const t = useTranslations('editor.improvements');
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

  const part = (change: ProposedChange, k: number) => {
    const shown = html[k];
    if (change.kind === 'add') {
      return goesIn(k) ? (
        <div key={change.id} className={`${workspace.prose} ${styles.proseBlock} ${styles.trackedAdd}`} dangerouslySetInnerHTML={{ __html: shown.after }} />
      ) : (
        <p key={change.id} className={styles.trackedSkipped}>
          <TbPlus aria-hidden size={14} /> {t('addSkipped', { count: change.after.length })}
        </p>
      );
    }
    if (!goesIn(k)) return <div key={change.id} className={`${workspace.prose} ${styles.proseBlock}`} dangerouslySetInnerHTML={{ __html: shown.before }} />;
    if (change.kind === 'remove') return <div key={change.id} className={`${workspace.prose} ${styles.proseBlock} ${styles.trackedRemove}`} dangerouslySetInnerHTML={{ __html: shown.before }} />;
    return <div key={change.id} className={`${workspace.prose} ${styles.proseBlock}`} dangerouslySetInnerHTML={{ __html: shown.inline }} />;
  };

  return (
    <div
      ref={register}
      className={styles.tracked}
      data-step={number - 1}
      data-kind={kind}
      data-decision={decision}
      data-current={current || undefined}
      data-flash={flash || undefined}
      role="button"
      tabIndex={0}
      aria-label={label}
      data-testid="inline-change"
      onClick={() => {
        // Selecting text to copy isn't a click on the change.
        if (window.getSelection()?.toString()) return;
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onOpen();
      }}
    >
      {step.map(part)}
      <span className={styles.pin} aria-hidden title={t('compareTitle', { index: number, total })}>
        {number}
      </span>
    </div>
  );
}

/**
 * The lesson, whole, as learners see it: the passages feedback quoted marked in it (a click on one
 * opens it), the sections an improvement is about marked while there's nothing to review, and its
 * proposed changes tracked in place while there is, each with its number in the margin and opened
 * side by side (`CompareSheet`, which the caller opens from its list too) to keep, skip or rewrite.
 * While reviewing, the change being read (the one across the reading line) is told to the caller,
 * which marks it in its list.
 */
export default function LessonPart({
  text,
  focus,
  changes,
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
  changes?: InlineChanges | null;
  appliedBlocks?: Set<string>;
  assets: Map<string, string>;
  /** The change open side by side (by its step's index); null: none. */
  comparing?: number | null;
  onCompare?: (index: number | null) => void;
  /** The change across the reading line as the window scrolls (null: none near it). */
  onReading?: (index: number | null) => void;
  /** A quiet line under a change opened side by side (the feedback it answers). */
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
  const elements = useRef(new Map<number, HTMLDivElement>());

  // The change across the reading line, as the window scrolls: the nearest one, if it's close.
  const follow = useCallback(() => {
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
    setCurrent(distance < window.innerHeight * 0.25 ? best : null);
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
    const top = element.getBoundingClientRect().top + window.scrollY - window.innerHeight * READING_LINE + 12;
    window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
    setCurrent(index);
  }, []);

  // A new draft to review: its first change brought into view when it's below the fold, as is the
  // first section an improvement is about before there's anything to review.
  const firstKey = steps[0]?.[0]?.id ?? (focus.length ? `focus-${focus[0]}` : '');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = steps.length ? elements.current.get(0) : body.current?.querySelector(`.${styles.focus}`);
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
        onOpen={() => onCompare?.(index)}
        register={(element) => {
          if (element) elements.current.set(index, element);
          else elements.current.delete(index);
        }}
      />
    );
  };

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

  const out: ReactNode[] = [];
  let run: string[] = [];
  let runMarked = false;
  const flushRun = (key: string) => {
    if (run.length) {
      out.push(
        <div key={`p${key}`} className={runMarked ? styles.focus : undefined}>
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
    if (run.length && marked(index) !== runMarked) flushRun(String(index));
    runMarked = marked(index);
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
