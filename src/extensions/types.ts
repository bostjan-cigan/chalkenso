import type { OrgPlan, OrgRole, PlanStatus } from '@prisma/client';
import type { MetadataRoute } from 'next';
import type { ComponentType, ReactNode } from 'react';
import type { IconType } from 'react-icons';
import type { GettingStartedCall } from '@/app/admin/getting-started/data';
import type { AdminNavAudience } from '@/app/admin/nav';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/messages';
import type { SessionUser } from '@/lib/admin-auth';
import type { AiKeyFallback } from '@/lib/ai-key';
import type { LessonEvidence } from '@/lib/ai';
import type { ExportPart, ExportScope } from '@/lib/export/types';

/**
 * What an edition adds to the shared app. The local edition's answers are in `*.local.ts(x)` next
 * to this file; the cloud edition's live with the cloud code, which only the private repository
 * has.
 */
export type ServerExtensions = {
  robots(): MetadataRoute.Robots;
  sitemap(): MetadataRoute.Sitemap;
  /** Whether /signup may create a new account with its own organisation. */
  isSignupOpen(): Promise<boolean>;
  /**
   * Where a platform admin works, outside any organisation: the edition's page for them. Null: the
   * edition has no such page, and platform admins use the app like anyone else.
   */
  platformAdminHome: string | null;
  /** Runs first on the sign-in page, before anything renders (it may redirect). */
  beforeLogin(): Promise<void>;
  /** Runs first on /signup, before anything renders (it may redirect). */
  beforeSignup(): void;
  /** The words above the sign-up form, in a language (the page follows the visitor's pick). */
  signupIntro(locale: Locale): Promise<{ kicker: string; intro: string }>;
  /**
   * Whether a public form's request (signing up, "Forgot your password?") comes from a bot, by the
   * edition's own check; the local edition never asks.
   */
  isBot(): Promise<boolean>;
  /**
   * The same check on Better Auth's own endpoints (signing in, "Forgot your password?"), through its
   * captcha plugin (src/lib/auth.ts): the verdict. Null where there's no check.
   */
  authBotCheck: (() => Promise<{ isBot: boolean }>) | null;
  /**
   * Whether owners and admins may set their organisation's own Anthropic API key (otherwise AI
   * uses the installation's ANTHROPIC_API_KEY only).
   */
  aiOrganizationKeys: boolean;
  /** Whether this organisation may set a key of its own (e.g. only on the plans that offer it). */
  ownAiKeyAllowed(organizationId: string): Promise<boolean>;
  /**
   * How Chalkenso works' one action for this person: `connect` their own Claude where that's how AI
   * works and they haven't yet, else `lesson` (try it on the lesson with the most feedback).
   */
  howItWorksAction(organizationId: string, userId: string): Promise<'connect' | 'lesson'>;
  /**
   * Getting started's call for this member, where the edition offers one: its words, a photo and
   * when one is booked. Null where there's none (the local edition).
   */
  gettingStartedCall(viewer: SessionUser): Promise<GettingStartedCall | null>;
  /**
   * The key AI uses when the organisation has none of its own (or Anthropic refused it): the
   * installation's key in the local edition; an edition may have its own rules (e.g. a monthly cap).
   * Otherwise why there is none.
   */
  aiKeyFallback(organizationId: string | null): Promise<AiKeyFallback>;
  /**
   * The AI the edition includes for the organisation (e.g. in a plan), for Settings → AI's bar: the
   * cap (US cents, null: no cap) for this month, or for a trial (`forTrial`), spend so far and what's
   * left of `topUpMicros` (micros of a dollar), about how many drafts the cap covers, and `canTopUp`.
   * Null where none is included (as in the local edition, which runs on the installation's key).
   */
  aiAllowance(
    organizationId: string
  ): Promise<{ capCents: number | null; forTrial: boolean; spentMicros: number; topUpMicros: number; drafts: number | null; canTopUp: boolean } | null>;
  /** Whether people can connect their own Claude to the app. */
  claudeConnector: boolean;
  /**
   * Where the guides are for Settings → Tokens' Obsidian card: the plugin's (installing it, connecting
   * a vault) and Claude Code's in a vault. Null: no such guide.
   */
  obsidianGuides: { plugin: string | null; claude: string | null };
  /**
   * What learners struggled with in a lesson, for the signed-in person's in-app AI; null when there
   * is none, or the edition gathers none.
   */
  lessonEvidence(lessonId: string): Promise<LessonEvidence | null>;
  /** Who an organisation can have, and what the roles are called. */
  team: TeamPolicy;
  /**
   * After lessons are published, for the edition's own follow-up. Runs inside the request; anything
   * slow belongs in `after()`.
   */
  onLessonsPublished(curriculumVersionId: string, lessonIds: string[]): void;
  /**
   * After published lessons left a version: deleted, or the version went back to draft. The lessons
   * come as they were, since they may be gone. Runs inside the request, like `onLessonsPublished`.
   */
  onLessonsUnpublished(curriculumVersionId: string, lessons: Array<{ id: string; slug: string }>): void;
  /**
   * After a course's settings, cover, partners or join button changed, or a partner it uses did.
   * Runs inside the request, like `onLessonsPublished`.
   */
  onCourseUpdated(courseIds: string[]): void;
  /**
   * Where the organisation's learner links point: a URL with `{token}` in it, as the edition sets it,
   * or null for this installation's own `/l/course/<token>`.
   */
  learnerLinkTemplate(organizationId: string): Promise<string | null>;
  /**
   * What a learner page starts from when the edition adds its own to this personal learner link;
   * null when it doesn't. Opaque to shared code: it only hands it to `learnerUi.Provider`.
   */
  learnerSignals(token: string): Promise<unknown | null>;
  /**
   * Whether the organisation's learner pages have closed (e.g. some time after its plan ended).
   * Learner links of a closed organisation say the course is no longer available; the team keeps the
   * app. Asked on every learner request, so it must be cheap. The local edition never closes them.
   */
  learnerPagesClosed(organizationId: string): Promise<boolean>;
  /**
   * The plans someone picks from when signing up, in a language (null: no choice, the local
   * edition), with the one picked first; `afterSignup` is where they go next.
   */
  signupPlans:
    | ((locale: Locale) => Promise<{ options: Array<{ value: string; label: string; hint: string }>; defaultValue: string }>)
    | null;
  afterSignup(plan: string): string;
  /**
   * The plan an organisation someone makes themselves starts on (sign-up, a new organisation): from
   * the one they picked (`requested`, as sent; anything else gets the default), or the local
   * edition's own.
   */
  newOrganizationPlan(requested?: string | null): { plan: OrgPlan; planStatus: PlanStatus; trialEndsAt: Date | null };
  /**
   * The edition's own parts of "Export everything" (src/lib/export) for one person's export; none in
   * the local edition. Made before the download starts (they load their words then), so they only
   * read the database while it streams.
   */
  exportParts(scope: ExportScope): Promise<ExportPart[]>;
  /**
   * What the organisation may have (e.g. a plan's limits; the local edition is never limited):
   * `seat` before an invite is made (`claimingInvite`: when one is used), `classes` before a class
   * is made or its dates change (`groupId` for an existing one).
   */
  limits: {
    seat(organizationId: string, options?: { claimingInvite?: boolean }): Promise<LimitCheck>;
    classes(
      organizationId: string,
      candidate: { groupId?: string | null; startsAt: Date | null; endsAt: Date | null }
    ): Promise<LimitCheck>;
  };
  /**
   * Whether the organisation is paused between classes: its learner links only read (no feedback,
   * notes or answers) and AI is off; `limits` refuses new groups and invites. The local edition never
   * pauses.
   */
  isPaused(organizationId: string): Promise<boolean>;
};

