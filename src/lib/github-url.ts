/**
 * Optional course GitHub link: https only, github.com host.
 */
export function normalizeOptionalGithubUrl(
  raw: string | undefined | null
): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false };
  }

  if (url.protocol !== 'https:') {
    return { ok: false };
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return { ok: false };
  }

  return { ok: true, value: url.href };
}
