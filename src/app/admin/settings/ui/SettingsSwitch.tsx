'use client';

import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import styles from './settings-ui.module.css';

/**
 * Apple's toggle: flipping it saves at once (no Save button). `action` receives the form data with
 * `name` set to "on" when it's switched on, the way a checkbox sends it.
 */
export default function SettingsSwitch({
  name,
  checked,
  label,
  action,
  testId,
}: {
  name: string;
  checked: boolean;
  /** What it switches, for screen readers (the row says it on screen). */
  label: string;
  action: (formData: FormData) => Promise<unknown>;
  testId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(checked);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={shown}
      aria-label={label}
      className={styles.switch}
      disabled={pending}
      data-testid={testId}
      onClick={() =>
        startTransition(async () => {
          const next = !shown;
          setShown(next);
          const data = new FormData();
          if (next) data.set(name, 'on');
          await action(data);
          router.refresh();
        })
      }
    />
  );
}
