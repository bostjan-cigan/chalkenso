import Link from 'next/link';
import AdminBadge from '../../components/ui/AdminBadge';
import AdminButton from '../../components/ui/AdminButton';
import styles from '../../admin.module.css';

export type CoursePageContextAction = {
  href: string;
  label: string;
  tone?: 'primary' | 'secondary';
};

export type CoursePageContextBadge = {
  label: string;
  variant?: 'accent' | 'warning' | 'muted' | 'kicker' | 'inactive';
};

export type CoursePageContextProps = {
  title: string;
  subtitle?: string;
  /** Optional status pill shown next to the title (e.g. Draft / Published). */
  badge?: CoursePageContextBadge;
  back?: { href: string; label: string };
  actions?: CoursePageContextAction[];
};

export default function CourseManagementPageContext({
  title,
  subtitle,
  badge,
  back,
  actions = [],
}: CoursePageContextProps) {
  return (
    <div className={styles.coursePageContext}>
      <div className={styles.coursePageContextRow}>
        <div className={styles.coursePageContextLead}>
          {back ? (
            <Link href={back.href} className={styles.coursePageContextBack}>
              <span className={styles.coursePageContextBackCaret} aria-hidden="true">
                &lt;
              </span>
              {back.label}
            </Link>
          ) : null}
          <div className={styles.coursePageContextTitleRow}>
            <h1 className={styles.coursePageContextTitle}>{title}</h1>
            {badge ? <AdminBadge variant={badge.variant}>{badge.label}</AdminBadge> : null}
          </div>
          {subtitle ? <p className={styles.coursePageContextSubtitle}>{subtitle}</p> : null}
        </div>
        {actions.length > 0 ? (
          <div className={styles.coursePageContextActions}>
            {actions.map((action) => (
              <AdminButton
                key={`${action.href}-${action.label}`}
                href={action.href}
                tone={action.tone ?? 'secondary'}
              >
                {action.label}
              </AdminButton>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
