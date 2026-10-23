/**
 * What "Where you're signed in" says about a session: the browser and system from its user agent
 * ("Safari on iPhone"), and roughly where it was opened from (the city and country Vercel adds to
 * each request; nothing on other hosts). No addresses are kept.
 */

export type DeviceKind = 'phone' | 'tablet' | 'computer';

/**
 * `label` is in English ("Chrome on Mac"; the platform admin's pages); `browser` and `system` are the
 * names it's made of, for pages that say it in the reader's language (null: not known).
 */
export type SessionDevice = { kind: DeviceKind; label: string; browser: string | null; system: string | null };

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: Array<[RegExp, string, DeviceKind]> = [
  [/iPhone/, 'iPhone', 'phone'],
  [/iPad/, 'iPad', 'tablet'],
  [/Android.*Mobile/, 'Android', 'phone'],
  [/Android/, 'Android', 'tablet'],
  [/CrOS/, 'ChromeOS', 'computer'],
  [/Macintosh|Mac OS X/, 'Mac', 'computer'],
  [/Windows/, 'Windows', 'computer'],
  [/Linux/, 'Linux', 'computer'],
];

/** "Chrome on Mac", or "Unknown browser" when the session kept no user agent. */
export function describeDevice(userAgent: string | null | undefined): SessionDevice {
  const agent = userAgent ?? '';
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1] ?? null;
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent));
  // iPadOS asks for the desktop site and says Macintosh; only a touch screen tells them apart, and the
  // server never sees one. "Mac" it is.
  const kind = system?.[2] ?? 'computer';
  if (!browser && !system) {
    return { kind, label: 'Unknown browser', browser: null, system: null };
  }
  return {
    kind,
    label: browser && system ? `${browser} on ${system[1]}` : (browser ?? system?.[1] ?? 'Unknown browser'),
    browser,
    system: system?.[1] ?? null,
  };
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

/** "Ljubljana, Slovenia" from Vercel's request headers; null elsewhere. */
export function locationFromHeaders(headers: Pick<Headers, 'get'>): string | null {
  const decode = (value: string | null) => {
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const city = decode(headers.get('x-vercel-ip-city'));
  const code = headers.get('x-vercel-ip-country');
  let country: string | null = null;
  if (code && /^[A-Z]{2}$/.test(code)) {
    try {
      country = regionNames?.of(code) ?? code;
    } catch {
      country = code;
    }
  }
  const parts = [city, country].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(', ').slice(0, 120) : null;
}
