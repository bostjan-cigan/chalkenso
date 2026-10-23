import type { CSSProperties } from 'react';

/** Off screen rather than hidden: bots fill in fields they find in the page, whatever their CSS. */
const OFF_SCREEN: CSSProperties = { position: 'absolute', left: '-10000px', width: 1, height: 1, opacity: 0 };

/**
 * A field for bots on the public forms (signing up, booking a call): people never see or
 * fill it, so a form that comes back with it filled in (`website`) is a bot's.
 */
export default function TrapField() {
  return <input name="website" style={OFF_SCREEN} tabIndex={-1} autoComplete="off" aria-hidden />;
}
