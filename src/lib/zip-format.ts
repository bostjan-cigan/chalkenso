/**
 * The parts of the ZIP format every writer here shares: CRC-32, MS-DOS dates and clean entry names.
 * Pure (no Node or browser APIs), so a writer in the browser and the streaming one behind "Export
 * everything" (src/lib/zip-stream.ts) use the same code.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32 (IEEE 802.3, the one ZIP uses) of `data`, as an unsigned 32-bit number. Pass the CRC so far
 * as `previous` to continue it over the next piece of a file.
 */
export function crc32(data: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A date as MS-DOS time and date fields (local time, two-second steps, 1980–2107). */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Forward slashes, no leading slash, no empty, `.` or `..` segments; a trailing slash is a folder. */
export function cleanZipPath(path: string): string {
  const isFolder = /[\\/]$/.test(path);
  const segments = path
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..');
  return segments.length ? `${segments.join('/')}${isFolder ? '/' : ''}` : '';
}
