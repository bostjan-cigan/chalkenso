import 'server-only';

import { assetIdsInOrganization } from '@/lib/asset-scope';
import { getCurriculumSyncManifest } from '@/lib/curriculum-sync-read';
import { prisma } from '@/lib/prisma';
import { streamObjectFromR2 } from '@/lib/r2';
import {
  ATTACHMENTS_FOLDER,
  CURRICULUMS_FOLDER,
  FOLDER_README,
  GROUPS_FOLDER,
  groupReadmeContent,
  imagePath,
  lessonNote,
  lessonNoteName,
  uniqueNotePath,
} from '@/lib/vault-layout';
import type { ExportWords } from './words';
import type { ExportContext } from './types';

/**
 * The lessons, as the Obsidian plugin keeps them (src/lib/vault-layout.ts): every version the person
 * can read, from the sync's own manifest (`getCurriculumSyncManifest` with content, what the plugin
 * downloads), one version at a time. The images come last, once everything else is in, since they
 * are what a time limit can leave out.
 */

/** Where each lesson's note is, for the history of published texts. */
export type ExportedLesson = { versionId: string; notePath: string; title: string; position: number };

export type ImageJob = { path: string; assetId: string };

/** An image larger than this is left out (lesson images are far smaller). */
export const MAX_IMAGE_MB = 25;
/** Images stop once they reach this in all, so an export stays a download. */
export const MAX_IMAGES_GB = 2;
/** Images read from storage ahead of the one being written. */
const IMAGES_AHEAD = 4;

export async function writeCurriculums(context: ExportContext, t: ExportWords) {
  const { scope, files } = context;
  const lessons = new Map<string, ExportedLesson>();
  const images: ImageJob[] = [];
  const syncedAt = context.now.toISOString();
  const imagePaths = new Set<string>();

  for (const version of scope.versions) {
    const manifest = await getCurriculumSyncManifest(version.id, { includeContent: true });
    if (!manifest) continue;
    const taken = new Set<string>([`${version.folder}/${FOLDER_README}`.toLowerCase()]);
    if (version.group) {
      await files.text(`${version.folder}/${FOLDER_README}`, groupReadmeContent(manifest.version));
    }
    for (const lesson of manifest.lessons) {
      const notePath = uniqueNotePath(version.folder, lessonNoteName(lesson), taken);
      await files.text(notePath, lessonNote(lesson, notePath, syncedAt));
      lessons.set(lesson.id, { versionId: version.id, notePath, title: lesson.title, position: lesson.position });
      for (const asset of lesson.assets ?? []) {
        const path = imagePath(version.folder, version.folder, lesson.markdownContent ?? '', asset.sourcePath);
        if (path && !imagePaths.has(path.toLowerCase()) && !taken.has(path.toLowerCase())) {
          imagePaths.add(path.toLowerCase());
          images.push({ path, assetId: asset.assetId });
        }
      }
    }
  }

  if (scope.versions.length) {
    context.describe(`${scope.vaultFolder}/`, t('describe.vault'));
  }
  if (scope.versions.some((version) => !version.group)) {
    context.describe(`${scope.vaultFolder}/${CURRICULUMS_FOLDER}/`, t('describe.curriculums'));
  }
  if (scope.versions.some((version) => version.group)) {
    context.describe(`${scope.vaultFolder}/${GROUPS_FOLDER}/`, t('describe.groups'));
  }
  if (images.length) {
    context.describe(`${scope.vaultFolder}/…/${ATTACHMENTS_FOLDER}/`, t('describe.attachments'));
  }
  return { lessons, images };
}

type Opened = { job: ImageJob; body: AsyncIterable<Uint8Array> | null; compress: boolean };

const STORED_TYPES = /^image\/(?:png|jpe?g|gif|webp|avif|heic|heif)$/i;

/** Writes the lessons' images, within the limits; what is left out is said in README.txt. */
export async function writeImages(context: ExportContext, t: ExportWords, jobs: ImageJob[]) {
  if (!jobs.length) return;
  const known = await assetIdsInOrganization(
    jobs.map((job) => job.assetId),
    context.scope.organization.id
  );
  const ids = Array.from(known);
  const assets = new Map<string, { r2Key: string; bytes: number | null; mimeType: string | null }>();
  for (let start = 0; start < ids.length; start += 500) {
    const rows = await prisma.mediaAsset.findMany({
      where: { id: { in: ids.slice(start, start + 500) } },
      select: { id: true, r2Key: true, bytes: true, mimeType: true },
    });
    rows.forEach((row) => assets.set(row.id, row));
  }

  const counts = { time: 0, large: 0, total: 0, missing: 0 };
  let written = 0;
  const wanted = jobs.filter((job) => {
    const asset = assets.get(job.assetId);
    if (!asset) {
      counts.missing += 1;
      return false;
    }
    if ((asset.bytes ?? 0) > MAX_IMAGE_MB * 1024 * 1024) {
      counts.large += 1;
      return false;
    }
    return true;
  });

  const open = async (job: ImageJob): Promise<Opened> => {
    const asset = assets.get(job.assetId)!;
    try {
      const object = await streamObjectFromR2(asset.r2Key);
      const type = object.contentType || asset.mimeType || '';
      return { job, body: object.body as unknown as AsyncIterable<Uint8Array>, compress: !STORED_TYPES.test(type) };
    } catch {
      return { job, body: null, compress: false };
    }
  };

  const ahead: Array<Promise<Opened>> = wanted.slice(0, IMAGES_AHEAD).map(open);
  for (let index = 0; index < wanted.length; index += 1) {
    const opened = await ahead[index];
    const next = wanted[index + IMAGES_AHEAD];
    if (next && context.hasTime()) ahead.push(open(next));
    const asset = assets.get(opened.job.assetId)!;
    if (!context.hasTime()) {
      counts.time += wanted.length - index;
      await cancel(opened);
      for (const rest of ahead.slice(index + 1)) await cancel(await rest);
      break;
    }
    if (written + (asset.bytes ?? 0) > MAX_IMAGES_GB * 1024 * 1024 * 1024) {
      counts.total += 1;
      await cancel(opened);
      continue;
    }
    if (!opened.body) {
      counts.missing += 1;
      continue;
    }
    await context.files.binary(opened.job.path, opened.body, { compress: opened.compress });
    written += asset.bytes ?? 0;
  }

  if (counts.time) context.leftOut(t('leftOut.imagesTime', { count: counts.time }));
  if (counts.large) context.leftOut(t('leftOut.imagesLarge', { count: counts.large, size: MAX_IMAGE_MB }));
  if (counts.total) context.leftOut(t('leftOut.imagesTotal', { count: counts.total, size: MAX_IMAGES_GB }));
  if (counts.missing) context.leftOut(t('leftOut.imagesMissing', { count: counts.missing }));
}

/** Lets go of an image read from storage but not written. */
async function cancel(opened: Opened) {
  const body = opened.body as unknown as ReadableStream<Uint8Array> | null;
  try {
    await body?.cancel?.();
  } catch {
    // Already closed.
  }
}
