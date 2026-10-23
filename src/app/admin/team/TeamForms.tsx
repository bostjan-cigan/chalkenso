'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Dropdown from '@/components/Dropdown';
import type { AccessInput, AccessOptions } from '@/lib/access-describe';
import AccessLinkModalPortal from '../courses/groups/components/AccessLinkModalPortal';
import modalStyles from '../courses/groups/components/MemberLinkModal.module.css';
import AdminButton from '../components/ui/AdminButton';
import AdminField from '../components/ui/AdminField';
import AdminNotice from '../components/ui/AdminNotice';
import AdminSearchableSelectField from '../components/ui/AdminSearchableSelectField';
import { useFormAction } from '../components/useFormAction';
import AdminMenu from '../components/ui/AdminMenu';
import ConfirmDialog from '../courses/components/ConfirmDialog';
import {
  changeRoleAction,
  createInviteAction,
  removeMemberAction,
  setMemberAccessAction,
  signOutMemberAction,
  type TeamActionState,
} from './actions';
import AccessEditor, { DEFAULT_LIMITED } from './AccessEditor';
import InviteDelivery from '../components/InviteDelivery';
import styles from '../admin.module.css';

const INITIAL: TeamActionState = { error: null, message: null };

function Feedback({ state }: { state: TeamActionState }) {
  if (state.error) {
    return <AdminNotice>{state.error}</AdminNotice>;
  }
  if (state.message) {
    return <p className={styles.fieldHint} style={{ margin: 0 }}>{state.message}</p>;
  }
  return null;
}

type RoleChoice = { value: 'OWNER' | 'ADMIN' | 'MEMBER'; label: string; inSentence?: string; hint?: string };

/**
 * With one invite role (the local edition: instructors), there is nothing to choose. A member (or
 * instructor) can be limited to chosen courses or groups; owners and admins always get everything.
 */
export function InviteForm({ roles, accessOptions }: { roles: RoleChoice[]; accessOptions: AccessOptions }) {
  const t = useTranslations('account.team.inviteForm');
  const { state, pending, onSubmit } = useFormAction(createInviteAction, INITIAL);
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState<string>(roles[0]?.value ?? 'MEMBER');
  const [access, setAccess] = useState<AccessInput>({ kind: 'full' });
  const [delivery, setDelivery] = useState<'link' | 'email'>('link');

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
      <input type="hidden" name="access" value={JSON.stringify(access)} />
      <input type="hidden" name="delivery" value={delivery} />
      {roles.length > 1 ? (
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
          <AdminField id="invite-label" name="label" label={t('label')} placeholder={t('placeholder')} />
          <Dropdown
            id="invite-role"
            name="role"
            label={t('role')}
            defaultValue={roles[0].value}
            options={roles.map((choice) => ({ value: choice.value, label: choice.label, hint: choice.hint }))}
            onValueChange={setRole}
          />
        </div>
      ) : (
        <>
          <AdminField
            id="invite-label"
            name="label"
            label={t('label')}
            placeholder={t('placeholder')}
            hint={roles[0] ? t('joinsAs', { role: roles[0].inSentence ?? roles[0].label, hint: roles[0].hint ?? '' }) : undefined}
          />
          <input type="hidden" name="role" value={roles[0]?.value ?? 'MEMBER'} />
        </>
      )}
      {role === 'MEMBER' ? (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <span className={styles.inputLabel}>{t('access')}</span>
          <AccessEditor idPrefix="invite-access" value={access} onChange={setAccess} options={accessOptions} />
        </div>
      ) : null}
      <InviteDelivery idPrefix="invite" delivery={delivery} onChange={setDelivery} />
      <div>
        <AdminButton type="submit" disabled={pending}>
          {pending ? (delivery === 'email' ? t('sending') : t('creating')) : delivery === 'email' ? t('send') : t('create')}
        </AdminButton>
      </div>
      <Feedback state={state} />
      {state.link ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <code style={{ wordBreak: 'break-all', fontSize: '0.85rem' }} data-testid="invite-link">
            {state.link}
          </code>
          <AdminButton
            type="button"
            tone="plain"
            size="compact"
            onClick={() => {
              void navigator.clipboard?.writeText(state.link ?? '');
              setCopied(true);
            }}
          >
            {copied ? t('copied') : t('copy')}
          </AdminButton>
        </div>
      ) : null}
    </form>
  );
}

/**
 * A member's access, edited in a dialog: everything, or limited (see AccessEditor). `initial` is
 * their current access; null when it is custom (set up by hand) or empty, which the editor starts
 * from a fresh "Limited" preset.
 */
