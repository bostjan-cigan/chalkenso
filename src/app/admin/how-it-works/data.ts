import 'server-only';

import type { UserRole } from '@prisma/client';
import { serverExtensions } from '@/extensions/server';
import { accessScope, commentScopeWhere } from '@/lib/crm-access';
import { countOpenFeedbackByLesson } from '@/lib/feedback-list';
import type { Grant } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { personalKey } from '@/lib/remembered';

/**
 * "How Chalkenso works": the loop, where AI helps on the organisation's plan, and for owners and
 * admins how to run it. Getting started offers it to people new to this organisation (they joined in
 * the last `NEW_FOR_DAYS`) until they mark it done; the page `/admin/how-it-works` has it any time.
 */

export const NEW_FOR_DAYS = 30;

/** The person's "done" mark, kept like Getting started's Hide (one per person and organisation). */
export const howItWorksKey = (userId: string) => personalKey('how-it-works', userId);

export type HowItWorksViewer = { id: string; role: UserRole; grants: Grant[]; organization: { id: string } };

export type HowItWorksAction = { kind: 'connect' | 'lesson'; href: string };

/**
 * The sheet's one action: connect your own Claude where that's how AI works and it isn't connected
 * yet (the edition says); otherwise the lesson with the most open feedback the person can see, in
 * its Improve mode (no feedback yet: the courses).
 */
export async function howItWorksAction(viewer: HowItWorksViewer): Promise<HowItWorksAction> {
  if ((await serverExtensions.howItWorksAction(viewer.organization.id, viewer.id)) === 'connect') {
    return { kind: 'connect', href: '/admin/settings/claude' };
  }
  const scope = accessScope({ id: viewer.id, role: viewer.role, grants: viewer.grants, organizationId: viewer.organization.id }, 'comments');
  const counts = await countOpenFeedbackByLesson(commentScopeWhere(scope));
  const [lessonId] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0] ?? [];
  const lesson = lessonId ? await prisma.lesson.findUnique({ where: { id: lessonId }, select: { id: true, courseId: true } }) : null;
  return { kind: 'lesson', href: lesson ? `/admin/courses/${lesson.courseId}/lessons/${lesson.id}/improvements` : '/admin/courses' };
}
