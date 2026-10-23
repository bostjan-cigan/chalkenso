'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import AccessLinkModalPortal from '@/app/admin/courses/groups/components/AccessLinkModalPortal';
import modal from '@/app/admin/courses/groups/components/MemberLinkModal.module.css';
import { noteOnSelectionAction } from '../../improvement-actions';
import type { SelectionInfo } from './LessonDocumentEditor';

/**
 * What text selected in Edit mode becomes: a note on that passage ("Add a note"), or a note and an
 * improvement made from it ("Improve with AI…"), which opens in Improve mode to be planned with AI.
 * The passage is quoted; what to say is optional for an improvement. Cancel is the default.
 */
export default function SelectionComposer({
  lessonId,
  selection,
  improve,
  onClose,
  onNoted,
  onImprovement,
}: {
  lessonId: string;
  selection: SelectionInfo;
  /** Opened as "Improve with AI…" (else "Add a note"). */
  improve: boolean;
  onClose: () => void;
  onNoted: () => void;
  onImprovement: (taskId: string) => void;
}) {
  const t = useTranslations('editor.selection');
  const titleId = useId();
  const descriptionId = useId();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await noteOnSelectionAction({ lessonId, passage: selection.text, context: selection.context, body, improve });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (improve && result.taskId) onImprovement(result.taskId);
      else onNoted();
    });

  return (
    <AccessLinkModalPortal open onClose={onClose} titleId={titleId} descriptionId={descriptionId}>
      <header className={modal.modalHeader}>
        <h2 id={titleId} className={modal.modalTitle}>
          {improve ? t('improveTitle') : t('noteTitle')}
        </h2>
        <p id={descriptionId} className={modal.modalDescription}>
          {improve ? t('improveText') : t('noteText')}
        </p>
      </header>
      <div className={modal.modalBody}>
        <blockquote style={{ margin: 0, paddingLeft: '0.75rem', borderLeft: '3px solid var(--line-strong)', fontStyle: 'italic', opacity: 0.8 }}>
          “{selection.text.length > 280 ? `${selection.text.slice(0, 280)}…` : selection.text}”
        </blockquote>
        <textarea
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
          }}
          placeholder={improve ? t('improvePlaceholder') : t('notePlaceholder')}
          aria-label={improve ? t('improveTitle') : t('noteTitle')}
          rows={4}
          style={{ width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.75rem', borderRadius: 9, border: '1px solid var(--line-strong)', font: 'inherit', lineHeight: 1.5 }}
          autoFocus
          data-testid="selection-body"
        />
        {error ? (
          <p className={modal.errorText} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <footer className={modal.modalFooter}>
        <div className={modal.actions}>
          <AdminButton type="button" tone="secondary" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </AdminButton>
          <AdminButton type="button" onClick={submit} disabled={pending || (!improve && !body.trim())} data-testid="selection-submit">
            {pending ? t('saving') : improve ? t('startImprovement') : t('saveNote')}
          </AdminButton>
        </div>
      </footer>
    </AccessLinkModalPortal>
  );
}
