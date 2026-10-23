'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  type CSSProperties,
  type DragEvent,
  useEffect,
  useState,
  useTransition,
} from 'react';
import { FiClock, FiCpu, FiFileText, FiMessageSquare } from 'react-icons/fi';
import { TaskStatus } from '@prisma/client';
import ConfirmDialog from '../../courses/components/ConfirmDialog';
import UserAvatar from '../../components/ui/UserAvatar';
import { noteDrawerIntentFromClick } from '../../components/ui/admin-drawer-intent';
import type { TaskAge, TaskContext } from '@/lib/tasks';
import { deleteIgnoredTasksAction, deleteOrphanTasksAction, moveTaskAction } from '../actions';
import { TASK_STATUS_KEYS } from '../task-status-labels';

/** Client-safe task shape for the board (mapped from the server's TaskListItem). */
export type TaskCardView = {
  id: string;
  title: string;
  status: TaskStatus;
  proposerName: string | null;
  /** Course › group or version › lesson, put in words here. */
  context: TaskContext | null;
  /** The core proposal made from this task, when one exists. */
  proposal: { id: string; title: string; status: TaskStatus } | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  /** A revision plan is synced back from Obsidian: ready to execute, not just filed. */
  hasPlan: boolean;
  /** Cleared for the local agent to execute on its own. */
  aiReady: boolean;
  commentCount: number;
  /** Compact age, computed server-side ('today', '3d', '2w' in words). */
  age: TaskAge;
  /** How long an open task has been waiting; drives the card's left edge. */
  staleness: 'none' | 'warn' | 'alert';
};

/** One swimlane per curriculum: the shared core, or one group's own copy. */
export type TaskLaneView = {
  /** 'core' | `group:${groupId}` | 'unscoped'. Identity for drag containment and collapse state. */
  id: string;
  label: string;
  /** Course title, plus 'Closed' for an archived group curriculum. */
  sublabel: string | null;
  /** The group this lane belongs to, when it has one. */
  href: string | null;
  emptyHint: string;
  /** Server-computed: open lanes first, quiet ones collapsed. Only seeds the initial state. */
  defaultOpen: boolean;
  /** Server-computed triage permission for this lane's curriculum. */
  canDrag: boolean;
  /** Only the untied lane: its tasks point at no curriculum, so they can be cleaned up. */
  canDelete: boolean;
  /** Triage on this lane's curriculum: its Ignored column can be emptied (per card, or at once). */
  canClearIgnored: boolean;
  tasks: TaskCardView[];
};

const COLUMNS: Array<{ status: TaskStatus; accent: string }> = [
  { status: TaskStatus.TODO, accent: 'var(--accent-color-hex)' },
  { status: TaskStatus.IN_PROGRESS, accent: '#d97706' },
  { status: TaskStatus.DONE, accent: '#16a34a' },
  { status: TaskStatus.IGNORED, accent: 'rgba(var(--foreground-rgb), 0.4)' },
];

const lanesStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
  // The columns scroll sideways inside the board on a narrow screen, never the page.
  minWidth: 0,
};

const laneHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  margin: '0 0 0.6rem',
};

const laneToggleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
  padding: 0,
  border: 'none',
  background: 'none',
  font: 'inherit',
  fontSize: '0.95rem',
  fontWeight: 700,
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
};

const laneSubStyle: CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 500,
  color: 'rgba(var(--foreground-rgb), 0.55)',
};

const laneCountStyle: CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'rgba(var(--foreground-rgb), 0.5)',
};

const laneLinkStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: '0.75rem',
  color: 'rgba(var(--foreground-rgb), 0.6)',
};

const laneHintStyle: CSSProperties = {
  margin: '0 0 0.6rem',
  fontSize: '0.78rem',
  color: 'rgba(var(--foreground-rgb), 0.55)',
};

const columnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  padding: '0.6rem',
  borderRadius: 12,
  background: 'rgba(var(--foreground-rgb), 0.03)',
  border: '1px solid rgba(var(--foreground-rgb), 0.08)',
  minHeight: 140,
};

const columnHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '0.75rem',
  fontWeight: 700,
  letterSpacing: '0.03em',
};

const cardStyle: CSSProperties = {
  display: 'block',
  padding: '0.6rem 0.7rem',
  borderRadius: 9,
  background: 'rgb(var(--background-rgb))',
  border: '1px solid rgba(var(--foreground-rgb), 0.12)',
  textDecoration: 'none',
  color: 'inherit',
};

const cardHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

const cardMetaStyle: CSSProperties = {
  marginTop: '0.35rem',
  fontSize: '0.72rem',
  color: 'rgba(var(--foreground-rgb), 0.55)',
  lineHeight: 1.4,
};

