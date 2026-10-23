export const crmModules = [
  {
    name: 'Course Management',
    status: 'Mocked now',
    description: 'Courses, lessons, markdown import.',
    detail: 'Includes image upload warnings.',
    href: '/admin/courses',
  },
  {
    name: 'Media Library',
    status: 'Planned next',
    description: 'Upload and reuse lesson images.',
    detail: 'Next step after course editing.',
    href: '',
  },
  {
    name: 'Cohorts & Contacts',
    status: 'Planned later',
    description: 'Basic student and cohort tracking.',
    detail: 'Can wait until publishing is stable.',
    href: '',
  },
];

export const workflowSteps = [
  {
    title: 'Create a course shell',
    description: 'Title, slug, audience, summary.',
  },
  {
    title: 'Paste lesson markdown from Obsidian',
    description: 'Keep the raw markdown visible.',
  },
  {
    title: 'Resolve referenced images',
    description: 'Flag missing uploads immediately.',
  },
  {
    title: 'Review and publish',
    description: 'Final pass on order, assets, and copy.',
  },
];

export const mockScope = [
  'Real admin login.',
  'DB-backed auth.',
  'Course editor + lesson flow.',
  'Markdown image warnings.',
];

export const courseStats = [
  {
    label: 'Courses in draft',
    value: '3',
    note: '2 ready for structure review',
  },
  {
    label: 'Lessons staged',
    value: '21',
    note: '5 imported from Obsidian this week',
  },
  {
    label: 'Assets pending upload',
    value: '7',
    note: 'Detected from markdown image references',
  },
  {
    label: 'Next release window',
    value: 'April',
    note: 'Mock timeline only',
  },
];

export const courses = [
  {
    title: 'Practical React Patterns',
    slug: 'practical-react-patterns',
    status: 'Selected',
    lessons: 8,
    audience: 'Frontend engineers',
    update: 'Updated 2h ago',
  },
  {
    title: 'Shipping Better APIs',
    slug: 'shipping-better-apis',
    status: 'Draft',
    lessons: 6,
    audience: 'Backend teams',
    update: 'Updated yesterday',
  },
  {
    title: 'Technical Leadership Systems',
    slug: 'technical-leadership-systems',
    status: 'Outline only',
    lessons: 4,
    audience: 'Leads and mentors',
    update: 'New mock',
  },
];

export const lessonOutline = [
  {
    title: 'Welcome and setup',
    status: 'Ready',
    duration: '06 min',
    source: 'obsidian/react-patterns/01-welcome.md',
  },
  {
    title: 'Modeling resilient state',
    status: 'Images missing',
    duration: '18 min',
    source: 'obsidian/react-patterns/02-state-models.md',
  },
  {
    title: 'Async boundaries that stay readable',
    status: 'Review',
    duration: '14 min',
    source: 'obsidian/react-patterns/03-async-boundaries.md',
  },
  {
    title: 'Component extraction rules',
    status: 'Draft',
    duration: '11 min',
    source: 'obsidian/react-patterns/04-component-extraction.md',
  },
];

export const uploadQueue = [
  {
    asset: 'react-state-flow.png',
    lesson: 'Modeling resilient state',
    origin: '![State flow](assets/react-state-flow.png)',
  },
  {
    asset: 'async-checklist.webp',
    lesson: 'Async boundaries that stay readable',
    origin: '![Checklist](assets/async-checklist.webp)',
  },
  {
    asset: 'component-smells.jpeg',
    lesson: 'Component extraction rules',
    origin: '![Smells](assets/component-smells.jpeg)',
  },
];

export const publishingChecklist = [
  'Summary reviewed.',
  'Lesson order checked.',
  'Markdown preview checked.',
  'All images uploaded or removed.',
];

export const sampleMarkdown = `# Modeling resilient state

Good course lessons usually start with a concrete framing story, then move into patterns and tradeoffs.

## What we want from state

- Clear ownership
- Predictable transitions
- Easy debugging

![State flow](assets/react-state-flow.png)

## A practical rule

Prefer modeling transitions explicitly when a lesson needs to explain why something changed, not just what changed.
`;
