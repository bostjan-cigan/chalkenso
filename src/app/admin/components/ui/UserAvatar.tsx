import { type CSSProperties } from 'react';

type UserAvatarProps = {
  name: string;
  imageUrl?: string | null;
  size?: number;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Round avatar: the user's image when set, otherwise initials on a neutral disc. */
export default function UserAvatar({ name, imageUrl = null, size = 28 }: UserAvatarProps) {
  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '999px',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    background: 'rgba(var(--foreground-rgb), 0.1)',
    color: 'rgba(var(--foreground-rgb), 0.75)',
    fontSize: Math.round(size * 0.4),
    fontWeight: 600,
    border: '1px solid rgba(var(--foreground-rgb), 0.12)',
  };

  if (imageUrl) {
    return (
      <span style={base} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </span>
    );
  }

  return (
    <span style={base} aria-hidden title={name}>
      {initials(name)}
    </span>
  );
}
