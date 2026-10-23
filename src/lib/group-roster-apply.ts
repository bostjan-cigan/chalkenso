import 'server-only';

import { Prisma } from '@prisma/client';
import { noteRawWrite, type DbClient } from './prisma';
import { planRosterUpdate, type ParsedRosterMember } from './group-roster';
import { deleteNotesForMembers } from './lesson-notes';

export type RosterUpdateSummary = {
  kept: number;
  moved: number;
  renamed: number;
  created: number;
  removed: number;
};

/**
 * Brings a group's stored roster in line with a submitted one, keeping every member row it can.
 *
 * A member's id is the anchor for their access links, their feedback attribution and their lesson
 * notes, so the previous delete-everything-and-recreate approach silently detached all three every
 * time somebody was added to a cohort. Reconciling instead means only the people who actually left
 * lose anything.
 *
 * Must run inside a transaction: the position shuffle below is briefly inconsistent by design.
 */
export async function applyRosterUpdate(
  client: DbClient,
  input: { groupId: string; desired: ParsedRosterMember[]; now: Date }
): Promise<RosterUpdateSummary> {
  const { groupId, desired, now } = input;

  const existing = await client.courseGroupMember.findMany({
    where: { groupId },
    select: { id: true, fullName: true, position: true },
  });

  const plan = planRosterUpdate(existing, desired);

  if (plan.removeIds.length > 0) {
    /**
     * Revoke before deleting. `AccessLink.member` is `SetNull`, so a departing member's link would
     * otherwise outlive them as an ownerless row rather than becoming invalid.
     */
    await client.accessLink.updateMany({
      where: {
        expiresAt: { gt: now },
        memberId: { in: plan.removeIds },
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    // Nobody can reach these notes again once the member row is gone, so they go with it.
    await deleteNotesForMembers(plan.removeIds, client);

    await client.courseGroupMember.deleteMany({
      where: { id: { in: plan.removeIds } },
    });
  }

  /**
   * `@@unique([groupId, position])` rules out reassigning positions in place — two members swapping
   * collide halfway through, since the database checks each row as it goes. Park the movers on
   * negative positions first (a real position is always >= 1, so the scratch range is free), then
   * drop them onto their final ones.
   *
   * Members that aren't moving are left untouched, and no mover can be aiming at their position:
   * the submitted roster already has that member sitting there.
   */
  const movers = plan.keep.filter((member) => member.position !== member.currentPosition);
  // A re-spelling (capitalisation, an accent) keeps the member, and so keeps their link and notes.
  const renamed = plan.keep.filter((member) => member.fullName !== member.currentName);
  const changed = plan.keep.filter(
    (member) => member.position !== member.currentPosition || member.fullName !== member.currentName
  );

  if (movers.length > 0) {
    await client.courseGroupMember.updateMany({
      where: { id: { in: movers.map((member) => member.id) } },
      data: { position: { multiply: -1 } },
    });
  }

  if (changed.length > 0) {
    // Final positions and names in one statement: by now every target position is free. Raw because
    // each row gets its own values; the ids come from the scoped read above.
    const rows = changed.map(
      (member) => Prisma.sql`(${member.id}, ${member.position}::int, ${member.fullName})`
    );
    const updated = await client.$executeRaw`
      UPDATE "courses"."course_group_members" AS existing
      SET
        "position" = wanted."position",
        "full_name" = wanted."full_name",
        "updated_at" = CURRENT_TIMESTAMP
      FROM (VALUES ${Prisma.join(rows)}) AS wanted("id", "position", "full_name")
      WHERE existing."id" = wanted."id" AND existing."group_id" = ${groupId}
    `;
    await noteRawWrite('CourseGroupMember', 'updateMany', { data: { position: true, fullName: true }, where: { groupId } }, updated);
  }

  if (plan.create.length > 0) {
    /**
     * Runs last, once every surviving member sits on its final position, so the slots the new
     * arrivals take are free by construction.
     */
    await client.courseGroupMember.createMany({
      data: plan.create.map((member) => ({
        fullName: member.fullName,
        groupId,
        position: member.position,
      })),
    });
  }

  return {
    kept: plan.keep.length,
    moved: movers.length,
    renamed: renamed.length,
    created: plan.create.length,
    removed: plan.removeIds.length,
  };
}
