import { syntaxTree } from '@codemirror/language';
import { EditorState, Extension, Facet, Range, RangeSetBuilder, StateField } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
} from '@codemirror/view';
import { renderInline } from '../markdown';
import { Align, alignments, cellSpans, isDelimiterRow, tableCells } from './table';
import { resolveVaultRef } from '../types';

/**
 * Obsidian-style live preview for CodeMirror.
 *
 * The document stays plain markdown — nothing is rewritten. Formatting marks
 * are merely *hidden* on the lines the cursor is not on, so the text reads as
 * rendered prose while every editing operation (select all, cut, undo, caret
 * motion) keeps working on the real source underneath.
 */

/**
 * The note's own vault path, so relative image links can be resolved. Notes
 * that have never been saved have no path and fall back to the vault root.
 */
export const notePath = Facet.define<string | null, string | null>({
  combine: (values) => values[0] ?? null,
});

/** Lines touched by the cursor or selection keep their markup visible. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let n = from; n <= to; n++) lines.add(n);
  }
  return lines;
}

const hidden = Decoration.replace({});

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-task';
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // Flip the marker in the source; the decoration follows from that.
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? ' ' : 'x' },
      });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class LinkWidget extends WidgetType {
  constructor(readonly label: string, readonly target: string, readonly kind: 'wiki' | 'tag') {
    super();
  }
  eq(other: LinkWidget) {
    return other.label === this.label && other.target === this.target && other.kind === this.kind;
  }
  toDOM() {
    const a = document.createElement('span');
    a.className = this.kind === 'wiki' ? 'cm-wikilink' : 'cm-hashtag';
    a.textContent = this.label;
    a.dataset.target = this.target;
    return a;
  }
  ignoreEvent() {
    return false;
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly pos: number) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-image';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.title = this.alt;
    wrap.appendChild(img);
    // Like the table below, a replaced range holds no cursor position of its
    // own — without this a click on the picture leaves the caret elsewhere.
    wrap.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.pos }, scrollIntoView: false });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/** One rendered row and where its source line starts in the document. */
interface TableRow {
  text: string;
  from: number;
}

