'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { Permission } from '@prisma/client';
import { canOnCourse, loadGroupRef, requireCrmAccess } from '@/lib/crm-access';
import {
  disableGroupCurriculum,
  enableGroupCurriculum,
  setGroupCurriculumClosed,
  type GroupCurriculumResult,
} from '@/lib/group-curricula';

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function revalidateGroup(groupId: string) {
  revalidatePath('/admin/courses/groups');
  revalidatePath(`/admin/courses/groups/${groupId}`);
}

/** What happened, said in the viewer's language. */
async function runForGroup(
  formData: FormData,
  run: (groupId: string) => Promise<GroupCurriculumResult>
): Promise<{ ok: boolean; message: string }> {
  const groupId = getFormValue(formData, 'groupId');
  // A group's own curriculum is course work: edit rights on the group's course.
  const group = await loadGroupRef(groupId);
  await requireCrmAccess((viewer) => Boolean(group && canOnCourse(viewer, group.courseId, [Permission.WRITE])));
  const result = await run(groupId);
  revalidateGroup(groupId);
  const t = await getTranslations('groups.curriculum');
  return { ok: result.ok, message: t(result.code) };
}

export async function enableGroupCurriculumAction(formData: FormData) {
  return runForGroup(formData, enableGroupCurriculum);
}

export async function disableGroupCurriculumAction(formData: FormData) {
  return runForGroup(formData, disableGroupCurriculum);
}

export async function closeGroupCurriculumAction(formData: FormData) {
  return runForGroup(formData, (groupId) => setGroupCurriculumClosed(groupId, true));
}

export async function reopenGroupCurriculumAction(formData: FormData) {
  return runForGroup(formData, (groupId) => setGroupCurriculumClosed(groupId, false));
}

