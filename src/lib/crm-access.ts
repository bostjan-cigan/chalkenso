import 'server-only';

import { Permission, UserRole } from '@prisma/client';
import { redirect } from 'next/navigation';
import {
  getCurrentUserSession,
  homePathForUser,
  mustSetUpTwoFactor,
  TWO_FACTOR_SETUP_PATH,
} from './admin-auth';
import {
  can,
  canAccessSection,
  courseGrantIds,
  GRANT_ENTITY_TYPES,
  groupGrantIds,
  guestReadsGroupVersion,
  type AdminSectionKey,
  type Grant,
} from './permissions';
import { assetInOrganization } from './asset-scope';
import { prisma } from './prisma';

/**
 * Who may reach which course data. Owners, admins and FULL members hold every section, so each check
 * passes for them first. A LIMITED member holds no section; they reach:
 *
 * - through a `course` grant (one course, or every course): its versions (core and group copies),
 *   its groups, and their learners' feedback, tasks and insights;
 * - through a `group` grant (an instructor): that group's page, roster and links, its own curriculum
 *   copy, READ on the version the group is assigned (to read the lessons), and the feedback and tasks
 *   of that group only. Never the core curriculum's other feedback, never editing core lessons;
 * - through a `group` grant with NOTES only (a guest instructor): their instructor link, notes, and the
 *   team preview of the version the group reads (`canOpenPreview`). No READ: nothing else.
 *
 * Lesson text is checked on the version (`canEditVersion`, `canPreviewVersion`); learner data on the
 * course or group (`canReadFeedback`, `canWorkOnFeedback`, the `*ScopeWhere` list filters). READ on a
 * version never opens its feedback. Every page and server action that touches course data uses these;
 * `requireMember()` alone is never enough.
 */

export type CrmViewer = {
  id: string;
  role: UserRole;
  grants: Grant[];
  /** The organisation the viewer works in (images are checked against it). */
  organizationId?: string | null;
};

export type VersionRef = { id: string; courseId: string; ownerGroupId: string | null };
export type GroupRef = { id: string; courseId: string };
/** Whose learner data something is: its course, and the groups it came from (none = the course's own). */
export type FeedbackRef = { courseId: string | null; groupIds: string[] };
/** Where feedback lives in the admin: learner comments and notes, or tasks. */
export type FeedbackArea = 'comments' | 'tasks';

const READ = [Permission.READ];

function principal(viewer: CrmViewer) {
  return { userId: viewer.id, role: viewer.role, grants: viewer.grants };
}

function hasSection(viewer: CrmViewer, section: AdminSectionKey, permissions: Permission[]) {
  return canAccessSection(viewer, section, permissions);
}

function versionResource(version: VersionRef) {
  return {
    type: GRANT_ENTITY_TYPES.CURRICULUM_VERSION,
    versionId: version.id,
    courseId: version.courseId,
    ownerGroupId: version.ownerGroupId,
  } as const;
}

// ── Who the viewer is ───────────────────────────────────────────────────────────────────────────

/** Owners, admins and FULL members: no limits. */
export function isUnrestricted(viewer: CrmViewer) {
  return hasSection(viewer, 'courses', READ);
}

/** Reaches whole courses (unrestricted, or limited to some or all courses). */
export function hasCourseLevelAccess(viewer: CrmViewer) {
  const courses = courseGrantIds(viewer.grants);
  return isUnrestricted(viewer) || courses === '*' || courses.length > 0;
}

/** An instructor of some groups, with no whole course. */
export function isGroupOnly(viewer: CrmViewer) {
  return !hasCourseLevelAccess(viewer) && groupGrantIds(viewer.grants).length > 0;
}

/** Reaches any course or group at all (a limited member without any sees nothing). */
export function hasAnyAccess(viewer: CrmViewer) {
  return hasCourseLevelAccess(viewer) || groupGrantIds(viewer.grants).length > 0;
}

// ── Courses, groups, versions ───────────────────────────────────────────────────────────────────

/** A whole course (versions, publishing, feedback switches, insights; never its Settings). */
export function canOnCourse(viewer: CrmViewer, courseId: string, permissions: Permission[]) {
  return hasSection(viewer, 'courses', permissions) || can(principal(viewer), { type: GRANT_ENTITY_TYPES.COURSE, courseId }, permissions);
}

