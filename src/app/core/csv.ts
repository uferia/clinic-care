/**
 * Minimal RFC 4180 CSV writing. Spreadsheet exports of clinic money data, so
 * correctness of quoting matters more than features: a patient name with a
 * comma must not shift every column after it.
 */

/** Quote when the value contains a delimiter, quote, or newline; double any inner quotes. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: readonly unknown[][]): string {
  // CRLF line endings: Excel treats a bare LF file as a single line on Windows.
  return [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

/**
 * Prompt a download of `content` as `filename`.
 *
 * The BOM is deliberate: without it Excel reads the file as the system's legacy
 * codepage, and a peso sign or an accented patient name arrives as mojibake.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
