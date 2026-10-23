import { ImageResponse } from 'next/og';
import geometry from '@/components/enso-geometry.json';
import { PRODUCT_NAME_PARTS } from '@/lib/site';

export const OG_SIZE = { width: 1200, height: 630 };
const RULE_GAP = 45;

// The wordmark's ensō (src/components/EnsoO.tsx): a big brush circle behind the end of the word,
// drawn as an image for the renderer. Same placement as EnsoO: RING.width em wide, centred RING.centre
// em above the baseline, its right edge RING.overhang em past where the letter "o" would end.
const ENSO = geometry['2'];
const RING = { width: 1.3, centre: 0.4, overhang: 0.25 };
const PAD = 90;
const [X0, Y0, X1, Y1] = ENSO.box;
const VX = X0 - PAD;
const VY = Y0 - PAD;
const VW = X1 - X0 + PAD * 2;
const VH = Y1 - Y0 + PAD * 2;
const ENSO_RING = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VX} ${VY} ${VW} ${VH}">` +
    `<mask id="m" maskUnits="userSpaceOnUse" x="${VX}" y="${VY}" width="${VW}" height="${VH}">` +
    `<rect x="${VX}" y="${VY}" width="${VW}" height="${VH}" fill="#fff"/>` +
    ENSO.streaks.map((streak) => `<path d="${streak.d}" stroke="#000" stroke-width="${streak.width}" stroke-linecap="round" fill="none"/>`).join('') +
    `</mask><path d="${ENSO.d}" fill="#a32d2d" mask="url(#m)"/></svg>`
).toString('base64')}`;

/**
 * The ensō for a wordmark set at `fontSize` in the renderer's default sans: the space it takes after
 * "ens", and the ring, placed from the bottom of the line box (the baseline sits `baseline` above
 * it).
 */
function ensoRing(fontSize: number) {
  const unit = (RING.width * fontSize) / (X1 - X0);
  const baseline = fontSize * 0.27;
  return {
    space: (ENSO.advance / 1000 + RING.overhang) * fontSize,
    image: {
      src: ENSO_RING,
      width: VW * unit,
      height: VH * unit,
      style: {
        position: 'absolute' as const,
        right: ((ENSO.advance - X1) / 1000) * fontSize - PAD * unit,
        bottom: baseline + RING.centre * fontSize - (VY + VH - (Y0 + Y1) / 2) * unit,
        opacity: 0.75,
      },
    },
  };
}

const WORDMARK_SIZE = 64;
const RING_PLACEMENT = ensoRing(WORDMARK_SIZE);
// The letters in front of the ring, outlined in the page colour where they cross the brush
const HALO = '0 0 3px #fdfdfb, 2px 0 0 #fdfdfb, -2px 0 0 #fdfdfb, 0 2px 0 #fdfdfb, 0 -2px 0 #fdfdfb';

/**
 * The site's Open Graph image: an exercise-book page with the wordmark, a two-line headline (the
 * second line in red pen) and a marker-yellow badge. Used for the home page and the free tools.
 */
export function brandOgImage({
  headline,
  badge,
  headlineSize = 76,
}: {
  headline: [string, string?];
  badge: string;
  headlineSize?: number;
}) {
  return new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 88px 64px 140px',
          background: '#fdfdfb',
          color: '#0b2a4a',
        }}
      >
        {Array.from({ length: Math.floor(OG_SIZE.height / RULE_GAP) }).map((_, index) => (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: (index + 1) * RULE_GAP,
              height: 2,
              background: '#e2edf8',
            }}
          />
        ))}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 104, width: 3, background: '#f0a3a2' }} />

        <div style={{ display: 'flex', alignItems: 'flex-end', fontSize: WORDMARK_SIZE, fontWeight: 700 }}>
          <span>{PRODUCT_NAME_PARTS[0]}</span>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img {...RING_PLACEMENT.image} />
            <span style={{ color: '#a32d2d', textShadow: HALO }}>{PRODUCT_NAME_PARTS[1].slice(0, -1)}</span>
            <span style={{ width: RING_PLACEMENT.space }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: headlineSize, fontWeight: 700, lineHeight: 1.08 }}>
          <span>{headline[0]}</span>
          {headline[1] ? <span style={{ color: '#a32d2d' }}>{headline[1]}</span> : null}
        </div>
        <div style={{ display: 'flex' }}>
          <span style={{ fontSize: 30, color: '#412402', background: '#fcd98e', padding: '4px 14px', borderRadius: 6 }}>
            {badge}
          </span>
        </div>
      </div>
    ),
    OG_SIZE
  );
}
