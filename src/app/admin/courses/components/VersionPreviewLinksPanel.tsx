'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { FiCopy, FiLink, FiPlus, FiTrash2 } from 'react-icons/fi';
import { formatAccessDate, learnerLinkUrl } from '@/lib/access-links';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import AdminBadge from '../../components/ui/AdminBadge';
import AdminButton from '../../components/ui/AdminButton';
import ActionNotice from '../../components/ui/ActionNotice';
import { useActionNotice } from '../../components/ui/useActionNotice';
import AccessExpiryPicker from '../groups/components/AccessExpiryPicker';
import AccessLinkModalPortal from '../groups/components/AccessLinkModalPortal';
import modalStyles from '../groups/components/MemberLinkModal.module.css';
import {
  createPreviewLinkAction,
  deletePreviewLinkAction,
  revokePreviewLinkAction,
} from '../versions/preview-link-actions';
import {
  getPreviewLinkStatus,
  type PreviewLinkStatus,
  type PreviewLinkView,
} from '../versions/preview-link-view';
import ConfirmDialog from './ConfirmDialog';
import styles from '../../admin.module.css';

interface VersionPreviewLinksPanelProps {
  courseId: string;
  versionId: string;
  links: PreviewLinkView[];
  defaultExpiryValue: string;
  /** The organisation's own learner link address (`{token}`), or null for this installation's. */
  learnerLinkTemplate?: string | null;
}

/** Each status's badge (its words are `courses.previewLinks.status.<status>`). */
const STATUS_BADGE: Record<PreviewLinkStatus, 'accent' | 'warning' | 'muted' | 'inactive'> = {
  active: 'accent',
  opened: 'warning',
  expired: 'inactive',
  revoked: 'inactive',
};

/**
 * Reusable links follow the organisation's learner link address. One-time links always stay here:
 * the first browser to open one claims it with a cookie, which only this installation can set.
 */
function previewUrl(link: PreviewLinkView, template: string | null, origin = '') {
  return learnerLinkUrl(link.token, { template: link.oneTime ? null : template, origin });
}

/**
 * "Share preview" section of the version page: mint shareable links to this version (drafts
 * included) that follow group-link rules (read-only, expiry, revocable), optionally one-time.
 */
