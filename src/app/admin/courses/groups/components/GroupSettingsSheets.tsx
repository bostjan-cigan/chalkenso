'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import AdminBadge from '@/app/admin/components/ui/AdminBadge';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import AdminField from '@/app/admin/components/ui/AdminField';
import AdminSelectField from '@/app/admin/components/ui/AdminSelectField';
import AdminTextareaField from '@/app/admin/components/ui/AdminTextareaField';
import { SheetControlRow, SheetRows, useSheetForm } from '@/app/admin/components/ui/Sheet';
import Switch from '@/app/admin/components/ui/Switch';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import { formatDateTimeLocalValue } from '@/lib/access-links';
import { parseGroupRoster } from '@/lib/group-roster';
import { createSlugCandidate } from '@/lib/slugs';
import styles from '@/app/admin/admin.module.css';
import { saveGroupSettingsAction } from '../actions';
import AccessExpiryPicker from './AccessExpiryPicker';

/**
 * One part of a group's settings, in its sheet: the part's fields and what saving said. Save is the
 * sheet's, and closes it once saved. Only the fields inside change (`saveGroupSettingsAction`).
 */
export function GroupSettingsForm({ groupId, children, testId }: { groupId: string; children: ReactNode; testId?: string }) {
  const t = useTranslations('groups.detail.settings');
  const { notice, isPending, run } = useActionNotice();
  const sheet = useSheetForm({ label: isPending ? t('saving') : t('save'), pending: isPending });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => saveGroupSettingsAction(formData), { onSuccess: sheet.close });
  }

  return (
    <form id={sheet.formId} className={styles.formStack} onSubmit={handleSubmit} data-testid={testId}>
      <input type="hidden" name="groupId" value={groupId} />
      <ActionNotice notice={notice} />
      {children}
      {sheet.inSheet ? null : (
        <div className={styles.inlineActions}>
          <AdminButton type="submit" disabled={isPending}>
            {isPending ? t('saving') : t('save')}
          </AdminButton>
        </div>
      )}
    </form>
  );
}

/**
 * The group's name and its short name, which follows the name until it is changed. A new group
 * shows the short name quietly under the name (`quietSlug`), its field only after Change.
 */
export function GroupNameFields({ initialName = '', initialSlug = '', quietSlug = false }: { initialName?: string; initialSlug?: string; quietSlug?: boolean }) {
  const t = useTranslations('groups.form');
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [slugShown, setSlugShown] = useState(!quietSlug);
  const nameField = (
    <AdminField
      id="group-name"
      name="name"
      label={t('name')}
      placeholder={t('namePlaceholder')}
      value={name}
      onChange={(event) => {
        setName(event.target.value);
        setSlug(createSlugCandidate(event.target.value, 'group'));
      }}
      required
    />
  );
  if (!slugShown) {
    return (
      <div className={styles.field}>
        {nameField}
        <input type="hidden" name="slug" value={slug} />
        <p className={styles.fieldHint} style={{ margin: 0 }} data-testid="group-slug-quiet">
          {slug ? t('slugQuiet', { slug }) : t('slugQuietEmpty')}{' '}
          <button type="button" className={styles.fieldHintAction} onClick={() => setSlugShown(true)}>
            {t('slugChange')}
          </button>
        </p>
      </div>
    );
  }
  return (
    <>
      {nameField}
      <AdminField
        id="group-slug"
        name="slug"
        label={t('slug')}
        hint={t('slugHint')}
        placeholder={t('slugPlaceholder')}
        value={slug}
        onChange={(event) => setSlug(createSlugCandidate(event.target.value, 'group'))}
        autoFocus={quietSlug}
      />
    </>
  );
}

type CourseOption = { id: string; slug: string; title: string };
type VersionOption = { id: string; label: string; version: number; status: 'DRAFT' | 'PUBLISHED' };

