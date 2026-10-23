import 'server-only';

import { AiProposalKind, AiProposalStatus, Permission } from '@prisma/client';
import type { ProposedChange } from '@/app/admin/courses/components/workspace/revision';
import { displayName } from './admin-auth';
import { canEditVersion, loadVersionRef, type CrmViewer } from './crm-access';
import { prisma } from './prisma';

/**
 * What a finished improvement did, for "What changed": each save on each of its lessons (the
 * changed blocks, who saved them and when, whether learners see them yet), and its changes still
 * waiting for review on another lesson (the main course's part of a group's improvement).
 */

type RecordLesson = {
  lessonId: string;
  courseId: string;
  lessonTitle: string;
  lessonPosition: number;
  /** The group whose copy the lesson is (null: the main course's lesson). */
  groupName: string | null;
};

export type SavedChangeRecord = RecordLesson & {
  id: string;
  savedAt: string;
  savedBy: string | null;
  /** The changed blocks; null for a save made before they were recorded. */
  changes: ProposedChange[] | null;
  /** Learners see it: the lesson's published revision includes this save. */
  seen: boolean;
  /** Since when learners see it (when it reached them). */
  seenSince: string | null;
  /** The viewer may publish the lesson (it's saved as a draft and theirs to edit). */
  canPublish: boolean;
};

export type ImprovementRecord = {
  saved: SavedChangeRecord[];
  waiting: RecordLesson[];
};

const asChanges = (value: unknown): ProposedChange[] | null =>
  Array.isArray(value) ? (value as ProposedChange[]).filter((change) => change && Array.isArray(change.before) && Array.isArray(change.after)) : null;

/** The records of these improvements (the caller has checked the viewer may see them). */
export async function improvementRecords(viewer: CrmViewer, taskIds: string[]): Promise<Map<string, ImprovementRecord>> {
  const ids = Array.from(new Set(taskIds));
  const records = new Map<string, ImprovementRecord>();
  if (!ids.length) return records;
  const [changes, drafts] = await Promise.all([
    prisma.lessonChange.findMany({
      where: { taskId: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, taskId: true, lessonId: true, revision: true, changes: true, settledAt: true, createdAt: true, createdById: true },
    }),
    prisma.aiProposal.findMany({
      where: { taskId: { in: ids }, kind: AiProposalKind.LESSON_REVISION, status: AiProposalStatus.OPEN },
      select: { taskId: true, targetId: true },
    }),
  ]);
  const lessonIds = Array.from(new Set([...changes.map((change) => change.lessonId), ...drafts.map((draft) => draft.targetId)]));
  const userIds = Array.from(new Set(changes.flatMap((change) => (change.createdById ? [change.createdById] : []))));
  const [lessons, users] = await Promise.all([
    prisma.lesson.findMany({
      where: { id: { in: lessonIds } },
      select: {
        id: true,
        courseId: true,
        title: true,
        position: true,
        publishedAt: true,
        publishedRevision: true,
        curriculumVersionId: true,
        curriculumVersion: { select: { ownerGroup: { select: { name: true } } } },
      },
    }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, identifier: true } }),
  ]);
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const userName = new Map(users.map((user) => [user.id, displayName(user)]));
  const editable = new Map(
    await Promise.all(
      Array.from(new Set(lessons.map((lesson) => lesson.curriculumVersionId))).map(async (versionId) => {
        const ref = await loadVersionRef(versionId);
        return [versionId, Boolean(ref && canEditVersion(viewer, ref, [Permission.WRITE]))] as const;
      })
    )
  );
  const place = (lesson: (typeof lessons)[number]): RecordLesson => ({
    lessonId: lesson.id,
    courseId: lesson.courseId,
    lessonTitle: lesson.title,
    lessonPosition: lesson.position,
    groupName: lesson.curriculumVersion.ownerGroup?.name ?? null,
  });
  const recordOf = (taskId: string) => {
    let record = records.get(taskId);
    if (!record) {
      record = { saved: [], waiting: [] };
      records.set(taskId, record);
    }
    return record;
  };

  for (const change of changes) {
    const lesson = lessonById.get(change.lessonId);
    if (!change.taskId || !lesson) continue;
    const seen = Boolean(lesson.publishedAt) && (lesson.publishedRevision ?? -1) >= change.revision;
    recordOf(change.taskId).saved.push({
      ...place(lesson),
      id: change.id,
      savedAt: change.createdAt.toISOString(),
      savedBy: change.createdById ? userName.get(change.createdById) ?? null : null,
      changes: asChanges(change.changes),
      seen,
      seenSince: seen ? (change.settledAt ?? lesson.publishedAt)?.toISOString() ?? null : null,
      canPublish: !seen && Boolean(editable.get(lesson.curriculumVersionId)),
    });
  }
  for (const draft of drafts) {
    const lesson = lessonById.get(draft.targetId);
    if (!draft.taskId || !lesson) continue;
    const record = recordOf(draft.taskId);
    if (!record.waiting.some((waiting) => waiting.lessonId === lesson.id)) record.waiting.push(place(lesson));
  }
  return records;
}