/** A group (its page, roster and links): the Groups section, its course, or the group itself. */
export function canOnGroup(viewer: CrmViewer, group: GroupRef, permissions: Permission[]) {
  return (
    hasSection(viewer, 'groups', permissions) ||
    can(principal(viewer), { type: GRANT_ENTITY_TYPES.GROUP, groupId: group.id, courseId: group.courseId }, permissions)
  );
}

export async function loadVersionRef(versionId: string): Promise<VersionRef | null> {
  if (!versionId) {
    return null;
  }
  return prisma.curriculumVersion.findUnique({
    where: { id: versionId },
    select: { id: true, courseId: true, ownerGroupId: true },
  });
}

export async function loadGroupRef(groupId: string): Promise<GroupRef | null> {
  if (!groupId) {
    return null;
  }
  return prisma.courseGroup.findUnique({ where: { id: groupId }, select: { id: true, courseId: true } });
}

/**
 * Working on a version's lessons, sections and preview links: the Courses section for any version,
 * otherwise the permissions on it (a course grant covers core and group copies; an instructor's own
 * group copy; an instructor reads, never edits, the core version their group is assigned).
 */
export function canEditVersion(viewer: CrmViewer, version: VersionRef, permissions: Permission[]) {
  return hasSection(viewer, 'courses', permissions) || can(principal(viewer), versionResource(version), permissions);
}

/** Reading a version (the preview): Courses section, or READ on it. */
export function canPreviewVersion(viewer: CrmViewer, version: VersionRef) {
  return canEditVersion(viewer, version, READ);
}

/** A guest instructor's groups (NOTES) that read one of `versionIds` now. */
async function guestGroupsReading(viewer: CrmViewer, versionIds: string[]) {
  const groupIds = groupGrantIds(viewer.grants, [Permission.NOTES]);
  if (!groupIds.length || !versionIds.length) {
    return [];
  }
  return prisma.courseGroup.findMany({
    where: { id: { in: groupIds }, curriculumVersionId: { in: versionIds } },
    select: { id: true, courseId: true, curriculumVersionId: true },
  });
}

/**
 * The team preview of a version (its lessons, their images, and notes on them): `canPreviewVersion`,
 * or a guest instructor of a group that reads it (`guestReadsGroupVersion`). Only the preview and the
 * requests it makes use this; the version's other pages, its feedback and the group stay on READ.
 */
export async function canOpenPreview(viewer: CrmViewer, version: VersionRef) {
  if (canPreviewVersion(viewer, version)) {
    return true;
  }
  const groups = await guestGroupsReading(viewer, [version.id]);
  return groups.some((group) => guestReadsGroupVersion(principal(viewer), group, version));
}

/** `canOpenPreview` for the version a group reads, with both already loaded (no query). */
export function canOpenGroupPreview(viewer: CrmViewer, group: GroupRef, version: VersionRef) {
  return (
    canPreviewVersion(viewer, version) ||
    guestReadsGroupVersion(principal(viewer), { ...group, curriculumVersionId: version.id }, version)
  );
}

// ── Learner data: feedback, tasks ───────────────────────────────────────────────────────────────

function feedbackAllowed(viewer: CrmViewer, ref: FeedbackRef, area: FeedbackArea, permissions: Permission[]) {
  if (hasSection(viewer, area, permissions)) {
    return true;
  }
  const courseId = ref.courseId;
  if (!courseId) {
    return false;
  }
  const p = principal(viewer);
  return (
    can(p, { type: GRANT_ENTITY_TYPES.COURSE, courseId }, permissions) ||
    ref.groupIds.some((groupId) => can(p, { type: GRANT_ENTITY_TYPES.GROUP, groupId, courseId }, permissions))
  );
}

/** Reading feedback or a task: its course, or one of the groups it came from. */
export function canReadFeedback(viewer: CrmViewer, ref: FeedbackRef, area: FeedbackArea = 'comments') {
  return feedbackAllowed(viewer, ref, area, READ);
}

/**
 * Working on feedback or a task (reply, resolve, move, plan, assign): READ and TASKS on its course or
 * group; `extra` adds DELETE for deleting. Without TASKS a member reads feedback only.
 */
export function canWorkOnFeedback(viewer: CrmViewer, ref: FeedbackRef, area: FeedbackArea = 'comments', extra: Permission[] = []) {
  return feedbackAllowed(viewer, ref, area, [Permission.READ, Permission.TASKS, ...extra]);
}

