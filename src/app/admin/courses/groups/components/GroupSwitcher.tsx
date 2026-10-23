'use client';

import { useTranslations } from 'next-intl';
import { TbCheck, TbSelector } from 'react-icons/tb';
import AdminMenu from '@/app/admin/components/ui/AdminMenu';
import styles from '../../../admin.module.css';

/**
 * The group's name as its page title, with a menu of the viewer's other groups: switching keeps the
 * same tab, so moving between groups never loses your place.
 */
export default function GroupSwitcher({
  current,
  groups,
  tab,
}: {
  current: { id: string; name: string };
  groups: Array<{ id: string; name: string; course: string }>;
  /** The open tab (`lessons`, `feedback`…), kept when switching. */
  tab: string;
}) {
  const t = useTranslations('groups.switcher');
  const title = <h1 className={styles.coursePageContextTitle}>{current.name}</h1>;
  if (groups.length < 2) return title;
  return (
    <AdminMenu
      label={t('label')}
      trigger={
        <>
          {title}
          <TbSelector size={18} aria-hidden style={{ opacity: 0.55, flexShrink: 0 }} />
        </>
      }
      items={groups.map((group) => ({
        label: `${group.name} · ${group.course}`,
        href: `/admin/courses/groups/${group.id}${tab === 'lessons' ? '' : `?tab=${tab}`}`,
        icon:
          group.id === current.id ? (
            <TbCheck size={15} aria-hidden />
          ) : (
            <span aria-hidden style={{ width: 15, display: 'inline-block' }} />
          ),
      }))}
    />
  );
}
