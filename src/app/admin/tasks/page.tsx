import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Permission, TaskStatus } from '@prisma/client';
import AdminFrame from '../components/AdminFrame';
import { adminNavItems } from '@/app/admin/nav';
import AdminDrawerShell from '../components/ui/AdminDrawerShell';
import AdminSectionCard from '../components/ui/AdminSectionCard';
import {
  accessScope,
  canWorkOnFeedback,
  hasAnyAccess,
  requireCrmAccess,
  taskScopeWhere,
  type CrmViewer,
} from '@/lib/crm-access';
import { canAccessSection, courseGrantIds } from '@/lib/permissions';
import {
  TASK_KIND_DEFINITIONS,
  TASK_LANE_ID,
  listCurriculumTaskLanes,
  listTaskKindCounts,
  type TaskLane,
} from '@/lib/tasks';
import TaskBoardClient, { type TaskLaneView } from './components/TaskBoardClient';
import TaskCurriculumFilter from './components/TaskCurriculumFilter';
import TaskDetailPanel from './components/TaskDetailPanel';
import { toTaskCardView } from './components/task-card-view';
import { loadTaskDetail } from './task-detail-data';
import styles from '../admin.module.css';
import SegmentedControl from '../components/ui/SegmentedControl';

export const dynamic = 'force-dynamic';

/** Server actions here can wait on Claude (Revise, Draft with AI): allow them up to five minutes. */
export const maxDuration = 300;

type PageProps = {
  /** `done=all`: every finished task, not only the latest (`DONE_ON_BOARD`). */
  searchParams: Promise<{ kind?: string; curriculum?: string; task?: string; done?: string }>;
};

/** Finished tasks pile up forever: the board shows the most recently finished this many. */
const DONE_ON_BOARD = 100;

/**
 * Whether the viewer may work on a lane's tasks (drag them; `extra` DELETE to clear ignored ones):
 * its group, or every task's course or group in a core lane.
 */
function canWorkOnLane(viewer: CrmViewer, lane: TaskLane, extra: Permission[] = []) {
  const work = [Permission.READ, Permission.TASKS, ...extra];
  if (canAccessSection(viewer, 'tasks', work)) {
    return true;
  }
  if (lane.groupId) {
    return canWorkOnFeedback(viewer, { courseId: lane.courseId, groupIds: [lane.groupId] }, 'tasks', extra);
  }
  if (lane.courseId) {
    // A course's own lessons: work on that course's feedback.
    return canWorkOnFeedback(viewer, { courseId: lane.courseId, groupIds: [] }, 'tasks', extra);
  }
  if (lane.tasks.length) {
    return lane.tasks.every((task) => canWorkOnFeedback(viewer, { courseId: task.courseId, groupIds: task.groupIds }, 'tasks', extra));
  }
  const courses = courseGrantIds(viewer.grants, work);
  return courses === '*' || courses.length > 0;
}

