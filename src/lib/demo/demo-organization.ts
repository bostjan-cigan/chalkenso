import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { TransactionClient } from '@/lib/prisma';
import { learnerLabel } from '@/lib/learner-label';
import { DEMO_COURSES } from './courses';
import type { DemoArc, DemoCohort, DemoCourse, DemoLesson } from './types';
import { WEB_DEVELOPMENT_ARCS, WEB_DEVELOPMENT_LESSONS } from './web-development';

/**
 * The content of a demo organisation: five courses that show the product, written into the
 * organisation's rows (every page reads from there). Web Development II is the flagship: a
 * published v1 and a draft v2, a feedback-driven group copy, past and running groups,
 * learner feedback, instructor notes, tasks with plans, a revised lesson with its before and after,
 * a check question, answers, reading visits, surveys and taught marks. Four shorter courses
 * (`courses.ts`) add bigger groups, finished and running, so the pages that sum groups up have
 * something to say. Learners are fictional; no accounts are made.
 *
 * Used for an edition's demo organisations and by `yarn db:seed-demo`; both pass their own
 * transaction. It imports nothing from the app at runtime, so the seed script can bundle it.
 */

const DAY = 86_400_000;

/** The app's database client or a transaction of it (types only: the seed script passes its own). */
type Db = TransactionClient;
type Lesson = { id: string; title: string; position: number; markdownContent: string };
type Version = { version: { id: string }; lessons: Lesson[] };
type Learner = { member: { id: string; fullName: string }; link: { id: string } };

export type DemoPerson = { id: string; firstName: string | null; lastName: string | null; identifier: string };
/** What `build` made: the courses, and the flagship's evening group (its instructor can be limited to it). */
export type DemoContent = { courseIds: string[]; eveningGroupId: string };

const token = () => randomBytes(24).toString('hex');

const personName = (person: DemoPerson) => [person.firstName, person.lastName].filter(Boolean).join(' ') || person.identifier || 'Instructor';

