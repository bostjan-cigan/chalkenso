'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type MouseEvent } from 'react';
import ConfirmDialog from './ConfirmDialog';
import workspace from './workspace/workspace.module.css';

/**
 * A lesson's two modes, in the same place on both pages: Edit (the text, nothing else) and Improve
 * (its improvements: feedback, a plan with AI, proposed changes), with how many wait there. Leaving
 * a mode with work that isn't saved asks first; Cancel is the default.
 */
export default function LessonModeSwitch({
  mode,
  editHref,
  improveHref,
  improveCount,
  unsaved = false,
  onSave,
}: {
  mode: 'edit' | 'improve';
  editHref: string;
  /** Null for someone who can't work on the lesson's feedback: Edit only, no switch. */
  improveHref: string | null;
  improveCount: number;
  unsaved?: boolean;
  /** Saves this mode's work; true when it saved and the switch may go on. */
  onSave?: () => Promise<boolean>;
}) {
  const t = useTranslations('editor.mode');
  const router = useRouter();
  const [leaving, setLeaving] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!improveHref) return null;

  const go = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!unsaved) return;
    event.preventDefault();
    setLeaving(href);
  };

  return (
    <>
      <nav className={workspace.segmented} aria-label={t('label')} data-testid="lesson-mode">
        <Link href={editHref} className={mode === 'edit' ? workspace.segmentActive : workspace.segment} aria-current={mode === 'edit' ? 'page' : undefined} onClick={mode === 'edit' ? undefined : go(editHref)}>
          {t('edit')}
        </Link>
        <Link
          href={improveHref}
          className={mode === 'improve' ? workspace.segmentActive : workspace.segment}
          aria-current={mode === 'improve' ? 'page' : undefined}
          onClick={mode === 'improve' ? undefined : go(improveHref)}
          data-testid="lesson-mode-improve"
        >
          {t('improve')}
          {improveCount ? <span className={workspace.toolbarCount}>{improveCount}</span> : null}
        </Link>
      </nav>
      <ConfirmDialog
        open={Boolean(leaving)}
        title={mode === 'edit' ? t('unsavedEditTitle') : t('unsavedImproveTitle')}
        description={mode === 'edit' ? t('unsavedEditText') : t('unsavedImproveText')}
        confirmLabel={t('saveAndSwitch')}
        pending={saving}
        onConfirm={async () => {
          if (!leaving || !onSave) return;
          setSaving(true);
          const ok = await onSave();
          setSaving(false);
          const href = leaving;
          setLeaving(null);
          if (ok) router.push(href);
        }}
        onClose={() => setLeaving(null)}
      />
    </>
  );
}