/**
 * Adding instructor notes for a course or its groups: feedback work there (READ and TASKS), or, on a
 * group, a guest instructor's NOTES (which opens nothing else).
 */
export function canAddInstructorNotes(viewer: CrmViewer, ref: FeedbackRef) {
  if (canWorkOnFeedback(viewer, ref)) {
    return true;
  }
  const courseId = ref.courseId;
  return (
    courseId !== null &&
    ref.groupIds.some((groupId) => can(principal(viewer), { type: GRANT_ENTITY_TYPES.GROUP, groupId, courseId }, [Permission.NOTES]))
  );
}

/** Groups the viewer may add instructor notes for through their instructor link, by id. */
export async function groupsForInstructorNotes(viewer: CrmViewer): Promise<string[]> {
  const scope = accessScope(viewer, 'comments', [Permission.READ, Permission.TASKS]);
  const guestGroups = groupGrantIds(viewer.grants, [Permission.NOTES]);
  const groups = await prisma.courseGroup.findMany({
    where: scope.all || scope.courses === '*' ? {} : { OR: [groupScopeWhere(scope), { id: { in: guestGroups } }] },
    select: { id: true },
  });
  return groups.map((group) => group.id);
}

/** A comment's course and group, for the feedback checks. */
export async function loadCommentRef(commentId: string): Promise<(FeedbackRef & { versionId: string }) | null> {
  const comment = await prisma.curriculumComment.findUnique({
    where: { id: commentId },
    select: { groupId: true, curriculumVersion: { select: { id: true, courseId: true, ownerGroupId: true } } },
  });
  if (!comment) {
    return null;
  }
  const groups = [comment.groupId, comment.curriculumVersion.ownerGroupId].filter((id): id is string => Boolean(id));
  return { courseId: comment.curriculumVersion.courseId, groupIds: Array.from(new Set(groups)), versionId: comment.curriculumVersion.id };
}

/** A task's course and groups (from its links), for the feedback checks; no course = an untied task. */
export async function loadTaskRef(taskId: string): Promise<FeedbackRef | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { entityLinks: { select: { entityType: true, entityId: true } } },
  });
  if (!task) {
    return null;
  }
  return taskRefFromLinks(task.entityLinks);
}

/** `loadTaskRef` from links already loaded (a group copy counts as its group). */
export async function taskRefFromLinks(links: Array<{ entityType: string; entityId: string }>): Promise<FeedbackRef> {
  return (await taskRefsFromLinks([links]))[0];
}

/** `taskRefFromLinks` for many tasks at once: one query for all their versions. */
export async function taskRefsFromLinks(linkLists: Array<Array<{ entityType: string; entityId: string }>>): Promise<FeedbackRef[]> {
  const versionIdsOf = (links: Array<{ entityType: string; entityId: string }>) =>
    links.filter((link) => link.entityType === 'curriculum_version').map((link) => link.entityId);
  const allVersionIds = Array.from(new Set(linkLists.flatMap(versionIdsOf)));
  const versions = allVersionIds.length
    ? await prisma.curriculumVersion.findMany({
        where: { id: { in: allVersionIds } },
        select: { id: true, courseId: true, ownerGroupId: true },
      })
    : [];
  const versionById = new Map(versions.map((version) => [version.id, version]));
  return linkLists.map((links) => {
    const courseLink = links.find((link) => link.entityType === 'course');
    const groupIds = links.filter((link) => link.entityType === 'course_group').map((link) => link.entityId);
    const linked = versionIdsOf(links).flatMap((id) => versionById.get(id) ?? []);
    const courseId = courseLink?.entityId ?? linked[0]?.courseId ?? null;
    linked.forEach((version) => {
      if (version.ownerGroupId) groupIds.push(version.ownerGroupId);
    });
    return { courseId, groupIds: Array.from(new Set(groupIds)) };
  });
}

/**
 * Whether the viewer sees any of a version's feedback: its course, its own group (a group copy), or
 * a group of theirs that reads it (whose learners' feedback lands there).
 */
