'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import Dropdown from '@/components/Dropdown';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import AdminCheckbox from '@/app/admin/components/ui/AdminCheckbox';
import { formatAccessDate } from '@/lib/access-links';
import type { UnattachedFeedbackSource } from '@/lib/unattached-feedback';
import { moveFeedbackToLearnerAction } from '../feedback-transfer-actions';
import AccessLinkModalPortal from './AccessLinkModalPortal';
import styles from './MemberLinkModal.module.css';

/**
 * Moving feedback whose learner left the roster (by the old link it came from) to a learner on it, so
 * it shows on their link: tick the feedback, choose the learner, Move.
 */
export default function MoveFeedbackModal({
  open,
  onClose,
  groupId,
  sources,
  members,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  sources: UnattachedFeedbackSource[];
  members: Array<{ id: string; label: string }>;
}) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(sources.length === 1 ? [sources[0].key] : []));
  const [memberId, setMemberId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const count = sources.filter((source) => chosen.has(source.key)).reduce((total, source) => total + source.count, 0);

  const toggle = (key: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const move = () =>
    startTransition(async () => {
      const result = await moveFeedbackToLearnerAction({ groupId, memberId, sources: Array.from(chosen) });
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
          {t('moveFeedback.title')}
        </h2>
        <p id={descriptionId} className={styles.modalDescription}>
          {t('moveFeedback.text')}
        </p>
      </header>
      <div className={styles.modalBody} style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'grid', gap: '0.75rem' }} data-testid="unattached-sources">
          {sources.map((source) => (
            <AdminCheckbox
              key={source.key}
              checked={chosen.has(source.key)}
              onChange={() => toggle(source.key)}
              label={`${t('moveFeedback.pieces', { count: source.count })} · ${
                source.linkMadeAt
                  ? t('moveFeedback.linkMade', { date: formatAccessDate(new Date(source.linkMadeAt), locale) })
                  : t('moveFeedback.linkGone')
              }`}
              hint={
                <>
                  {formatAccessDate(new Date(source.firstAt), locale)}
                  {source.lastAt !== source.firstAt ? ` – ${formatAccessDate(new Date(source.lastAt), locale)}` : ''} ·{' '}
                  {t('moveFeedback.lessons', { count: source.lessons.length, lessons: source.lessons.join(', ') })} ·{' '}
                  {t('moveFeedback.sample', { sample: source.sample })}
                </>
              }
            />
          ))}
        </div>
        <Dropdown
          id={`move-feedback-${groupId}`}
          name="memberId"
          label={t('moveFeedback.moveTo')}
          placeholder={t('moveFeedback.choose')}
          options={members.map((member) => ({ value: member.id, label: member.label }))}
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
          <AdminButton type="button" onClick={move} disabled={pending || !count || !memberId} data-testid="move-feedback-confirm">
            {pending ? t('moveFeedback.moving') : count ? t('moveFeedback.moveCount', { count }) : t('moveFeedback.move')}
          </AdminButton>
        </div>
      </footer>
    </AccessLinkModalPortal>
  );
}