export default async function AdminTasksPage({ searchParams }: PageProps) {
  // Everyone sees the tasks of the courses and groups they reach (limited members only theirs).
  const viewer = await requireCrmAccess(hasAnyAccess);
  const [t, kinds] = await Promise.all([getTranslations('tasks.page'), getTranslations('tasks.kinds')]);
  const params = await searchParams;
  const scope = accessScope(viewer, 'tasks');
  const where = taskScopeWhere(scope);

  const kind =
    TASK_KIND_DEFINITIONS.find((definition) => definition.kind === params.kind)?.kind ??
    TASK_KIND_DEFINITIONS[0].kind;
  // The open task's detail does not depend on the board, so it loads alongside it rather than
  // adding its own round trip after.
  const openTaskId = params.task?.trim() || null;
  const allDone = params.done === 'all';
  const [lanes, kindCounts, openTask] = await Promise.all([
    // The scope limits both the tasks and the lane skeletons, so an instructor never sees another
    // group's name here.
    listCurriculumTaskLanes({ kind, scope, where, doneLimit: allDone ? undefined : DONE_ON_BOARD }),
    listTaskKindCounts(where),
    openTaskId ? loadTaskDetail(openTaskId) : null,
  ]);

  // Only a lane that exists for this viewer: a filter must never widen what they can see.
  const selectedLaneId =
    lanes.find((lane) => lane.id === params.curriculum?.trim())?.id ?? '';
  const filterOptions = lanes.map((lane) => ({
    value: lane.id,
    label: lane.sublabel ? `${lane.label} — ${lane.sublabel}` : lane.label,
    count: lane.tasks.length,
  }));
  const visibleLanes = selectedLaneId
    ? lanes.filter((lane) => lane.id === selectedLaneId)
    : lanes;

  // Which task the drawer shows. Keeping it in the board's own URL (rather than intercepting
  // /admin/tasks/<id>) means the panel is server-rendered with the board, deep-links, and leaves
  // the board mounted underneath with its scroll and lane state intact.
  const boardHref = `/admin/tasks?kind=${kind}${
    selectedLaneId ? `&curriculum=${encodeURIComponent(selectedLaneId)}` : ''
  }${allDone ? '&done=all' : ''}`;
  // The board reached its limit of finished tasks: there may be older ones to show.
  const moreDone =
    !allDone &&
    lanes.reduce((count, lane) => count + lane.tasks.filter((task) => task.status === TaskStatus.DONE).length, 0) >=
      DONE_ON_BOARD;

  const now = new Date();
  const canTriageSection = canAccessSection(viewer, 'tasks', [Permission.READ, Permission.TASKS]);
  const laneViews: TaskLaneView[] = visibleLanes.map((lane) => ({
    id: lane.id,
    label: lane.label,
    sublabel: lane.sublabel,
    href: lane.href,
    emptyHint: lane.emptyHint,
    // Collapsed by default; picking a single curriculum opens that one.
    defaultOpen: selectedLaneId !== '',
    // Dragging calls moveTaskAction, which needs Feedback & tasks — a read-only viewer would
    // otherwise get a redirect thrown mid-drag.
    canDrag: canWorkOnLane(viewer, lane),
    // Only the untied lane: those tasks point at no curriculum (usually test leftovers), so the
    // section can clean them up. Every other lane's tasks are live curriculum work.
    canDelete: lane.id === TASK_LANE_ID.unscoped && canTriageSection,
    // Ignored work is a decision, not live work: whoever may work on and delete in this lane may
    // also clear it.
    canClearIgnored: canWorkOnLane(viewer, lane, [Permission.DELETE]),
    tasks: lane.tasks.map((task) => toTaskCardView(task, now)),
  }));

  return (
    <AdminFrame
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('description')}
      navItems={adminNavItems(null)}
    >
      <section className={styles.editorPageSection}>
        <AdminSectionCard kicker={t('kicker')} title="">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            {/* The kinds are the board's parts: a segmented control, as on the Feedback tab (none for one). */}
            {TASK_KIND_DEFINITIONS.length > 1 ? (
              <SegmentedControl
                label={t('kindNav')}
                segments={TASK_KIND_DEFINITIONS.map((definition) => ({
                  key: definition.kind,
                  label: kinds(`${definition.kind}.label`),
                  count: kindCounts[definition.kind] ?? 0,
                  href: `/admin/tasks?kind=${definition.kind}`,
                  active: definition.kind === kind,
                }))}
              />
            ) : null}

            <div style={{ marginLeft: 'auto', minWidth: 260 }}>
              <TaskCurriculumFilter kind={kind} value={selectedLaneId} options={filterOptions} />
            </div>
          </div>

          {laneViews.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'rgba(var(--foreground-rgb), 0.6)' }}>
              {t('empty')}
            </p>
          ) : (
            <TaskBoardClient lanes={laneViews} taskHrefPrefix={`${boardHref}&task=`} />
          )}
          {moreDone ? (
            <p style={{ fontSize: '0.85rem', color: 'rgba(var(--foreground-rgb), 0.6)', marginTop: '0.75rem' }}>
              {t('doneLimit', { count: DONE_ON_BOARD })}{' '}
              <Link href={`${boardHref}&done=all`}>{t('showAllDone')}</Link>
            </p>
          ) : null}
        </AdminSectionCard>
      </section>

      {/* Always mounted: the shell opens on a skeleton the moment a card is clicked, before this
          page has re-rendered with the task. */}
      <AdminDrawerShell
        openKey={openTask ? openTaskId : null}
        closeHref={boardHref}
        ariaLabel={t('drawerLabel')}
        closeLabel={t('closeTask')}
      >
        {openTask ? <TaskDetailPanel {...openTask} variant="drawer" boardHref={boardHref} /> : null}
      </AdminDrawerShell>
    </AdminFrame>
  );
}
