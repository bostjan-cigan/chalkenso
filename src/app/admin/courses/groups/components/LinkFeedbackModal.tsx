'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Dropdown from '@/components/Dropdown';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import { linkFeedbackToLearnerAction } from '../feedback-transfer-actions';
import AccessLinkModalPortal from './AccessLinkModalPortal';
import styles from './MemberLinkModal.module.css';

/** A group's roster, for linking feedback to a learner on it. */
export type FeedbackRoster = { groupId: string; learners: Array<{ id: string; label: string }> };

/**
 * One piece of feedback that isn't on its learner's current link, put on it: its learner left the
 * roster (removed, or added again as a new entry), or it came through a link made again since. It
 * moves to the learner chosen (its own, to start with) and shows on their link, as theirs.
 */
export default function LinkFeedbackModal({
  open,
  onClose,
  commentId,
  memberId: currentMemberId,
  roster,
}: {
  open: boolean;
  onClose: () => void;
  commentId: string;
  /** Its learner, when they are still on the roster. */
  memberId: string | null;
  roster: FeedbackRoster;
}) {
  const t = useTranslations('groups');
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const known = currentMemberId && roster.learners.some((learner) => learner.id === currentMemberId) ? currentMemberId : '';
  const [memberId, setMemberId] = useState(known);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const link = () =>
    startTransition(async () => {
      const result = await linkFeedbackToLearnerAction({ groupId: roster.groupId, commentId, memberId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onClose();
      router.refresh();
    });

  return (
    <AccessLinkModalPortal open={open} onClose={onClose} titleId={titleId} descriptionId={descriptionId}>
      <header className={styles.modalHeader}>
        <h2 id={titleId} className={styles.modalTitle}>
          {t('linkFeedback.title')}
        </h2>
        <p id={descriptionId} className={styles.modalDescription}>
          {known ? t('linkFeedback.olderLink') : t('linkFeedback.leftRoster')} {t('linkFeedback.anonymous')}
        </p>
      </header>
      <div className={styles.modalBody}>
        <Dropdown
          id={`link-feedback-${commentId}`}
          name="memberId"
          label={t('linkFeedback.learner')}
          placeholder={t('linkFeedback.choose')}
          defaultValue={known}
          options={roster.learners.map((learner) => ({ value: learner.id, label: learner.label }))}
          onValueChange={setMemberId}
        />
        {error ? (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <footer className={styles.modalFooter}>
        <div className={styles.actions}>
          <AdminButton type="button" tone="secondary" onClick={onClose} disabled={pending}>
            {t('links.cancel')}
          </AdminButton>
          <AdminButton type="button" onClick={link} disabled={pending || !memberId} data-testid="link-feedback-confirm">
            {pending ? t('linkFeedback.linking') : t('linkFeedback.link')}
          </AdminButton>
        </div>
      </footer>
    </AccessLinkModalPortal>
  );
}
