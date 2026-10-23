import './globals.css';
import '../styles/icons.css';
import type { Metadata } from 'next';
import { ThemeProvider } from '../components/ThemeProvider';
import { fontVariables } from '@/lib/fonts';
import { ui } from '@/extensions/ui';
import { EDITION, FOUNDER, PRODUCT_DESCRIPTION, PRODUCT_NAME, SITE_URL } from '@/lib/site';
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE } from '@/i18n/config';

export const metadata: Metadata = {
  title: {
    default: `${PRODUCT_NAME} · AI-assisted curriculum design`,
    template: `%s | ${PRODUCT_NAME}`,
  },
  description: PRODUCT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  keywords: [
    'curriculum design',
    'AI curriculum design',
    'course design software',
    'instructional design',
    'course feedback',
    'curriculum management',
    'training providers',
    'corporate academy',
    'bootcamp curriculum',
    'Obsidian',
    'Claude',
  ],
  authors: [{ name: FOUNDER.name, url: FOUNDER.homepage }],
  creator: FOUNDER.name,
  metadataBase: new URL(SITE_URL),
  // Drawn by scripts/brand/generate.mjs. Setting `icons` here replaces the icon.svg next to this file, so it is listed too.
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico', sizes: '16x16 32x32 48x48' }],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
  formatDetection: { telephone: false, date: false, email: false, address: false },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: SITE_URL,
    siteName: PRODUCT_NAME,
    title: `${PRODUCT_NAME} · Courses that get better every time you teach them`,
    description: PRODUCT_DESCRIPTION,
    images: [{ url: '/og', width: 1200, height: 630, alt: PRODUCT_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PRODUCT_NAME} · AI-assisted curriculum design`,
    description: PRODUCT_DESCRIPTION,
    images: ['/og'],
  },
  robots: EDITION === 'local' ? { index: false, follow: false } : { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { RootHead } = ui;
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'light' || theme === 'dark') {
                    document.documentElement.setAttribute('data-theme', theme);
                  } else {
                    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
                  }
                } catch (e) {
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
                }
                // The page's language before anything paints (this layout is the same for every
                // language): the landing page's address (/sl), or the remembered pick. Each translated
                // part of the app sets the exact one once it loads (src/i18n/ClientIntlProvider.tsx).
                try {
                  var locales = ${JSON.stringify(LOCALES)};
                  var first = location.pathname.split('/')[1];
                  var picked = document.cookie.match(/(?:^|; )${LOCALE_COOKIE}=([a-z]+)/);
                  document.documentElement.lang = locales.indexOf(first) > -1 ? first
                    : picked && locales.indexOf(picked[1]) > -1 ? picked[1] : '${DEFAULT_LOCALE}';
                } catch (e) {}
              })();
            `,
          }}
        />
        {RootHead ? <RootHead /> : null}
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
