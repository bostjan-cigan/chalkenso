import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { type CSSProperties, type ReactNode } from 'react';
import { TaskStatus } from '@prisma/client';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { planBody } from '@/lib/plan-scope';
import AdminBadge from '../../components/ui/AdminBadge';
import AdminSectionCard from '../../components/ui/AdminSectionCard';
import AdminButton from '../../components/ui/AdminButton';
import UserAvatar from '../../components/ui/UserAvatar';
import { addTaskCommentAction, proposeForCoreAction, updateTaskDescriptionAction } from '../actions';
import type { TaskDetailData } from '../task-detail-data';
import TaskAiReadyControl from './TaskAiReadyControl';
import RevisionPathBar from '../../components/revision-path/RevisionPathBar';
import WhatChanged from '../../components/improvements/WhatChanged';
import TaskPlanEditor from './TaskPlanEditor';
import ImprovementPlaces from './ImprovementPlaces';
import TaskAssigneeControl from './TaskAssigneeControl';
import TaskDeleteControl from './TaskDeleteControl';
import TaskStatusControls from './TaskStatusControls';
import { TASK_STATUS_KEYS } from '../task-status-labels';
import { ui } from '@/extensions/ui';

function formatDate(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const badgeForStatus: Record<TaskStatus, 'accent' | 'warning' | 'muted' | 'inactive'> = {
  TODO: 'accent',
  IN_PROGRESS: 'warning',
  DONE: 'muted',
  IGNORED: 'inactive',
};

const labelStyle: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  color: 'rgba(var(--foreground-rgb), 0.55)',
  margin: '0 0 0.25rem',
};

const valueStyle: CSSProperties = {
  margin: 0,
  color: 'rgb(var(--foreground-rgb))',
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
};

const quoteStyle: CSSProperties = {
  margin: '0 0 0.5rem',
  paddingLeft: '0.75rem',
  borderLeft: '3px solid var(--accent-color-hex)',
  fontStyle: 'italic',
  color: 'rgba(var(--foreground-rgb), 0.72)',
  lineHeight: 1.5,
};

const planStyle: CSSProperties = {
  ...valueStyle,
  padding: '0.6rem 0.75rem',
  borderRadius: 9,
  background: 'rgba(var(--foreground-rgb), 0.04)',
  border: '1px solid rgba(var(--foreground-rgb), 0.08)',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 72,
  padding: '0.55rem 0.65rem',
  borderRadius: 9,
  border: '1px solid rgba(var(--foreground-rgb), 0.2)',
  background: 'rgb(var(--background-rgb))',
  color: 'rgb(var(--foreground-rgb))',
  font: 'inherit',
  fontSize: '0.88rem',
  resize: 'vertical',
  boxSizing: 'border-box',
};

/** Small helper for the breadcrumb and cross-task links — each opens in a new tab. */
const crumbLinkStyle: CSSProperties = {
  color: 'var(--accent-color-hex)',
  textDecoration: 'none',
  fontWeight: 500,
};

/* Each block of the panel is separated by a rule and titled, so a first-time reader can tell
   "things I can change here" from "things synced from elsewhere". */
const sectionStyle: CSSProperties = {
  paddingTop: '1.1rem',
  marginTop: '1.1rem',
  borderTop: '1px solid rgba(var(--foreground-rgb), 0.08)',
};

const sectionHeadRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  marginBottom: '0.5rem',
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 600,
};

const hintStyle: CSSProperties = {
  margin: '0 0 0.75rem',
  color: 'rgba(var(--foreground-rgb), 0.6)',
  fontSize: '0.84rem',
  lineHeight: 1.5,
};

/** Bordered block for the scope explanation, so the propose action reads as an action. */
const calloutStyle: CSSProperties = {
  display: 'grid',
  justifyItems: 'start',
  gap: '0.55rem',
  padding: '0.85rem 0.95rem',
  borderRadius: 12,
  border: '1px solid rgba(var(--foreground-rgb), 0.1)',
  background: 'rgba(var(--foreground-rgb), 0.035)',
};

