'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import AdminCheckbox from '../components/ui/AdminCheckbox';
import AdminSearchableSelectField from '../components/ui/AdminSearchableSelectField';
import { describeAccess, type AccessInput, type AccessOptions } from '@/lib/access-describe';
import type { AccessPreset } from '@/lib/access-rules';
import styles from '../admin.module.css';

export const DEFAULT_LIMITED: AccessPreset = { scope: 'courses', courseIds: [], groupIds: [], lessons: 'edit', feedback: true };

/** Where they reach, each with its words in `account.access.editor.scopes`. */
const SCOPES = [
  { value: 'all-courses', key: 'allCourses' },
  { value: 'courses', key: 'courses' },
  { value: 'groups', key: 'groups' },
] as const;

/** What they do with lessons (`account.access.editor.lessons`); `notes`, a guest instructor, is for chosen groups only. */
const LESSONS = [
  { value: 'edit', key: 'edit' },
  { value: 'view', key: 'view' },
] as const;

/** Chosen groups only: someone who teaches with the group but isn't part of running it. */
const GUEST = { value: 'notes', key: 'guest' } as const;

const card = (selected: boolean): CSSProperties => ({
  textAlign: 'left',
  padding: '0.65rem 0.8rem',
  borderRadius: 10,
  border: selected ? '2px solid rgb(var(--accent-color))' : '1px solid var(--line-strong)',
  background: selected ? 'rgba(var(--accent-color), 0.08)' : 'var(--card-bg)',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
});

const pickList: CSSProperties = {
  display: 'grid',
  gap: '0.35rem',
  maxHeight: 240,
  overflowY: 'auto',
  padding: '0.5rem 0.6rem',
  borderRadius: 10,
  border: '1px solid var(--line)',
};

/**
 * What a member may reach: everything, or limited to chosen courses or groups, with lessons to edit
 * or only read, and feedback to work on or only read; on chosen groups also a guest instructor (their
 * instructor link and notes only). Owners and admins always have everything, so the editor is for
 * members (instructors) only.
 */
export default function AccessEditor({
  idPrefix,
  value,
  onChange,
  options,
}: {
  idPrefix: string;
  value: AccessInput;
  onChange: (next: AccessInput) => void;
  options: AccessOptions;
}) {
  const t = useTranslations('account.access');
  const preset = value.kind === 'limited' ? value.preset : DEFAULT_LIMITED;
  const scopeChoice = (option: (typeof SCOPES)[number]) => ({
    value: option.value,
    label: t(`editor.scopes.${option.key}.label`),
    hint: t(`editor.scopes.${option.key}.hint`),
  });
  const lessonsChoice = (option: (typeof LESSONS)[number] | typeof GUEST) => ({
    value: option.value,
    label: t(`editor.lessons.${option.key}.label`),
    hint: t(`editor.lessons.${option.key}.hint`),
  });
  const set = (patch: Partial<AccessPreset>) => onChange({ kind: 'limited', preset: { ...preset, ...patch } });
  const toggle = (ids: string[], id: string, on: boolean) => (on ? Array.from(new Set([...ids, id])) : ids.filter((entry) => entry !== id));
  const groupsByCourse = options.groups.reduce<Map<string, typeof options.groups>>((byCourse, group) => {
    byCourse.set(group.courseTitle, [...(byCourse.get(group.courseTitle) ?? []), group]);
    return byCourse;
  }, new Map());
  const missing =
    value.kind === 'limited' &&
    ((preset.scope === 'courses' && preset.courseIds.length === 0) || (preset.scope === 'groups' && preset.groupIds.length === 0));

  return (
    <div style={{ display: 'grid', gap: '0.85rem' }} data-testid="access-editor">
      <div role="radiogroup" aria-label={t('editor.label')} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {[
          { kind: 'full' as const, title: t('editor.full.title'), text: t('editor.full.text') },
          { kind: 'limited' as const, title: t('editor.limited.title'), text: t('editor.limited.text') },
        ].map((option) => (
          <button
            key={option.kind}
            type="button"
            role="radio"
            aria-checked={value.kind === option.kind}
            data-testid={`access-${option.kind}`}
            style={card(value.kind === option.kind)}
            onClick={() => onChange(option.kind === 'full' ? { kind: 'full' } : { kind: 'limited', preset })}
          >
            <strong style={{ display: 'block', fontSize: '0.92rem' }}>{option.title}</strong>
            <span style={{ fontSize: '0.82rem', opacity: 0.7 }}>{option.text}</span>
          </button>
        ))}
      </div>

      {value.kind === 'limited' ? (
        <>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <AdminSearchableSelectField
              id={`${idPrefix}-scope`}
              label={t('editor.scopeLabel')}
              searchable={false}
              value={preset.scope}
              options={SCOPES.map(scopeChoice)}
              onValueChange={(next) =>
                set({
                  scope: next as AccessPreset['scope'],
                  ...(next !== 'groups' && preset.lessons === 'notes' ? { lessons: 'view' as const, feedback: false } : {}),
                })
              }
            />
            <AdminSearchableSelectField
              id={`${idPrefix}-lessons`}
              label={t('editor.lessonsLabel')}
              searchable={false}
              value={preset.lessons}
              options={(preset.scope === 'groups' ? [...LESSONS, GUEST] : LESSONS).map(lessonsChoice)}
              onValueChange={(next) =>
                set(
                  next === 'notes'
                    ? { lessons: 'notes', feedback: false }
                    : { lessons: next === 'view' ? 'view' : 'edit', ...(preset.lessons === 'notes' ? { feedback: true } : {}) }
                )
              }
            />
          </div>

          {preset.scope === 'courses' ? (
            options.courses.length ? (
              <div style={pickList} data-testid="access-courses">
                {options.courses.map((course) => (
                  <AdminCheckbox
                    key={course.id}
                    label={course.title}
                    checked={preset.courseIds.includes(course.id)}
                    onChange={(event) => set({ courseIds: toggle(preset.courseIds, course.id, event.target.checked) })}
                  />
                ))}
              </div>
            ) : (
              <p className={styles.fieldHint} style={{ margin: 0 }}>{t('editor.noCourses')}</p>
            )
          ) : null}

          {preset.scope === 'groups' ? (
            options.groups.length ? (
              <div style={pickList} data-testid="access-groups">
                {Array.from(groupsByCourse.entries()).map(([courseTitle, groups]) => (
                  <div key={courseTitle} style={{ display: 'grid', gap: '0.3rem' }}>
                    <span className={styles.fieldHint} style={{ fontWeight: 600 }}>{courseTitle}</span>
                    {groups.map((group) => (
                      <AdminCheckbox
                        key={group.id}
                        label={group.name}
                        checked={preset.groupIds.includes(group.id)}
                        onChange={(event) => set({ groupIds: toggle(preset.groupIds, group.id, event.target.checked) })}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.fieldHint} style={{ margin: 0 }}>{t('editor.noGroups')}</p>
            )
          ) : null}

          {preset.lessons === 'notes' ? null : (
            <AdminCheckbox
              label={t('editor.feedback.label')}
              hint={t('editor.feedback.hint')}
              checked={preset.feedback}
              onChange={(event) => set({ feedback: event.target.checked })}
            />
          )}
        </>
      ) : null}

      <p className={styles.fieldHint} style={{ margin: 0 }} data-testid="access-summary">
        {missing
          ? preset.scope === 'courses'
            ? t('editor.pickCourse')
            : t('editor.pickGroup')
          : describeAccess(value.kind === 'full' ? value : { kind: 'limited', preset }, options, t)}
      </p>
    </div>
  );
}
