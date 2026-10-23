import 'server-only';

import { Permission } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { isAiConfigured, type FeedbackItem } from '@/lib/ai';
import { accessScope, canPreviewVersion, commentScopeWhere, loadVersionRef, requireCrmAccess } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';

/** Course title, summary and the version's lesson titles, so AI edits fit the sequence. */
export async function courseContext(curriculumVersionId: string) {
  const version = await prisma.curriculumVersion.findUnique({
    where: { id: curriculumVersionId },
    select: {
      ownerGroupId: true,
      course: { select: { title: true, summary: true } },
      lessons: { orderBy: { position: 'asc' }, select: { title: true } },
    },
  });
  return version
    ? {
        courseTitle: version.course.title,
        courseSummary: version.course.summary,
        outline: version.lessons.map((lesson) => lesson.title),
        isGroupCopy: version.ownerGroupId !== null,
      }
    : null;
}

export type PlanContext = {
  courseTitle: string;
  courseSummary?: string | null;
  outline?: string[];
  lessonTitle: string;
  markdown: string;
  feedback: FeedbackItem[];
  isGroupCopy: boolean;
  /** The improvement's other lessons, when one plan covers several. */
  otherLessons?: Array<{ title: string; markdown: string }>;
  /** Updating a plan: the one written before newer feedback joined (marked `isNew`); refining it: the plan as it is now. */
  currentPlan?: string | null;
  /** The instructor's notes for AI on the improvement (their own words). */
  notes?: string | null;
  /** Refining a plan: what the instructor asks to change in `currentPlan`. */
  request?: string | null;
};

/**
 * What a revision plan for a lesson is drafted from: the lesson and the feedback its improvement
 * uses (even what's done already); an improvement without feedback, what it asked for (and, for one
 * made before feedback was used, the lesson's open feedback). Updating a plan, the current one and
 * which feedback joined after it. Read here, with the person's own rights: reading the lesson, and
 * working on feedback somewhere (the plan uses only feedback they may work on).
 */
export async function planContext(input: {
  lessonId: string;
  /** The improvement's other lessons (same course or copy), when one plan covers several. */
  otherLessonIds?: string[];
  sourceCommentIds?: string[];
  /** What an improvement made without feedback asked for. */
  asked?: string | null;
  /** The instructor's notes for AI on the improvement. */
  notes?: string | null;
  /** Refining a plan: what to change in `currentPlan`. */
  request?: string | null;
  /** Updating: the current plan, and the feedback used since it was written. */
  currentPlan?: string | null;
  newCommentIds?: string[];
}): Promise<{ ok: true; context: PlanContext } | { ok: false; message: string }> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: input.lessonId },
    select: { id: true, title: true, markdownContent: true, curriculumVersionId: true },
  });
  const versionRef = lesson ? await loadVersionRef(lesson.curriculumVersionId) : null;
  const t = await getTranslations('editor.ai');
  if (!lesson || !versionRef) {
    return { ok: false, message: t('lessonNotFound') };
  }
  const workScope = (candidate: Parameters<typeof accessScope>[0]) =>
    accessScope(candidate, 'comments', [Permission.READ, Permission.TASKS]);
  const viewer = await requireCrmAccess((candidate) => {
    const scope = workScope(candidate);
    return (
      canPreviewVersion(candidate, versionRef) &&
      (scope.all || scope.courses === '*' || scope.courses.length > 0 || scope.groups.length > 0)
    );
  });
  if (!(await isAiConfigured())) {
    return { ok: false, message: t('notSetUp') };
  }

  const sources = input.sourceCommentIds?.length ? input.sourceCommentIds : [];
  const others = input.otherLessonIds?.length
    ? await prisma.lesson.findMany({
        where: { id: { in: input.otherLessonIds.filter((id) => id !== lesson.id).slice(0, 8) }, curriculumVersionId: lesson.curriculumVersionId },
        orderBy: { position: 'asc' },
        select: { id: true, title: true, markdownContent: true },
      })
    : [];
  // The feedback the improvement uses; only one made without any reads the lesson's open feedback.
  const comments = await prisma.curriculumComment.findMany({
    where: {
      lessonId: { in: [lesson.id, ...others.map((other) => other.id)] },
      AND: [commentScopeWhere(workScope(viewer)), sources.length ? { id: { in: sources } } : input.asked?.trim() ? { id: { in: [] } } : { status: 'OPEN' }],
    },
    orderBy: { createdAt: 'asc' },
    take: 30,
    select: { id: true, proposerName: true, selectedText: true, body: true, isInstructorNote: true },
  });
  // Learners are numbered, never named (instructors keep their names), as in Claude's brief.
  let learner = 0;
  const feedback: FeedbackItem[] = comments.map((comment) => ({
    kind: comment.isInstructorNote ? 'instructor' : 'learner',
    author: comment.isInstructorNote ? comment.proposerName : `Learner ${(learner += 1)}`,
    passage: comment.selectedText,
    body: comment.body,
    ...(input.currentPlan && input.newCommentIds?.includes(comment.id) ? { isNew: true } : {}),
  }));
  if (!sources.length && input.asked?.trim()) {
    feedback.push({ kind: 'instructor', author: 'The instructor', passage: lesson.title, body: input.asked.trim().slice(0, 4000) });
  }
  const context = await courseContext(lesson.curriculumVersionId);
  return {
    ok: true,
    context: {
      courseTitle: context?.courseTitle ?? 'Untitled course',
      courseSummary: context?.courseSummary,
      outline: context?.outline,
      lessonTitle: lesson.title,
      markdown: lesson.markdownContent,
      feedback,
      isGroupCopy: context?.isGroupCopy ?? false,
      otherLessons: others.map((other) => ({ title: other.title, markdown: other.markdownContent })),
      currentPlan: input.currentPlan?.trim() || null,
      notes: input.notes?.trim().slice(0, 4000) || null,
      request: input.request?.trim().slice(0, 1000) || null,
    },
  };
}
