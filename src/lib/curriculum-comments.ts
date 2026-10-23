import 'server-only';

import { CurriculumCommentStatus, type Prisma } from '@prisma/client';
import { prisma, type DbClient } from './prisma';
import { validateCourseAccessToken } from './course-access';
import { pausedRefusal } from './learner-paused';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE } from './tasks';
import { learnerLabel } from './learner-label';
import { forgetLearnerHints } from './learner-hints';

/** Upper bounds so a link holder can't store unbounded text. */
export const COMMENT_SELECTED_TEXT_MAX = 2000;
export const COMMENT_CONTEXT_MAX = 4000;
export const COMMENT_BODY_MAX = 4000;
export const COMMENT_ADMIN_RESPONSE_MAX = 4000;

/** Public-safe shape returned to the link holder's browser (no internal ids beyond the comment id). */
export type ViewerCommentView = {
  id: string;
  selectedText: string;
  context: string | null;
  body: string;
  status: CurriculumCommentStatus;
  adminResponse: string | null;
  adminRespondedAt: string | null;
  createdAt: string;
  /** Who wrote it when it isn't the reader: another instructor, on an instructor link. */
  author: string | null;
  /** The reader's own, so they may delete it. */
  mine: boolean;
  /** Done, and the lesson they read has been published again since they wrote it. */
  lessonChanged: boolean;
};

function toViewerComment(
  comment: {
    id: string;
    selectedText: string;
    context: string | null;
    body: string;
    status: CurriculumCommentStatus;
    adminResponse: string | null;
    adminRespondedAt: Date | null;
    createdAt: Date;
    lessonRevision?: number | null;
    lesson?: { publishedRevision: number | null } | null;
  },
  whose: { author: string | null; mine: boolean } = { author: null, mine: true }
): ViewerCommentView {
  const published = comment.lesson?.publishedRevision ?? null;
  return {
    id: comment.id,
    selectedText: comment.selectedText,
    context: comment.context,
    body: comment.body,
    status: comment.status,
    adminResponse: comment.adminResponse,
    adminRespondedAt: comment.adminRespondedAt?.toISOString() ?? null,
    createdAt: comment.createdAt.toISOString(),
    author: whose.author,
    mine: whose.mine,
    lessonChanged:
      comment.status === CurriculumCommentStatus.RESOLVED &&
      comment.lessonRevision != null &&
      published != null &&
      published > comment.lessonRevision,
  };
}

/** A group's instructor notes: written for it, or on its own copy of the course. */
export function groupNotesWhere(groupId: string): Prisma.CurriculumCommentWhereInput {
  return {
    isInstructorNote: true,
    OR: [{ groupId }, { curriculumVersion: { ownerGroupId: groupId } }],
  };
}

export type CreateViewerCommentResult =
  { ok: true; comment: ViewerCommentView } | { ok: false; status: number; error: string };

/**
 * Creates a comment from an individual (member-bound) access link, or an instructor note from an
 * instructor link (under the instructor's name, for their group). Rejects group links (no proposer to
 * attribute), invalid/expired tokens, and lessons that don't belong to the version the token serves.
 * `selectedText`/`context`/`body` are trimmed and length-capped.
 */