/** Left edge on an open task that has been waiting: amber past 2 weeks, red past a month. */
const STALE_EDGE: Record<TaskCardView['staleness'], string | null> = {
  none: null,
  warn: '#d97706',
  alert: '#b91c1c',
};

const cardFootStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  marginTop: '0.4rem',
  fontSize: '0.68rem',
  color: 'rgba(var(--foreground-rgb), 0.5)',
};

/** Every footer entry: icon first, value after, never wrapping away from its icon. */
const footItemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.2rem',
  whiteSpace: 'nowrap',
};

const footDotStyle: CSSProperties = {
  color: 'rgba(var(--foreground-rgb), 0.3)',
};

/** A synced revision plan is the one footer signal worth colour: the task is ready to execute. */
const planIconStyle: CSSProperties = {
  ...footItemStyle,
  color: '#16a34a',
};

/** Cleared for the agent — the other coloured signal, so handoff is readable from the board. */
const aiIconStyle: CSSProperties = {
  ...footItemStyle,
  color: '#7c3aed',
};

const deleteButtonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '0.1rem 0.35rem',
  border: 'none',
  background: 'none',
  font: 'inherit',
  fontSize: '0.7rem',
  color: 'var(--red-pen)',
  cursor: 'pointer',
};

const proposalStyle: CSSProperties = {
  marginTop: '0.35rem',
  fontSize: '0.7rem',
  fontWeight: 600,
  color: 'rgba(var(--foreground-rgb), 0.6)',
};

function laneColumnKey(laneId: string, status: TaskStatus) {
  return `${laneId}:${status}`;
}

function openTaskCount(tasks: TaskCardView[]) {
  return tasks.filter(
    (task) => task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS
  ).length;
}

function laneOpenState(lanes: TaskLaneView[]) {
  return Object.fromEntries(lanes.map((lane) => [lane.id, lane.defaultOpen]));
}

/**
 * The board itself. Its words are `tasks.board` and `tasks.status`: `TaskBoard` gives them, so a page
 * whose provider has no `tasks` (a course's or a group's) can show it too.
 */
