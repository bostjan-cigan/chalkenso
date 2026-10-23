import { getTranslations } from 'next-intl/server';
import { ui } from '@/extensions/ui';
import SegmentedControl from '../../components/ui/SegmentedControl';

/**
 * The Lessons tab's subtabs, on the lessons themselves: the lessons, then the views of them an
 * edition adds (`ui.lessonViews`, the cloud's curriculum analysis), all of the same version. Nothing
 * when the edition adds none. The views' own page draws the same row (its own links keep what it
 * shows).
 */
export default async function LessonViews({ courseId, versionId }: { courseId: string; versionId: string }) {
  if (!ui.lessonViews.length) return null;
  const t = await getTranslations('app.nav.course');
  const base = `/admin/courses/${courseId}`;
  // In a block of its own, so the row is as wide as its subtabs (as on the views' page), not the page.
  return (
    <div>
      <SegmentedControl
        label={t('viewsLabel')}
        testId="lesson-views"
        segments={[
          { key: 'lessons', label: t('views.lessons'), href: `${base}?version=${versionId}`, active: true, testId: 'lesson-view-lessons' },
          ...ui.lessonViews.map((view) => ({
            key: view.key,
            label: t(`views.${view.label}`),
            href: `${base}/${view.segment}?${new URLSearchParams({ version: versionId, view: view.view })}`,
            active: false,
            testId: `lesson-view-${view.key}`,
          })),
        ]}
      />
    </div>
  );
}