export async function canSeeVersionFeedback(viewer: CrmViewer, version: VersionRef) {
  if (hasSection(viewer, 'comments', READ) || canOnCourse(viewer, version.courseId, READ)) {
    return true;
  }
  const groups = groupGrantIds(viewer.grants);
  if (!groups.length) {
    return false;
  }
  if (version.ownerGroupId && groups.includes(version.ownerGroupId)) {
    return true;
  }
  return (await prisma.courseGroup.count({ where: { id: { in: groups }, curriculumVersionId: version.id } })) > 0;
}

/**
 * Whether the viewer may add an instructor note on a version's lesson, and which group it is for: a
 * group copy is always its group's; on another version, a `groupId` context (the preview's
 * `?group=`) must be a group of this course that reads this version; without one, the note is the
 * course's. Adding notes is feedback work (READ and TASKS there), or a guest instructor's NOTES on the
 * group (`canAddInstructorNotes`).
 */
export async function instructorNoteContext(
  viewer: CrmViewer,
  version: VersionRef,
  groupId: string | null
): Promise<{ ok: boolean; groupId: string | null }> {
  if (version.ownerGroupId) {
    return { ok: canAddInstructorNotes(viewer, { courseId: version.courseId, groupIds: [version.ownerGroupId] }), groupId: version.ownerGroupId };
  }
  if (groupId) {
    const group = await prisma.courseGroup.findUnique({ where: { id: groupId }, select: { courseId: true, curriculumVersionId: true } });
    const reads = group && group.courseId === version.courseId && group.curriculumVersionId === version.id;
    return { ok: Boolean(reads) && canAddInstructorNotes(viewer, { courseId: version.courseId, groupIds: [groupId] }), groupId: reads ? groupId : null };
  }
  return { ok: canWorkOnFeedback(viewer, { courseId: version.courseId, groupIds: [] }), groupId: null };
}

// ── List filters ────────────────────────────────────────────────────────────────────────────────

/** What a list may show: everything, or the courses (`*` = every course) and groups granted. */
export type AccessScope = { all: true } | { all: false; courses: '*' | string[]; groups: string[] };

export function accessScope(viewer: CrmViewer, section: AdminSectionKey, permissions: Permission[] = READ): AccessScope {
  if (hasSection(viewer, section, permissions)) {
    return { all: true };
  }
  return { all: false, courses: courseGrantIds(viewer.grants, permissions), groups: groupGrantIds(viewer.grants, permissions) };
}

const NOTHING = { id: { in: [] as string[] } };

/** Courses (`Course` where): whole courses only; group instructors see none. */
export function courseScopeWhere(scope: AccessScope) {
  if (scope.all || scope.courses === '*') return {};
  return scope.courses.length ? { id: { in: scope.courses } } : NOTHING;
}

/** Groups (`CourseGroup` where): the groups of granted courses, and granted groups. */
export function groupScopeWhere(scope: AccessScope) {
  if (scope.all || scope.courses === '*') return {};
  return { OR: [{ courseId: { in: scope.courses } }, { id: { in: scope.groups } }] };
}

/** Feedback (`CurriculumComment` where): granted courses, and comments from or on granted groups. */
export function commentScopeWhere(scope: AccessScope) {
  if (scope.all || scope.courses === '*') return {};
  return {
    OR: [
      { curriculumVersion: { courseId: { in: scope.courses } } },
      { groupId: { in: scope.groups } },
      { curriculumVersion: { ownerGroupId: { in: scope.groups } } },
    ],
  };
}

/** Tasks (`Task` where): tasks of granted courses and groups; untied tasks only for the section. */
export function taskScopeWhere(scope: AccessScope) {
  if (scope.all) return {};
  if (scope.courses === '*') return { entityLinks: { some: { entityType: 'course' } } };
  return {
    OR: [
      { entityLinks: { some: { entityType: 'course', entityId: { in: scope.courses } } } },
      { entityLinks: { some: { entityType: 'course_group', entityId: { in: scope.groups } } } },
    ],
  };
}

// ── Guards ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The signed-in viewer if `check` allows them; signed-out visitors go to login, others to their
 * home. Use for pages and actions whose access depends on the entity, not just a section.
 */
