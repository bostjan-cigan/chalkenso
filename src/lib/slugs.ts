const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/g;

export function createSlugCandidate(value: string, fallback = 'item') {
  const slug = value
    .normalize('NFKD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_PATTERN, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return slug || fallback;
}

export async function ensureUniqueSlug(
  baseSlug: string,
  exists: (slug: string) => Promise<boolean>
) {
  const normalizedBaseSlug = createSlugCandidate(baseSlug);
  let candidate = normalizedBaseSlug;
  let suffix = 2;

  while (await exists(candidate)) {
    candidate = `${normalizedBaseSlug}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}
