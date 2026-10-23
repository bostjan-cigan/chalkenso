'use client';

import { useTranslations } from 'next-intl';
import { useTheme } from './ThemeProvider';
import { BsSun, BsMoon } from 'react-icons/bs';
import { useEffect, useState } from 'react';
import styles from '../styles/ThemeToggle.module.css';

/** `floating`: fixed in the top-right corner (learner pages). `inline`: sits in the app sidebar. */
export default function ThemeToggle({ variant = 'floating' }: { variant?: 'floating' | 'inline' }) {
  const className = variant === 'inline' ? styles.themeToggleInline : styles.themeToggle;
  const size = variant === 'inline' ? 16 : 20;
  const t = useTranslations('common.theme');
  const { resolvedTheme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <button
        className={className}
        aria-label={t('toggle')}
        title={t('toggle')}
        disabled
      >
        <BsMoon size={size} />
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className={className}
      aria-label={resolvedTheme === 'dark' ? t('toLight') : t('toDark')}
      title={resolvedTheme === 'dark' ? t('toLight') : t('toDark')}
    >
      {resolvedTheme === 'dark' ? (
        <BsSun size={size} />
      ) : (
        <BsMoon size={size} />
      )}
    </button>
  );
}

