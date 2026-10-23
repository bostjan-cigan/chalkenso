'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { HANDLE_MAX, HANDLE_MIN, handleProblemKey, normalizeHandle, typingHandle } from '@/lib/handle-format';
import AdminField from './ui/AdminField';

/**
 * A handle field: suggested from a name (`from`) until the person types their own, written the way a
 * handle must be (lowercase, digits, single hyphens), with what's wrong with its form. Whether it's free
 * is checked when the form is sent, or as they type with `check` (`/api/handles`, where the edition
 * has it). Its own words are in `common`, which every page's words include (the app's in English).
 */
export default function HandleField({
  id,
  name,
  label,
  from,
  hint,
  check = false,
  initial,
  optional = false,
  mine = [],
}: {
  id: string;
  name: string;
  label: string;
  /** What to suggest it from (the person's or the organisation's name). */
  from: string;
  hint: string;
  /** Say whether it's free as they type. */
  check?: boolean;
  initial?: string;
  /** May be left empty (signing up: one is suggested). */
  optional?: boolean;
  /** Handles already theirs (held ones): said to be theirs, not checked. */
  mine?: Array<string | null>;
}) {
  const t = useTranslations('common.handle');
  const [own, setOwn] = useState<string | null>(initial ?? null);
  const value = own ?? normalizeHandle(from);
  // A hyphen still being typed at the end isn't a problem yet.
  const problemKey = value && !value.endsWith('-') ? handleProblemKey(value) : null;
  const problem = problemKey ? t(`problems.${problemKey}`, { min: HANDLE_MIN, max: HANDLE_MAX }) : null;
  const [free, setFree] = useState<{ handle: string; available: boolean } | null>(null);
  const theirs = Boolean(value) && mine.includes(value);

  useEffect(() => {
    if (!check || !value || problem || theirs) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/handles?handle=${encodeURIComponent(value)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { available?: boolean } | null) => {
          if (body && typeof body.available === 'boolean') setFree({ handle: value, available: body.available });
        })
        .catch(() => {});
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [check, value, problem, theirs]);

  const availability = theirs
    ? t('availability.yours', { handle: value })
    : check && free?.handle === value && !problem
      ? free.available
        ? t('availability.free', { handle: value })
        : t('availability.taken', { handle: value })
      : null;
  return (
    <AdminField
      id={id}
      name={name}
      label={label}
      value={value}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => setOwn(typingHandle(event.target.value))}
      hint={problem ?? availability ?? hint}
      data-available={theirs ? 'true' : check && free?.handle === value ? String(free.available) : undefined}
      required={!optional}
    />
  );
}
