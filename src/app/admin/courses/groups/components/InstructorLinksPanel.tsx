'use client';

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FiCopy, FiLink, FiRefreshCw } from 'react-icons/fi';
import { formatAccessDate, learnerLinkUrl } from '@/lib/access-links';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import {
  getInstructorLinkAction,
  resetInstructorLinkAction,
  revokeInstructorLinkAction,
} from '../instructor-link-actions';
import adminStyles from '@/app/admin/admin.module.css';
import styles from './MemberLinkModal.module.css';
import { useOrigin } from './use-origin';

type OwnLink = { token: string; expiresAt: string };

export type InstructorLinkRow = {
  id: string;
  name: string;
  /** The viewer's own link. */
  mine: boolean;
  expiresAt: string;
  lastAccessedAt: string | null;
};

interface InstructorLinksPanelProps {
  groupId: string;
  /** The organisation's own learner link address (`{token}`), or null for this installation's. */
  learnerLinkTemplate?: string | null;
  /** Whether the viewer may add instructor notes for the group (and so have a link). */
  canNote: boolean;
  initialLink: OwnLink | null;
  /** Everyone's links, for the people who manage the group (null: not shown). */
  links: InstructorLinkRow[] | null;
  /** The sentence on what the link does (off where a page says it once for several groups). */
  intro?: boolean;
}

/**
 * Instructor links on the group page: your own link to the learners' pages (open, copy, new address),
 * and for the people who manage the group, who has one, with Revoke. Its words are all in
 * `groups.instructorLinks`, so a page outside the groups (Home) gives it just those.
 */
export default function InstructorLinksPanel({
  groupId,
  learnerLinkTemplate = null,
  canNote,
  initialLink,
  links,
  intro = true,
}: InstructorLinksPanelProps) {
  const t = useTranslations('groups.instructorLinks');
  const locale = useLocale();
  const [link, setLink] = useState(initialLink);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const { notice, isPending, run } = useActionNotice();
  const origin = useOrigin();

  const fullUrl = link ? learnerLinkUrl(link.token, { template: learnerLinkTemplate, origin }) : '';

  const copyLink = useCallback(async () => {
    if (!fullUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopyHint(t('copied'));
      window.setTimeout(() => setCopyHint(null), 2200);
    } catch {
      setCopyHint(t('copyFailed'));
    }
  }, [fullUrl, t]);

  return (
    <div className={styles.inlineAccessBlock} data-testid="instructor-links">
      <ActionNotice notice={notice} />
      {canNote ? (
        <>
          {intro ? <p className={adminStyles.fieldHint} style={{ margin: 0 }}>{t('intro')}</p> : null}
          {link ? (
            <div className={styles.inlineAccessRow}>
              <div className={styles.inlineAccessMain}>
                <p className={styles.inlineAccessUrl} data-testid="instructor-link-url">
                  {fullUrl}
                </p>
                <p className={styles.inlineAccessMeta}>{t('yours', { date: formatAccessDate(new Date(link.expiresAt), locale) })}</p>
                {copyHint ? <span className={styles.copyFeedback}>{copyHint}</span> : null}
              </div>
              <div className={styles.inlineAccessActions}>
                <AdminButton size="compact" href={fullUrl} tone="plain" target="_blank" rel="noreferrer">
                  <FiLink size={15} />
                  {t('open')}
                </AdminButton>
                <AdminButton size="compact" type="button" tone="plain" onClick={copyLink} disabled={isPending}>
                  <FiCopy size={15} />
                  {t('copy')}
                </AdminButton>
                <AdminButton size="compact"
                  type="button"
                  tone="plain"
                  disabled={isPending}
                  onClick={() =>
                    run(() => resetInstructorLinkAction(groupId), {
                      fallbackError: t('resetFailed'),
                      onSuccess: (result) => {
                        if (result.ok) setLink(result.link);
                      },
                    })
                  }
                >
                  <FiRefreshCw size={15} />
                  {t('reset')}
                </AdminButton>
              </div>
            </div>
          ) : (
            <div>
              <AdminButton size="compact"
                type="button"
                disabled={isPending}
                data-testid="instructor-link-create"
                onClick={() =>
                  run(() => getInstructorLinkAction(groupId), {
                    fallbackError: t('createFailed'),
                    refresh: false,
                    onSuccess: (result) => {
                      if (result.ok) setLink(result.link);
                    },
                  })
                }
              >
                {isPending ? t('creating') : t('create')}
              </AdminButton>
            </div>
          )}
        </>
      ) : null}

      {links && links.length > 0 ? (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <p className={adminStyles.fieldHint} style={{ margin: 0, fontWeight: 600 }}>
            {t('withLink')}
          </p>
          {links.map((row) => (
            <div key={row.id} className={styles.inlineAccessRow} data-testid="instructor-link-row">
              <div className={styles.inlineAccessMain}>
                <p className={styles.inlineAccessName}>{row.name}</p>
                <p className={styles.inlineAccessMeta}>
                  {row.lastAccessedAt
                    ? t('lastOpened', { date: formatAccessDate(new Date(row.lastAccessedAt), locale) })
                    : t('notOpened')}
                  {` · ${t('expires', { date: formatAccessDate(new Date(row.expiresAt), locale) })}`}
                </p>
              </div>
              <div className={styles.inlineAccessActions}>
                <AdminButton size="compact"
                  type="button"
                  tone="plain"
                  disabled={isPending}
                  onClick={() =>
                    run(() => revokeInstructorLinkAction(groupId, row.id), {
                      fallbackError: t('revokeFailed'),
                      onSuccess: () => {
                        if (row.mine) setLink(null);
                      },
                    })
                  }
                >
                  {t('revoke')}
                </AdminButton>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
