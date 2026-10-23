import Link from 'next/link';
import type { IconType } from 'react-icons';
import styles from '../../admin.module.css';

export type AdminTab = {
  href: string;
  label: string;
  Icon?: IconType;
  active: boolean;
};

/** A page's own tabs (Settings, a course): the same underlined strip as the course section tabs. */
export default function AdminTabs({ tabs, label }: { tabs: AdminTab[]; label: string }) {
  return (
    <section className={styles.sectionNav}>
      <nav className={styles.sectionNavList} aria-label={label}>
        {tabs.map(({ href, label: tabLabel, Icon, active }) => (
          <Link
            key={href}
            href={href}
            prefetch
            className={active ? styles.sectionNavLinkActive : styles.sectionNavLink}
            aria-current={active ? 'page' : undefined}
          >
            {Icon ? <Icon aria-hidden className={styles.sectionNavItemIcon} size={17} /> : null}
            {tabLabel}
          </Link>
        ))}
      </nav>
    </section>
  );
}