/** The group's course and the version of it the group reads: picking another course starts the version over. */
export function GroupLessonsFields({
  courses,
  versionsByCourseId,
  initialCourseId = '',
  initialVersionId = '',
  editing = false,
}: {
  courses: CourseOption[];
  versionsByCourseId: Record<string, VersionOption[]>;
  initialCourseId?: string;
  initialVersionId?: string;
  /** An existing group's: changing the version revokes its links (the hint says so). */
  editing?: boolean;
}) {
  const t = useTranslations('groups.form');
  const [courseId, setCourseId] = useState(initialCourseId);
  const [versionId, setVersionId] = useState(initialVersionId);
  return (
    <>
      <AdminSelectField
        id="group-course-id"
        name="courseId"
        label={t('course')}
        value={courseId}
        onChange={(event) => {
          setCourseId(event.target.value);
          setVersionId('');
        }}
        required
      >
        <option value="">{t('selectCourse')}</option>
        {courses.map((course) => (
          <option key={course.id} value={course.id}>
            {course.title} ({course.slug})
          </option>
        ))}
      </AdminSelectField>
      <AdminSelectField
        id="group-curriculum-version-id"
        name="curriculumVersionId"
        label={t('lessonsFrom')}
        hint={editing ? t('lessonsFromHintEdit') : t('lessonsFromHintNew')}
        value={versionId}
        onChange={(event) => setVersionId(event.target.value)}
        disabled={!courseId}
      >
        <option value="">{courseId ? t('selectVersion') : t('selectCourseFirst')}</option>
        {(versionsByCourseId[courseId] ?? []).map((version) => (
          <option key={version.id} value={version.id}>
            {version.label} ({version.status === 'PUBLISHED' ? t('published') : t('draft')})
          </option>
        ))}
      </AdminSelectField>
    </>
  );
}

/**
 * When the group starts or ends, the way Apple's Reminders sets a date: a switch for whether it has
 * one, and the calendar under it while it does. Off posts an empty value (no date).
 */
export function GroupDateField({ id, name, label, initialValue }: { id: string; name: 'startsAt' | 'endsAt'; label: string; initialValue: string }) {
  const [on, setOn] = useState(Boolean(initialValue));
  const [value, setValue] = useState(() => initialValue || formatDateTimeLocalValue(new Date()));
  return (
    <>
      <input type="hidden" name={name} value={on ? value : ''} />
      <SheetRows>
        <SheetControlRow label={label}>
          <Switch on={on} label={label} onChange={() => setOn(!on)} testId={`${id}-switch`} />
        </SheetControlRow>
      </SheetRows>
      {on ? <AccessExpiryPicker idPrefix={id} value={value} onChange={setValue} /> : null}
    </>
  );
}

/** The pasted roster and the learners read from it, as they will be stored. */
export function GroupRosterFields({ initialRoster = '', fullWidth = false }: { initialRoster?: string; fullWidth?: boolean }) {
  const t = useTranslations('groups.form');
  const [roster, setRoster] = useState(initialRoster);
  const parsed = parseGroupRoster(roster);
  return (
    <>
      <AdminTextareaField
        id="group-roster"
        name="sourceRosterText"
        label={t('roster')}
        hint={t('rosterHint')}
        placeholder={`SEZNAM TEČAJNIKOV:\n\n1. ISMETA DJOGIĆ\n2. MIHA STERLE`}
        value={roster}
        onChange={(event) => setRoster(event.target.value)}
        fullWidth={fullWidth}
      />
      <div className={`${styles.rosterPreviewBlock} ${fullWidth ? styles.fieldFullWidth : ''}`}>
        <div className={styles.editorTopLine}>
          <div className={styles.rosterPreviewHeading}>
            <h3>{t('parsed')}</h3>
            <p className={styles.helperText}>{t('parsedHint')}</p>
          </div>
          <AdminBadge variant="muted">{t('learners', { count: parsed.length })}</AdminBadge>
        </div>
        {parsed.length > 0 ? (
          <div className={styles.memberPreviewList}>
            {parsed.map((member) => (
              <div key={`${member.position}-${member.fullName}`} className={styles.memberPreviewItem}>
                <span className={styles.lessonIndex}>{member.position}</span>
                <span>{member.fullName}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <h3 className={styles.emptyStateTitle}>{t('parsedEmpty.title')}</h3>
            <p className={styles.emptyStateText}>{t('parsedEmpty.text')}</p>
          </div>
        )}
      </div>
    </>
  );
}
