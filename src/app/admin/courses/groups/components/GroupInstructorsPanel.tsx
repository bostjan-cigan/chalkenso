'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FiCopy } from 'react-icons/fi';
import { formatAccessDate } from '@/lib/access-links';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import AdminField from '@/app/admin/components/ui/AdminField';
import { InviteDeliveryControlled } from '@/app/admin/components/InviteDelivery';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import AdminSearchableSelectField from '@/app/admin/components/ui/AdminSearchableSelectField';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import {
  addGroupInstructorAction,
  inviteGuestInstructorAction,
  removeGroupInstructorAction,
  withdrawGuestInviteAction,
} from '../instructor-actions';
import adminStyles from '@/app/admin/admin.module.css';
import styles from './MemberLinkModal.module.css';

export type InstructorRow = { userId: string; name: string };
/** Someone who could teach the group; `gives` says what adding them gives (null: nothing needed). */
export type InstructorCandidate = { userId: string; name: string; gives: string | null };
/** An invite sent from this page that nobody has used yet. */
export type PendingInviteRow = { id: string; label: string; expiresAt: string };

interface GroupInstructorsPanelProps {
  groupId: string;
  instructors: InstructorRow[];
  /** People who manage the group add and remove instructors; everyone else reads the list. */
  canManage: boolean;
  candidates: InstructorCandidate[];
  pendingInvites: PendingInviteRow[];
}

/**
 * Who teaches the group: the list, and for the people who manage it, Add and Remove, and inviting a
 * guest instructor who isn't on the team yet (an invite link to copy, and the unused ones to withdraw).
 */
export default function GroupInstructorsPanel({
  groupId,
  instructors,
  canManage,
  candidates,
  pendingInvites,
}: GroupInstructorsPanelProps) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const [picked, setPicked] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [delivery, setDelivery] = useState<'link' | 'email'>('link');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { notice, isPending, run } = useActionNotice();

  const copyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard denied: the link is on screen to copy by hand */
    }
  };

  return (
    <div className={styles.inlineAccessBlock} data-testid="group-instructors">
      <ActionNotice notice={notice} />
      <p className={adminStyles.fieldHint} style={{ margin: 0 }}>
        {t('instructors.intro')}
      </p>
      {instructors.length ? (
        instructors.map((instructor) => (
          <div key={instructor.userId} className={styles.inlineAccessRow} data-testid="group-instructor">
            <div className={styles.inlineAccessMain}>
              <p className={styles.inlineAccessName}>{instructor.name}</p>
            </div>
            {canManage ? (
              <div className={styles.inlineAccessActions}>
                <AdminButton
                  type="button"
                  tone="plain"
                  size="compact"
                  disabled={isPending}
                  onClick={() =>
                    run(() => removeGroupInstructorAction(groupId, instructor.userId), {
                      fallbackError: t('instructors.removeFailed'),
                    })
                  }
                >
                  {t('instructors.remove')}
                </AdminButton>
              </div>
            ) : null}
          </div>
        ))
      ) : (
        <p className={adminStyles.fieldHint} style={{ margin: 0, fontWeight: 600 }}>
          {t('instructors.none')}
        </p>
      )}
      {canManage && candidates.length ? (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <AdminSearchableSelectField
              id={`group-instructor-add-${groupId}`}
              label={t('instructors.addLabel')}
              value={picked}
              placeholder={t('instructors.addPlaceholder')}
              searchPlaceholder={t('instructors.addSearch')}
              options={candidates.map((candidate) => ({
                value: candidate.userId,
                label: candidate.name,
                ...(candidate.gives ? { hint: candidate.gives } : {}),
              }))}
              onValueChange={setPicked}
            />
          </div>
          <AdminButton
            type="button"
            size="compact"
            disabled={!picked || isPending}
            onClick={() =>
              run(() => addGroupInstructorAction(groupId, picked), {
                fallbackError: t('instructors.addFailed'),
                onSuccess: () => setPicked(''),
              })
            }
          >
            {t('instructors.add')}
          </AdminButton>
        </div>
      ) : null}

      {canManage ? (
        <div style={{ display: 'grid', gap: '0.6rem' }} data-testid="guest-invite">
          {inviteLink ? (
            <div className={styles.inlineAccessRow}>
              <div className={styles.inlineAccessMain}>
                <p className={styles.inlineAccessUrl} data-testid="guest-invite-link">
                  {inviteLink}
                </p>
                <p className={styles.inlineAccessMeta}>{t('instructors.invite.sendIt')}</p>
                {copied ? <span className={styles.copyFeedback}>{t('links.copied')}</span> : null}
              </div>
              <div className={styles.inlineAccessActions}>
                <AdminButton type="button" tone="plain" size="compact" onClick={copyInvite}>
                  <FiCopy size={15} />
                  {t('links.copy')}
                </AdminButton>
                <AdminButton type="button" tone="secondary" size="compact" onClick={() => setInviteLink(null)}>
                  {t('instructors.invite.done')}
                </AdminButton>
              </div>
            </div>
          ) : inviting ? (
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <div style={{ maxWidth: 420 }}>
                <AdminField
                  id={`guest-invite-name-${groupId}`}
                  label={t('instructors.invite.nameLabel')}
                  placeholder={t('instructors.invite.namePlaceholder')}
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                />
              </div>
              <InviteDeliveryControlled
                idPrefix={`guest-invite-${groupId}`}
                delivery={delivery}
                onChange={setDelivery}
                email={inviteEmail}
                onEmail={setInviteEmail}
              />
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <AdminButton
                type="button"
                size="compact"
                disabled={!inviteName.trim() || (delivery === 'email' && !inviteEmail.trim()) || isPending}
                onClick={() =>
                  run(() => inviteGuestInstructorAction(groupId, inviteName, delivery === 'email' ? inviteEmail : ''), {
                    fallbackError: t('instructors.invite.failed'),
                    onSuccess: (result) => {
                      setInviteLink(result.link ?? null);
                      setInviteName('');
                      setInviteEmail('');
                      setInviting(false);
                    },
                  })
                }
              >
                {delivery === 'email' ? t('instructors.invite.send') : t('instructors.invite.createLink')}
              </AdminButton>
              <AdminButton type="button" tone="secondary" size="compact" onClick={() => setInviting(false)}>
                {t('links.cancel')}
              </AdminButton>
              </div>
            </div>
          ) : (
            <div>
              <AdminButton type="button" tone="secondary" size="compact" onClick={() => setInviting(true)} data-testid="guest-invite-start">
                {t('instructors.invite.start')}
              </AdminButton>
              <p className={adminStyles.fieldHint} style={{ margin: '0.35rem 0 0' }}>
                {t('instructors.invite.startHint')}
              </p>
            </div>
          )}

          {pendingInvites.map((invite) => (
            <div key={invite.id} className={styles.inlineAccessRow} data-testid="guest-invite-pending">
              <div className={styles.inlineAccessMain}>
                <p className={styles.inlineAccessName}>{invite.label}</p>
                <p className={styles.inlineAccessMeta}>
                  {t('instructors.invite.pending', { date: formatAccessDate(new Date(invite.expiresAt), locale) })}
                </p>
              </div>
              <div className={styles.inlineAccessActions}>
                <AdminButton
                  type="button"
                  tone="plain"
                  size="compact"
                  disabled={isPending}
                  onClick={() =>
                    run(() => withdrawGuestInviteAction(groupId, invite.id), {
                      fallbackError: t('instructors.invite.withdrawFailed'),
                    })
                  }
                >
                  {t('instructors.invite.withdraw')}
                </AdminButton>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
