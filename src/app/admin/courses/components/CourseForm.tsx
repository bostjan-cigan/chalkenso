'use client';

import { useTranslations } from 'next-intl';
import { ChangeEvent, useState } from 'react';
import Dropdown from '@/components/Dropdown';
import { DEFAULT_LOCALE, LANGUAGES, LOCALES } from '@/i18n/config';
import AdminField from '../../components/ui/AdminField';
import AdminSelectField from '../../components/ui/AdminSelectField';
import AdminSubmitButton from '../../components/ui/AdminSubmitButton';
import AdminTextareaField from '../../components/ui/AdminTextareaField';
import { createSlugCandidate } from '@/lib/slugs';
import PartnerListField, { type PartnerOption } from './PartnerListField';
import styles from '../../admin.module.css';

type JoinTarget = 'LINKEDIN' | 'PARTNER' | 'LINK';

interface CourseFormProps {
  action: (formData: FormData) => void;
  initialGithubUrl?: string;
  initialSlug?: string;
  initialSummary?: string;
  initialTitle?: string;
  /** In order: learners see them under "In partnership with". */
  initialPartnerIds?: string[];
  /** How the course appears on the organisation's own website (served through the content API). */
  initialPublicListed?: boolean;
  initialPinned?: boolean;
  initialAllLessonsFree?: boolean;
  initialFreeLessonCount?: number;
  initialOutcome?: string;
  initialTags?: string[];
  initialJoinTarget?: JoinTarget;
  initialJoinPartnerId?: string;
  initialEnrolUrl?: string;
  /** The language of its learner pages (a learner's own pick wins). */
  initialLanguage?: string;
  partnerOptions: PartnerOption[];
  pendingText?: string;
  submitLabel?: string;
}

/**
 * A new course: its title, address, summary (also given to AI as context), an optional repository,
 * its partners, the language of its learner pages, and how it appears on the organisation's
 * website. An existing course's are set part by part on its Settings tab.
 */
