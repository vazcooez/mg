/**
 * Markdown pipe-table parsing.
 *
 * Kept apart from the live-preview plugin because it is pure text work: the
 * plugin decides *when* a table is rendered, this decides *what* it contains.
 */

export type Align = 'left' | 'center' | 'right' | null;

/** `| --- | :--: |` — the row that turns the lines around it into a table. */
const DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

export function isDelimiterRow(text: string): boolean {
  return text.includes('-') && DELIMITER.test(text);
}

/** Splits a row on unescaped pipes, dropping the optional outer ones. */
export function tableCells(text: string): string[] {
  let s = text.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (/(?<!\\)\|$/.test(s)) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** Column alignments taken from the colons in the delimiter row. */
export function alignments(delimiter: string): Align[] {
  return tableCells(delimiter).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}
