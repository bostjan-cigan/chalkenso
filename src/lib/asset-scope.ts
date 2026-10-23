import 'server-only';

import { Prisma } from '@prisma/client';
import { withoutOrgScope } from './org-context';
import { prisma } from './prisma';

/**
 * Which of these uploaded images belong to an organisation. An image row has no organisation of its
 * own, so it belongs where it is stored (`organizations/<id>/…`, also while its upload is pending)
 * or where it is used: a lesson's image, a course cover or a published binding there. Older images,
 * stored before keys were per organisation, can belong to several.
 *
 * Viewing an image and attaching one (sync, course covers) both go through this, so an id from
 * another organisation is neither shown nor bound.
 */
export async function assetIdsInOrganization(assetIds: string[], organizationId: string): Promise<Set<string>> {
  const ids = Array.from(new Set(assetIds.filter(Boolean)));
  if (!ids.length) {
    return new Set();
  }
  const inOrg = { organizationId };
  const assets = await withoutOrgScope(() =>
    prisma.mediaAsset.findMany({ where: { id: { in: ids } }, select: { id: true, r2Key: true } })
  );
  // Stored under the organisation: nothing else to look up (every image uploaded since keys were
  // per organisation).
  const stored = assets.filter((asset) => storedInOrganization(asset.r2Key, organizationId)).map((asset) => asset.id);
  const others = assets.filter((asset) => !storedInOrganization(asset.r2Key, organizationId)).map((asset) => asset.id);
  if (!others.length) {
    return new Set(stored);
  }
  const [references, covers, bindings] = await withoutOrgScope(() =>
    Promise.all([
      prisma.lessonAssetReference.findMany({
        where: { assetId: { in: others }, lesson: { course: inOrg } },
        select: { assetId: true },
        distinct: ['assetId'],
      }),
      prisma.course.findMany({ where: { ...inOrg, coverAssetId: { in: others } }, select: { coverAssetId: true } }),
      // Only the lessons whose bindings contain one of these ids are expanded (containment on the
      // column itself, so an index on it can find them).
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT binding->>'assetId' AS id
        FROM courses.lessons lesson
        JOIN courses.courses course ON course.id = lesson.course_id
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(lesson.published_asset_bindings) = 'array' THEN lesson.published_asset_bindings ELSE '[]'::jsonb END
        ) AS binding
        WHERE course.organization_id = ${organizationId}
          AND (${Prisma.join(
            others.map((id) => Prisma.sql`lesson.published_asset_bindings @> ${bindingJson(id)}::jsonb`),
            ' OR '
          )})
          AND binding->>'assetId' IN (${Prisma.join(others)})`,
    ])
  );
  return new Set([
    ...stored,
    ...references.flatMap((row) => (row.assetId ? [row.assetId] : [])),
    ...covers.flatMap((row) => (row.coverAssetId ? [row.coverAssetId] : [])),
    ...bindings.map((row) => row.id),
  ]);
}

/**
 * `assetIdsInOrganization` for one image (every image request asks this): one statement, which
 * looks for uses only when the image isn't stored under the organisation.
 */
export async function assetInOrganization(assetId: string, organizationId: string) {
  if (!assetId) {
    return false;
  }
  const own = `organizations/${organizationId}/`;
  const rows = await prisma.$queryRaw<Array<{ owned: boolean }>>`
    SELECT
      CASE
        WHEN starts_with(asset.r2_key, ${own}) OR starts_with(asset.r2_key, ${`pending/${own}`}) THEN true
        ELSE EXISTS (
          SELECT 1 FROM courses.lesson_asset_references reference
          JOIN courses.lessons lesson ON lesson.id = reference.lesson_id
          JOIN courses.courses course ON course.id = lesson.course_id
          WHERE reference.asset_id = ${assetId} AND course.organization_id = ${organizationId}
        ) OR EXISTS (
          SELECT 1 FROM courses.courses course
          WHERE course.cover_asset_id = ${assetId} AND course.organization_id = ${organizationId}
        ) OR EXISTS (
          SELECT 1 FROM courses.lessons lesson
          JOIN courses.courses course ON course.id = lesson.course_id
          WHERE lesson.published_asset_bindings @> ${bindingJson(assetId)}::jsonb
            AND course.organization_id = ${organizationId}
        )
      END AS owned
    FROM courses.media_assets asset
    WHERE asset.id = ${assetId}
  `;
  return rows[0]?.owned === true;
}

function storedInOrganization(r2Key: string, organizationId: string) {
  const own = `organizations/${organizationId}/`;
  return r2Key.startsWith(own) || r2Key.startsWith(`pending/${own}`);
}

/** A published-bindings array that contains this image: `[{ "assetId": … }]`, for `@>`. */
function bindingJson(assetId: string) {
  return JSON.stringify([{ assetId }]);
}