export default function CourseForm({
  action,
  initialGithubUrl = '',
  initialSlug = '',
  initialSummary = '',
  initialTitle = '',
  initialPartnerIds = [],
  initialPublicListed = false,
  initialPinned = false,
  initialAllLessonsFree = false,
  initialFreeLessonCount = 2,
  initialOutcome = '',
  initialTags = [],
  initialJoinTarget = 'LINKEDIN',
  initialJoinPartnerId = '',
  initialEnrolUrl = '',
  initialLanguage = DEFAULT_LOCALE,
  partnerOptions,
  pendingText,
  submitLabel,
}: CourseFormProps) {
  const t = useTranslations('courses.form');
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [summary, setSummary] = useState(initialSummary);
  const [githubUrl, setGithubUrl] = useState(initialGithubUrl);
  const [allLessonsFree, setAllLessonsFree] = useState(initialAllLessonsFree);
  const [joinTarget, setJoinTarget] = useState<JoinTarget>(initialJoinTarget);
  const [joinPartnerId, setJoinPartnerId] = useState(initialJoinPartnerId);
  const joinPartner = partnerOptions.find((partner) => partner.id === joinPartnerId);

  function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
    setTitle(event.target.value);
    setSlug(createSlugCandidate(event.target.value, ''));
  }

  return (
    <form className={styles.formStack} action={action}>

      <AdminField
        id="course-title"
        name="title"
        label={t('title')}
        onChange={handleTitleChange}
        placeholder={t('titlePlaceholder')}
        required
        value={title}
      />

      <AdminField
        id="course-slug"
        name="slug"
        label={t('slug')}
        hint={t('slugHint')}
        onChange={(event) => setSlug(createSlugCandidate(event.target.value, ''))}
        placeholder={t('slugPlaceholder')}
        value={slug}
      />

      <AdminTextareaField
        id="course-summary"
        name="summary"
        label={t('summary')}
        hint={t('summaryHint')}
        onChange={(event) => setSummary(event.target.value)}
        placeholder={t('summaryPlaceholder')}
        value={summary}
      />

      <AdminField
        id="course-github-url"
        name="githubUrl"
        label={t('github')}
        hint={t('githubHint')}
        onChange={(event) => setGithubUrl(event.target.value)}
        placeholder="https://github.com/your-org/course-materials"
        value={githubUrl}
      />

      <Dropdown
        id="course-language"
        name="language"
        label={t('language')}
        hint={t('languageHint')}
        options={LOCALES.map((code) => ({ value: code, label: LANGUAGES[code].name }))}
        defaultValue={initialLanguage}
      />

      <PartnerListField
        id="course-partners"
        label={t('partners')}
        hint={t('partnersHint')}
        options={partnerOptions}
        initialPartnerIds={initialPartnerIds}
      />

      <fieldset className={styles.formStack} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={styles.fieldLabel} style={{ marginBottom: '0.35rem' }}>
          {t('website')}
        </legend>
        <p className={styles.fieldHint} style={{ margin: 0 }}>
          {t('websiteHint')}
        </p>
        <input type="hidden" name="websiteSettings" value="1" />
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input type="checkbox" name="publicListed" defaultChecked={initialPublicListed} /> {t('publicListed')}
        </label>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input type="checkbox" name="pinned" defaultChecked={initialPinned} /> {t('pinned')}
        </label>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            name="allLessonsFree"
            checked={allLessonsFree}
            onChange={(event) => setAllLessonsFree(event.target.checked)}
          />{' '}
          {t('allLessonsFree')}
        </label>
        {allLessonsFree ? null : (
          <AdminField
            id="course-free-lessons"
            name="freeLessonCount"
            type="number"
            min={0}
            label={t('freeLessons')}
            hint={t('freeLessonsHint')}
            defaultValue={String(initialFreeLessonCount)}
          />
        )}
        <div className={styles.field}>
          <span className={styles.inputLabel}>{t('cover.label')}</span>
          <span className={styles.fieldHint}>{t('cover.later')}</span>
        </div>
        <AdminField
          id="course-outcome"
          name="outcome"
          label={t('outcome')}
          placeholder={t('outcomePlaceholder')}
          defaultValue={initialOutcome}
        />
        <AdminField
          id="course-tags"
          name="tags"
          label={t('tags')}
          hint={t('tagsHint')}
          placeholder="Python, Docker, SQL"
          defaultValue={initialTags.join(', ')}
        />
        <AdminSelectField
          id="course-join-target"
          name="joinTarget"
          label={t('join')}
          hint={t('joinHint')}
          onChange={(event) => setJoinTarget(event.target.value as JoinTarget)}
          value={joinTarget}
        >
          <option value="LINKEDIN">{t('joinTarget.default')}</option>
          <option value="PARTNER">{t('joinTarget.partner')}</option>
          <option value="LINK">{t('joinTarget.link')}</option>
        </AdminSelectField>
        {joinTarget === 'PARTNER' ? (
          <AdminSelectField
            id="course-join-partner"
            name="joinPartnerId"
            label={t('joinPartner')}
            hint={joinPartner && !joinPartner.websiteUrl ? t('joinPartnerNoWebsite') : t('joinPartnerHint')}
            onChange={(event) => setJoinPartnerId(event.target.value)}
            value={joinPartnerId}
          >
            <option value="">{t('joinPartnerChoose')}</option>
            {partnerOptions.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </AdminSelectField>
        ) : null}
        {joinTarget === 'LINK' ? (
          <AdminField
            id="course-enrol-url"
            name="enrolUrl"
            label={t('joinLink')}
            hint={t('joinLinkHint')}
            placeholder="https://"
            defaultValue={initialEnrolUrl}
          />
        ) : null}
      </fieldset>

      <div className={styles.inlineActions}>
        <AdminSubmitButton pendingText={pendingText ?? t('saving')}>{submitLabel ?? t('save')}</AdminSubmitButton>
      </div>
    </form>
  );
}
