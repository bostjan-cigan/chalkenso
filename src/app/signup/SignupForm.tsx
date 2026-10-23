'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { signUpAction, type FormState } from '@/app/admin/actions';
import { useFormAction } from '@/app/admin/components/useFormAction';
import AdminField from '@/app/admin/components/ui/AdminField';
import AdminNotice from '@/app/admin/components/ui/AdminNotice';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import HandleField from '@/app/admin/components/HandleField';
import TrapField from '@/app/admin/components/TrapField';
import styles from '@/app/admin/admin.module.css';
import { normalizeHandle } from '@/lib/handle-format';
import { passwordProblem } from '@/lib/password-strength';
import own from './signup.module.css';

type PlanOption = { value: string; label: string; hint: string };

const STEPS = 2;

/**
 * Signing up in two steps (fewer fields at once, so more people finish): the email and a safe password;
 * then the organisation and the handles, suggested from both as they type. Their name waits for
 * Profile. A line shows how far along they are, with a note in red pen. One form underneath: the steps only show its parts in turn, and a problem the server
 * finds takes them back to the step it's about.
 */
export default function SignupForm({
  minPasswordLength,
  plan,
  checkHandles,
}: {
  minPasswordLength: number;
  /** The edition's plan they picked, sent with the form; null where there are none. */
  plan: PlanOption | null;
  /** Say whether a handle is free as they type (`/api/handles`, where the edition has it). */
  checkHandles: boolean;
}) {
  const t = useTranslations('auth');
  const { state, pending, onSubmit } = useFormAction<FormState>(signUpAction, { error: null });
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organization, setOrganization] = useState('');
  const form = useRef<HTMLFormElement>(null);
  // Said only when the password is easy to guess, and only once they've typed something.
  const weak = password ? passwordProblem(password, { email, min: minPasswordLength }) : null;
  const weakText = weak ? t(`signup.password.${weak}`, { min: minPasswordLength }) : null;
  // The handles are suggested from the email's name and the organisation's. Teaching on their own, the
  // organisation is often their own name: then its handle gets an ending, as the two can't be the same.
  const emailName = email.split('@')[0].split('+')[0];
  const organizationFrom =
    organization.trim() && normalizeHandle(organization) === normalizeHandle(emailName)
      ? `${organization} ${t('signup.form.organizationHandleEnding')}`
      : organization;

  // The browser stops at an easy password as at any other wrong field.
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('#signup-password')?.setCustomValidity(weakText ?? '');
  }, [weakText]);

  // A problem from the server: back to its step.
  useEffect(() => {
    if (state.error && state.step) setStep(state.step);
  }, [state]);

  // Each step's first field takes the focus as it shows.
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>(`[data-step="${step}"] input:not([type=hidden])`)?.focus();
  }, [step]);

  /** Whether this step's fields are right; the browser says what isn't, at the first one. */
  function stepValid() {
    const fields = form.current?.querySelectorAll<HTMLInputElement>(`[data-step="${step}"] input`) ?? [];
    return Array.from(fields).every((field) => field.reportValidity());
  }

  /** On to the next step once this one's fields are right. */
  function next() {
    if (stepValid()) setStep(step + 1);
  }

  // Every step stays in the form (its fields are sent at the end); only the current one shows.
  const part = (number: number) => ({
    'data-step': number,
    hidden: step !== number,
    className: styles.loginForm,
    style: step === number ? undefined : { display: 'none' },
  });

  return (
    <form
      ref={form}
      className={styles.loginForm}
      // The browser's own check would stop at a required field on a step not shown: each step checks its own.
      noValidate
      onSubmit={(event) => {
        if (step < STEPS) {
          // Return on an earlier step moves on rather than sending.
          event.preventDefault();
          next();
          return;
        }
        if (!stepValid()) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      data-testid="signup-form"
      data-current-step={step}
    >
      <div className={own.top}>
        <div
          className={own.progress}
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS}
          aria-valuenow={step}
          aria-label={t('signup.steps.progress', { step, steps: STEPS })}
          data-testid="signup-step"
          data-step-now={step}
        >
          {Array.from({ length: STEPS }, (_, index) => (
            <span key={index} className={index < step ? own.progressDone : own.progressStep} />
          ))}
        </div>
        {/* A note in red pen on the right, its arrow curling from the left down to the step's first field (drawn again each step). */}
        <div className={own.noteRow} aria-hidden>
          <svg key={step} className={own.arrow} viewBox="0 0 56 40" width="56" height="40">
            <path d="M3 9c11-7 29-8 37 1 6 7 5 16 3 24" />
            <path d="M36 28l7 7 6-9" />
          </svg>
          <p className={own.note}>{t(`signup.steps.note${step}` as 'signup.steps.note1')}</p>
        </div>
      </div>

      <div {...part(1)}>
        <AdminField
          id="signup-email"
          name="email"
          type="email"
          label={t('signup.form.email')}
          autoComplete="email"
          placeholder={t('signup.form.emailPlaceholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <AdminField
          id="signup-password"
          name="password"
          type="password"
          label={t('fields.password')}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={weakText ? 'signup-password-problem' : undefined}
          required
        />
        {weakText ? (
          <p id="signup-password-problem" className={own.problem} role="status" data-testid="signup-password-problem">
            {weakText}
          </p>
        ) : null}
      </div>

      <div {...part(2)}>
        <AdminField
          id="signup-organization"
          name="organization"
          label={t('fields.organization')}
          placeholder={t('fields.organizationPlaceholder')}
          hint={t('signup.form.organizationHint')}
          value={organization}
          onChange={(event) => setOrganization(event.target.value)}
          required
        />
        {/* The plan they picked on the pricing page. */}
        {plan ? <input type="hidden" name="plan" value={plan.value} data-testid="signup-plan" /> : null}
        <HandleField
          id="signup-handle"
          name="handle"
          label={t('fields.handle')}
          from={emailName}
          hint={t('fields.handleHint')}
          check={checkHandles}
          optional
        />
        <HandleField
          id="signup-organization-handle"
          name="organizationHandle"
          label={t('signup.form.organizationHandle')}
          from={organizationFrom}
          hint={t('signup.form.organizationHandleHint')}
          check={checkHandles}
          optional
        />
      </div>

      <TrapField />
      {state.error ? <AdminNotice>{state.error}</AdminNotice> : null}
      <div className={styles.inlineActions} style={{ justifyContent: 'space-between' }}>
        {step > 1 ? (
          <AdminButton type="button" tone="secondary" onClick={() => setStep(step - 1)} data-testid="signup-back">
            {t('signup.steps.back')}
          </AdminButton>
        ) : (
          <span />
        )}
        {step < STEPS ? (
          // A submit button, so Return moves on too (the form's handler turns it into the next step).
          <AdminButton type="submit" data-testid="signup-continue">
            {t('signup.steps.continue')}
          </AdminButton>
        ) : (
          <AdminButton type="submit" disabled={pending} data-testid="signup-submit">
            {pending ? t('signup.form.submitting') : t('signup.form.submit')}
          </AdminButton>
        )}
      </div>
    </form>
  );
}
