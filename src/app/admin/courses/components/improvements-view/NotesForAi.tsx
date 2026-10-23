'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { excerpt } from '@/lib/improvement-label';
import { updateImprovementNotesAction } from '../../../tasks/actions';
import { Sheet, SheetOpenRow } from '../../../components/ui/Sheet';
import workspace from '../workspace/workspace.module.css';
import styles from './improvements-view.module.css';

/**
 * An improvement's notes for AI, as a row (its first words, or Add) that opens a sheet: the
 * instructor's own words about these changes, kept on the improvement. Planning and drafting here
 * use them, and so do the person's Claude and Obsidian. A row: put it in a `SheetRows` list.
 */
export default function NotesForAi({ taskId, notes, planned, canEdit }: { taskId: string; notes: string; planned: boolean; canEdit: boolean }) {
  const t = useTranslations('editor.improvements.notes');
  const router = useRouter();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(notes);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      const result = await updateImprovementNotesAction(taskId, text);
      if (!result.ok) {
        setError(result.message ?? t('failed'));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <SheetOpenRow
        label={t('row')}
        value={notes ? excerpt(notes, 48) : canEdit ? t('add') : t('none')}
        onClick={() => {
          setText(notes);
          setError(null);
          setOpen(true);
        }}
        testId="notes-for-ai"
      />
      <Sheet title={t('title')} open={open} onClose={() => setOpen(false)}>
        <div className={styles.notesSheet}>
          <label className={styles.quiet} htmlFor={fieldId}>
            {t('hint')}
          </label>
          <textarea
            id={fieldId}
            className={styles.planBox}
            value={text}
            readOnly={!canEdit}
            maxLength={4000}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            placeholder={t('placeholder')}
            data-testid="notes-for-ai-box"
          />
          {planned ? <p className={styles.quiet}>{t('planned')}</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          {canEdit ? (
            // Done (the sheet's) closes; Save keeps the notes, as the app's other sheets do.
            <div className={styles.actionsEnd}>
              <button type="button" className={workspace.primaryButton} disabled={pending} onClick={save} data-testid="notes-for-ai-save">
                {pending ? t('saving') : t('save')}
              </button>
            </div>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