const breadcrumbStyle: CSSProperties = {
  margin: '0.4rem 0 0',
  fontSize: '0.86rem',
  color: 'rgba(var(--foreground-rgb), 0.6)',
  lineHeight: 1.5,
};

const metaGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))',
  gap: '0.9rem 1.5rem',
};

/** A titled block with an optional badge on the right and an optional explanatory line. */
function Section({
  id,
  title,
  aside,
  hint,
  children,
}: {
  /** An anchor the path's next action can point at ("#plan"). */
  id?: string;
  title: string;
  aside?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} style={{ ...sectionStyle, scrollMarginTop: 72 }}>
      <div style={sectionHeadRowStyle}>
        <h3 style={sectionTitleStyle}>{title}</h3>
        {aside ?? null}
      </div>
      {hint ? <p style={hintStyle}>{hint}</p> : null}
      {children}
    </section>
  );
}

/**
 * The task detail body, shared by the full page and the drawer the board opens over itself, so the
 * two can never drift. Every control posts to the same server actions either way.
 */
export default async function TaskDetailPanel({
  task,
  discussion,
  users,
  canWork,
  canDelete,
  canSeeCore,
  aiEnabled,
  aiDraft,
  record,
  path,
  places,
  vaultAgent,
  variant = 'page',
  boardHref = '/admin/tasks',
}: TaskDetailData & {
  /** `drawer` swaps the "All tasks" pill for the link out to this task's own page. */
  variant?: 'page' | 'drawer';
  /** Where deleting the task lands; the board's own URL keeps its kind/curriculum filter. */
  boardHref?: string;
}) {
  const [t, statusWords, pathWords, recordWords, locale] = await Promise.all([
    getTranslations('tasks.detail'),
    getTranslations('tasks.status'),
    getTranslations('tasks.path'),
    getTranslations('tasks.record'),
    getLocale() as Promise<Locale>,
  ]);
  const statusLabel = (status: TaskStatus) => statusWords(TASK_STATUS_KEYS[status]);
  const date = (iso: string) => formatDate(iso, locale);
  const { refs } = task;
  const courseHref = refs.course ? `/admin/courses/${refs.course.id}` : null;
  const versionHref = refs.course && refs.version
    ? `/admin/courses/${refs.course.id}/versions/${refs.version.id}`
    : null;
  const lessonEditHref = refs.course && refs.lesson
    ? `/admin/courses/${refs.course.id}/lessons/${refs.lesson.id}`
    : null;
  // Narrowed once: `task.scope` is a union, so a plain boolean would not carry the group fields.
  const groupScope = task.scope?.kind === 'group' ? task.scope : null;
  // An improvement of a lesson is worked on in the lesson's Improve mode: this page shows its details.
  const improveHref = lessonEditHref ? places.lessons[0]?.href ?? `${lessonEditHref}/improvements?i=${task.id}` : null;

  return (
    <>
      <AdminSectionCard
        kicker={t('kicker')}
        title=""
        kickerAction={
          variant === 'page' ? (
            <AdminButton href="/admin/tasks" tone="plain" size="compact">
              {t('allTasks')}
            </AdminButton>
          ) : (
            <AdminButton href={`/admin/tasks/${task.id}`} target="_blank" rel="noreferrer" tone="plain" size="compact">
              {t('openFullPage')}
            </AdminButton>
          )
        }
      >
        {/* What this task is, and where it lives — the two questions a first-time reader has. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.5rem',
          }}
        >
          <AdminBadge variant={badgeForStatus[task.status]}>
            {statusLabel(task.status)}
          </AdminBadge>
          {task.scope ? (
            <AdminBadge variant={groupScope ? 'kicker' : 'muted'}>
              {groupScope ? t('groupCopy', { group: groupScope.groupName }) : t('courseOwn')}
            </AdminBadge>
          ) : null}
          {vaultAgent && task.workplace === 'VAULT' ? <AdminBadge variant="muted">{t('inVault')}</AdminBadge> : null}
          {task.aiReady && vaultAgent ? <AdminBadge variant="warning">{t('aiReady')}</AdminBadge> : null}
        </div>
        <h2 style={{ margin: 0, fontSize: '1.15rem', lineHeight: 1.35 }}>{task.title}</h2>
        <p style={breadcrumbStyle}>
          {courseHref && refs.course ? (
            <a href={courseHref} target="_blank" rel="noreferrer" style={crumbLinkStyle}>
              {refs.course.title}
            </a>
          ) : (
            t('unknownCourse')
          )}
          {versionHref && refs.version ? (
            <>
              {' › '}
              <a href={versionHref} target="_blank" rel="noreferrer" style={crumbLinkStyle}>
                {refs.version.label}
              </a>
            </>
          ) : null}
          {lessonEditHref && refs.lesson ? (
            <>
              {' › '}
              <a href={lessonEditHref} target="_blank" rel="noreferrer" style={crumbLinkStyle}>
                {t('lesson', { position: refs.lesson.position, title: refs.lesson.title })}
              </a>
            </>
          ) : null}
        </p>

        {canWork && improveHref ? (
          <div style={{ marginTop: '0.9rem' }}>
            {/* The path's next step (below) leads into the lesson too: then this one isn't the primary. */}
            <AdminButton href={improveHref} size="compact" tone={path?.next?.href ? 'secondary' : 'primary'} data-testid="open-in-lesson">
              {t('openInLesson')}
            </AdminButton>
          </div>
        ) : null}

        {/* Where it is on its way to the learners, and the one thing to do next. */}
        {path ? (
          <div style={{ marginTop: '0.9rem' }}>
            <RevisionPathBar path={path} label={pathWords('label')} doneLabel={pathWords('doneAll')} targetsLabel={pathWords('targets.label')} />
          </div>
        ) : null}

        {task.sourceComment ? (
          <Section title={t('feedback.title')}>
            <p style={quoteStyle}>{t('details.quote', { text: task.sourceComment.selectedText })}</p>
            <p style={valueStyle}>{task.sourceComment.body}</p>
          </Section>
        ) : null}

        {improveHref ? (
          // Planned in the lesson, with AI: here it's read, and changed there.
          <Section
            id="plan"
            title={t('plan.title')}
            hint={[vaultAgent ? t('plan.readHintVault') : t('plan.readHint'), task.planUpdatedAt ? t('plan.updatedOn', { date: date(task.planUpdatedAt) }) : null]
              .filter(Boolean)
              .join(' · ')}
            aside={
              canWork ? (
                <Link href={improveHref} style={crumbLinkStyle}>
                  {t('plan.changeInLesson')}
                </Link>
              ) : null
            }
          >
            {task.plan?.trim() ? <p style={planStyle}>{planBody(task.plan)}</p> : <p style={hintStyle}>{t('plan.none')}</p>}
          </Section>
        ) : (
          <Section
            id="plan"
            title={t('plan.title')}
            hint={
              vaultAgent
                ? task.planUpdatedAt
                  ? t('plan.hintUpdated', { date: date(task.planUpdatedAt) })
                  : t('plan.hint')
                : task.planUpdatedAt
                  ? t('plan.hintAppUpdated', { date: date(task.planUpdatedAt) })
                  : t('plan.hintApp')
            }
          >
            <TaskPlanEditor
              taskId={task.id}
              initialPlan={task.plan ?? ''}
              canEdit={canWork}
              aiEnabled={aiEnabled}
              initialDraft={aiDraft}
              isGroupTask={Boolean(groupScope)}
              courseReachable={places.courseReachable}
              aiExtra={ui.TaskAi ? <ui.TaskAi taskId={task.id} follow /> : null}
            />
          </Section>
        )}

        {record?.saved.length || record?.waiting.length || task.status === TaskStatus.DONE ? (
          <Section id="what-changed" title={recordWords('title')}>
            <WhatChanged taskId={task.id} record={record} />
          </Section>
        ) : null}

        <Section title={t('whose.title')}>
          <div style={calloutStyle}>
            {groupScope && places.toCourse ? (
              <p style={valueStyle}>
                {t.rich('whose.both', {
                  group: groupScope.groupName,
                  link: (chunks) => (
                    <Link href={`/admin/courses/groups/${groupScope.groupId}`} style={crumbLinkStyle}>
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            ) : groupScope ? (
              <>
                <p style={valueStyle}>
                  {t.rich('whose.group', {
                    group: groupScope.groupName,
                    link: (chunks) => (
                      <Link href={`/admin/courses/groups/${groupScope.groupId}`} style={crumbLinkStyle}>
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>

                {task.proposedForCore ? (
                  <p style={{ ...valueStyle, color: 'rgba(var(--foreground-rgb), 0.72)' }}>
                    {t.rich('whose.alreadySuggested', {
                      title: task.proposedForCore.title,
                      status: statusLabel(task.proposedForCore.status),
                      task: (chunks) =>
                        canSeeCore && task.proposedForCore ? (
                          <Link href={`/admin/tasks/${task.proposedForCore.id}`} style={crumbLinkStyle}>
                            {chunks}
                          </Link>
                        ) : (
                          <strong>{chunks}</strong>
                        ),
                    })}
                  </p>
                ) : !canWork ? null : (
                  <>
                    <p style={{ ...hintStyle, margin: '0 0 0.2rem' }}>{t('whose.suggestHint')}</p>
                    <form action={proposeForCoreAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <AdminButton type="submit" size="compact">
                        {t('whose.suggest')}
                      </AdminButton>
                    </form>
                  </>
                )}
              </>
            ) : (
              <p style={valueStyle}>{t('whose.course')}</p>
            )}

            {task.proposedFrom ? (
              <p style={{ ...valueStyle, color: 'rgba(var(--foreground-rgb), 0.72)' }}>
                {t.rich('whose.suggestedFrom', {
                  title: task.proposedFrom.title,
                  status: statusLabel(task.proposedFrom.status),
                  task: (chunks) =>
                    task.proposedFrom ? (
                      <Link href={`/admin/tasks/${task.proposedFrom.id}`} style={crumbLinkStyle}>
                        {chunks}
                      </Link>
                    ) : (
                      chunks
                    ),
                })}
              </p>
            ) : null}
          </div>
          {refs.lesson ? (
            <div style={{ marginTop: '0.75rem' }}>
              <ImprovementPlaces
                taskId={task.id}
                lessons={places.lessons}
                addable={places.addable}
                canWork={canWork}
                toCourse={places.toCourse}
              />
            </div>
          ) : null}
        </Section>

        <Section id="status" title={t('workflow.title')} hint={t('workflow.hint')}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1.5rem',
              alignItems: 'start',
              maxWidth: 620,
            }}
          >
            {canWork ? (
              <>
                <TaskStatusControls taskId={task.id} status={task.status} />
                <TaskAssigneeControl taskId={task.id} assignee={task.assignee} users={users} />
              </>
            ) : (
              <p style={valueStyle} data-testid="task-read-only">
                {task.assignee
                  ? t('workflow.assigned', { status: statusLabel(task.status), name: task.assignee.name })
                  : t('workflow.unassigned', { status: statusLabel(task.status) })}
              </p>
            )}
          </div>
          {/* The handoff flag rides along to the vault with the task, once it is In progress. */}
          {canWork && vaultAgent ? (
            <div style={{ marginTop: '1rem', maxWidth: 620 }}>
              <TaskAiReadyControl taskId={task.id} aiReady={task.aiReady} />
            </div>
          ) : null}
        </Section>

        <Section title={t('instructions.title')}>
          {!canWork ? (
            <p style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{task.description || t('instructions.none')}</p>
          ) : (
          <details>
          <summary style={{ cursor: 'pointer', color: 'rgba(var(--foreground-rgb), 0.72)', fontSize: '0.88rem' }}>
            {task.description ? t('instructions.show') : t('instructions.add')}
          </summary>
          <p style={{ ...hintStyle, marginTop: '0.5rem' }}>{t('instructions.hint')}</p>
          <form action={updateTaskDescriptionAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <textarea
              name="description"
              defaultValue={task.description ?? ''}
              maxLength={8000}
              placeholder={t('instructions.placeholder')}
              style={textareaStyle}
              aria-label={t('instructions.title')}
            />
            <div style={{ marginTop: '0.5rem' }}>
              <AdminButton type="submit" size="compact">
                {t('instructions.save')}
              </AdminButton>
            </div>
          </form>
          </details>
          )}
        </Section>

        {task.status === TaskStatus.IGNORED && canDelete ? (
          <Section title={t('clear.title')} hint={t('clear.hint')}>
            <TaskDeleteControl taskId={task.id} title={task.title} returnHref={boardHref} />
          </Section>
        ) : canDelete ? (
          <Section title={t('delete.sectionTitle')} hint={t('delete.hint')}>
            <TaskDeleteControl taskId={task.id} title={task.title} returnHref={boardHref} withFeedback />
          </Section>
        ) : null}

        <Section title={t('details.title')}>
          <div style={metaGridStyle}>
            <div>
              <p style={labelStyle}>{t('details.proposedBy')}</p>
              <p style={valueStyle}>{task.proposerName ?? t('details.unknown')}</p>
            </div>
            <div>
              <p style={labelStyle}>{t('details.timeline')}</p>
              <p style={valueStyle}>
                {t('details.created', { date: date(task.createdAt) })}
                {'\n'}
                {t('details.updated', { date: date(task.updatedAt) })}
                {task.completedAt ? `\n${t('details.completed', { date: date(task.completedAt) })}` : ''}
              </p>
            </div>
          </div>

        </Section>
      </AdminSectionCard>

      <AdminSectionCard kicker={t('discussion.kicker')} title="">
        {discussion.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            {discussion.map((note) => (
              <div
                key={note.id}
                style={{
                  display: 'flex',
                  gap: '0.6rem',
                  padding: '0.6rem 0.75rem',
                  borderRadius: 9,
                  background: 'rgba(var(--foreground-rgb), 0.04)',
                  border: '1px solid rgba(var(--foreground-rgb), 0.08)',
                }}
              >
                <UserAvatar name={note.authorName} imageUrl={note.authorAvatarUrl} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      marginBottom: '0.3rem',
                      fontSize: '0.75rem',
                      color: 'rgba(var(--foreground-rgb), 0.6)',
                    }}
                  >
                    <strong style={{ color: 'rgb(var(--foreground-rgb))' }}>
                      {note.authorName}
                    </strong>
                    <span>·</span>
                    <span>{date(note.createdAt)}</span>
                  </div>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{note.body}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p
            style={{
              margin: '0 0 1rem',
              color: 'rgba(var(--foreground-rgb), 0.55)',
              fontSize: '0.85rem',
            }}
          >
            {t('discussion.empty')}
          </p>
        )}

        {canWork ? (
        <form action={addTaskCommentAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <textarea
            name="body"
            required
            maxLength={4000}
            placeholder={t('discussion.placeholder')}
            aria-label={t('discussion.label')}
            style={textareaStyle}
          />
          <div style={{ marginTop: '0.6rem' }}>
            <AdminButton type="submit" size="compact">
              {t('discussion.add')}
            </AdminButton>
          </div>
        </form>
        ) : null}
      </AdminSectionCard>
    </>
  );
}
