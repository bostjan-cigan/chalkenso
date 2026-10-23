'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { TbChevronLeft, TbChevronRight, TbCircleCheck, TbPlus, TbSparkles } from 'react-icons/tb';
import { AiProposalKind } from '@prisma/client';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { getPendingImageReferences } from '@/lib/course-markdown';
import { POLL_MS, QUIET_MS } from '@/lib/ai-draft-progress';
import type { LessonDraftView } from '@/lib/ai-drafts';
import { excerpt } from '@/lib/improvement-label';
import { feedbackOrder, focusSections, lessonSections, passageHeading, sectionSpan, spliceSpan } from '@/lib/lesson-sections';
import type { SavedLessonChange } from '@/lib/lesson-changes';
import {
  discardLessonDraftAction,
  lessonDraftIdsAction,
  lessonRevisionDraftAction,
  reopenLessonDraftAction,
  startLessonRevisionAction,
  stopLessonRevisionAction,
} from '../../ai-actions';
import { updateLessonInlineAction } from '../../actions';
import { undoLessonChangeAction } from '../../lesson-change-actions';
import { stopUsingFeedbackAction, takeUpFeedbackAction } from '../../comments/actions';
import { addToImprovementAction } from '../../improvement-actions';
import { leaveCourseAsItIsAction, workHereAction } from '../../../tasks/actions';
import AdminMenu, { type AdminMenuItem } from '../../../components/ui/AdminMenu';
import AiWorking from '../../../components/ui/AiWorking';
import { SheetOpenRow, SheetRow, SheetRows } from '../../../components/ui/Sheet';
import ConfirmDialog from '../ConfirmDialog';
import LessonModeSwitch from '../LessonModeSwitch';
import { applyChanges, applyOnto, changeSteps, changesNotIn, placeChanges, plainText, proposeChanges, splitBlocks, stepKind, type ChangeState, type ProposedChange } from '../workspace/revision';
import CompareSheet, { editableOf } from '../workspace/CompareSheet';
import { actionable, type ChangeDecision } from '../workspace/ProposedChanges';
import { HANDOFF_STARTED_EVENT, handoffDraft, type HandoffStartedDetail } from '../workspace/events';
import { useHandoffStarted } from '../workspace/useHandoffStarted';
import type { UploadedLessonAsset } from '../../types';
import WhatChanged from '../../../components/improvements/WhatChanged';
import { ChangeRow, FeedbackCard, NavRow } from './Column';
import type { DoneImprovement, ViewFeedback, ViewImprovement } from './data';
import FeedbackDetail from './FeedbackDetail';
import LessonPart, { normalBlock, type PassageMark } from './LessonPart';
import NotesForAi from './NotesForAi';
import { PlanText, usePlanStep } from './PlanStep';
import TextEditor, { type TextEditorHandle } from './TextEditor';
import workspace from '../workspace/workspace.module.css';
import styles from './improvements-view.module.css';

/** What a link asks the view to open: an improvement, a piece of feedback, a revision, or something else to change. */
export type Selection = { kind: 'improvement' | 'feedback' | 'draft'; id: string } | { kind: 'new' };

/**
 * What the column shows. To do: the lesson's next changes (`list`), a piece of feedback whole, the
 * feedback an improvement uses, something else to change, and other work on the lesson (an earlier
 * improvement, a revision of none). Done: the finished improvements, and one of them.
 */
type Pane =
  | { kind: 'list' }
  | { kind: 'feedback'; id: string; back: Pane }
  | { kind: 'used'; of: string | null }
  | { kind: 'new' }
  | { kind: 'improvement'; id: string }
  | { kind: 'draft'; id: string }
  | { kind: 'done' }
  | { kind: 'finished'; id: string };

/** Where an improvement is: deciding its feedback, its plan, its changes being written or reviewed, or elsewhere. */
type Phase = 'none' | 'vault' | 'review' | 'drafting' | 'handEdit' | 'course' | 'planning' | 'decide' | 'stale' | 'planned';

/** What one save puts into the lesson: an improvement's changes (or a draft's of no improvement), kept or written by hand. */
type Entry = { taskId: string | null; draftId: string | null; before: string; after: string; applied: number; skipped: number; noteIds: string[] };

type Review = { draft: LessonDraftView; base: string; changes: ProposedChange[]; states: Record<string, ChangeState> };

/** A piece of feedback in the column, ticked when the lesson's improvement uses it. */
type Card = ViewFeedback & { used: boolean };

const queryOf = (pane: Pane) =>
  pane.kind === 'feedback'
    ? `?note=${pane.id}`
    : pane.kind === 'improvement' || pane.kind === 'finished'
      ? `?i=${pane.id}`
      : pane.kind === 'draft'
        ? `?draft=${pane.id}`
        : pane.kind === 'new'
          ? '?new=1'
          : window.location.pathname;

/**
 * A lesson's Improve mode: the lesson, whole, as learners read it, and its to-do in a column
 * beside it. One improvement per lesson, from all the feedback that's ticked. The column goes
 * step by step, one primary button at its foot: tick the feedback to fix with AI (the passages are
 * marked in the lesson; a reply answers the rest), plan the changes, draft them, then tick the
 * changes to keep (tracked in the lesson, each opened side by side) and publish them (save, on a
 * draft lesson), with Undo after. A piece of feedback, something else to change, and other work on
 * the lesson (earlier improvements, a group copy's changes, revisions from someone's Claude) open
 * in the column with a way back; Done holds the finished ones, their changes marked in the lesson.
 * Rare actions (the improvement's page, Obsidian, Discard) sit in the ⋯ menu.
 */
type RowState = { text: string; tone: 'next' | 'working' | 'you' | 'done' | 'quiet' };

/** How often the page asks whether a draft arrived meanwhile. */
const ARRIVALS_MS = 5000;

