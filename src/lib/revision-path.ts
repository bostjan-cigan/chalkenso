/**
 * Where an improvement (a task) is on its way from feedback to a published lesson, worked out from
 * what is already saved: the task's status and plan, the drafts made for it, and for each lesson it
 * changes, the change saved for it and whether learners see that yet. One step is current, and one
 * next action moves it on. Pure, for the improvement's page, the lesson screen and the Improvements
 * list alike (unit-tested in tests/e2e/unit-revision-path.mjs).
 */

export type PathStep = 'feedback' | 'plan' | 'changes' | 'published';
export type StepState = 'done' | 'current' | 'upcoming' | 'skipped';

/** One lesson the improvement changes (a group's copy, or the course's own). */
export type PathTarget = {
  lessonId: string;
  /** A draft of proposed changes for it: being written, or waiting for review (with how many changes). */
  draft: { state: 'working' | 'ready'; count: number | null } | null;
  /** The lesson revision saved for this improvement, if any. */
  changedRevision: number | null;
  /** The revision learners see (null: never published). */
  publishedRevision: number | null;
};

export type PathInput = {
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'IGNORED';
  hasPlan: boolean;
  /** A plan draft made in the app: being written, or waiting in the plan box. */
  planDraft: 'working' | 'ready' | null;
  aiEnabled: boolean;
  targets: PathTarget[];
};

/** What to do next, with the lesson it's about. */
export type PathAction =
  | { kind: 'writePlan' }
  | { kind: 'planDrafting' }
  | { kind: 'reviewPlanDraft' }
  | { kind: 'revise'; lessonId: string }
  | { kind: 'edit'; lessonId: string }
  | { kind: 'writing'; lessonId: string }
  | { kind: 'reviewChanges'; lessonId: string; count: number | null }
  | { kind: 'publish'; lessonId: string }
  | { kind: 'startAgain' };

export type RevisionPath = {
  steps: Array<{ step: PathStep; state: StepState }>;
  next: PathAction | null;
  /** Every lesson it changes saved, and learners see them. */
  finished: boolean;
};

const reached = (target: PathTarget) =>
  target.changedRevision !== null && target.publishedRevision !== null && target.publishedRevision >= target.changedRevision;

export function deriveRevisionPath(input: PathInput): RevisionPath {
  const { status, targets } = input;
  if (status === 'IGNORED') {
    return {
      steps: [
        { step: 'feedback', state: 'done' },
        { step: 'plan', state: input.hasPlan ? 'done' : 'upcoming' },
        { step: 'changes', state: 'upcoming' },
        { step: 'published', state: 'upcoming' },
      ],
      next: { kind: 'startAgain' },
      finished: false,
    };
  }

  const changed = targets.filter((target) => target.changedRevision !== null);
  const allChanged = targets.length > 0 && changed.length === targets.length;
  // Done by hand without a saved change: there is nothing to say about publishing.
  const doneByHand = status === 'DONE' && changed.length === 0;
  const changesDone = status === 'DONE' || allChanged;
  const allReached = changed.length > 0 && changed.every(reached);

  const planState: StepState = input.hasPlan ? 'done' : changesDone ? 'skipped' : 'current';
  const changesState: StepState = changesDone ? 'done' : input.hasPlan ? 'current' : 'upcoming';
  const publishedState: StepState = doneByHand ? 'skipped' : allReached && changesDone ? 'done' : changesDone ? 'current' : 'upcoming';

  let next: PathAction | null = null;
  if (planState === 'current') {
    next = input.planDraft === 'working' ? { kind: 'planDrafting' } : input.planDraft === 'ready' ? { kind: 'reviewPlanDraft' } : { kind: 'writePlan' };
  } else if (changesState === 'current') {
    const waiting = targets.find((target) => target.changedRevision === null && target.draft?.state === 'ready');
    const writing = targets.find((target) => target.changedRevision === null && target.draft?.state === 'working');
    const todo = targets.find((target) => target.changedRevision === null);
    if (waiting) next = { kind: 'reviewChanges', lessonId: waiting.lessonId, count: waiting.draft?.count ?? null };
    else if (writing) next = { kind: 'writing', lessonId: writing.lessonId };
    else if (todo) next = input.aiEnabled ? { kind: 'revise', lessonId: todo.lessonId } : { kind: 'edit', lessonId: todo.lessonId };
  } else if (publishedState === 'current') {
    const unpublished = changed.find((target) => !reached(target));
    if (unpublished) next = { kind: 'publish', lessonId: unpublished.lessonId };
  }

  return {
    steps: [
      { step: 'feedback', state: 'done' },
      { step: 'plan', state: planState },
      { step: 'changes', state: changesState },
      { step: 'published', state: publishedState },
    ],
    next,
    finished: changesDone && (allReached || doneByHand),
  };
}
