/* eslint-disable @next/next/no-img-element */
import { useTranslations } from 'next-intl';
import { TbBook2, TbHome, TbShieldCheck, TbUsersGroup } from 'react-icons/tb';
import BrandName from '@/components/BrandName';
import { ui } from '@/extensions/ui';
import styles from '../admin.module.css';

interface AdminSkeletonProps {
  /** Show the Courses / Groups / Feedback section nav (course management area). */
  showSectionNav?: boolean;
  /** Number of placeholder content cards. */
  cards?: number;
  /** The platform admin's pages: their own sidebar (`ui.platformNav`), never an organisation's. */
  platform?: boolean;
}

function Bar({ width, height = '0.8rem', radius = 8 }: { width: string; height?: string; radius?: number }) {
  return (
    <span
      className={styles.skeletonBlock}
      style={{ display: 'block', width, height, borderRadius: radius }}
    />
  );
}

/**
 * Instant loading fallback for `/admin/*` routes. Renders the same persistent chrome
 * (sidebar + optional section nav) as the real pages so client navigations stream in
 * content without the shell flashing away. In the reader's language, like the frame (`app`).
 */
export default function AdminSkeleton({ showSectionNav = false, cards = 2, platform = false }: AdminSkeletonProps) {
  // Not async: a loading fallback must render at once (next-intl's hook works in server components).
  const t = useTranslations('app');
  return (
    <div className={`${styles.page} ${styles.appLayout}`} aria-busy="true" aria-label={t('frame.loading')}>
      <aside className={platform ? `${styles.sidebar} ${styles.sidebarPlatform}` : styles.sidebar} aria-hidden="true">
        <div className={styles.sidebarTop}>
          <span className={styles.sidebarBrand}>
            <span className={styles.sidebarBrandFull}>
              <BrandName />
            </span>
            <img src="/brand/chalkenso-enso.svg" alt="" className={styles.sidebarBrandMark} />
          </span>
        </div>
        {platform ? (
          <>
            <div className={styles.sidebarOrg}>
              <div className={styles.platformMark}>
                <span className={styles.platformMarkIcon}>
                  <TbShieldCheck size={17} />
                </span>
                <span className={styles.platformMarkText}>
                  <strong>{t('frame.platformAdmin')}</strong>
                </span>
              </div>
            </div>
            <nav className={styles.sideNav}>
              {ui.platformNav.map((group) => (
                <div key={group.label ?? 'top'} className={styles.sideNavGroup}>
                  {group.label ? <span className={styles.sideNavHeading}>{t(`nav.platform.headings.${group.label}`)}</span> : null}
                  {group.items.map((item) => (
                    <span key={item.href} className={styles.sideNavLink}>
                      <item.icon size={18} />
                      <span className={styles.sideNavLabel}>{t(`nav.platform.items.${item.label}`)}</span>
                    </span>
                  ))}
                </div>
              ))}
            </nav>
          </>
        ) : (
          <>
            <div className={styles.sidebarOrg}>
              <Bar width="100%" height="2.4rem" radius={10} />
            </div>
            <nav className={styles.sideNav}>
              {(
                [
                  { label: 'overview', Icon: TbHome },
                  { label: 'groups', Icon: TbUsersGroup },
                  { label: 'courses', Icon: TbBook2 },
                ] as const
              ).map(({ label, Icon }) => (
                <span key={label} className={styles.sideNavLink}>
                  <Icon size={18} />
                  <span className={styles.sideNavLabel}>{t(`nav.places.${label}`)}</span>
                </span>
              ))}
            </nav>
          </>
        )}
      </aside>

      <main className={styles.main}>
        <div className={styles.shell}>
          {showSectionNav ? (
            <section className={styles.sectionNav} aria-hidden="true">
              <nav className={styles.sectionNavList}>
                <span className={styles.sectionNavLink}>{t('nav.places.courses')}</span>
                <span className={styles.sectionNavLink}>{t('nav.places.groups')}</span>
                <span className={styles.sectionNavLink}>{t('nav.course.tabs.feedback')}</span>
              </nav>
            </section>
          ) : null}

          <div className={styles.coursePageContext} aria-hidden="true">
            <div className={styles.coursePageContextRow}>
              <div className={styles.coursePageContextLead} style={{ display: 'grid', gap: '0.55rem' }}>
                <Bar width="6rem" />
                <Bar width="13rem" height="1.3rem" radius={10} />
              </div>
            </div>
          </div>

          <div className={styles.editorPageSection} aria-hidden="true">
            {Array.from({ length: cards }).map((_, index) => (
              <div key={index} className={styles.skeletonCard}>
                <Bar width="30%" height="0.75rem" />
                <Bar width="100%" height="2.4rem" radius={12} />
                <Bar width="100%" height="2.4rem" radius={12} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
