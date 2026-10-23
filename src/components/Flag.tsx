import type { Locale } from '@/i18n/config';
import styles from './LanguageMenu.module.css';

/**
 * A language's flag, drawn here (emoji flags show as two letters on Windows), small and simple: the
 * Union Jack for English, Slovenia's tricolour with a plain coat of arms for Slovenian.
 */
export default function Flag({ locale }: { locale: Locale }) {
  return (
    <svg className={styles.flag} viewBox={locale === 'en' ? '0 0 60 30' : '0 0 24 16'} preserveAspectRatio="xMidYMid slice" aria-hidden>
      {locale === 'en' ? (
        <>
          <rect width="60" height="30" fill="#012169" />
          <path d="M0 0l60 30M60 0L0 30" stroke="#fff" strokeWidth="6" />
          <path d="M0 0l60 30M60 0L0 30" stroke="#C8102E" strokeWidth="2.5" />
          <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
          <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6" />
        </>
      ) : (
        <>
          <rect width="24" height="16" fill="#fff" />
          <rect y="5.33" width="24" height="5.34" fill="#003DA5" />
          <rect y="10.67" width="24" height="5.33" fill="#ED1C24" />
          <path d="M4.2 2.4h4.2v3.4q0 2.3-2.1 3.2-2.1-.9-2.1-3.2z" fill="#003DA5" stroke="#ED1C24" strokeWidth=".5" />
          <path d="M4.7 6.6l.8-1.5.4.6.4-1.4.4 1.4.4-.6.8 1.5z" fill="#fff" />
        </>
      )}
    </svg>
  );
}
