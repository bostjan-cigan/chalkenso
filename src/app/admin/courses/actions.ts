'use server';

import { AiProposalStatus, CurriculumVersionStatus, LessonStatus, Permission, type Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentUserSession, requireSection, requireUser } from '@/lib/admin-auth';
import { requireCourseAccess, requireVersionEdit } from '@/lib/crm-access';
import { isLocale } from '@/i18n/config';
import { applyLessonStatus, deleteLesson } from '@/lib/lesson-publishing';
import { recordLessonChange, savedLessonChange, type NewLessonChange, type SavedLessonChange } from '@/lib/lesson-changes';
import { finishImprovement, workHere } from '@/lib/task-flow';
import { startNextImprovement } from '@/lib/lesson-improvement';
import { lessonChangesFromForm } from './lesson-change-input';
import { carryToCourse, type CourseCarry } from './carry-to-course';
import {
  buildAccessPlaceholderHtml,
  computeLessonSourceHash,
} from '@/lib/access-lesson-render';
import { buildLessonAssetReferences, getPendingImageReferences } from '@/lib/course-markdown';
import { draftDiagrams, loadLessonRevision } from '@/lib/ai-drafts';
import { uploadSyncAsset } from '@/lib/sync-assets';
import { normalizeOptionalGithubUrl } from '@/lib/github-url';
import { serverExtensions } from '@/extensions/server';
import { assetInOrganization } from '@/lib/asset-scope';
import { prisma } from '@/lib/prisma';
import { ensureUniqueSlug } from '@/lib/slugs';
import { retryOnUniqueViolation } from '@/lib/unique-retry';

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

const JOIN_TARGETS = ['LINKEDIN', 'PARTNER', 'LINK'] as const;

/** The language of the course's learner pages, when the form has it (one of `LOCALES`). */
function getCourseLanguage(formData: FormData) {
  const language = getFormValue(formData, 'language');
  return isLocale(language) ? { language } : {};
}

/**
 * How the course appears on the organisation's website; `null` when the join link isn't an http(s)
 * URL. The partner and link fields are only in the form for their join target, so absent ones keep
 * their value.
 */
function getPublicPageSettings(formData: FormData) {
  const enrolUrl = getFormValue(formData, 'enrolUrl');
  if (enrolUrl && !/^https?:\/\/\S+$/i.test(enrolUrl)) {
    return null;
  }

  const target = getFormValue(formData, 'joinTarget');
  const joinTarget = JOIN_TARGETS.find((candidate) => candidate === target) ?? 'LINKEDIN';

  const freeLessonCount = Number.parseInt(getFormValue(formData, 'freeLessonCount'), 10);
  // Checkboxes are absent when unticked, so they only apply when the form has its "On your
  // website" section; otherwise saving the course would quietly reset them.
  const hasWebsiteSettings = formData.has('websiteSettings');
  return {
    ...(hasWebsiteSettings
      ? {
          allLessonsFree: formData.get('allLessonsFree') === 'on',
          pinned: formData.get('pinned') === 'on',
          publicListed: formData.get('publicListed') === 'on',
        }
      : {}),
    // Card fields are only in the form while "Show on /courses" is ticked.
    ...(formData.has('coverAssetId') ? { coverAssetId: getFormValue(formData, 'coverAssetId') || null } : {}),
    ...(formData.has('outcome') ? { outcome: getFormValue(formData, 'outcome') || null } : {}),
    ...(formData.has('tags')
      ? {
          tags: Array.from(
            new Set(
              getFormValue(formData, 'tags')
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean)
            )
          ).slice(0, 5),
        }
      : {}),
    ...(formData.has('joinTarget') ? { joinTarget } : {}),
    ...(formData.has('joinPartnerId') ? { joinPartnerId: getFormValue(formData, 'joinPartnerId') || null } : {}),
    ...(formData.has('enrolUrl') ? { enrolUrl: enrolUrl || null } : {}),
    // Hidden while "All lessons free" is ticked, so an absent field keeps the default.
    ...(Number.isFinite(freeLessonCount) ? { freeLessonCount: Math.max(0, freeLessonCount) } : {}),
  };
}

function getLessonStatusValue(formData: FormData) {
  const rawStatus = getFormValue(formData, 'status').toUpperCase();

  return rawStatus === LessonStatus.PUBLISHED
    ? LessonStatus.PUBLISHED
    : LessonStatus.DRAFT;
}

async function getUploadedAssetBindings(formData: FormData) {
  const rawBindings = formData.getAll('uploadedAssetBinding');
  const parsedBindings = new Map<string, string>();

  for (const rawBinding of rawBindings) {
    if (typeof rawBinding !== 'string') {
      continue;
    }

    try {
      const parsedBinding = JSON.parse(rawBinding) as {
        assetId?: string;
        sourcePath?: string;
      };
      const assetId = parsedBinding.assetId?.trim();
      const sourcePath = parsedBinding.sourcePath?.trim();

      if (!assetId || !sourcePath) {
        continue;
      }

      parsedBindings.set(sourcePath, assetId);
    } catch {
      continue;
    }
  }

  if (parsedBindings.size === 0) {
    return parsedBindings;
  }

  const validAssetIds = new Set(
    (
      await prisma.mediaAsset.findMany({
        where: {
          id: {
            in: Array.from(new Set(parsedBindings.values())),
          },
        },
        select: {
          id: true,
        },
      })
    ).map((asset) => asset.id)
  );

  return new Map(
    Array.from(parsedBindings.entries()).filter(([, assetId]) =>
      validAssetIds.has(assetId)
    )
  );
}

