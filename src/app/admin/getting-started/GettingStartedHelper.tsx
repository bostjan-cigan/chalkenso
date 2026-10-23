'use client';

/* eslint-disable @next/next/no-img-element -- a small photo, as on the booking sheet */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { TbCheck, TbChevronDown, TbChevronRight } from 'react-icons/tb';
import HowItWorksSheet from '../how-it-works/HowItWorksSheet';
import type { HowItWorksAction } from '../how-it-works/data';
import { hideGettingStartedAction, openedGettingStartedAction, tickGettingStartedAction } from './actions';
import type { GettingStartedCall, GettingStartedStep, TickableStep } from './data';
import styles from './getting-started.module.css';

/** The ring's circle: r = 15, so its length is 2πr. */
const RING = 2 * Math.PI * 15;

/**
 * Getting started in the corner: a ring with how many steps are done (the words slide out on hover),
 * and above it, when asked, the checklist. Never opens by itself; on Home, until it has been opened
 * once, a note in red pen points at it. Ticks show at once and are saved behind; with the last one
 * it says so, and it's gone from the next page.
 */
export default function GettingStartedHelper({
  steps,
  call,
  callButton,
  how,
  hint,
}: {
  steps: GettingStartedStep[];
  call: GettingStartedCall | null;
  /** The call's "Schedule a call…" (the edition's booking sheet). */
  callButton: ReactNode;
  /** How it works' sheet: its one action and contents (only while it's a step left to do). */
  how: { action: HowItWorksAction; content: ReactNode } | null;
  /** Show the note pointing at it (on Home, until it's first opened). */
  hint: boolean;
}) {
  const t = useTranslations('app.gettingStarted');
  const locale = useLocale();
  const router = useRouter();
  const panelId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [showHint, setShowHint] = useState(hint);
  const [gone, setGone] = useState(false);
  // Ticks by hand, shown at once; the server's word (a new page) replaces them.
  const [ticks, setTicks] = useState<Partial<Record<TickableStep, boolean>>>({});
  const panel = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLButtonElement>(null);

  useEffect(() => setTicks({}), [steps]);

  // What happened can't be unticked; the rest follows the latest tick by hand.
  const isDone = (step: GettingStartedStep) => step.auto || (ticks[step.id as TickableStep] ?? step.done);
  const doneCount = steps.filter(isDone).length;
  const allDone = doneCount === steps.length;
  const left = steps.length - doneCount;

  // Closed by Escape or a click elsewhere, but not while a sheet it opened is over the page.
  useEffect(() => {
    if (!open) return;
    const sheetOpen = () => Boolean(document.querySelector('[aria-modal="true"]'));
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || sheetOpen()) return;
      setOpen(false);
      ring.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (sheetOpen() || panel.current?.contains(target) || ring.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (gone) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && showHint) {
      // Found it: the note isn't needed again.
      setShowHint(false);
      void openedGettingStartedAction();
    }
  }

  function tick(id: TickableStep, done: boolean) {
    setTicks((current) => ({ ...current, [id]: done }));
    void tickGettingStartedAction(id, done);
  }

  async function hide() {
    setGone(true);
    await hideGettingStartedAction(true);
    router.refresh();
  }

  const title = (step: GettingStartedStep) => (step.id === 'call' && call ? call.title : t(`steps.${step.id}.title` as 'steps.account.title'));
  const booked = call?.bookedAt
    ? t('booked', {
        when: new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(call.bookedAt)),
      })
    : null;

  return (
    <>
      {/* Room at the end of the page, so the ring never covers its last line. */}
      <div className={styles.spacer} aria-hidden />

      {/* Only while open: closed, it isn't on the page at all (not even hidden). */}
      {open ? (
        <div ref={panel} id={panelId} className={styles.panel} role="dialog" aria-labelledby={titleId} data-testid="getting-started-panel">
          <div className={styles.head}>
            <div className={styles.headTop}>
              <div>
                <h2 id={titleId} className={styles.title}>
                  {t('title')}
                </h2>
                <p className={styles.note} aria-hidden>
                  {allDone ? t('allDone') : left <= 2 ? t('nearly') : t('note')}
                </p>
              </div>
              <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label={t('close')}>
                <TbChevronDown aria-hidden size={18} />
              </button>
            </div>
            <div className={styles.bar} aria-hidden>
              <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
            <p className={styles.barText}>{t('progress', { done: doneCount, total: steps.length })}</p>
          </div>

          <ul className={styles.list}>
            {steps.map((step) => {
              const done = isDone(step);
              const label = title(step);
              const tickable = step.id !== 'account' && !(step.auto && done);
              const sub = step.id === 'call' ? booked : !done && step.id !== 'account' ? t(`steps.${step.id}.hint` as 'steps.how.hint') : null;
              // The call, while it's to do: a card of its own, with the photo and the button.
              if (step.id === 'call' && call && !done) {
                return (
                  <li key={step.id} className={styles.call} data-testid="getting-started-call">
                    <img src={call.photoUrl} alt="" className={styles.photo} />
                    <div>
                      <p className={styles.callTitle}>{call.title}</p>
                      <p className={styles.callText}>{call.text}</p>
                      <div className={styles.callActions}>
                        {callButton}
                        <button type="button" className={styles.quiet} onClick={() => tick('call', true)} data-testid="getting-started-call-skip">
                          {t('notNow')}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              }
              const words = (
                <>
                  <span className={styles.stepTitle}>{label}</span>
                  {sub ? <span className={styles.stepHint}>{sub}</span> : null}
                </>
              );
              return (
                <li key={step.id} className={done ? `${styles.step} ${styles.done}` : styles.step} data-testid={`getting-started-${step.id}`} data-done={done}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={label}
                    title={tickable ? (done ? t('markNotDone') : t('markDone')) : t('doneByItself')}
                    className={styles.tick}
                    disabled={!tickable}
                    onClick={() => tick(step.id as TickableStep, !done)}
                  >
                    <span>{done ? <TbCheck aria-hidden size={13} strokeWidth={3} /> : null}</span>
                  </button>
                  {step.id === 'how' && how ? (
                    <button type="button" className={styles.go} onClick={() => setHowOpen(true)} data-testid="how-it-works-open">
                      {words}
                    </button>
                  ) : step.href ? (
                    <Link href={step.href} className={styles.go}>
                      {words}
                    </Link>
                  ) : (
                    <span className={styles.go}>{words}</span>
                  )}
                  {!done && (step.href || step.id === 'how') ? <TbChevronRight aria-hidden className={styles.chevron} /> : <span />}
                </li>
              );
            })}
          </ul>

          <div className={styles.foot}>
            <span>{t('footer')}</span>
            <button type="button" onClick={hide} data-testid="getting-started-hide">
              {t('hide')}
            </button>
          </div>
        </div>
      ) : null}

      <button
        ref={ring}
        type="button"
        className={allDone ? `${styles.ring} ${styles.ringDone}` : styles.ring}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t('open', { done: doneCount, total: steps.length })}
        onClick={toggle}
        data-testid="getting-started"
      >
        <span className={styles.ringBox} aria-hidden>
          <svg viewBox="0 0 36 36">
            <circle className={styles.track} cx="18" cy="18" r="15" />
            <circle className={styles.fill} cx="18" cy="18" r="15" strokeDasharray={RING} strokeDashoffset={RING * (1 - doneCount / steps.length)} />
          </svg>
          <b>{allDone ? <TbCheck size={16} strokeWidth={3} /> : `${doneCount}/${steps.length}`}</b>
        </span>
        <span className={styles.label} aria-hidden>
          {t('title')}
        </span>
      </button>

      {showHint && !open ? (
        <div className={styles.hint} aria-hidden data-testid="getting-started-hint">
          <span>{t('hint')}</span>
          <svg width="64" height="54" viewBox="0 0 64 54">
            <path d="M6 4c22 0 40 10 44 38" />
            <path d="M42 36l8 9 7-10" />
          </svg>
        </div>
      ) : null}

      {how ? (
        <HowItWorksSheet open={howOpen} onClose={() => setHowOpen(false)} action={how.action}>
          {how.content}
        </HowItWorksSheet>
      ) : null}
    </>
  );
}