export default function ImprovementsView({
  lesson,
  uploadedAssets,
  levelLabel,
  editHref,
  improvements,
  done,
  newFeedback,
  looseDrafts,
  seenDrafts,
  aiEnabled,
  vault,
  canWork,
  aiSlots,
  initial,
  initialWhy = '',
}: {
  lesson: {
    id: string;
    courseId: string;
    curriculumVersionId: string;
    title: string;
    slug: string;
    status: 'DRAFT' | 'PUBLISHED';
    shortDescription: string;
    arcId: string;
    markdown: string;
    revision: number;
  };
  uploadedAssets: Record<string, UploadedLessonAsset>;
  levelLabel: string;
  /** The lesson's Edit mode. */
  editHref: string;
  improvements: ViewImprovement[];
  /** Finished ones, read-only: why, the plan, what changed. */
  done: DoneImprovement[];
  newFeedback: ViewFeedback[];
  looseDrafts: LessonDraftView[];
  /** The drafts the page came with (its revisions and its improvements' plans): ones that arrive later are brought in. */
  seenDrafts: string[];
  aiEnabled: boolean;
  /** The organisation also works in the Obsidian vault: each improvement is worked on here or there. */
  vault: boolean;
  /** The person works on this lesson's feedback (ticking it, answering it, something else to change). */
  canWork: boolean;
  /** The edition's "… in your Claude ↗" for each improvement (where the app has no AI): under its plan, and under its changes. */
  aiSlots: Record<string, { plan: ReactNode; changes: ReactNode }>;
  initial: Selection | null;
  /** Something else to change, when a link starts one (Insights). */
  initialWhy?: string;
}) {
  const t = useTranslations('editor.improvements');
  const tc = useTranslations('editor.improvements.column');
  const tr = useTranslations('tasks.record');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const uploadedUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of Object.values(uploadedAssets)) if (asset?.publicUrl) map.set(asset.sourcePath, asset.publicUrl);
    return map;
  }, [uploadedAssets]);
  const improveCount = improvements.length + newFeedback.length + looseDrafts.length;
  const lessonImprovement = improvements.find((candidate) => candidate.current) ?? null;

  // --- What the column shows ---------------------------------------------------------------------
  const [wanted, setPane] = useState<Pane>((): Pane => {
    if (!initial) return { kind: 'list' };
    if (initial.kind === 'new') return { kind: 'new' };
    if (initial.kind === 'feedback') return { kind: 'feedback', id: initial.id, back: { kind: 'list' } };
    if (initial.kind === 'draft') return { kind: 'draft', id: initial.id };
    if (done.some((finished) => finished.id === initial.id)) return { kind: 'finished', id: initial.id };
    return lessonImprovement?.id === initial.id ? { kind: 'list' } : { kind: 'improvement', id: initial.id };
  });
  // What was asked for, as it still is: feedback answered goes back, an improvement finished goes to Done.
  const knownFeedback = (id: string) => newFeedback.some((one) => one.id === id) || improvements.some((candidate) => candidate.feedback.some((one) => one.id === id));
  const resolve = (candidate: Pane): Pane => {
    switch (candidate.kind) {
      case 'feedback':
        return knownFeedback(candidate.id) ? candidate : resolve(candidate.back);
      case 'used':
        return !candidate.of || improvements.some((one) => one.id === candidate.of && !one.current) ? candidate : { kind: 'used', of: null };
      case 'improvement':
        if (improvements.some((one) => one.id === candidate.id && !one.current)) return candidate;
        return done.some((one) => one.id === candidate.id) ? { kind: 'finished', id: candidate.id } : { kind: 'list' };
      case 'draft':
        return looseDrafts.some((one) => one.id === candidate.id) ? candidate : { kind: 'list' };
      case 'finished':
        return done.some((one) => one.id === candidate.id) ? candidate : { kind: 'done' };
      default:
        return candidate;
    }
  };
  const pane = resolve(wanted);
  // Narrow screens show the lesson or the column, like Mail.
  const [showColumn, setShowColumn] = useState(Boolean(initial));
  // The improvement whose work the column and the lesson show (null: none yet, or not an improvement's).
  const onLessonFlow = pane.kind === 'list' || pane.kind === 'feedback' || pane.kind === 'new' || (pane.kind === 'used' && !pane.of);
  const paneImprovement =
    pane.kind === 'improvement' || (pane.kind === 'used' && pane.of) ? (improvements.find((candidate) => candidate.id === (pane.kind === 'used' ? pane.of : pane.id)) ?? null) : null;
  const subject: ViewImprovement | null = paneImprovement ?? (onLessonFlow ? lessonImprovement : null);
  const finished = pane.kind === 'finished' ? (done.find((candidate) => candidate.id === pane.id) ?? null) : null;
  const subjectKey = subject ? `improvement:${subject.id}` : pane.kind === 'draft' ? `draft:${pane.id}` : '';

  // --- The lesson's text here ------------------------------------------------------------------
  const [current, setCurrent] = useState(lesson.markdown);
  const [revision, setRevision] = useState(lesson.revision);
  // Drafts started, finished or dropped here since the page loaded, over the ones it came with,
  // by whose they are: `improvement:<id>` or `draft:<id>`.
  const [overrides, setOverrides] = useState<Record<string, LessonDraftView | null>>({});
  const [decisions, setDecisions] = useState<Record<string, ChangeDecision>>({});
  // Suggestions rewritten by hand (`<draft>:<change>`): labelled as the person's own.
  const [edited, setEdited] = useState<Set<string>>(new Set());
  // After a save the page reloads its improvements: start again from the saved lesson.
  useEffect(() => {
    setCurrent(lesson.markdown);
    setRevision(lesson.revision);
    setOverrides({});
  }, [lesson.markdown, lesson.revision]);

  const draftOf = (key: string): LessonDraftView | null => {
    if (key in overrides) return overrides[key];
    const [kind, id] = key.split(':');
    if (kind === 'improvement') return improvements.find((candidate) => candidate.id === id)?.draft ?? null;
    if (kind === 'draft') return looseDrafts.find((draft) => draft.id === id) ?? null;
    return null;
  };
  const shownDrafts = looseDrafts.filter((draft) => draftOf(`draft:${draft.id}`) !== null);

  const reviews = useMemo(() => {
    const map = new Map<string, Review>();
    const keys = [...improvements.map((candidate) => `improvement:${candidate.id}`), ...looseDrafts.map((draft) => `draft:${draft.id}`)];
    for (const key of keys) {
      const draft = draftOf(key);
      if (!draft || draft.state !== 'ready') continue;
      const base = draft.base || current;
      const changes = proposeChanges(base, draft.markdown);
      map.set(key, { draft, base, changes, states: placeChanges(base, current, changes) });
    }
    return map;
    // draftOf reads the overrides and the drafts the page brought.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [improvements, looseDrafts, overrides, current]);
  // The lesson's images, and the new diagrams of the drafts here, shown from their draft until Save
  // stores them.
  const draftDiagrams = Array.from(reviews.values()).flatMap((found) => found.draft.diagrams.map((path) => `${found.draft.id}/${path}`));
  const diagramKey = draftDiagrams.join(',');
  const assets = useMemo(() => {
    const map = new Map(uploadedUrls);
    for (const item of diagramKey ? diagramKey.split(',') : []) {
      const path = item.slice(item.indexOf('/') + 1);
      if (!map.has(path)) map.set(path, `/admin/api/drafts/${item}`);
    }
    return map;
  }, [uploadedUrls, diagramKey]);
  const decisionOf = (review: Review, change: ProposedChange): ChangeDecision =>
    decisions[`${review.draft.id}:${change.id}`] ?? (review.states[change.id] === 'clean' ? 'keep' : 'skip');

  // While AI writes changes: how far each draft is, about once a second.
  const workingKeys = improvements.map((candidate) => `improvement:${candidate.id}`).filter((key) => draftOf(key)?.state === 'working');
  const workingKey = workingKeys.map((key) => `${key}=${draftOf(key)?.id}`).join(',');
  useEffect(() => {
    if (!workingKey) return;
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      for (const pair of workingKey.split(',')) {
        const [key, id] = pair.split('=');
        const next = await lessonRevisionDraftAction(id);
        if (cancelled) return;
        setOverrides((all) => ({ ...all, [key]: next && next.state !== 'failed' ? next : null }));
        if (next?.state === 'failed') setNotice({ text: next.error ?? t('failed') });
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // Following other drafts restarts the polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingKey]);

  // Changes handed to the person's own Claude ("Apply the plan in your Claude ↗"): followed here like
  // changes drafted here, and Claude's draft is reviewed in place when it arrives (an earlier hand-off
  // is no longer waited for).
  useHandoffStarted(AiProposalKind.LESSON_REVISION, lesson.id, (detail: HandoffStartedDetail) => {
    if (!detail.taskId || !improvements.some((candidate) => candidate.id === detail.taskId)) return;
    const key = `improvement:${detail.taskId}`;
    const earlier = draftOf(key);
    if (earlier?.state === 'working' && earlier.id !== detail.pending.id) void stopLessonRevisionAction(earlier.id);
    setOverrides((all) => ({
      ...all,
      [key]: { ...handoffDraft(detail), markdown: '', base: '', diagrams: [], summary: '', at: detail.pending.createdAt, taskId: detail.taskId, noteIds: null },
    }));
  });

  // A draft the page brings after it loaded (someone's Claude sent one, someone else started one)
  // takes over from what was shown here for its improvement.
  const adopted = useRef(new Set(improvements.flatMap((candidate) => (candidate.draft ? [candidate.draft.id] : []))));
  const brought = improvements.map((candidate) => candidate.draft?.id ?? '').join(',');
  useEffect(() => {
    const fresh = improvements.filter((candidate) => candidate.draft && !adopted.current.has(candidate.draft.id));
    if (!fresh.length) return;
    for (const candidate of fresh) adopted.current.add(candidate.draft!.id);
    setOverrides((all) => {
      const next = { ...all };
      for (const candidate of fresh) delete next[`improvement:${candidate.id}`];
      return next;
    });
    // Only when the page brings other drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brought]);

  // What arrives meanwhile (a draft someone's Claude sent without being asked from here, work started
  // in another tab or by someone else): asked for every few seconds while the page is in view, and
  // brought in. Drafts the page follows itself (started here, or handed off from here) are known.
  const known = useRef(new Set(seenDrafts));
  const followed = useRef(overrides);
  followed.current = overrides;
  useEffect(() => {
    for (const id of seenDrafts) known.current.add(id);
  }, [seenDrafts]);
  const taskKey = improvements.map((candidate) => candidate.id).join(',');
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const ids = await lessonDraftIdsAction(lesson.id, taskKey ? taskKey.split(',') : []);
        const mine = new Set(Object.values(followed.current).flatMap((draft) => (draft ? [draft.id] : [])));
        const fresh = ids.filter((id) => !known.current.has(id) && !mine.has(id));
        if (fresh.length) {
          for (const id of fresh) known.current.add(id);
          router.refresh();
        }
      } catch {
        // Asked again in a moment.
      } finally {
        busy = false;
      }
    };
    // Hand-offs started on this page are followed already.
    const onStarted = (event: Event) => {
      const id = (event as CustomEvent<HandoffStartedDetail>).detail?.pending.id;
      if (id) known.current.add(id);
    };
    const timer = window.setInterval(() => void check(), ARRIVALS_MS);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    window.addEventListener(HANDOFF_STARTED_EVENT, onStarted);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(HANDOFF_STARTED_EVENT, onStarted);
    };
  }, [lesson.id, taskKey, router]);

  // --- A line under the actions, sometimes with Undo ------------------------------------------
  const [notice, setNotice] = useState<{ text: string; undo?: () => void; see?: () => void; open?: { href: string; label: string } } | null>(null);
  const [pending, startTransition] = useTransition();

  // --- Each row's state, in a few words, as a pill whose colour says what it asks of you --------
  // next: your next step (plan it, draft the changes) · working: AI is at it · you: waiting on you
  // (review, save, publish) · done: saved or finished · quiet: elsewhere (in Obsidian).
  const inVault = (candidate: ViewImprovement) => vault && candidate.workplace === 'VAULT';
  const reviewCount = (review: Review) => review.changes.filter((change) => actionable(review.states[change.id])).length;
  const stateOf = (candidate: ViewImprovement): RowState => {
    const key = `improvement:${candidate.id}`;
    if (inVault(candidate)) return { text: t('state.inVault'), tone: 'quiet' };
    if (!candidate.plan || (candidate.newSincePlan.length && !draftOf(key)))
      return candidate.planDraft?.state === 'working'
        ? { text: t('state.planning'), tone: 'working' }
        : { text: candidate.plan ? t('state.planToUpdate') : t('state.planToWrite'), tone: 'next' };
    const working = draftOf(key);
    if (working?.state === 'working')
      return { text: working.source === 'claude' && working.stage === 'waiting' ? t('working.claude.waitingOther') : t('state.writing'), tone: 'working' };
    const review = reviews.get(key);
    if (review)
      return reviewCount(review) ? { text: t('state.toReview', { count: reviewCount(review) }), tone: 'you' } : { text: t('state.nothingLeft'), tone: 'quiet' };
    if (candidate.savedHere) return candidate.others.length ? { text: t('state.savedHereOthers'), tone: 'you' } : { text: t('state.saved'), tone: 'done' };
    return { text: t('state.readyForChanges'), tone: 'next' };
  };

  // --- The lesson as the column's work shows it --------------------------------------------------
  const review = reviews.get(subjectKey) ?? null;
  const reviewing = Boolean(review);
  const reviewSteps = useMemo(() => (review ? changeSteps(review.changes) : []), [review]);
  const shownText = reviewing && review ? review.base : current;
  const focus = useMemo(() => {
    if (!subject && pane.kind !== 'draft') return [];
    const changeAt = reviewing && review ? review.changes.map((change) => change.at) : [];
    return focusSections(shownText, { passages: subject?.feedback.map((feedback) => feedback.passage) ?? [], plan: subject?.plan ?? null, changeAt });
  }, [subject, pane.kind, reviewing, review, shownText]);
  const sectionCount = useMemo(() => lessonSections(shownText).length, [shownText]);
  // On the main course's lesson: what a group's copy changed that hasn't reached it yet, neither in
  // its text nor in the draft waiting here ("Didn't fit"), done by hand with Edit section.
  const leftovers = useMemo(() => {
    const map = new Map<string, { group: string; steps: ProposedChange[][] }>();
    for (const candidate of improvements) {
      if (!candidate.fromCopy) continue;
      const left = changesNotIn(reviews.get(`improvement:${candidate.id}`)?.draft.markdown ?? current, candidate.fromCopy.changes);
      if (left.length) map.set(candidate.id, { group: candidate.fromCopy.group, steps: changeSteps(left) });
    }
    return map;
  }, [improvements, reviews, current]);
  const [comparingLeft, setComparingLeft] = useState<{ taskId: string; index: number } | null>(null);
  const [copiedLeft, setCopiedLeft] = useState<string | null>(null);

  // Hand edits to the part in focus (or the whole lesson when nothing is in focus).
  const [editing, setEditing] = useState<{ key: string; span: { start: number; end: number }; text: string } | null>(null);
  const sectionEditor = useRef<TextEditorHandle>(null);

  const draftChanges = (target: ViewImprovement) =>
    startTransition(async () => {
      setNotice(null);
      const result = await startLessonRevisionAction({
        curriculumVersionId: lesson.curriculumVersionId,
        lessonId: lesson.id,
        title: lesson.title,
        markdown: current,
        instruction: '',
        noteIds: target.noteIds,
        taskId: target.id,
        baseRevision: revision,
      });
      if (!result.ok) {
        setNotice({ text: result.message });
        return;
      }
      setOverrides((all) => ({ ...all, [`improvement:${target.id}`]: result.draft }));
    });

  /** "Draft again with it": the changes waiting go, and AI drafts them for all the feedback used now. */
  const draftAgain = (target: ViewImprovement, draft: LessonDraftView) => {
    void discardLessonDraftAction(draft.id);
    setOverrides((all) => ({ ...all, [`improvement:${target.id}`]: null }));
    draftChanges(target);
  };

  /**
   * A suggestion rewritten by hand: the draft takes the new text in its place (here only, until
   * Apply), and the change is kept as written. Emptied, it's skipped.
   */
  const editChange = (key: string, found: Review, change: ProposedChange, text: string) => {
    const blocks = splitBlocks(text);
    if (!blocks.length) {
      setDecisions((all) => ({ ...all, [`${found.draft.id}:${change.id}`]: 'skip' }));
      return;
    }
    const rewritten = found.changes.map((candidate) => (candidate.id === change.id ? { ...candidate, after: blocks } : candidate));
    const markdown = applyChanges(found.base, rewritten, () => true);
    const written = blocks.join('\n\n');
    const mine = proposeChanges(found.base, markdown).find((candidate) => candidate.after.join('\n\n') === written);
    if (mine) setEdited((all) => new Set(all).add(`${found.draft.id}:${mine.id}`));
    setOverrides((all) => ({ ...all, [key]: { ...found.draft, markdown, base: found.base } }));
  };

  const discard = (key: string, draft: LessonDraftView) => {
    setOverrides((all) => ({ ...all, [key]: null }));
    void discardLessonDraftAction(draft.id);
    setNotice({
      text: t('discarded'),
      undo: () => {
        void reopenLessonDraftAction(draft.id);
        setOverrides((all) => ({ ...all, [key]: draft }));
        setNotice(null);
      },
    });
  };

  // --- Saving: the review's last step ----------------------------------------------------------
  /** Saves the lesson's text (with what one improvement's changes answer); null when it couldn't, with why said. */
  const saveLesson = async (text: string, entry: Entry | null, fromRevision = revision) => {
    const formData = new FormData();
    formData.set('courseId', lesson.courseId);
    formData.set('lessonId', lesson.id);
    formData.set('title', lesson.title);
    formData.set('slug', lesson.slug);
    formData.set('status', lesson.status);
    formData.set('shortDescription', lesson.shortDescription);
    formData.set('arcId', lesson.arcId);
    formData.set('revision', String(fromRevision));
    formData.set('markdownContent', text);
    for (const reference of getPendingImageReferences(text)) {
      const asset = uploadedAssets[reference.sourcePath];
      if (asset) formData.append('uploadedAssetBinding', JSON.stringify({ assetId: asset.assetId, sourcePath: asset.sourcePath }));
      // A draft's new diagram: the server stores it from the draft.
      const from = asset ? undefined : draftDiagrams.find((item) => item.endsWith(`/${reference.sourcePath}`));
      if (from) formData.append('draftDiagram', JSON.stringify({ proposalId: from.slice(0, from.indexOf('/')), sourcePath: reference.sourcePath }));
    }
    // The improvement's drafts, its feedback, and what it changed (for the main course).
    if (entry) {
      formData.set(
        'lessonChange',
        JSON.stringify([
          {
            taskId: entry.taskId,
            proposalIds: entry.draftId ? [entry.draftId] : [],
            noteIds: entry.noteIds,
            applied: entry.applied,
            skipped: entry.skipped,
            before: entry.before,
            after: entry.after,
          },
        ])
      );
    }
    const result = await updateLessonInlineAction(formData);
    if (!result.ok) {
      setNotice({ text: result.message });
      return null;
    }
    return result;
  };

  /**
   * Saves one improvement's changes (or a draft's of no improvement, or a hand edit) and says what
   * that did: learners see it (a published lesson) or will at the next publish, the feedback marked
   * done, what waits for the next improvement or the main course. Undo puts the text from before
   * back, and the improvement, its feedback and its drafts where they were.
   */
  const saveEntry = async (entry: Entry): Promise<boolean> => {
    const result = await saveLesson(entry.after, entry);
    if (!result) return false;
    const changes: SavedLessonChange[] = result.changes ?? [];
    const savedRevision = result.revision ?? revision + 1;
    setCurrent(entry.after);
    setRevision(savedRevision);
    // The improvement it saved a change for: "See what changed" opens it (in Done once finished).
    const firstSaved = changes.find((change) => change.task)?.task?.id ?? changes.find((change) => change.taskId)?.taskId ?? null;
    const resolved = changes.reduce((sum, change) => sum + change.resolvedCommentIds.length, 0);
    const waits = changes.some((change) => change.waitsForPublish);
    const course = result.course;
    setNotice({
      text: [
        lesson.status === 'PUBLISHED' ? t('savedPublished') : t('savedDraft'),
        resolved ? t('feedbackDone', { count: resolved }) : waits ? t('feedbackWaits') : '',
        result.next ? t('savedNext', { count: result.next.count }) : '',
        course?.kind === 'drafted' ? t('courseWaits', { count: course.placed }) : course?.kind === 'suggested' ? t('courseSuggested') : course?.kind === 'differs' ? t('courseDiffers') : '',
      ]
        .filter(Boolean)
        .join(' · '),
      undo: () => undoSave(entry.before, changes, savedRevision),
      see: firstSaved
        ? () => {
            setNotice(null);
            show(changes.some((change) => change.task?.id === firstSaved) ? { kind: 'finished', id: firstSaved } : { kind: 'improvement', id: firstSaved });
          }
        : undefined,
      // Where the main course's part goes on: its lesson, with the changes waiting there (or to do there).
      open: course && course.kind !== 'suggested' ? { href: course.href, label: t('courseLeft.open') } : undefined,
    });
    router.refresh();
    return true;
  };

  /** Undo for a save: the text from before saved again, then what the save finished put back. */
  const undoSave = (before: string, changes: SavedLessonChange[], savedRevision: number) =>
    startTransition(async () => {
      setNotice(null);
      const result = await saveLesson(before, null, savedRevision);
      if (!result) return;
      await Promise.all(changes.map((change) => undoLessonChangeAction(change.id, change.task?.from ?? null)));
      setCurrent(before);
      setRevision(result.revision ?? savedRevision + 1);
      setNotice({ text: t('undone') });
      router.refresh();
    });

  /** The changes kept go into the lesson, saved (published, on a published lesson). */
  const apply = (found: Review, taskId: string | null, noteIds: string[]) =>
    startTransition(async () => {
      const keep = (change: ProposedChange) => actionable(found.states[change.id]) && decisionOf(found, change) === 'keep';
      const open = found.changes.filter((change) => actionable(found.states[change.id]));
      const result = applyOnto(found.base, current, found.changes, keep, (change) => found.states[change.id] === 'conflict');
      if (!result.applied) return;
      await saveEntry({ taskId, draftId: found.draft.id, before: current, after: result.text, applied: result.applied, skipped: open.length - result.applied, noteIds });
    });

  // --- Deciding on feedback: a tick (fix it with AI) counts right away ----------------------------
  // What a tick shows until the page brings the feedback back decided.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  useEffect(() => setTicked({}), [improvements, newFeedback]);
  // One at a time, in the order ticked: the first may start the lesson's improvement the rest join.
  const tickQueue = useRef(Promise.resolve());
  const tickCount = useRef(0);
  const tick = (feedback: ViewFeedback, use: boolean) => {
    setTicked((all) => ({ ...all, [feedback.id]: use }));
    tickCount.current += 1;
    tickQueue.current = tickQueue.current.then(async () => {
      try {
        if (use) {
          const result = await takeUpFeedbackAction(feedback.id);
          if (!result.ok) {
            setTicked((all) => ({ ...all, [feedback.id]: false }));
            setNotice({ text: result.error });
          } else if (result.afterDraft) setNotice({ text: t('used.afterDraft') });
        } else {
          await stopUsingFeedbackAction(feedback.id);
        }
      } catch {
        // Not saved: the tick goes back to what the page has, and later ticks still go through.
        setTicked((all) => ({ ...all, [feedback.id]: !use }));
      } finally {
        tickCount.current -= 1;
        if (!tickCount.current) router.refresh();
      }
    });
  };
  const [newWhy, setNewWhy] = useState(initialWhy);
  const [newError, setNewError] = useState<string | null>(null);
  const createNew = () =>
    startTransition(async () => {
      if (!newWhy.trim()) {
        setNewError(t('sayWhat'));
        return;
      }
      const result = await addToImprovementAction(lesson.id, newWhy);
      if (!result.ok) {
        setNewError(result.message);
        return;
      }
      setNewWhy('');
      setNewError(null);
      setNotice({ text: t('used.joined') });
      show({ kind: 'list' });
      router.refresh();
    });

  // Here or in the vault (for organisations that use it).
  const [confirmHere, setConfirmHere] = useState<ViewImprovement | null>(null);
  // Discarding a draft's changes (from the ⋯ menu) asks first; Undo still brings them back.
  const [confirmDiscard, setConfirmDiscard] = useState<{ key: string; draft: LessonDraftView } | null>(null);
  // A group's improvement kept to the group: the main course's lesson stays as it is (asks first).
  const [confirmKeep, setConfirmKeep] = useState<{ target: ViewImprovement; waiting: boolean } | null>(null);
  const keepToGroup = (target: ViewImprovement) =>
    startTransition(async () => {
      const { moved } = await leaveCourseAsItIsAction(target.id);
      setConfirmKeep(null);
      setNotice({ text: moved ? t('courseLeft.keptDone') : t('courseLeft.kept') });
      router.refresh();
    });
  const workHere = (target: ViewImprovement) =>
    startTransition(async () => {
      await workHereAction(target.id);
      setConfirmHere(null);
      setNotice(null);
      router.refresh();
    });

  // --- Moving through the column ----------------------------------------------------------------
  const [comparing, setComparing] = useState<number | null>(null);
  const [reading, setReading] = useState<number | null>(null);
  const show = (next: Pane) => {
    setPane(next);
    setShowColumn(true);
    setEditing(null);
    setComparing(null);
    window.history.replaceState(null, '', queryOf(next));
  };
  /** Where ‹ goes from a pane, and what it's called. */
  const backOf = (from: Pane): Pane =>
    from.kind === 'feedback' ? from.back : from.kind === 'used' && from.of ? { kind: 'improvement', id: from.of } : from.kind === 'finished' ? { kind: 'done' } : { kind: 'list' };
  const nameOf = (target: Pane) =>
    target.kind === 'done'
      ? tc('done')
      : target.kind === 'used'
        ? tc('feedback')
        : target.kind === 'improvement'
          ? excerpt(improvements.find((one) => one.id === target.id)?.label ?? t('earlier'), 28)
          : tc('toDo');

  // --- The plan step of the improvement shown ---------------------------------------------------------
  const plan = usePlanStep(subject, { aiEnabled, aiSlot: subject ? aiSlots[subject.id]?.plan : undefined, onStarted: (title) => setNotice({ text: t('started', { title }) }) });

  const courseLeftOf = (target: ViewImprovement) =>
    target.savedHere && !inVault(target) && target.others.every((other) => other.course || other.done) ? (target.others.find((other) => other.course && !other.done) ?? null) : null;
  const phaseOf = (target: ViewImprovement | null): Phase => {
    if (!target) return 'none';
    const key = `improvement:${target.id}`;
    if (inVault(target)) return 'vault';
    if (reviews.has(key)) return 'review';
    // A plan being written or edited keeps the column (someone's Claude reading the lesson meanwhile doesn't take it over).
    if (target.id === subject?.id && plan.busy) return 'planning';
    if (draftOf(key)?.state === 'working') return 'drafting';
    if (editing?.key === key) return 'handEdit';
    if (courseLeftOf(target)) return 'course';
    if (!target.plan) return 'decide';
    if (target.newSincePlan.length && !draftOf(key)) return 'stale';
    return 'planned';
  };
  const phase: Phase | 'draft' | 'finished' | 'done' =
    pane.kind === 'draft' ? 'draft' : pane.kind === 'finished' ? 'finished' : pane.kind === 'done' ? 'done' : phaseOf(subject);
  const deciding = phase === 'none' || phase === 'decide';

  // --- The feedback, as cards --------------------------------------------------------------------
  const lessonCards: Card[] = useMemo(
    () =>
      feedbackOrder(current, [
        ...(lessonImprovement?.feedback ?? []).map((one) => ({ ...one, used: true })),
        ...newFeedback.map((one) => ({ ...one, used: false })),
      ]).map((one) => (one.id in ticked ? { ...one, used: ticked[one.id] } : one)),
    [current, lessonImprovement, newFeedback, ticked]
  );
  const cardsOf = (target: ViewImprovement | null, own: boolean): Card[] =>
    own ? lessonCards : feedbackOrder(current, (target?.feedback ?? []).map((one) => ({ ...one, used: true })));
  const usedCount = lessonCards.filter((one) => one.used).length;
  const newCount = lessonCards.length - usedCount;
  /** Ticked or not here: on the lesson's own improvement, for whoever works on its feedback (not another lesson's feedback). */
  const canTick = (card: Card, own: boolean) => own && canWork && !card.lessonHref && (!card.used || lessonImprovement?.canWork !== false);
  const afterDraft = Boolean(lessonImprovement && draftOf(`improvement:${lessonImprovement.id}`));
  const passagesOf = (cards: Card[]): PassageMark[] => cards.flatMap((one) => (one.passage && !one.lessonHref ? [{ id: one.id, text: one.passage, used: one.used }] : []));
  const shownCards = pane.kind === 'improvement' || (pane.kind === 'used' && pane.of) ? cardsOf(subject, false) : lessonCards;
  const passages =
    pane.kind !== 'draft' && pane.kind !== 'finished' && pane.kind !== 'done' && (deciding || phase === 'planning' || phase === 'planned' || phase === 'stale') ? passagesOf(shownCards) : undefined;
  const openFeedback = (id: string, back: Pane) => show({ kind: 'feedback', id, back });

  const feedbackSection = (target: ViewImprovement | null, own: boolean, back: Pane) => {
    const cards = cardsOf(target, own);
    return (
      <section className={styles.group} aria-label={tc('feedback')}>
        <h3 className={styles.groupTitle}>{own && canWork ? tc('tickTitle') : tc('feedback')}</h3>
        {target?.asked ? <p className={styles.asked}>{target.asked}</p> : null}
        {cards.length ? (
          <ul className={styles.cards} data-testid="feedback-cards">
            {cards.map((card) => (
              <FeedbackCard
                key={card.id}
                feedback={card}
                used={card.used}
                selected={pane.kind === 'feedback' && pane.id === card.id}
                where={card.lessonHref ? tc('otherLesson') : tc('wholeLesson')}
                tickLabel={tc('fixWithAi')}
                onTick={canTick(card, own) ? () => tick(card, !card.used) : undefined}
                onOpen={() => openFeedback(card.id, back)}
              />
            ))}
          </ul>
        ) : !target?.asked ? (
          <p className={styles.empty}>{tc('noFeedback')}</p>
        ) : null}
        {own && canWork ? (
          <button type="button" className={styles.addButton} onClick={() => show({ kind: 'new' })} data-testid="new-improvement">
            <TbPlus aria-hidden size={16} /> {t('somethingElse')}
          </button>
        ) : null}
      </section>
    );
  };

  const pill = (state: RowState) => (
    <span className={styles.statePill} data-tone={state.tone} data-testid="row-state">
      {state.text}
    </span>
  );

  /** A finished improvement's row line: whether learners see what it changed. */
  const doneState = (target: DoneImprovement): RowState => {
    const saved = target.record?.saved ?? [];
    if (!saved.length) return target.record?.waiting.length ? { text: tr('statusWaiting'), tone: 'you' } : { text: t('state.done'), tone: 'done' };
    if (saved.some((one) => !one.seen)) return { text: tr('statusDraft'), tone: 'you' };
    const since = saved.map((one) => one.seenSince ?? one.savedAt).sort().at(-1) ?? saved[0].savedAt;
    return { text: tr('statusSeen', { date: new Date(since).toLocaleDateString(INTL_LOCALES[locale], { day: 'numeric', month: 'short' }) }), tone: 'done' };
  };

  // --- Pieces of the column -----------------------------------------------------------------------
  const published = lesson.status === 'PUBLISHED';
  /** The foot's end while reviewing: Save (Publish, on a published lesson) the changes kept, with why it can't yet. */
  const reviewActions = (found: Review, onApply: () => void) => {
    const open = found.changes.filter((change) => actionable(found.states[change.id]));
    const kept = open.filter((change) => decisionOf(found, change) === 'keep').length;
    if (!open.length) return <p className={styles.footHint}>{t('nothingToApply')}</p>;
    // Nothing kept: what to do instead of a button that does nothing.
    if (!kept) return <p className={styles.footHint}>{t('keepOne')}</p>;
    return (
      <>
        <button
          type="button"
          className={workspace.primaryButton}
          disabled={pending}
          onClick={onApply}
          title={published ? t('publishHint') : t('saveHint')}
          data-testid="apply-improvement"
        >
          {pending
            ? t('saving')
            : kept === open.length
              ? t(published ? 'publishAll' : 'saveAll', { count: kept })
              : t(published ? 'publishSome' : 'saveSome', { count: kept, total: open.length })}
        </button>
        <p className={styles.footHint}>{published ? t('publishHint') : t('saveHint')}</p>
      </>
    );
  };

  /** The changes as rows, numbered as their pins in the lesson: a tick to keep each, › to open it side by side. */
  const changesSection = (found: Review) => (
    <section className={styles.group} aria-label={tc('changesTitle')} data-testid="step-changes">
      <h3 className={styles.groupTitle}>{tc('changesTitle')}</h3>
      {found.draft.summary ? <p className={styles.summary}>{found.draft.summary}</p> : null}
      {found.draft.diagrams.length ? <p className={styles.quiet}>{t('addsDiagrams', { count: found.draft.diagrams.length })}</p> : null}
      <ul className={styles.changeList} data-testid="change-rows">
        {reviewSteps.map((step, index) => {
          const states = step.map((change) => found.states[change.id] ?? 'clean');
          const choosable = step.filter((_, k) => actionable(states[k]));
          const keep = choosable.length ? choosable.every((change) => decisionOf(found, change) === 'keep') : null;
          const mine = edited.has(`${found.draft.id}:${(step.find((change) => change.kind !== 'remove') ?? step[0]).id}`);
          const kind = mine ? t('yourVersion') : t(`kinds.${stepKind(step)}`);
          return (
            <ChangeRow
              key={step[0].id}
              number={index + 1}
              label={step[0].section ? `${kind} · ${step[0].section}` : kind}
              state={states[0] === 'gone' ? t('gone') : states[0] === 'done' ? t('alreadyIn') : states.includes('conflict') ? t('conflict') : null}
              keep={keep}
              current={reading === index}
              keepLabel={tc('keepChange')}
              openLabel={t('pinLabel', { index: index + 1, total: reviewSteps.length, kind })}
              onToggle={() => setDecisions((all) => ({ ...all, ...Object.fromEntries(choosable.map((change) => [`${found.draft.id}:${change.id}`, keep ? 'skip' : 'keep'])) }))}
              onOpen={() => setComparing(index)}
            />
          );
        })}
      </ul>
    </section>
  );

  /** AI writing the changes, here or in someone's own Claude: what it's doing, for how long, how much is written. */
  const workingBlock = (key: string, draft: LessonDraftView) => {
    const claude = draft.source === 'claude';
    const label = claude
      ? draft.stage === 'waiting'
        ? t(draft.by ? 'working.claude.waitingOther' : 'working.claude.waiting')
        : t(draft.stage === 'reading' ? 'working.claude.reading' : 'working.claude.writing')
      : t(`working.stages.${draft.stage === 'waiting' ? 'reading' : draft.stage}`);
    const share = draft.stage === 'writing' ? draft.share : null;
    const quiet = Date.now() - new Date(draft.startedAt).getTime() > QUIET_MS;
    return (
      <div className={styles.working}>
        <AiWorking
          label={label}
          startedAt={draft.startedAt}
          timeLabel={(time) => t('working.elapsed', { time })}
          meta={[draft.by ? t('working.startedBy', { name: draft.by }) : null, share !== null ? t('working.share', { percent: Math.round(share * 100) }) : null]}
          share={share}
          detail={!claude ? t('working.leave') : draft.stage === 'waiting' ? (quiet ? t('working.notStarted') : t('working.send')) : t('working.inClaude')}
          actions={
            <button
              type="button"
              className={workspace.ghostButton}
              onClick={() => {
                void stopLessonRevisionAction(draft.id);
                setOverrides((all) => ({ ...all, [key]: null }));
              }}
            >
              {t('working.stop')}
            </button>
          }
          testId="changes-working"
        />
      </div>
    );
  };

  /** Why it's being done, in one line: how many pieces of feedback, and the first in its writer's words. */
  const whyValue = (feedback: ViewFeedback[], wanted: string | null) =>
    feedback.length
      ? `${feedback.length > 1 ? `${t('feedbackCount', { count: feedback.length })} · ` : ''}“${excerpt(feedback[0].body || feedback[0].passage, 72)}”`
      : excerpt(wanted ?? t('noFeedback'), 72);
  /** The feedback it used, each in its writer's words. */
  const whyBody = (feedback: ViewFeedback[], wanted: string | null) =>
    feedback.length ? (
      <div className={styles.feedbackList} data-testid="used-feedback">
        {feedback.map((one) => (
          <blockquote key={one.id} className={styles.quote}>
            {one.passage ? <span className={styles.passage}>“{one.passage}”</span> : null}
            <span>{one.body}</span>
            <cite className={styles.who}>{one.who}</cite>
          </blockquote>
        ))}
      </div>
    ) : (
      <p className={wanted ? styles.plan : styles.quiet}>{wanted ?? t('noFeedback')}</p>
    );

  /**
   * A group's improvement saved here, with the main course's lesson still to change (its plan sends
   * it there too): what's left, and where it goes on.
   */
  const courseNote = (target: ViewImprovement, course: ViewImprovement['others'][number]) => (
    <div className={styles.appliedNote} role="status" data-testid="course-note">
      <TbCircleCheck aria-hidden size={20} />
      <div className={styles.noteBody}>
        <strong>{t('courseLeft.title')}</strong>
        <p>{course.phase === 'review' ? t('courseLeft.review', { count: course.toReview }) : course.phase === 'writing' ? t('courseLeft.writing') : t('courseLeft.toChange')}</p>
        <div className={styles.noteActions}>
          {course.href ? (
            <Link href={course.href} className={`${workspace.primaryButton} ${styles.noteLink}`} data-testid="open-course-lesson">
              {t('courseLeft.open')}
            </Link>
          ) : null}
          {target.canWork && target.choosesScope ? (
            <button type="button" className={workspace.ghostButton} disabled={pending} onClick={() => setConfirmKeep({ target, waiting: course.phase !== 'toChange' })} data-testid="keep-to-group">
              {t('courseLeft.keep')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  /** The rare actions on an improvement: its page, Discard the changes waiting. */
  const menuOf = (target: ViewImprovement): AdminMenuItem[] => {
    const key = `improvement:${target.id}`;
    const found = reviews.get(key);
    const items: AdminMenuItem[] = [{ label: t('improvementDetails'), href: `/admin/tasks/${target.id}` }];
    if (found) items.push({ label: t('discardChanges'), danger: true, onSelect: () => setConfirmDiscard({ key, draft: found.draft }) });
    return items;
  };

  /** Other work on this lesson, under the lesson's own: earlier improvements (a group copy's, on the main course's lesson) and revisions of none. */
  const earlier = improvements.filter((candidate) => !candidate.current);
  const otherWork =
    earlier.length || shownDrafts.length ? (
      <section className={styles.group} aria-label={t('earlier')}>
        <h3 className={styles.groupTitle}>{t('earlier')}</h3>
        <ul className={styles.navList} data-testid="earlier-list">
          {earlier.map((candidate) => (
            <NavRow key={candidate.id} title={candidate.label} sub={candidate.whereLabel} state={pill(stateOf(candidate))} onOpen={() => show({ kind: 'improvement', id: candidate.id })} />
          ))}
          {shownDrafts.map((draft) => {
            const found = reviews.get(`draft:${draft.id}`);
            return (
              <NavRow
                key={draft.id}
                title={draft.summary ? excerpt(draft.summary, 64) : draft.source === 'claude' ? (draft.by ? t('fromClaudeBy', { name: draft.by }) : t('fromClaude')) : t('draftedHere')}
                state={pill(found ? { text: t('state.toReview', { count: reviewCount(found) }), tone: 'you' } : { text: t('state.writing'), tone: 'working' })}
                onOpen={() => show({ kind: 'draft', id: draft.id })}
              />
            );
          })}
        </ul>
      </section>
    ) : null;

  /**
   * An improvement's work, one step at a time, with the step's primary button for the foot: its
   * feedback to tick (the lesson's own) and Plan; the plan and Draft; AI writing; the changes to tick
   * and Publish; or where it is instead (Obsidian, the main course's lesson).
   */
  const flow = (target: ViewImprovement | null, own: boolean): { body: ReactNode; foot: ReactNode } => {
    const back: Pane = own ? { kind: 'list' } : { kind: 'improvement', id: target?.id ?? '' };
    if (!target) {
      return {
        body: (
          <>
            {feedbackSection(null, own, back)}
            {own ? otherWork : null}
          </>
        ),
        foot: canWork ? <p className={styles.footHint}>{tc('tickHint')}</p> : null,
      };
    }
    const key = `improvement:${target.id}`;
    const step = phaseOf(target);
    const found = reviews.get(key) ?? null;
    const draft = draftOf(key);
    const left = leftovers.get(target.id) ?? null;
    // Feedback used after the changes were drafted: it waits for the next draft (or the next improvement).
    const later =
      draft && (found || draft.state === 'working')
        ? target.feedback.filter((one) => !one.lessonHref && (draft.noteIds ? !draft.noteIds.includes(one.id) : Boolean(one.joinedAt && one.joinedAt > draft.startedAt)))
        : [];
    const startHandEdit = () => {
      const span = (focus.length ? sectionSpan(current, focus) : null) ?? { start: 0, end: current.length };
      setEditing({ key, span, text: current.slice(span.start, span.end).trimEnd() });
    };
    const editLabel = focus.length ? t('editSection') : t('editLesson');
    const feedbackValue = own ? `${tc('toFix', { count: usedCount })}${newCount ? ` · ${tc('newCount', { count: newCount })}` : ''}` : whyValue(target.feedback, target.asked);
    // The instructor's notes for AI, while the plan is being made (an improvement with feedback).
    const notesRow =
      target.feedback.length && (step === 'decide' || step === 'planning' || step === 'planned' || step === 'stale') ? (
        <NotesForAi key={`${target.id}:${target.notes}`} taskId={target.id} notes={target.notes} planned={Boolean(target.plan)} canEdit={target.canWork} />
      ) : null;
    const rows = (
      <SheetRows testId="context-rows">
        {step === 'review' || step === 'drafting' || step === 'handEdit' || step === 'course' || step === 'vault' ? (
          <SheetRow label={t('planLabel')} value={target.plan ? excerpt(plainText(target.plan), 72) : t('noPlan')} testId="step-plan">
            {target.plan ? <PlanText plan={target.plan} /> : <p className={styles.quiet}>{t('noPlan')}</p>}
          </SheetRow>
        ) : null}
        <SheetOpenRow label={tc('feedback')} value={feedbackValue} onClick={() => show({ kind: 'used', of: own ? null : target.id })} testId="step-why" />
        {notesRow}
        {left ? (
          <SheetOpenRow
            label={t('didntFit.row')}
            value={t('didntFit.value', { count: left.steps.length, group: left.group })}
            onClick={() => setComparingLeft({ taskId: target.id, index: 0 })}
            testId="didnt-fit"
          />
        ) : null}
        {target.savedHere && target.record?.saved.length && step !== 'review' ? (
          <SheetRow label={tr('savedSoFar')} value={t('changeCount', { count: target.record.saved.reduce((sum, saved) => sum + (saved.changes?.length ?? 0), 0) })} testId="saved-so-far">
            <WhatChanged taskId={target.id} record={target.record} hereLessonId={lesson.id} assets={assets} />
          </SheetRow>
        ) : null}
        {target.others.length ? (
          <SheetRow label={t('otherLessons')} value={target.others.length > 1 ? t('otherCount', { count: target.others.length }) : `${target.others[0].label} · ${target.others[0].state}`}>
            <ul className={styles.others}>
              {target.others.map((other, index) => (
                <li key={`${other.label}${index}`}>
                  {other.href ? <Link href={other.href}>{other.label}</Link> : other.label} <span className={styles.quiet}>· {other.state}</span>
                </li>
              ))}
            </ul>
          </SheetRow>
        ) : null}
      </SheetRows>
    );
    const planSection = (
      <section className={styles.group} aria-label={t('planLabel')} data-testid="step-plan">
        <h3 className={styles.groupTitle}>{t('planLabel')}</h3>
        {plan.view ?? <p className={styles.quiet}>{t('noPlan')}</p>}
      </section>
    );
    const laterNote = later.length ? (
      <p className={styles.laterNote} data-testid="later-note">
        {t('later.note', { count: later.length })}{' '}
        {found && aiEnabled && target.canWork ? (
          <button type="button" className={workspace.textButton} disabled={pending} onClick={() => draftAgain(target, found.draft)} data-testid="draft-again">
            {t('later.again', { count: later.length })}
          </button>
        ) : null}
      </p>
    ) : null;
    const errorLine = plan.error ? <p className={styles.error}>{plan.error}</p> : null;

    let body: ReactNode = null;
    let foot: ReactNode = null;
    switch (step) {
      case 'vault':
        body = (
          <>
            {rows}
            <p className={styles.quiet}>{t('vaultHint')}</p>
          </>
        );
        foot = target.canWork ? (
          <button type="button" className={workspace.primaryButton} disabled={pending} onClick={() => (target.aiReady ? setConfirmHere(target) : workHere(target))}>
            {t('workHere')}
          </button>
        ) : null;
        break;
      case 'review':
        body = (
          <>
            {rows}
            {laterNote}
            {found ? changesSection(found) : null}
          </>
        );
        foot = found ? reviewActions(found, () => apply(found, target.id, found.draft.noteIds ?? target.noteIds)) : null;
        break;
      case 'drafting':
        body = (
          <>
            {rows}
            {laterNote}
            {draft ? workingBlock(key, draft) : null}
          </>
        );
        break;
      case 'handEdit':
        body = (
          <>
            {rows}
            <p className={styles.quiet}>{t('editHint')}</p>
          </>
        );
        foot = editing ? (
          <div className={styles.footRow}>
            <button type="button" className={workspace.ghostButton} onClick={() => setEditing(null)}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className={workspace.primaryButton}
              disabled={pending}
              data-testid="save-edit"
              onClick={() =>
                startTransition(async () => {
                  const after = spliceSpan(current, editing.span, sectionEditor.current?.read() ?? editing.text);
                  // Saved like changes AI drafted: for the improvement, answering its feedback.
                  if (after.trim() !== current.trim() && !(await saveEntry({ taskId: target.id, draftId: null, before: current, after, applied: 0, skipped: 0, noteIds: target.noteIds }))) return;
                  setEditing(null);
                })
              }
            >
              {pending ? t('saving') : published ? t('publishEdit') : t('saveEdit')}
            </button>
          </div>
        ) : null;
        break;
      case 'course': {
        const course = courseLeftOf(target);
        body = (
          <>
            {rows}
            {course ? courseNote(target, course) : null}
          </>
        );
        break;
      }
      case 'planning':
        body = (
          <>
            {planSection}
            {rows}
          </>
        );
        break;
      case 'decide':
        body = (
          <>
            {plan.view ? planSection : null}
            {feedbackSection(target, own, back)}
            {notesRow ? <SheetRows>{notesRow}</SheetRows> : null}
            {own ? otherWork : null}
          </>
        );
        if (target.canWork && (target.feedback.length || target.asked)) {
          foot = (
            <>
              {errorLine}
              <button
                type="button"
                className={workspace.primaryButton}
                disabled={plan.pending}
                onClick={() => (aiEnabled ? plan.planWithAi() : plan.write())}
                data-testid={aiEnabled ? 'plan-with-ai' : 'plan-yourself'}
              >
                {aiEnabled ? (
                  <>
                    <TbSparkles aria-hidden size={16} /> {tc('plan')}
                  </>
                ) : (
                  t('planStep.write')
                )}
              </button>
              <p className={styles.footHint}>
                {tc('ticked', { count: own ? usedCount : target.feedback.length })}
                {aiEnabled ? (
                  <>
                    {' · '}
                    <button type="button" className={workspace.textButton} onClick={plan.write} data-testid="plan-yourself">
                      {tc('writePlan')}
                    </button>
                  </>
                ) : null}
              </p>
            </>
          );
        } else if (own && canWork) foot = <p className={styles.footHint}>{tc('tickHint')}</p>;
        break;
      case 'stale':
      case 'planned': {
        const byHand = Boolean(left);
        body = (
          <>
            {planSection}
            {rows}
            {left ? (
              <p className={styles.didntFitNote} data-testid="didnt-fit-note">
                {t('didntFit.note', { count: left.steps.length, group: left.group })}
              </p>
            ) : null}
            {own ? otherWork : null}
          </>
        );
        if (!target.canWork) break;
        if (step === 'stale') {
          foot = (
            <>
              {errorLine}
              <button
                type="button"
                className={workspace.primaryButton}
                disabled={plan.pending}
                onClick={() => (aiEnabled ? plan.planWithAi(true) : plan.keepAsItIs())}
                data-testid={aiEnabled ? 'update-plan' : 'keep-plan'}
              >
                {aiEnabled ? (
                  <>
                    <TbSparkles aria-hidden size={16} /> {t('planStep.update')}
                  </>
                ) : (
                  tc('keepPlan')
                )}
              </button>
              {aiEnabled ? (
                <p className={styles.footHint}>
                  <button type="button" className={workspace.textButton} disabled={plan.pending} onClick={plan.keepAsItIs} data-testid="keep-plan">
                    {tc('keepPlan')}
                  </button>
                </p>
              ) : null}
            </>
          );
          break;
        }
        // What a group's copy did, left to do here by hand: Edit section leads, AI is the other way.
        const drafts = aiEnabled ? (
          <button type="button" className={byHand ? workspace.textButton : workspace.primaryButton} disabled={pending} onClick={() => draftChanges(target)} data-testid="draft-changes">
            {byHand ? null : <TbSparkles aria-hidden size={16} />} {tc('draft')}
          </button>
        ) : null;
        const handEdit = (
          <button type="button" className={byHand || !aiEnabled ? workspace.primaryButton : workspace.textButton} onClick={startHandEdit} data-testid="edit-yourself">
            {editLabel}
          </button>
        );
        foot =
          byHand || !aiEnabled ? (
            <>
              {handEdit}
              {drafts ? <p className={styles.footHint}>{drafts}</p> : null}
            </>
          ) : (
            <>
              {drafts}
              <p className={styles.footHint}>{handEdit}</p>
            </>
          );
        break;
      }
    }
    return { body, foot };
  };

  // --- The column's content for what it shows -----------------------------------------------------
  const notFound = <p className={styles.empty}>{t('nothingHere')}</p>;
  let menu: AdminMenuItem[] = [];
  let body: ReactNode = null;
  let foot: ReactNode = null;
  // The plan's "in your Claude ↗" stays mounted while the plan shows (see `usePlanStep`), seen only on the improvement's own steps.
  const keepsPlanSlot = subject && (phase === 'decide' || phase === 'planning' || phase === 'planned' || phase === 'stale');
  const onSteps = pane.kind === 'list' || pane.kind === 'improvement';
  if (pane.kind === 'list') {
    const parts = flow(lessonImprovement, true);
    body = parts.body;
    foot = parts.foot;
    if (lessonImprovement) menu = menuOf(lessonImprovement);
  } else if (pane.kind === 'improvement') {
    if (subject) {
      const parts = flow(subject, false);
      body = (
        <>
          <div className={styles.paneHead}>
            <h2 className={styles.itemTitle}>{subject.label}</h2>
            <p className={styles.subtitle}>{[subject.whereLabel, inVault(subject) ? t('inVault') : ''].filter(Boolean).join(' · ')}</p>
          </div>
          {parts.body}
        </>
      );
      foot = parts.foot;
      menu = menuOf(subject);
    } else body = notFound;
  } else if (pane.kind === 'used') {
    const own = !pane.of;
    const target = own ? lessonImprovement : subject;
    body = (
      <>
        {own && target?.plan ? <p className={styles.quiet}>{afterDraft ? tc('usedHintDrafted') : tc('usedHintPlan')}</p> : null}
        {feedbackSection(target, own, pane)}
      </>
    );
  } else if (pane.kind === 'feedback') {
    const own = !(pane.back.kind === 'improvement' || (pane.back.kind === 'used' && pane.back.of));
    const card = (own ? lessonCards : cardsOf(subject, false)).find((one) => one.id === pane.id) ?? null;
    body = card ? (
      <FeedbackDetail
        key={card.id}
        feedback={card}
        used={card.used}
        canWork={canWork && own}
        afterDraft={afterDraft}
        pending={false}
        onTick={canTick(card, own) ? () => tick(card, !card.used) : undefined}
        onAnswered={(text) => {
          setNotice({ text });
          show(pane.back);
        }}
        onNotice={(text) => setNotice({ text })}
      />
    ) : (
      notFound
    );
  } else if (pane.kind === 'new') {
    body = (
      <div className={styles.newForm}>
        <h2 className={styles.itemTitle}>{t('newTitle')}</h2>
        <p className={styles.quiet}>{t('newHint')}</p>
        <textarea
          className={styles.planBox}
          value={newWhy}
          onChange={(event) => {
            setNewWhy(event.target.value);
            setNewError(null);
          }}
          placeholder={t('newPlaceholder')}
          aria-label={t('newTitle')}
          data-testid="new-improvement-why"
          autoFocus
        />
        {newError ? <p className={styles.error}>{newError}</p> : null}
      </div>
    );
    foot = (
      <button type="button" className={workspace.primaryButton} disabled={pending} onClick={createNew} data-testid="create-improvement">
        {t('newStart')}
      </button>
    );
  } else if (pane.kind === 'draft') {
    const key = `draft:${pane.id}`;
    const draft = draftOf(key);
    if (draft) {
      body = (
        <>
          <div className={styles.paneHead}>
            <h2 className={styles.itemTitle}>{draft.source === 'claude' ? (draft.by ? t('fromClaudeBy', { name: draft.by }) : t('fromClaude')) : t('draftedHere')}</h2>
            <p className={styles.subtitle}>{t('looseHint')}</p>
          </div>
          {draft.state === 'working' ? workingBlock(key, draft) : review ? changesSection(review) : null}
        </>
      );
      foot = review ? reviewActions(review, () => apply(review, null, [])) : null;
      if (review) menu = [{ label: t('discardChanges'), danger: true, onSelect: () => setConfirmDiscard({ key, draft: review.draft }) }];
    } else body = notFound;
  } else if (pane.kind === 'done') {
    body = (
      <section className={styles.group} aria-label={tc('finished')}>
        <h3 className={styles.groupTitle}>{tc('finished')}</h3>
        {done.length ? (
          <ul className={styles.navList} data-testid="done-list">
            {done.map((one) => (
              <NavRow key={one.id} title={one.label} sub={one.whereLabel} state={pill(doneState(one))} onOpen={() => show({ kind: 'finished', id: one.id })} />
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>{t('noneDone')}</p>
        )}
      </section>
    );
  } else if (pane.kind === 'finished' && finished) {
    body = (
      <>
        <div className={styles.paneHead}>
          <h2 className={styles.itemTitle}>{finished.label}</h2>
          <p className={styles.subtitle}>{finished.whereLabel}</p>
        </div>
        <SheetRows testId="context-rows">
          <SheetRow label={t('why')} value={whyValue(finished.feedback, finished.asked)} testId="step-why">
            {whyBody(finished.feedback, finished.asked)}
          </SheetRow>
          <SheetRow label={t('planLabel')} value={finished.plan ? excerpt(plainText(finished.plan), 72) : t('noPlan')} testId="step-plan">
            {finished.plan ? <PlanText plan={finished.plan} /> : <p className={styles.quiet}>{t('noPlan')}</p>}
          </SheetRow>
        </SheetRows>
        <section className={styles.group} aria-label={tr('title')} data-testid="step-what-changed">
          <h3 className={styles.groupTitle}>{tr('title')}</h3>
          <WhatChanged taskId={finished.id} record={finished.record} hereLessonId={lesson.id} assets={assets} />
        </section>
      </>
    );
    menu = [{ label: t('improvementDetails'), href: `/admin/tasks/${finished.id}` }];
  }
  // Or Claude applies the plan: its draft comes back here to review.
  const changesSlot = subject && onSteps && phase === 'planned' && !leftovers.get(subject.id) ? aiSlots[subject.id]?.changes : null;

  // --- The lesson as the column's work shows it ----------------------------------------------------
  // A finished improvement's changes, marked where they still are.
  const appliedBlocks = useMemo(() => {
    const blocks = new Set<string>();
    for (const saved of finished?.record?.saved ?? []) {
      if (saved.lessonId !== lesson.id) continue;
      for (const change of saved.changes ?? []) for (const block of change.after) blocks.add(normalBlock(block));
    }
    return blocks.size ? blocks : undefined;
  }, [finished, lesson.id]);
  /** Under a change opened side by side: the feedback whose passage is in its section. */
  const answers = (step: ProposedChange[]) => {
    if (!review || !subject) return null;
    const matching = subject.feedback.filter((one) => one.passage && !one.lessonHref && passageHeading(review.base, one.passage) === step[0].section);
    if (!matching.length) return null;
    const quote = excerpt(matching[0].body || matching[0].passage, 90);
    return matching.length > 1 ? tc('forMore', { quote, count: matching.length - 1 }) : tc('for', { quote });
  };
  const working = draftOf(subjectKey)?.state === 'working';
  const lessonPart = (
    <div className={styles.part} data-testid="lesson-part" data-working={working ? 'true' : undefined}>
      {reviewing || editing ? (
        <div className={styles.partHead}>
          <span className={styles.label}>{reviewing ? t('proposed') : focus.length ? t('editSection') : t('editLesson')}</span>
        </div>
      ) : null}
      {editing && editing.key === subjectKey ? (
        <TextEditor ref={sectionEditor} initial={editing.text} assets={assets} label={t('editSection')} />
      ) : (
        <LessonPart
          text={shownText}
          focus={deciding ? [] : focus}
          changes={
            reviewing && review
              ? {
                  list: review.changes,
                  states: review.states,
                  decisionOf: (change) => decisionOf(review, change),
                  onDecide: (change, value) => setDecisions((all) => ({ ...all, [`${review.draft.id}:${change.id}`]: value })),
                  onEdit: (change, text) => editChange(subjectKey, review, change, text),
                  isEdited: (change) => edited.has(`${review.draft.id}:${change.id}`),
                }
              : null
          }
          appliedBlocks={appliedBlocks}
          assets={assets}
          comparing={comparing}
          onCompare={setComparing}
          onReading={setReading}
          note={answers}
          passages={passages}
          selectedPassage={pane.kind === 'feedback' ? pane.id : null}
          onPassage={(id) => openFeedback(id, pane.kind === 'improvement' ? pane : { kind: 'list' })}
        />
      )}
    </div>
  );
  // On a phone, the lesson ends with a bar naming the column's step; it opens the column.
  const barLabel =
    pane.kind === 'done' || pane.kind === 'finished'
      ? tc('done')
      : reviewing
        ? tc('barChanges', { count: reviewSteps.length })
        : deciding
          ? tc('barFeedback', { count: usedCount })
          : working
            ? t('state.writing')
            : t('planLabel');

  // --- Layout ----------------------------------------------------------------------------------
  // The column fills the window from where the view starts (all of it once scrolled past) to where
  // it ends, so its foot's button stays in view while the lesson scrolls.
  const viewRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = viewRef.current;
    const columns = columnsRef.current;
    if (!view || !columns) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = Math.max(0, columns.getBoundingClientRect().top);
        const below = Math.max(0, window.innerHeight - view.getBoundingClientRect().bottom);
        columns.style.setProperty('--column-height', `${Math.max(320, window.innerHeight - top - below)}px`);
      });
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);
  const topLevel = pane.kind === 'list' || pane.kind === 'done';
  return (
    <div ref={viewRef} className={styles.view} data-testid="improvements-view">
      <header className={styles.toolbar}>
        <span className={styles.lessonName}>{lesson.title}</span>
        <span className={styles.level}>{levelLabel}</span>
        {/* Nothing waits unsaved here (saving is the review's last step), but a hand edit being written. */}
        <LessonModeSwitch mode="improve" editHref={editHref} improveHref="#" improveCount={improveCount} unsaved={Boolean(editing)} />
        <span className={styles.spacer} />
      </header>

      <div ref={columnsRef} className={styles.columns} data-pane={showColumn ? 'column' : 'lesson'}>
        <section className={styles.lesson} aria-label={lesson.title}>
          {lessonPart}
          <button type="button" className={styles.columnBar} onClick={() => setShowColumn(true)} data-testid="column-bar">
            <span>{barLabel}</span>
            <TbChevronRight aria-hidden size={18} />
          </button>
        </section>

        <aside className={styles.column} aria-label={t('listLabel')} data-testid="improvement-detail">
          <div className={styles.columnHead}>
            {topLevel ? (
              <>
                <button type="button" className={styles.toLesson} onClick={() => setShowColumn(false)}>
                  <TbChevronLeft aria-hidden size={16} /> {tc('lesson')}
                </button>
                <div className={`${workspace.segmented} ${styles.columnSegments}`} role="group" aria-label={t('listLabel')}>
                  <button type="button" aria-pressed={pane.kind === 'list'} className={pane.kind === 'list' ? workspace.segmentActive : workspace.segment} onClick={() => show({ kind: 'list' })}>
                    {t('open', { count: improveCount })}
                  </button>
                  <button type="button" aria-pressed={pane.kind === 'done'} className={pane.kind === 'done' ? workspace.segmentActive : workspace.segment} onClick={() => show({ kind: 'done' })}>
                    {t('done', { count: done.length })}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className={styles.columnBack} onClick={() => show(backOf(pane))} data-testid="column-back">
                <TbChevronLeft aria-hidden size={18} /> {nameOf(backOf(pane))}
              </button>
            )}
            {menu.length ? <AdminMenu items={menu} /> : null}
          </div>
          <div className={styles.columnBody}>
            {notice ? (
              <p className={styles.notice} role="status" data-testid="improvements-notice">
                {notice.text}
                {notice.open ? (
                  <>
                    {' '}
                    <Link href={notice.open.href} className={workspace.textButton} data-testid="notice-open-course">
                      {notice.open.label}
                    </Link>
                  </>
                ) : null}
                {notice.see ? (
                  <>
                    {' '}
                    <button type="button" className={workspace.textButton} onClick={notice.see} data-testid="see-what-changed">
                      {tr('seeWhatChanged')}
                    </button>
                  </>
                ) : null}
                {notice.undo ? (
                  <>
                    {' '}
                    <button type="button" className={workspace.textButton} onClick={notice.undo}>
                      {t('undo')}
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
            {body}
          </div>
          <div className={styles.columnFoot} data-testid="column-foot">
            {foot}
            {keepsPlanSlot && plan.slot ? <div hidden={!(onSteps && plan.slotOpen)}>{plan.slot}</div> : null}
            {changesSlot}
          </div>
        </aside>
      </div>
      <ConfirmDialog
        open={Boolean(confirmDiscard)}
        title={t('discardTitle')}
        description={t('discardText')}
        confirmLabel={t('discard')}
        tone="danger"
        onConfirm={() => {
          if (confirmDiscard) discard(confirmDiscard.key, confirmDiscard.draft);
          setConfirmDiscard(null);
        }}
        onClose={() => setConfirmDiscard(null)}
      />
      <ConfirmDialog
        open={Boolean(confirmKeep)}
        title={t('courseLeft.keepTitle')}
        description={confirmKeep?.waiting ? t('courseLeft.keepTextWaiting') : t('courseLeft.keepText')}
        confirmLabel={t('courseLeft.keep')}
        pending={pending}
        onConfirm={() => confirmKeep && keepToGroup(confirmKeep.target)}
        onClose={() => setConfirmKeep(null)}
      />
      {(() => {
        const left = comparingLeft ? leftovers.get(comparingLeft.taskId) : null;
        return (
          <CompareSheet
            steps={left?.steps ?? []}
            index={left ? comparingLeft!.index : null}
            onIndex={(index) => setComparingLeft((value) => (value ? { ...value, index } : value))}
            onClose={() => {
              setComparingLeft(null);
              setCopiedLeft(null);
            }}
            assets={assets}
            labels={left ? { before: t('didntFit.before', { group: left.group }), after: t('didntFit.after', { group: left.group }) } : undefined}
            actions={(step) => {
              // The new text, to put in by hand with Edit section (its images come along on Save).
              const text = editableOf(step)?.after.join('\n\n');
              if (!text) return null;
              return (
                <button
                  type="button"
                  className={workspace.ghostButton}
                  onClick={() => {
                    void navigator.clipboard?.writeText(text).then(() => setCopiedLeft(step[0].id));
                  }}
                  data-testid="copy-new-text"
                >
                  {copiedLeft === step[0].id ? t('didntFit.copied') : t('didntFit.copy')}
                </button>
              );
            }}
          />
        );
      })()}
      <ConfirmDialog
        open={Boolean(confirmHere)}
        title={t('workHereTitle')}
        description={t('workHereText')}
        confirmLabel={t('workHere')}
        pending={pending}
        onConfirm={() => confirmHere && workHere(confirmHere)}
        onClose={() => setConfirmHere(null)}
      />
    </div>
  );
}
