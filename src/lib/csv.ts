/** One CSV cell's value: empty for null. */
export type CsvCell = string | number | null;

/** The byte order mark that makes spreadsheet apps read a CSV file as UTF-8. */
export const CSV_BOM = '﻿';

/**
 * One row as a CSV line (RFC 4180), without its line end. A cell that a spreadsheet would run as a
 * formula (it starts with =, +, -, @, a tab or a carriage return: learners' text can) is kept as
 * text with a leading apostrophe.
 */
export function csvLine(row: CsvCell[]): string {
  const cell = (value: CsvCell) => {
    let text = value === null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return row.map(cell).join(',');
}

/**
 * Rows as CSV (RFC 4180, CRLF line ends), with a byte order mark so spreadsheet apps read it as
 * UTF-8. Cells as `csvLine` writes them.
 */
export function toCsv(rows: CsvCell[][]): string {
  return `${CSV_BOM}${rows.map(csvLine).join('\r\n')}\r\n`;
}