/**
 * New diagrams from AI drafts that the saved text embeds and nothing was uploaded for. The form names
 * each one's draft and path (`draftDiagram`), never the drawing: it's read from the draft (one for
 * this lesson, still waiting for review) and stored as a lesson image, cleaned on the way like every
 * SVG upload, and its binding added. False when one couldn't be stored (nothing is saved then).
 */
async function storeDraftDiagrams(
  formData: FormData,
  input: { lessonId: string; courseId: string; markdownContent: string; bindings: Map<string, string> }
) {
  const pending = new Set(getPendingImageReferences(input.markdownContent).map((reference) => reference.sourcePath));
  const wanted = new Map<string, string>();
  for (const raw of formData.getAll('draftDiagram').slice(0, 20)) {
    if (typeof raw !== 'string') continue;
    try {
      const { proposalId, sourcePath } = JSON.parse(raw) as { proposalId?: unknown; sourcePath?: unknown };
      if (typeof proposalId === 'string' && typeof sourcePath === 'string' && pending.has(sourcePath) && !input.bindings.has(sourcePath)) {
        wanted.set(sourcePath, proposalId);
      }
    } catch {
      continue;
    }
  }
  if (!wanted.size) return true;
  const course = await prisma.course.findFirst({ where: { id: input.courseId }, select: { id: true, organizationId: true } });
  if (!course) return false;
  for (const [sourcePath, proposalId] of Array.from(wanted)) {
    const draft = await loadLessonRevision(proposalId);
    if (!draft || draft.targetId !== input.lessonId || draft.status !== AiProposalStatus.OPEN) continue;
    const diagram = draftDiagrams(draft.payload).find((item) => item.path === sourcePath);
    if (!diagram) continue;
    const stored = await uploadSyncAsset(
      {
        filename: sourcePath.split('/').pop(),
        contentType: 'image/svg+xml',
        dataBase64: Buffer.from(diagram.svg, 'utf8').toString('base64'),
        sourcePath,
      },
      { organizationId: course.organizationId, courseId: course.id }
    );
    if (!stored.ok) {
      console.error('Could not store a diagram from an AI draft', stored.error);
      return false;
    }
    input.bindings.set(sourcePath, stored.assetId);
  }
  return true;
}

async function ensureUniqueCourseSlug(baseSlug: string) {
  return ensureUniqueSlug(baseSlug, async (slug) => {
    const existingCourse = await prisma.course.findFirst({
      where: {
        slug,
      },
      select: {
        id: true,
      },
    });

    return Boolean(existingCourse);
  });
}

async function ensureUniqueCourseSlugForUpdate(courseId: string, baseSlug: string) {
  return ensureUniqueSlug(baseSlug, async (slug) => {
    const existingCourse = await prisma.course.findFirst({
      where: {
        slug,
      },
      select: {
        id: true,
      },
    });

    return Boolean(existingCourse && existingCourse.id !== courseId);
  });
}

/**
 * The course's partners, in order. `ids` is null when the form has no partner list
 * (`partnersField`), so saving such a form leaves the partners as they are.
 */
async function getValidPartnerIds(formData: FormData) {
  if (!formData.has('partnersField')) {
    return {
      hasInvalid: false,
      ids: null,
    };
  }

  const rawPartnerIds = formData
    .getAll('partnerId')
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  if (rawPartnerIds.length === 0) {
    return {
      hasInvalid: false,
      ids: [] as string[],
    };
  }

  const uniquePartnerIds = Array.from(new Set(rawPartnerIds));
  const partners = await prisma.partner.findMany({
    where: {
      id: {
        in: uniquePartnerIds,
      },
    },
    select: {
      id: true,
    },
  });

  const validIds = new Set(partners.map((partner) => partner.id));
  const hasInvalid = uniquePartnerIds.some((id) => !validIds.has(id));

  return {
    hasInvalid,
    ids: uniquePartnerIds.filter((id) => validIds.has(id)),
  };
}

/**
 * Checks the join partner and cover the form points at: an unknown partner is an error; a cover
 * image that is gone, or isn't this organisation's, is dropped. Returns the settings to save, or null.
 */
async function checkPublicPageReferences<T extends { joinPartnerId?: string | null; coverAssetId?: string | null }>(
  publicPage: T,
  organizationId: string
): Promise<T | null> {
  if (publicPage.joinPartnerId) {
    const partner = await prisma.partner.findFirst({ where: { id: publicPage.joinPartnerId }, select: { id: true } });
    if (!partner) {
      return null;
    }
  }
  if (publicPage.coverAssetId && !(await assetInOrganization(publicPage.coverAssetId, organizationId))) {
    return { ...publicPage, coverAssetId: null };
  }
  return publicPage;
}

