'use client';

import { useRef, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ORG_COLORS, ORG_ICONS, organizationIdentity, type OrgColorKey, type OrgIconKey } from '@/lib/organization-identity';
import OrgBadge, { ORG_ICON_COMPONENTS } from '../components/OrgBadge';
import AdminButton from '../components/ui/AdminButton';
import AdminField from '../components/ui/AdminField';
import AdminNotice from '../components/ui/AdminNotice';
import { useFormAction } from '../components/useFormAction';
import ConfirmDialog from '../courses/components/ConfirmDialog';
import { SettingsBlock, SettingsRow, SettingsStatus, settingsStyles } from './ui/SettingsList';
import {
  removeAiKeyAction,
  removeOrganizationLogoAction,
  renameOrganizationAction,
  saveAiKeyAction,
  setOrganizationIconAction,
  updateOrganizationLogoAction,
  type SettingsActionState,
} from './actions';
import styles from '../admin.module.css';

const INITIAL: SettingsActionState = { error: null, message: null };

function Feedback({ state }: { state: SettingsActionState }) {
  if (state.error) {
    return <AdminNotice>{state.error}</AdminNotice>;
  }
  if (state.message) {
    return <p className={styles.fieldHint} style={{ margin: 0 }}>{state.message}</p>;
  }
  return null;
}

