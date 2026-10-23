import 'server-only';

import { displayName, isOrgAdmin, type SessionOrganization, type SessionUser } from '@/lib/admin-auth';
import {
  accessScope,
  canPreviewVersion,
  courseScopeWhere,
  groupScopeWhere,
  hasAnyAccess,
  isUnrestricted,
  type CrmViewer,
} from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { CURRICULUMS_FOLDER, GROUPS_FOLDER, sanitizeFolderName, workspaceFolderName } from '@/lib/vault-layout';
import type { ExportScope, ExportVersion } from './types';

/**
 * Who may export what. Owners and admins export the whole organisation (its team too). Members
 * export what they can open, by the same checks the app uses (src/lib/crm-access.ts): whole courses
 * with READ on them, the versions they can read (`canPreviewVersion`: an instructor's group copy and
 * the version their group reads), the groups they can open, and the feedback and tasks they can see.
 * A guest instructor (notes only) reads nothing on its own, so their export is nearly empty. Only the
 * organisation the session works in counts: every query below names it, on top of the database's own
 * organisation scope.
 */

export type ExportViewer = SessionUser & { organization: SessionOrganization };

export function crmViewerOf(user: ExportViewer): CrmViewer {
  return { id: user.id, role: user.role, grants: user.grants, organizationId: user.organization.id };
}

/** Whether someone can export anything at all here. */
export function canExport(user: ExportViewer) {
  return isOrgAdmin(user) || hasAnyAccess(crmViewerOf(user));
}

/** What the export holds for this person, loaded before the download starts. */
export async function loadExportScope(user: ExportViewer): Promise<ExportScope> {
  const viewer = crmViewerOf(user);
  const organizationId = user.organization.id;
  const inOrganization = { course: { organizationId } };

  const [courses, versions, groups] = await Promise.all([
    prisma.course.findMany({
      where: { AND: [{ organizationId }, courseScopeWhere(accessScope(viewer, 'courses'))] },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true, slug: true },
    }),
    // Every version is read (a few small columns each), then kept only where the person can read it.
    prisma.curriculumVersion.findMany({
      where: inOrganization,
      orderBy: [{ course: { title: 'asc' } }, { courseId: 'asc' }, { version: 'desc' }],
      select: {
        id: true,
        courseId: true,
        label: true,
        version: true,
        status: true,
        createdAt: true,
        publishedAt: true,
        publisherName: true,
        archivedAt: true,
        ownerGroupId: true,
        ownerGroup: { select: { id: true, name: true } },
        baseVersion: { select: { id: true, label: true } },
        course: { select: { title: true, slug: true } },
      },
    }),
    prisma.courseGroup.findMany({
      where: { AND: [inOrganization, groupScopeWhere(accessScope(viewer, 'groups'))] },
      orderBy: [{ course: { title: 'asc' } }, { courseId: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        courseId: true,
        name: true,
        slug: true,
        description: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        feedbackDriven: true,
        curriculumVersionId: true,
        groupCurriculum: { select: { id: true } },
        course: { select: { title: true } },
      },
    }),
  ]);

  const vaultFolder = sanitizeFolderName(user.organization.name, 'Organisation');
  const takenFolders = new Set<string>();
  const folderFor = (parent: string, name: string) => {
    let folder = `${vaultFolder}/${parent}/${name}`;
    for (let n = 2; takenFolders.has(folder.toLowerCase()); n += 1) {
      folder = `${vaultFolder}/${parent}/${name} (${n})`;
    }
    takenFolders.add(folder.toLowerCase());
    return folder;
  };

  const readable = versions.filter((version) => canPreviewVersion(viewer, version));
  // Core versions first, then the groups' copies, as the plugin lists them.
  const ordered = [...readable.filter((version) => !version.ownerGroupId), ...readable.filter((version) => version.ownerGroupId)];
  const exportVersions: ExportVersion[] = ordered.map((version) => {
    const group = version.ownerGroup ? { id: version.ownerGroup.id, name: version.ownerGroup.name } : null;
    const workspace = {
      label: version.label,
      course: { id: version.courseId, title: version.course.title, slug: version.course.slug },
      group,
      baseVersion: version.baseVersion,
    };
    return {
      id: version.id,
      courseId: version.courseId,
      courseTitle: version.course.title,
      courseSlug: version.course.slug,
      label: version.label,
      version: version.version,
      status: version.status,
      createdAt: version.createdAt,
      publishedAt: version.publishedAt,
      publisherName: version.publisherName,
      group,
      baseVersion: version.baseVersion,
      archivedAt: version.archivedAt,
      folder: folderFor(group ? GROUPS_FOLDER : CURRICULUMS_FOLDER, workspaceFolderName(workspace)),
    };
  });

  const courseTitles = new Map<string, string>();
  courses.forEach((course) => courseTitles.set(course.id, course.title));
  exportVersions.forEach((version) => courseTitles.set(version.courseId, version.courseTitle));
  groups.forEach((group) => courseTitles.set(group.courseId, group.course.title));

  return {
    organization: { id: organizationId, name: user.organization.name, slug: user.organization.slug },
    person: { id: user.id, name: displayName(user) },
    viewer,
    admin: isOrgAdmin(user),
    everything: isUnrestricted(viewer),
    courses,
    versions: exportVersions,
    groups: groups.map((group) => ({
      id: group.id,
      courseId: group.courseId,
      name: group.name,
      slug: group.slug,
      description: group.description,
      startsAt: group.startsAt,
      endsAt: group.endsAt,
      createdAt: group.createdAt,
      feedbackDriven: group.feedbackDriven,
      versionId: group.groupCurriculum?.id ?? group.curriculumVersionId,
    })),
    courseTitles,
    vaultFolder,
  };
}
