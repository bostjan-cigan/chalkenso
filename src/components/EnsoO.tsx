import { useId, type CSSProperties } from 'react';
import geometry from './enso-geometry.json';

export type EnsoDetail = 0 | 1 | 2;

type Geometry = {
  advance: number;
  d: string;
  streaks: { d: string; width: number }[];
  chalk: { cx: number; cy: number; deg: number; length: number; height: number; tip: number };
  box: number[];
};

const ENSO = geometry as unknown as Record<`${EnsoDetail}`, Geometry>;

/**
 * Where the big ensō sits, in em of the wordmark: its width, the height of its centre above the
 * baseline, and how far its right edge reaches past where the letter "o" would end. Its left edge
 * lands between the "n" and the "s", so it reads as the "o" and as the circle around the end of
 * the word.
 */
const RING = { width: 1.3, centre: 0.4, overhang: 0.25 };

/** Room around the ring in the drawing (brush streaks reach a little outside it). */
const PAD = 90;

/**
 * The "o" of Chalkenso: a brush ensō (dry streaks, frayed end), drawn big behind the end of the
 * word. It takes the place of the italic serif "o" (Source Serif 4, 600) it was measured from, plus
 * the overhang, in a zero-height box on the baseline; the ring itself is positioned behind the
 * letters before it (BrandName draws them on top, outlined in the background colour). `detail`
 * matches the brush texture to the ring's size: 1 at header sizes, 2 for large lockups. `chalk`
 * adds the chalk stick at the tail. Geometry: scripts/brand/generate.mjs.
 */
export default function EnsoO({ detail = 1, chalk = false }: { detail?: EnsoDetail; chalk?: boolean }) {
  const g = ENSO[detail];
  const id = `enso${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [x0, y0, x1, y1] = g.box;
  const vx = x0 - PAD;
  const vy = y0 - PAD;
  const vw = x1 - x0 + PAD * 2;
  const vh = y1 - y0 + PAD * 2;
  // em per drawing unit, for a ring RING.width em wide
  const unit = RING.width / (x1 - x0);
  const ringCentreY = (y0 + y1) / 2;
  const { cx, cy, deg, length, height, tip } = g.chalk;
  const rotate = `rotate(${deg} ${cx} ${cy})`;

  const box: CSSProperties = {
    position: 'relative',
    display: 'inline-block',
    width: `${g.advance / 1000 + RING.overhang}em`,
    height: 0,
  };
  const ring: CSSProperties = {
    position: 'absolute',
    zIndex: -1,
    right: `${(g.advance - x1) / 1000 - PAD * unit}em`,
    bottom: `${RING.centre - (vy + vh - ringCentreY) * unit}em`,
    width: `${vw * unit}em`,
    height: `${vh * unit}em`,
    overflow: 'visible',
    // A little see-through, so the "s" in front of it stays clear
    opacity: 0.75,
  };

  return (
    <span aria-hidden style={box}>
      <svg focusable="false" viewBox={`${vx} ${vy} ${vw} ${vh}`} style={ring}>
        <mask id={id} maskUnits="userSpaceOnUse" x={vx} y={vy} width={vw} height={vh}>
          <rect x={vx} y={vy} width={vw} height={vh} fill="#fff" />
          {g.streaks.map((streak) => (
            <path key={streak.d} d={streak.d} stroke="#000" strokeWidth={streak.width} strokeLinecap="round" fill="none" />
          ))}
        </mask>
        <path d={g.d} fill="currentColor" mask={`url(#${id})`} />
        {chalk ? (
          <>
            <rect x={cx - length / 2} y={cy - height / 2} width={length} height={height} rx={height / 2} fill="#f6c768" transform={rotate} />
            <rect x={cx - length / 2} y={cy - height / 2} width={tip} height={height} rx={height / 2} fill="#e9b54a" transform={rotate} />
          </>
        ) : null}
      </svg>
    </span>
  );
}