/** A limit check: fine, or why not (a sentence for the person, with what to do). */
export type LimitCheck = { ok: true } | { ok: false; code: string; message: string };

/** Each role's name ("Instructor"), as part of a sentence ("an instructor") and what it can do. */
export type TeamRoleWords = Record<OrgRole, { label: string; inSentence: string; hint: string }>;

export type TeamPolicy = {
  /** The roles' words in English (what isn't in the reader's language yet); `words` has them in any. */
  roles: TeamRoleWords;
  /**
   * Each role as part of a sentence, in a language: for the invite page, which follows the visitor's
   * pick (the app's own pages, in English, use `roles`).
   */
  rolesInSentence(locale: Locale): Promise<Record<OrgRole, string>>;
  /**
   * The roles' words and the Team page's line under its title, in a language (`account.team.policy`):
   * the Team page's, in the reader's.
   */
  words(locale: Locale): Promise<{ roles: TeamRoleWords; description: string }>;
  /** The roles an invite can give, the default first. */
  inviteRoles: OrgRole[];
  /** Whether owners and admins can change someone's role after they joined. */
  roleChanges: boolean;
  /** The line under the Team page's title, in English (`words` has it in any language). */
  description: string;
};

/**
 * Labels of the app's places and tabs are keys of their words in `app.nav`
 * (src/i18n/messages/<locale>/app.json), so the frame shows them in the reader's language.
 */
type NavWords = Messages['app']['nav'];
/** A sidebar place's name: its key in `app.nav.places`. */
export type AdminNavLabel = keyof NavWords['places'];
/** The platform admin's sidebar: an item's key in `app.nav.platform.items`, a heading's in `.headings`. */
export type PlatformNavLabel = keyof NavWords['platform']['items'];
export type PlatformNavHeading = keyof NavWords['platform']['headings'];
/** A Settings tab's name: its key in `app.nav.settings.tabs`. */
export type SettingsTabLabel = keyof NavWords['settings']['tabs'];
/** A course tab's name: its key in `app.nav.course.tabs`. */
export type CourseTabLabel = keyof NavWords['course']['tabs'];

export type AdminNavExtra = {
  key: string;
  label: AdminNavLabel;
  href: string;
  audience: AdminNavAudience;
  icon: IconType;
  /** A count next to the label (server component; renders nothing when there is nothing to count). */
  Count?: ComponentType;
};