/** What the cover shows (its alt text), when the form has the field and the course has a cover. */
async function saveCoverAlt(formData: FormData, coverAssetId: string | null | undefined) {
  if (!coverAssetId || !formData.has('coverAlt')) {
    return;
  }
  await prisma.mediaAsset.update({
    where: { id: coverAssetId },
    data: { altText: getFormValue(formData, 'coverAlt') || null },
  });
}

/**
 * Validates a posted arc id belongs to the target version. Returns the arc id when valid,
 * or null (ungrouped) when empty or not part of this version.
 */
async function resolveLessonArcId(
  curriculumVersionId: string,
  requestedArcId: string
): Promise<string | null> {
  if (!requestedArcId) {
    return null;
  }

  const arc = await prisma.lessonArc.findFirst({
    where: { curriculumVersionId, id: requestedArcId },
    select: { id: true },
  });

  return arc?.id ?? null;
}

async function ensureUniqueLessonSlug(curriculumVersionId: string, baseSlug: string) {
  return ensureUniqueSlug(baseSlug, async (slug) => {
    const existingLesson = await prisma.lesson.findUnique({
      where: {
        curriculumVersionId_slug: {
          curriculumVersionId,
          slug,
        },
      },
      select: {
        id: true,
      },
    });

    return Boolean(existingLesson);
  });
}

/**
 * A new lesson at the end of its version, published right away when saved as PUBLISHED (a draft
 * stays hidden until published). Two lessons created at the same moment can pick the same position
 * or slug: the loser picks again, so neither person sees an error.
 */
async function createLessonRecord(input: {
  courseId: string;
  versionId: string;
  title: string;
  slugInput: string;
  status: LessonStatus;
  markdownContent: string;
  shortDescription: string | null;
  arcId: string | null;
  uploadedAssetBindings: Map<string, string>;
  /** Who saves it (the version history says who published it). */
  publishedBy: string;
}) {
  const assetReferences = buildLessonAssetReferences(input.markdownContent, input.uploadedAssetBindings);
  const accessRefs = assetReferences.map((reference) => ({
    assetId: reference.assetId ?? null,
    sourcePath: reference.sourcePath,
  }));
  const accessHash = computeLessonSourceHash(input.markdownContent, accessRefs);
  const accessHtml = buildAccessPlaceholderHtml(input.markdownContent, accessRefs);

  return retryOnUniqueViolation(
    async () => {
      const slug = await ensureUniqueLessonSlug(input.versionId, input.slugInput || input.title);
      return prisma.$transaction(async (transaction) => {
        const lastLesson = await transaction.lesson.findFirst({
          where: {
            curriculumVersionId: input.versionId,
          },
          orderBy: {
            position: 'desc',
          },
          select: {
            position: true,
          },
        });
        const lesson = await transaction.lesson.create({
          data: {
            accessHtmlSourceHash: accessHash,
            accessRenderedHtml: accessHtml,
            arcId: input.arcId,
            assetReferences: assetReferences.length
              ? {
                  create: assetReferences,
                }
              : undefined,
            courseId: input.courseId,
            curriculumVersionId: input.versionId,
            markdownContent: input.markdownContent,
            position: (lastLesson?.position ?? 0) + 1,
            shortDescription: input.shortDescription,
            slug,
            status: input.status,
            title: input.title,
          },
          select: { id: true },
        });
        // Saved as PUBLISHED: learners see it now; a draft stays hidden until published.
        await applyLessonStatus(transaction, lesson.id, input.status, input.publishedBy);
        return lesson;
      });
    },
    { fields: ['position', 'slug'] }
  );
}

export async function createCourseAction(formData: FormData) {
  const viewer = await requireSection('courses', [Permission.WRITE]);

  const title = getFormValue(formData, 'title');
  const slugInput = getFormValue(formData, 'slug');
  const summary = getFormValue(formData, 'summary');
  const githubUrlRaw = getFormValue(formData, 'githubUrl');

  if (!title) {
    redirect('/admin/courses/new?error=course-title');
  }

  const githubParsed = normalizeOptionalGithubUrl(githubUrlRaw);
  if (!githubParsed.ok) {
    redirect('/admin/courses/new?error=course-github-url');
  }

  const settings = getPublicPageSettings(formData);
  if (!settings) {
    redirect('/admin/courses/new?error=course-enrol-url');
  }

  const [publicPage, partnerIds] = await Promise.all([
    checkPublicPageReferences(settings, viewer.organization.id),
    getValidPartnerIds(formData),
  ]);
  if (!publicPage || partnerIds.hasInvalid) {
    redirect('/admin/courses/new?error=course-partner');
  }

  // A slug taken a moment ago by another new course: the next free one.
  const course = await retryOnUniqueViolation(
    async () => {
      const slug = await ensureUniqueCourseSlug(slugInput || title);
      return prisma.$transaction(async (transaction) => {
        const createdCourse = await transaction.course.create({
          data: {
            organizationId: viewer.organization.id,
            ...publicPage,
            ...getCourseLanguage(formData),
            githubUrl: githubParsed.value,
            slug,
            summary: summary || null,
            title,
          },
          select: {
            id: true,
          },
        });

        // Every course starts with a published v1 so lessons can be authored and served immediately.
        await transaction.curriculumVersion.create({
          data: {
            courseId: createdCourse.id,
            label: 'v1',
            version: 1,
            status: CurriculumVersionStatus.PUBLISHED,
            publishedAt: new Date(),
          },
        });

        if (partnerIds.ids?.length) {
          await transaction.coursePartner.createMany({
            data: partnerIds.ids.map((partnerId, index) => ({
              courseId: createdCourse.id,
              partnerId,
              position: index,
            })),
          });
        }

        return createdCourse;
      });
    },
    { fields: ['slug'] }
  );
  await saveCoverAlt(formData, publicPage.coverAssetId);
  serverExtensions.onCourseUpdated([course.id]);

  revalidatePath('/admin');
  revalidatePath('/admin/courses');

  redirect(`/admin/courses/${course.id}?status=course-created`);
}