/** The paragraph of a lesson that holds a passage (what a learner sees around their selection). */
function contextOf(markdown: string, passage: string) {
  return (
    markdown
      .split('\n\n')
      .find((block) => block.includes(passage.slice(0, 30)))
      ?.replace(/[*`#>]/g, '')
      .trim() ?? null
  );
}

/** A repeatable stream of "random" numbers, so the demo looks the same every time. */
function randomStream(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** The lesson's sections (its ## and ### headings) with their word counts, as the learner script sees them. */
function sectionsOf(markdown: string) {
  const sections: Array<{ title: string; words: number }> = [];
  let fence = false;
  let current: { title: string; words: number } | null = null;
  let intro = 0;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^#{2,3}\s+/.test(line)) {
      current = { title: line.replace(/^#+\s+/, '').trim(), words: 0 };
      sections.push(current);
      continue;
    }
    const words = line.trim() ? line.trim().split(/\s+/).length : 0;
    // Text before the first heading belongs to the first section (as on learner pages).
    if (current) current.words += words;
    else intro += words;
  }
  if (sections.length) sections[0].words += intro;
  return sections.length ? sections : [{ title: 'The whole lesson', words: 300 }];
}

const dayOf = (time: number) => {
  const date = new Date(time);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const FIRST_NAMES = ['Ana', 'Blaž', 'Cvetka', 'Dejan', 'Eva', 'Filip', 'Gaja', 'Hugo', 'Iris', 'Jaka', 'Kaja', 'Luka', 'Meta', 'Nejc', 'Olga', 'Peter', 'Rok', 'Sara', 'Tina', 'Urban', 'Vesna', 'Zala', 'Žan', 'Lea', 'Miha', 'Neža', 'Tilen', 'Maja'];
const LAST_NAMES = ['Kos', 'Turk', 'Hribar', 'Mlakar', 'Bizjak', 'Kralj', 'Novak', 'Zupan', 'Vidmar', 'Golob', 'Horvat', 'Kranjc', 'Kovač', 'Potočnik', 'Kavčič', 'Rozman', 'Žagar', 'Petek', 'Kolar', 'Koren'];

/** A learner's made-up name: the same index always gives the same name. */
const learnerName = (index: number) => `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[(index * 7 + Math.floor(index / FIRST_NAMES.length)) % LAST_NAMES.length]}`;

export class DemoOrganization {
  private readonly now: number;
  private readonly instructor: DemoPerson;
  private readonly random = randomStream(42);
  private readonly courseIds: string[] = [];

  constructor(
    private readonly db: Db,
    private readonly organizationId: string,
    private readonly owner: DemoPerson,
    options: { instructor?: DemoPerson; now?: number } = {}
  ) {
    this.instructor = options.instructor ?? owner;
    this.now = options.now ?? Date.now();
  }

  /** Adds the five demo courses to the organisation. */
  async build(): Promise<DemoContent> {
    const eveningGroupId = await this.webDevelopment();
    for (const course of DEMO_COURSES) {
      await this.course(course);
    }
    return { courseIds: this.courseIds, eveningGroupId };
  }

  // ── Building blocks ────────────────────────────────────────────────────────────────────────

  /** `days` days ago (negative: in the future). */
  private at(days: number) {
    return new Date(this.now - days * DAY);
  }

  private pick<T>(list: T[]) {
    return list[Math.floor(this.random() * list.length)];
  }

  /** The course address `base` in the organisation, or `base-2`, `base-3`, … when it is taken. */
  private async freeSlug(base: string) {
    let slug = base;
    for (let n = 2; await this.db.course.findFirst({ where: { organizationId: this.organizationId, slug }, select: { id: true } }); n += 1) {
      slug = `${base}-${n}`;
    }
    return slug;
  }

  private async newCourse(details: { title: string; slug: string; summary: string; outcome: string; tags: string[] }) {
    const course = await this.db.course.create({
      data: { organizationId: this.organizationId, title: details.title, slug: await this.freeSlug(details.slug), summary: details.summary, outcome: details.outcome, tags: details.tags },
    });
    this.courseIds.push(course.id);
    return course;
  }

  /** A version with its arcs and lessons (published ones with their published copy). */
  private async version(
    courseId: string,
    data: Omit<Prisma.CurriculumVersionUncheckedCreateInput, 'courseId'>,
    content: { lessons: DemoLesson[]; arcs: DemoArc[] },
    baseLessons?: Lesson[]
  ): Promise<Version> {
    const version = await this.db.curriculumVersion.create({ data: { courseId, ...data } });
    const arcs = [];
    for (let index = 0; index < content.arcs.length; index += 1) {
      const [title, description] = content.arcs[index];
      arcs.push(await this.db.lessonArc.create({ data: { curriculumVersionId: version.id, title, description, position: index + 1 } }));
    }
    const published = data.status === 'PUBLISHED';
    const lessons: Lesson[] = [];
    for (let index = 0; index < content.lessons.length; index += 1) {
      const lesson = content.lessons[index];
      lessons.push(
        await this.db.lesson.create({
          data: {
            courseId,
            curriculumVersionId: version.id,
            arcId: arcs[lesson.arc].id,
            title: lesson.title,
            slug: lesson.slug,
            shortDescription: lesson.short,
            status: published ? 'PUBLISHED' : 'DRAFT',
            position: index + 1,
            markdownContent: lesson.md,
            revision: 1,
            baseLessonId: baseLessons?.[index]?.id ?? null,
            ...(published
              ? { publishedAt: new Date(), publishedRevision: 1, publishedTitle: lesson.title, publishedShortDescription: lesson.short, publishedMarkdownContent: lesson.md }
              : {}),
          },
          select: { id: true, title: true, position: true, markdownContent: true },
        })
      );
    }
    return { version, lessons };
  }

  /** Every published lesson's history starts with its first publication. */
  private async firstPublications(lessons: Lesson[], at: Date) {
    await this.db.lessonPublication.createMany({
      data: lessons.map((lesson) => ({ lessonId: lesson.id, revision: 1, title: lesson.title, markdownContent: lesson.markdownContent, publishedAt: at })),
    });
  }

  /** A group's learners, each with a personal link. */
  private async learners(groupId: string, versionId: string, size: number, offset: number, expiresAt: Date): Promise<Learner[]> {
    const learners: Learner[] = [];
    for (let index = 0; index < size; index += 1) {
      const member = await this.db.courseGroupMember.create({ data: { groupId, fullName: learnerName(index + offset), position: index + 1 }, select: { id: true, fullName: true } });
      const link = await this.db.accessLink.create({ data: { groupId, memberId: member.id, curriculumVersionId: versionId, token: token(), expiresAt }, select: { id: true } });
      learners.push({ member, link });
    }
    return learners;
  }

  /** Anonymous reading visits to one lesson by one learner (one or two). */
  private readings(lessonId: string, revision: number, groupId: string, markdown: string, hard: number | undefined, struggle: boolean, at: number, key: string) {
    const sections = sectionsOf(markdown);
    const visits = this.random() < 0.33 ? 2 : 1;
    const rows: Prisma.LessonReadingSessionCreateManyInput[] = [];
    for (let visit = 0; visit < visits; visit += 1) {
      const stopAt = this.random() < (struggle ? 0.28 : 0.1) ? Math.min(sections.length - 1, hard ?? Math.floor(this.random() * sections.length)) : sections.length - 1;
      const seconds = sections.map((section, index) => {
        if (index > stopAt) return 0;
        const expected = Math.max(5, (section.words / 238) * 60);
        return Math.round(expected * (0.6 + this.random() * 0.8) * (struggle && index === hard ? 2.2 : 1));
      });
      rows.push({
        lessonId, revision, groupId, sessionKey: `demo${key}${visit}x${Math.floor(this.random() * 1e9)}`, day: dayOf(at + visit * DAY), source: 'link',
        activeSeconds: seconds.reduce((sum, value) => sum + value, 0), sectionCount: sections.length, furthestSection: stopAt,
        finished: stopAt === sections.length - 1 && this.random() < 0.95,
        sectionSeconds: seconds, sectionReached: seconds.map((value) => (value >= 3 ? 1 : 0)),
        sectionRereads: sections.map((_, index) => (index === hard && struggle && this.random() < 0.5 ? 1 : this.random() < 0.06 ? 1 : 0)),
        sectionAiAsks: sections.map((_, index) => (index === hard && this.random() < 0.25 ? 1 : 0)),
        sectionCopies: sections.map(() => (this.random() < 0.35 ? 1 : 0)),
      });
    }
    return rows;
  }

  /** Survey answers from a share of a group's learners, scored around `mean`. */
  private surveys(
    groupId: string,
    courseId: string,
    versionId: string,
    learners: Learner[],
    survey: NonNullable<DemoCohort['survey']>,
    lessons: Lesson[],
    at: Date
  ): Prisma.CourseSurveyResponseCreateManyInput[] {
    const answering = learners.slice(0, Math.max(1, Math.round(learners.length * survey.share)));
    return answering.map(({ member, link }) => {
      const score = Math.min(5, Math.max(1, Math.round(survey.mean + (this.random() - 0.5) * 2.4)));
      const helped = score >= 4;
      const write = this.random() < 0.55;
      return {
        groupId, courseId, curriculumVersionId: versionId, memberId: member.id, accessLinkId: link.id,
        kind: survey.kind, score, answerPrompt: helped ? 'helped' : 'change',
        answer: write ? this.pick(helped ? survey.helped : survey.change) : null,
        quoteConsent: helped && write && this.random() < 0.6, named: false,
        improveLessonId: this.random() < 0.65 ? lessons[this.pick(survey.improve)]?.id ?? null : null,
        createdAt: at, updatedAt: at,
      };
    });
  }

  /** A learner's comment on a passage; `groupId` is the group they read in. The team sees "A learner · <group>". */
  private async comment(versionId: string, lesson: Lesson, groupId: string, learner: Learner, passage: string, body: string, at: Date) {
    const group = await this.db.courseGroup.findUnique({ where: { id: groupId }, select: { name: true } });
    return this.db.curriculumComment.create({
      data: {
        curriculumVersionId: versionId, lessonId: lesson.id, accessLinkId: learner.link.id, memberId: learner.member.id, groupId,
        proposerName: learnerLabel(group?.name), selectedText: passage, context: contextOf(lesson.markdownContent, passage), body, createdAt: at,
      },
    });
  }

  /**
   * The lesson's improvement, using these comments (they stay open until its change reaches
   * learners), linked to its lesson, version, course and group.
   */
  private async taskFrom(
    used: { id: string; body: string; proposerName: string } | Array<{ id: string; body: string; proposerName: string }>,
    links: { lesson: Lesson; versionId: string; courseId: string; groupId: string },
    task: { status: 'TODO' | 'IN_PROGRESS'; plan: string | null; aiReady?: boolean }
  ) {
    const comments = Array.isArray(used) ? used : [used];
    await this.db.task.create({
      data: {
        organizationId: this.organizationId,
        kind: 'curriculum',
        title: `Lesson ${links.lesson.position}: ${links.lesson.title}`,
        plan: task.plan,
        planUpdatedAt: task.plan ? this.at(1) : null,
        status: task.status,
        aiReady: task.aiReady ?? false,
        proposerName: comments[0].proposerName,
        createdById: this.owner.id,
        assigneeId: this.owner.id,
        entityLinks: {
          create: [
            { entityType: 'lesson', entityId: links.lesson.id, role: 'subject' },
            { entityType: 'curriculum_version', entityId: links.versionId, role: 'subject' },
            { entityType: 'course', entityId: links.courseId, role: 'subject' },
            ...comments.map((comment) => ({ entityType: 'curriculum_comment', entityId: comment.id, role: 'source', createdAt: this.at(2) })),
            { entityType: 'course_group', entityId: links.groupId, role: 'subject' },
          ],
        },
      },
    });
  }

  // ── The four shorter courses ───────────────────────────────────────────────────────────────

  private async course(spec: DemoCourse) {
    const course = await this.newCourse(spec);
    const core = await this.version(course.id, { label: 'v1', version: 1, status: 'PUBLISHED', publishedAt: this.at(spec.publishedDaysAgo) }, spec);
    await this.firstPublications(core.lessons, this.at(spec.publishedDaysAgo));
    const groups = [];
    for (let index = 0; index < spec.cohorts.length; index += 1) {
      const cohort = spec.cohorts[index];
      groups.push(await this.cohort(course.id, core, cohort, index * 9));
    }
    for (const item of spec.feedback) {
      const group = groups[item.cohort];
      const lesson = core.lessons[item.lesson];
      const comment = await this.comment(core.version.id, lesson, group.id, group.learners[item.member], item.passage, item.body, this.at(3));
      if (item.task) {
        await this.taskFrom(comment, { lesson, versionId: core.version.id, courseId: course.id, groupId: group.id }, item.task);
      }
    }
  }

  /** A group on a course's version, with answers, readings, surveys and taught marks over its dates. */
  private async cohort(courseId: string, core: Version, spec: DemoCohort, offset: number) {
    const start = this.now - spec.startDaysAgo * DAY;
    const end = this.now - spec.endDaysAgo * DAY;
    const group = await this.db.courseGroup.create({
      data: { courseId, name: spec.name, slug: spec.slug, curriculumVersionId: core.version.id, startsAt: new Date(start), endsAt: new Date(end) },
    });
    const learners = await this.learners(group.id, core.version.id, spec.size, offset, new Date(end + 30 * DAY));
    const span = (end - start) / core.lessons.length;
    const pulses: Prisma.LessonPulseCreateManyInput[] = [];
    const readings: Prisma.LessonReadingSessionCreateManyInput[] = [];
    core.lessons.slice(0, spec.answered).forEach((lesson, lessonIndex) => {
      const sections = sectionsOf(lesson.markdownContent);
      const hard = spec.hard[lessonIndex];
      const when = start + span * (lessonIndex + 0.5);
      learners.forEach(({ member, link }, learnerIndex) => {
        const at = Math.min(this.now - DAY, when + this.random() * 3 * DAY);
        if (this.random() < 0.85) {
          const notYet = this.random() < (spec.notYet[lessonIndex] ?? 0.1);
          const sectionIndex = this.random() < 0.7 ? (notYet ? hard ?? 0 : Math.max(0, sections.length - 1)) : null;
          pulses.push({
            lessonId: lesson.id, curriculumVersionId: core.version.id, groupId: group.id, memberId: member.id, accessLinkId: link.id,
            revision: 1, kind: 'EXPLAIN', answer: notYet ? 'NOT_YET' : 'YES',
            sectionIndex: sectionIndex !== null && sectionIndex < sections.length ? sectionIndex : null,
            sectionTitle: sectionIndex !== null && sections[sectionIndex] ? sections[sectionIndex].title : null,
            note: notYet && spec.notes[lessonIndex] && this.random() < 0.4 ? this.pick(spec.notes[lessonIndex]) : null,
            createdAt: new Date(at), updatedAt: new Date(at),
          });
        }
        readings.push(...this.readings(lesson.id, 1, group.id, lesson.markdownContent, hard, hard !== undefined, at, `${spec.slug}${lessonIndex}${learnerIndex}`));
      });
    });
    await this.db.lessonPulse.createMany({ data: pulses });
    await this.db.lessonReadingSession.createMany({ data: readings });
    if (spec.survey) {
      const at = spec.survey.kind === 'END' ? new Date(end - DAY) : new Date(Math.min(this.now - DAY, start + (end - start) / 2));
      await this.db.courseSurveyResponse.createMany({ data: this.surveys(group.id, courseId, core.version.id, learners, spec.survey, core.lessons, at) });
    }
    await this.db.lessonTaught.createMany({
      data: core.lessons.slice(0, spec.answered).map((lesson, lessonIndex) => ({
        groupId: group.id, lessonId: lesson.id, taughtAt: new Date(start + span * (lessonIndex + 0.4)),
        verdict: spec.hard[lessonIndex] !== undefined ? (lessonIndex % 2 ? 'LOST_THEM' : 'RAN_LONG') : 'SMOOTH',
        userId: this.owner.id,
      })),
    });
    return { id: group.id, learners };
  }

  // ── The flagship: Web Development II ───────────────────────────────────────────────────────

  /** Returns the evening group's id (its instructor can be limited to it). */
  private async webDevelopment() {
    const content = { lessons: WEB_DEVELOPMENT_LESSONS, arcs: WEB_DEVELOPMENT_ARCS };
    const course = await this.newCourse({
      title: 'Web Development II',
      slug: 'web-development-ii',
      summary: 'Build, test and ship one production web app end to end: a Recipe Keeper, by hand, so you can direct AI to build the next one.',
      outcome: 'a Recipe Keeper app',
      tags: ['Flask', 'React', 'Docker'],
    });
    const core = await this.version(course.id, { label: 'v1', version: 1, status: 'PUBLISHED', publishedAt: this.at(60) }, content);
    await this.version(course.id, { label: 'v2', version: 2, status: 'DRAFT' }, content, core.lessons);

    // The evening group reads its own copy and gives feedback on it.
    const evening = await this.db.courseGroup.create({
      data: {
        courseId: course.id, name: 'Evening group · Autumn 2026', slug: 'evening-autumn-2026', feedbackDriven: true,
        curriculumVersionId: core.version.id, startsAt: this.at(20), endsAt: this.at(-30), slackHandle: '#webdev-autumn',
      },
    });
    const copy = await this.version(
      course.id,
      { label: 'Autumn 2026', version: -1, status: 'PUBLISHED', publishedAt: this.at(20), ownerGroupId: evening.id, baseVersionId: core.version.id },
      content,
      core.lessons
    );
    await this.db.courseGroup.update({ where: { id: evening.id }, data: { curriculumVersionId: copy.version.id } });
    // Its instructor teaches it (the owner too, when there is no separate instructor).
    await this.db.courseGroupInstructor.create({ data: { groupId: evening.id, userId: this.instructor.id, createdById: this.owner.id } });
    await this.db.courseGroup.create({
      data: { courseId: course.id, name: 'Company in-house · Spring 2027', slug: 'company-spring-2027', curriculumVersionId: core.version.id, startsAt: this.at(-90), endsAt: this.at(-140) },
    });
    const eveningLearners: Learner[] = [];
    const eveningNames = ['Luka Kranjc', 'Nina Kos', 'Tim Horvat', 'Eva Zupan', 'Jure Golob', 'Sara Vidmar'];
    for (let index = 0; index < eveningNames.length; index += 1) {
      const fullName = eveningNames[index];
      const member = await this.db.courseGroupMember.create({ data: { groupId: evening.id, fullName, position: index + 1 }, select: { id: true, fullName: true } });
      const link = await this.db.accessLink.create({ data: { groupId: evening.id, memberId: member.id, curriculumVersionId: copy.version.id, token: token(), expiresAt: this.at(-60) }, select: { id: true } });
      eveningLearners.push({ member, link });
    }

    // Learner feedback and instructor notes on the copy; three are used in two lessons' improvements.
    const [l1, l2, l3] = copy.lessons;
    const feedback = [
      { lesson: l1, learner: 0, passage: 'The named volume keeps the database files outside the container, so your recipes survive a restart.', body: "I don't get why the data survives docker compose down. Isn't down supposed to delete everything?" },
      { lesson: l1, learner: 1, passage: 'docker compose up --build', body: 'On my Linux laptop this fails with "permission denied" on the Docker socket until I use sudo. Maybe add a note for Linux?' },
      { lesson: l2, learner: 2, passage: 'APIFlask validates the input against it and returns a 422 with a clear message when a field is missing, before your code runs.', body: 'Why 422 and not 400? We used 400 for everything at my last job.' },
      { lesson: l3, learner: 4, passage: 'A CSRF token, sent with every form and API call that changes data, proves the request came from your own pages.', body: 'Does this also apply when the React app calls the API in Part II, or only to forms?' },
    ];
    const comments = [];
    for (let index = 0; index < feedback.length; index += 1) {
      const item = feedback[index];
      comments.push(await this.comment(copy.version.id, item.lesson, evening.id, eveningLearners[item.learner], item.passage, item.body, this.at(6 - index)));
    }
    const notes = [
      { lesson: l1, author: this.owner, passage: 'Add one recipe by hand in', body: 'Ran 15 minutes over: half the room had never used psql. Show the docker compose exec command first.' },
      { lesson: l3, author: this.instructor, passage: 'Flask-Security-Too stores a session cookie after login.', body: 'Learners mixed up session cookies and tokens. A one-line comparison here would save ten minutes of questions.' },
    ];
    for (const item of notes) {
      comments.push(
        await this.db.curriculumComment.create({
          data: {
            curriculumVersionId: copy.version.id, lessonId: item.lesson.id, groupId: evening.id, authorUserId: item.author.id, isInstructorNote: true,
            proposerName: personName(item.author), selectedText: item.passage, context: contextOf(item.lesson.markdownContent, item.passage),
            body: item.body, createdAt: this.at(2),
          },
        })
      );
    }
    const links = { versionId: copy.version.id, courseId: course.id, groupId: evening.id };
    await this.taskFrom([comments[0], comments[4]], { ...links, lesson: l1 }, {
      status: 'IN_PROGRESS',
      aiReady: true,
      plan: 'In "Run Flask and Postgres with one command", add two sentences after the compose file: the named volume keeps Postgres data outside the container, so `docker compose down` removes the containers but not the volume (only `down -v` deletes it). Add a verify step: stop, start, check the recipe is still there.\n\nBefore "Add one recipe by hand in psql", add the command to open it: `docker compose exec db psql -U postgres`. Keep the timing: the 15 minutes come back from the shorter psql detour.\n\nScope: group and core',
    });
    await this.taskFrom(comments[2], { ...links, lesson: l2 }, { status: 'TODO', plan: null });

    await this.webDevelopmentSignals(course.id, core, copy, evening.id, eveningLearners);
    return evening.id;
  }

  /**
   * Learner signals on the flagship: two finished groups on v1 (Spring, before lesson 2 was revised;
   * Summer, after), a check question on lesson 3, and the evening group's first answers.
   */
  private async webDevelopmentSignals(courseId: string, core: Version, copy: Version, eveningId: string, eveningLearners: Learner[]) {
    const [c1, c2, c3, c4, c5] = core.lessons;
    await this.firstPublications([...core.lessons, ...copy.lessons], this.at(130));

    // Lesson 2 was revised after the Spring group struggled with it.
    const revisedText = c2.markdownContent.replace(
      '## ',
      '> [!tip] Check your work\n> Before you add PUT, run the GET and POST you have so far in the docs page at `/docs` and check both answer with 200.\n\n## '
    );
    const revisedAt = this.at(45);
    await this.db.lesson.update({ where: { id: c2.id }, data: { revision: 2, publishedRevision: 2, markdownContent: revisedText, publishedMarkdownContent: revisedText, publishedAt: revisedAt } });
    await this.db.lessonPublication.create({ data: { lessonId: c2.id, revision: 2, title: c2.title, markdownContent: revisedText, publishedAt: revisedAt } });

    // A check question on lesson 3, approved by the instructor.
    await this.db.lessonCheck.create({
      data: {
        lessonId: c3.id,
        question: 'After login, what tells the server who is making a request?',
        options: [
          { text: 'The session cookie the browser sends with every request', correct: true, misconception: null, sectionIndex: 1 },
          { text: 'The password, sent again with every request', correct: false, misconception: 'Thinks the password is sent each time', sectionIndex: 1 },
          { text: 'The CSRF token', correct: false, misconception: 'Mixes up the CSRF token and the session', sectionIndex: 2 },
        ],
        approvedRevision: 1,
        approvedAt: this.at(60),
        draftedBy: 'ai',
        createdById: this.instructor.id,
      },
    });

    const groups = [
      {
        name: 'Spring group · 2026', slug: 'spring-2026', size: 22, startDaysAgo: 125, endDaysAgo: 55,
        // Chance of "Not yet" per lesson: lesson 2 (before its revision) and lesson 3 were hard.
        notYet: [0.14, 0.55, 0.42, 0.16, 0.14],
        survey: { kind: 'END' as const, share: 0.65, mean: 3.8, improve: [1, 2, 2], helped: ['The check-your-work steps after every exercise meant I always knew I was on track.', 'Building one app the whole way through made everything connect.'], change: ['More time on authentication, it was rushed.', 'A cheat sheet for the Docker commands we use every week.'] },
        taught: ['SMOOTH', 'RAN_LONG', 'LOST_THEM', 'SMOOTH', 'SMOOTH'] as const,
      },
      {
        name: 'Summer group · 2026', slug: 'summer-2026', size: 20, startDaysAgo: 44, endDaysAgo: 4,
        notYet: [0.14, 0.12, 0.4, 0.16, 0.14],
        survey: { kind: 'END' as const, share: 0.7, mean: 4.5, improve: [2, 3], helped: ['Seeing the same recipe app grow from pages to an API to React.', 'The check-your-work steps after every exercise meant I always knew I was on track.'], change: ['More time on authentication, it was rushed.'] },
        taught: ['SMOOTH', 'SMOOTH', 'RAN_LONG', 'SMOOTH', 'SMOOTH'] as const,
      },
    ];
    const hardest: Record<string, number> = { [c2.id]: 2, [c3.id]: 1 };
    const helpedMost: Record<string, number> = { [c1.id]: 1, [c2.id]: 1, [c4.id]: 0, [c5.id]: 1 };
    const notes: Record<string, string[]> = {
      [c2.id]: ['The PUT example skipped how to send JSON from the docs page', 'I lost track after the update route'],
      [c3.id]: ['Session cookie vs token still confuses me', 'Why do we need CSRF if we have a login?'],
    };
    const answered = [c1, c2, c3, c4, c5];

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const spec = groups[groupIndex];
      const start = this.now - spec.startDaysAgo * DAY;
      const end = this.now - spec.endDaysAgo * DAY;
      const group = await this.db.courseGroup.create({
        data: { courseId, name: spec.name, slug: spec.slug, curriculumVersionId: core.version.id, startsAt: new Date(start), endsAt: new Date(end) },
      });
      await this.db.courseGroupInstructor.create({ data: { groupId: group.id, userId: this.owner.id, createdById: this.owner.id } });
      const learners = await this.learners(group.id, core.version.id, spec.size, 40 + groupIndex * 23, new Date(end + 30 * DAY));
      const pulses: Prisma.LessonPulseCreateManyInput[] = [];
      const readings: Prisma.LessonReadingSessionCreateManyInput[] = [];
      answered.forEach((lesson, lessonIndex) => {
        const when = start + ((end - start) * (lessonIndex + 0.5)) / answered.length;
        // Lesson 2 was revised between the groups: Spring read revision 1, Summer revision 2.
        const revision = lesson.id === c2.id && start > revisedAt.getTime() ? 2 : 1;
        const markdown = revision === 2 ? revisedText : lesson.markdownContent;
        const sections = sectionsOf(markdown);
        learners.forEach(({ member, link }, learnerIndex) => {
          const at = when + this.random() * 3 * DAY;
          if (lesson.id === c3.id && groupIndex === 1) {
            // Summer answered lesson 3's check question.
            const roll = this.random();
            const optionIndex = roll < 0.62 ? 0 : roll < 0.85 ? 2 : roll < 0.95 ? 1 : null;
            pulses.push({
              lessonId: lesson.id, curriculumVersionId: core.version.id, groupId: group.id, memberId: member.id, accessLinkId: link.id,
              revision, kind: 'CHECK', answer: null, optionIndex, notSure: optionIndex === null, correct: optionIndex === 0,
              sectionIndex: optionIndex === 2 ? 2 : optionIndex === 1 ? 1 : null, createdAt: new Date(at), updatedAt: new Date(at),
            });
          } else if (this.random() < 0.86) {
            const notYet = this.random() < spec.notYet[lessonIndex];
            const follow = this.random() < 0.7;
            const sectionIndex = follow ? (notYet ? hardest[lesson.id] ?? 0 : helpedMost[lesson.id] ?? 0) : null;
            pulses.push({
              lessonId: lesson.id, curriculumVersionId: core.version.id, groupId: group.id, memberId: member.id, accessLinkId: link.id,
              revision, kind: 'EXPLAIN', answer: notYet ? 'NOT_YET' : 'YES',
              sectionIndex: sectionIndex !== null && sectionIndex < sections.length ? sectionIndex : null,
              sectionTitle: sectionIndex !== null && sections[sectionIndex] ? sections[sectionIndex].title : null,
              note: notYet && notes[lesson.id] && this.random() < 0.35 ? this.pick(notes[lesson.id]) : null,
              createdAt: new Date(at), updatedAt: new Date(at),
            });
          }
          const hard = hardest[lesson.id];
          readings.push(...this.readings(lesson.id, revision, group.id, markdown, hard, revision === 1 && hard !== undefined, at, `${spec.slug}${lessonIndex}${learnerIndex}`));
        });
      });
      await this.db.lessonPulse.createMany({ data: pulses });
      await this.db.lessonReadingSession.createMany({ data: readings });
      await this.db.courseSurveyResponse.createMany({ data: this.surveys(group.id, courseId, core.version.id, learners, spec.survey, core.lessons, new Date(end - DAY)) });
      await this.db.lessonTaught.createMany({
        data: answered.map((lesson, lessonIndex) => ({
          groupId: group.id, lessonId: lesson.id, taughtAt: new Date(start + ((end - start) * (lessonIndex + 0.4)) / answered.length),
          verdict: spec.taught[lessonIndex], userId: lessonIndex % 2 ? this.owner.id : this.instructor.id,
        })),
      });
    }

    // The evening group, reading its own copy now: a few answers so far.
    const [e1, e2] = copy.lessons;
    const eveningPulses: Prisma.LessonPulseCreateManyInput[] = [];
    eveningLearners.forEach(({ member, link }, index) => {
      eveningPulses.push({ lessonId: e1.id, curriculumVersionId: copy.version.id, groupId: eveningId, memberId: member.id, accessLinkId: link.id, revision: 1, kind: 'EXPLAIN', answer: index === 0 ? 'NOT_YET' : 'YES', createdAt: this.at(12), updatedAt: this.at(12) });
      if (index < 3) {
        eveningPulses.push({ lessonId: e2.id, curriculumVersionId: copy.version.id, groupId: eveningId, memberId: member.id, accessLinkId: link.id, revision: 1, kind: 'EXPLAIN', answer: index === 1 ? 'NOT_YET' : 'YES', createdAt: this.at(5), updatedAt: this.at(5) });
      }
    });
    await this.db.lessonPulse.createMany({ data: eveningPulses });
  }
}
