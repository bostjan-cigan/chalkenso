'use client';

import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FiCopy, FiKey } from 'react-icons/fi';
import { formatAccessDate } from '@/lib/access-links';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import AdminField from '@/app/admin/components/ui/AdminField';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import InfoTip from '@/app/admin/settings/ui/InfoTip';
import { SettingsBlock, SettingsGroup, SettingsRow, settingsStyles } from '@/app/admin/settings/ui/SettingsList';
import ConfirmDialog from '@/app/admin/courses/components/ConfirmDialog';
import { createApiTokenAction, deleteApiTokenAction, revokeApiTokenAction } from '../actions';
import adminStyles from '@/app/admin/admin.module.css';

type TokenView = {
  id: string;
  name: string;
  tokenPrefix: string;
  ownerName: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

interface ApiTokensManagerProps {
  tokens: TokenView[];
}

export default function ApiTokensManager({ tokens }: ApiTokensManagerProps) {
  const t = useTranslations('account.apiTokens');
  const locale = useLocale();
  const date = (iso: string) => formatAccessDate(new Date(iso), locale);
  const { notice, isPending, run } = useActionNotice();

  const [name, setName] = useState('');

  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<TokenView | null>(null);
  const { isPending: isRevoking, run: runRevoke } = useActionNotice();
  const [deleteTarget, setDeleteTarget] = useState<TokenView | null>(null);
  const { isPending: isDeleting, run: runDelete } = useActionNotice();

  const activeTokens = useMemo(() => tokens.filter((token) => !token.revokedAt), [tokens]);
  const revokedTokens = useMemo(() => tokens.filter((token) => token.revokedAt), [tokens]);

  const canCreate = Boolean(name.trim()) && !isPending;

  const handleCreate = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const formData = new FormData();
      formData.set('name', name.trim());

      run(() => createApiTokenAction(formData), {
        fallbackError: t('errors.create'),
        onSuccess: (result) => {
          if (result.token && result.tokenName) {
            setRevealed({ token: result.token, name: result.tokenName });
          }
          setName('');
        },
      });
    },
    [name, run, t]
  );

  const copyToken = useCallback(async () => {
    if (!revealed || typeof window === 'undefined') {
      return;
    }
    try {
      await navigator.clipboard.writeText(revealed.token);
      setCopyHint(t('copied'));
      window.setTimeout(() => setCopyHint(null), 2200);
    } catch {
      setCopyHint(t('copyFailed'));
    }
  }, [revealed, t]);

  const confirmRevoke = useCallback(() => {
    if (!revokeTarget) {
      return;
    }
    const formData = new FormData();
    formData.set('tokenId', revokeTarget.id);

    runRevoke(() => revokeApiTokenAction(formData), {
      fallbackError: t('errors.revoke'),
      onSuccess: () => setRevokeTarget(null),
    });
  }, [revokeTarget, runRevoke, t]);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) {
      return;
    }
    const formData = new FormData();
    formData.set('tokenId', deleteTarget.id);

    runDelete(() => deleteApiTokenAction(formData), {
      fallbackError: t('errors.delete'),
      onSuccess: () => setDeleteTarget(null),
    });
  }, [deleteTarget, runDelete, t]);

  const renderTokenRow = (token: TokenView) => {
    const isRevoked = Boolean(token.revokedAt);
    return (
      <SettingsRow
        key={token.id}
        label={token.name}
        detail={[
          `${token.tokenPrefix}…`,
          t('owner', { name: token.ownerName }),
          token.lastUsedAt ? t('lastUsed', { date: date(token.lastUsedAt) }) : t('neverUsed'),
          t('created', { date: date(token.createdAt) }),
          isRevoked ? t('revokedOn', { date: date(token.revokedAt as string) }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      >
        {isRevoked ? (
          <button type="button" className={settingsStyles.actionDanger} onClick={() => setDeleteTarget(token)} disabled={isDeleting}>
            {t('delete')}
          </button>
        ) : (
          <button type="button" className={settingsStyles.actionDanger} onClick={() => setRevokeTarget(token)} disabled={isRevoking}>
            {t('revoke')}
          </button>
        )}
      </SettingsRow>
    );
  };

  return (
    <>
      <SettingsGroup
        title={t('activeKicker', { count: activeTokens.length })}
        info={<InfoTip label={t('activeKicker', { count: activeTokens.length })}>{t('about')}</InfoTip>}
      >
        {activeTokens.length > 0 ? activeTokens.map(renderTokenRow) : <SettingsRow label={t('emptyTitle')} />}
      </SettingsGroup>

      <div id="create-token" style={{ scrollMarginTop: '1.5rem' }}>
        <SettingsGroup title={t('createKicker')}>
          {revealed ? (
            <SettingsBlock>
              <strong>{t('createdTitle')}</strong>
              <code
                style={{
                  display: 'block',
                  padding: '0.6rem 0.75rem',
                  borderRadius: 8,
                  background: 'rgba(127,127,127,0.12)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '0.85rem',
                  wordBreak: 'break-all',
                }}
              >
                {revealed.token}
              </code>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <AdminButton type="button" size="compact" onClick={copyToken}>
                  <FiCopy size={14} />
                  {t('copy')}
                </AdminButton>
                <button type="button" className={settingsStyles.action} onClick={() => setRevealed(null)}>
                  {t('done')}
                </button>
                {copyHint ? <span className={adminStyles.fieldHint}>{copyHint}</span> : null}
              </div>
            </SettingsBlock>
          ) : null}
          <SettingsBlock>
            <ActionNotice notice={notice} />
            <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 16rem' }}>
                <AdminField
                  id="api-token-name"
                  label={t('name')}
                  placeholder={t('namePlaceholder')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  fullWidth
                />
              </div>
              <AdminButton type="submit" disabled={!canCreate}>
                <FiKey size={15} />
                {isPending ? t('creating') : t('create')}
              </AdminButton>
            </form>
          </SettingsBlock>
        </SettingsGroup>
      </div>

      {revokedTokens.length > 0 ? (
        <SettingsGroup
          title={t('revokedKicker', { count: revokedTokens.length })}
          info={<InfoTip label={t('revokedKicker', { count: revokedTokens.length })}>{t('revokedHint')}</InfoTip>}
        >
          {revokedTokens.map(renderTokenRow)}
        </SettingsGroup>
      ) : null}

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title={t('revokeTitle')}
        description={revokeTarget ? t('revokeDescription', { name: revokeTarget.name }) : ''}
        confirmLabel={t('revokeConfirm')}
        cancelLabel={t('cancel')}
        tone="danger"
        pending={isRevoking}
        onConfirm={confirmRevoke}
        onClose={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('deleteTitle')}
        description={deleteTarget ? t('deleteDescription', { name: deleteTarget.name }) : ''}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('cancel')}
        tone="danger"
        pending={isDeleting}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
