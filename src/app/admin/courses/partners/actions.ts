'use server';

import { Permission } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverExtensions } from '@/extensions/server';
import { requireSection } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

const PARTNERS_PATH = '/admin/courses/partners';

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

/** The partner's fields from the form; null when the website or logo isn't an http(s) URL. */
function getPartnerFields(formData: FormData) {
  const websiteUrl = getFormValue(formData, 'websiteUrl');
  const logoUrl = getFormValue(formData, 'logoUrl');
  if ((websiteUrl && !isHttpUrl(websiteUrl)) || (logoUrl && !isHttpUrl(logoUrl))) {
    return null;
  }
  return {
    name: getFormValue(formData, 'name'),
    websiteUrl: websiteUrl || null,
    logoUrl: logoUrl || null,
    description: getFormValue(formData, 'description') || null,
  };
}

/** Names are unique within the organisation (the query is scoped to it). */
async function findPartnerByName(name: string) {
  return prisma.partner.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
}

/** Courses that show the partner: as a course partner, through a group, or on the join button. */
async function coursesUsingPartner(partnerId: string) {
  const courses = await prisma.course.findMany({
    where: {
      OR: [
        { joinPartnerId: partnerId },
        { partners: { some: { partnerId } } },
        { groups: { some: { partners: { some: { partnerId } } } } },
      ],
    },
    select: { id: true },
  });
  return courses.map((course) => course.id);
}

function revalidatePartners(partnerId?: string) {
  revalidatePath('/admin/courses', 'layout');
  revalidatePath(PARTNERS_PATH);
  if (partnerId) {
    revalidatePath(`${PARTNERS_PATH}/${partnerId}`);
  }
}

export async function createPartnerAction(formData: FormData) {
  const viewer = await requireSection('courses', [Permission.WRITE]);
  const newPath = `${PARTNERS_PATH}/new`;

  const fields = getPartnerFields(formData);
  if (!fields) {
    redirect(`${newPath}?error=partner-url`);
  }
  if (!fields.name) {
    redirect(`${newPath}?error=partner-name`);
  }
  if (await findPartnerByName(fields.name)) {
    redirect(`${newPath}?error=partner-name-taken`);
  }

  const partner = await prisma.partner.create({
    data: { organizationId: viewer.organization.id, ...fields },
    select: { id: true },
  });

  revalidatePartners();
  redirect(`${PARTNERS_PATH}/${partner.id}?status=partner-created`);
}

export async function updatePartnerAction(formData: FormData) {
  await requireSection('courses', [Permission.WRITE]);

  const partnerId = getFormValue(formData, 'partnerId');
  const editPath = `${PARTNERS_PATH}/${partnerId}`;

  const partner = partnerId
    ? await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } })
    : null;
  if (!partner) {
    redirect(`${PARTNERS_PATH}?error=partner-not-found`);
  }

  const fields = getPartnerFields(formData);
  if (!fields) {
    redirect(`${editPath}?error=partner-url`);
  }
  if (!fields.name) {
    redirect(`${editPath}?error=partner-name`);
  }
  const sameName = await findPartnerByName(fields.name);
  if (sameName && sameName.id !== partnerId) {
    redirect(`${editPath}?error=partner-name-taken`);
  }

  await prisma.partner.update({ where: { id: partnerId }, data: fields });
  // Learner pages and the organisation's website show the partner with the courses that use it.
  serverExtensions.onCourseUpdated(await coursesUsingPartner(partnerId));

  revalidatePartners(partnerId);
  redirect(`${editPath}?status=partner-updated`);
}

/** Deletes a partner: courses and groups stop listing it, and join buttons that led to it fall back. */
export async function deletePartnerAction(formData: FormData) {
  await requireSection('courses', [Permission.DELETE]);

  const partnerId = getFormValue(formData, 'partnerId');
  const partner = partnerId
    ? await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } })
    : null;
  if (!partner) {
    redirect(`${PARTNERS_PATH}?error=partner-not-found`);
  }

  const courseIds = await coursesUsingPartner(partnerId);
  // Course and group links cascade; a join button pointing here goes back to the site default.
  await prisma.$transaction([
    prisma.course.updateMany({
      where: { joinPartnerId: partnerId, joinTarget: 'PARTNER' },
      data: { joinTarget: 'LINKEDIN' },
    }),
    prisma.partner.delete({ where: { id: partnerId } }),
  ]);
  serverExtensions.onCourseUpdated(courseIds);

  revalidatePartners();
  redirect(`${PARTNERS_PATH}?status=partner-deleted`);
}
