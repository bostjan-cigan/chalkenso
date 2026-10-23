import 'server-only';

import { LessonStatus, type Prisma } from '@prisma/client';
import { getAdminAssetUrl } from '@/lib/asset-urls';
import { prisma } from '@/lib/prisma';
import { UploadedLessonAsset } from './types';

export function getPendingReferencesCount(course: {
  lessons: Array<{
    assetReferences: Array<{
      assetId: string | null;
    }>;
  }>;
}) {
  return course.lessons.reduce((total, lesson) => {
    return total + lesson.assetReferences.filter((reference) => !reference.assetId).length;
  }, 0);
}

export async function getCourseSummaryStats() {
  const courses = await prisma.course.findMany({
    select: {
      id: true,
      lessons: {
        select: {
          assetReferences: {
            select: {
              assetId: true,
            },
          },
        },
      },
    },
  });

  return {
    courseCount: courses.length,
    lessonCount: courses.reduce((total, course) => total + course.lessons.length, 0),
    pendingImageCount: courses.reduce(
      (total, course) => total + getPendingReferencesCount(course),
      0
    ),
  };
}

/** Full row for flows that need lesson + asset reference data (e.g. stats). */
export async function listCoursesForIndex() {
  return prisma.course.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      lessons: {
        orderBy: {
          position: 'asc',
        },
        select: {
          assetReferences: {
            select: {
              assetId: true,
            },
          },
          id: true,
          position: true,
          slug: true,
          title: true,
        },
      },
      partners: {
        orderBy: {
          position: 'asc',
        },
        select: {
          partner: {
            select: {
              id: true,
              name: true,
            },
          },
          partnerId: true,
          position: true,
        },
      },
      slug: true,
      summary: true,
      title: true,
      updatedAt: true,
    },
  });
}

type LessonIndexStats = {
  draftLessonCount: number;
  lessonCount: number;
  lessonsUpdatedAt: Date | null;
  publishedLessonCount: number;
};

/** Lesson counts + last updated for course list rows (shared by courses index + partner detail). */
async function fetchLessonIndexStatsForCourseIds(
  courseIds: string[]
): Promise<Map<string, LessonIndexStats>> {
  if (courseIds.length === 0) {
    return new Map();
  }

  const [lessonStatusCounts, lessonUpdatedAt] = await Promise.all([
    prisma.lesson.groupBy({
      by: ['courseId', 'status'],
      where: {
        courseId: {
          in: courseIds,
        },
        curriculumVersion: { ownerGroupId: null },
      },
      _count: {
        _all: true,
      },
    }),
    prisma.lesson.groupBy({
      by: ['courseId'],
      where: {
        courseId: {
          in: courseIds,
        },
        curriculumVersion: { ownerGroupId: null },
      },
      _max: {
        updatedAt: true,
      },
    }),
  ]);

  const statsByCourseId = new Map<
    string,
    {
      draftCount: number;
      publishedCount: number;
    }
  >();

  for (const statusCount of lessonStatusCounts) {
    const current = statsByCourseId.get(statusCount.courseId) ?? {
      draftCount: 0,
      publishedCount: 0,
    };
    const nextCount = statusCount._count._all;

    if (statusCount.status === LessonStatus.PUBLISHED) {
      current.publishedCount = nextCount;
    } else {
      current.draftCount = nextCount;
    }

    statsByCourseId.set(statusCount.courseId, current);
  }

  const lessonUpdatedAtByCourseId = new Map(
    lessonUpdatedAt.map((courseStats) => [courseStats.courseId, courseStats._max.updatedAt ?? null])
  );

  const result = new Map<string, LessonIndexStats>();
  for (const id of courseIds) {
    const stats = statsByCourseId.get(id) ?? { draftCount: 0, publishedCount: 0 };
    const lessonCount = stats.draftCount + stats.publishedCount;
    result.set(id, {
      draftLessonCount: stats.draftCount,
      lessonCount,
      lessonsUpdatedAt: lessonUpdatedAtByCourseId.get(id) ?? null,
      publishedLessonCount: stats.publishedCount,
    });
  }
  return result;
}

/**
 * Index list only — avoids loading every lesson and asset reference. `where` limits it to the
 * courses the viewer reaches (`courseScopeWhere`).
 */
