import publicRepositories from './public-repositories.json';

/**
 * Product identity and deployment settings, in one place. Client-safe: only `NEXT_PUBLIC_*`
 * variables and `CHALKENSO_EDITION` (set by next.config.js) are read here.
 */

/** The wordmark's two halves: "Chalk" in ink, "enso" in the red-pen serif. */
export const PRODUCT_NAME_PARTS = ['Chalk', 'enso'] as const;

/**
 * Chalkenso: chalk (the classroom) and ensō, the Zen circle drawn in one stroke. An open ensō leaves
 * room to grow, and drawing it is practised again and again: a course that gets better every time
 * it's taught. The logo mark is that circle, drawn in chalk.
 */
export const PRODUCT_NAME = PRODUCT_NAME_PARTS.join('');

export const PRODUCT_TAGLINE = 'AI-assisted curriculum design';

export const PRODUCT_DESCRIPTION =
  'AI-assisted curriculum design for training providers, academies and schools. Plan courses that hold together, annotate them while you teach, and let AI draft the next version. You approve every change.';

export const FOUNDER = {
  name: 'Boštjan Cigan',
  linkedin: 'https://linkedin.com/in/bostjan-cigan/',
  homepage: 'https://bostjan-cigan.com',
  coursesUrl: 'https://bostjan-cigan.com/courses',
} as const;

/**
 * `cloud`: the hosted product.
 * `local`: the self-hosted, source-available edition (no marketing pages; the first sign-up sets
 * up the one organisation, later people join by invite).
 *
 * `next.config.js` decides it at build time (`CHALKENSO_EDITION`). The public repository is always
 * the local edition.
 */
export type Edition = 'cloud' | 'local';

export const EDITION: Edition = process.env.CHALKENSO_EDITION === 'cloud' ? 'cloud' : 'local';

/**
 * This installation's address: NEXT_PUBLIC_APP_URL, else the deployment's own address where the
 * host provides one (NEXT_PUBLIC_VERCEL_URL on Vercel), else localhost.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  (process.env.NEXT_PUBLIC_VERCEL_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}` : 'http://localhost:3100')
).replace(/\/+$/, '');
export const SITE_NAME = PRODUCT_NAME;

export const SITE_AUTHOR = {
  '@type': 'Organization',
  name: PRODUCT_NAME,
  url: SITE_URL,
} as const;

export function absoluteUrl(path: string) {
  return new URL(path, SITE_URL).toString();
}

/**
 * Chalkenso's public repositories, null until they're published: the local edition (`app`) and the
 * Obsidian plugin with its Claude Code kits (`obsidian`). In a JSON file so the export reads the same.
 */
export const PUBLIC_REPOSITORIES: { app: string | null; obsidian: string | null } = publicRepositories;

const obsidianDownload = (file: string) =>
  PUBLIC_REPOSITORIES.obsidian ? `${PUBLIC_REPOSITORIES.obsidian.replace(/\/+$/, '')}/releases/latest/download/${file}` : null;

/** The Claude Code kits as one zip, from the plugin's latest release (null until it's published). */
export const OBSIDIAN_KIT_URL = obsidianDownload('chalkenso-obsidian-kit.zip');

/** The Obsidian plugin as one zip (a `chalkenso/` folder for `.obsidian/plugins`), from its latest release. */
export const OBSIDIAN_PLUGIN_URL = obsidianDownload('chalkenso-plugin.zip');
