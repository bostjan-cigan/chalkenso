import { PRODUCT_NAME_PARTS } from '@/lib/site';
import EnsoO, { type EnsoDetail } from './EnsoO';

/** Keeps the real letter in the text (screen readers, copying) without drawing it. */
const HIDDEN_LETTER = { display: 'inline-block', width: 0, height: 0, overflow: 'hidden' } as const;

/**
 * Where the letters cross the brush, an outline in the background colour keeps them readable.
 * Each place the wordmark sits sets `--brand-halo` to its background.
 */
const HALO = [
  '0 0 0.04em var(--brand-halo, #fdfdfb)',
  '0.03em 0 0 var(--brand-halo, #fdfdfb)',
  '-0.03em 0 0 var(--brand-halo, #fdfdfb)',
  '0 0.03em 0 var(--brand-halo, #fdfdfb)',
  '0 -0.03em 0 var(--brand-halo, #fdfdfb)',
].join(', ');

/**
 * The wordmark: "Chalk" in the surrounding ink, "enso" in the red-pen serif italic, its "o" drawn as
 * a big brush ensō behind the end of the word (the logo mark). Screen readers and copying still get
 * the plain name. `detail` 0 for header sizes, 1 or 2 for large lockups.
 */
export default function BrandName({ detail = 0 }: { detail?: EnsoDetail }) {
  const [first, second] = PRODUCT_NAME_PARTS;
  const ensoO = second.endsWith('o');
  return (
    <span>
      {first}
      <span
        style={{
          position: 'relative',
          display: 'inline-block',
          // The ring sits behind these letters, but in front of whatever is behind the wordmark
          isolation: 'isolate',
          fontFamily: 'var(--font-serif), Georgia, serif',
          fontStyle: 'italic',
          fontWeight: 600,
          color: 'var(--red-pen)',
          marginLeft: '0.02em',
          textShadow: ensoO ? HALO : undefined,
        }}
      >
        {ensoO ? second.slice(0, -1) : second}
        {ensoO ? (
          <>
            <span style={HIDDEN_LETTER}>o</span>
            <EnsoO detail={detail === 0 ? 1 : 2} />
          </>
        ) : null}
      </span>
    </span>
  );
}
