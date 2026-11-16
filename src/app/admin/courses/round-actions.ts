'use server';

import { AiProposalKind, AiProposalStatus, Permission, type Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { AI_LANGUAGES, backgroundAiKey, sortVersionFeedback } from '@/lib/ai';
import { currentDraft, loadDraft, settleDraft, startAppDraft } from '@/lib/ai-drafts';
import { accessScope, canWorkOnFeedback, commentScopeWhere, loadCommentRef, requireVersionEdit, type CrmViewer } from '@/lib/crm-access';
import { resolveComment, respondToComment } from '@/lib/curriculum-comments';
import { listFeedback } from '@/lib/feedback-list';
import { isFeedbackUsed, lessonImprovement, stopUsingFeedback, takeUpFeedback } from '@/lib/lesson-improvement';
import { lessonSections, passageHeading } from '@/lib/lesson-sections';
import { planBody, withPlanScope } from '@/lib/plan-scope';
import { prisma } from '@/lib/prisma';
import { cleanDecisions, cleanEdit, cleanRound, type RoundDecisions, type RoundLessonInput, type RoundNote, type RoundPlan } from '@/lib/version-round-rules';
import { courseContext } from './ai-context';
import { improveLesson } from './improvement-run';

/**
 * "Improve": all new feedback of a course version or a group's copy, sorted by AI in one go (a
 * FEEDBACK_ROUND draft on the version) and worked through on one page. Sorted, each lesson's notes
 * join its improvement with the plan and its changes are drafted (`draftRoundAction`, which the page
 * calls by itself). The person keeps or skips each change there and publishes the lessons (the
 * lesson's own save, `updateLessonInlineAction`); `settleRoundAction` then sends the replies they
 * confirmed and takes the published lessons off the round, which ends when no lesson is left.
 * Replies are always the person's: AI only suggests. Nothing reaches learners by itself. Every
 * action checks the person may edit the version and work on its feedback.
 */

/** At most this many notes in one round, whole lessons at a time; the rest wait for the next. */
const ROUND_NOTES = 120;
/** Lessons whose changes are drafted in one go; the page asks for the next ones ("Draft more"). */
const ROUND_DRAFTS = 10;

/** What a round keeps, besides what AI writes while it's at it. */
export type RoundPayload = {
  round?: RoundPlan;
  /** The notes it sorts, with each one's lesson, and the lessons (whether the main course has them). */
  noteLessons?: Record<string, string>;
  lessons?: Array<{ id: string; reachesCourse: boolean }>;
  /** New notes it doesn't sort (over the cap, or on lessons whose changes wait for review). */
  more?: number;
  /** The lessons whose changes were drafted for this round, each with its improvement. */
  drafted?: Record<string, string>;
  /** Keep or skip for each change decided on the page (`<draft>:<change>`); the rest are undecided. */
  decisions?: RoundDecisions;
};

async function roundAccess(versionId: string) {
  const viewer = await requireVersionEdit(versionId, [Permission.WRITE]);
  const version = await prisma.curriculumVersion.findUnique({ where: { id: versionId }, select: { id: true, courseId: true, ownerGroupId: true } });
  if (!version || !canWorkOnFeedback(viewer, { courseId: version.courseId, groupIds: version.ownerGroupId ? [version.ownerGroupId] : [] }, 'tasks')) return null;
  return { viewer, version };
}

/** The version's new feedback, read with the person's rights, lesson by lesson, and what AI reads of each lesson. */
async function roundInputs(viewer: CrmViewer, version: { id: string; ownerGroupId: string | null }) {
  const rows = (
    await listFeedback({ AND: [commentScopeWhere(accessScope(viewer, 'comments')), { curriculumVersionId: version.id }] }, 'open', { take: 500 })
  ).filter((row) => row.stage === 'new');
  const lessonIds = Array.from(new Set(rows.map((row) => row.lessonId)));
  const [lessons, waiting] = await Promise.all([
    prisma.lesson.findMany({
      where: { id: { in: lessonIds } },
      orderBy: { position: 'asc' },
      select: { id: true, title: true, position: true, markdownContent: true, baseLessonId: true },
    }),
    // Lessons whose changes wait for review: their new feedback waits for the next round.
    prisma.aiProposal.findMany({
      where: { kind: AiProposalKind.LESSON_REVISION, status: AiProposalStatus.OPEN, targetId: { in: lessonIds }, taskId: { not: null } },
      select: { targetId: true },
    }),
  ]);
  const busy = new Set(waiting.map((draft) => draft.targetId));
  const lessonInputs: RoundLessonInput[] = [];
  const notes: RoundNote[] = [];
  let more = 0;
  let learner = 0;
  for (const lesson of lessons) {
    const own = rows.filter((row) => row.lessonId === lesson.id).reverse();
    if (busy.has(lesson.id) || notes.length + own.length > ROUND_NOTES) {
      more += own.length;
      continue;
    }
    const improvement = await lessonImprovement(prisma, lesson.id);
    const plan = improvement ? planBody((await prisma.task.findUnique({ where: { id: improvement }, select: { plan: true } }))?.plan) : '';
    const ref = `L${lesson.position}`;
    lessonInputs.push({
      id: lesson.id,
      ref,
      position: lesson.position,
      title: lesson.title,
      sections: lessonSections(lesson.markdownContent).flatMap((section) => (section.heading ? [section.heading] : [])),
      plan: plan || null,
      reachesCourse: Boolean(version.ownerGroupId && lesson.baseLessonId),
    });
    for (const row of own) {
      notes.push({
        id: row.id,
        ref: `N${notes.length + 1}`,
        lessonId: lesson.id,
        lessonRef: ref,
        body: row.body,
        passage: row.selectedText ?? '',
        section: row.selectedText ? (passageHeading(lesson.markdownContent, row.selectedText) ?? null) : null,
        instructor: row.isInstructorNote,
        author: row.isInstructorNote ? row.proposerName : `Learner ${(learner += 1)}`,
      });
    }
  }
  return { notes, lessons: lessonInputs, more };
}

/** "Improve": the version's open round (being sorted, or being worked through), or a new one. */
export async function startRoundAction(versionId: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const t = await getTranslations('courses.round');
  const access = await roundAccess(versionId);
  if (!access) return { ok: false, message: t('notAllowed') };
  const open = await currentDraft(AiProposalKind.FEEDBACK_ROUND, versionId);
  if (open && (open.status === AiProposalStatus.OPEN || open.status === AiProposalStatus.WORKING)) return { ok: true, id: open.id };
  const { notes, lessons, more } = await roundInputs(access.viewer, access.version);
  if (!notes.length) return { ok: false, message: t('nothingNew') };
  const ai = await backgroundAiKey();
  if (!ai.ok) return { ok: false, message: ai.message };
  const organizationId = (await getCurrentUserSession())?.user.organization?.id;
  if (!organizationId) return { ok: false, message: t('notAllowed') };
  const context = await courseContext(versionId);
  const language = AI_LANGUAGES[(await getLocale()) as Locale];
  const row = await startAppDraft({
    organizationId,
    userId: access.viewer.id,
    kind: AiProposalKind.FEEDBACK_ROUND,
    targetType: 'version',
    targetId: versionId,
    run: async (progress, signal) => {
      const raw = await sortVersionFeedback(
        {
          courseTitle: context?.courseTitle ?? 'Untitled course',
          courseSummary: context?.courseSummary,
          outline: context?.outline,
          isGroupCopy: Boolean(access.version.ownerGroupId),
          language,
          lessons,
          notes,
        },
        { key: ai.key, userId: access.viewer.id, signal, onProgress: (next) => progress(next.stage === 'writing' ? { stage: 'writing', text: '' } : next) }
      );
      const round = cleanRound(raw, notes, lessons);
      const payload: RoundPayload = {
        round,
        noteLessons: Object.fromEntries(notes.map((note) => [note.id, note.lessonId])),
        lessons: lessons.map((lesson) => ({ id: lesson.id, reachesCourse: lesson.reachesCourse })),
        more,
      };
      return { payload: payload as Prisma.InputJsonValue, summary: `${round.lessons.length} lessons · ${round.leaveOut.length} left out` };
    },
  });
  revalidatePath('/admin', 'layout');
  return { ok: true, id: row.id };
}

async function roundRow(id: string) {
  const row = await loadDraft(id, AiProposalKind.FEEDBACK_ROUND);
  if (!row) return null;
  const access = await roundAccess(row.targetId);
  return access ? { row, ...access } : null;
}

/** "Stop" while AI sorts. */
export async function stopRoundAction(id: string): Promise<void> {
  if (await roundRow(id)) await settleDraft(id, 'stopped');
}

/** "Discard": the round goes; nothing it sorted was done. */
export async function discardRoundAction(id: string): Promise<void> {
  if (await roundRow(id)) await settleDraft(id, 'discarded');
  revalidatePath('/admin', 'layout');
}

/** The page's edits, checked against what the round sorts. */
function editedRound(payload: RoundPayload, edited: unknown): RoundPlan | null {
  if (!payload.round || !payload.noteLessons || !payload.lessons) return null;
  return cleanEdit(edited, payload.round, payload.lessons, payload.noteLessons);
}

/**
 * Keeps the page's edits and decisions (it saves as the person works), only over the round as it was
 * loaded (`updatedAt`): someone else's save in between is never overwritten, the page says to reload.
 */
export async function saveRoundAction(id: string, edited: unknown, updatedAt: string): Promise<{ ok: true; updatedAt: string } | { ok: false; stale: boolean }> {
  const found = await roundRow(id);
  if (!found || found.row.status !== AiProposalStatus.OPEN) return { ok: false, stale: false };
  const payload = (found.row.payload ?? {}) as RoundPayload;
  const round = editedRound(payload, edited);
  if (!round) return { ok: false, stale: false };
  const now = new Date();
  const { count } = await prisma.aiProposal.updateMany({
    where: { id, status: AiProposalStatus.OPEN, updatedAt: new Date(updatedAt) },
    data: { payload: { ...payload, round, decisions: decisionsOf(edited, payload) } as Prisma.InputJsonValue, updatedAt: now },
  });
  return count ? { ok: true, updatedAt: now.toISOString() } : { ok: false, stale: true };
}

const decisionsOf = (edited: unknown, payload: RoundPayload) => cleanDecisions((edited as { decisions?: unknown } | null)?.decisions ?? payload.decisions);

/** A note nobody decided since the sort, that the person may work on. */
async function stillNew(viewer: CrmViewer, noteId: string) {
  const ref = await loadCommentRef(noteId);
  if (!ref || !canWorkOnFeedback(viewer, ref, 'comments')) return false;
  const note = await prisma.curriculumComment.findUnique({ where: { id: noteId }, select: { status: true, adminResponse: true } });
  return note?.status === 'OPEN' && !note.adminResponse;
}

/**
 * Drafts the round's lessons: each lesson's notes join its improvement with the plan (a plan left
 * empty is written by AI first), and its changes are drafted, up to ten lessons a call, in course
 * order. The page calls it once the feedback is sorted, and again for the lessons past ten. With
 * `only`, that lesson is drafted again (its plan was edited, a note moved to it). Nothing is sent
 * or published: the changes wait on the round's page.
 */
export async function draftRoundAction(
  id: string,
  edited: unknown,
  updatedAt: string,
  only?: string
): Promise<{ ok: true; updatedAt: string; started: number; left: number } | { ok: false; message: string; stale?: boolean }> {
  const t = await getTranslations('courses.round');
  const found = await roundRow(id);
  if (!found || found.row.status !== AiProposalStatus.OPEN) return { ok: false, message: t('gone') };
  const payload = (found.row.payload ?? {}) as RoundPayload;
  const round = editedRound(payload, edited);
  if (!round) return { ok: false, message: t('gone') };
  // Claimed: a second call (another tab, someone else) finds the round moved on, and reloads.
  const claimedAt = new Date();
  const claimed = await prisma.aiProposal.updateMany({
    where: { id, status: AiProposalStatus.OPEN, updatedAt: new Date(updatedAt) },
    data: { payload: { ...payload, round, decisions: decisionsOf(edited, payload) } as Prisma.InputJsonValue, updatedAt: claimedAt },
  });
  if (!claimed.count) return { ok: false, message: t('stale'), stale: true };
  const { viewer, version } = found;
  const drafted = { ...(payload.drafted ?? {}) };
  const lessons = await prisma.lesson.findMany({ where: { id: { in: round.lessons.map((card) => card.lessonId) } }, select: { id: true, position: true } });
  const position = new Map(lessons.map((lesson) => [lesson.id, lesson.position]));
  let started = 0;
  for (const card of [...round.lessons].sort((a, b) => (position.get(a.lessonId) ?? 0) - (position.get(b.lessonId) ?? 0))) {
    if (only ? card.lessonId !== only : Boolean(drafted[card.lessonId])) continue;
    if (started >= ROUND_DRAFTS) break;
    let took = 0;
    for (const noteId of card.noteIds) {
      if (!(await stillNew(viewer, noteId)) || (await isFeedbackUsed(prisma, noteId))) continue;
      if ((await takeUpFeedback({ commentId: noteId, createdById: viewer.id })).ok) took += 1;
    }
    const taskId = await lessonImprovement(prisma, card.lessonId);
    if (!taskId || (!took && !card.plan && !only)) continue;
    const plan = card.plan ? withPlanScope(card.plan, card.scope) : null;
    const run = await improveLesson(viewer, { curriculumVersionId: version.id, lessonId: card.lessonId, plan, takeUpNew: false });
    if (!run?.ok) continue;
    drafted[card.lessonId] = taskId;
    started += 1;
  }
  const now = new Date();
  await prisma.aiProposal.updateMany({
    where: { id, status: AiProposalStatus.OPEN, updatedAt: claimedAt },
    data: { payload: { ...payload, round, decisions: decisionsOf(edited, payload), drafted } as Prisma.InputJsonValue, updatedAt: now },
  });
  revalidatePath('/admin', 'layout');
  return { ok: true, updatedAt: now.toISOString(), started, left: round.lessons.filter((card) => !drafted[card.lessonId]).length };
}

/**
 * After Publish: left-out notes with a reply the person confirmed or wrote get it and are done (the
 * rest stay open on the Feedback list), and the lessons whose changes were published or let go (no
 * draft of theirs waits any more) leave the round. With no lesson left the round is over.
 */
export async function settleRoundAction(
  id: string,
  edited: unknown,
  updatedAt: string
): Promise<{ ok: true; updatedAt: string; replied: number; done: boolean } | { ok: false; message: string }> {
  const t = await getTranslations('courses.round');
  const found = await roundRow(id);
  if (!found || found.row.status !== AiProposalStatus.OPEN) return { ok: false, message: t('gone') };
  const payload = (found.row.payload ?? {}) as RoundPayload;
  const round = editedRound(payload, edited);
  if (!round) return { ok: false, message: t('gone') };
  const claimedAt = new Date();
  const claimed = await prisma.aiProposal.updateMany({
    where: { id, status: AiProposalStatus.OPEN, updatedAt: new Date(updatedAt) },
    data: { updatedAt: claimedAt },
  });
  if (!claimed.count) return { ok: false, message: t('stale') };
  const { viewer } = found;
  let replied = 0;
  const answered = new Set<string>();
  for (const item of round.leaveOut) {
    if (!item.reply.trim() || !(await stillNew(viewer, item.noteId))) continue;
    if ((await isFeedbackUsed(prisma, item.noteId)) && !(await stopUsingFeedback(item.noteId))) continue;
    await respondToComment(item.noteId, item.reply);
    await resolveComment(item.noteId);
    answered.add(item.noteId);
    replied += 1;
  }
  // A drafted lesson with no draft of its improvement waiting: published, or let go.
  const drafted = payload.drafted ?? {};
  const waiting = await prisma.aiProposal.findMany({
    where: {
      kind: AiProposalKind.LESSON_REVISION,
      targetId: { in: Object.keys(drafted) },
      taskId: { in: Object.values(drafted) },
      status: { in: [AiProposalStatus.OPEN, AiProposalStatus.WORKING] },
    },
    select: { targetId: true },
  });
  const open = new Set(waiting.map((draft) => draft.targetId));
  const left: RoundPlan = {
    lessons: round.lessons.filter((card) => !drafted[card.lessonId] || open.has(card.lessonId)),
    leaveOut: round.leaveOut.filter((item) => !answered.has(item.noteId)),
  };
  const done = !left.lessons.length;
  const now = new Date();
  await prisma.aiProposal.update({
    where: { id },
    data: {
      payload: { ...payload, round: left, decisions: decisionsOf(edited, payload) } as Prisma.InputJsonValue,
      updatedAt: now,
      ...(done ? { status: AiProposalStatus.USED, decidedAt: now } : {}),
    },
  });
  revalidatePath('/admin', 'layout');
  return { ok: true, updatedAt: now.toISOString(), replied, done };
}