export async function requireCrmAccess(
  check: (viewer: CrmViewer) => boolean | Promise<boolean>
): Promise<CrmViewer> {
  const session = await getCurrentUserSession();

  if (!session) {
    redirect('/admin/login');
  }

  if (mustSetUpTwoFactor(session.user)) {
    redirect(TWO_FACTOR_SETUP_PATH);
  }

  const viewer: CrmViewer = {
    id: session.user.id,
    role: session.user.role,
    grants: session.user.grants,
    organizationId: session.user.organization?.id ?? null,
  };

  if (!(await check(viewer))) {
    redirect(homePathForUser(session.user));
  }

  return viewer;
}

export function requireCourseAccess(courseId: string, permissions: Permission[]) {
  return requireCrmAccess((viewer) => canOnCourse(viewer, courseId, permissions));
}

export function requireGroupAccess(groupId: string, permissions: Permission[]) {
  return requireCrmAccess(async (viewer) => {
    const group = await loadGroupRef(groupId);
    return Boolean(group && canOnGroup(viewer, group, permissions));
  });
}

/** `requireCrmAccess` for working on a version's content (lessons, sections, preview links). */
export function requireVersionEdit(versionId: string, permissions: Permission[]) {
  return requireCrmAccess(async (viewer) => {
    const version = await loadVersionRef(versionId);
    return Boolean(version && canEditVersion(viewer, version, permissions));
  });
}

/** Working on one comment (reply, resolve, turn into a task; `extra` DELETE to delete it). */
export function requireCommentWork(commentId: string, extra: Permission[] = []) {
  return requireCrmAccess(async (viewer) => {
    const ref = await loadCommentRef(commentId);
    return Boolean(ref && canWorkOnFeedback(viewer, ref, 'comments', extra));
  });
}

/** Working on one task (move, plan, assign, comment; `extra` DELETE to delete it). */
export function requireTaskWork(taskId: string, extra: Permission[] = []) {
  return requireCrmAccess(async (viewer) => {
    const ref = await loadTaskRef(taskId);
    return Boolean(ref && canWorkOnFeedback(viewer, ref, 'tasks', extra));
  });
}

/** The signed-in viewer, or null (for API routes that answer 401 instead of redirecting). */
export async function getCrmViewer(): Promise<CrmViewer | null> {
  const session = await getCurrentUserSession();

  return session && !mustSetUpTwoFactor(session.user)
    ? { id: session.user.id, role: session.user.role, grants: session.user.grants, organizationId: session.user.organization?.id ?? null }
    : null;
}

// ── Images ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Whether the viewer may load an uploaded image: one of the organisation they work in (never
 * another's, whatever their rights), and there the CRM sections that show lessons, or the preview of
 * some version (core or group curriculum) with a lesson that uses it.
 */
export async function canViewAsset(viewer: CrmViewer, assetId: string): Promise<boolean> {
  if (!viewer.organizationId || !(await assetInOrganization(assetId, viewer.organizationId))) {
    return false;
  }
  if (
    (['courses', 'comments', 'groups'] as const).some((section) =>
      hasSection(viewer, section, READ)
    )
  ) {
    return true;
  }

  const references = await prisma.lessonAssetReference.findMany({
    where: { assetId },
    select: {
      lesson: {
        select: {
          curriculumVersion: { select: { id: true, courseId: true, ownerGroupId: true } },
        },
      },
    },
    take: 50,
  });

  const versions = references.map((reference) => reference.lesson.curriculumVersion);
  if (versions.some((version) => canPreviewVersion(viewer, version))) {
    return true;
  }
  // A guest instructor sees the images of the lessons their group reads (the team preview).
  const groups = await guestGroupsReading(viewer, versions.map((version) => version.id));
  return versions.some((version) => groups.some((group) => guestReadsGroupVersion(principal(viewer), group, version)));
}

/**
 * A first, cheap check for uploading lesson images: WRITE somewhere. The upload route then checks
 * the course the image is for (`canUploadToCourse`).
 */
export function canUploadLessonAssets(viewer: CrmViewer) {
  return viewer.grants.some((grant) => grant.permissions.includes(Permission.WRITE));
}

/** Uploading lesson images for one course: WRITE on it, or on one of its groups' copies. */
export async function canUploadToCourse(viewer: CrmViewer, courseId: string) {
  if (canOnCourse(viewer, courseId, [Permission.WRITE])) {
    return true;
  }
  const groups = groupGrantIds(viewer.grants, [Permission.WRITE]);
  return groups.length > 0 && (await prisma.curriculumVersion.count({ where: { courseId, ownerGroupId: { in: groups } } })) > 0;
}
