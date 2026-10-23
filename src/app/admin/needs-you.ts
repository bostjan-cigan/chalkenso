import 'server-only';

import { cache } from 'react';
import { getTranslations } from 'next-intl/server';
import { Permission, TaskStatus } from '@prisma/client';
import { ui } from '@/extensions/ui';
import { accessScope, canEditVersion, commentScopeWhere, getCrmViewer, hasAnyAccess, loadVersionRef, taskScopeWhere, type CrmViewer } from '@/lib/crm-access';
import { countOpenFeedback } from '@/lib/feedback-list';
import { prisma } from '@/lib/prisma';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE } from '@/lib/tasks';

/** One line of "Needs you": what waits, and where it is handled. */
export type NeedsYouItem = { key: string; text: string; href: string; count: number };

/**
 * Lessons saved with an improvement's change that learners don't see yet (a draft save), which the
 * viewer may publish: per group (its copy) and per course (its own lessons), counted by lesson.
 */
async function unpublishedChanges(viewer: CrmViewer) {
  const changes = await prisma.lessonChange.findMany({
    where: { settledAt: null, taskId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: {
      revision: true,
      lesson: {
        select: {
          id: true,
          publishedAt: true,
          publishedRevision: true,
          curriculumVersionId: true,
          curriculumVersion: { select: { ownerGroup: { select: { id: true, name: true } }, course: { select: { id: true, title: true } } } },
        },
      },
    },
  });
  const waiting = changes.filter((change) => !(change.lesson.publishedAt && (change.lesson.publishedRevision ?? -1) >= change.revision));
  const editable = new Map<string, boolean>();
  for (const versionId of Array.from(new Set(waiting.map((change) => change.lesson.curriculumVersionId)))) {
    const ref = await loadVersionRef(versionId);
    editable.set(versionId, Boolean(ref && canEditVersion(viewer, ref, [Permission.WRITE])));
  }
  const byGroup = new Map<string, { name: string; lessons: Set<string> }>();
  const byCourse = new Map<string, { title: string; lessons: Set<string> }>();
  for (const { lesson } of waiting) {
    if (!editable.get(lesson.curriculumVersionId)) continue;
    const { ownerGroup, course } = lesson.curriculumVersion;
    const entry = ownerGroup
      ? byGroup.get(ownerGroup.id) ?? byGroup.set(ownerGroup.id, { name: ownerGroup.name, lessons: new Set() }).get(ownerGroup.id)!
      : byCourse.get(course.id) ?? byCourse.set(course.id, { title: course.title, lessons: new Set() }).get(course.id)!;
    entry.lessons.add(lesson.id);
  }
  return { byGroup, byCourse };
}

/**
 * What waits on the viewer, in their courses and groups: feedback nobody has answered yet (by group,
 * or on a course's own lessons), changes groups suggested for a course, and (the edition's) drafts to
 * review. Counted in the database, once per request (no arguments, so React's cache shares it): the
 * sidebar's Home count and Home read the same answer. Its lines are in the request's language
 * (`app.needsYou`).
 */
export const loadNeedsYou = cache(async (): Promise<NeedsYouItem[]> => {
  const viewer = await getCrmViewer();
  if (!viewer || !hasAnyAccess(viewer)) return [];
  const [fresh, suggested, mine, drafts, unpublished, t] = await Promise.all([
    countOpenFeedback(commentScopeWhere(accessScope(viewer, 'comments')), { unanswered: true }),
    // A group's change suggested for the course waits for a yes or no: a core task, still to do, made
    // from a group's task.
    prisma.task.findMany({
      where: {
        AND: [
          taskScopeWhere(accessScope(viewer, 'tasks')),
          { status: TaskStatus.TODO },
          { entityLinks: { some: { entityType: TASK_ENTITY_TYPE.task, role: TASK_ENTITY_ROLE.source } } },
        ],
      },
      select: { entityLinks: { where: { entityType: TASK_ENTITY_TYPE.course }, select: { entityId: true } } },
    }),
    // Improvements assigned to the viewer, still being worked on: by group, or on a course's own lessons.
    prisma.task.findMany({
      where: {
        AND: [
          taskScopeWhere(accessScope(viewer, 'tasks')),
          { assigneeId: viewer.id, status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] } },
        ],
      },
      select: {
        entityLinks: {
          where: { entityType: { in: [TASK_ENTITY_TYPE.courseGroup, TASK_ENTITY_TYPE.course] } },
          select: { entityType: true, entityId: true },
        },
      },
    }),
    ui.waitingDrafts ? ui.waitingDrafts() : Promise.resolve(0),
    unpublishedChanges(viewer),
    getTranslations('app.needsYou'),
  ]);

  const suggestionsByCourse = new Map<string, number>();
  for (const task of suggested) {
    const courseId = task.entityLinks[0]?.entityId;
    if (courseId) suggestionsByCourse.set(courseId, (suggestionsByCourse.get(courseId) ?? 0) + 1);
  }
  const mineByGroup = new Map<string, number>();
  const mineByCourse = new Map<string, number>();
  for (const task of mine) {
    const group = task.entityLinks.find((link) => link.entityType === TASK_ENTITY_TYPE.courseGroup)?.entityId;
    const course = task.entityLinks.find((link) => link.entityType === TASK_ENTITY_TYPE.course)?.entityId;
    if (group) mineByGroup.set(group, (mineByGroup.get(group) ?? 0) + 1);
    else if (course) mineByCourse.set(course, (mineByCourse.get(course) ?? 0) + 1);
  }
  const groupIds = Array.from(new Set([...Array.from(fresh.byGroup.keys()), ...Array.from(mineByGroup.keys())]));
  const versionIds = Array.from(fresh.byVersion.keys());
  const [groups, versions, courses] = await Promise.all([
    groupIds.length ? prisma.courseGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }) : [],
    versionIds.length
      ? prisma.curriculumVersion.findMany({
          where: { id: { in: versionIds } },
          select: { id: true, ownerGroup: { select: { id: true, name: true } }, course: { select: { id: true, title: true } } },
        })
      : [],
    suggestionsByCourse.size || mineByCourse.size
      ? prisma.course.findMany({
          where: { id: { in: Array.from(new Set([...Array.from(suggestionsByCourse.keys()), ...Array.from(mineByCourse.keys())])) } },
          select: { id: true, title: true },
        })
      : [],
  ]);

  // New feedback per group (its learners', and notes on its own copy), then per course (its own lessons).
  const byGroup = new Map<string, { name: string; count: number }>();
  for (const group of groups) byGroup.set(group.id, { name: group.name, count: fresh.byGroup.get(group.id) ?? 0 });
  const byCourse = new Map<string, { title: string; count: number }>();
  for (const version of versions) {
    const count = fresh.byVersion.get(version.id) ?? 0;
    if (version.ownerGroup) {
      const entry = byGroup.get(version.ownerGroup.id) ?? { name: version.ownerGroup.name, count: 0 };
      entry.count += count;
      byGroup.set(version.ownerGroup.id, entry);
    } else {
      const entry = byCourse.get(version.course.id) ?? { title: version.course.title, count: 0 };
      entry.count += count;
      byCourse.set(version.course.id, entry);
    }
  }

  const items: NeedsYouItem[] = [];
  for (const [id, group] of Array.from(byGroup.entries()).sort((a, b) => b[1].count - a[1].count)) {
    if (!group.count) continue;
    items.push({
      key: `group:${id}`,
      text: t('groupFeedback', { count: group.count, group: group.name }),
      href: `/admin/courses/groups/${id}?tab=feedback`,
      count: group.count,
    });
  }
  for (const [id, course] of Array.from(byCourse.entries())) {
    if (!course.count) continue;
    items.push({
      key: `course:${id}`,
      text: t('courseFeedback', { count: course.count, course: course.title }),
      href: `/admin/courses/${id}/feedback`,
      count: course.count,
    });
  }
  // The improvements that are the viewer's, where they are listed.
  for (const group of groups) {
    const count = mineByGroup.get(group.id) ?? 0;
    if (!count) continue;
    items.push({
      key: `mine-group:${group.id}`,
      text: t('groupImprovements', { count, group: group.name }),
      href: `/admin/courses/groups/${group.id}?tab=feedback&show=change`,
      count,
    });
  }
  for (const course of courses) {
    const count = mineByCourse.get(course.id) ?? 0;
    if (!count) continue;
    items.push({
      key: `mine-course:${course.id}`,
      text: t('courseImprovements', { count, course: course.title }),
      href: `/admin/courses/${course.id}/feedback?show=change&group=course`,
      count,
    });
  }
  for (const course of courses) {
    const count = suggestionsByCourse.get(course.id) ?? 0;
    if (!count) continue;
    items.push({
      key: `suggested:${course.id}`,
      text: t('suggested', { count, course: course.title }),
      href: `/admin/courses/${course.id}/groups`,
      count,
    });
  }
  // Changes saved as drafts: learners see them once the lessons are published (the Improvements list's publish bar).
  for (const [id, group] of Array.from(unpublished.byGroup.entries())) {
    items.push({
      key: `unpublished-group:${id}`,
      text: t('groupUnpublished', { count: group.lessons.size, group: group.name }),
      href: `/admin/courses/groups/${id}?tab=feedback&show=change`,
      count: group.lessons.size,
    });
  }
  for (const [id, course] of Array.from(unpublished.byCourse.entries())) {
    items.push({
      key: `unpublished-course:${id}`,
      text: t('courseUnpublished', { count: course.lessons.size, course: course.title }),
      href: `/admin/courses/${id}/feedback?show=change&group=course`,
      count: course.lessons.size,
    });
  }
  if (drafts) {
    items.push({
      key: 'drafts',
      text: t('drafts', { count: drafts }),
      href: '/admin/proposals',
      count: drafts,
    });
  }
  return items;
});
