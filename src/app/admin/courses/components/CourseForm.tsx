'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import Dropdown from '@/components/Dropdown';
import { DEFAULT_LOCALE, LANGUAGES, LOCALES } from '@/i18n/config';
import AdminCheckbox from '../../components/ui/AdminCheckbox';
import AdminField from '../../components/ui/AdminField';
import AdminSubmitButton from '../../components/ui/AdminSubmitButton';
import AdminTextareaField from '../../components/ui/AdminTextareaField';
import { CourseJoinFields, CourseTagsField, CourseTitleFields } from './CourseSettingsSheets';
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
 * website (its cover is added once it exists). An existing course's are set part by part on its
 * Settings tab, with the same fields.
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
  const [summary, setSummary] = useState(initialSummary);
  const [githubUrl, setGithubUrl] = useState(initialGithubUrl);
  const [allLessonsFree, setAllLessonsFree] = useState(initialAllLessonsFree);

  return (
    <form className={styles.formStack} action={action}>
      <CourseTitleFields initialTitle={initialTitle} initialSlug={initialSlug} />

      <AdminTextareaField
        id="course-summary"
        name="summary"
        label={t('summary')}
        onChange={(event) => setSummary(event.target.value)}
        placeholder={t('summaryPlaceholder')}
        value={summary}
      />

      <AdminField
        id="course-github-url"
        name="githubUrl"
        type="url"
        label={t('github')}
        onChange={(event) => setGithubUrl(event.target.value)}
        placeholder="https://github.com/your-org/course-materials"
        value={githubUrl}
      />

      <Dropdown
        id="course-language"
        name="language"
        label={t('language')}
        options={LOCALES.map((code) => ({ value: code, label: LANGUAGES[code].name }))}
        defaultValue={initialLanguage}
      />

      <PartnerListField
        id="course-partners"
        label={t('partners')}
        options={partnerOptions}
        initialPartnerIds={initialPartnerIds}
      />

      <fieldset className={styles.formStack} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={styles.fieldLabel} style={{ marginBottom: '0.35rem' }}>
          {t('website')}
        </legend>
        <input type="hidden" name="websiteSettings" value="1" />
        <AdminCheckbox name="publicListed" defaultChecked={initialPublicListed} label={t('publicListed')} />
        <AdminCheckbox name="pinned" defaultChecked={initialPinned} label={t('pinned')} />
        <AdminCheckbox
          name="allLessonsFree"
          checked={allLessonsFree}
          onChange={(event) => setAllLessonsFree(event.target.checked)}
          label={t('allLessonsFree')}
        />
        {allLessonsFree ? null : (
          <AdminField
            id="course-free-lessons"
            name="freeLessonCount"
            type="number"
            min={0}
            label={t('freeLessons')}
            defaultValue={String(initialFreeLessonCount)}
          />
        )}
        <AdminField
          id="course-outcome"
          name="outcome"
          label={t('outcome')}
          placeholder={t('outcomePlaceholder')}
          defaultValue={initialOutcome}
        />
        <CourseTagsField initialTags={initialTags} />
        <CourseJoinFields
          initialJoinTarget={initialJoinTarget}
          initialJoinPartnerId={initialJoinPartnerId}
          initialEnrolUrl={initialEnrolUrl}
          partnerOptions={partnerOptions}
        />
      </fieldset>

      <div className={styles.inlineActions}>
        <AdminSubmitButton pendingText={pendingText ?? t('saving')}>{submitLabel ?? t('save')}</AdminSubmitButton>
      </div>
    </form>
  );
}
