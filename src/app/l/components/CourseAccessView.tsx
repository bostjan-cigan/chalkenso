import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { FiBookOpen, FiCalendar, FiGithub, FiLayers, FiMessageSquare, FiUser } from 'react-icons/fi';
import LanguageMenu from '@/components/LanguageMenu';
import ThemeToggle from '@/components/ThemeToggle';
import { DEFAULT_LOCALE, INTL_LOCALES, type Locale } from '@/i18n/config';
import IntlProvider from '@/i18n/IntlProvider';
import { PRODUCT_NAME } from '@/lib/site';
import contentStyles from '@/components/content/content.module.css';
import courseStyles from '@/components/courses/courses.module.css';
import LessonAccordion, { type LessonCommenting } from '../LessonAccordion';
import CommentsVisibilityProvider from './comments-visibility';
import { learnerUi } from '@/extensions/learner';
import type { LessonSource } from './lesson-source';
import styles from '../access.module.css';


type PartnerView = {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
};

type LessonView = {
  id: string;
  position: number;
  title: string;
  /** One-line summary shown under the title. */
  shortDescription?: string | null;
  /** Owning arc; null lessons render in the ungrouped flat list above the arc sections. */
  arcId?: string | null;
};

type ArcView = {
  id: string;
  title: string;
  description: string | null;
};

/** An arc plus the lessons assigned to it, ready to render as a section. */
export type ArcGroup = ArcView & {
  lessons: LessonView[];
};

interface CourseAccessViewProps {
  /** The page's language (learner pages); the team preview leaves it English, like the app. */
  locale?: Locale;
  /** The language menu beside the theme switch: learner pages only (the team preview stays English). */
  languageMenu?: boolean;
  courseTitle: string;
  courseSummary: string | null;
  githubUrl: string | null;
  partners: PartnerView[];
  lessons: LessonView[];
  /** Optional arcs (sections) in display order; empty keeps the flat lesson list. */
  arcs?: ArcView[];
  /** Required to lazy-load lessons; omit when `restrictedNotice` replaces the lesson area. */
  source?: LessonSource;
  slackHandle?: string | null;
  /** Who teaches the group (names learners may see), in order. */
  instructors?: string[];
  startsAt?: Date | null;
  endsAt?: Date | null;
  /** When set, replaces the lesson list with a notice (expired / revoked links). */
  restrictedNotice?: { title: string; description: string; action?: ReactNode } | null;
  /** When set, a quiet note above the lessons: they read as usual, but nothing can be sent (a paused course). */
  readOnlyNotice?: { title: string; description: string } | null;
  /** Pill above the title; draft preview links say so. */
  eyebrow?: string;
  /** The team preview: the way back into the app. */
  back?: { href: string; label: string } | null;
  /** Optional Medium-style margin commenting (personal-link viewer or admin preview). */
  commenting?: LessonCommenting | null;
  /** The organisation that prepared the course ("Prepared by"). */
  preparedBy?: string | null;
  /** The edition's learner signals for a personal learner link (see `learnerUi`). */
  learnerSignals?: { token: string; state: unknown } | null;
}

/** The client components' words: the lessons, and the comments, notes and Ask AI on them. */
const CLIENT_NAMESPACES = ['common', 'learner.lessons', 'learner.annotations'];

function formatScheduleDateOnly(value: Date, locale: Locale) {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: 'medium',
  }).format(value);
}