export async function createViewerComment(input: {
  token: string;
  lessonId: string;
  selectedText: string;
  context?: string | null;
  body: string;
}): Promise<CreateViewerCommentResult> {
  const token = input.token?.trim();
  const lessonId = input.lessonId?.trim();
  const selectedText = input.selectedText?.trim();
  const body = input.body?.trim();
  const context = input.context?.trim() || null;

  if (!token || !lessonId) {
    return {
      ok: false,
      status: 400,
      error: 'Token and lessonId are required.',
    };
  }

  if (!selectedText) {
    return { ok: false, status: 400, error: 'Select some text to comment on.' };
  }

  if (!body) {
    return { ok: false, status: 400, error: 'Comment message is required.' };
  }

  if (
    selectedText.length > COMMENT_SELECTED_TEXT_MAX ||
    body.length > COMMENT_BODY_MAX ||
    (context && context.length > COMMENT_CONTEXT_MAX)
  ) {
    return { ok: false, status: 400, error: 'Comment is too long.' };
  }

  const access = await validateCourseAccessToken(token);

  if (access.state !== 'valid') {
    return { ok: false, status: 403, error: 'Access is not valid.' };
  }

  if (!access.instructor && (!access.memberId || !access.memberName)) {
    return {
      ok: false,
      status: 403,
      error: 'Commenting is only available on personal access links.',
    };
  }

  if (!access.curriculumVersionId) {
    return { ok: false, status: 404, error: 'Lesson not found.' };
  }

  // Paused between classes: the link only reads (feedback and instructor notes alike).
  const paused = await pausedRefusal(access);
  if (paused) {
    return paused;
  }

  /** Ensure the lesson really belongs to the version this token serves. */
  const lesson = await prisma.lesson.findFirst({
    where: {
      id: lessonId,
      curriculumVersionId: access.curriculumVersionId,
      // Learners only see (and so only comment on) published lessons.
      publishedAt: { not: null },
    },
    select: { id: true, publishedRevision: true },
  });

  if (!lesson) {
    return { ok: false, status: 404, error: 'Lesson not found.' };
  }

  if (access.instructor) {
    return createInstructorNote({
      userId: access.instructor.userId,
      authorName: access.instructor.name,
      lessonId,
      selectedText,
      context,
      body,
      groupId: access.groupId,
    });
  }

  // The team sees "A learner · <group>", never the learner's name (see learner-label.ts).
  const group = access.groupId
    ? await prisma.courseGroup.findUnique({ where: { id: access.groupId }, select: { name: true } })
    : null;

  const comment = await prisma.curriculumComment.create({
    data: {
      curriculumVersionId: access.curriculumVersionId,
      lessonId,
      // The text the learner was reading, so insights can tell feedback before and after a revision.
      lessonRevision: lesson.publishedRevision,
      accessLinkId: access.accessLinkId,
      memberId: access.memberId,
      // So the group's instructors see it, even after the learner leaves the roster.
      groupId: access.groupId,
      proposerName: learnerLabel(group?.name),
      selectedText,
      context,
      body,
    },
    select: {
      id: true,
      selectedText: true,
      context: true,
      body: true,
      status: true,
      adminResponse: true,
      adminRespondedAt: true,
      createdAt: true,
    },
  });

  return { ok: true, comment: toViewerComment(comment) };
}

/**
 * The comments a learner left on a lesson, from this link or an earlier one of theirs, newest first —
 * powers the gutter bubbles + replies. On an instructor link: every instructor's notes for its group
 * on the lesson, named, own ones marked.
 */
export async function listViewerCommentsForLesson(input: {
  token: string;
  lessonId: string;
}): Promise<ViewerCommentView[] | null> {
  const token = input.token?.trim();
  const lessonId = input.lessonId?.trim();

  if (!token || !lessonId) {
    return null;
  }

  const access = await validateCourseAccessToken(token);

  if (access.state === 'valid' && access.instructor && access.groupId) {
    const userId = access.instructor.userId;
    const notes = await prisma.curriculumComment.findMany({
      where: { lessonId, ...groupNotesWhere(access.groupId) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        selectedText: true,
        context: true,
        body: true,
        status: true,
        adminResponse: true,
        adminRespondedAt: true,
        createdAt: true,
        proposerName: true,
        authorUserId: true,
      },
    });
    return notes.map((note) =>
      toViewerComment(note, {
        author: note.authorUserId === userId ? null : note.proposerName,
        mine: note.authorUserId === userId,
      })
    );
  }

  if (access.state !== 'valid' || !access.memberId) {
    return null;
  }

  // The learner's own feedback, from whichever of their links they wrote it: a link made again for
  // them (the old one revoked) still shows everything they said.
  const comments = await prisma.curriculumComment.findMany({
    where: {
      memberId: access.memberId,
      isInstructorNote: false,
      lessonId,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      selectedText: true,
      context: true,
      body: true,
      status: true,
      adminResponse: true,
      adminRespondedAt: true,
      createdAt: true,
      lessonRevision: true,
      lesson: { select: { publishedRevision: true } },
    },
  });

  return comments.map((comment) => toViewerComment(comment));
}

export type DeleteViewerCommentResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Deletes a comment its learner left, from this link or an earlier one of theirs. Scoped by the
 * link's learner (`memberId`), so a link can only remove its own learner's comments. Also drops any
 * `TaskEntityLink` pointing at the comment (a task promoted from it survives, just without its source
 * reference).
 */
