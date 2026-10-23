'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import AccessLinkModalPortal from '@/app/admin/courses/groups/components/AccessLinkModalPortal';
import modalStyles from '@/app/admin/courses/groups/components/MemberLinkModal.module.css';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import AdminField from '@/app/admin/components/ui/AdminField';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import { SheetInfoRow, SheetOpenRow } from '@/app/admin/components/ui/Sheet';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import {
  beginTotpSetupAction,
  cancelTotpSetupAction,
  confirmTotpSetupAction,
  disableTotpAction,
} from '../actions';
import { cn } from '@/utils/cn';
import styles from '@/app/admin/admin.module.css';

type PendingSetup = {
  manualSecret: string;
  qrDataUrl: string;
  backupCodes: string[];
};

type TwoFactorAuthSectionProps = {
  totpEnabled: boolean;
  /** Required for this account: it cannot be turned off, and setup is prompted. */
  required?: boolean;
};

/**
 * Two-factor as a row of the Profile (On or Off ›). Setting it up takes three steps, as Better Auth
 * does it: the password, then the authenticator's QR code and its first code, then the backup codes
 * (shown once). Turning it off asks the password.
 */
export default function TwoFactorAuthSection({
  totpEnabled,
  required = false,
}: TwoFactorAuthSectionProps) {
  const t = useTranslations('account.profile.twoFactor');
  const router = useRouter();
  const { notice, isPending, run, setNotice } = useActionNotice();
  const [isBeginning, startBeginTransition] = useTransition();
  const [setupOpen, setSetupOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [setupPayload, setSetupPayload] = useState<PendingSetup | null>(null);
  const [step, setStep] = useState<'password' | 'scan' | 'codes'>('password');

  const setupTitleId = useId();
  const setupDescriptionId = useId();
  const manageTitleId = useId();
  const manageDescriptionId = useId();
  const confirmFormId = 'admin-totp-confirm-form';
  const disableFormId = 'admin-totp-disable-form';
  const busy = isPending || isBeginning;

  function openSetupModal() {
    setNotice(null);
    setSetupPayload(null);
    setStep('password');
    setSetupOpen(true);
  }

  function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    startBeginTransition(async () => {
      const result = await beginTotpSetupAction(password);
      if (result.ok) {
        setNotice(null);
        setSetupPayload({ manualSecret: result.manualSecret, qrDataUrl: result.qrDataUrl, backupCodes: result.backupCodes });
        setStep('scan');
      } else {
        setNotice({ tone: 'error', message: result.message });
      }
    });
  }

  async function closeSetupModal() {
    setSetupOpen(false);
    setSetupPayload(null);
    setStep('password');
    await cancelTotpSetupAction();
    router.refresh();
  }

  function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => confirmTotpSetupAction(formData), {
      // On: the backup codes next, once.
      onSuccess: () => setStep('codes'),
      refresh: false,
    });
  }

  function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => disableTotpAction(formData), {
      onSuccess: () => setManageOpen(false),
    });
  }

  return (
    <>
      {/* A row of the Profile's Security group (its footer says what it does); its steps are dialogs. */}
      {totpEnabled && required ? (
        <SheetInfoRow label={t('kicker')} value={t('rowOn')} testId="two-factor-row" />
      ) : (
        <SheetOpenRow
          label={t('kicker')}
          value={totpEnabled ? t('rowOn') : t('rowOff')}
          disabled={busy}
          onClick={() => {
            if (totpEnabled) {
              setNotice(null);
              setManageOpen(true);
            } else {
              openSetupModal();
            }
          }}
          testId="two-factor-row"
        />
      )}

      <AccessLinkModalPortal
        descriptionId={setupDescriptionId}
        open={setupOpen}
        titleId={setupTitleId}
        onClose={() => {
          void closeSetupModal();
        }}
      >
        <header className={modalStyles.modalHeader}>
          <h2 id={setupTitleId} className={modalStyles.modalTitle}>
            {step === 'codes' ? t('codesTitle') : t('setUp')}
          </h2>
          <p id={setupDescriptionId} className={modalStyles.modalDescription}>
            {step === 'password' ? t('passwordStep') : step === 'scan' ? t('scanStep') : t('codesStep')}
          </p>
        </header>
        <div className={modalStyles.modalBody}>
          <ActionNotice notice={notice} />
          {step === 'password' ? (
            <form className={cn(styles.profileForm, styles.totpModalForm)} onSubmit={handlePassword} id="admin-totp-password-form">
              <AdminField autoComplete="current-password" id="setup-totp-password" label={t('password')} name="password" type="password" required data-autofocus="" />
            </form>
          ) : null}
          {step === 'codes' && setupPayload ? (
            <ul className={styles.totpBackupCodes} data-testid="totp-backup-codes">
              {setupPayload.backupCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
          ) : null}
          {step === 'scan' && setupPayload ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
              <img
                alt=""
                className={styles.totpQr}
                height={200}
                src={setupPayload.qrDataUrl}
                width={200}
              />
              <div className={styles.totpManualSecret}>
                <span className={styles.fieldHint}>{t('secret')}</span>
                <code className={styles.totpSecretCode}>{setupPayload.manualSecret}</code>
              </div>
            </>
          ) : null}

          {step === 'scan' ? (
            <form
              className={cn(styles.profileForm, styles.totpModalForm)}
              onSubmit={handleConfirm}
              id={confirmFormId}
            >
              <AdminField
                autoComplete="one-time-code"
                id="confirm-totp-modal"
                inputMode="numeric"
                label={t('code')}
                maxLength={6}
                name="code"
                pattern="\d{6}"
                placeholder="000000"
                type="text"
              />
            </form>
          ) : null}
        </div>
        <footer className={modalStyles.modalFooter}>
          <div className={modalStyles.actions}>
            {step === 'codes' ? (
              <AdminButton type="button" onClick={() => void closeSetupModal()} data-autofocus="">
                {t('done')}
              </AdminButton>
            ) : (
              <>
                <AdminButton tone="secondary" type="button" onClick={() => void closeSetupModal()}>
                  {t('cancel')}
                </AdminButton>
                {step === 'password' ? (
                  <AdminButton form="admin-totp-password-form" type="submit" disabled={isBeginning}>
                    {isBeginning ? t('checking') : t('continue')}
                  </AdminButton>
                ) : (
                  <AdminButton form={confirmFormId} type="submit" disabled={isPending}>
                    {isPending ? t('enabling') : t('enable')}
                  </AdminButton>
                )}
              </>
            )}
          </div>
        </footer>
      </AccessLinkModalPortal>

      <AccessLinkModalPortal
        descriptionId={manageDescriptionId}
        open={manageOpen}
        titleId={manageTitleId}
        onClose={() => {
          setManageOpen(false);
        }}
      >
        <header className={modalStyles.modalHeader}>
          <h2 id={manageTitleId} className={modalStyles.modalTitle}>
            {t('kicker')}
          </h2>
          <p id={manageDescriptionId} className={modalStyles.modalDescription}>
            {t('manageDescription')}
          </p>
        </header>
        <div className={modalStyles.modalBody}>
          <ActionNotice notice={notice} />
          <form
            className={cn(styles.profileForm, styles.totpModalForm)}
            onSubmit={handleDisable}
            id={disableFormId}
          >
            <AdminField
              autoComplete="current-password"
              id="disable-password-modal"
              label={t('password')}
              name="password"
              type="password"
            />
          </form>
        </div>
        <footer className={modalStyles.modalFooter}>
          <div className={modalStyles.actions}>
            <AdminButton
              tone="secondary"
              type="button"
              onClick={() => {
                setManageOpen(false);
              }}
            >
              {t('close')}
            </AdminButton>
            <AdminButton
              form={disableFormId}
              tone="secondary"
              type="submit"
              disabled={isPending}
            >
              {isPending ? t('turningOff') : t('turnOff')}
            </AdminButton>
          </div>
        </footer>
      </AccessLinkModalPortal>
    </>
  );
}