export function OrganizationNameForm({ name }: { name: string }) {
  const t = useTranslations('account.settings.general');
  const { state, pending, onSubmit } = useFormAction(renameOrganizationAction, INITIAL);
  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
      <AdminField id="organization-name" name="name" label={t('name')} defaultValue={name} required />
      <div>
        <AdminButton type="submit" tone="secondary" disabled={pending}>
          {pending ? t('saving') : t('saveName')}
        </AdminButton>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/**
 * The organisation's own Anthropic API key, as rows: whether it's active (only its last four
 * characters are ever shown), "Set key…" or "Replace key…", and "Remove key" (asked first, Cancel
 * the default). The key is stored encrypted and checked with Anthropic when it's saved.
 */
export function AiKeyForm({ current }: { current: { hint: string; readable: boolean; refused: boolean; checkedAt: string | null } | null }) {
  const t = useTranslations('account.settings.aiKey');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saveState, setSaveState] = useState(INITIAL);
  const [removeState, setRemoveState] = useState(INITIAL);
  const [pending, startTransition] = useTransition();
  const active = Boolean(current?.readable && !current.refused);
  const status = !current ? t('notActive') : !current.readable ? t('unreadableShort') : current.refused ? t('refusedShort') : t('active');

  const save = (formData: FormData) =>
    startTransition(async () => {
      const result = await saveAiKeyAction(INITIAL, formData);
      setSaveState(result);
      if (!result.error) {
        setEditing(false);
        router.refresh();
      }
    });
  const remove = () =>
    startTransition(async () => {
      setConfirming(false);
      setRemoveState(await removeAiKeyAction(INITIAL, new FormData()));
      router.refresh();
    });

  return (
    <>
      <SettingsRow label={t('label')} detail={current ? `…${current.hint}` : undefined} testId="ai-key">
        <SettingsStatus on={active} warning={Boolean(current && !active)}>
          {status}
        </SettingsStatus>
      </SettingsRow>
      {editing ? (
        <SettingsBlock>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save(new FormData(event.currentTarget));
            }}
            style={{ display: 'grid', gap: '0.75rem' }}
          >
            <AdminField
              id="ai-api-key"
              name="apiKey"
              type="password"
              label={t('label')}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              required
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className={settingsStyles.action} onClick={() => setEditing(false)} disabled={pending}>
                {t('cancel')}
              </button>
              <AdminButton type="submit" disabled={pending}>
                {pending ? t('saving') : t('save')}
              </AdminButton>
            </div>
            <Feedback state={saveState} />
          </form>
        </SettingsBlock>
      ) : (
        <SettingsRow
          label={
            <button type="button" className={settingsStyles.action} style={{ marginLeft: '-0.4rem' }} onClick={() => setEditing(true)} data-testid="ai-key-set">
              {current ? t('replaceKey') : t('setKey')}
            </button>
          }
        />
      )}
      {current && !editing ? (
        <SettingsRow
          label={
            <button type="button" className={settingsStyles.actionDanger} style={{ marginLeft: '-0.4rem' }} onClick={() => setConfirming(true)} disabled={pending} data-testid="ai-key-remove">
              {t('remove')}
            </button>
          }
        />
      ) : null}
      {removeState.error ? (
        <SettingsBlock>
          <Feedback state={removeState} />
        </SettingsBlock>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={t('removeTitle')}
        description={t('removeText')}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        tone="danger"
        pending={pending}
        onConfirm={remove}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

const choice = (selected: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  borderRadius: 10,
  border: selected ? '2px solid rgb(var(--accent-color))' : '1px solid var(--line-strong)',
  background: 'var(--card-bg)',
  color: 'inherit',
  cursor: 'pointer',
});

/**
 * How the organisation looks in the sidebar and the switcher: its logo, or an icon on a colour. The
 * icon saves as soon as it is picked; a logo replaces it until the logo is removed.
 */
export function OrganizationIdentityForm({
  org,
}: {
  org: { id: string; name: string; logoUrl: string | null; iconName: string | null; iconColor: string | null };
}) {
  const t = useTranslations('account.settings.identity');
  const router = useRouter();
  const start = organizationIdentity(org);
  const [icon, setIcon] = useState<OrgIconKey>(start.icon);
  const [color, setColor] = useState<OrgColorKey>(start.color);
  const [state, setState] = useState(INITIAL);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveIcon = (nextIcon: OrgIconKey, nextColor: OrgColorKey) => {
    setIcon(nextIcon);
    setColor(nextColor);
    startTransition(async () => {
      setState(await setOrganizationIconAction(nextIcon, nextColor));
      router.refresh();
    });
  };
  const resetFile = () => {
    setPreview(null);
    setFileName(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div style={{ display: 'grid', gap: '1rem' }} data-testid="org-identity">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
        <OrgBadge org={{ ...org, logoUrl: preview ?? org.logoUrl, iconName: icon, iconColor: color }} size={56} />
        <div>
          <strong style={{ display: 'block', fontSize: '1.05rem' }}>{org.name}</strong>
          <span className={styles.fieldHint}>{t('shown')}</span>
        </div>
      </div>

      <form
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem' }}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await updateOrganizationLogoAction(formData);
            setState(result);
            if (!result.error) {
              resetFile();
              router.refresh();
            }
          });
        }}
      >
        <input
          ref={fileRef}
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp"
          className={styles.visuallyHiddenFileInput}
          data-testid="org-logo-input"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setFileName(file?.name ?? null);
            setPreview(file ? URL.createObjectURL(file) : null);
          }}
        />
        <AdminButton type="button" tone="secondary" size="compact" onClick={() => fileRef.current?.click()}>
          {org.logoUrl ? t('chooseAnother') : t('choose')}
        </AdminButton>
        <span className={styles.fieldHint}>{fileName ?? t('formats')}</span>
        {fileName ? (
          <AdminButton type="submit" size="compact" disabled={pending}>
            {pending ? t('saving') : t('saveLogo')}
          </AdminButton>
        ) : null}
        {org.logoUrl && !fileName ? (
          <AdminButton
            type="button"
            tone="secondary"
            size="compact"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setState(await removeOrganizationLogoAction());
                router.refresh();
              })
            }
          >
            {t('removeLogo')}
          </AdminButton>
        ) : null}
      </form>

      <div style={{ display: 'grid', gap: '0.5rem', opacity: org.logoUrl ? 0.6 : 1 }}>
        <span className={styles.inputLabel}>{org.logoUrl ? t('iconUnderLogo') : t('icon')}</span>
        <div role="radiogroup" aria-label={t('icon')} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {ORG_ICONS.map((entry) => {
            const Icon = ORG_ICON_COMPONENTS[entry.key];
            return (
              <button
                key={entry.key}
                type="button"
                role="radio"
                aria-checked={icon === entry.key}
                aria-label={t(`icons.${entry.key}`)}
                title={t(`icons.${entry.key}`)}
                style={choice(icon === entry.key)}
                onClick={() => saveIcon(entry.key, color)}
              >
                <Icon size={20} aria-hidden />
              </button>
            );
          })}
        </div>
        <span className={styles.inputLabel}>{t('colour')}</span>
        <div role="radiogroup" aria-label={t('colour')} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {ORG_COLORS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="radio"
              aria-checked={color === entry.key}
              aria-label={t(`colours.${entry.key}`)}
              title={t(`colours.${entry.key}`)}
              style={{ ...choice(color === entry.key), background: `rgb(${entry.rgb})` }}
              onClick={() => saveIcon(icon, entry.key)}
            />
          ))}
        </div>
      </div>
      <Feedback state={state} />
    </div>
  );
}
