'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { FiCopy, FiEdit2, FiLink } from 'react-icons/fi';
import { formatAccessDate, learnerLinkUrl } from '@/lib/access-links';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import { revokeAccessLinkInlineAction } from '../actions';
import type { UnattachedFeedbackSource } from '@/lib/unattached-feedback';
import BulkMemberLinksModal from './BulkMemberLinksModal';
import EditAccessLinkExpiryModal from './EditAccessLinkExpiryModal';
import MemberLinkModal, { type MemberLinkState } from './MemberLinkModal';
import MoveFeedbackModal from './MoveFeedbackModal';
import modalStyles from './MemberLinkModal.module.css';
import styles from './GroupMembersPanel.module.css';
import { useOrigin } from './use-origin';

export type GroupMemberSerialized = {
  accessLink: MemberLinkState;
  fullName: string;
  id: string;
  position: number;
};

interface GroupMembersPanelProps {
  defaultExpiryValue: string;
  groupId: string;
  members: GroupMemberSerialized[];
  /** The organisation's own learner link address (`{token}`), or null for this installation's. */
  learnerLinkTemplate?: string | null;
  /** Feedback whose learner left the roster, by the old link it came from (to move to a learner). */
  unattached?: UnattachedFeedbackSource[];
}

export default function GroupMembersPanel({
  defaultExpiryValue,
  groupId,
  members,
  learnerLinkTemplate = null,
  unattached = [],
}: GroupMembersPanelProps) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const router = useRouter();
  const origin = useOrigin();
  // Links made, changed or revoked here, until the page's data catches up (a refresh brings fresh
  // members, which drops these: "Make links for all learners" replaces every link at once).
  const [changed, setChanged] = useState<Record<string, MemberLinkState>>({});
  const [loadedMembers, setLoadedMembers] = useState(members);
  if (loadedMembers !== members) {
    setLoadedMembers(members);
    setChanged({});
  }
  const linkByMemberId = useMemo<Record<string, MemberLinkState>>(
    () => Object.fromEntries(members.map((m) => [m.id, m.id in changed ? changed[m.id] : m.accessLink])),
    [members, changed]
  );

  const [createModalMemberId, setCreateModalMemberId] = useState<string | null>(null);
  const [editModalMemberId, setEditModalMemberId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const unattachedCount = unattached.reduce((total, source) => total + source.count, 0);
  const [copyHintMemberId, setCopyHintMemberId] = useState<string | null>(null);
  const [copyAllHint, setCopyAllHint] = useState<string | null>(null);
  const [revokingMemberId, setRevokingMemberId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const createModalMember = useMemo(
    () => members.find((m) => m.id === createModalMemberId) ?? null,
    [createModalMemberId, members]
  );

  const editTarget = useMemo(() => {
    if (!editModalMemberId) {
      return null;
    }
    const member = members.find((m) => m.id === editModalMemberId);
    if (!member) {
      return null;
    }
    const link = linkByMemberId[member.id];
    if (!link) {
      return null;
    }
    return { link, member };
  }, [editModalMemberId, members, linkByMemberId]);

  const copyMemberUrl = useCallback(async (memberId: string, token: string) => {
    const url = learnerLinkUrl(token, { template: learnerLinkTemplate, origin });
    try {
      await navigator.clipboard.writeText(url);
      setCopyHintMemberId(memberId);
      window.setTimeout(() => setCopyHintMemberId(null), 2200);
    } catch {
      /* clipboard denied */
    }
  }, [learnerLinkTemplate, origin]);

  // Every learner's link as "1. Name: link", one per line, to paste into an email or a chat.
  const withLinks = members.flatMap((member) => {
    const link = linkByMemberId[member.id];
    return link ? [{ member, link }] : [];
  });
  const copyAllUrls = async () => {
    const lines = withLinks.map(
      ({ member, link }) => `${member.position}. ${member.fullName}: ${learnerLinkUrl(link.token, { template: learnerLinkTemplate, origin })}`
    );
    const missing = members.length - withLinks.length;
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyAllHint(
        missing
          ? t('members.copiedAllMissing', { count: lines.length, missing })
          : t('members.copiedAll', { count: lines.length })
      );
    } catch {
      setCopyAllHint(t('members.copyAllFailed'));
    }
    window.setTimeout(() => setCopyAllHint(null), 3200);
  };

  const revokeMemberLink = useCallback(
    (memberId: string, linkId: string) => {
      setRevokingMemberId(memberId);
      const formData = new FormData();
      formData.set('groupId', groupId);
      formData.set('linkId', linkId);

      void revokeAccessLinkInlineAction(formData).then((result) => {
        setRevokingMemberId(null);
        if (!result.ok) {
          return;
        }
        setChanged((prev) => ({ ...prev, [memberId]: null }));
        refresh();
      });
    },
    [groupId, refresh]
  );

  return (
    <div className={styles.wrap}>
      {unattachedCount ? (
        <div className={styles.unattached} data-testid="unattached-feedback">
          <span>
            <strong>{t('members.unattached', { count: unattachedCount })}</strong> {t('members.unattachedHint')}
          </span>
          <AdminButton type="button" tone="secondary" size="compact" onClick={() => setMoveOpen(true)} data-testid="move-feedback">
            {t('members.moveFeedback')}
          </AdminButton>
        </div>
      ) : null}
      <div className={styles.bulkBar}>
        {copyAllHint ? (
          <span className={modalStyles.copyFeedback} data-testid="copy-all-links-hint">
            {copyAllHint}
          </span>
        ) : null}
        {withLinks.length ? (
          <AdminButton type="button" tone="secondary" size="compact" onClick={copyAllUrls} data-testid="copy-all-links">
            <FiCopy size={15} />
            {t('members.copyAll')}
          </AdminButton>
        ) : null}
        <AdminButton
          type="button"
          tone="secondary"
          size="compact"
          onClick={() => {
            window.setTimeout(() => setBulkOpen(true), 0);
          }}
        >
          {t('members.makeAll')}
        </AdminButton>
      </div>

      <div className={styles.grid}>
        {members.map((member) => {
          const link = linkByMemberId[member.id] ?? null;
          const hasLink = Boolean(link);

          return (
            <div key={member.id} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.index}>{member.position}</span>
                <div className={styles.cardBody}>
                  <p className={styles.name}>{member.fullName}</p>
                  <p className={styles.meta}>
                    {hasLink && link
                      ? `${t('members.active', { date: formatAccessDate(new Date(link.expiresAt), locale) })} · ${
                          link.lastAccessedAt
                            ? t('members.lastOpened', { date: formatAccessDate(new Date(link.lastAccessedAt), locale) })
                            : t('members.notOpened')
                        }`
                      : t('members.noLink')}
                  </p>
                  {hasLink && link && copyHintMemberId === member.id ? (
                    <p className={modalStyles.copyFeedback}>{t('links.copied')}</p>
                  ) : null}
                </div>
              </div>
              <div className={`${styles.cardActions} ${modalStyles.inlineAccessActions}`}>
                {hasLink && link ? (
                  <>
                    <AdminButton
                      type="button"
                      tone="plain"
                      size="compact"
                      onClick={() => copyMemberUrl(member.id, link.token)}
                      disabled={revokingMemberId === member.id}
                    >
                      <FiCopy size={15} />
                      {t('links.copy')}
                    </AdminButton>
                    {/* No "Open": a learner's link shows their private notes and answers, which the team
                        mustn't see. To see the course as learners do, use the version's preview. */}
                    <AdminButton
                      type="button"
                      tone="plain"
                      size="compact"
                      onClick={() => {
                        window.setTimeout(() => setEditModalMemberId(member.id), 0);
                      }}
                      disabled={revokingMemberId === member.id}
                    >
                      <FiEdit2 size={15} />
                      {t('links.edit')}
                    </AdminButton>
                    <AdminButton
                      type="button"
                      tone="plain"
                      size="compact"
                      onClick={() => revokeMemberLink(member.id, link.id)}
                      disabled={revokingMemberId === member.id}
                    >
                      {revokingMemberId === member.id ? t('links.revoking') : t('links.revoke')}
                    </AdminButton>
                  </>
                ) : (
                  <AdminButton
                    type="button"
                    tone="plain"
                      size="compact"
                    onClick={() => {
                      window.setTimeout(() => setCreateModalMemberId(member.id), 0);
                    }}
                  >
                    <FiLink size={15} />
                    {t('links.create')}
                  </AdminButton>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {createModalMember ? (
        <MemberLinkModal
          key={createModalMemberId}
          open={createModalMemberId !== null}
          onClose={() => setCreateModalMemberId(null)}
          groupId={groupId}
          memberId={createModalMember.id}
          memberLabel={`${createModalMember.position}. ${createModalMember.fullName}`}
          defaultExpiryValue={defaultExpiryValue}
          onSaved={(newLink) => {
            setChanged((prev) => ({ ...prev, [createModalMember.id]: newLink }));
            refresh();
          }}
        />
      ) : null}

      {editTarget ? (
        <EditAccessLinkExpiryModal
          key={`edit-${editTarget.member.id}`}
          open={editModalMemberId !== null}
          onClose={() => setEditModalMemberId(null)}
          groupId={groupId}
          link={editTarget.link}
          variant="member"
          memberLabel={`${editTarget.member.position}. ${editTarget.member.fullName}`}
          onSaved={(newLink) => {
            setChanged((prev) => ({ ...prev, [editTarget.member.id]: newLink }));
            setEditModalMemberId(null);
            refresh();
          }}
        />
      ) : null}

      {moveOpen ? (
        <MoveFeedbackModal
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
          groupId={groupId}
          sources={unattached}
          members={members.map((member) => ({ id: member.id, label: `${member.position}. ${member.fullName}` }))}
        />
      ) : null}

      <BulkMemberLinksModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        groupId={groupId}
        memberCount={members.length}
        defaultExpiryValue={defaultExpiryValue}
        onDone={refresh}
      />
    </div>
  );
}
