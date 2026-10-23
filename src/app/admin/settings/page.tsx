import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrgRole } from '@prisma/client';
import { ui } from '@/extensions/ui';
import { redirect } from 'next/navigation';
import { isOrgAdmin, requireMember, requireOrgAdmin } from '@/lib/admin-auth';
import { getOrganizationLogoUrl } from '@/lib/organization-logo';
import { prisma } from '@/lib/prisma';
import { SettingsBlock, SettingsGroup } from './ui/SettingsList';
import SettingsFrame from './SettingsFrame';
import { OrganizationIdentityForm, OrganizationNameForm } from './SettingsForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('account.settings.general'))('metaTitle') };
}
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  // Members who aren't owners or admins have Settings too (General is the organisation's): from the
  // edition's first tab for everyone, else from Tokens.
  const member = await requireMember();
  if (!isOrgAdmin(member)) redirect(ui.settingsTabs.find((tab) => tab.members)?.href ?? '/admin/api-tokens');
  const viewer = await requireOrgAdmin();
  const t = await getTranslations('account.settings.general');
  const identity = await prisma.organization.findUnique({
    where: { id: viewer.organization.id },
    select: { logoKey: true, iconName: true, iconColor: true },
  });
  return (
    <SettingsFrame active="general" title={t('title')} description={t('description')}>
      <SettingsGroup title={t('organization')}>
        <SettingsBlock>
          <OrganizationNameForm name={viewer.organization.name} />
        </SettingsBlock>
      </SettingsGroup>
      <SettingsGroup title={t('lookTitle')}>
        <SettingsBlock>
          <OrganizationIdentityForm
          org={{
            id: viewer.organization.id,
            name: viewer.organization.name,
            logoUrl: getOrganizationLogoUrl(viewer.organization.id, identity?.logoKey),
            iconName: identity?.iconName ?? null,
            iconColor: identity?.iconColor ?? null,
          }}
          />
        </SettingsBlock>
      </SettingsGroup>
      {ui.SettingsGeneralPanels ? (
        <ui.SettingsGeneralPanels organizationId={viewer.organization.id} isOwner={viewer.orgRole === OrgRole.OWNER} />
      ) : null}
    </SettingsFrame>
  );
}
