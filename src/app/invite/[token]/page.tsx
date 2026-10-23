import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { acceptInviteAction } from '@/app/admin/actions';
import AuthShell from '@/app/admin/components/AuthShell';
import AdminSubmitButton from '@/app/admin/components/ui/AdminSubmitButton';
import { serverExtensions } from '@/extensions/server';
import type { Locale } from '@/i18n/config';
import { displayName, getCurrentUserSession } from '@/lib/admin-auth';
import { findPendingInvite, MIN_PASSWORD_LENGTH } from '@/lib/organizations';
import { type AccessScope, inviteAccess } from '@/lib/access-describe';
import { inviteAccessView, listAccessOptions } from '@/lib/member-access';
import { withoutOrgScope } from '@/lib/org-context';
import { prisma } from '@/lib/prisma';
import styles from '@/app/admin/admin.module.css';
import InviteSignupForm from './InviteSignupForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.invite');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}


/**
 * An invite link: signed-in people join with one click; everyone else creates an account (or
 * signs in and comes back). Dead links all show the same neutral message.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  // Joining was refused because the team has no free seat (the invite itself is still good).
  const teamFull = (await searchParams).error === 'full';
  const [invite, session] = await Promise.all([findPendingInvite(token), getCurrentUserSession()]);
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations('auth');

  if (!invite) {
    return (
      <AuthShell
        title={t('invite.invalid.title')}
        intro={t('invite.invalid.intro')}
        footer={t.rich('links.haveAccount', { link: (chunks: ReactNode) => <Link href="/admin/login">{chunks}</Link> })}
      >
        <span />
      </AuthShell>
    );
  }

  // What they will reach (the invite's organisation, read outside the visitor's own organisation).
  const organizationId = invite.organization.id;
  const view = inviteAccessView(invite);
  const access = view.kind === 'full' ? null : inviteAccess(view, await withoutOrgScope(() => listAccessOptions(organizationId)));
  // Where it reaches, in words: "every course", "Web Development II and Python", "A, B and 2 more".
  const scopeWords = (scope: AccessScope) => {
    if (scope.kind === 'all-courses') return t('invite.access.everyCourse');
    const removed = scope.kind === 'courses' ? t('invite.access.removedCourse') : t('invite.access.removedGroup');
    const names = scope.names.map((name) => name ?? removed);
    if (!names.length) return scope.kind === 'courses' ? t('invite.access.noCourse') : t('invite.access.noGroup');
    if (names.length === 1) return names[0];
    if (names.length === 2) return t('invite.access.two', { first: names[0], second: names[1] });
    return t('invite.access.more', { first: names[0], second: names[1], count: names.length - 2 });
  };
  // From a group's page: the group they'll teach.
  const teaches = invite.teachesGroupId
    ? await withoutOrgScope(() =>
        prisma.courseGroup.findFirst({
          where: { id: invite.teachesGroupId ?? '', course: { organizationId } },
          select: { name: true, course: { select: { title: true } } },
        })
      )
    : null;
  const organization = invite.organization.name;
  const intro = teaches
    ? t('invite.introTeach', { group: teaches.name, course: teaches.course.title, organization })
    : t('invite.introJoin', {
        organization,
        role: (await serverExtensions.team.rolesInSentence(locale))[invite.orgRole],
        lessons: access?.lessons ?? 'full',
        scope: access ? scopeWords(access.scope) : '',
      });

  if (session) {
    // Someone already on the team keeps their role and access.
    const alreadyMember = Boolean(
      await withoutOrgScope(() =>
        prisma.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId, userId: session.user.id } },
          select: { id: true },
        })
      )
    );
    return (
      <AuthShell kicker={t('invite.kicker')} title={t('invite.title', { organization })} intro={intro}>
        <form action={acceptInviteAction} className={styles.loginForm}>
          <input type="hidden" name="token" value={token} />
          {teamFull ? (
            <p className={styles.fieldHint} style={{ margin: 0, fontWeight: 600 }} data-testid="invite-team-full">
              {t('invite.teamFull')}
            </p>
          ) : null}
          <p className={styles.fieldHint} style={{ margin: 0 }}>
            {t('invite.signedInAs', { name: displayName(session.user) })}
            {alreadyMember
              ? ` ${teaches ? t('invite.alreadyMemberTeach', { group: teaches.name }) : t('invite.alreadyMember')}`
              : ''}
          </p>
          <AdminSubmitButton fullWidth pendingText={t('invite.joining')}>
            {t('invite.join', { organization })}
          </AdminSubmitButton>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      kicker={t('invite.kicker')}
      title={t('invite.title', { organization })}
      intro={intro}
      footer={t.rich('invite.signInToJoin', {
        link: (chunks: ReactNode) => <Link href={`/admin/login?next=${encodeURIComponent(`/invite/${token}`)}`}>{chunks}</Link>,
      })}
    >
      <InviteSignupForm token={token} minPasswordLength={MIN_PASSWORD_LENGTH} />
    </AuthShell>
  );
}
