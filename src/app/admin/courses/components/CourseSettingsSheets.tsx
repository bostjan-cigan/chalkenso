'use client';

import { useTranslations } from 'next-intl';
import { useOptimistic, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import ActionNotice from '../../components/ui/ActionNotice';
import AdminButton from '../../components/ui/AdminButton';
import AdminField from '../../components/ui/AdminField';
import AdminSelectField from '../../components/ui/AdminSelectField';
import Switch from '../../components/ui/Switch';
import { useActionNotice } from '../../components/ui/useActionNotice';
import { createSlugCandidate } from '@/lib/slugs';
import { saveCourseSettingsAction, setCourseSwitchAction, type CourseSwitch } from '../actions';
import type { PartnerOption } from './PartnerListField';
import styles from '../../admin.module.css';

/**
 * One part of a course's settings, in its sheet: the part's fields, what saving said, and Save.
 * Only the fields inside change (`saveCourseSettingsAction`).
 */
export function CourseSettingsForm({ courseId, children, testId }: { courseId: string; children: ReactNode; testId?: string }) {
  const t = useTranslations('courses.edit');
  const { notice, isPending, run } = useActionNotice();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => saveCourseSettingsAction(formData));
  }

  return (
    <form className={styles.formStack} onSubmit={handleSubmit} data-testid={testId}>
      <input type="hidden" name="courseId" value={courseId} />
      <ActionNotice notice={notice} />
      {children}
      <div className={styles.inlineActions}>
        <AdminButton type="submit" disabled={isPending}>
          {isPending ? t('saving') : t('save')}
        </AdminButton>
      </div>
    </form>
  );
}

/** The title and the short name, which follows the title until it is changed. */
export function CourseTitleFields({ initialTitle, initialSlug }: { initialTitle: string; initialSlug: string }) {
  const t = useTranslations('courses.form');
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  return (
    <>
      <AdminField
        id="course-title"
        name="title"
        label={t('title')}
        onChange={(event) => {
          setTitle(event.target.value);
          setSlug(createSlugCandidate(event.target.value, ''));
        }}
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
    </>
  );
}

type JoinTarget = 'LINKEDIN' | 'PARTNER' | 'LINK';

/** Where the website's Join button leads: the site default, a partner's website or the course's own link. */
export function CourseJoinFields({
  initialJoinTarget,
  initialJoinPartnerId,
  initialEnrolUrl,
  partnerOptions,
}: {
  initialJoinTarget: JoinTarget;
  initialJoinPartnerId: string;
  initialEnrolUrl: string;
  partnerOptions: PartnerOption[];
}) {
  const t = useTranslations('courses.form');
  const [joinTarget, setJoinTarget] = useState<JoinTarget>(initialJoinTarget);
  const [joinPartnerId, setJoinPartnerId] = useState(initialJoinPartnerId);
  const joinPartner = partnerOptions.find((partner) => partner.id === joinPartnerId);
  return (
    <>
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
    </>
  );
}

/** One of the course's website switches: flipping it saves at once. */
export function CourseSettingSwitch({ courseId, setting, on, label }: { courseId: string; setting: CourseSwitch; on: boolean; label: string }) {
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(on);
  return (
    <Switch
      on={shown}
      label={label}
      disabled={pending}
      testId={`course-switch-${setting}`}
      onChange={() =>
        startTransition(async () => {
          const next = !shown;
          setShown(next);
          await setCourseSwitchAction(courseId, setting, next);
        })
      }
    />
  );
}
