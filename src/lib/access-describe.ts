import type { useTranslations } from 'next-intl';
import type { AccessPreset } from './access-rules';

/**
 * How a member's access reads on the Team page and the invite page. Client-safe (the access editor
 * shows the same line live); `member-access.ts` re-exports it.
 */

/** The access line's words (`account.access`), from `getTranslations` on the server or `useTranslations` in the editor. */
export type AccessWords = ReturnType<typeof useTranslations<'account.access'>>;

/** What the editor sends: everything, or a preset. */
export type AccessInput = { kind: 'full' } | { kind: 'limited'; preset: AccessPreset };

/** What the Team page shows: full access, a preset, no rows (nothing), or rows no preset makes. */
export type AccessView = { kind: 'full' } | { kind: 'limited'; preset: AccessPreset | 'none' | 'custom' };

export type AccessOptions = {
  courses: Array<{ id: string; title: string }>;
  groups: Array<{ id: string; name: string; courseId: string; courseTitle: string }>;
};

/**
 * Where a preset reaches, before it is put in words: every course, or these courses or groups
 * ("Summer group (Web Development II)"; null for one that was removed since).
 */
export type AccessScope = { kind: 'all-courses' } | { kind: 'courses' | 'groups'; names: Array<string | null> };

function accessScope(preset: AccessPreset, options: AccessOptions): AccessScope {
  if (preset.scope === 'all-courses') return { kind: 'all-courses' };
  if (preset.scope === 'courses') {
    const titles = new Map(options.courses.map((course) => [course.id, course.title]));
    return { kind: 'courses', names: preset.courseIds.map((id) => titles.get(id) ?? null) };
  }
  const groups = new Map(options.groups.map((group) => [group.id, `${group.name} (${group.courseTitle})`]));
  return { kind: 'groups', names: preset.groupIds.map((id) => groups.get(id) ?? null) };
}

/** Where a preset reaches, in the reader's words: "every course", "Web Development II", "A, B and 2 more". */
function scopeWords(preset: AccessPreset, options: AccessOptions, t: AccessWords) {
  const scope = accessScope(preset, options);
  if (scope.kind === 'all-courses') return t('everyCourse');
  const names = scope.names.map((name) => name ?? t(scope.kind === 'courses' ? 'removedCourse' : 'removedGroup'));
  if (!names.length) return t(scope.kind === 'courses' ? 'noCourse' : 'noGroup');
  if (names.length === 1) return names[0];
  return names.length === 2
    ? t('two', { first: names[0], second: names[1] })
    : t('more', { first: names[0], second: names[1], count: names.length - 2 });
}

/** One line: "Web Development II · edits lessons · works on feedback and tasks", in `t`'s language. */
export function describeAccess(view: AccessView, options: AccessOptions, t: AccessWords): string {
  if (view.kind === 'full') return t('full');
  if (view.preset === 'none') return t('none');
  if (view.preset === 'custom') return t('custom');
  const preset = view.preset;
  const words = scopeWords(preset, options, t);
  const scope = words.charAt(0).toUpperCase() + words.slice(1);
  if (preset.lessons === 'notes') {
    return t('guestLine', { scope });
  }
  return [
    scope,
    t(preset.lessons === 'edit' ? 'editsLessons' : 'viewsLessons'),
    t(preset.feedback ? 'worksOnFeedback' : 'readsFeedback'),
  ].join(' · ');
}

/**
 * What an invite reaches, for the invite page to put in the visitor's language (`auth.invite`):
 * where, and what it does with lessons. Null when there's nothing to add (full access, none, custom).
 */
export function inviteAccess(
  view: AccessView,
  options: AccessOptions
): { scope: AccessScope; lessons: AccessPreset['lessons'] } | null {
  if (view.kind === 'full' || typeof view.preset === 'string') return null;
  return { scope: accessScope(view.preset, options), lessons: view.preset.lessons };
}

