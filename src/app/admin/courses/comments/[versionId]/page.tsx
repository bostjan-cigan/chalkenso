import { notFound, redirect } from 'next/navigation';
import { Permission } from '@prisma/client';
import {
  accessScope,
  canOnCourse,
  canSeeVersionFeedback,
  groupScopeWhere,
  loadVersionRef,
  requireCrmAccess,
} from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';

type PageParams = Promise<{ versionId: string }>;
type SearchParams = Promise<{ show?: string; lesson?: string }>;

/**
 * The old feedback inbox of one version: a group's copy's feedback is on the group's Feedback tab;
 * the course's own lessons' on the course's Feedback tab, or (for an instructor of a group that
 * reads them) on their group's.
 */
export default async function CurriculumCommentsPage({ params, searchParams }: { params: PageParams; searchParams: SearchParams }) {
  const [{ versionId }, search] = await Promise.all([params, searchParams]);
  const version = await loadVersionRef(versionId);
  const viewer = await requireCrmAccess(async (candidate) => Boolean(version && (await canSeeVersionFeedback(candidate, version))));
  if (!version) {
    notFound();
  }
  const query = new URLSearchParams();
  if (search.show) query.set('show', search.show);
  if (search.lesson) query.set('lesson', search.lesson);
  const toGroup = (groupId: string) => {
    query.set('tab', 'feedback');
    redirect(`/admin/courses/groups/${groupId}?${query.toString()}`);
  };
  if (version.ownerGroupId) {
    toGroup(version.ownerGroupId);
  }
  if (canOnCourse(viewer, version.courseId, [Permission.READ])) {
    redirect(`/admin/courses/${version.courseId}/feedback${query.size ? `?${query.toString()}` : ''}`);
  }
  const group = await prisma.courseGroup.findFirst({
    where: { AND: [{ curriculumVersionId: version.id }, groupScopeWhere(accessScope(viewer, 'groups'))] },
    orderBy: { name: 'asc' },
    select: { id: true },
  });
  if (group) {
    toGroup(group.id);
  }
  redirect('/admin');
}
