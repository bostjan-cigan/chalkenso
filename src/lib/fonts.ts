import { Caveat, Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';

/**
 * Product typefaces, exposed as CSS variables on <html>: Inter for everything, an italic serif for
 * one accent phrase per headline, a handwriting face for margin scribbles, and a mono for code.
 */
const sans = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-sans', display: 'swap' });
const serif = Source_Serif_4({
  subsets: ['latin', 'latin-ext'],
  style: ['italic'],
  weight: ['500', '600'],
  variable: '--font-serif',
  display: 'swap',
});
const hand = Caveat({ subsets: ['latin', 'latin-ext'], weight: ['500', '600'], variable: '--font-hand', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const fontVariables = [sans.variable, serif.variable, hand.variable, mono.variable].join(' ');
