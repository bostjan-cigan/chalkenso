import Link from 'next/link';
import styles from '../../admin.module.css';

/** Where the export is (Settings → Export). */
export const EXPORT_PAGE = '/admin/settings/export';

/**
 * "Download everything first": a quiet link to Settings → Export, next to what ends an
 * organisation's time here (cancelling the plan, deleting the organisation). Works in server and
 * client components: the caller gives the words (`account.export.downloadFirst`).
 */
export default function ExportFirstLink({ label }: { label: string }) {
  return (
    <p className={styles.fieldHint} style={{ margin: 0 }}>
      <Link
        href={EXPORT_PAGE}
        style={{ display: 'inline-flex', alignItems: 'center', minHeight: 'var(--touch-target, auto)', color: 'rgb(var(--accent-color))' }}
        data-testid="export-first"
      >
        {label}
      </Link>
    </p>
  );
}
