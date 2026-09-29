import { EditorSelection, EditorState, SelectionRange, StateCommand } from '@codemirror/state';
import { KeyBinding } from '@codemirror/view';
import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  moveLineDown,
  moveLineUp,
} from '@codemirror/commands';
import { selectSelectionMatches } from '@codemirror/search';

/**
 * Sublime Text's editing keys, for the note editor.
 *
 * CodeMirror's default keymap already covers much of Sublime — Ctrl+L selects
 * the line, Ctrl+Shift+K deletes it, Ctrl+Enter opens a line below, Ctrl+D
 * adds the next occurrence, Ctrl+/ comments, Escape drops back to one cursor.
 * What it lacks, or binds differently, is here. Every command works on every
 * cursor at once, the way multiple selections do in Sublime.
 */

/** Ctrl+Shift+L: one selection per line of each multi-line selection. */
export const splitSelectionIntoLines: StateCommand = ({ state, dispatch }) => {
  const ranges: SelectionRange[] = [];
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from);
    const last = state.doc.lineAt(r.to);
    if (first.number === last.number) {
      ranges.push(r);
      continue;
    }
    for (let n = first.number; n <= last.number; n++) {
      const line = state.doc.line(n);
      const from = Math.max(line.from, r.from);
      const to = Math.min(line.to, r.to);
      // A selection ending at the very start of a line does not claim that line.
      if (n === last.number && to === line.from && from === to) continue;
      ranges.push(EditorSelection.range(from, to));
    }
  }
  if (ranges.length === state.selection.ranges.length) return false;
  dispatch(state.update({ selection: EditorSelection.create(ranges), scrollIntoView: true }));
  return true;
};

/**
 * Ctrl+J: joins the lines a selection spans — or the line below, for a bare
 * cursor — with a single space, dropping the next line's indentation.
 */
export const joinLines: StateCommand = ({ state, dispatch }) => {
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    let last = state.doc.lineAt(r.to).number;
    if (last === first) last = Math.min(first + 1, state.doc.lines);
    for (let n = first; n < last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const next = state.doc.line(n + 1);
      const indent = /^\s*/.exec(next.text)![0].length;
      const gap = line.text.endsWith(' ') || next.text.length === indent ? '' : ' ';
      changes.push({ from: line.to, to: next.from + indent, insert: gap });
    }
  }
  if (!changes.length) return false;
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input' }));
  return true;
};

/** Ctrl+Shift+Enter: a new line above each cursor, at the same indentation. */
export const insertLineAbove: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((r) => {
    const line = state.doc.lineAt(r.head);
    const indent = /^\s*/.exec(line.text)![0];
    return {
      changes: { from: line.from, insert: indent + state.lineBreak },
      range: EditorSelection.cursor(line.from + indent.length),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
  return true;
};

/**
 * Ctrl+Shift+D: a bare cursor duplicates its line, a selection duplicates
 * just the selected text right after itself — Sublime does both.
 */
export const duplicate: StateCommand = (target) => {
  const { state, dispatch } = target;
  if (state.selection.ranges.every((r) => r.empty)) return copyLineDown(target);
  const tr = state.changeByRange((r) => {
    if (r.empty) {
      const line = state.doc.lineAt(r.head);
      return {
        changes: { from: line.to, insert: state.lineBreak + line.text },
        range: EditorSelection.cursor(r.head + line.length + 1),
      };
    }
    const text = state.sliceDoc(r.from, r.to);
    return {
      changes: { from: r.to, insert: text },
      range: EditorSelection.range(r.to, r.to + text.length),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.copyline' }));
  return true;
};

/** How many lines and columns: "Line 12, Column 5" for the status bar. */
export function caretInfo(state: EditorState): { line: number; col: number; selections: number; selected: number } {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  let selected = 0;
  for (const r of state.selection.ranges) selected += r.to - r.from;
  return {
    line: line.number,
    col: main.head - line.from + 1,
    selections: state.selection.ranges.length,
    selected,
  };
}

export const sublimeKeymap: KeyBinding[] = [
  { key: 'Mod-Shift-l', run: splitSelectionIntoLines, preventDefault: true },
  { key: 'Mod-j', run: joinLines, preventDefault: true },
  { key: 'Mod-Shift-Enter', run: insertLineAbove, preventDefault: true },
  { key: 'Mod-Shift-d', run: duplicate, preventDefault: true },
  { key: 'Mod-Shift-ArrowUp', run: moveLineUp, preventDefault: true },
  { key: 'Mod-Shift-ArrowDown', run: moveLineDown, preventDefault: true },
  { key: 'Mod-Alt-ArrowUp', run: addCursorAbove, preventDefault: true },
  { key: 'Mod-Alt-ArrowDown', run: addCursorBelow, preventDefault: true },
  { key: 'Alt-F3', run: selectSelectionMatches, preventDefault: true },
];
