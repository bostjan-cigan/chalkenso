'use client';

import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { TbCheck, TbDoorExit, TbLink, TbPlus, TbSelector, TbSettings } from 'react-icons/tb';
import { inviteToken } from '@/lib/invite-link';
import { leaveOrganizationAction, switchOrganizationAction } from '../actions';
import ConfirmDialog from '../courses/components/ConfirmDialog';
import OrgBadge, { type OrgBadgeData } from './OrgBadge';
import { useSidebarCollapsed } from './SidebarState';
import styles from '../admin.module.css';

export type SwitcherOrganization = OrgBadgeData & { roleLabel: string };

/**
 * The organisation card under the wordmark: its logo (or icon) and name. When there is anything to do
 * there — switch to another organisation, open its settings, create, join or leave one — it opens a
 * menu.
 */
export default function OrganizationSwitcher({
  current,
  organizations,
  settingsHref,
  canJoin,
  createHref,
  canLeave,
}: {
  current: SwitcherOrganization;
  organizations: SwitcherOrganization[];
  /** Organisation settings, for owners and admins. */
  settingsHref: string | null;
  /** Joining another organisation with an invite link (the hosted edition). */
  canJoin: boolean;
  /** Where to create another organisation (the hosted edition, while sign-up is open). */
  createHref: string | null;
  /** Leaving this organisation (the hosted edition). */
  canLeave: boolean;
}) {
  const router = useRouter();
  const t = useTranslations('app.organizations');
  const collapsed = useSidebarCollapsed();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [link, setLink] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [switching, startSwitch] = useTransition();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leaving, startLeave] = useTransition();
  const hasActions = Boolean(settingsHref) || canJoin || Boolean(createHref) || canLeave;
  const hasMenu = organizations.length > 1 || hasActions;

  const close = (refocus = true) => {
    setOpen(false);
    setJoining(false);
    setJoinError(null);
    if (refocus) triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!open || !trigger || !menu) return;
    return autoUpdate(trigger, menu, () => {
      void computePosition(trigger, menu, {
        // Next to the icon strip, not over its icons.
        placement: collapsed ? 'right-start' : 'bottom-start',
        strategy: 'fixed',
        middleware: [offset(collapsed ? 10 : 6), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        Object.assign(menu.style, { left: `${x}px`, top: `${y}px`, minWidth: `${Math.max(240, trigger.offsetWidth)}px`, visibility: 'visible' });
      });
    });
  }, [open, collapsed]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"], [role^="menuitem"]')?.focus()
    );
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', onDown);
    };
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function switchTo(organizationId: string) {
    if (organizationId === current.id) {
      close();
      return;
    }
    const formData = new FormData();
    formData.set('organizationId', organizationId);
    close(false);
    startSwitch(async () => {
      await switchOrganizationAction(formData);
    });
  }

  function leave() {
    startLeave(async () => {
      // Leaving moves on to the next organisation; only a refusal comes back.
      const result = await leaveOrganizationAction(current.id);
      setLeaveError(result.error);
    });
  }

  function join() {
    const token = inviteToken(link);
    if (!token) {
      setJoinError(t('inviteLinkInvalid'));
      return;
    }
    close(false);
    router.push(`/invite/${token}`);
  }

  /** Arrow keys move between items, Home/End jump, Escape closes, Tab leaves. */
  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).tagName === 'INPUT' && event.key !== 'Escape') return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') close(false);
  }

  const card = (
    <>
      <OrgBadge org={current} size={36} />
      <span className={styles.orgCardName} data-testid="org-name">
        {current.name}
      </span>
    </>
  );

  if (!hasMenu) {
    return (
      <div className={styles.orgCard} data-tip={current.name}>
        {card}
      </div>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        id="org-switcher"
        type="button"
        className={styles.orgCard}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('switch', { name: current.name })}
        data-tip={current.name}
        disabled={switching}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === 'Escape' && open) {
            // Before focus has moved into the menu, Escape still closes it.
            event.preventDefault();
            close();
          }
        }}
      >
        {card}
        <TbSelector aria-hidden size={17} className={styles.orgCardChevron} />
      </button>
      {open
        ? createPortal(
            <div ref={menuRef} className={styles.orgMenu} role="menu" aria-label={t('menu')} style={{ visibility: 'hidden' }} onKeyDown={onMenuKey}>
              <p className={styles.orgMenuHeading}>{t('yours')}</p>
              {organizations.map((organization) => (
                <button
                  key={organization.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={organization.id === current.id}
                  className={styles.orgMenuItem}
                  onClick={() => switchTo(organization.id)}
                >
                  <OrgBadge org={organization} size={26} />
                  <span className={styles.orgMenuItemName}>{organization.name}</span>
                  <span className={styles.orgMenuItemMeta}>{organization.roleLabel}</span>
                  {organization.id === current.id ? <TbCheck aria-hidden size={16} /> : null}
                </button>
              ))}
              {hasActions ? <div className={styles.orgMenuDivider} role="separator" /> : null}
              {settingsHref ? (
                <Link href={settingsHref} role="menuitem" className={styles.orgMenuItem} onClick={() => close(false)}>
                  <TbSettings aria-hidden size={18} />
                  <span className={styles.orgMenuItemName}>{t('settings')}</span>
                </Link>
              ) : null}
              {canJoin ? (
                joining ? (
                  <form
                    className={styles.orgMenuJoin}
                    onSubmit={(event) => {
                      event.preventDefault();
                      join();
                    }}
                  >
                    <label className={styles.orgMenuHeading} htmlFor="org-join-link" style={{ margin: 0 }}>
                      {t('inviteLink')}
                    </label>
                    <input
                      id="org-join-link"
                      className={styles.textInput}
                      value={link}
                      autoFocus
                      autoComplete="off"
                      placeholder="https://…/invite/…"
                      onChange={(event) => {
                        setLink(event.target.value);
                        setJoinError(null);
                      }}
                    />
                    {joinError ? <span className={styles.fieldHint}>{joinError}</span> : null}
                    <button type="submit" className={styles.orgMenuItem} style={{ justifyContent: 'center', fontWeight: 600 }}>
                      {t('openInvite')}
                    </button>
                  </form>
                ) : (
                  <button type="button" role="menuitem" className={styles.orgMenuItem} onClick={() => setJoining(true)}>
                    <TbLink aria-hidden size={18} />
                    <span className={styles.orgMenuItemName}>{t('join')}</span>
                  </button>
                )
              ) : null}
              {createHref ? (
                <Link href={createHref} role="menuitem" className={styles.orgMenuItem} onClick={() => close(false)}>
                  <TbPlus aria-hidden size={18} />
                  <span className={styles.orgMenuItemName}>{t('create')}</span>
                </Link>
              ) : null}
              {canLeave ? (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.orgMenuItem}
                  onClick={() => {
                    close(false);
                    setLeaveError(null);
                    setLeaveOpen(true);
                  }}
                >
                  <TbDoorExit aria-hidden size={18} />
                  <span className={styles.orgMenuItemName}>{t('leave', { name: current.name })}</span>
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
      <ConfirmDialog
        open={leaveOpen}
        tone="danger"
        title={t('leaveTitle', { name: current.name })}
        description={leaveError ?? t('leaveDescription')}
        confirmLabel={t('leaveConfirm')}
        pending={leaving}
        onConfirm={leave}
        onClose={() => setLeaveOpen(false)}
      />
    </>
  );
}
