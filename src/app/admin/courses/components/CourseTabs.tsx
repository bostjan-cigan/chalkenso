import { getTranslations } from 'next-intl/server';
import { TbBook2, TbMessageCircle, TbSettings, TbUsersGroup } from 'react-icons/tb';
import { Permission } from '@prisma/client';
import { ui } from '@/extensions/ui';
import { getCrmViewer } from '@/lib/crm-access';
import { canAccessSection } from '@/lib/permissions';
import AdminTabs from '../../components/ui/AdminTabs';

export type CourseTab = 'lessons' | 'groups' | 'feedback' | 'settings' | (string & {});

/**
 * One course's tabs, matching a group's: its Lessons, its Groups, the Feedback from all of them, the
 * edition's own (`ui.courseTabs`), and Settings, for those who set them (owners, admins and
 * unrestricted members). Their names are in `app.nav.course`.
 */
export default async function CourseTabs({ courseId, active }: { courseId: string; active: CourseTab }) {
  const [viewer, t] = await Promise.all([getCrmViewer(), getTranslations('app.nav.course')]);
  const showSettings = Boolean(viewer && canAccessSection(viewer, 'courses', [Permission.WRITE]));
  const base = `/admin/courses/${courseId}`;
  const tabs = [
    { key: 'lessons', label: t('tabs.lessons'), href: base, Icon: TbBook2 },
    { key: 'groups', label: t('tabs.groups'), href: `${base}/groups`, Icon: TbUsersGroup },
    { key: 'feedback', label: t('tabs.feedback'), href: `${base}/feedback`, Icon: TbMessageCircle },
    ...ui.courseTabs.map(({ key, label, segment, icon }) => ({ key, label: t(`tabs.${label}`), href: `${base}/${segment}`, Icon: icon })),
    ...(showSettings ? [{ key: 'settings', label: t('tabs.settings'), href: `${base}/edit`, Icon: TbSettings }] : []),
  ];
  return <AdminTabs label={t('label')} tabs={tabs.map(({ key, ...tab }) => ({ ...tab, active: key === active }))} />;
}
