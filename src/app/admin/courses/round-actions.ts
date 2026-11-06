'use server';

import { AiProposalKind, AiProposalStatus, Permission, type Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { AI_LANGUAGES, backgroundAiKey, sortVersionFeedback } from '@/lib/ai';
import { currentDraft, draftView, loadDraft, settleDraft, startAppDraft } from '@/lib/ai-drafts';
import type { AppDraftView } from '@/lib/ai-draft-progress';
import { accessScope, canWorkOnFeedback, commentScopeWhere, loadCommentRef, requireVersionEdit, type CrmViewer } from '@/lib/crm-access';
import { resolveComment, respondToComment } from '@/lib/curriculum-comments';
import { listFeedback } from '@/lib/feedback-list';
import { isFeedbackUsed, lessonImprovement, stopUsingFeedback, takeUpFeedback } from '@/lib/lesson-improvement';
import { lessonSections, passageHeading } from '@/lib/lesson-sections';
import { planBody, withPlanScope } from '@/lib/plan-scope';
import { prisma } from '@/lib/prisma';
import { cleanEdit, cleanRound, leftToAnswer, type RoundLessonInput, type RoundNote, type RoundPlan } from '@/lib/version-round-rules';
import { courseContext } from './ai-context';
import { improveLesson } from './improvement-run';

/**
 * "Sort with AI": all new feedback of a course version or a group's copy, sorted by AI in one go
 * (a FEEDBACK_ROUND draft on the version), edited on one page, then approved: each lesson's notes
 * join its improvement with the plan, the changes are drafted lesson by lesson, and left-out notes
 * the person answered get that reply and are done. Replies are always the person's: AI only
 * suggests. Every action checks the person may edit the version and work on its feedback.
 */

/** At most this many notes in one round, whole lessons at a time; the rest wait for the next. */
const ROUND_NOTES = 120;
/** Lessons whose changes are drafted at once on Approve; the rest are planned, to start from their page. */
const ROUND_DRAFTS = 10;

/** What a round keeps, besides what AI writes while it's at it. */
export type RoundPayload = {
  round?: RoundPlan;
  /** The notes it sorts, with each one's lesson, and the lessons (whether the main course has them). */
  noteLessons?: Record<string, string>;
  lessons?: Array<{ id: string; reachesCourse: boolean }>;
  /** New notes it doesn't sort (over the cap, or on lessons whose changes wait for review). */
  more?: number;
  applied?: { at: string; drafting: number; planned: number; replied: number; skipped: number };
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

/** "Sort with AI": the version's open round (being sorted or waiting to be approved), or a new one. */
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

/** How far the sorting is (the page polls it while AI is at it). */
export async function roundDraftAction(id: string): Promise<AppDraftView | null> {
  const found = await roundRow(id);
  return found ? draftView(found.row, found.viewer.id, 'plan') : null;
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
 * Keeps the page's edits (it saves as the person works), only over the round as it was loaded
 * (`updatedAt`): someone else's save in between is never overwritten, the page says to reload.
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
    data: { payload: { ...payload, round } as Prisma.InputJsonValue, updatedAt: now },
  });
  return count ? { ok: true, updatedAt: now.toISOString() } : { ok: false, stale: true };
}

/**
 * "Approve": each lesson's notes join its improvement with the plan (a plan left empty is written by
 * AI first), and its changes are drafted (up to ten lessons at once; the rest are planned, ready to
 * start from their page). Left-out notes with a reply the person confirmed or wrote get it and are
 * done; the rest stay open on the Feedback list. Notes decided since the sort are skipped. Returns
 * the first lesson to review; the others follow with Next.
 */
export async function approveRoundAction(
  id: string,
  edited: unknown,
  updatedAt: string
): Promise<{ ok: true; href: string | null; drafting: number; planned: number; replied: number; open: number; skipped: number } | { ok: false; message: string }> {
  const t = await getTranslations('courses.round');
  const found = await roundRow(id);
  if (!found || found.row.status !== AiProposalStatus.OPEN) return { ok: false, message: t('gone') };
  const payload = (found.row.payload ?? {}) as RoundPayload;
  const round = editedRound(payload, edited);
  if (!round) return { ok: false, message: t('gone') };
  // Claimed once: a second Approve (another tab, someone else) finds it used.
  const claimed = await prisma.aiProposal.updateMany({
    where: { id, status: AiProposalStatus.OPEN, updatedAt: new Date(updatedAt) },
    data: { status: AiProposalStatus.USED, decidedAt: new Date(), payload: { ...payload, round } as Prisma.InputJsonValue },
  });
  if (!claimed.count) return { ok: false, message: t('stale') };
  const { viewer, version } = found;
  const stillNew = async (noteId: string) => {
    const ref = await loadCommentRef(noteId);
    if (!ref || !canWorkOnFeedback(viewer, ref, 'comments')) return false;
    const note = await prisma.curriculumComment.findUnique({ where: { id: noteId }, select: { status: true, adminResponse: true } });
    return note?.status === 'OPEN' && !note.adminResponse;
  };
  let skipped = 0;
  let drafting = 0;
  let planned = 0;
  let replied = 0;
  let firstHref: string | null = null;
  const lessons = await prisma.lesson.findMany({ where: { id: { in: round.lessons.map((card) => card.lessonId) } }, select: { id: true, courseId: true, position: true } });
  const position = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  for (const card of [...round.lessons].sort((a, b) => (position.get(a.lessonId)?.position ?? 0) - (position.get(b.lessonId)?.position ?? 0))) {
    let took = 0;
    for (const noteId of card.noteIds) {
      if (!(await stillNew(noteId)) || (await isFeedbackUsed(prisma, noteId))) {
        skipped += 1;
        continue;
      }
      if ((await takeUpFeedback({ commentId: noteId, createdById: viewer.id })).ok) took += 1;
    }
    const taskId = await lessonImprovement(prisma, card.lessonId);
    if (!taskId || (!took && !card.plan)) continue;
    const plan = card.plan ? withPlanScope(card.plan, card.scope) : null;
    const lesson = position.get(card.lessonId);
    if (drafting < ROUND_DRAFTS) {
      const run = await improveLesson(viewer, { curriculumVersionId: version.id, lessonId: card.lessonId, plan, takeUpNew: false });
      if (run?.ok) drafting += 1;
      else planned += 1;
    } else {
      if (plan) await prisma.task.update({ where: { id: taskId }, data: { plan, planUpdatedAt: new Date() } });
      planned += 1;
    }
    firstHref ??= lesson ? `/admin/courses/${lesson.courseId}/lessons/${lesson.id}/improvements?i=${taskId}` : null;
  }
  for (const item of round.leaveOut) {
    if (!item.reply.trim()) continue;
    if (!(await stillNew(item.noteId))) {
      skipped += 1;
      continue;
    }
    if ((await isFeedbackUsed(prisma, item.noteId)) && !(await stopUsingFeedback(item.noteId))) {
      skipped += 1;
      continue;
    }
    await respondToComment(item.noteId, item.reply);
    await resolveComment(item.noteId);
    replied += 1;
  }
  const open = leftToAnswer(round);
  await prisma.aiProposal.update({
    where: { id },
    data: { payload: { ...payload, round, applied: { at: new Date().toISOString(), drafting, planned, replied, skipped } } as Prisma.InputJsonValue },
  });
  revalidatePath('/admin', 'layout');
  return { ok: true, href: firstHref, drafting, planned, replied, open, skipped };
}
