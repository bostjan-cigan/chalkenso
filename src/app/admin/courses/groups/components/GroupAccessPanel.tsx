'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { FiCopy, FiEdit2, FiLink } from 'react-icons/fi';
import { formatAccessDate, learnerLinkUrl } from '@/lib/access-links';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import {
  revokeGroupAccessLinkInlineAction,
} from '../actions';
import adminStyles from '@/app/admin/admin.module.css';
import EditAccessLinkExpiryModal from './EditAccessLinkExpiryModal';
import GroupAccessLinkModal from './GroupAccessLinkModal';
import type { MemberLinkState } from './MemberLinkModal';
import styles from './MemberLinkModal.module.css';
import { useOrigin } from './use-origin';

type ActiveGroupLink = {
  expiresAt: string;
  id: string;
  lastAccessedAt: string | null;
  token: string;
};

interface GroupAccessPanelProps {
  defaultExpiryValue: string;
  groupId: string;
  initialActiveLink: ActiveGroupLink | null;
  /** The organisation's own learner link address (`{token}`), or null for this installation's. */
  learnerLinkTemplate?: string | null;
}

export default function GroupAccessPanel({
  defaultExpiryValue,
  groupId,
  initialActiveLink,
  learnerLinkTemplate = null,
}: GroupAccessPanelProps) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const router = useRouter();
  const [activeLink, setActiveLink] = useState(initialActiveLink);
  const [modalOpen, setModalOpen] = useState(false);
  const [editExpiryOpen, setEditExpiryOpen] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const { notice, isPending: isRevoking, run } = useActionNotice();
  const origin = useOrigin();

  const fullUrl = activeLink ? learnerLinkUrl(activeLink.token, { template: learnerLinkTemplate, origin }) : '';

  const copyLink = useCallback(async () => {
    if (!fullUrl || typeof window === 'undefined') {
      return;
    }
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopyHint(t('links.copied'));
      window.setTimeout(() => setCopyHint(null), 2200);
    } catch {
      setCopyHint(t('links.copyFailed'));
    }
  }, [fullUrl, t]);

  const handleRevoke = useCallback(() => {
    if (!activeLink) {
      return;
    }
    const formData = new FormData();
    formData.set('groupId', groupId);
    formData.set('linkId', activeLink.id);

    run(() => revokeGroupAccessLinkInlineAction(formData), {
      fallbackError: t('links.revokeFailed'),
      onSuccess: () => setActiveLink(null),
    });
  }, [activeLink, groupId, run, t]);

  const onModalSaved = useCallback((link: NonNullable<MemberLinkState>) => {
    setActiveLink({
      expiresAt: link.expiresAt,
      id: link.id,
      lastAccessedAt: link.lastAccessedAt,
      token: link.token,
    });
    router.refresh();
  }, [router]);

  return (
    <div className={styles.inlineAccessBlock}>
      <ActionNotice notice={notice} />
      {activeLink ? (
        <div className={styles.inlineAccessRow}>
          <div className={styles.inlineAccessMain}>
            <p className={styles.inlineAccessUrl}>{fullUrl}</p>
            <p className={styles.inlineAccessMeta}>
              {t('groupLink.expires', { date: formatAccessDate(new Date(activeLink.expiresAt), locale) })}
              {' · '}
              {activeLink.lastAccessedAt
                ? t('groupLink.lastOpened', { date: formatAccessDate(new Date(activeLink.lastAccessedAt), locale) })
                : t('groupLink.notOpened')}
            </p>
            {copyHint ? <span className={styles.copyFeedback}>{copyHint}</span> : null}
          </div>
          <div className={styles.inlineAccessActions}>
            <AdminButton size="compact" type="button" tone="plain" onClick={copyLink} disabled={isRevoking}>
              <FiCopy size={15} />
              {t('links.copy')}
            </AdminButton>
            <AdminButton size="compact"
              href={learnerLinkUrl(activeLink.token, { template: learnerLinkTemplate })}
              tone="plain"
              target="_blank"
              rel="noreferrer"
            >
              <FiLink size={15} />
              {t('links.open')}
            </AdminButton>
            <AdminButton size="compact"
              type="button"
              tone="plain"
              onClick={() => {
                window.setTimeout(() => setEditExpiryOpen(true), 0);
              }}
              disabled={isRevoking}
            >
              <FiEdit2 size={15} />
              {t('links.edit')}
            </AdminButton>
            <AdminButton size="compact"
              type="button"
              tone="plain"
              onClick={handleRevoke}
              disabled={isRevoking}
            >
              {isRevoking ? t('links.revoking') : t('links.revoke')}
            </AdminButton>
          </div>
        </div>
      ) : (
        <div className={adminStyles.emptyState}>
          <h3 className={adminStyles.emptyStateTitle}>{t('groupLink.emptyTitle')}</h3>
          <p className={adminStyles.emptyStateText}>{t('groupLink.emptyText')}</p>
          <AdminButton size="compact"
            type="button"
            onClick={() => {
              window.setTimeout(() => setModalOpen(true), 0);
            }}
          >
            {t('groupLink.create')}
          </AdminButton>
        </div>
      )}

      <GroupAccessLinkModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        groupId={groupId}
        defaultExpiryValue={defaultExpiryValue}
        onSaved={(link) => {
          onModalSaved(link);
          setModalOpen(false);
        }}
      />

      {activeLink ? (
        <EditAccessLinkExpiryModal
          open={editExpiryOpen}
          onClose={() => setEditExpiryOpen(false)}
          groupId={groupId}
          link={activeLink}
          variant="group"
          onSaved={(link) => {
            onModalSaved(link);
            setEditExpiryOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
