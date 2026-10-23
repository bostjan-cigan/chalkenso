'use server';

import { Permission } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { canOnGroup, getCrmViewer, loadGroupRef } from '@/lib/crm-access';
import { moveCommentToLearner, moveUnattachedFeedback } from '@/lib/unattached-feedback';

export type MoveFeedbackResult = { ok: true; moved: number } | { ok: false; message: string };

/**
 * Like making learner links, moving feedback to a learner is the group's roster work: READ on the
 * group (its instructors). The group, when the viewer may.
 */
async function rosterGroup(groupId: unknown) {
  const viewer = await getCrmViewer();
  const group = viewer && typeof groupId === 'string' && groupId ? await loadGroupRef(groupId) : null;
  return viewer && group && canOnGroup(viewer, group, [Permission.READ]) ? group : null;
}

/**
 * Moves feedback whose learner is no longer on the group's roster (from the old links chosen) to a
 * learner on it, so it shows on their link. Checks access itself.
 */
export async function moveFeedbackToLearnerAction(input: { groupId: string; memberId: string; sources: string[] }): Promise<MoveFeedbackResult> {
  const [group, t] = await Promise.all([rosterGroup(input?.groupId), getTranslations('groups.feedbackTransfer')]);
  if (!group) {
    return { ok: false, message: t('noAccess') };
  }
  const sources = Array.isArray(input.sources) ? input.sources.map(String).slice(0, 200) : [];
  if (!sources.length || typeof input.memberId !== 'string' || !input.memberId) {
    return { ok: false, message: t('chooseBoth') };
  }
  const moved = await moveUnattachedFeedback(group.id, input.memberId, sources);
  if (moved === null) {
    return { ok: false, message: t('notOnRoster') };
  }
  revalidatePath(`/admin/courses/groups/${group.id}`);
  return { ok: true, moved };
}

/**
 * One piece of the group's learner feedback put on a learner on its roster and their current link
 * (the Feedback tab's "Link to a learner…": its learner left the roster, or it came through an old
 * link). Checks access itself.
 */
export async function linkFeedbackToLearnerAction(input: { groupId: string; commentId: string; memberId: string }): Promise<MoveFeedbackResult> {
  const [group, t] = await Promise.all([rosterGroup(input?.groupId), getTranslations('groups.feedbackTransfer')]);
  if (!group) {
    return { ok: false, message: t('noAccess') };
  }
  if (typeof input.commentId !== 'string' || !input.commentId || typeof input.memberId !== 'string' || !input.memberId) {
    return { ok: false, message: t('chooseLearner') };
  }
  const moved = await moveCommentToLearner(group.id, input.commentId, input.memberId);
  if (moved === null) {
    return { ok: false, message: t('notOnRoster') };
  }
  if (!moved) {
    return { ok: false, message: t('notThisGroup') };
  }
  revalidatePath(`/admin/courses/groups/${group.id}`);
  return { ok: true, moved: 1 };
}
