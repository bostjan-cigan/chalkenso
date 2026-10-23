/**
 * Entity kinds a user grant can be scoped to. The grant columns are free-form (table-agnostic), so
 * adding a new entity later means adding a value here and teaching `grantCovers` + the admin UI how
 * to resolve it — no schema migration required. Client-safe (no server imports).
 */
export const GRANT_ENTITY_TYPES = {
  /** Everything. Singleton scope: `entityId` is always `*`. */
  ALL: 'all',
  /** Obsidian content sync (blog posts, projects). Singleton scope: `entityId` is always `content`. */
  CONTENT: 'content',
  /**
   * A course (entityId = course id, or `*` for every course now and later): its versions (core and
   * group copies), its groups and their learners' feedback, tasks and insights.
   */
  COURSE: 'course',
  CURRICULUM_VERSION: 'curriculum_version',
  /** One admin (CRM) area, keyed by `ADMIN_SECTIONS`. */
  ADMIN_SECTION: 'admin_section',
  /**
   * A course group (entityId = group id): the group page, roster and links, its own curriculum copy
   * when it is feedback-driven, and its learners' feedback and tasks. Instructors also read the
   * version their group is assigned, but never edit the core curriculum.
   */
  GROUP: 'group',
} as const;

/** The only entity id an `all` grant is ever scoped to. */
export const ALL_GRANT_ENTITY_ID = '*';

/** A `course` grant on this id covers every course in the organisation, now and later. */
export const ALL_COURSES_ENTITY_ID = '*';

/** The only entity id a `content` grant is ever scoped to. */
export const CONTENT_GRANT_ENTITY_ID = 'content';

export type GrantEntityType = (typeof GRANT_ENTITY_TYPES)[keyof typeof GRANT_ENTITY_TYPES];

/**
 * Admin (CRM) areas a user can be granted via an `admin_section` grant (entityId = section key):
 * READ opens the section, WRITE allows its edit actions, DELETE its delete actions. Sections that are
 * not `grantable` stay super-admin only — even for `all` grants — until their pages are ready to be
 * shared; flipping the flag (and guarding the pages with `requireSection`) opens them up.
 */
export const ADMIN_SECTIONS = {
  courses: { label: 'Courses', href: '/admin/courses', grantable: true },
  groups: { label: 'Groups', href: '/admin/courses/groups', grantable: true },
  comments: { label: 'Feedback', href: '/admin/courses/comments', grantable: true },
  tasks: { label: 'Tasks', href: '/admin/tasks', grantable: true },
  users: { label: 'Team', href: '/admin/team', grantable: true },
} as const;

export type AdminSectionKey = keyof typeof ADMIN_SECTIONS;

/** The CRM (Course Management) sections, in navigation order. */
export const CRM_SECTION_KEYS = ['courses', 'groups', 'comments'] as const satisfies readonly AdminSectionKey[];

export function isAdminSectionKey(value: string): value is AdminSectionKey {
  return Object.prototype.hasOwnProperty.call(ADMIN_SECTIONS, value);
}

export function isGrantableAdminSection(value: string): value is AdminSectionKey {
  return isAdminSectionKey(value) && ADMIN_SECTIONS[value].grantable;
}
