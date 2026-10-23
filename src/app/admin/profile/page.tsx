import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import CourseManagementFrame from '../courses/components/CourseManagementFrame';
import HandleField from '../components/HandleField';
import AdminField from '../components/ui/AdminField';
import { SheetInfoRow, SheetRow, SheetRows } from '../components/ui/Sheet';
import { ProfileDetailsForm, ProfileNameFields } from './components/ProfileDetailsSection';
import ProfileImageSection from './components/ProfileImageSection';
import SessionsSection from './components/SessionsSection';
import TwoFactorAuthSection from './components/TwoFactorAuthSection';
import { UserRole } from '@prisma/client';
import { mustSetUpTwoFactor, requireUser } from '@/lib/admin-auth';
import AdminNotice from '../components/ui/AdminNotice';
import { prisma } from '@/lib/prisma';
import { getAdminProfileImageUrl } from '@/lib/profile-image';
import styles from '../admin.module.css';
import { ui } from '@/extensions/ui';

/** The account's kind, as the details' footer says it (`account.profile.details.roles`). */
const ROLE_KEYS = { SUPERADMIN: 'superadmin', USER: 'user' } as const;

/**
 * The person's Profile, as Apple's account page: their details as rows with their value, each
 * opening a sheet saved on its own; two-factor as a row (its steps are dialogs); then where they're
 * signed in, a device list.
 */
export default async function AdminProfilePage() {
  const session = await requireUser({ allowWithoutTwoFactor: true });
  const [t, details, twoFactor, tHow] = await Promise.all([
    getTranslations('account.profile.page'),
    getTranslations('account.profile.details'),
    getTranslations('account.profile.twoFactor'),
    getTranslations('app.howItWorks'),
  ]);
  const isSuperAdmin = session.role === UserRole.SUPERADMIN;
  const needsTwoFactor = mustSetUpTwoFactor(session);

  const row = await prisma.user.findUnique({
    where: {
      id: session.id,
    },
    select: {
      email: true,
      firstName: true,
      handle: true,
      identifier: true,
      lastName: true,
      profileImageKey: true,
      role: true,
      totpEnabled: true,
    },
  });

  const profileImageUrl = getAdminProfileImageUrl(row?.profileImageKey);
  const fullName = [row?.firstName, row?.lastName].filter(Boolean).join(' ');
  const none = details('none');

  return (
    <CourseManagementFrame
      accountPageActive
      highlightCourseManagementTab={false}
      activeSection="courses"
      notice={
        needsTwoFactor ? (
          <AdminNotice className={styles.statusNotice} variant="banner">
            {t('twoFactorRequired')}
          </AdminNotice>
        ) : null
      }
      pageContext={{
        back: isSuperAdmin ? { href: '/admin/platform', label: t('back') } : undefined,
        subtitle: t('subtitle'),
        title: t('title'),
      }}
    >
      <section className={styles.editorPageSection}>
        <SheetRows
          title={t('details')}
          footer={[
            details('signedInAs', { identifier: row?.identifier ?? '' }),
            row && row.role in ROLE_KEYS ? details(`roles.${ROLE_KEYS[row.role as keyof typeof ROLE_KEYS]}`) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          testId="profile-details"
        >
          <SheetRow label={details('name')} value={fullName || none} testId="profile-name-row">
            <ProfileDetailsForm>
              <ProfileNameFields initialFirstName={row?.firstName ?? ''} initialLastName={row?.lastName ?? ''} />
            </ProfileDetailsForm>
          </SheetRow>
          <SheetRow label={details('handleRow')} value={row?.handle ? `@${row.handle}` : none} testId="profile-handle-row">
            <ProfileDetailsForm>
              <HandleField
                id="profile-handle"
                name="handle"
                label={details('handle')}
                from={fullName}
                initial={row?.handle || undefined}
                hint={details('handleHint')}
              />
            </ProfileDetailsForm>
          </SheetRow>
          <SheetRow label={details('emailRow')} value={row?.email || none} testId="profile-email-row">
            <ProfileDetailsForm>
              <AdminField
                id="profile-email"
                name="email"
                type="email"
                label={details('email')}
                hint={details('emailHint')}
                placeholder={details('emailPlaceholder')}
                defaultValue={row?.email ?? ''}
              />
            </ProfileDetailsForm>
          </SheetRow>
          <SheetRow
            label={t('photoRow')}
            title={t('photo')}
            value={
              profileImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profileImageUrl} alt="" className={styles.profileRowPhoto} />
              ) : (
                none
              )
            }
            testId="profile-photo-row"
          >
            <ProfileImageSection currentImageUrl={profileImageUrl} />
          </SheetRow>
        </SheetRows>

        <SheetRows footer={row?.totpEnabled ? twoFactor('on') : twoFactor('off')} testId="profile-security">
          <TwoFactorAuthSection totpEnabled={Boolean(row?.totpEnabled)} required={false} />
        </SheetRows>
      </section>
      <SessionsSection />
      {/* How Chalkenso works, any time after Home's card for newcomers (for people in an organisation). */}
      {session.organization ? (
        <section className={styles.editorPageSection}>
          <SheetRows testId="profile-how-it-works">
            <SheetInfoRow label={tHow('title')} value={<Link href="/admin/how-it-works">{tHow('profileOpen')}</Link>} />
          </SheetRows>
        </section>
      ) : null}
      {ui.ProfilePanels ? <ui.ProfilePanels userId={session.id} /> : null}
    </CourseManagementFrame>
  );
}
