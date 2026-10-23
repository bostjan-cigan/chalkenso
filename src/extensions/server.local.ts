import 'server-only';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/prisma';
import type { ServerExtensions } from './types';

/**
 * The local (self-hosted) edition: no public website, so nothing is indexed, and sign-up is open
 * only until the installation has its organisation. The first person to sign up is its manager;
 * instructors join by invite.
 */
const notSetUp = async () => (await prisma.organization.count()) === 0;

export const localServer: ServerExtensions = {
  robots: () => ({ rules: [{ userAgent: '*', disallow: '/' }] }),
  sitemap: () => [],
  isSignupOpen: notSetUp,
  platformAdminHome: null,
  // A new installation has nobody to sign in yet: setting it up comes first.
  beforeLogin: async () => {
    if (await notSetUp()) {
      redirect('/signup');
    }
  },
  beforeSignup: () => {},
  // A self-hosted installation has no bot check of its own; its forms have the limits only.
  isBot: async () => false,
  authBotCheck: null,
  signupIntro: async (locale) => {
    const t = await getTranslations({ locale, namespace: 'auth.signup.installation' });
    return { kicker: t('kicker'), intro: t('intro') };
  },
  // Bring your own key: each installation pays for its own AI.
  aiOrganizationKeys: true,
  ownAiKeyAllowed: async () => true,
  // AI here runs on the installation's key or Claude Code in the vault: nothing to connect.
  howItWorksAction: async () => 'lesson',
  // No call: Getting started ends with its own steps.
  gettingStartedCall: async () => null,
  // Without the organisation's own key, the installation's.
  aiKeyFallback: async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    return apiKey ? { key: { apiKey, source: 'installation' } } : { key: null, reason: 'no-key' };
  },
  // No plans here: AI runs on the installation's key or the organisation's own.
  aiAllowance: async () => null,
  // Free AI here is Claude Code with the Obsidian vault, not a connector.
  claudeConnector: false,
  // Nothing gathered from learners here: the in-app AI works from the request and notes.
  lessonEvidence: async () => null,
  // One manager (who set the installation up) and the instructors they invite. Roles never change,
  // so there is always exactly one manager.
  team: {
    roles: {
      OWNER: { label: 'Manager', inSentence: 'the manager', hint: 'runs this installation and its team' },
      ADMIN: { label: 'Admin', inSentence: 'an admin', hint: 'also manages the team' },
      MEMBER: { label: 'Instructor', inSentence: 'an instructor', hint: 'designs courses, teaches groups, works through feedback (all, or what you choose under Access)' },
    },
    rolesInSentence: async (locale) => {
      const t = await getTranslations({ locale, namespace: 'auth.invite.roles' });
      return { OWNER: t('owner'), ADMIN: t('admin'), MEMBER: t('member') };
    },
    words: async (locale) => {
      const t = await getTranslations({ locale, namespace: 'account.team.policy' });
      const role = (key: 'manager' | 'admin' | 'instructor') => ({
        label: t(`roles.${key}.label`),
        inSentence: t(`roles.${key}.inSentence`),
        hint: t(`roles.${key}.hint`),
      });
      return { roles: { OWNER: role('manager'), ADMIN: role('admin'), MEMBER: role('instructor') }, description: t('description.installation') };
    },
    inviteRoles: ['MEMBER'],
    roleChanges: false,
    description:
      'You manage this installation. Instructors you invite design and edit courses, run groups and work through feedback: all of them, or only the courses or groups you give them.',
  },
  onLessonsPublished: () => {},
  onLessonsUnpublished: () => {},
  onCourseUpdated: () => {},
  // Learners read on the installation itself.
  learnerLinkTemplate: async () => null,
  // Nothing of the edition's own on learner pages.
  learnerSignals: async () => null,
  // No plans: learner pages never close.
  learnerPagesClosed: async () => false,
  // No plans: an installation has as many people and classes as it likes.
  signupPlans: null,
  afterSignup: () => '/admin?welcome=1',
  newOrganizationPlan: () => ({ plan: 'LOCAL', planStatus: 'ACTIVE', trialEndsAt: null }),
  // Nothing of its own: the shared export is everything there is.
  exportParts: async () => [],
  limits: {
    seat: async () => ({ ok: true }),
    classes: async () => ({ ok: true }),
  },
  // No plans, so nothing pauses.
  isPaused: async () => false,
};
