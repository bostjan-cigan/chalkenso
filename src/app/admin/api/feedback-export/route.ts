import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import type { Prisma } from '@prisma/client';
import { accessScope, canReadFeedback, commentScopeWhere, getCrmViewer } from '@/lib/crm-access';
import { toCsv } from '@/lib/csv';
import { csvDay, feedbackCsvHeader, feedbackCsvRow } from '@/lib/feedback-csv';
import { courseFeedbackWhere, groupFeedbackWhere, listFeedback } from '@/lib/feedback-list';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `?group=course` on a course: its own lessons only (as on the course's Feedback tab). */
const OWN = 'course';

const slug = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 60) || 'feedback';

/**
 * A group's or a course's feedback as a CSV file, open and done, newest first: what the Feedback tab
 * lists, limited to what the viewer may read. Learners stay unnamed ("A learner · <group>"), as in
 * the app. Headings and labels are in the request's language (`courses.feedbackExport`); the columns
 * are shared with "Export everything" (src/lib/feedback-csv.ts).
 *
 * - `?group=<id>`: the group's feedback (its learners', notes for it, anything on its own copy);
 * - `?course=<id>`: the course's, every group's included; with `&group=<id>` one of its groups, with
 *   `&group=course` the course's own lessons.
 */
export async function GET(request: Request) {
  const viewer = await getCrmViewer();
  if (!viewer) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const courseId = params.get('course')?.trim() || null;
  const groupId = params.get('group')?.trim() || null;

  let where: Prisma.CurriculumCommentWhereInput;
  let name: string;
  if (courseId) {
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true } });
    if (!course || !canReadFeedback(viewer, { courseId, groupIds: [] })) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
    where =
      groupId === OWN
        ? { groupId: null, curriculumVersion: { courseId, ownerGroupId: null } }
        : groupId
          ? { AND: [courseFeedbackWhere(courseId), groupFeedbackWhere(groupId)] }
          : courseFeedbackWhere(courseId);
    name = course.title;
  } else if (groupId) {
    const group = await prisma.courseGroup.findUnique({ where: { id: groupId }, select: { id: true, courseId: true, name: true } });
    if (!group || !canReadFeedback(viewer, { courseId: group.courseId, groupIds: [group.id] })) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
    where = groupFeedbackWhere(group.id);
    name = group.name;
  } else {
    return NextResponse.json({ error: 'Choose a course or a group.' }, { status: 400 });
  }

  const scoped: Prisma.CurriculumCommentWhereInput = { AND: [commentScopeWhere(accessScope(viewer, 'comments')), where] };
  const [open, done, t] = await Promise.all([
    listFeedback(scoped, 'open'),
    listFeedback(scoped, 'done'),
    getTranslations('courses.feedbackExport'),
  ]);
  const rows = [...open, ...done].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const csv = toCsv([feedbackCsvHeader(t), ...rows.map((row) => feedbackCsvRow(row, t))]);
  const filename = `feedback-${slug(name)}-${csvDay.format(new Date())}.csv`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