export default function TaskBoardClient({
  lanes,
  variant = 'page',
  taskHrefPrefix = '/admin/tasks/',
}: {
  lanes: TaskLaneView[];
  /** `embedded` drops the lane header/collapse chrome — used for a single lane inside a card. */
  variant?: 'page' | 'embedded';
  /** A card links to `${taskHrefPrefix}${task.id}`: the full page, or the board's own drawer. */
  taskHrefPrefix?: string;
}) {
  const t = useTranslations('tasks.board');
  const statusWords = useTranslations('tasks.status');
  const router = useRouter();
  // The board's own drawer (`?task=`) opens over the board, so a click can show a skeleton right
  // away; the full-page prefix leaves the board behind entirely and needs no such stand-in.
  const opensDrawer = taskHrefPrefix.includes('task=');
  const [laneItems, setLaneItems] = useState<TaskLaneView[]>(lanes);
  const [dragging, setDragging] = useState<{ id: string; laneId: string } | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [openLanes, setOpenLanes] = useState<Record<string, boolean>>(() => laneOpenState(lanes));
  /** `untied` = tasks on no curriculum at all; `ignored` = a curriculum lane's turned-down work. */
  const [pendingDelete, setPendingDelete] = useState<{
    ids: string[];
    title: string;
    mode: 'untied' | 'ignored';
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const isEmbedded = variant === 'embedded';

  // Re-sync when the server sends fresh data (after router.refresh()).
  useEffect(() => {
    setLaneItems(lanes);
    // Seed only lanes we have not seen yet. This effect runs after every post-drag refresh, so a
    // plain reseed would slam shut a lane the user just opened.
    setOpenLanes((prev) => {
      const next = { ...prev };
      let added = false;
      for (const lane of lanes) {
        if (!(lane.id in next)) {
          next[lane.id] = lane.defaultOpen;
          added = true;
        }
      }
      return added ? next : prev;
    });
  }, [lanes]);

  function clearDrag() {
    setDragging(null);
    setOverKey(null);
  }

  function onDrop(laneId: string, status: TaskStatus) {
    const current = dragging;
    clearDrag();
    // A task's curriculum is fixed; cards only move between columns of their own lane.
    if (!current || current.laneId !== laneId) {
      return;
    }
    const lane = laneItems.find((item) => item.id === laneId);
    const task = lane?.tasks.find((item) => item.id === current.id);
    if (!lane?.canDrag || !task || task.status === status) {
      return;
    }

    // Optimistic move, then persist + refresh.
    setLaneItems((prev) =>
      prev.map((item) =>
        item.id === laneId
          ? {
              ...item,
              tasks: item.tasks.map((t) => (t.id === current.id ? { ...t, status } : t)),
            }
          : item
      )
    );
    startTransition(async () => {
      await moveTaskAction(current.id, status);
      router.refresh();
    });
  }

  function confirmDelete() {
    const pending = pendingDelete;
    setPendingDelete(null);
    if (!pending) {
      return;
    }

    // Optimistic removal, then persist + refresh (the server re-checks every id before deleting).
    const removing = new Set(pending.ids);
    setLaneItems((prev) =>
      prev.map((lane) => ({ ...lane, tasks: lane.tasks.filter((t) => !removing.has(t.id)) }))
    );
    startTransition(async () => {
      await (pending.mode === 'ignored'
        ? deleteIgnoredTasksAction(pending.ids)
        : deleteOrphanTasksAction(pending.ids));
      router.refresh();
    });
  }

  function allowDrop(event: DragEvent, laneId: string, status: TaskStatus) {
    if (dragging?.laneId !== laneId) {
      return;
    }
    event.preventDefault();
    const key = laneColumnKey(laneId, status);
    if (overKey !== key) {
      setOverKey(key);
    }
  }

  return (
    <div style={lanesStyle}>
      {laneItems.map((lane) => {
        const open = isEmbedded || openLanes[lane.id] !== false;
        return (
          <section key={lane.id} aria-label={t('laneLabel', { label: lane.label })}>
            {isEmbedded ? null : (
              <div style={laneHeadStyle}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setOpenLanes((prev) => ({ ...prev, [lane.id]: !(prev[lane.id] !== false) }))
                  }
                  style={laneToggleStyle}
                >
                  <span aria-hidden>{open ? '▾' : '▸'}</span>
                  <span>{lane.label}</span>
                  {lane.sublabel ? <span style={laneSubStyle}>{lane.sublabel}</span> : null}
                  <span style={laneCountStyle}>
                    {t('laneCount', { open: openTaskCount(lane.tasks), total: lane.tasks.length })}
                  </span>
                </button>
                {lane.href ? (
                  <Link href={lane.href} style={laneLinkStyle}>
                    {lane.id.startsWith('course:') ? t('openCourse') : t('openGroup')}
                  </Link>
                ) : null}
                {lane.canDelete && lane.tasks.length > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPendingDelete({
                        ids: lane.tasks.map((task) => task.id),
                        title: t('untiedTasks', { count: lane.tasks.length }),
                        mode: 'untied',
                      })
                    }
                    style={{ ...deleteButtonStyle, marginLeft: lane.href ? 0 : 'auto' }}
                  >
                    {t('deleteAll', { count: lane.tasks.length })}
                  </button>
                ) : null}
              </div>
            )}

            <div hidden={!open}>
              {lane.tasks.length === 0 && lane.emptyHint ? (
                <p style={laneHintStyle}>{t('noTasksYet', { hint: lane.emptyHint })}</p>
              ) : null}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(4, minmax(${isEmbedded ? 170 : 200}px, 1fr))`,
                  gap: '0.75rem',
                  overflowX: 'auto',
                  paddingBottom: '0.25rem',
                }}
              >
                {COLUMNS.map((column) => {
                  const key = laneColumnKey(lane.id, column.status);
                  const columnTasks = lane.tasks.filter((task) => task.status === column.status);
                  const isOver = overKey === key;
                  return (
                    <div
                      key={key}
                      style={{
                        ...columnStyle,
                        borderColor: isOver ? column.accent : 'rgba(var(--foreground-rgb), 0.08)',
                        background: isOver
                          ? 'rgba(var(--foreground-rgb), 0.06)'
                          : columnStyle.background,
                      }}
                      onDragOver={
                        lane.canDrag
                          ? (event) => allowDrop(event, lane.id, column.status)
                          : undefined
                      }
                      onDragLeave={
                        lane.canDrag ? () => setOverKey((k) => (k === key ? null : k)) : undefined
                      }
                      onDrop={lane.canDrag ? () => onDrop(lane.id, column.status) : undefined}
                    >
                      <div style={{ ...columnHeadStyle, color: column.accent }}>
                        <span>{statusWords(TASK_STATUS_KEYS[column.status])}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                          {/* Ignored work is decided work: clearing it is the only way it leaves. */}
                          {column.status === TaskStatus.IGNORED &&
                          lane.canClearIgnored &&
                          columnTasks.length > 0 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingDelete({
                                  ids: columnTasks.map((task) => task.id),
                                  title: t('ignoredTasks', { count: columnTasks.length }),
                                  mode: 'ignored',
                                })
                              }
                              style={{ ...deleteButtonStyle, alignSelf: 'auto', padding: 0 }}
                            >
                              {t('clear')}
                            </button>
                          ) : null}
                          <span>{columnTasks.length}</span>
                        </span>
                      </div>

                      {columnTasks.map((task) => (
                        <div
                          key={task.id}
                          style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}
                        >
                        <Link
                          href={`${taskHrefPrefix}${task.id}`}
                          onClick={
                            opensDrawer
                              ? (event) => noteDrawerIntentFromClick(event, task.id)
                              : undefined
                          }
                          draggable={lane.canDrag}
                          onDragStart={
                            lane.canDrag
                              ? (event) => {
                                  setDragging({ id: task.id, laneId: lane.id });
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', task.id);
                                }
                              : undefined
                          }
                          onDragEnd={lane.canDrag ? clearDrag : undefined}
                          style={{
                            ...cardStyle,
                            cursor: lane.canDrag ? 'grab' : 'pointer',
                            opacity: dragging?.id === task.id ? 0.5 : 1,
                            ...(STALE_EDGE[task.staleness]
                              ? { borderLeft: `3px solid ${STALE_EDGE[task.staleness]}` }
                              : {}),
                          }}
                        >
                          <div style={cardHeadStyle}>
                            <strong style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                              {task.title}
                            </strong>
                            {task.assignee ? (
                              <span title={t('assignedTo', { name: task.assignee.name })}>
                                <UserAvatar
                                  name={task.assignee.name}
                                  imageUrl={task.assignee.avatarUrl}
                                  size={22}
                                />
                              </span>
                            ) : null}
                          </div>
                          {task.context || task.proposerName ? (
                            <div style={cardMetaStyle}>
                              {task.context ? (
                                <div>
                                  {[
                                    task.context.course,
                                    task.context.group ? t('contextGroup', { name: task.context.group }) : task.context.version,
                                    task.context.lesson === null ? null : t('contextLesson', { position: task.context.lesson }),
                                  ]
                                    .filter(Boolean)
                                    .join(' › ')}
                                </div>
                              ) : null}
                              {task.proposerName ? <div>{t('proposedBy', { name: task.proposerName })}</div> : null}
                            </div>
                          ) : null}
                          {/* Plain text, not a link: the card itself is already an anchor. */}
                          {task.proposal ? (
                            <div style={proposalStyle}>
                              {t('core', {
                                title: task.proposal.title,
                                status: statusWords(TASK_STATUS_KEYS[task.proposal.status]),
                              })}
                            </div>
                          ) : null}
                          <div style={cardFootStyle}>
                            <span
                              style={footItemStyle}
                              title={t('created', task.age)}
                            >
                              <FiClock size={11} aria-hidden />
                              {t('age', task.age)}
                            </span>
                            {task.hasPlan ? (
                              <>
                                <span style={footDotStyle} aria-hidden>
                                  ·
                                </span>
                                <span
                                  style={planIconStyle}
                                  title={t('planTitle')}
                                >
                                  <FiFileText size={11} aria-hidden />
                                  {t('plan')}
                                </span>
                              </>
                            ) : null}
                            {task.aiReady ? (
                              <>
                                <span style={footDotStyle} aria-hidden>
                                  ·
                                </span>
                                <span
                                  style={aiIconStyle}
                                  title={t('aiTitle')}
                                >
                                  <FiCpu size={11} aria-hidden />
                                  {t('ai')}
                                </span>
                              </>
                            ) : null}
                            {task.commentCount > 0 ? (
                              <>
                                <span style={footDotStyle} aria-hidden>
                                  ·
                                </span>
                                <span
                                  style={footItemStyle}
                                  title={t('notes', { count: task.commentCount })}
                                >
                                  <FiMessageSquare size={11} aria-hidden />
                                  {task.commentCount}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </Link>
                        {lane.canDelete ||
                        (lane.canClearIgnored && task.status === TaskStatus.IGNORED) ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPendingDelete({
                                ids: [task.id],
                                title: task.title,
                                mode: lane.canDelete ? 'untied' : 'ignored',
                              })
                            }
                            style={deleteButtonStyle}
                          >
                            {t('delete')}
                          </button>
                        ) : null}
                        </div>
                      ))}

                      {columnTasks.length === 0 ? (
                        <p
                          style={{
                            margin: 0,
                            fontSize: '0.75rem',
                            color: 'rgba(var(--foreground-rgb), 0.4)',
                          }}
                        >
                          {lane.canDrag ? t('dropHere') : t('nothingHere')}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.mode === 'ignored' ? t('confirm.titleIgnored') : t('confirm.title')}
        description={
          pendingDelete
            ? t('confirm.description', {
                what: pendingDelete.ids.length === 1 ? t('confirm.quoted', { title: pendingDelete.title }) : pendingDelete.title,
                mode: pendingDelete.mode,
                count: pendingDelete.ids.length,
              })
            : ''
        }
        confirmLabel={
          pendingDelete && pendingDelete.ids.length > 1
            ? t('confirm.deleteMany', { count: pendingDelete.ids.length })
            : t('confirm.deleteOne')
        }
        cancelLabel={t('confirm.cancel')}
        tone="danger"
        pending={isPending}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
