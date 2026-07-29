import { syntaxTree } from '@codemirror/language';
import { EditorState, Range, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';

/**
 * Obsidian-style live preview for CodeMirror.
 *
 * The document stays plain markdown — nothing is rewritten. Formatting marks
 * are merely *hidden* on the lines the cursor is not on, so the text reads as
 * rendered prose while every editing operation (select all, cut, undo, caret
 * motion) keeps working on the real source underneath.
 */

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

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const isActive = active.has(line.number);

      if (fenced.has(line.number)) {
        marks.push(Decoration.line({ class: 'cm-code-line' }).range(line.from));
        pos = line.to + 1;
        continue;
      }

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

export const livePreview = ViewPlugin.fromClass(
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
