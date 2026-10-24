import { Caveat, Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';

/**
 * Product typefaces, exposed as CSS variables on <html>: Inter for everything, an italic serif for
 * one accent phrase per headline, a handwriting face for margin scribbles, and a mono for code.
 *
 * `subsets` is only what's preloaded: every subset is still there, and the browser fetches Latin
 * Extended (č, š, ž) when a page has those letters. Preloading only the Latin files, and not the
 * mono (code is never in a first screen), keeps a phone's first paint from waiting on fonts it
 * doesn't need yet.
 */
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const serif = Source_Serif_4({
  subsets: ['latin'],
  style: ['italic'],
  weight: ['500', '600'],
  variable: '--font-serif',
  display: 'swap',
});
const hand = Caveat({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-hand', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap', preload: false });

export const fontVariables = [sans.variable, serif.variable, hand.variable, mono.variable].join(' ');
