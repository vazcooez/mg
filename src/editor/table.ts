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

/**
 * Where each cell's text sits within the raw row, so a click on a rendered cell
 * can be mapped back to the source. Ranges cover the trimmed text only, not the
 * padding around it.
 */
export function cellSpans(text: string): Array<{ from: number; to: number }> {
  const bars: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '|' && text[i - 1] !== '\\') bars.push(i);
  }
  if (!bars.length) return [{ from: 0, to: text.length }];

  const segments: Array<{ from: number; to: number }> = [];
  const first = { from: 0, to: bars[0] };
  // A leading pipe is decoration, not an empty first column.
  if (first.to > first.from && text.slice(first.from, first.to).trim()) segments.push(first);
  for (let i = 0; i < bars.length - 1; i++) segments.push({ from: bars[i] + 1, to: bars[i + 1] });
  const last = { from: bars[bars.length - 1] + 1, to: text.length };
  if (text.slice(last.from, last.to).trim()) segments.push(last);

  return segments.map(({ from, to }) => {
    let a = from;
    let b = to;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    return { from: a, to: b };
  });
}

/** Splits a row on unescaped pipes, dropping the optional outer ones. */
export function tableCells(text: string): string[] {
  return cellSpans(text).map((s) => text.slice(s.from, s.to).replace(/\\\|/g, '|'));
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