export async function listCoursesForIndexLite(where: Prisma.CourseWhereInput = {}) {
  const courses = await prisma.course.findMany({
    where,
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      partners: {
        orderBy: {
          position: 'asc',
        },
        select: {
          partner: {
            select: {
              id: true,
              name: true,
            },
          },
          partnerId: true,
          position: true,
        },
      },
      slug: true,
      title: true,
      updatedAt: true,
    },
  });

  const courseIds = courses.map((course) => course.id);
  const [statsMap, forks] = await Promise.all([
    fetchLessonIndexStatsForCourseIds(courseIds),
    // Group curricula (forks of a core version); closed ones have `archivedAt`.
    prisma.curriculumVersion.findMany({
      where: { courseId: { in: courseIds }, ownerGroupId: { not: null } },
      select: { courseId: true, archivedAt: true, ownerGroup: { select: { endsAt: true } } },
    }),
  ]);

  return courses.map((course) => {
    const stats = statsMap.get(course.id) ?? {
      draftLessonCount: 0,
      lessonCount: 0,
      lessonsUpdatedAt: null,
      publishedLessonCount: 0,
    };
    const courseForks = forks.filter((fork) => fork.courseId === course.id);
    return {
      ...course,
      ...stats,
      // Wrapped-up forks (closed, or past the group's end date) aren't counted; the course page hides them too.
      activeForkCount: courseForks.filter(
        (fork) => !fork.archivedAt && !(fork.ownerGroup?.endsAt && fork.ownerGroup.endsAt < new Date())
      ).length,
    };
  });
}

/** Minimal course header for the version picker page (no lessons loaded). */
export async function getCourseHeader(courseId: string) {
  return prisma.course.findUnique({
    where: {
      id: courseId,
    },
    select: {
      id: true,
      summary: true,
      title: true,
    },
  });
}

/** A course's settings and partners, for its settings page (no lessons: the page doesn't show them). */
export async function getCourseDetail(courseId: string) {
  return prisma.course.findUnique({
    where: {
      id: courseId,
    },
    select: {
      id: true,
      partners: {
        orderBy: {
          position: 'asc',
        },
        select: {
          partner: {
            select: {
              id: true,
              logoUrl: true,
              name: true,
              websiteUrl: true,
            },
          },
          partnerId: true,
          position: true,
        },
      },
      slug: true,
      summary: true,
      title: true,
      githubUrl: true,
      publicListed: true,
      freeLessonCount: true,
      allLessonsFree: true,
      enrolUrl: true,
      pinned: true,
      coverAssetId: true,
      coverAsset: { select: { altText: true } },
      outcome: true,
      tags: true,
      joinTarget: true,
      joinPartnerId: true,
      language: true,
      updatedAt: true,
    },
  });
}

export async function listPartnersForCourseForm() {
  return prisma.partner.findMany({
    orderBy: {
      name: 'asc',
    },
    select: {
      id: true,
      name: true,
      websiteUrl: true,
    },
  });
}

export async function getLessonDetail(courseId: string, lessonId: string) {
  return prisma.lesson.findFirst({
    where: {
      courseId,
      id: lessonId,
    },
    select: {
      assetReferences: {
        orderBy: {
          position: 'asc',
        },
        select: {
          asset: {
            select: {
              bytes: true,
              id: true,
              mimeType: true,
              originalFilename: true,
              r2Key: true,
            },
          },
          assetId: true,
          sourcePath: true,
        },
      },
      arcId: true,
      course: {
        select: {
          id: true,
          title: true,
        },
      },
      curriculumVersionId: true,
      id: true,
      markdownContent: true,
      position: true,
      shortDescription: true,
      status: true,
      slug: true,
      title: true,
      revision: true,
      publishedAt: true,
      publishedRevision: true,
    },
  });
}

export async function listPartnersForIndex() {
  return prisma.partner.findMany({
    orderBy: {
      name: 'asc',
    },
    select: {
      _count: {
        select: {
          coursePartners: true,
          groupPartners: true,
        },
      },
      id: true,
      logoUrl: true,
      name: true,
      websiteUrl: true,
    },
  });
}

export async function getPartnerDetail(partnerId: string) {
  return prisma.partner.findUnique({
    where: {
      id: partnerId,
    },
    select: {
      coursePartners: {
        orderBy: { course: { title: 'asc' } },
        select: { course: { select: { id: true, title: true } } },
      },
      description: true,
      groupPartners: {
        orderBy: { group: { name: 'asc' } },
        select: { group: { select: { id: true, name: true, course: { select: { title: true } } } } },
      },
      id: true,
      joinFor: {
        orderBy: { title: 'asc' },
        select: { id: true, title: true },
      },
      logoUrl: true,
      name: true,
      websiteUrl: true,
    },
  });
}

export function mapUploadedAssets(
  assetReferences: Array<{
    asset: {
      bytes: number | null;
      id: string;
      mimeType: string | null;
      originalFilename: string;
      r2Key: string;
    } | null;
    assetId: string | null;
    sourcePath: string;
  }>
) {
  return assetReferences.reduce<Record<string, UploadedLessonAsset>>(
    (uploadedAssets, reference) => {
      if (!reference.asset || !reference.assetId) {
        return uploadedAssets;
      }

      uploadedAssets[reference.sourcePath] = {
        assetId: reference.asset.id,
        bytes: reference.asset.bytes,
        mimeType: reference.asset.mimeType,
        originalFilename: reference.asset.originalFilename,
        publicUrl: getAdminAssetUrl(reference.asset.id),
        r2Key: reference.asset.r2Key,
        sourcePath: reference.sourcePath,
      };

      return uploadedAssets;
    },
    {}
  );
}