/** A heading in the platform admin's sidebar and its pages (a group without a label comes first, unheaded). */
export type PlatformNavGroup = {
  label: PlatformNavHeading | null;
  items: Array<{
    key: string;
    label: PlatformNavLabel;
    href: string;
    icon: IconType;
    /** A count next to the label (server component; renders nothing when there is nothing to count). */
    Count?: ComponentType;
  }>;
};

export type SettingsTabExtra = {
  key: string;
  label: SettingsTabLabel;
  href: string;
  icon: IconType;
  /** Every member has it (their own part of it), not only owners and admins. */
  members?: boolean;
};

export type CourseTabExtra = {
  key: string;
  label: CourseTabLabel;
  /** Under the course: `/admin/courses/<id>/<segment>`. */
  segment: string;
  icon: IconType;
};

export type UiExtensions = {
  /** Extra tags inside <head> on every page. */
  RootHead: ComponentType | null;
  /** A bar above every app page, for this viewer (null renders nothing). */
  AdminBanner: ComponentType<{ viewer: SessionUser }> | null;
  /** App sections this edition adds after the shared ones. */
  adminNav: AdminNavExtra[];
  /**
   * The platform admin's sidebar, where the edition has a page for them (`platformAdminHome`): its
   * own sections, outside any organisation.
   */
  platformNav: PlatformNavGroup[];
  /**
   * Extra sections on a group's page (server component), per tab (`place`): its In class and
   * Learner feedback tabs, which show only with this, and its Feedback (above the list). `canManage`
   * = the group's settings (edit rights on its course), `canWork` = its feedback and tasks (Feedback
   * & tasks on).
   */
  GroupPanels: ComponentType<{
    groupId: string;
    canManage: boolean;
    canWork: boolean;
    place: 'inClass' | 'feedback' | 'learnerFeedback';
  }> | null;
  /** Extra sections below a lesson's editor (server component). */
  LessonPanels: ComponentType<{ lessonId: string }> | null;
  /**
   * The edition's own way to work on an improvement (server component), only where the app has no
   * AI of its own: `plan` (default) under its plan, `changes` under its changes. Plans and revisions
   * that come back arrive as drafts the pages read themselves; `follow` (the improvement's own page)
   * also refreshes it when work on the plan starts or one arrives.
   */
  TaskAi: ComponentType<{ taskId: string; place?: 'plan' | 'changes'; follow?: boolean }> | null;
  /** Extra sections on the person's Profile page. */
  ProfilePanels: ComponentType<{ userId: string }> | null;
  /** How many drafts wait for the viewer's review (the edition's AI drafts): a line on Home's "Needs you". */
  waitingDrafts: (() => Promise<number>) | null;
  /** Settings tabs this edition adds after General and AI (owners and admins; `members`: everyone). */
  settingsTabs: SettingsTabExtra[];
  /** Extra sections on Settings → AI (server component). */
  AiSettingsPanels: ComponentType<{ organizationId: string }> | null;
  /**
   * How Chalkenso works (Home's card for newcomers, its page): the edition's parts for the
   * organisation (server component). `ai`: where AI helps; `running`: how owners and admins
   * run it (only for them). `admin` also says whether to show what only they set up.
   */
  HowItWorksParts: ComponentType<{ organizationId: string; admin: boolean; part: 'ai' | 'running' }> | null;
  /**
   * Under the included AI's bar on Settings → AI (server component), where `canTopUp`: what's left
   * of `topUpMicros` (formatted; null: nothing), the month's included amount, and whether it has run
   * out.
   */
  AiTopUp: ComponentType<{ left: string | null; included: string; usedUp: boolean }> | null;
  /** Extra sections at the end of Settings → General (server component; e.g. deleting the organisation). */
  SettingsGeneralPanels: ComponentType<{ organizationId: string; isOwner: boolean }> | null;
  /** Course tabs this edition adds between Feedback and Settings. */
  courseTabs: CourseTabExtra[];
  /** Under the sign-up form (server component; e.g. an edition's terms). */
  SignupNote: ComponentType | null;
  /** The "Schedule a call…" of Getting started's call (server component). */
  GettingStartedCallButton: ComponentType<{ viewer: SessionUser }> | null;
};

/**
 * What an edition adds to learner pages (client components). Each is null when the edition adds
 * nothing there; shared code renders its own content unchanged then.
 */
export type LearnerUiExtensions = {
  /** Wraps the course page of a personal learner link, with what `learnerSignals` gave. */
  Provider: ComponentType<{ token: string; state: unknown; children: ReactNode }> | null;
  /** Above the course outline. */
  CourseTop: ComponentType | null;
  /** Next to a lesson's title in the outline. */
  LessonTag: ComponentType<{ lessonId: string }> | null;
  /** At the top of an open lesson. */
  LessonStart: ComponentType<{ lessonId: string }> | null;
  /** Around an open lesson's text. */
  LessonContent: ComponentType<{ lessonId: string; children: ReactNode }> | null;
  /** After an open lesson's text. */
  LessonEnd: ComponentType<{ lessonId: string }> | null;
  /** In the page footer. */
  Footer: ComponentType | null;
};
