import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { adminNavItems } from '@/app/admin/nav';
import AdminFrame from '../../components/AdminFrame';
import TaskDetailPanel from '../components/TaskDetailPanel';
import { loadTaskDetail } from '../task-detail-data';
import styles from '../../admin.module.css';

export const dynamic = 'force-dynamic';

/** Server actions here can wait on Claude (Revise, Draft with AI): allow them up to five minutes. */
export const maxDuration = 300;

type PageProps = {
  params: Promise<{ taskId: string }>;
};

export default async function TaskDetailPage({ params }: PageProps) {
  const { taskId } = await params;
  const [data, t] = await Promise.all([loadTaskDetail(taskId), getTranslations('tasks.detailPage')]);

  if (!data) {
    notFound();
  }

  return (
    <AdminFrame
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('description')}
      navItems={adminNavItems('tasks')}
    >
      <section className={styles.editorPageSection}>
        <TaskDetailPanel {...data} variant="page" />
      </section>
    </AdminFrame>
  );
}
