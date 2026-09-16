import {
  codeFolding,
  foldEffect,
  foldKeymap,
  foldService,
  foldedRanges,
  syntaxTree,
  unfoldEffect,
} from '@codemirror/language';
import { EditorState, Extension, Range } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
} from '@codemirror/view';

/**
 * Heading folding for notes.
 *
 * A heading owns everything below it up to the next heading of the same or
 * higher rank, so collapsing `## Design` takes its prose and its `###`
 * subsections with it but stops at the next `##`. Nothing is rewritten: a fold
 * is view state like the rest of live preview, so the buffer never goes dirty
 * and a folded note saves exactly as it reads.
 */

const HEADING = /^(#{1,6})\s/;

/** 1–6 for a heading line, 0 for anything else. */
function headingLevel(text: string): number {
  return HEADING.exec(text)?.[1].length ?? 0;
}

/** `# comment` inside a fence is code, not a heading, and must not fold. */
function inCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1);
  for (;;) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
    const parent = node.parent;
    if (!parent) return false;
    node = parent;
  }
}

/**
 * What a heading hides when it collapses: everything from the end of its own
 * line to the end of its section. The heading itself always stays visible —
 * a collapsed section you cannot see the title of would be unreachable.
 */
function section(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const doc = state.doc;
  const line = doc.lineAt(lineStart);
  const level = headingLevel(line.text);
  if (!level || inCode(state, line.from)) return null;

  let to = line.to;
  for (let n = line.number + 1; n <= doc.lines; n++) {
    const next = doc.line(n);
    const rank = headingLevel(next.text);
    if (rank && rank <= level && !inCode(state, next.from)) break;
    to = next.to;
  }
  // A heading with nothing under it has nothing to collapse.
  return to > line.to ? { from: line.to, to } : null;
}

/** The fold starting exactly here, if this section is currently collapsed. */
function foldedAt(state: EditorState, from: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  foldedRanges(state).between(from, from, (a, b) => {
    if (a !== from) return undefined;
    found = { from: a, to: b };
    return false;
  });
  return found;
}

/** Collapses the section headed by this line, or expands it if it is folded. */
function toggleSection(view: EditorView, lineStart: number): boolean {
  const range = section(view.state, lineStart);
  if (!range) return false;
  const folded = foldedAt(view.state, range.from);
  view.dispatch({ effects: folded ? unfoldEffect.of(folded) : foldEffect.of(range) });
  return true;
}

/**
 * The disclosure arrow. It lives in the editor's left padding rather than in a
 * gutter, so collapsing a section never shifts the heading text sideways, and
 * it only shows on hover unless the section is folded — a collapsed heading has
 * to advertise itself.
 */
class FoldArrow extends WidgetType {
  constructor(readonly lineStart: number, readonly folded: boolean) {
    super();
  }
  eq(other: FoldArrow) {
    return other.lineStart === this.lineStart && other.folded === this.folded;
  }
  toDOM(view: EditorView) {
    const arrow = document.createElement('span');
    arrow.className = `cm-fold-arrow${this.folded ? ' cm-folded' : ''}`;
    arrow.textContent = this.folded ? '▸' : '▾';
    arrow.title = this.folded ? 'Expand section' : 'Collapse section';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.addEventListener('mousedown', (event) => {
      // Without this the click would also drop the caret into the heading.
      event.preventDefault();
      toggleSection(view, this.lineStart);
    });
    return arrow;
  }
  ignoreEvent() {
    return true;
  }
}

function foldArrows(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const range = section(view.state, line.from);
      if (range) {
        marks.push(Decoration.line({ class: 'cm-fold-head' }).range(line.from));
        marks.push(
          Decoration.widget({
            widget: new FoldArrow(line.from, Boolean(foldedAt(view.state, range.from))),
            side: -1,
          }).range(line.from)
        );
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(marks, true);
}

const arrowPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = foldArrows(view);
    }
    update(update: ViewUpdate) {
      // Folding changes which lines exist on screen, and an arrow has to flip
      // the moment its own section collapses.
      if (
        update.docChanged ||
        update.viewportChanged ||
        foldedRanges(update.startState) !== foldedRanges(update.state)
      ) {
        this.decorations = foldArrows(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

/** Marks the spot a folded section used to occupy; clicking it expands again. */
function placeholder(_view: EditorView, onclick: (event: Event) => void): HTMLElement {
  const span = document.createElement('span');
  span.className = 'cm-fold-placeholder';
  span.textContent = '⋯';
  span.title = 'Expand section';
  span.addEventListener('click', onclick);
  return span;
}

export const noteFolding: Extension = [
  foldService.of((state, lineStart) => section(state, lineStart)),
  codeFolding({ placeholderDOM: placeholder }),
  arrowPlugin,
  keymap.of(foldKeymap),
];