/** "Starts 1 Oct 2026 · Ends 20 Dec 2026", or whichever of the two is set. */
async function scheduleLabel(startsAt: Date | null, endsAt: Date | null, locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'learner.course' });
  return [
    startsAt ? t('starts', { date: formatScheduleDateOnly(startsAt, locale) }) : null,
    endsAt ? t('ends', { date: formatScheduleDateOnly(endsAt, locale) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * "Prepared by" (you) and "In partnership with" (the partners), side by side between two rules:
 * the access page's credits, flat like the rest of the page.
 */
async function Credits({ partners, preparedBy, locale }: { partners: PartnerView[]; preparedBy: string | null; locale: Locale }) {
  if (!preparedBy && partners.length === 0) {
    return null;
  }
  const t = await getTranslations({ locale, namespace: 'learner.course' });
  return (
    <div className={styles.credits}>
      {preparedBy ? (
        <section className={styles.credit}>
          <h2 className={styles.creditLabel}>{t('preparedBy')}</h2>
          <div className={styles.creditPeople}>
            <span className={styles.creditPerson}>{preparedBy}</span>
          </div>
        </section>
      ) : null}
      {partners.length > 0 ? (
        <section className={styles.credit}>
          <h2 className={styles.creditLabel}>{t('partnership')}</h2>
          <div className={styles.creditPeople}>
            {partners.map((partner) => (
              <span key={partner.id} className={styles.creditPerson}>
                {partner.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={partner.logoUrl} alt="" className={styles.creditLogo} />
                ) : null}
                <span className={styles.creditName}>
                  {partner.name}
                  {partner.websiteUrl ? (
                    <a href={partner.websiteUrl} className={contentStyles.link} target="_blank" rel="noreferrer">
                      {t('visitSite')}
                    </a>
                  ) : null}
                </span>
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The access page's frame: the `/courses` column without the site header (learners come here
 * from their link, not from browsing the site), and the access page's own footer. Inside an
 * `IntlProvider` in `locale` that gives `common` (the theme switch and the language menu).
 */
export async function AccessShell({
  children,
  footer = null,
  locale,
  languageMenu = false,
}: {
  children: ReactNode;
  footer?: ReactNode;
  locale: Locale;
  languageMenu?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'learner.course' });
  return (
    <div className={contentStyles.layout}>
      {languageMenu ? <LanguageMenu variant="floating" /> : null}
      <ThemeToggle />
      <div className={contentStyles.content}>
        <main>{children}</main>
        <footer className={styles.footer}>
          {footer}
          <p className={styles.footerNote}>{t('materialsNote')}</p>
          <p className={styles.footerNote}>
            {t.rich('madeWith', {
              product: PRODUCT_NAME,
              link: (chunks) => (
                <a href="/" className={styles.footerLink}>
                  {chunks}
                </a>
              ),
            })}
          </p>
        </footer>
      </div>
    </div>
  );
}

/**
 * The page an attendee sees for a course, laid out like the course page on `/courses` (title,
 * stats, summary, outline; no cover) except that lessons open in place instead of on their own
 * pages.
 * Shared by the access page and the admin version preview so both render identically, each in its
 * own language (its client components get their words here).
 */
export default async function CourseAccessView({
  locale = DEFAULT_LOCALE,
  languageMenu = false,
  courseTitle,
  courseSummary,
  githubUrl,
  partners,
  lessons,
  arcs = [],
  source,
  slackHandle = null,
  instructors = [],
  startsAt = null,
  endsAt = null,
  restrictedNotice = null,
  readOnlyNotice = null,
  eyebrow,
  back = null,
  commenting = null,
  preparedBy = null,
  learnerSignals = null,
}: CourseAccessViewProps) {
  const t = await getTranslations({ locale, namespace: 'learner.course' });
  const hasLessons = lessons.length > 0 && Boolean(source) && !restrictedNotice;

  // Lessons without an arc render as a flat list; arcs follow in order.
  const ungroupedLessons = lessons.filter((lesson) => !lesson.arcId);
  const arcGroups: ArcGroup[] = arcs.map((arc) => ({
    ...arc,
    lessons: lessons.filter((lesson) => lesson.arcId === arc.id),
  }));
  const parts = arcGroups.filter((arc) => arc.lessons.length > 0).length;
  const { Provider, CourseTop, Footer } = learnerUi;
  const signals = Boolean(learnerSignals && Provider);

  const page = (
    <AccessShell footer={signals && Footer ? <Footer /> : null} locale={locale} languageMenu={languageMenu}>
      <article className={contentStyles.article}>
        {back ? (
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem' }}>
            <a href={back.href} style={{ color: 'inherit', opacity: 0.75 }}>
              ‹ {back.label}
            </a>
          </p>
        ) : null}
        <span className={`${courseStyles.freePill} ${styles.eyebrow}`}>{eyebrow ?? t('eyebrow')}</span>
        <h1>{courseTitle}</h1>
        <div className={courseStyles.cardStats}>
          {lessons.length > 0 ? (
            <span className={courseStyles.stat}>
              <FiBookOpen aria-hidden />
              {t('lessons', { count: lessons.length })}
            </span>
          ) : null}
          {parts > 1 ? (
            <span className={courseStyles.stat}>
              <FiLayers aria-hidden />
              {t('parts', { count: parts })}
            </span>
          ) : null}
          {startsAt || endsAt ? (
            <span className={courseStyles.stat}>
              <FiCalendar aria-hidden />
              {await scheduleLabel(startsAt, endsAt, locale)}
            </span>
          ) : null}
          {instructors.length ? (
            <span className={courseStyles.stat} data-testid="course-instructors">
              <FiUser aria-hidden />
              {t('taughtBy', {
                count: instructors.length,
                names: new Intl.ListFormat(INTL_LOCALES[locale], { type: 'conjunction' }).format(instructors),
              })}
            </span>
          ) : null}
          {slackHandle ? (
            <span className={courseStyles.stat}>
              <FiMessageSquare aria-hidden />
              {t('slack', { handle: slackHandle })}
            </span>
          ) : null}
        </div>
        {courseSummary ? <p className={contentStyles.lead}>{courseSummary}</p> : null}
        {githubUrl ? (
          <div className={courseStyles.actions}>
            <a href={githubUrl} className={courseStyles.button} target="_blank" rel="noreferrer">
              <FiGithub aria-hidden /> {t('courseCode')}
            </a>
          </div>
        ) : null}
        <Credits partners={partners} preparedBy={preparedBy} locale={locale} />

        {readOnlyNotice && hasLessons ? (
          <section className={styles.readOnlyNotice} role="note" data-testid="learner-read-only">
            <h2>{readOnlyNotice.title}</h2>
            <p>{readOnlyNotice.description}</p>
          </section>
        ) : null}

        {hasLessons && source ? (
          <CommentsVisibilityProvider
            // A personal link (learner or instructor), not a team member's session in the preview.
            kinds={commenting?.role === 'viewer' && !commenting.api ? { comment: commenting.canComment !== false, note: true } : null}
          >
            {signals && CourseTop ? <CourseTop /> : null}
            <LessonAccordion
              lessons={ungroupedLessons}
              arcGroups={arcGroups}
              source={source}
              commenting={commenting}
              signals={signals}
            />
          </CommentsVisibilityProvider>
        ) : (
          <section className={styles.notice}>
            <h2>{restrictedNotice ? restrictedNotice.title : t('noLessonsTitle')}</h2>
            <p>{restrictedNotice ? restrictedNotice.description : t('noLessonsDescription')}</p>
            {restrictedNotice?.action ?? null}
          </section>
        )}
      </article>
    </AccessShell>
  );

  return (
    <IntlProvider locale={locale} namespaces={CLIENT_NAMESPACES}>
      {learnerSignals && Provider ? (
        <Provider token={learnerSignals.token} state={learnerSignals.state}>
          {page}
        </Provider>
      ) : (
        page
      )}
    </IntlProvider>
  );
}
