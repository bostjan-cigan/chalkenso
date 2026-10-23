import 'server-only';

import { parsePlanScope, type PlanScope } from './plan-scope';
import type { DbClient } from './prisma';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE } from './tasks';

/**
 * The lessons an improvement changes (its targets): the lessons it links (one or several, in a
 * group's copy or the course's own), and for a group's improvement whose plan says "group and main
 * course", the main course's lesson each of those copies was made from. It's done when every target
 * has a saved change for it (`task-flow.ts`). A suggestion made for the course from it
 * ("Suggest for the course") takes the main course's part over, and so does keeping it to the group.
 */

export type ImprovementTarget = {
  lessonId: string;
  /** `own`: a lesson the improvement links; `course`: the main course's lesson behind one of them. */
  copy: 'own' | 'course';
  /** For a main-course target: the group copy's lesson it follows. */
  fromLessonId: string | null;
};

export type ImprovementPlaces = {
  /** Its own lessons in the order they were added, then the main course's (when the plan says so). */
  targets: ImprovementTarget[];
  /** A group's improvement: the group whose copy it changes. */
  groupId: string | null;
  /** For a group's improvement: the main course's lesson behind each of its lessons, where there is one. */
  courseLessons: Record<string, string>;
  scope: PlanScope | null;
  /** Kept to the group from the course's side (the course's list of group changes). */
  groupOnly: boolean;
  /** The course's own improvement suggested from it, which takes the main course's part over. */
  suggestionId: string | null;
};

/** Where each of these improvements goes, in a fixed number of queries. */
export async function improvementPlacesFor(db: DbClient, taskIds: string[]): Promise<Map<string, ImprovementPlaces>> {
  const ids = Array.from(new Set(taskIds));
  const result = new Map<string, ImprovementPlaces>();
  if (!ids.length) return result;
  const [tasks, links, suggestions] = await Promise.all([
    db.task.findMany({ where: { id: { in: ids } }, select: { id: true, plan: true, groupOnly: true } }),
    db.taskEntityLink.findMany({
      where: { taskId: { in: ids }, entityType: { in: [TASK_ENTITY_TYPE.lesson, TASK_ENTITY_TYPE.curriculumVersion] } },
      orderBy: { createdAt: 'asc' },
      select: { taskId: true, entityType: true, entityId: true },
    }),
    db.taskEntityLink.findMany({
      where: { entityType: TASK_ENTITY_TYPE.task, role: TASK_ENTITY_ROLE.source, entityId: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: { taskId: true, entityId: true },
    }),
  ]);
  const lessonIds = Array.from(new Set(links.filter((link) => link.entityType === TASK_ENTITY_TYPE.lesson).map((link) => link.entityId)));
  const versionIds = Array.from(new Set(links.filter((link) => link.entityType === TASK_ENTITY_TYPE.curriculumVersion).map((link) => link.entityId)));
  const [lessons, versions] = await Promise.all([
    lessonIds.length ? db.lesson.findMany({ where: { id: { in: lessonIds } }, select: { id: true, baseLessonId: true } }) : [],
    versionIds.length ? db.curriculumVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, ownerGroupId: true } }) : [],
  ]);
  const baseIds = Array.from(new Set(lessons.map((lesson) => lesson.baseLessonId).filter((id): id is string => Boolean(id))));
  // The lesson a copy was made from, only while it is still a course lesson (not another group's).
  const bases = baseIds.length
    ? await db.lesson.findMany({ where: { id: { in: baseIds }, curriculumVersion: { ownerGroupId: null } }, select: { id: true } })
    : [];
  const baseExists = new Set(bases.map((lesson) => lesson.id));
  const baseOf = new Map(lessons.map((lesson) => [lesson.id, lesson.baseLessonId && baseExists.has(lesson.baseLessonId) ? lesson.baseLessonId : null]));
  const groupOfVersion = new Map(versions.map((version) => [version.id, version.ownerGroupId]));

  for (const task of tasks) {
    const own = Array.from(
      new Set(links.filter((link) => link.taskId === task.id && link.entityType === TASK_ENTITY_TYPE.lesson).map((link) => link.entityId))
    ).filter((lessonId) => baseOf.has(lessonId));
    const versionId = links.find((link) => link.taskId === task.id && link.entityType === TASK_ENTITY_TYPE.curriculumVersion)?.entityId;
    const groupId = (versionId && groupOfVersion.get(versionId)) || null;
    const courseLessons: Record<string, string> = {};
    if (groupId) {
      for (const lessonId of own) {
        const base = baseOf.get(lessonId);
        if (base) courseLessons[lessonId] = base;
      }
    }
    const scope = parsePlanScope(task.plan);
    const suggestionId = suggestions.find((link) => link.entityId === task.id)?.taskId ?? null;
    const toCourse = Boolean(groupId) && scope === 'group and core' && !task.groupOnly && !suggestionId;
    const targets: ImprovementTarget[] = own.map((lessonId) => ({ lessonId, copy: 'own', fromLessonId: null }));
    if (toCourse) {
      for (const lessonId of own) {
        const courseLessonId = courseLessons[lessonId];
        if (courseLessonId && !targets.some((target) => target.lessonId === courseLessonId)) {
          targets.push({ lessonId: courseLessonId, copy: 'course', fromLessonId: lessonId });
        }
      }
    }
    result.set(task.id, { targets, groupId, courseLessons, scope, groupOnly: task.groupOnly, suggestionId });
  }
  return result;
}

export async function improvementPlaces(db: DbClient, taskId: string): Promise<ImprovementPlaces | null> {
  return (await improvementPlacesFor(db, [taskId])).get(taskId) ?? null;
}

/** Whether the improvement changes this lesson (it links it, or it is the main course's part of it). */
export async function isImprovementTarget(db: DbClient, taskId: string, lessonId: string): Promise<boolean> {
  return Boolean((await improvementPlaces(db, taskId))?.targets.some((target) => target.lessonId === lessonId));
}