/** What saving part of a course's settings says (`useActionNotice`). */
export type CourseSettingsResult = { ok: boolean; message: string };

/** The course's on/off settings for the organisation's website, each a switch on its Settings tab. */
const COURSE_SWITCHES = ['publicListed', 'pinned', 'allLessonsFree'] as const;
export type CourseSwitch = (typeof COURSE_SWITCHES)[number];

/** Owners, admins and unrestricted members set a course's settings (its Settings tab). */
async function requireCourseSettings(courseId: string) {
  await requireCourseAccess(courseId, [Permission.WRITE]);
  return requireSection('courses', [Permission.WRITE]);
}

function revalidateCourseSettings(courseId: string) {
  revalidatePath('/admin');
  revalidatePath('/admin/courses');
  revalidatePath('/admin/courses/partners');
  revalidatePath(`/admin/courses/${courseId}`, 'layout');
  revalidatePath('/courses', 'layout');
  revalidatePath('/sitemap.xml');
}

/**
 * Saves one part of a course's settings, from a sheet on its Settings tab: only the fields that
 * part's form has change (a form without `title` keeps the title, one without the partner list
 * keeps the partners, and so on).
 */
export async function saveCourseSettingsAction(formData: FormData): Promise<CourseSettingsResult> {
  const courseId = getFormValue(formData, 'courseId');
  const viewer = await requireCourseSettings(courseId);
  const t = await getTranslations('courses.flash');

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true } });
  if (!course) {
    return { ok: false, message: t('error.courseNotFound') };
  }

  const title = formData.has('title') ? getFormValue(formData, 'title') : course.title;
  if (!title) {
    return { ok: false, message: t('error.courseTitle') };
  }

  const githubParsed = normalizeOptionalGithubUrl(getFormValue(formData, 'githubUrl'));
  if (formData.has('githubUrl') && !githubParsed.ok) {
    return { ok: false, message: t('error.courseGithubUrl') };
  }

  const settings = getPublicPageSettings(formData);
  if (!settings) {
    return { ok: false, message: t('error.courseEnrolUrl') };
  }

  const [publicPage, partnerIds] = await Promise.all([
    checkPublicPageReferences(settings, viewer.organization.id),
    getValidPartnerIds(formData),
  ]);
  if (!publicPage || partnerIds.hasInvalid) {
    return { ok: false, message: t('error.coursePartner') };
  }

  // A slug taken a moment ago by another course: the next free one.
  await retryOnUniqueViolation(
    async () => {
      const slug = formData.has('slug') ? await ensureUniqueCourseSlugForUpdate(courseId, getFormValue(formData, 'slug') || title) : null;
      return prisma.$transaction(async (transaction) => {
        await transaction.course.update({
          where: {
            id: courseId,
          },
          data: {
            ...publicPage,
            ...getCourseLanguage(formData),
            ...(formData.has('title') ? { title } : {}),
            ...(slug ? { slug } : {}),
            ...(formData.has('summary') ? { summary: getFormValue(formData, 'summary') || null } : {}),
            ...(formData.has('githubUrl') && githubParsed.ok ? { githubUrl: githubParsed.value } : {}),
          },
        });

        // Only a form with the partner list replaces the partners; the list's order is their order.
        if (partnerIds.ids) {
          await transaction.coursePartner.deleteMany({
            where: {
              courseId,
            },
          });

          if (partnerIds.ids.length > 0) {
            await transaction.coursePartner.createMany({
              data: partnerIds.ids.map((partnerId, index) => ({
                courseId,
                partnerId,
                position: index,
              })),
            });
          }
        }
      });
    },
    { fields: ['slug'] }
  );
  await saveCoverAlt(formData, publicPage.coverAssetId);
  serverExtensions.onCourseUpdated([courseId]);
  revalidateCourseSettings(courseId);

  return { ok: true, message: t('status.courseUpdated') };
}

/** One of the course's website switches, saved as it is flipped. */
export async function setCourseSwitchAction(courseId: string, key: CourseSwitch, on: boolean): Promise<CourseSettingsResult> {
  await requireCourseSettings(courseId);
  const t = await getTranslations('courses.flash');
  if (!COURSE_SWITCHES.includes(key) || typeof on !== 'boolean') {
    return { ok: false, message: t('error.courseNotFound') };
  }

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) {
    return { ok: false, message: t('error.courseNotFound') };
  }

  await prisma.course.update({ where: { id: courseId }, data: { [key]: on } });
  serverExtensions.onCourseUpdated([courseId]);
  revalidateCourseSettings(courseId);

  return { ok: true, message: t('status.courseUpdated') };
}