export async function deleteViewerComment(input: {
  token: string;
  commentId: string;
}): Promise<DeleteViewerCommentResult> {
  const token = input.token?.trim();
  const commentId = input.commentId?.trim();

  if (!token || !commentId) {
    return {
      ok: false,
      status: 400,
      error: 'Token and commentId are required.',
    };
  }

  const access = await validateCourseAccessToken(token);

  const paused = await pausedRefusal(access);
  if (paused) {
    return paused;
  }

  // An instructor deletes their own notes for the link's group, nothing else.
  if (access.state === 'valid' && access.instructor && access.groupId) {
    const deleted = await deleteCommentsWhere({
      id: commentId,
      AND: [{ authorUserId: access.instructor.userId }, groupNotesWhere(access.groupId)],
    });
    return deleted ? { ok: true } : { ok: false, status: 404, error: 'Note not found.' };
  }

  /**
   * The link's learner IS the authorization. Guard it explicitly: Prisma silently drops `undefined`
   * filters, which would turn the scoped delete below into "delete any comment by id".
   */
  const memberId = access.state === 'valid' ? access.memberId : null;
  if (!memberId) {
    return { ok: false, status: 403, error: 'Access is not valid.' };
  }

  /**
   * Ownership check and delete are one statement (no find-then-delete gap). Someone else's comment
   * matches zero rows and reads as "not found", so ids can't be probed for existence.
   */
  const deleted = await deleteCommentsWhere({ id: commentId, memberId, isInstructorNote: false });

  if (!deleted) {
    return { ok: false, status: 404, error: 'Comment not found.' };
  }

  return { ok: true };
}

/**
 * Deletes the comment matching `where` plus any `TaskEntityLink` pointing at it (a task promoted
 * from it survives, just without its source reference). Returns false when nothing matched.
 */
async function deleteCommentsWhere(where: Prisma.CurriculumCommentWhereInput & { id: string }) {
  return prisma.$transaction(async (tx) => {
    const comment = await tx.curriculumComment.findFirst({ where, select: { curriculumVersionId: true, memberId: true } });
    const { count } = await tx.curriculumComment.deleteMany({ where });

    if (count === 0) {
      return false;
    }

    // A learner's feedback counts in the hints learners see.
    if (comment?.memberId) {
      await forgetLearnerHints([comment.curriculumVersionId]);
    }

    await tx.taskEntityLink.deleteMany({
      where: {
        entityType: TASK_ENTITY_TYPE.curriculumComment,
        entityId: where.id,
      },
    });

    return true;
  });
}

/** Admin: delete any comment and the tasks made from it (callers must have checked admin auth). */
export async function deleteComment(commentId: string) {
  return (await deleteFeedback([commentId])).comments > 0;
}

/**
 * The team deleting feedback (the inbox, a lesson's revision tasks, "Delete their answers"): the
 * comments, every link to them, and the tasks left with no feedback by it. An improvement uses all
 * of its lesson's feedback the team acted on, so one that still uses other feedback stays (without
 * the deleted words, where an older one kept them as its instructions); one made from this feedback
 * alone goes, so it doesn't live on in the lesson's revision tasks, on the board and in Obsidian. A
 * reader deleting their own comment leaves the team's task alone (`deleteViewerComment`). Pass `db`
 * to run in an open transaction.
 */
