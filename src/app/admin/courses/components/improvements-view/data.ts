import 'server-only';

import { AiProposalKind, AiProposalStatus, CurriculumCommentStatus, Permission, TaskStatus } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import type { AppDraftView } from '@/lib/ai-draft-progress';
import { currentDraft, draftView, lessonDraftView, openLessonRevisions, type LessonDraftView } from '@/lib/ai-drafts';
import { accessScope, canEditVersion, canWorkOnFeedback, commentScopeWhere, loadTaskRef, loadVersionRef, taskScopeWhere, type CrmViewer } from '@/lib/crm-access';
import { improvementRecords, type ImprovementRecord } from '@/lib/improvement-record';
import { improvementPlacesFor } from '@/lib/improvement-targets';
import { improvementAttempts, lessonEdits, type ThreadAttempt } from '@/lib/improvement-thread';
import { queueOf, type QueueLesson, type QueuePlace } from '@/lib/review-queue';
import { ANONYMOUS_LEARNER } from '@/lib/learner-label';
import { improvementLabel } from '@/lib/improvement-label';
import { parsePlanScope, planBody, type PlanScope } from '@/lib/plan-scope';
import { prisma } from '@/lib/prisma';
import { feedbackSincePlan } from '@/lib/feedback-rounds';
import { lessonImprovement } from '@/lib/lesson-improvement';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE, TASK_KIND } from '@/lib/tasks';
import { revisionPathsFor } from '../../../components/revision-path/path-data';
import { mapUploadedAssets } from '../../data';
import type { ProposedChange } from '../workspace/revision';

const NOTE_SUFFIX = ' (instructor note)';

/**
 * A piece of feedback, as the view quotes it: learners only by their group, never by name. In an
 * improvement, when it joined it (to tell what came after the plan or the draft).
 */
export type ViewFeedback = { id: string; passage: string; body: string; who: string; lessonHref: string | null; joinedAt: string | null };

/** One improvement on the lesson, with everything its detail shows. */
export type ViewImprovement = {
  id: string;
  /** The lesson's open improvement: feedback used here joins it (`lessonImprovement`). Others are earlier ones, or a group copy's. */
  current: boolean;
  title: string;
  /** What the list and the detail call it: its title, or, when the title is just the lesson's name, what its feedback asks. */
  label: string;
  status: TaskStatus;
  /** The plan without its "Scope:" line, and that line (written back with it when the plan is edited). */
  plan: string;
  rawPlan: string;
  /** Where it goes: "This group only", "This group and the main course", "From the Spring group's copy"… */
  whereLabel: string;
  /** Where its change goes, as its plan says (a group's improvement chooses; null: not chosen). */
  scope: PlanScope | null;
  /** A group's improvement on its own copy: it chooses this group only, or the main course too. */
  choosesScope: boolean;
  /** Its lessons have a main-course lesson behind them (not ones added in the copy only). */
  courseReachable: boolean;
  /** The person may edit that lesson (otherwise the main course gets a suggestion). */
  canEditCourse: boolean;
  /**
   * On the group's copy, for whoever may edit the main course: the text of the main course's lesson
   * behind this one, to show before Publish which changes won't go in there by themselves.
   */
  courseText: string | null;
  /** The group whose improvement it is; null for the course's own. */
  group: string | null;
  /** A plan AI is writing for it, or wrote while nobody watched. */
  planDraft: AppDraftView | null;
  feedback: ViewFeedback[];
  /** Its feedback used after its plan was written: the plan should be updated before changes are drafted. */
  newSincePlan: string[];
  /** What was asked, for an improvement made before feedback was used ("+ New improvement", Insights). */
  asked: string | null;
  /** The instructor's notes for AI on the improvement (their own words, kept on it). */
  notes: string;
  /** Its feedback on this lesson (what an AI draft reads when there's no plan yet). */
  noteIds: string[];
  aiReady: boolean;
  /** Worked on in the app or in the Obsidian vault (null: nobody chose yet). */
  workplace: 'APP' | 'VAULT' | null;
  /** A change for it is saved on this lesson already. */
  savedHere: boolean;
  /** Its other lessons or copies, and where each is (`course`: the main course's lesson, for a group's improvement). */
  others: Array<{ label: string; state: string; href: string | null; done: boolean; phase: 'toChange' | 'writing' | 'review' | 'saved' | 'live'; toReview: number; course: boolean }>;
  /**
   * On the main course's lesson, for a group's improvement: the changes saved on the group's copy
   * of it, to tell what hasn't reached this lesson yet ("Didn't fit"). Null elsewhere.
   */
  fromCopy: { group: string; changes: ProposedChange[] } | null;
  /** Proposed changes for it on this lesson: being written, or waiting for review. */
  draft: LessonDraftView | null;
  /** Its thread on this lesson: the attempts at its changes since the last save, oldest first, with what was asked for each. */
  attempts: ThreadAttempt[];
  /** What it changed so far (saved on some of its lessons, more to do). */
  record: ImprovementRecord | null;
  canWork: boolean;
};