export async function createLessonAction(formData: FormData) {
  const user = await requireUser();

  const courseId = getFormValue(formData, 'courseId');
  const curriculumVersionId = getFormValue(formData, 'curriculumVersionId');
  const title = getFormValue(formData, 'title');
  const slugInput = getFormValue(formData, 'slug');
  const status = getLessonStatusValue(formData);
  const markdownContent = String(formData.get('markdownContent') ?? '');
  const lessonEditorPath = `/admin/courses/${courseId}/lessons/new`;

  if (!courseId) {
    redirect('/admin/courses?error=lesson-course');
  }

  if (!title) {
    redirect(`${lessonEditorPath}?error=lesson-title`);
  }

  if (!markdownContent.trim()) {
    redirect(`${lessonEditorPath}?error=lesson-markdown`);
  }

  const uploadedAssetBindings = await getUploadedAssetBindings(formData);

  const versionId = await resolveLessonVersionId(courseId, curriculumVersionId);

  // Courses section for any version; instructors only on their group curriculum.
  if (versionId) {
    await requireVersionEdit(versionId, [Permission.WRITE]);
  }

  if (!versionId) {
    redirect('/admin/courses?error=lesson-course');
  }

  const lesson = await createLessonRecord({
    courseId,
    versionId,
    title,
    slugInput,
    status,
    markdownContent,
    shortDescription: getFormValue(formData, 'shortDescription') || null,
    arcId: await resolveLessonArcId(versionId, getFormValue(formData, 'arcId')),
    uploadedAssetBindings,
    publishedBy: user.id,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/admin/courses/${courseId}/versions/${versionId}`);
  revalidatePath(`/admin/courses/${courseId}/lessons/new`);

  redirect(
    `/admin/courses/${courseId}/versions/${versionId}?lesson=${lesson.id}&status=lesson-created`
  );
}

async function ensureUniqueLessonSlugForUpdate(
  curriculumVersionId: string,
  baseSlug: string,
  lessonId: string
) {
  return ensureUniqueSlug(baseSlug, async (slug) => {
    const existingLesson = await prisma.lesson.findUnique({
      where: {
        curriculumVersionId_slug: {
          curriculumVersionId,
          slug,
        },
      },
      select: {
        id: true,
      },
    });

    return Boolean(existingLesson && existingLesson.id !== lessonId);
  });
}

/**
 * Resolves the target version for a lesson create: the posted `curriculumVersionId` when it
 * belongs to the course, else the course's newest version (fallback for older editor loads).
 */
async function resolveLessonVersionId(
  courseId: string,
  requestedVersionId: string
): Promise<string | null> {
  if (requestedVersionId) {
    const version = await prisma.curriculumVersion.findFirst({
      where: { courseId, id: requestedVersionId },
      select: { id: true },
    });

    if (version) {
      return version.id;
    }
  }

  const latest = await prisma.curriculumVersion.findFirst({
    where: { courseId, ownerGroupId: null },
    orderBy: { version: 'desc' },
    select: { id: true },
  });

  return latest?.id ?? null;
}

export type LessonInlineActionResult =
  | {
      lessonId: string;
      message: string;
      ok: true;
      redirectTo?: string;
      /** After a save: the lesson's revision now, for the editor's next save (`revision` field). */
      revision?: number;
      /** What the save finished: an improvement done, feedback marked done (or waiting for publishing). */
      change?: SavedLessonChange | null;
      /** The same for every improvement the save carried (the lesson's Improvements view saves several). */
      changes?: SavedLessonChange[];
      /** A group's copy saved for an improvement that also changes the main course: what that got. */
      course?: CourseCarry | null;
      /** Feedback used after the changes were drafted, now the lesson's next improvement. */
      next?: { taskId: string; count: number } | null;
    }
  | {
      message: string;
      ok: false;
    };

export async function createLessonInlineAction(
  formData: FormData
): Promise<LessonInlineActionResult> {
  const user = await requireUser();
  const t = await getTranslations('courses.actions');

  const courseId = getFormValue(formData, 'courseId');
  const curriculumVersionId = getFormValue(formData, 'curriculumVersionId');
  const title = getFormValue(formData, 'title');
  const slugInput = getFormValue(formData, 'slug');
  const status = getLessonStatusValue(formData);
  const markdownContent = String(formData.get('markdownContent') ?? '');

  if (!courseId) {
    return {
      message: t('selectCourse'),
      ok: false,
    };
  }

  if (!title) {
    return {
      message: t('lessonTitle'),
      ok: false,
    };
  }

  if (!markdownContent.trim()) {
    return {
      message: t('lessonMarkdown'),
      ok: false,
    };
  }

  const uploadedAssetBindings = await getUploadedAssetBindings(formData);
  const versionId = await resolveLessonVersionId(courseId, curriculumVersionId);

  // Courses section for any version; instructors only on their group curriculum.
  if (versionId) {
    await requireVersionEdit(versionId, [Permission.WRITE]);
  }

  if (!versionId) {
    return {
      message: t('selectCourse'),
      ok: false,
    };
  }

  const lesson = await createLessonRecord({
    courseId,
    versionId,
    title,
    slugInput,
    status,
    markdownContent,
    shortDescription: getFormValue(formData, 'shortDescription') || null,
    arcId: await resolveLessonArcId(versionId, getFormValue(formData, 'arcId')),
    uploadedAssetBindings,
    publishedBy: user.id,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/admin/courses/${courseId}/versions/${versionId}`);
  revalidatePath(`/admin/courses/${courseId}/lessons/new`);

  return {
    lessonId: lesson.id,
    message: t('lessonSaved'),
    ok: true,
    redirectTo: `/admin/courses/${courseId}/lessons/${lesson.id}?version=${versionId}&status=lesson-created`,
  };
}

/** The revision the editor loaded (its `revision` field), or null when the form has none. */
function getLoadedRevision(formData: FormData): number | null {
  const revision = Number(getFormValue(formData, 'revision'));
  return Number.isInteger(revision) && revision > 0 ? revision : null;
}

/**
 * Saves a lesson's working copy with its image references, and publishes it when saved as
 * PUBLISHED. With `loadedRevision` only while the lesson is still at it, like the sync path
 * (`updateSyncLesson`): a push from Obsidian that landed after the editor opened is never overwritten
 * unseen. A form without one (an editor opened before this check) overwrites, as it always did.
 * Returns the new revision, or null when the lesson had moved on and nothing was written.
 */
async function saveLessonWorkingCopy(input: {
  lessonId: string;
  curriculumVersionId: string;
  loadedRevision: number | null;
  slugInput: string;
  data: {
    title: string;
    status: LessonStatus;
    markdownContent: string;
    shortDescription: string | null;
    arcId: string | null;
  };
  uploadedAssetBindings: Map<string, string>;
  /** Who saves it (the version history says who published it). */
  publishedBy: string;
  /**
   * What the save carries from proposed changes or improvements, one per improvement (see
   * `lesson-changes.ts`), with the feedback each improvement's changes don't answer (`later`).
   */
  changes?: Array<Omit<NewLessonChange, 'lessonId' | 'revision'> & { later?: string[] }>;
}): Promise<{ revision: number; changes: SavedLessonChange[]; next: { taskId: string; count: number } | null } | null> {
  const { lessonId, loadedRevision } = input;
  const assetReferences = buildLessonAssetReferences(input.data.markdownContent, input.uploadedAssetBindings);
  const accessRefs = assetReferences.map((reference) => ({
    assetId: reference.assetId ?? null,
    sourcePath: reference.sourcePath,
  }));
  const accessHtmlSourceHash = computeLessonSourceHash(input.data.markdownContent, accessRefs);
  const accessRenderedHtml = buildAccessPlaceholderHtml(input.data.markdownContent, accessRefs);

  // A slug taken a moment ago by another lesson: the next free one.
  return retryOnUniqueViolation(
    async () => {
      const slug = await ensureUniqueLessonSlugForUpdate(
        input.curriculumVersionId,
        input.slugInput || input.data.title,
        lessonId
      );
      const data = {
        ...input.data,
        accessHtmlSourceHash,
        accessRenderedHtml,
        slug,
        revision: { increment: 1 },
      } satisfies Prisma.LessonUncheckedUpdateManyInput;

      return prisma.$transaction(async (transaction) => {
        let revision: number;
        if (loadedRevision !== null) {
          const guarded = await transaction.lesson.updateMany({
            where: { id: lessonId, revision: loadedRevision },
            data,
          });
          if (guarded.count === 0) {
            return null;
          }
          revision = loadedRevision + 1;
        } else {
          revision = (
            await transaction.lesson.update({ where: { id: lessonId }, data, select: { revision: true } })
          ).revision;
        }

        await transaction.lessonAssetReference.deleteMany({
          where: {
            lessonId,
          },
        });

        if (assetReferences.length > 0) {
          await transaction.lessonAssetReference.createMany({
            data: assetReferences.map((reference) => ({
              altText: reference.altText,
              assetId: reference.assetId ?? null,
              lessonId,
              position: reference.position,
              sourcePath: reference.sourcePath,
            })),
          });
        }

        // From proposed changes or for improvements: what each answers, recorded with this revision.
        // The drafts that went in are used; an improvement is done once every lesson it changes is.
        const recorded: Array<{ id: string; finished: Awaited<ReturnType<typeof finishImprovement>> }> = [];
        let next: { taskId: string; count: number } | null = null;
        for (const { later, ...change } of input.changes ?? []) {
          const id = (await recordLessonChange(transaction, { ...change, lessonId, revision })).id;
          if (change.proposalIds.length) {
            await transaction.aiProposal.updateMany({
              where: { id: { in: change.proposalIds }, status: AiProposalStatus.OPEN },
              data: { status: AiProposalStatus.USED, decidedAt: new Date() },
            });
          }
          recorded.push({ id, finished: change.taskId ? await finishImprovement(transaction, change.taskId) : null });
          // Feedback used after its changes were drafted: the lesson's next improvement.
          if (change.taskId && later?.length) {
            next = (await startNextImprovement(transaction, { fromTaskId: change.taskId, lessonId, commentIds: later, createdById: change.createdById })) ?? next;
          }
        }

        // PUBLISHED: learners get the new text (and the feedback it answers is done); DRAFT: they
        // keep the last published one. The status was just set, so publishing doesn't bump the
        // revision again.
        await applyLessonStatus(transaction, lessonId, input.data.status, input.publishedBy);
        const changes: SavedLessonChange[] = [];
        for (const { id, finished } of recorded) {
          const saved = await savedLessonChange(transaction, id, finished);
          if (saved) changes.push(saved);
        }
        return { revision, changes, next };
      });
    },
    { fields: ['slug'] }
  );
}

/** What several improvements' saves did for the main course, said once: changes waiting there add up. */
function combineCarries(first: CourseCarry | null, next: CourseCarry | null): CourseCarry | null {
  if (!first || !next) return first ?? next;
  if (first.kind === 'drafted' && next.kind === 'drafted') return { ...first, placed: first.placed + next.placed, unplaced: first.unplaced + next.unplaced };
  if (first.kind === 'drafted') return first;
  return next.kind === 'drafted' ? next : first;
}

export async function updateLessonInlineAction(
  formData: FormData
): Promise<LessonInlineActionResult> {
  const user = await requireUser();
  const t = await getTranslations('courses.actions');

  const courseId = getFormValue(formData, 'courseId');
  const lessonId = getFormValue(formData, 'lessonId');
  const title = getFormValue(formData, 'title');
  const slugInput = getFormValue(formData, 'slug');
  const status = getLessonStatusValue(formData);
  const markdownContent = String(formData.get('markdownContent') ?? '');

  if (!courseId || !lessonId) {
    return {
      message: t('selectCourse'),
      ok: false,
    };
  }

  if (!title) {
    return {
      message: t('lessonTitle'),
      ok: false,
    };
  }

  if (!markdownContent.trim()) {
    return {
      message: t('lessonMarkdown'),
      ok: false,
    };
  }

  const uploadedAssetBindings = await getUploadedAssetBindings(formData);
  const lesson = await prisma.lesson.findFirst({
    where: {
      courseId,
      id: lessonId,
    },
    select: {
      curriculumVersionId: true,
      id: true,
    },
  });

  // Courses section for any version; instructors only on their group curriculum.
  const viewer = lesson ? await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]) : null;

  if (!lesson || !viewer) {
    return {
      message: t('selectLesson'),
      ok: false,
    };
  }

  // New diagrams from AI drafts applied in Improve mode: stored now, bound with the save.
  if (!(await storeDraftDiagrams(formData, { lessonId: lesson.id, courseId, markdownContent, bindings: uploadedAssetBindings }))) {
    return {
      message: t('diagramNotSaved'),
      ok: false,
    };
  }

  const changes = await lessonChangesFromForm(formData, lesson.id, viewer, user.id);
  // Saved for an improvement by the lesson editor (a draft made for it, e.g. one carried over from a
  // group's copy): the text it had, to carry the changes to the main course if its plan says so (the
  // save is guarded by the loaded revision, so this is the text it replaces). The Improvements view
  // sends each improvement's own before and after.
  const editorImprovementId = changes.length === 1 && !changes[0].carry ? changes[0].taskId : null;
  const before = editorImprovementId
    ? ((await prisma.lesson.findUnique({ where: { id: lessonId }, select: { markdownContent: true } }))?.markdownContent ?? null)
    : null;
  const saved = await saveLessonWorkingCopy({
    lessonId,
    curriculumVersionId: lesson.curriculumVersionId,
    loadedRevision: getLoadedRevision(formData),
    slugInput,
    data: {
      title,
      status,
      markdownContent,
      shortDescription: getFormValue(formData, 'shortDescription') || null,
      arcId: await resolveLessonArcId(lesson.curriculumVersionId, getFormValue(formData, 'arcId')),
    },
    uploadedAssetBindings,
    publishedBy: user.id,
    changes: changes.map(({ carry: _carry, ...change }) => change),
  });

  // The lesson changed after it was opened (a sync from Obsidian, someone else's save): nothing was saved.
  if (saved === null) {
    return {
      message: t('lessonChanged'),
      ok: false,
    };
  }

  // A group's copy, for an improvement that also changes the main course: the same changes wait
  // there for review (or, for someone who can't edit the course, go to it as a suggestion).
  const organizationId = (await getCurrentUserSession())?.user.organization?.id;
  const carries = [
    ...changes.flatMap((change, index) => (change.taskId && change.carry ? [{ taskId: change.taskId, index, ...change.carry }] : [])),
    ...(editorImprovementId && before !== null ? [{ taskId: editorImprovementId, index: changes.length ? 0 : -1, before, after: markdownContent }] : []),
  ];
  let course: CourseCarry | null = null;
  for (const carry of organizationId ? carries : []) {
    const savedChange = carry.index >= 0 ? saved.changes[carry.index] : undefined;
    const carried = await carryToCourse({
      taskId: carry.taskId,
      lessonId,
      before: carry.before,
      after: carry.after,
      // Undo of this save takes the carry back.
      changeId: savedChange?.id ?? null,
      viewer,
      userId: user.id,
      organizationId: organizationId as string,
    });
    course = combineCarries(course, carried);
    if (carried?.kind === 'suggested' && savedChange && !savedChange.task) {
      // The course's part is its suggestion's now: this may have been the improvement's last lesson.
      const moved = await finishImprovement(prisma, carry.taskId);
      if (moved) savedChange.task = { id: moved.taskId, title: moved.title, from: moved.from };
    }
  }
  const touched = Array.from(new Set([...changes.flatMap((change) => (change.taskId ? [change.taskId] : [])), ...(editorImprovementId ? [editorImprovementId] : [])]));
  await workHere(prisma, touched);
  if (touched.length) revalidatePath('/admin/tasks');
  for (const taskId of touched) revalidatePath(`/admin/tasks/${taskId}`);

  revalidatePath('/admin');
  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/admin/courses/${courseId}/versions/${lesson.curriculumVersionId}`);
  revalidatePath(`/admin/courses/${courseId}/lessons/${lessonId}`);

  return {
    lessonId,
    message: t('lessonUpdated'),
    ok: true,
    revision: saved.revision,
    change: saved.changes[0] ?? null,
    changes: saved.changes,
    course,
    next: saved.next,
  };
}

export async function updateLessonAction(formData: FormData) {
  const user = await requireUser();

  const courseId = getFormValue(formData, 'courseId');
  const lessonId = getFormValue(formData, 'lessonId');
  const title = getFormValue(formData, 'title');
  const slugInput = getFormValue(formData, 'slug');
  const status = getLessonStatusValue(formData);
  const markdownContent = String(formData.get('markdownContent') ?? '');
  const lessonEditorPath = `/admin/courses/${courseId}/lessons/${lessonId}`;

  if (!courseId || !lessonId) {
    redirect('/admin/courses?error=lesson-course');
  }

  if (!title) {
    redirect(`${lessonEditorPath}?error=lesson-title`);
  }

  if (!markdownContent.trim()) {
    redirect(`${lessonEditorPath}?error=lesson-markdown`);
  }

  const uploadedAssetBindings = await getUploadedAssetBindings(formData);
  const lesson = await prisma.lesson.findFirst({
    where: {
      courseId,
      id: lessonId,
    },
    select: {
      curriculumVersionId: true,
      id: true,
    },
  });

  // Courses section for any version; instructors only on their group curriculum.
  if (lesson) {
    await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]);
  }

  if (!lesson) {
    redirect(`/admin/courses/${courseId}`);
  }

  const saved = await saveLessonWorkingCopy({
    lessonId,
    curriculumVersionId: lesson.curriculumVersionId,
    loadedRevision: getLoadedRevision(formData),
    slugInput,
    data: {
      title,
      status,
      markdownContent,
      shortDescription: getFormValue(formData, 'shortDescription') || null,
      arcId: await resolveLessonArcId(lesson.curriculumVersionId, getFormValue(formData, 'arcId')),
    },
    uploadedAssetBindings,
    publishedBy: user.id,
  });

  if (saved === null) {
    redirect(`${lessonEditorPath}?error=lesson-changed`);
  }

  revalidatePath('/admin');
  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/admin/courses/${courseId}/versions/${lesson.curriculumVersionId}`);
  revalidatePath(`/admin/courses/${courseId}/lessons/${lessonId}`);

  redirect(
    `/admin/courses/${courseId}/versions/${lesson.curriculumVersionId}?lesson=${lessonId}&status=lesson-updated`
  );
}

