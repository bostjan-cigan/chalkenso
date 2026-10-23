/**
 * How an organisation looks in the app when it has no logo: an icon on a colour. Client-safe (the
 * Settings picker previews it live). Unset choices fall back to a building on a colour picked from the
 * organisation's id, so two organisations look different at a glance even before anyone sets them.
 */

export const ORG_ICONS = [
  { key: 'building', label: 'Building' },
  { key: 'school', label: 'School' },
  { key: 'book', label: 'Book' },
  { key: 'certificate', label: 'Certificate' },
  { key: 'code', label: 'Code' },
  { key: 'bulb', label: 'Idea' },
  { key: 'rocket', label: 'Rocket' },
  { key: 'users', label: 'People' },
] as const;

/** Mid-tone colours that read on paper and in dark mode alike (tile: a tint of it, icon: the colour). */
export const ORG_COLORS = [
  { key: 'blue', label: 'Blue', rgb: '24, 95, 165' },
  { key: 'teal', label: 'Teal', rgb: '15, 110, 86' },
  { key: 'green', label: 'Green', rgb: '59, 109, 17' },
  { key: 'amber', label: 'Amber', rgb: '186, 117, 23' },
  { key: 'coral', label: 'Coral', rgb: '216, 90, 48' },
  { key: 'red', label: 'Red', rgb: '163, 45, 45' },
  { key: 'pink', label: 'Pink', rgb: '212, 83, 126' },
  { key: 'purple', label: 'Purple', rgb: '83, 74, 183' },
] as const;

export type OrgIconKey = (typeof ORG_ICONS)[number]['key'];
export type OrgColorKey = (typeof ORG_COLORS)[number]['key'];

export const isOrgIconKey = (value: unknown): value is OrgIconKey => ORG_ICONS.some((icon) => icon.key === value);
export const isOrgColorKey = (value: unknown): value is OrgColorKey => ORG_COLORS.some((color) => color.key === value);

/** A small stable number from a string (not for security: only to spread default colours). */
function spread(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return hash;
}

/** The icon and colour an organisation shows: its own choices, or the defaults. */
export function organizationIdentity(org: { id: string; iconName?: string | null; iconColor?: string | null }) {
  const icon: OrgIconKey = isOrgIconKey(org.iconName) ? org.iconName : 'building';
  const color = ORG_COLORS.find((entry) => entry.key === org.iconColor) ?? ORG_COLORS[spread(org.id) % ORG_COLORS.length];
  return { icon, color: color.key as OrgColorKey, rgb: color.rgb };
}