/**
 * The lesson's history, read-only: a finished improvement (why, its plan, how its changes came
 * about, and what it changed), or a published edit no improvement made (`edited`: what it changed).
 */
export type DoneImprovement = {
  id: string;
  label: string;
  whereLabel: string;
  plan: string;
  feedback: ViewFeedback[];
  asked: string | null;
  record: ImprovementRecord | null;
  attempts: ThreadAttempt[];
  edited: boolean;
  /** When it was finished (or the edit published), for the history's order. */
  at: string;
};

/**
 * Everything the lesson's Improvements view needs, read with the viewer's rights: the improvements
 * that change this lesson (its own, the main course's part of a group's, ones covering several
 * lessons), open ones with their feedback, plan, other places and drafts here, the finished ones,
 * and this lesson's feedback that no improvement covers yet.
 */
export async function loadImprovementsView(
  viewer: CrmViewer,
  lesson: { id: string; courseId: string; ownerGroupId: string | null; title: string },
  aiEnabled: boolean
) {
  const t = await getTranslations('editor.improvements');
  const commentScope = commentScopeWhere(accessScope(viewer, 'comments'));
  const lessonHref = (lessonId: string, courseId: string) => `/admin/courses/${courseId}/lessons/${lessonId}`;
  // A course lesson: the groups' copies of it, whose improvements may bring their changes here.
  const copies = lesson.ownerGroupId
    ? []
    : await prisma.lesson.findMany({
        where: { baseLessonId: lesson.id },
        orderBy: { updatedAt: 'asc' },
        select: {
          id: true,
          // Their images, so changes carried from a copy (or copied by hand) show and keep theirs here.
          assetReferences: {
            select: { sourcePath: true, assetId: true, asset: { select: { bytes: true, id: true, mimeType: true, originalFilename: true, r2Key: true } } },
          },
        },
      });
  const candidates = await prisma.task.findMany({
    where: {
      AND: [
        taskScopeWhere(accessScope(viewer, 'tasks')),
        {
          kind: TASK_KIND.curriculum,
          status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE] },
          entityLinks: { some: { entityType: TASK_ENTITY_TYPE.lesson, entityId: { in: [lesson.id, ...copies.map((copy) => copy.id)] } } },
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 60,
    select: { id: true, title: true, description: true, aiNotes: true, status: true, plan: true, planUpdatedAt: true, aiReady: true, workplace: true, updatedAt: true, completedAt: true },
  });
  const currentId = await lessonImprovement(prisma, lesson.id);
  const places = await improvementPlacesFor(
    prisma,
    candidates.map((task) => task.id)
  );
  const here = candidates.filter((task) => places.get(task.id)?.targets.some((target) => target.lessonId === lesson.id));
  const open = here.filter((task) => task.status !== TaskStatus.DONE);
  const done = here
    .filter((task) => task.status === TaskStatus.DONE)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 20);
  const openIds = open.map((task) => task.id);
  const doneIds = done.map((task) => task.id);

  const [paths, sourceLinks, draftRows, saved, groups, records, attempts, doneAttempts, edits] = await Promise.all([
    revisionPathsFor(open, aiEnabled),
    prisma.taskEntityLink.findMany({
      where: { taskId: { in: [...openIds, ...doneIds] }, entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source },
      select: { taskId: true, entityId: true, createdAt: true },
    }),
    openLessonRevisions(lesson.id),
    prisma.lessonChange.findMany({ where: { lessonId: lesson.id, taskId: { in: openIds } }, select: { taskId: true } }),
    prisma.courseGroup.findMany({
      where: { id: { in: Array.from(new Set(Array.from(places.values()).flatMap((place) => (place.groupId ? [place.groupId] : [])))) } },
      select: { id: true, name: true },
    }),
    improvementRecords(viewer, [...doneIds, ...openIds]),
    improvementAttempts(lesson.id, openIds),
    improvementAttempts(lesson.id, doneIds, { finished: true }),
    lessonEdits(lesson.id),
  ]);
  const groupName = new Map(groups.map((group) => [group.id, group.name]));
  const whereOf = (taskId: string) => {
    const place = places.get(taskId);
    const toCourse = Boolean(place?.targets.some((target) => target.copy === 'course'));
    const ownHere = Boolean(place?.targets.some((target) => target.lessonId === lesson.id && target.copy === 'own'));
    const group = place?.groupId ? groupName.get(place.groupId) ?? '' : '';
    return { ownHere, label: !place?.groupId ? t('where.course') : !ownHere ? t('where.fromCopy', { group }) : toCourse ? t('where.both') : t('where.group') };
  };
  const commentsOf = (taskId: string) => sourceComments.filter((comment) => sourceLinks.some((link) => link.taskId === taskId && link.entityId === comment.id));

  // The feedback each improvement was made from (on any of its lessons), as the viewer may see it.
  const sourceComments = sourceLinks.length
    ? await prisma.curriculumComment.findMany({
        where: { AND: [commentScope, { id: { in: sourceLinks.map((link) => link.entityId) } }] },
        orderBy: { createdAt: 'asc' },
        select: { id: true, lessonId: true, selectedText: true, body: true, proposerName: true, isInstructorNote: true, lesson: { select: { courseId: true } } },
      })
    : [];
  const who = (comment: { proposerName: string; isInstructorNote: boolean }) =>
    comment.isInstructorNote
      ? t('noteFrom', { name: comment.proposerName.endsWith(NOTE_SUFFIX) ? comment.proposerName.slice(0, -NOTE_SUFFIX.length) : comment.proposerName })
      : comment.proposerName.startsWith(ANONYMOUS_LEARNER)
        ? t('learner', { from: comment.proposerName.replace(`${ANONYMOUS_LEARNER} · `, '') })
        : t('learnerPlain');
  const toFeedback = (comment: (typeof sourceComments)[number], taskId?: string): ViewFeedback => ({
    id: comment.id,
    passage: comment.selectedText ?? '',
    body: comment.body,
    who: who(comment),
    lessonHref: comment.lessonId === lesson.id ? null : lessonHref(comment.lessonId, comment.lesson.courseId),
    joinedAt: taskId ? (sourceLinks.find((link) => link.taskId === taskId && link.entityId === comment.id)?.createdAt.toISOString() ?? null) : null,
  });

  const drafts = (await Promise.all(draftRows.map((row) => lessonDraftView(row, viewer.id)))).filter(
    (draft): draft is LessonDraftView => draft !== null && draft.state !== 'failed'
  );
  // Plans being written for them (or written while nobody watched).
  const planDrafts = new Map(
    await Promise.all(
      openIds.map(async (id) => {
        const row = await currentDraft(AiProposalKind.TASK_PLAN, id);
        return [id, row ? await draftView(row, viewer.id, 'plan') : null] as const;
      })
    )
  );
  const improvements: ViewImprovement[] = [];
  // The main course's lesson behind a group's improvement: whether the person may edit it, and its text then.
  const courseLessonOf = async (lessonId: string | undefined) => {
    const found = lessonId ? await prisma.lesson.findUnique({ where: { id: lessonId }, select: { curriculumVersionId: true, markdownContent: true } }) : null;
    const version = found ? await loadVersionRef(found.curriculumVersionId) : null;
    const canEdit = Boolean(version && canEditVersion(viewer, version, [Permission.WRITE]));
    return { canEdit, text: canEdit && found ? found.markdownContent : null };
  };
  for (const task of open) {
    const place = places.get(task.id);
    const ref = await loadTaskRef(task.id);
    const { ownHere, label: whereLabel } = whereOf(task.id);
    const comments = commentsOf(task.id);
    const feedback = comments.map((comment) => toFeedback(comment, task.id));
    const courseLesson = await courseLessonOf(place?.courseLessons[lesson.id] ?? Object.values(place?.courseLessons ?? {})[0]);
    improvements.push({
      id: task.id,
      current: task.id === currentId,
      title: task.title,
      // Named after the lesson (made from feedback): here, what its feedback asks tells them apart.
      label: improvementLabel(task.title, [lesson.title], comments[0]?.body, task.plan),
      status: task.status,
      plan: planBody(task.plan),
      rawPlan: task.plan ?? '',
      whereLabel,
      scope: parsePlanScope(task.plan),
      choosesScope: Boolean(place?.groupId) && ownHere,
      courseReachable: Object.keys(place?.courseLessons ?? {}).length > 0,
      canEditCourse: courseLesson.canEdit,
      courseText: Boolean(place?.groupId) && ownHere && place?.courseLessons[lesson.id] ? courseLesson.text : null,
      group: place?.groupId ? (groupName.get(place.groupId) ?? '') : null,
      planDraft: planDrafts.get(task.id) ?? null,
      feedback,
      newSincePlan: feedbackSincePlan(
        task.plan,
        task.planUpdatedAt,
        feedback.flatMap((one) => (one.joinedAt ? [{ id: one.id, linkedAt: new Date(one.joinedAt) }] : []))
      ),
      asked: comments.length ? null : task.description?.trim() || null,
      notes: task.aiNotes?.trim() ?? '',
      noteIds: comments.filter((comment) => comment.lessonId === lesson.id).map((comment) => comment.id),
      aiReady: task.aiReady,
      workplace: task.workplace,
      savedHere: saved.some((change) => change.taskId === task.id),
      fromCopy: (() => {
        if (!place?.targets.some((target) => target.lessonId === lesson.id && target.copy === 'course')) return null;
        const copyLessons = Object.entries(place.courseLessons).flatMap(([copyLessonId, courseLessonId]) => (courseLessonId === lesson.id ? [copyLessonId] : []));
        const changes = (records.get(task.id)?.saved ?? []).filter((saved) => copyLessons.includes(saved.lessonId)).flatMap((saved) => saved.changes ?? []);
        return changes.length ? { group: place.groupId ? (groupName.get(place.groupId) ?? '') : '', changes } : null;
      })(),
      others: (paths.get(task.id)?.targets ?? [])
        .filter((target) => target.lessonId !== lesson.id)
        .map((target) => ({ label: target.label, state: target.state, href: target.href, done: target.done, phase: target.phase, toReview: target.toReview, course: target.course })),
      draft: drafts.find((draft) => draft.taskId === task.id) ?? null,
      attempts: attempts.get(task.id) ?? [],
      record: records.get(task.id) ?? null,
      canWork: Boolean(ref && canWorkOnFeedback(viewer, ref, 'tasks')),
    });
  }

  // This lesson's open feedback no improvement uses yet: to decide (use it, or answer it).
  const openComments = await prisma.curriculumComment.findMany({
    where: { AND: [commentScope, { lessonId: lesson.id, status: CurriculumCommentStatus.OPEN }] },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, lessonId: true, selectedText: true, body: true, proposerName: true, isInstructorNote: true, lesson: { select: { courseId: true } } },
  });
  const covered = openComments.length
    ? new Set(
        (
          await prisma.taskEntityLink.findMany({
            where: { entityType: TASK_ENTITY_TYPE.curriculumComment, entityId: { in: openComments.map((comment) => comment.id) } },
            select: { entityId: true },
          })
        ).map((link) => link.entityId)
      )
    : new Set<string>();
  const newFeedback = openComments.filter((comment) => !covered.has(comment.id)).map((comment) => toFeedback(comment));

  return {
    // The lesson's open improvement first, then earlier ones (and a group copy's, on the main course's lesson).
    improvements: [...improvements.filter((one) => one.current), ...improvements.filter((one) => !one.current)],
    done: [
      ...done.map((task): DoneImprovement => {
        const comments = commentsOf(task.id);
        return {
          id: task.id,
          label: improvementLabel(task.title, [lesson.title], comments[0]?.body, task.plan),
          whereLabel: whereOf(task.id).label,
          plan: planBody(task.plan),
          feedback: comments.map((comment) => toFeedback(comment, task.id)),
          asked: comments.length ? null : task.description?.trim() || null,
          record: records.get(task.id) ?? null,
          attempts: doneAttempts.get(task.id) ?? [],
          edited: false,
          at: (task.completedAt ?? task.updatedAt).toISOString(),
        };
      }),
      ...edits.map(
        (edit): DoneImprovement => ({
          id: edit.id,
          label: t('edited'),
          whereLabel: edit.by ?? '',
          plan: '',
          feedback: [],
          asked: null,
          record: {
            saved: [
              {
                id: edit.id,
                lessonId: lesson.id,
                courseId: lesson.courseId,
                lessonTitle: lesson.title,
                lessonPosition: 0,
                groupName: null,
                savedAt: edit.at.toISOString(),
                savedBy: edit.by,
                changes: edit.changes,
                seen: true,
                seenSince: edit.at.toISOString(),
                canPublish: false,
              },
            ],
            waiting: [],
          },
          attempts: [],
          edited: true,
          at: edit.at.toISOString(),
        })
      ),
    ].sort((a, b) => b.at.localeCompare(a.at)),
    newFeedback,
    // A course lesson's copies' images (the most recently saved copy's, where two use one name):
    // the page adds them to its own for what this lesson hasn't bound itself.
    copyAssets: mapUploadedAssets(copies.flatMap((copy) => copy.assetReferences)),
    // Revisions made for no improvement (from someone's Claude, or drafted here before improvements).
    looseDrafts: drafts.filter((draft) => !draft.taskId || !open.some((task) => task.id === draft.taskId)),
  };
}