function AccessDialog({
  memberId,
  memberName,
  initial,
  options,
  note,
}: {
  memberId: string;
  memberName: string;
  initial: AccessInput | null;
  options: AccessOptions;
  note: string | null;
}) {
  const t = useTranslations('account.team.accessDialog');
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AccessInput>(initial ?? { kind: 'limited', preset: DEFAULT_LIMITED });
  const [state, setState] = useState(INITIAL);
  const [saving, startSaving] = useTransition();
  const save = () =>
    startSaving(async () => {
      const result = await setMemberAccessAction(memberId, JSON.stringify(draft));
      setState(result);
      if (!result.error) {
        setOpen(false);
        router.refresh();
      }
    });
  return (
    <>
      <AdminButton type="button" tone="plain" size="compact" onClick={() => setOpen(true)} data-testid={`access-button-${memberId}`}>
        {t('open')}
      </AdminButton>
      <AccessLinkModalPortal open={open} onClose={() => setOpen(false)} titleId={titleId}>
        <header className={modalStyles.modalHeader}>
          <h2 id={titleId} className={modalStyles.modalTitle}>
            {t('title', { name: memberName })}
          </h2>
          <p className={modalStyles.modalDescription}>{t('description')}</p>
        </header>
        <div className={modalStyles.modalBody} style={{ display: 'grid', gap: '0.75rem' }}>
          {note ? <AdminNotice>{note}</AdminNotice> : null}
          <AccessEditor idPrefix={`member-access-${memberId}`} value={draft} onChange={setDraft} options={options} />
          <Feedback state={state} />
        </div>
        <footer className={modalStyles.modalFooter}>
          <div className={modalStyles.actions}>
            <AdminButton type="button" tone="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </AdminButton>
            <AdminButton type="button" onClick={save} disabled={saving} data-testid="access-save">
              {saving ? t('saving') : t('save')}
            </AdminButton>
          </div>
        </footer>
      </AccessLinkModalPortal>
    </>
  );
}

export function MemberControls({
  memberId,
  memberName,
  organizationName,
  role,
  canEdit,
  roleOptions,
  access,
  accessOptions,
  accessNote = null,
}: {
  memberId: string;
  memberName: string;
  organizationName: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  canEdit: boolean;
  /** The roles this person can be changed to; null when roles stay as they are. */
  roleOptions: RoleChoice[] | null;
  /** Their access, for the Access dialog (members only). */
  access: AccessInput | null;
  accessOptions: AccessOptions;
  accessNote?: string | null;
}) {
  const t = useTranslations('account.team.memberControls');
  const [currentRole, setCurrentRole] = useState<string>(role);
  const [roleState, setRoleState] = useState(INITIAL);
  const [changingRole, startRoleChange] = useTransition();
  // Under ⋯, each asked first: signing them out, or removing them.
  const [asking, setAsking] = useState<'signout' | 'remove' | null>(null);
  const [memberState, setMemberState] = useState(INITIAL);
  const [acting, startActing] = useTransition();
  const router = useRouter();

  function confirmAsked() {
    const action = asking === 'remove' ? removeMemberAction : signOutMemberAction;
    const formData = new FormData();
    formData.set('memberId', memberId);
    startActing(async () => {
      const result = await action(INITIAL, formData);
      setMemberState(result);
      setAsking(null);
      router.refresh();
    });
  }

  // The role saves as soon as it is picked.
  function changeRole(next: string) {
    if (next === currentRole) return;
    const previous = currentRole;
    setCurrentRole(next);
    const formData = new FormData();
    formData.set('memberId', memberId);
    formData.set('role', next);
    startRoleChange(async () => {
      const result = await changeRoleAction(INITIAL, formData);
      setRoleState(result);
      if (result.error) setCurrentRole(previous);
    });
  }

  if (!canEdit) {
    return null;
  }

  return (
    <div style={{ display: 'grid', gap: '0.4rem', justifyItems: 'end' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {currentRole === 'MEMBER' ? (
          <AccessDialog memberId={memberId} memberName={memberName} initial={access} options={accessOptions} note={accessNote} />
        ) : null}
        {roleOptions ? (
          <AdminSearchableSelectField
            id={`member-role-${memberId}`}
            label={t('role')}
            hideLabel
            compact
            searchable={false}
            value={currentRole}
            options={roleOptions.map((option) => ({ value: option.value, label: option.label }))}
            onValueChange={changeRole}
            disabled={changingRole}
          />
        ) : null}
        <AdminMenu
          label={t('more', { name: memberName })}
          items={[
            { label: t('signOutItem'), onSelect: () => setAsking('signout'), disabled: acting },
            { label: t('removeItem'), danger: true, onSelect: () => setAsking('remove'), disabled: acting },
          ]}
        />
      </div>
      <Feedback state={roleState.error ? roleState : memberState} />
      <ConfirmDialog
        open={asking !== null}
        tone="danger"
        title={asking === 'remove' ? t('removeTitle', { name: memberName }) : t('signOutTitle', { name: memberName })}
        description={
          asking === 'remove'
            ? t('removeDescription', { organization: organizationName })
            : t('signOutDescription', { organization: organizationName })
        }
        confirmLabel={asking === 'remove' ? t('remove') : t('signOut')}
        cancelLabel={t('cancel')}
        pending={acting}
        onConfirm={confirmAsked}
        onClose={() => setAsking(null)}
      />
    </div>
  );
}