export default function VersionPreviewLinksPanel({
  courseId,
  versionId,
  links,
  defaultExpiryValue,
  learnerLinkTemplate = null,
}: VersionPreviewLinksPanelProps) {
  const t = useTranslations('courses.previewLinks');
  const locale = useLocale();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PreviewLinkView | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [freshLinkId, setFreshLinkId] = useState<string | null>(null);
  /** Filled after mount so the server render and hydration agree (relative URL first). */
  const [origin, setOrigin] = useState('');
  const { notice, isPending, run } = useActionNotice();
  const { isPending: isDeleting, run: runDelete } = useActionNotice();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const formatDate = (value: string) => formatAccessDate(new Date(value), locale);

  function describeLink(link: PreviewLinkView, status: PreviewLinkStatus) {
    const parts = [link.oneTime ? t('oneTime') : t('reusable')];

    if (status === 'revoked' && link.revokedAt) {
      parts.push(t('revokedOn', { date: formatDate(link.revokedAt) }));
    } else {
      parts.push(
        status === 'expired' ? t('expiredOn', { date: formatDate(link.expiresAt) }) : t('expiresOn', { date: formatDate(link.expiresAt) })
      );
    }

    if (link.oneTime && link.claimedAt) {
      parts.push(t('openedOn', { date: formatDate(link.claimedAt) }));
    } else if (link.lastAccessedAt) {
      parts.push(t('lastOpenedOn', { date: formatDate(link.lastAccessedAt) }));
    } else {
      parts.push(t('notOpened'));
    }

    return parts.join(' · ');
  }

  const withStatus = links.map((link) => ({ link, status: getPreviewLinkStatus(link) }));
  const live = withStatus.filter(({ status }) => status === 'active' || status === 'opened');
  const inactive = withStatus.filter(({ status }) => status === 'expired' || status === 'revoked');

  const copyLink = useCallback(async (link: PreviewLinkView) => {
    const copied = await copyTextToClipboard(previewUrl(link, learnerLinkTemplate, window.location.origin));
    setCopiedId(copied ? link.id : null);
    if (copied) {
      window.setTimeout(() => setCopiedId((current) => (current === link.id ? null : current)), 2200);
    }
  }, [learnerLinkTemplate]);

  function revoke(linkId: string) {
    const formData = new FormData();
    formData.set('courseId', courseId);
    formData.set('versionId', versionId);
    formData.set('linkId', linkId);
    run(() => revokePreviewLinkAction(formData), {
      fallbackError: t('revokeFailed'),
    });
  }

  function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    const formData = new FormData();
    formData.set('courseId', courseId);
    formData.set('versionId', versionId);
    formData.set('linkId', deleteTarget.id);
    runDelete(() => deletePreviewLinkAction(formData), {
      fallbackError: t('deleteFailed'),
      onSuccess: () => setDeleteTarget(null),
    });
  }

  const renderRow = ({ link, status }: (typeof withStatus)[number]) => {
    const isLive = status === 'active' || status === 'opened';

    return (
      <div
        key={link.id}
        className={modalStyles.inlineAccessRow}
        style={link.id === freshLinkId ? { borderColor: 'rgba(var(--accent-color), 0.45)' } : undefined}
      >
        <div className={modalStyles.inlineAccessMain}>
          <p className={modalStyles.inlineAccessMeta} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <AdminBadge variant={STATUS_BADGE[status]}>{t(`status.${status}`)}</AdminBadge>
            {link.label ? (
              <strong style={{ color: 'rgb(var(--foreground-rgb))', fontSize: '0.84rem' }}>
                {link.label}
              </strong>
            ) : null}
          </p>
          {isLive ? (
            <p className={modalStyles.inlineAccessUrl}>{previewUrl(link, learnerLinkTemplate, origin)}</p>
          ) : null}
          <p className={modalStyles.inlineAccessMeta}>{describeLink(link, status)}</p>
          {copiedId === link.id ? (
            <span className={modalStyles.copyFeedback}>{t('copied')}</span>
          ) : null}
        </div>
        {isLive ? (
          <div className={modalStyles.inlineAccessActions}>
            <AdminButton type="button" tone="plain" size="compact" onClick={() => copyLink(link)}>
              <FiCopy size={14} />
              {t('copy')}
            </AdminButton>
            {/* Opening a one-time link here would claim it for the admin's own browser. */}
            {!link.oneTime ? (
              <AdminButton
                href={previewUrl(link, learnerLinkTemplate)}
                tone="plain"
                size="compact"
                target="_blank"
                rel="noreferrer"
              >
                <FiLink size={14} />
                {t('open')}
              </AdminButton>
            ) : null}
            <AdminButton
              type="button"
              tone="plain"
              size="compact"
              disabled={isPending}
              onClick={() => revoke(link.id)}
            >
              {t('revoke')}
            </AdminButton>
          </div>
        ) : (
          <div className={modalStyles.inlineAccessActions}>
            <AdminButton
              type="button"
              tone="dangerText"
              size="compact"
              disabled={isDeleting}
              onClick={() => setDeleteTarget(link)}
            >
              <FiTrash2 size={14} />
              {t('delete')}
            </AdminButton>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={modalStyles.inlineAccessBlock}>
      <p className={styles.helperText}>{t('intro')}</p>

      <ActionNotice notice={notice} />

      <span className={styles.fieldLabel}>{t('activeHeading', { count: live.length })}</span>
      {live.length > 0 ? live.map(renderRow) : (
        <p className={styles.helperText}>{t('noActive')}</p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <AdminButton
          type="button"
          size="compact"
          onClick={() => {
            window.setTimeout(() => setModalOpen(true), 0);
          }}
        >
          <FiPlus size={14} />
          {t('create')}
        </AdminButton>
      </div>

      {inactive.length > 0 ? (
        <>
          <span className={styles.fieldLabel}>{t('inactiveHeading', { count: inactive.length })}</span>
          {inactive.map(renderRow)}
        </>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('deleteTitle')}
        description={
          deleteTarget
            ? deleteTarget.label
              ? t('deleteNamedDescription', { label: deleteTarget.label })
              : t('deleteDescription')
            : ''
        }
        confirmLabel={t('deleteConfirm')}
        tone="danger"
        pending={isDeleting}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />

      <CreatePreviewLinkModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        courseId={courseId}
        versionId={versionId}
        defaultExpiryValue={defaultExpiryValue}
        onCreated={(link) => {
          setFreshLinkId(link.id);
          void copyLink(link);
        }}
      />
    </div>
  );
}

interface CreatePreviewLinkModalProps {
  open: boolean;
  onClose: () => void;
  courseId: string;
  versionId: string;
  defaultExpiryValue: string;
  onCreated: (link: PreviewLinkView) => void;
}

function CreatePreviewLinkModal({
  open,
  onClose,
  courseId,
  versionId,
  defaultExpiryValue,
  onCreated,
}: CreatePreviewLinkModalProps) {
  const t = useTranslations('courses.previewLinks.modal');
  const titleId = useId();
  const descriptionId = useId();
  const [label, setLabel] = useState('');
  const [oneTime, setOneTime] = useState(false);
  const [expiry, setExpiry] = useState(defaultExpiryValue);
  const { notice, isPending, run, setNotice } = useActionNotice();

  useEffect(() => {
    if (!open) {
      return;
    }
    setLabel('');
    setOneTime(false);
    setExpiry(defaultExpiryValue);
    setNotice(null);
  }, [open, defaultExpiryValue, setNotice]);

  function submit() {
    const formData = new FormData();
    formData.set('courseId', courseId);
    formData.set('versionId', versionId);
    formData.set('label', label);
    formData.set('oneTime', String(oneTime));
    formData.set('expiresAt', expiry);

    run(() => createPreviewLinkAction(formData), {
      fallbackError: t('createFailed'),
      onSuccess: (result) => {
        if ('link' in result) {
          onCreated(result.link);
          onClose();
        }
      },
    });
  }

  const radioLabelStyle = {
    display: 'inline-flex',
    gap: '0.5rem',
    alignItems: 'center',
    cursor: 'pointer',
  } as const;

  return (
    <AccessLinkModalPortal
      open={open}
      onClose={onClose}
      titleId={titleId}
      descriptionId={descriptionId}
    >
      <header className={modalStyles.modalHeader}>
        <h2 id={titleId} className={modalStyles.modalTitle}>
          {t('title')}
        </h2>
        <p id={descriptionId} className={modalStyles.modalDescription}>
          {t('description')}
        </p>
      </header>

      <div className={modalStyles.modalBody}>
        <ActionNotice notice={notice} />

        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('note')}</span>
          <input
            className={styles.textInput}
            value={label}
            maxLength={120}
            placeholder={t('notePlaceholder')}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>

        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <span className={styles.fieldLabel}>{t('usage')}</span>
          <div style={{ display: 'grid', gap: '0.45rem', marginTop: '0.5rem' }}>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="preview-usage"
                checked={!oneTime}
                onChange={() => setOneTime(false)}
              />
              <span>{t('reusable')}</span>
            </label>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="preview-usage"
                checked={oneTime}
                onChange={() => setOneTime(true)}
              />
              <span>{t('oneTime')}</span>
            </label>
          </div>
        </fieldset>

        <span className={styles.fieldLabel}>{t('expires')}</span>
        {oneTime ? (
          <span className={styles.fieldHint}>
            {t('expiresHint')}
          </span>
        ) : null}
        <AccessExpiryPicker idPrefix="preview-link" value={expiry} onChange={setExpiry} />
      </div>

      <footer className={modalStyles.modalFooter}>
        <div className={modalStyles.actions}>
          <AdminButton type="button" tone="secondary" onClick={onClose}>
            {t('cancel')}
          </AdminButton>
          <AdminButton type="button" onClick={submit} disabled={isPending}>
            {isPending ? t('creating') : t('create')}
          </AdminButton>
        </div>
      </footer>
    </AccessLinkModalPortal>
  );
}
