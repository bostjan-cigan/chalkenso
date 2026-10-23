import 'server-only';

import { prisma } from './prisma';

/**
 * Feedback a group's learners left whose learner is no longer on its roster: removed (their comments
 * stay, for the group's instructors) or added again as a new entry. Their link no longer shows it to
 * anyone; moving it to a learner on the roster puts it on that learner's link.
 */

/** Feedback from one old link (`key` is its id, or `none` when the link is gone too). */
export type UnattachedFeedbackSource = {
  key: string;
  /** When the old link was made, when it still exists. */
  linkMadeAt: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
  /** Lesson positions it is on, in order. */
  lessons: number[];
  /** The start of the first comment, to recognise whose it was. */
  sample: string;
};

const NONE = 'none';

/** Learner feedback (not instructor notes) on the group with no learner: by the link it came from, oldest first. */
const unattachedWhere = (groupId: string) => ({ groupId, isInstructorNote: false, memberId: null });

export async function listUnattachedFeedback(groupId: string): Promise<UnattachedFeedbackSource[]> {
  const comments = await prisma.curriculumComment.findMany({
    where: unattachedWhere(groupId),
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: {
      accessLinkId: true,
      body: true,
      createdAt: true,
      lesson: { select: { position: true } },
      accessLink: { select: { createdAt: true } },
    },
  });
  const sources = new Map<string, UnattachedFeedbackSource>();
  for (const comment of comments) {
    const key = comment.accessLinkId ?? NONE;
    const source = sources.get(key) ?? {
      key,
      linkMadeAt: comment.accessLink?.createdAt.toISOString() ?? null,
      count: 0,
      firstAt: comment.createdAt.toISOString(),
      lastAt: comment.createdAt.toISOString(),
      lessons: [],
      sample: comment.body.length > 90 ? `${comment.body.slice(0, 90).trimEnd()}…` : comment.body,
    };
    source.count += 1;
    source.lastAt = comment.createdAt.toISOString();
    if (!source.lessons.includes(comment.lesson.position)) source.lessons.push(comment.lesson.position);
    sources.set(key, source);
  }
  return Array.from(sources.values()).map((source) => ({ ...source, lessons: source.lessons.sort((a, b) => a - b) }));
}

/**
 * Moves the unattached feedback from these old links (`none`: whose link is gone too) to a learner on
 * the group's roster, onto their current link (none yet: it moves to them, and onto the link made for
 * them later). Only feedback still without a learner moves. Returns how many moved, or null when the
 * learner isn't on this group's roster.
 */
export async function moveUnattachedFeedback(groupId: string, memberId: string, sourceKeys: string[]): Promise<number | null> {
  const linkId = await rosterLinkId(groupId, memberId);
  if (linkId === undefined) {
    return null;
  }
  const linkIds = sourceKeys.filter((key) => key !== NONE);
  const fromSources = [...(linkIds.length ? [{ accessLinkId: { in: linkIds } }] : []), ...(sourceKeys.includes(NONE) ? [{ accessLinkId: null }] : [])];
  if (!fromSources.length) {
    return 0;
  }
  const { count } = await prisma.curriculumComment.updateMany({
    where: { ...unattachedWhere(groupId), OR: fromSources },
    data: { memberId, accessLinkId: linkId },
  });
  return count;
}

/**
 * Puts one piece of the group's learner feedback on a learner on its roster and onto their current
 * link: feedback whose learner left the roster, or that came through a link made again since (before
 * making links moved feedback along). Returns whether it moved (not when it isn't the group's learner
 * feedback), or null when the learner isn't on this group's roster.
 */
export async function moveCommentToLearner(groupId: string, commentId: string, memberId: string): Promise<boolean | null> {
  const linkId = await rosterLinkId(groupId, memberId);
  if (linkId === undefined) {
    return null;
  }
  const { count } = await prisma.curriculumComment.updateMany({
    where: { id: commentId, groupId, isInstructorNote: false },
    data: { memberId, accessLinkId: linkId },
  });
  return count > 0;
}

/** The learner's current link (null: none yet), or undefined when they aren't on the group's roster. */
async function rosterLinkId(groupId: string, memberId: string): Promise<string | null | undefined> {
  const member = await prisma.courseGroupMember.findFirst({ where: { id: memberId, groupId }, select: { id: true } });
  if (!member) {
    return undefined;
  }
  const link = await prisma.accessLink.findFirst({
    where: { memberId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return link?.id ?? null;
}
