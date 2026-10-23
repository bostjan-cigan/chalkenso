import { NextResponse } from 'next/server';
import { getLocale, getTranslations } from 'next-intl/server';
import { serverExtensions } from '@/extensions/server';
import { isLocale, DEFAULT_LOCALE } from '@/i18n/config';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { canExport, loadExportScope, type ExportViewer } from '@/lib/export/scope';
import { exportName, writeExport } from '@/lib/export/run';
import { withOrgScope } from '@/lib/org-context';
import { HOUR, hashForLimits, withinLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Streaming keeps the function running until the download ends. Self-hosted there is no limit and
 * this is inert; on a serverless host that caps it (`VERCEL` set), the export stops adding the
 * optional parts (older texts, images) after `TIME_BUDGET_MS`, so it always finishes as a whole .zip
 * in time.
 */
export const maxDuration = 300;
const TIME_BUDGET_MS = 240_000;

/** Exports per person and organisation in an hour: enough to try again, not enough to load the database. */
const EXPORT_LIMIT = { name: 'export', max: 10, windowMs: HOUR };

const PAGE = '/admin/settings/export';

/**
 * "Export everything" (Settings → Export): one .zip with what the person can open in the
 * organisation they work in (owners and admins: all of it), streamed as it is written
 * (src/lib/export). A plain link starts it, so anything refused goes back to the page, which says why.
 */
export async function GET(request: Request) {
  const back = (query = '') => NextResponse.redirect(new URL(`${PAGE}${query}`, request.url), 303);
  const session = await getCurrentUserSession();
  const user = session?.user;
  if (!user?.organization || user.impersonator) {
    // Signed out, outside an organisation, or a platform admin looking through someone's eyes: the
    // page sends each where they belong. (Logging in as someone is for help, not for taking data.)
    return back();
  }
  const viewer = user as ExportViewer;
  if (!canExport(viewer)) {
    return back();
  }
  if (!(await withinLimit(EXPORT_LIMIT, hashForLimits(`${viewer.organization.id}:${viewer.id}`)))) {
    return back('?error=limit');
  }

  // Everything that needs the request (the session, the language, the words) is read now: the
  // export itself runs while the response streams, scoped to this organisation.
  const requestLocale = await getLocale();
  const locale = isLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE;
  const [scope, words, feedbackWords, teamWords] = await Promise.all([
    loadExportScope(viewer),
    getTranslations('account.export.file'),
    getTranslations('courses.feedbackExport'),
    serverExtensions.team.words(locale),
  ]);
  const parts = await serverExtensions.exportParts(scope);
  const now = new Date();
  const name = exportName(scope, now);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const sink = async (chunk: Uint8Array) => {
    await writer.ready;
    await writer.write(chunk);
  };
  const run = {
    scope,
    locale,
    words,
    feedbackWords,
    roles: teamWords.roles,
    parts,
    deadline: process.env.VERCEL ? now.getTime() + TIME_BUDGET_MS : null,
    now,
  };
  void withOrgScope(scope.organization.id, () => writeExport(run, sink)).then(
    () => writer.close(),
    async (error: unknown) => {
      // A download stopped halfway is never a .zip that looks whole: the browser reports it failed.
      console.error(`[export] ${scope.organization.id} stopped:`, error);
      await writer.abort(error).catch(() => {});
    }
  );

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}.zip"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
