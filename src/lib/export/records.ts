import 'server-only';

import { CurriculumVersionStatus, MemberAccess, type OrgRole, type Prisma } from '@prisma/client';
import { LANGUAGES, isLocale } from '@/i18n/config';
import { accessScope, commentScopeWhere, taskScopeWhere } from '@/lib/crm-access';
import type { CsvCell } from '@/lib/csv';
import { feedbackCsvHeader, feedbackCsvRow } from '@/lib/feedback-csv';
import { courseFeedbackWhere, listFeedback, type FeedbackState } from '@/lib/feedback-list';
import { prisma } from '@/lib/prisma';
import { listTasks, userDisplayName } from '@/lib/tasks';
import { yamlScalar } from '@/lib/vault-layout';
import type { ExportedLesson } from './curriculums';
import type { ExportContext, ExportVersion } from './types';
import type { ExportWords, FeedbackWords } from './words';

/**
 * The export's records next to the lessons: courses, groups and their rosters, the version history
 * (with the text of every published revision), feedback, tasks and, for owners and admins, the team.
 * Each reads through the same access checks as the app (`ExportScope`, src/lib/crm-access.ts) and
 * names the organisation in every query; long lists are read in pages and written as they come.
 */

const PAGE = 500;
const IN_CHUNK = 1000;

function chunks<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

const yesNo = (t: ExportWords, value: boolean) => (value ? t('values.yes') : t('values.no'));

/** "v3", or "Spring 2026’s copy (v3)": how feedback and history name a version. */
function versionName(version: ExportVersion | undefined, feedbackWords: FeedbackWords): string | null {
  if (!version) return null;
  return version.group
    ? feedbackWords('groupCopy', { group: version.group.name, version: version.label })
    : feedbackWords('ownLessons', { version: version.label });
}

// ── Courses, groups, rosters ────────────────────────────────────────────────────────────────────