export async function deleteFeedback(commentIds: string[], db?: DbClient) {
  if (commentIds.length === 0) {
    return { comments: 0, tasks: 0 };
  }
  const run = async (tx: DbClient) => {
    const sources = await tx.taskEntityLink.findMany({
      where: {
        entityType: TASK_ENTITY_TYPE.curriculumComment,
        role: TASK_ENTITY_ROLE.source,
        entityId: { in: commentIds },
      },
      select: { taskId: true },
    });
    const usedBy = Array.from(new Set(sources.map((link) => link.taskId)));
    const bodies = usedBy.length
      ? (await tx.curriculumComment.findMany({ where: { id: { in: commentIds } }, select: { body: true } })).map((comment) => comment.body.trim())
      : [];
    // Learners' feedback counts in the hints learners see: theirs are counted again once this commits.
    const fromLearners = await tx.curriculumComment.findMany({
      where: { id: { in: commentIds }, memberId: { not: null } },
      distinct: ['curriculumVersionId'],
      select: { curriculumVersionId: true },
    });
    const { count } = await tx.curriculumComment.deleteMany({ where: { id: { in: commentIds } } });
    await forgetLearnerHints(fromLearners.map((comment) => comment.curriculumVersionId));
    await tx.taskEntityLink.deleteMany({
      where: { entityType: TASK_ENTITY_TYPE.curriculumComment, entityId: { in: commentIds } },
    });
    const stillUsing = usedBy.length
      ? (
          await tx.taskEntityLink.findMany({
            where: { taskId: { in: usedBy }, entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source },
            distinct: ['taskId'],
            select: { taskId: true },
          })
        ).map((link) => link.taskId)
      : [];
    const taskIds = usedBy.filter((taskId) => !stillUsing.includes(taskId));
    if (stillUsing.length && bodies.length) {
      await tx.task.updateMany({ where: { id: { in: stillUsing }, description: { in: bodies } }, data: { description: null } });
    }
    if (taskIds.length) {
      // Links from other tasks (a core proposal made from this one) go; those tasks stay.
      await tx.taskEntityLink.deleteMany({ where: { entityType: TASK_ENTITY_TYPE.task, entityId: { in: taskIds } } });
      await tx.task.deleteMany({ where: { id: { in: taskIds } } });
    }
    return { comments: count, tasks: taskIds.length };
  };
  return db ? run(db) : prisma.$transaction((tx) => run(tx));
}

/**
 * An improvement deleted from its page (made by mistake): it goes, and the feedback it used waits to
 * be decided again (used again, or answered), since one improvement holds all the feedback of its
 * lesson that the team acted on.
 */
export async function deleteFeedbackTask(taskId: string) {
  return prisma.$transaction(async (tx) => {
    const sources = await tx.taskEntityLink.count({
      where: { taskId, entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source },
    });
    await tx.taskEntityLink.deleteMany({ where: { entityType: TASK_ENTITY_TYPE.task, entityId: taskId } });
    const { count } = await tx.task.deleteMany({ where: { id: taskId } });
    return { feedback: sources, deleted: count > 0 };
  });
}

/** How many resolved comments the inbox and the preview gutter show: the newest ones. */
export const RESOLVED_COMMENTS_SHOWN = 50;

/**
 * Admin: comments for one version, for the preview gutter, newest first: every open one and the
 * newest resolved ones.
 */
