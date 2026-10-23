import { useTranslations } from 'next-intl';
import adminStyles from '@/app/admin/admin.module.css';

function Bar({
  width,
  height = '0.8rem',
  radius = 8,
}: {
  width: string;
  height?: string;
  radius?: number;
}) {
  return (
    <span
      className={adminStyles.skeletonBlock}
      style={{ display: 'block', width, height, borderRadius: radius }}
    />
  );
}

/**
 * Stand-in for a drawer's body while its record is still loading. Shaped like every detail panel
 * — avatar-sized mark, title and subtitle, a badge row, then content cards — so the panel does not
 * jump when the real content replaces it.
 */
export default function AdminDrawerSkeleton({ label }: { label?: string }) {
  const t = useTranslations('app.ui');
  return (
    <div
      aria-busy="true"
      aria-label={label ?? t('loading')}
      style={{ display: 'grid', gap: '1.1rem', paddingTop: '0.25rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
        <Bar width="2.75rem" height="2.75rem" radius={999} />
        <div style={{ display: 'grid', gap: '0.5rem', flex: 1, maxWidth: '18rem' }}>
          <Bar width="60%" height="1.05rem" radius={10} />
          <Bar width="85%" height="0.75rem" />
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
        <Bar width="5.5rem" height="1.4rem" radius={999} />
        <Bar width="4rem" height="1.4rem" radius={999} />
      </div>

      {[0, 1].map((index) => (
        <div key={index} className={adminStyles.skeletonCard}>
          <Bar width="30%" height="0.75rem" />
          <Bar width="100%" height="2.4rem" radius={12} />
          <Bar width="70%" height="2.4rem" radius={12} />
        </div>
      ))}
    </div>
  );
}
