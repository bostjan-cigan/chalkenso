import { NextResponse } from 'next/server';
import { validateCourseAccessToken } from '@/lib/course-access';
import { withOrgScope } from '@/lib/org-context';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/**
 * The person on a personal link saw what happened to their feedback (FeedbackOutcomes): from now
 * on, only what happens later is said on their next visit. A learner's link marks the learner, an
 * instructor's link the instructor; a preview or group link marks nothing.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!token) return NextResponse.json({ ok: false }, { status: 400 });
  const access = await validateCourseAccessToken(token);
  if (access.state !== 'valid' || access.isPreview) return NextResponse.json({ ok: false }, { status: 404 });
  await withOrgScope(access.organizationId, async () => {
    if (access.instructor) await prisma.user.update({ where: { id: access.instructor.userId }, data: { notesSeenAt: new Date() } });
    else if (access.memberId) await prisma.courseGroupMember.update({ where: { id: access.memberId }, data: { outcomesSeenAt: new Date() } });
  });
  return NextResponse.json({ ok: true });
}