export async function listCommentsForVersionAdmin(curriculumVersionId: string) {
  const select = {
    id: true,
    proposerName: true,
    selectedText: true,
    context: true,
    body: true,
    status: true,
    adminResponse: true,
    adminRespondedAt: true,
    createdAt: true,
    lessonId: true,
  } satisfies Prisma.CurriculumCommentSelect;
  const [open, resolved] = await Promise.all([
    prisma.curriculumComment.findMany({
      where: { curriculumVersionId, status: CurriculumCommentStatus.OPEN },
      orderBy: { createdAt: 'desc' },
      select,
    }),
    prisma.curriculumComment.findMany({
      where: { curriculumVersionId, status: { not: CurriculumCommentStatus.OPEN } },
      orderBy: { createdAt: 'desc' },
      take: RESOLVED_COMMENTS_SHOWN,
      select,
    }),
  ]);
  return [...open, ...resolved].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Admin: store a reply (visible to the commenter) and stamp when it was written. */
export async function respondToComment(commentId: string, response: string) {
  const trimmed = response.trim().slice(0, COMMENT_ADMIN_RESPONSE_MAX);

  await prisma.curriculumComment.update({
    where: { id: commentId },
    data: {
      adminResponse: trimmed || null,
      adminRespondedAt: trimmed ? new Date() : null,
    },
  });
}

/** Admin: mark a comment resolved (e.g. handled directly, without a task). */
export async function resolveComment(commentId: string) {
  await prisma.curriculumComment.update({
    where: { id: commentId },
    data: { status: CurriculumCommentStatus.RESOLVED, resolvedAt: new Date() },
  });
}

/** Admin: open a done comment again (its learner sees it open again). */
export async function reopenComment(commentId: string) {
  await prisma.curriculumComment.update({
    where: { id: commentId },
    data: { status: CurriculumCommentStatus.OPEN, resolvedAt: null },
  });
}

/** Admin dashboard count of open (untriaged) comments the viewer may see. */
export async function getOpenCommentCount(scope: Prisma.CurriculumCommentWhereInput = {}) {
  return prisma.curriculumComment.count({
    where: { AND: [{ status: CurriculumCommentStatus.OPEN }, scope] },
  });
}

// ---------------------------------------------------------------------------------------------
// Instructor notes: team members annotate passages in the preview (session-authenticated). They
// are comments marked `isInstructorNote` (with the author's `authorUserId` while their account
// exists), so they share the inbox, tasks and AI plans with learner feedback. Queries run through the organisation-scoped client, so a lesson outside the team's
// organisation is simply not found.
// ---------------------------------------------------------------------------------------------

export type TeamCommentView = ViewerCommentView & { proposerName: string; mine: boolean; isNote: boolean };

/** A lesson's feedback and notes the viewer may see (`scope`), plus their own notes. */
export async function listTeamCommentsForLesson(
  userId: string,
  lessonId: string,
  scope: Prisma.CurriculumCommentWhereInput = {}
): Promise<TeamCommentView[]> {
  // An empty scope is everything; Prisma's OR doesn't read `{}` that way, so only narrow when limited.
  const limited = Object.keys(scope).length > 0;
  const comments = await prisma.curriculumComment.findMany({
    where: limited ? { lessonId, OR: [scope, { authorUserId: userId }] } : { lessonId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      selectedText: true,
      context: true,
      body: true,
      status: true,
      adminResponse: true,
      adminRespondedAt: true,
      createdAt: true,
      proposerName: true,
      authorUserId: true,
      isInstructorNote: true,
    },
  });
  return comments.map((comment) => ({
    ...toViewerComment(comment),
    proposerName: comment.isInstructorNote ? `${comment.proposerName} (instructor note)` : comment.proposerName,
    mine: comment.authorUserId === userId,
    isNote: comment.isInstructorNote,
  }));
}

export async function createInstructorNote(input: {
  userId: string;
  authorName: string;
  lessonId: string;
  selectedText: string;
  context?: string | null;
  body: string;
  /** The group the note is about (checked by the caller); a group curriculum's own group wins. */
  groupId?: string | null;
}): Promise<CreateViewerCommentResult> {
  const selectedText = input.selectedText?.trim();
  const body = input.body?.trim();
  const context = input.context?.trim() || null;
  if (!selectedText) {
    return { ok: false, status: 400, error: 'Select some text to note.' };
  }
  if (!body) {
    return { ok: false, status: 400, error: 'Write the note.' };
  }
  if (
    selectedText.length > COMMENT_SELECTED_TEXT_MAX ||
    body.length > COMMENT_BODY_MAX ||
    (context && context.length > COMMENT_CONTEXT_MAX)
  ) {
    return { ok: false, status: 400, error: 'Note is too long.' };
  }
  const lesson = await prisma.lesson.findUnique({
    where: { id: input.lessonId },
    select: { id: true, curriculumVersionId: true, curriculumVersion: { select: { ownerGroupId: true } } },
  });
  if (!lesson) {
    return { ok: false, status: 404, error: 'Lesson not found.' };
  }
  const comment = await prisma.curriculumComment.create({
    data: {
      curriculumVersionId: lesson.curriculumVersionId,
      lessonId: lesson.id,
      groupId: lesson.curriculumVersion.ownerGroupId ?? input.groupId ?? null,
      authorUserId: input.userId,
      isInstructorNote: true,
      proposerName: input.authorName,
      selectedText,
      context,
      body,
    },
    select: {
      id: true,
      selectedText: true,
      context: true,
      body: true,
      status: true,
      adminResponse: true,
      adminRespondedAt: true,
      createdAt: true,
    },
  });
  return { ok: true, comment: toViewerComment(comment) };
}

export async function deleteInstructorNote(userId: string, commentId: string): Promise<DeleteViewerCommentResult> {
  const result = await prisma.curriculumComment.deleteMany({
    where: { id: commentId, authorUserId: userId },
  });
  return result.count > 0 ? { ok: true } : { ok: false, status: 404, error: 'Note not found.' };
}
