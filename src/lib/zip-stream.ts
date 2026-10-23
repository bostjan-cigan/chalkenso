import { constants, deflateRawSync } from 'node:zlib';
import { cleanZipPath, crc32, dosDateTime } from './zip-format';

/**
 * A ZIP archive written as it goes, for downloads too big to build in memory ("Export everything").
 * Every byte goes to `sink` as soon as it is ready and the next file waits for it, so a slow
 * download slows the export down instead of filling the server's memory.
 *
 * - A file given whole (a lesson note) is compressed at once and its sizes go in its header.
 * - A file given as pieces (a long CSV, an image from storage) is compressed piece by piece:
 *   each piece on its own, ended with a sync flush, and the last one finished, which together are
 *   one valid deflate stream (pigz writes the same). Its sizes follow it in a data descriptor.
 * - Images and other already-compressed files can be stored as they are (`compress: false`).
 * - ZIP64 records are added only when they are needed: more than 65,535 files, or an archive past
 *   4 GB. A single file stays under 4 GB (the export's limits keep it far below).
 *
 * Names are UTF-8 (general purpose bit 11). No folder entries: every unzip tool makes the folders
 * of the paths it extracts. Pure Node (no Next): tested in tests/e2e/e2e-export.mjs with `unzip`.
 */

export type ZipSink = (chunk: Uint8Array) => Promise<void>;

/** A file's contents: all at once, or pieces as they arrive. */
export type ZipSource = string | Uint8Array | AsyncIterable<string | Uint8Array>;

const SIGNATURE = {
  local: 0x04034b50,
  descriptor: 0x08074b50,
  central: 0x02014b50,
  zip64End: 0x06064b50,
  zip64Locator: 0x07064b50,
  end: 0x06054b50,
};
const UTF8_FLAG = 0x0800;
const DESCRIPTOR_FLAG = 0x0008;
const STORED = 0;
const DEFLATED = 8;
const VERSION = 20;
const VERSION_ZIP64 = 45;
const MAX_16 = 0xffff;
const MAX_32 = 0xffffffff;
/** Pieces of a streamed file are gathered to this size before they are compressed. */
const PIECE_BYTES = 256 * 1024;

type Entry = {
  name: Uint8Array;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
};

const encoder = new TextEncoder();

function bytesOf(piece: string | Uint8Array): Uint8Array {
  return typeof piece === 'string' ? encoder.encode(piece) : piece;
}