export async function writeCourses(context: ExportContext, t: ExportWords) {
  const { scope } = context;
  const organizationId = scope.organization.id;
  const ids = scope.courses.map((course) => course.id);
  async function* rows(): AsyncGenerator<CsvCell[]> {
    for (const part of chunks(ids)) {
      const courses = await prisma.course.findMany({
        where: { organizationId, id: { in: part } },
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
        select: {
          title: true,
          slug: true,
          summary: true,
          outcome: true,
          tags: true,
          language: true,
          publicListed: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      for (const course of courses) {
        yield [
          course.title,
          course.slug,
          course.summary,
          course.outcome,
          course.tags.join(', '),
          isLocale(course.language) ? LANGUAGES[course.language].name : course.language,
          yesNo(t, course.publicListed),
          context.time(course.createdAt),
          context.time(course.updatedAt),
        ];
      }
    }
  }
  const columns = ['title', 'slug', 'summary', 'outcome', 'tags', 'language', 'listed', 'created', 'updated'] as const;
  await context.files.csv('courses.csv', columns.map((column) => t(`columns.courses.${column}`)), rows());
  context.describe('courses.csv', t('describe.courses'));
}

export async function writeGroups(context: ExportContext, t: ExportWords) {
  const { scope } = context;
  const groupIds = scope.groups.map((group) => group.id);
  const versionById = new Map(scope.versions.map((version) => [version.id, version]));
  const labels = new Map<string, string>();
  const instructors = new Map<string, string[]>();
  const learnerCounts = new Map<string, number>();
  for (const part of chunks(groupIds)) {
    const [versions, teachers, counts] = await Promise.all([
      prisma.curriculumVersion.findMany({
        where: { course: { organizationId: scope.organization.id }, OR: [{ groups: { some: { id: { in: part } } } }, { ownerGroupId: { in: part } }] },
        select: { id: true, label: true },
      }),
      prisma.courseGroupInstructor.findMany({
        where: { groupId: { in: part } },
        orderBy: { createdAt: 'asc' },
        select: { groupId: true, user: { select: { firstName: true, lastName: true, identifier: true } } },
      }),
      prisma.courseGroupMember.groupBy({ by: ['groupId'], where: { groupId: { in: part } }, _count: { _all: true } }),
    ]);
    versions.forEach((version) => labels.set(version.id, version.label));
    teachers.forEach((row) => instructors.set(row.groupId, [...(instructors.get(row.groupId) ?? []), userDisplayName(row.user)]));
    counts.forEach((row) => learnerCounts.set(row.groupId, row._count._all));
  }

  const groupRows: CsvCell[][] = scope.groups.map((group) => {
    const own = scope.versions.find((version) => version.group?.id === group.id);
    return [
      group.name,
      scope.courseTitles.get(group.courseId) ?? null,
      group.slug,
      context.day(group.startsAt),
      context.day(group.endsAt),
      group.versionId ? (labels.get(group.versionId) ?? versionById.get(group.versionId)?.label ?? null) : null,
      own ? `${own.folder}/` : null,
      (instructors.get(group.id) ?? []).join(', '),
      learnerCounts.get(group.id) ?? 0,
      group.description,
      context.time(group.createdAt),
    ];
  });
  const columns = ['name', 'course', 'slug', 'starts', 'ends', 'reads', 'ownCopy', 'instructors', 'learners', 'description', 'created'] as const;
  await context.files.csv('groups.csv', columns.map((column) => t(`columns.groups.${column}`)), groupRows);
  context.describe('groups.csv', t('describe.groupList'));

  // The rosters, as the group page shows them: names only (never their links).
  const groupById = new Map(scope.groups.map((group) => [group.id, group]));
  async function* learners(): AsyncGenerator<CsvCell[]> {
    for (const part of chunks(groupIds)) {
      const members = await prisma.courseGroupMember.findMany({
        where: { groupId: { in: part }, group: { course: { organizationId: scope.organization.id } } },
        orderBy: [{ groupId: 'asc' }, { position: 'asc' }],
        select: { groupId: true, position: true, fullName: true },
      });
      for (const member of members) {
        const group = groupById.get(member.groupId);
        yield [group?.name ?? null, group ? (scope.courseTitles.get(group.courseId) ?? null) : null, member.position, member.fullName];
      }
    }
  }
  const learnerColumns = ['group', 'course', 'number', 'name'] as const;
  await context.files.csv('group-learners.csv', learnerColumns.map((column) => t(`columns.learners.${column}`)), learners());
  context.describe('group-learners.csv', t('describe.learners'));
}

// ── Version history ─────────────────────────────────────────────────────────────────────────────

export async function writeVersions(context: ExportContext, t: ExportWords) {
  const { scope } = context;
  const lessonCounts = new Map<string, number>();
  for (const part of chunks(scope.versions.map((version) => version.id))) {
    const counts = await prisma.lesson.groupBy({
      by: ['curriculumVersionId'],
      where: { curriculumVersionId: { in: part }, course: { organizationId: scope.organization.id } },
      _count: { _all: true },
    });
    counts.forEach((row) => lessonCounts.set(row.curriculumVersionId, row._count._all));
  }
  const rows: CsvCell[][] = scope.versions.map((version) => [
    version.courseTitle,
    version.label,
    version.group ? t('values.groupCopy') : t('values.core'),
    version.group?.name ?? null,
    version.baseVersion?.label ?? null,
    version.status === CurriculumVersionStatus.PUBLISHED ? t('values.published') : t('values.draft'),
    context.time(version.createdAt),
    context.time(version.publishedAt),
    version.publisherName,
    context.time(version.archivedAt),
    lessonCounts.get(version.id) ?? 0,
    `${version.folder}/`,
  ]);
  const columns = ['course', 'version', 'kind', 'group', 'copiedFrom', 'status', 'created', 'published', 'publishedBy', 'closed', 'lessons', 'folder'] as const;
  await context.files.csv('history/versions.csv', columns.map((column) => t(`columns.versions.${column}`)), rows);
  context.describe('history/versions.csv', t('describe.versions'));
}

/**
 * Every published revision of the lessons exported: its text as a file of its own (while there's
 * time), and a row in history/publications.csv (always).
 */
export async function writePublications(
  context: ExportContext,
  t: ExportWords,
  feedbackWords: FeedbackWords,
  lessons: Map<string, ExportedLesson>
) {
  const { scope } = context;
  const organizationId = scope.organization.id;
  const versionById = new Map(scope.versions.map((version) => [version.id, version]));
  const lessonIds = Array.from(lessons.keys());
  const select = {
    id: true,
    lessonId: true,
    revision: true,
    title: true,
    publishedAt: true,
    publisherName: true,
    addedBlocks: true,
    removedBlocks: true,
  } satisfies Prisma.LessonPublicationSelect;
  type Row = Prisma.LessonPublicationGetPayload<{ select: typeof select }>;

  const publications: Row[] = [];
  for (const part of chunks(lessonIds)) {
    publications.push(
      ...(await prisma.lessonPublication.findMany({
        where: { lessonId: { in: part }, lesson: { course: { organizationId } } },
        select,
      }))
    );
  }
  const place = (row: Row) => lessons.get(row.lessonId)!;
  // Course by course and version by version, as versions.csv lists them; lessons in order, oldest revision first.
  const versionOrder = new Map(scope.versions.map((version, index) => [version.id, index]));
  publications.sort(
    (a, b) =>
      (versionOrder.get(place(a).versionId) ?? 0) - (versionOrder.get(place(b).versionId) ?? 0) ||
      place(a).position - place(b).position ||
      a.revision - b.revision
  );

  // The texts, while there's time: history/<the note's path, without .md>/revision <n>.md.
  const files = new Map<string, string>();
  let notWritten = 0;
  const vaultPrefix = `${scope.vaultFolder}/`;
  for (const part of chunks(publications.map((row) => row.id), PAGE)) {
    if (!context.hasTime()) {
      notWritten += part.length;
      continue;
    }
    const texts = await prisma.lessonPublication.findMany({
      where: { id: { in: part }, lesson: { course: { organizationId } } },
      select: { id: true, lessonId: true, revision: true, title: true, publishedAt: true, publisherName: true, markdownContent: true },
    });
    for (const text of texts) {
      const lesson = lessons.get(text.lessonId);
      if (!lesson) continue;
      const notePath = lesson.notePath.startsWith(vaultPrefix) ? lesson.notePath.slice(vaultPrefix.length) : lesson.notePath;
      const properties = [
        `title: ${yamlScalar(text.title)}`,
        `revision: ${text.revision}`,
        `published: ${yamlScalar(context.time(text.publishedAt) ?? '')}`,
        ...(text.publisherName ? [`publishedBy: ${yamlScalar(text.publisherName)}`] : []),
      ];
      const path = await context.files.text(
        `history/${notePath.replace(/\.md$/, '')}/revision ${text.revision}.md`,
        `---\n${properties.join('\n')}\n---\n\n${text.markdownContent.trim()}\n`
      );
      files.set(text.id, path);
    }
  }

  const rows: CsvCell[][] = publications.map((row) => {
    const lesson = place(row);
    const version = versionById.get(lesson.versionId);
    return [
      version?.courseTitle ?? null,
      versionName(version, feedbackWords),
      `${lesson.position}. ${lesson.title}`,
      row.revision,
      row.title,
      context.time(row.publishedAt),
      row.publisherName,
      row.addedBlocks,
      row.removedBlocks,
      files.get(row.id) ?? null,
    ];
  });
  const columns = ['course', 'lessons', 'lesson', 'revision', 'title', 'published', 'publishedBy', 'added', 'removed', 'file'] as const;
  await context.files.csv('history/publications.csv', columns.map((column) => t(`columns.publications.${column}`)), rows);
  context.describe('history/publications.csv', t('describe.publications'));
  if (files.size) context.describe('history/<folder>/<lesson>/revision <n>.md', t('describe.texts'));
  if (notWritten) context.leftOut(t('leftOut.textsTime', { count: notWritten }));
}

// ── Feedback ────────────────────────────────────────────────────────────────────────────────────

/**
 * Feedback and instructor notes: what the Feedback tabs list, in the Feedback tab's CSV columns
 * (src/lib/feedback-csv.ts), course by course, open first and newest first. Learners stay unnamed.
 */
export async function writeFeedback(context: ExportContext, t: ExportWords, feedbackWords: FeedbackWords) {
  const { scope } = context;
  const scoped = commentScopeWhere(accessScope(scope.viewer, 'comments'));
  const courseIds = Array.from(scope.courseTitles.entries())
    .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
    .map(([id]) => id);
  async function* rows(): AsyncGenerator<CsvCell[]> {
    for (const courseId of courseIds) {
      const where: Prisma.CurriculumCommentWhereInput = {
        AND: [scoped, courseFeedbackWhere(courseId), { curriculumVersion: { course: { organizationId: scope.organization.id } } }],
      };
      for (const state of ['open', 'done'] as FeedbackState[]) {
        let after: string | undefined;
        for (;;) {
          const page = await listFeedback(where, state, { take: PAGE, after });
          for (const row of page) yield feedbackCsvRow(row, feedbackWords);
          if (page.length < PAGE) break;
          after = page[page.length - 1].id;
        }
      }
    }
  }
  await context.files.csv('feedback.csv', feedbackCsvHeader(feedbackWords), rows());
  context.describe('feedback.csv', t('describe.feedback'));
}

// ── Tasks ───────────────────────────────────────────────────────────────────────────────────────

export async function writeTasks(context: ExportContext, t: ExportWords, feedbackWords: FeedbackWords) {
  const { scope } = context;
  const organizationId = scope.organization.id;
  const tasks = await listTasks({ where: { AND: [taskScopeWhere(accessScope(scope.viewer, 'tasks')), { organizationId }] } });
  const versionById = new Map(scope.versions.map((version) => [version.id, version]));

  const details = new Map<string, { description: string | null; plan: string | null }>();
  for (const part of chunks(tasks.map((task) => task.id))) {
    const rows = await prisma.task.findMany({ where: { id: { in: part }, organizationId }, select: { id: true, description: true, plan: true } });
    rows.forEach((row) => details.set(row.id, row));
  }

  const rows: CsvCell[][] = tasks.map((task) => {
    const version = task.refs.version ? versionById.get(task.refs.version.id) : undefined;
    const lessons = version
      ? versionName(version, feedbackWords)
      : task.refs.version
        ? task.refs.version.group
          ? feedbackWords('groupCopy', { group: task.refs.version.group.name, version: task.refs.version.label })
          : feedbackWords('ownLessons', { version: task.refs.version.label })
        : null;
    return [
      task.title,
      feedbackWords(`taskStatus.${task.status}`),
      task.refs.course?.title ?? (task.courseId ? (scope.courseTitles.get(task.courseId) ?? null) : null),
      lessons,
      task.refs.lesson ? `${task.refs.lesson.position}. ${task.refs.lesson.title}` : null,
      task.proposerName,
      task.assignee?.name ?? null,
      context.time(task.createdAt),
      context.time(task.completedAt),
      yesNo(t, task.aiReady),
      details.get(task.id)?.description ?? null,
      details.get(task.id)?.plan ?? null,
    ];
  });
  const columns = ['task', 'status', 'course', 'lessons', 'lesson', 'from', 'assignee', 'created', 'done', 'aiReady', 'description', 'plan'] as const;
  await context.files.csv('tasks.csv', columns.map((column) => t(`columns.tasks.${column}`)), rows);
  context.describe('tasks.csv', t('describe.tasks'));

  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  async function* notes(): AsyncGenerator<CsvCell[]> {
    for (const part of chunks(tasks.map((task) => task.id))) {
      const comments = await prisma.taskComment.findMany({
        where: { taskId: { in: part }, task: { organizationId } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { taskId: true, authorName: true, body: true, createdAt: true },
      });
      for (const comment of comments) yield [titles.get(comment.taskId) ?? null, context.time(comment.createdAt), comment.authorName, comment.body];
    }
  }
  const noteColumns = ['task', 'date', 'author', 'note'] as const;
  await context.files.csv('task-notes.csv', noteColumns.map((column) => t(`columns.taskNotes.${column}`)), notes());
  context.describe('task-notes.csv', t('describe.taskNotes'));
}

// ── The team (owners and admins) ────────────────────────────────────────────────────────────────

export async function writeTeam(context: ExportContext, t: ExportWords, roles: Record<OrgRole, { label: string }>) {
  const { scope } = context;
  if (!scope.admin) return;
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: scope.organization.id },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      access: true,
      createdAt: true,
      user: { select: { firstName: true, lastName: true, identifier: true, email: true } },
    },
  });
  const rows: CsvCell[][] = members.map((member) => [
    userDisplayName(member.user),
    member.user.email,
    roles[member.role]?.label ?? member.role,
    member.role === 'MEMBER' && member.access === MemberAccess.LIMITED ? t('values.limitedAccess') : t('values.fullAccess'),
    context.day(member.createdAt),
  ]);
  const columns = ['name', 'email', 'role', 'access', 'joined'] as const;
  await context.files.csv('team.csv', columns.map((column) => t(`columns.team.${column}`)), rows);
  context.describe('team.csv', t('describe.team'));
}
