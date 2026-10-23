import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { OrgRole } from '@prisma/client';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { displayName, requireOrgAdmin } from '@/lib/admin-auth';
import { serverExtensions } from '@/extensions/server';
import { listTeam } from '@/lib/organizations';
import {
  describeAccess,
  getMemberAccessViews,
  inviteAccessView,
  listAccessOptions,
  type AccessView,
} from '@/lib/member-access';
import type { AccessInput } from '@/lib/access-describe';
import AdminFrame from '../components/AdminFrame';
import AdminBadge from '../components/ui/AdminBadge';
import AdminButton from '../components/ui/AdminButton';
import AdminSectionCard from '../components/ui/AdminSectionCard';
import { SheetButton } from '../components/ui/Sheet';
import { adminNavItems } from '../nav';
import { revokeInviteAction } from './actions';
import { InviteForm, MemberControls } from './TeamForms';
import styles from '../admin.module.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('account.team'))('metaTitle') };
}
export const dynamic = 'force-dynamic';

function formatDate(date: Date, locale: Locale) {
  return date.toLocaleDateString(INTL_LOCALES[locale], { day: 'numeric', month: 'short', year: 'numeric' });
}

/** What the Access dialog starts from: the member's preset, or nothing to start from (custom, none). */
function editorStart(view: AccessView | undefined): AccessInput | null {
  if (!view || view.kind === 'full') return { kind: 'full' };
  return typeof view.preset === 'string' ? null : { kind: 'limited', preset: view.preset };
}

export default async function TeamPage() {
  const viewer = await requireOrgAdmin();
  const locale = (await getLocale()) as Locale;
  const [t, accessWords] = await Promise.all([getTranslations('account.team'), getTranslations('account.access')]);
  const { members, invites } = await listTeam(viewer.organization.id);
  const [accessOptions, accessViews] = await Promise.all([
    listAccessOptions(viewer.organization.id),
    getMemberAccessViews(
      viewer.organization.id,
      members.map((member) => ({ userId: member.user.id, role: member.role, access: member.access }))
    ),
  ]);
  const isOwner = viewer.orgRole === OrgRole.OWNER;
  const { team } = serverExtensions;
  const words = await team.words(locale);
  const inviteRoles = team.inviteRoles.map((role) => ({ value: role, ...words.roles[role] }));
  // Roles someone can be changed to: owners only by an owner.
  const roleOptions = team.roleChanges
    ? (['OWNER', 'ADMIN', 'MEMBER'] as const)
        .filter((role) => role !== OrgRole.OWNER || isOwner)
        .map((role) => ({ value: role, label: words.roles[role].label }))
    : null;

  return (
    <AdminFrame
      navItems={adminNavItems('team')}
      eyebrow={t('eyebrow')}
      title={viewer.organization.name}
      description={words.description}
    >
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        {/* Inviting is now and then: a sheet from the members' card (as a course's New version). */}
        <AdminSectionCard
          kicker={t('members.kicker')}
          title={t('members.title', { count: members.length })}
          kickerAction={
            <SheetButton label={t('invite.button')} title={t('invite.title')} testId="team-invite">
              <p className={styles.fieldHint} style={{ marginTop: 0 }}>
                {t('invite.intro')}
              </p>
              <InviteForm roles={inviteRoles} accessOptions={accessOptions} />
            </SheetButton>
          }
        >
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.75rem' }} data-testid="team-members">
            {members.map((member) => {
              const isSelf = member.user.id === viewer.id;
              const canEdit = !isSelf && (isOwner || member.role !== OrgRole.OWNER);
              return (
                <li
                  key={member.id}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    gap: '0.5rem 1rem',
                    alignItems: 'center',
                    paddingBottom: '0.75rem',
                    borderBottom: '1px solid rgba(var(--foreground-rgb), 0.08)',
                  }}
                >
                  <div style={{ display: 'grid', gap: '0.2rem', minWidth: 0, overflowWrap: 'anywhere' }}>
                    <strong>
                      {displayName(member.user)} {isSelf ? <span className={styles.fieldHint}>{t('members.you')}</span> : null}
                    </strong>
                    <span className={styles.fieldHint}>
                      {t('members.lastSignedIn', {
                        email: member.user.email ?? member.user.identifier,
                        date: member.user.lastLoginAt ? formatDate(member.user.lastLoginAt, locale) : t('members.never'),
                      })}
                    </span>
                    <span className={styles.fieldHint} data-testid="member-access">
                      {describeAccess(accessViews.get(member.user.id) ?? { kind: 'full' }, accessOptions, accessWords)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <AdminBadge variant={member.role === OrgRole.MEMBER ? 'muted' : 'accent'}>
                      {words.roles[member.role].label}
                    </AdminBadge>
                    <MemberControls
                      memberId={member.id}
                      memberName={displayName(member.user)}
                      organizationName={viewer.organization.name}
                      role={member.role}
                      canEdit={canEdit}
                      roleOptions={roleOptions}
                      access={editorStart(accessViews.get(member.user.id))}
                      accessOptions={accessOptions}
                      accessNote={
                        accessViews.get(member.user.id)?.kind === 'limited' && (accessViews.get(member.user.id) as { preset: unknown }).preset === 'custom'
                          ? t('members.customAccess')
                          : null
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </AdminSectionCard>

        {invites.length > 0 ? (
          <AdminSectionCard kicker={t('invites.kicker')} title={t('invites.title', { count: invites.length })}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.6rem' }}>
              {invites.map((invite) => (
                <li key={invite.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.5rem 1rem', alignItems: 'center' }}>
                  <span>
                    {invite.label} · {words.roles[invite.orgRole].label}{' '}
                    <span className={styles.fieldHint}>
                      ·{' '}
                      {t('invites.details', {
                        access: describeAccess(inviteAccessView(invite), accessOptions, accessWords),
                        date: formatDate(invite.expiresAt, locale),
                      })}
                    </span>
                  </span>
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="inviteId" value={invite.id} />
                    <AdminButton type="submit" tone="secondary" size="compact">
                      {t('invites.withdraw')}
                    </AdminButton>
                  </form>
                </li>
              ))}
            </ul>
          </AdminSectionCard>
        ) : null}
      </div>
    </AdminFrame>
  );
}
