/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from 'react';
import type { IconType } from 'react-icons';
import { TbBook2, TbBuilding, TbBulb, TbCertificate, TbCode, TbRocket, TbSchool, TbUsersGroup } from 'react-icons/tb';
import { organizationIdentity, type OrgIconKey } from '@/lib/organization-identity';
import styles from '../admin.module.css';

export const ORG_ICON_COMPONENTS: Record<OrgIconKey, IconType> = {
  building: TbBuilding,
  school: TbSchool,
  book: TbBook2,
  certificate: TbCertificate,
  code: TbCode,
  bulb: TbBulb,
  rocket: TbRocket,
  users: TbUsersGroup,
};

export type OrgBadgeData = { id: string; name: string; logoUrl: string | null; iconName?: string | null; iconColor?: string | null };

/** An organisation's logo, or its icon on its colour: the sidebar card, the switcher, Settings. */
export default function OrgBadge({ org, size = 36 }: { org: OrgBadgeData; size?: number }) {
  if (org.logoUrl) {
    return (
      <span className={styles.orgBadge} style={{ width: size, height: size }} data-testid="org-badge">
        <img src={org.logoUrl} alt="" className={styles.orgBadgeLogo} />
      </span>
    );
  }
  const { icon, rgb } = organizationIdentity(org);
  const Icon = ORG_ICON_COMPONENTS[icon];
  return (
    <span
      className={styles.orgBadge}
      style={{ width: size, height: size, '--org-rgb': rgb } as CSSProperties}
      data-testid="org-badge"
      data-icon={icon}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.56)} />
    </span>
  );
}