export type ImprovementsViewData = Awaited<ReturnType<typeof loadImprovementsView>>;

/**
 * How much waits in a lesson's Improve mode, for the Edit | Improve switch: open improvements that
 * change it, its open feedback no improvement covers, and revisions sent for no improvement.
 */
export async function countImprovementWork(viewer: CrmViewer, lesson: { id: string; ownerGroupId: string | null }) {
  const copies = lesson.ownerGroupId ? [] : await prisma.lesson.findMany({ where: { baseLessonId: lesson.id }, select: { id: true } });
  const [candidates, openComments, looseDrafts] = await Promise.all([
    prisma.task.findMany({
      where: {
        AND: [
          taskScopeWhere(accessScope(viewer, 'tasks')),
          {
            kind: TASK_KIND.curriculum,
            status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] },
            entityLinks: { some: { entityType: TASK_ENTITY_TYPE.lesson, entityId: { in: [lesson.id, ...copies.map((copy) => copy.id)] } } },
          },
        ],
      },
      take: 60,
      select: { id: true },
    }),
    prisma.curriculumComment.findMany({
      where: { AND: [commentScopeWhere(accessScope(viewer, 'comments')), { lessonId: lesson.id, status: CurriculumCommentStatus.OPEN }] },
      take: 100,
      select: { id: true },
    }),
    prisma.aiProposal.count({ where: { kind: AiProposalKind.LESSON_REVISION, targetId: lesson.id, status: 'OPEN', taskId: null } }),
  ]);
  const places = await improvementPlacesFor(prisma, candidates.map((task) => task.id));
  const improvements = candidates.filter((task) => places.get(task.id)?.targets.some((target) => target.lessonId === lesson.id)).length;
  const covered = openComments.length
    ? await prisma.taskEntityLink.count({ where: { entityType: TASK_ENTITY_TYPE.curriculumComment, entityId: { in: openComments.map((comment) => comment.id) } } })
    : 0;
  return improvements + Math.max(0, openComments.length - covered) + looseDrafts;
}