function concat(pieces: Uint8Array[], length: number): Uint8Array {
  if (pieces.length === 1) return pieces[0];
  const out = new Uint8Array(length);
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

/** Little-endian fields, written in order. */
class Fields {
  readonly bytes: Uint8Array;
  private view: DataView;
  private at = 0;
  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(value: number) {
    this.view.setUint16(this.at, value, true);
    this.at += 2;
    return this;
  }
  u32(value: number) {
    this.view.setUint32(this.at, value >>> 0, true);
    this.at += 4;
    return this;
  }
  u64(value: number) {
    this.view.setBigUint64(this.at, BigInt(value), true);
    this.at += 8;
    return this;
  }
  raw(value: Uint8Array) {
    this.bytes.set(value, this.at);
    this.at += value.length;
    return this;
  }
}

export class ZipStream {
  private offset = 0;
  private entries: Entry[] = [];
  private taken = new Set<string>();
  private finished = false;
  private readonly time: number;
  private readonly date: number;

  constructor(
    private readonly sink: ZipSink,
    modified: Date = new Date(),
    private readonly level = 6
  ) {
    const stamp = dosDateTime(modified);
    this.time = stamp.time;
    this.date = stamp.date;
  }

  /** Files written so far. */
  get count() {
    return this.entries.length;
  }

  /** Bytes written so far. */
  get size() {
    return this.offset;
  }

  private async emit(chunk: Uint8Array) {
    if (!chunk.length) return;
    this.offset += chunk.length;
    await this.sink(chunk);
  }

  /**
   * `path` as it can go in the archive: cleaned, and made unique (case-insensitively, since Finder
   * and Windows ignore case) with " (2)", " (3)", … before the extension.
   */
  claim(path: string): string {
    const clean = cleanZipPath(path).replace(/\/$/, '');
    if (!clean) throw new Error('A file in the archive needs a name.');
    const slash = clean.lastIndexOf('/');
    const folder = clean.slice(0, slash + 1);
    const name = clean.slice(slash + 1);
    const dot = name.lastIndexOf('.');
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = clean;
    for (let n = 2; this.taken.has(candidate.toLowerCase()); n += 1) {
      candidate = `${folder}${stem} (${n})${extension}`;
    }
    this.taken.add(candidate.toLowerCase());
    return candidate;
  }

  /**
   * Adds a file; returns the name it got (see `claim`). `compress: false` stores it as it is (images).
   * Pieces may be strings (UTF-8) or bytes.
   */
  async add(path: string, source: ZipSource, options: { compress?: boolean } = {}): Promise<string> {
    if (this.finished) throw new Error('The archive is finished.');
    const name = this.claim(path);
    const compress = options.compress !== false;
    if (typeof source === 'string' || source instanceof Uint8Array) {
      await this.addWhole(name, bytesOf(source), compress);
    } else {
      await this.addPieces(name, source, compress);
    }
    return name;
  }

  private localHeader(entry: Entry) {
    const header = new Fields(30 + entry.name.length);
    header
      .u32(SIGNATURE.local)
      .u16(VERSION)
      .u16(entry.flags)
      .u16(entry.method)
      .u16(this.time)
      .u16(this.date)
      .u32(entry.flags & DESCRIPTOR_FLAG ? 0 : entry.crc)
      .u32(entry.flags & DESCRIPTOR_FLAG ? 0 : entry.compressedSize)
      .u32(entry.flags & DESCRIPTOR_FLAG ? 0 : entry.size)
      .u16(entry.name.length)
      .u16(0)
      .raw(entry.name);
    return header.bytes;
  }

  private async addWhole(path: string, data: Uint8Array, compress: boolean) {
    const packed = compress ? new Uint8Array(deflateRawSync(data, { level: this.level })) : data;
    // Deflating can't make anything much bigger, but stored is never worse.
    const method = compress && packed.length < data.length ? DEFLATED : STORED;
    const body = method === DEFLATED ? packed : data;
    const entry: Entry = {
      name: encoder.encode(path),
      method,
      flags: UTF8_FLAG,
      crc: crc32(data),
      compressedSize: body.length,
      size: data.length,
      offset: this.offset,
    };
    if (entry.size >= MAX_32) throw new Error(`${path} is too large for the archive.`);
    await this.emit(this.localHeader(entry));
    await this.emit(body);
    this.entries.push(entry);
  }

  private async addPieces(path: string, source: AsyncIterable<string | Uint8Array>, compress: boolean) {
    const entry: Entry = {
      name: encoder.encode(path),
      method: compress ? DEFLATED : STORED,
      flags: UTF8_FLAG | DESCRIPTOR_FLAG,
      crc: 0,
      compressedSize: 0,
      size: 0,
      offset: this.offset,
    };
    await this.emit(this.localHeader(entry));

    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    const out = async (chunk: Uint8Array) => {
      entry.compressedSize += chunk.length;
      await this.emit(chunk);
    };
    const flush = async (last: boolean) => {
      const data = concat(pending, pendingBytes);
      pending = [];
      pendingBytes = 0;
      if (!compress) {
        await out(data);
        return;
      }
      // A piece on its own: synced (byte-aligned, not final) until the last one finishes the stream.
      const packed = deflateRawSync(data, { level: this.level, finishFlush: last ? constants.Z_FINISH : constants.Z_SYNC_FLUSH });
      await out(new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength));
    };

    for await (const piece of source) {
      const data = bytesOf(piece);
      if (!data.length) continue;
      entry.crc = crc32(data, entry.crc);
      entry.size += data.length;
      if (entry.size >= MAX_32) throw new Error(`${path} is too large for the archive.`);
      pending.push(data);
      pendingBytes += data.length;
      if (pendingBytes >= PIECE_BYTES) await flush(false);
    }
    await flush(true);

    const descriptor = new Fields(16);
    descriptor.u32(SIGNATURE.descriptor).u32(entry.crc).u32(entry.compressedSize).u32(entry.size);
    await this.emit(descriptor.bytes);
    this.entries.push(entry);
  }

  /** Writes the central directory and the end records. Nothing can be added after it. */
  async finish() {
    if (this.finished) return;
    this.finished = true;
    const start = this.offset;
    for (const entry of this.entries) {
      const zip64 = entry.offset >= MAX_32;
      const extra = zip64 ? new Fields(12).u16(0x0001).u16(8).u64(entry.offset).bytes : new Uint8Array(0);
      const record = new Fields(46 + entry.name.length + extra.length);
      record
        .u32(SIGNATURE.central)
        .u16(zip64 ? VERSION_ZIP64 : VERSION) // made by (MS-DOS)
        .u16(zip64 ? VERSION_ZIP64 : VERSION) // needed to extract
        .u16(entry.flags)
        .u16(entry.method)
        .u16(this.time)
        .u16(this.date)
        .u32(entry.crc)
        .u32(entry.compressedSize)
        .u32(entry.size)
        .u16(entry.name.length)
        .u16(extra.length)
        .u16(0) // comment
        .u16(0) // disk
        .u16(0) // internal attributes
        .u32(0) // external attributes
        .u32(zip64 ? MAX_32 : entry.offset)
        .raw(entry.name)
        .raw(extra);
      await this.emit(record.bytes);
    }
    const centralSize = this.offset - start;
    const count = this.entries.length;
    const zip64 = count >= MAX_16 || start >= MAX_32 || centralSize >= MAX_32;
    if (zip64) {
      const end64At = this.offset;
      const end64 = new Fields(56)
        .u32(SIGNATURE.zip64End)
        .u64(44) // size of the rest of this record
        .u16(VERSION_ZIP64)
        .u16(VERSION_ZIP64)
        .u32(0)
        .u32(0)
        .u64(count)
        .u64(count)
        .u64(centralSize)
        .u64(start);
      await this.emit(end64.bytes);
      await this.emit(new Fields(20).u32(SIGNATURE.zip64Locator).u32(0).u64(end64At).u32(1).bytes);
    }
    const end = new Fields(22)
      .u32(SIGNATURE.end)
      .u16(0)
      .u16(0)
      .u16(Math.min(count, MAX_16))
      .u16(Math.min(count, MAX_16))
      .u32(Math.min(centralSize, MAX_32))
      .u32(zip64 ? MAX_32 : start)
      .u16(0);
    await this.emit(end.bytes);
  }
}