class TableWidget extends WidgetType {
  constructor(readonly rows: TableRow[], readonly aligns: Align[]) {
    super();
  }
  eq(other: TableWidget) {
    return (
      other.rows.length === this.rows.length &&
      other.rows.every((r, i) => r.text === this.rows[i].text && r.from === this.rows[i].from) &&
      other.aligns.join() === this.aligns.join()
    );
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-table-wrap';
    const table = document.createElement('table');
    table.className = 'cm-table';
    const head = document.createElement('thead');
    const body = document.createElement('tbody');
    this.rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      const spans = cellSpans(row.text);
      tableCells(row.text).forEach((cell, col) => {
        const td = document.createElement(index === 0 ? 'th' : 'td');
        td.innerHTML = renderInline(cell);
        const align = this.aligns[col];
        if (align) td.style.textAlign = align;
        // Remember where this cell's text lives so a click can land there.
        td.dataset.pos = String(row.from + (spans[col]?.from ?? 0));
        tr.appendChild(td);
      });
      (index === 0 ? head : body).appendChild(tr);
    });
    table.appendChild(head);
    table.appendChild(body);
    wrap.appendChild(table);

    // A replaced range has no cursor positions of its own, so clicking the
    // rendered table would otherwise leave the caret wherever it was and type
    // into the wrong place. Put it in the source cell instead; the block then
    // shows its markdown, because the caret line is live again.
    wrap.addEventListener('mousedown', (event) => {
      const cell = (event.target as HTMLElement).closest<HTMLElement>('td, th');
      const pos = Number(cell?.dataset.pos ?? this.rows[0]?.from ?? 0);
      event.preventDefault();
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/** Every pipe-table in the document: a header row, its delimiter, its body. */
function tableBlocks(state: EditorState): Array<{ start: number; delim: number; end: number }> {
  const doc = state.doc;
  const blocks: Array<{ start: number; delim: number; end: number }> = [];
  for (let n = 1; n < doc.lines; n++) {
    if (!doc.line(n).text.includes('|')) continue;
    if (!isDelimiterRow(doc.line(n + 1).text)) continue;
    let end = n + 1;
    while (end < doc.lines) {
      const next = doc.line(end + 1).text;
      if (!next.trim() || !next.includes('|')) break;
      end++;
    }
    blocks.push({ start: n, delim: n + 1, end });
    n = end;
  }
  return blocks;
}

/**
 * Tables are the one construct that cannot be shown by hiding markup — the grid
 * only exists once the rows are laid out together, so the whole block is swapped
 * for a rendered table unless the caret is inside it.
 *
 * This lives in a state field rather than the view plugin below because
 * CodeMirror only accepts block-level decorations from the state.
 */
function buildTables(state: EditorState): DecorationSet {
  const active = activeLines(state);
  const marks: Range<Decoration>[] = [];
  for (const block of tableBlocks(state)) {
    const editing = [...active].some((n) => n >= block.start && n <= block.end);
    if (editing) {
      for (let n = block.start; n <= block.end; n++) {
        marks.push(Decoration.line({ class: 'cm-table-source' }).range(state.doc.line(n).from));
      }
      continue;
    }
    const line = (n: number) => ({ text: state.doc.line(n).text, from: state.doc.line(n).from });
    const rows = [line(block.start)];
    for (let n = block.delim + 1; n <= block.end; n++) rows.push(line(n));
    marks.push(
      Decoration.replace({
        widget: new TableWidget(rows, alignments(state.doc.line(block.delim).text)),
        block: true,
      }).range(state.doc.line(block.start).from, state.doc.line(block.end).to)
    );
  }
  return Decoration.set(marks, true);
}

const tableField = StateField.define<DecorationSet>({
  create: buildTables,
  update: (deco, tr) => (tr.docChanged || tr.selection ? buildTables(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

const HEADING = /^(#{1,6})\s/;
const QUOTE = /^\s*>\s?/;
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

/** Inline spans handled by regex — cheap and independent of the syntax tree. */
const INLINE: Array<{ re: RegExp; cls: string; marks: [number, number] }> = [
  { re: /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, cls: 'cm-strong', marks: [2, 2] },
  { re: /(?<![*\w])(\*)(?=\S)([^*\n]*?\S)\1(?!\*)/g, cls: 'cm-em', marks: [1, 1] },
  { re: /(==)(?=\S)([\s\S]*?\S)\1/g, cls: 'cm-mark', marks: [2, 2] },
  { re: /(~~)(?=\S)([\s\S]*?\S)\1/g, cls: 'cm-strike', marks: [2, 2] },
  { re: /(`)([^`\n]+)\1/g, cls: 'cm-inline-code', marks: [1, 1] },
];

function buildDecorations(view: EditorView): DecorationSet {
  const active = activeLines(view.state);
  const marks: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);

  // Fenced code gets a block treatment and no inline processing.
  const fenced = new Set<number>();
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return;
      const from = view.state.doc.lineAt(node.from).number;
      const to = view.state.doc.lineAt(node.to).number;
      for (let n = from; n <= to; n++) fenced.add(n);
    },
  });

  const base = view.state.facet(notePath);
  const doc = view.state.doc;

  const inTable = new Set<number>();
  for (const b of tableBlocks(view.state)) {
    for (let n = b.start; n <= b.end; n++) inTable.add(n);
  }

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const text = line.text;
      const isActive = active.has(line.number);

      if (fenced.has(line.number)) {
        marks.push(Decoration.line({ class: 'cm-code-line' }).range(line.from));
        pos = line.to + 1;
        continue;
      }

      // Table rows are owned by the state field above; leave them alone.
      if (inTable.has(line.number)) {
        pos = line.to + 1;
        continue;
      }

      // Embedded images render inline; the link text stays when editing it.
      const images: Array<[number, number]> = [];
      if (!isActive) {
        for (const m of text.matchAll(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g)) {
          const start = line.from + m.index!;
          images.push([start, start + m[0].length]);
          const raw = m[2].trim().replace(/\s+"[^"]*"$/, '');
          const src = /^(https?:|data:|blob:|mg-vault:)/i.test(raw)
            ? raw
            : resolveVaultRef(base, decodeURI(raw));
          marks.push(
            Decoration.replace({ widget: new ImageWidget(src, m[1], start) }).range(
              start,
              start + m[0].length
            )
          );
        }
      }

      /** A replaced image owns its whole span; nothing may decorate inside it. */
      const inImage = (at: number) => images.some(([a, b]) => at >= a && at < b);

      // Headings: size the line, hide the leading hashes when inactive.
      const heading = HEADING.exec(text);
      if (heading) {
        marks.push(Decoration.line({ class: `cm-heading cm-h${heading[1].length}` }).range(line.from));
        if (!isActive) {
          marks.push(hidden.range(line.from, line.from + heading[1].length + 1));
        }
      }

      if (QUOTE.test(text)) {
        marks.push(Decoration.line({ class: 'cm-quote-line' }).range(line.from));
      }

      if (HR.test(text) && text.trim()) {
        marks.push(Decoration.line({ class: 'cm-hr-line' }).range(line.from));
      }

      // Task checkboxes become real checkboxes.
      const task = TASK.exec(text);
      if (task) {
        const at = line.from + task[1].length;
        marks.push(
          Decoration.replace({
            widget: new CheckboxWidget(task[2].toLowerCase() === 'x', at),
          }).range(at - 1, at + 2)
        );
        if (task[2].toLowerCase() === 'x') {
          marks.push(Decoration.line({ class: 'cm-task-done' }).range(line.from));
        }
      }

      // Wikilinks and tags render as chips unless the cursor is on the line.
      for (const m of text.matchAll(/!?\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g)) {
        const start = line.from + m.index!;
        if (isActive) continue;
        marks.push(
          Decoration.replace({
            widget: new LinkWidget((m[2] ?? m[1]).trim(), m[1].trim(), 'wiki'),
          }).range(start, start + m[0].length)
        );
      }
      for (const m of text.matchAll(/(^|\s)(#[A-Za-z0-9_\-/]*[A-Za-z][A-Za-z0-9_\-/]*)/g)) {
        const start = line.from + m.index! + m[1].length;
        marks.push(
          Decoration.mark({ class: 'cm-hashtag-inline' }).range(start, start + m[2].length)
        );
      }

      // Inline emphasis: style the span, hide its delimiters when inactive.
      for (const rule of INLINE) {
        rule.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = rule.re.exec(text))) {
          const start = line.from + m.index;
          const end = start + m[0].length;
          if (inImage(start)) continue;
          marks.push(Decoration.mark({ class: rule.cls }).range(start, end));
          if (!isActive) {
            marks.push(hidden.range(start, start + rule.marks[0]));
            marks.push(hidden.range(end - rule.marks[1], end));
          }
        }
      }

      // Markdown links: show the label, hide the target when inactive.
      for (const m of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
        const start = line.from + m.index!;
        if (inImage(start) || inImage(start - 1)) continue;
        marks.push(
          Decoration.mark({ class: 'cm-link', attributes: { 'data-href': m[2] } }).range(
            start + 1,
            start + 1 + m[1].length
          )
        );
        if (!isActive) {
          marks.push(hidden.range(start, start + 1));
          marks.push(hidden.range(start + 1 + m[1].length, start + m[0].length));
        }
      }

      pos = line.to + 1;
    }
  }

  // RangeSetBuilder demands sorted input; decorations were gathered per rule.
  marks.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const m of marks) builder.add(m.from, m.to, m.value);
  return builder.finish();
}

/**
 * A rendered table is one block as far as the editor is concerned, so plain
 * vertical motion jumps clean over it — you could never reach its rows with the
 * keyboard. Stepping onto a table opens it and lands on the nearest row,
 * keeping the column, which is what moving line by line ought to feel like.
 */
function stepIntoTable(dir: 1 | -1) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty) return false;
    const line = state.doc.lineAt(range.head);
    const target = line.number + dir;
    if (target < 1 || target > state.doc.lines) return false;

    const inside = (n: number, b: { start: number; end: number }) => n >= b.start && n <= b.end;
    const block = tableBlocks(state).find((b) => inside(target, b));
    // Already inside that table? Then ordinary line motion is already correct.
    if (!block || inside(line.number, block)) return false;

    const row = state.doc.line(dir === 1 ? block.start : block.end);
    const column = range.head - line.from;
    view.dispatch({
      selection: { anchor: Math.min(row.from + column, row.to) },
      scrollIntoView: true,
    });
    return true;
  };
}

const tableMotion = keymap.of([
  { key: 'ArrowDown', run: stepIntoTable(1) },
  { key: 'ArrowUp', run: stepIntoTable(-1) },
]);

const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

export const livePreview: Extension = [tableField, tableMotion, inlinePreview];
