/** A demo lesson: its arc (by position), title, address, short description and Markdown text. */
export type DemoLesson = { arc: number; title: string; slug: string; short: string; md: string };

/** An arc: title and description. */
export type DemoArc = [title: string, description: string];

/**
 * A group reading a course's published version, with learner signals spread over its dates.
 * Days count back from today (negative = in the future). `answered`: lessons answered so far;
 * `notYet`: the chance of "Not yet" per lesson; `hard`: the hardest section per lesson (by
 * position); `notes`: words after "Not yet" per lesson.
 */
export type DemoCohort = {
  name: string;
  slug: string;
  size: number;
  startDaysAgo: number;
  endDaysAgo: number;
  answered: number;
  notYet: number[];
  hard: Record<number, number>;
  notes: Record<number, string[]>;
  /** The halfway check (MID) or end-of-course survey (END): who answered, the usual score, words. */
  survey?: { kind: 'MID' | 'END'; share: number; mean: number; improve: number[]; helped: string[]; change: string[] };
};

/** A learner's comment on a passage (lesson and member by position); with `task`, made into a task. */
export type DemoFeedback = {
  lesson: number;
  cohort: number;
  member: number;
  passage: string;
  body: string;
  task?: { status: 'TODO' | 'IN_PROGRESS'; plan: string | null };
};

/** A published course with its groups and feedback. */
export type DemoCourse = {
  title: string;
  slug: string;
  summary: string;
  outcome: string;
  tags: string[];
  publishedDaysAgo: number;
  arcs: DemoArc[];
  lessons: DemoLesson[];
  cohorts: DemoCohort[];
  feedback: DemoFeedback[];
};
