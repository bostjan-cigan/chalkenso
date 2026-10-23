import 'server-only';

import { CSV_BOM, csvLine, type CsvCell } from '@/lib/csv';
import type { ZipSink, ZipStream } from '@/lib/zip-stream';
import type { ExportFiles } from './types';

/** CSV text is handed to the archive in pieces of about this size. */
const CSV_PIECE = 64 * 1024;

/** The export's files, all inside one top folder (`root`), so unzipping makes a single folder. */
export function exportFiles(zip: ZipStream, root: string): ExportFiles {
  const inRoot = (path: string) => `${root}/${path}`;
  const relative = (path: string) => path.slice(root.length + 1);
  return {
    async text(path, content) {
      return relative(await zip.add(inRoot(path), content));
    },
    async csv(path, header, rows) {
      let count = 0;
      async function* pieces(): AsyncGenerator<string> {
        let buffer = `${CSV_BOM}${csvLine(header)}\r\n`;
        for await (const row of rows as AsyncIterable<CsvCell[]>) {
          buffer += `${csvLine(row)}\r\n`;
          count += 1;
          if (buffer.length >= CSV_PIECE) {
            yield buffer;
            buffer = '';
          }
        }
        if (buffer) yield buffer;
      }
      await zip.add(inRoot(path), pieces());
      return count;
    },
    async binary(path, source, options) {
      return relative(await zip.add(inRoot(path), source, options));
    },
  };
}

/**
 * Collects the archive's many small writes (headers are 30 bytes) into pieces of `size` before they
 * go to `sink`: fewer, larger chunks for the response. Call `flush` at the end.
 */
export function bufferedSink(sink: ZipSink, size = 64 * 1024): { write: ZipSink; flush: () => Promise<void> } {
  let pending: Uint8Array[] = [];
  let bytes = 0;
  const flush = async () => {
    if (!bytes) return;
    const chunk = new Uint8Array(bytes);
    let at = 0;
    for (const piece of pending) {
      chunk.set(piece, at);
      at += piece.length;
    }
    pending = [];
    bytes = 0;
    await sink(chunk);
  };
  return {
    async write(chunk) {
      if (chunk.length >= size) {
        await flush();
        await sink(chunk);
        return;
      }
      pending.push(chunk);
      bytes += chunk.length;
      if (bytes >= size) await flush();
    },
    flush,
  };
}

/** Plain text wrapped at `width` (README.txt reads well in any editor, Notepad included). */
export function wrap(text: string, width = 96, indent = ''): string {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && indent.length + line.length + 1 + word.length > width) {
        lines.push(indent + line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(indent + line);
  }
  return lines.join('\n');
}
