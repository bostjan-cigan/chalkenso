import 'server-only';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Courses and groups whose cohort window includes "now" (started, or no start, and not ended), of
 * the ones the viewer reaches (`courseScopeWhere` / `groupScopeWhere`).
 */
export async function getAdminDashboardStats(scope: { courses?: Prisma.CourseWhereInput; groups?: Prisma.CourseGroupWhereInput } = {}) {
  const now = new Date();

  const [courseCount, activeGroupCount] = await Promise.all([
    prisma.course.count({ where: scope.courses ?? {} }),
    prisma.courseGroup.count({
      where: {
        AND: [
          scope.groups ?? {},
          {
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
          {
            OR: [{ startsAt: null }, { startsAt: { lte: now } }],
          },
        ],
      },
    }),
  ]);

  return {
    activeGroupCount,
    courseCount,
  };
}