export type DeleteLessonResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Permanently deletes a lesson (cascading its asset references) and compacts the remaining
 * lessons' positions so numbering stays gap-free (`deleteLesson`).
 */
export async function deleteLessonInlineAction(
  formData: FormData
): Promise<DeleteLessonResult> {
  await requireUser();
  const t = await getTranslations('courses.actions');

  const courseId = getFormValue(formData, 'courseId');
  const lessonId = getFormValue(formData, 'lessonId');

  if (!courseId || !lessonId) {
    return { ok: false, message: t('selectLesson') };
  }

  const lesson = await prisma.lesson.findFirst({
    where: {
      courseId,
      id: lessonId,
    },
    select: {
      curriculumVersionId: true,
      position: true,
    },
  });

  // Courses section for any version; instructors only on their group curriculum.
  if (lesson) {
    await requireVersionEdit(lesson.curriculumVersionId, [Permission.DELETE]);
  }

  if (!lesson) {
    return { ok: false, message: t('selectLesson') };
  }

  await prisma.$transaction((transaction) =>
    deleteLesson(transaction, { id: lessonId, curriculumVersionId: lesson.curriculumVersionId, position: lesson.position })
  );

  revalidatePath('/admin');
  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/admin/courses/${courseId}/versions/${lesson.curriculumVersionId}`);

  return { ok: true, message: t('lessonDeleted') };
}
