import 'server-only';

import { prisma } from '@/lib/prisma';

export type CourseArcSummary = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  lessonCount: number;
};

/** Arcs of a version, in display order, with their assigned lesson counts. */
export async function listArcsForVersion(
  curriculumVersionId: string
): Promise<CourseArcSummary[]> {
  const arcs = await prisma.lessonArc.findMany({
    where: {
      curriculumVersionId,
    },
    orderBy: {
      position: 'asc',
    },
    select: {
      id: true,
      title: true,
      description: true,
      position: true,
      _count: {
        select: {
          lessons: true,
        },
      },
    },
  });

  return arcs.map((arc) => ({
    id: arc.id,
    title: arc.title,
    description: arc.description,
    position: arc.position,
    lessonCount: arc._count.lessons,
  }));
}