/** Within a pass, a lesson published this long ago still counts in "Lesson 3 of 8". */
const PASS_MS = 12 * 60 * 60 * 1000;
/** A draft being written is heard from this often; longer, and it stopped. */
const WRITING_MS = 2 * 60 * 1000;

/**
 * Where the lesson open now is in the person's pass through its course (or group copy): the
 * lessons whose improvements' changes wait for review or are being written, with those they
 * published lately, in lesson order, and the next one to go to. Only improvements they may see.
 */
export async function loadReviewQueue(viewer: CrmViewer, lesson: { id: string; courseId: string; curriculumVersionId: string }): Promise<QueuePlace & { nextHref: string | null }> {
  const lessons = await prisma.lesson.findMany({
    where: { curriculumVersionId: lesson.curriculumVersionId },
    select: { id: true, position: true, title: true },
  });
  const ids = lessons.map((one) => one.id);
  const [drafts, published] = await Promise.all([
    prisma.aiProposal.findMany({
      where: {
        kind: AiProposalKind.LESSON_REVISION,
        targetId: { in: ids },
        taskId: { not: null },
        OR: [{ status: AiProposalStatus.OPEN }, { via: 'app', status: AiProposalStatus.WORKING, updatedAt: { gte: new Date(Date.now() - WRITING_MS) } }],
      },
      select: { targetId: true, taskId: true, status: true },
    }),
    prisma.lessonChange.findMany({
      where: { lessonId: { in: ids }, createdById: viewer.id, taskId: { not: null }, createdAt: { gte: new Date(Date.now() - PASS_MS) } },
      select: { lessonId: true, taskId: true },
    }),
  ]);
  const taskIds = Array.from(new Set(drafts.map((draft) => draft.taskId as string)));
  const visible = new Set(
    (
      await prisma.task.findMany({
        where: { AND: [taskScopeWhere(accessScope(viewer, 'tasks')), { id: { in: taskIds }, status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] } }] },
        select: { id: true },
      })
    ).map((task) => task.id)
  );
  const items = new Map<string, QueueLesson>();
  for (const one of lessons) {
    const own = drafts.filter((draft) => draft.targetId === one.id && visible.has(draft.taskId as string));
    const ready = own.find((draft) => draft.status === AiProposalStatus.OPEN);
    const writing = own.find((draft) => draft.status === AiProposalStatus.WORKING);
    const done = published.find((change) => change.lessonId === one.id);
    const pick = ready ?? writing;
    if (pick) items.set(one.id, { lessonId: one.id, position: one.position, title: one.title, taskId: pick.taskId, state: ready ? 'review' : 'writing' });
    else if (done) items.set(one.id, { lessonId: one.id, position: one.position, title: one.title, taskId: done.taskId, state: 'done' });
  }
  const place = queueOf(Array.from(items.values()), lesson.id);
  const nextHref = place.next ? `/admin/courses/${lesson.courseId}/lessons/${place.next.lessonId}/improvements${place.next.taskId ? `?i=${place.next.taskId}` : ''}` : null;
  return { ...place, nextHref };
}
