import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  standardKeymap,
} from '@codemirror/commands';
import { markdown, markdownLanguage, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { bracketMatching, indentUnit, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { livePreview, notePath } from '../editor/livePreview';
import { noteFolding } from '../editor/folding';
import { findPanel, openReplacePanel } from '../editor/searchPanel';
import { caretInfo, sublimeKeymap } from '../editor/sublimeKeys';
import { minimap } from '../editor/minimap';
import * as S from '../store';

/**
 * A real text editor for notes, built on CodeMirror.
 *
 * The block-renderer this replaces could not support select-all-then-delete,
 * caret motion across blocks, or clicking below the text — those are properties
 * of a genuine editor, not something a set of rendered divs can be patched into.
 */

/**
 * Markdown in Mariana, Sublime Text's default scheme. The colours are theme
 * tokens (`--syn-*` in styles.css), so light mode gets its own readable set.
 */
const highlight = HighlightStyle.define([
  // A rule with a `class` takes only the class, never its inline style — so
  // styled rules carry no class, and classed ones are coloured in styles.css.
  { tag: tags.heading, color: 'var(--syn-heading)', fontWeight: '700' },
  { tag: tags.processingInstruction, color: 'var(--syn-punct)' },
  { tag: tags.contentSeparator, color: 'var(--syn-punct)' },
  { tag: tags.strong, color: 'var(--syn-bold)', fontWeight: '700' },
  { tag: tags.emphasis, color: 'var(--syn-italic)', fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, class: 'cm-mono-tok' },
  { tag: tags.link, class: 'cm-link-tok' },
  { tag: tags.url, class: 'cm-url-tok' },
  { tag: tags.quote, color: 'var(--syn-quote)', fontStyle: 'italic' },
  { tag: tags.comment, color: 'var(--syn-quote)', fontStyle: 'italic' },
  { tag: [tags.labelName, tags.string], color: 'var(--syn-link)' },
]);

/**
 * Source mode is where a note is edited as text, so it gets what a text
 * editor has: line numbers, and the text starting beside them rather than in
 * the middle of the pane.
 */
const sourceMode = [
  lineNumbers(),
  highlightActiveLineGutter(),
  EditorView.editorAttributes.of({ class: 'cm-source-mode' }),
];

/**
 * Ctrl+G is Goto Line, as in Sublime, rather than CodeMirror's "find next"
 * (F3 still does that); the window catches it on the way out.
 */
const noteSearchKeymap = searchKeymap.filter((b) => b.key !== 'Mod-g');

/**
 * CodeMirror ships light and dark selection defaults behind `&light`/`&dark`
 * class selectors, which are more specific than a plain `.cm-selectionBackground`
 * rule — so the overrides below deliberately match that specificity (they win on
 * source order), and the theme is told which mode it is in so the right default
 * is the one being overridden in the first place.
 */
function buildTheme(dark: boolean) {
  const selection = 'color-mix(in srgb, var(--accent) 30%, transparent)';
  const selectionFocused = 'color-mix(in srgb, var(--accent) 42%, transparent)';
  return EditorView.theme(
    {
      '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)' },
      '.cm-scroller': {
        fontFamily: 'var(--editor-font)',
        fontSize: 'var(--editor-font-size)',
        lineHeight: '1.7',
        padding: '18px 0 40vh',
      },
      '.cm-content': {
        margin: '0 auto',
        padding: '0 28px',
        caretColor: 'var(--text)',
        // Readable width by default; Settings can let a note use the whole pane.
        maxWidth: 'var(--note-max-width)',
      },
      '.cm-line': { padding: '0 2px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--sel) 16%, transparent)' },

      // Unfocused and focused selection, each at 3-class specificity.
      '&.cm-editor .cm-selectionBackground': { backgroundColor: selection },
      '&.cm-focused .cm-selectionBackground': { backgroundColor: selectionFocused },
      // Native selection still shows through inside widgets and rendered spans.
      '&.cm-editor .cm-content ::selection': { backgroundColor: selectionFocused },
      '&.cm-editor .cm-line::selection': { backgroundColor: selectionFocused },

      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--caret)', borderLeftWidth: '2px' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        border: 'none',
        color: 'var(--gutter-text)',
        paddingLeft: '6px',
      },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 8px', minWidth: '28px' },
      '&.cm-focused .cm-matchingBracket': {
        backgroundColor: 'transparent',
        outline: '1px solid color-mix(in srgb, var(--text) 45%, transparent)',
      },
      '.cm-panels': { backgroundColor: 'var(--chrome)', color: 'var(--text)' },
      '.cm-panels-top': { borderBottom: '1px solid var(--line)' },
      '.cm-searchMatch': {
        backgroundColor: 'color-mix(in srgb, var(--warn) 35%, transparent)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, var(--warn) 60%, transparent)',
      },
    },
    { dark }
  );
}

export default function MarkdownEditor({
  docId,
  value,
  livePreviewOn,
  minimapOn,
  theme,
  path,
  onChange,
  onOpenLink,
}: {
  /** The buffer being edited, so a jump to a line can find this editor. */
  docId: string;
  value: string;
  livePreviewOn: boolean;
  minimapOn: boolean;
  theme: 'dark' | 'light';
  /** The note's vault path, used to resolve relative image links. */
  path: string | null;
  onChange: (next: string) => void;
  onOpenLink: (target: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const preview = useRef(new Compartment());
  const pathComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const sourceComp = useRef(new Compartment());
  const minimapComp = useRef(new Compartment());
  // Kept in refs so the editor is created once and never torn down mid-typing.
  const onChangeRef = useRef(onChange);
  const onOpenRef = useRef(onOpenLink);
  onChangeRef.current = onChange;
  onOpenRef.current = onOpenLink;

  useEffect(() => {
    if (!host.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        // Multiple cursors, Sublime's defining feature: Ctrl+D, Ctrl+click,
        // Ctrl+Shift+L and Alt+drag all need the editor to hold more than one.
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        bracketMatching(),
        closeBrackets(),
        EditorView.lineWrapping,
        indentUnit.of('  '),
        markdown({ base: markdownLanguage, addKeymap: false }),
        syntaxHighlighting(highlight),
        sourceComp.current.of(livePreviewOn ? [] : sourceMode),
        minimapComp.current.of(minimapOn ? minimap : []),
        // Folding is an editing feature, not a rendering one, so it is outside
        // the live-preview compartment: sections collapse in Source mode too.
        noteFolding,
        findPanel,
        pathComp.current.of(notePath.of(path)),
        preview.current.of(livePreviewOn ? livePreview : []),
        keymap.of([
          // Enter continues lists and quotes; Tab indents them.
          { key: 'Enter', run: insertNewlineContinueMarkup },
          { key: 'Tab', run: indentMore, shift: indentLess },
          { key: 'Mod-h', run: openReplacePanel, preventDefault: true },
          ...sublimeKeymap,
          ...closeBracketsKeymap,
          ...standardKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...noteSearchKeymap,
        ]),
        themeComp.current.of(buildTheme(theme === 'dark')),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          // The status bar follows whichever note has the caret.
          if (u.view.hasFocus && (u.selectionSet || u.docChanged || u.focusChanged)) {
            S.setCaret({ docId, ...caretInfo(u.state) });
          }
        }),
        EditorView.domEventHandlers({
          mousedown(event) {
            const el = event.target as HTMLElement;
            const wiki = el.closest<HTMLElement>('.cm-wikilink');
            if (wiki) {
              event.preventDefault();
              onOpenRef.current(wiki.dataset.target ?? '');
              return true;
            }
            const link = el.closest<HTMLElement>('.cm-link');
            const href = link?.dataset.href;
            if (href && /^https?:/i.test(href)) {
              event.preventDefault();
              window.open(href, '_blank');
              return true;
            }
            return false;
          },
        }),
      ],
    });

    const v = new EditorView({ state, parent: host.current });
    view.current = v;

    // Search results and the outline ask for a line; the request may arrive
    // before this editor exists (the file was still opening), so it is also
    // collected once on mount.
    const reveal = () => {
      const target = S.takeReveal(docId);
      if (!target) return;
      const { doc } = v.state;
      const line = doc.line(Math.min(Math.max(1, target.line), doc.lines));
      const anchor = Math.min(line.from + target.ch, line.to);
      const head = Math.min(anchor + target.length, line.to);
      v.dispatch({
        selection: { anchor, head },
        effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
      });
      v.focus();
    };
    const frame = requestAnimationFrame(reveal);
    const unsubscribe = S.onReveal((id) => {
      if (id === docId) reveal();
    });

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      v.destroy();
      view.current = null;
    };
    // Created once: `value` is reconciled below rather than rebuilding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External changes (revert, reload from disk, undo) flow in without
  // disturbing the caret while the user is the one typing.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === value) return;
    v.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(v.state.selection.main.anchor, value.length) },
    });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: [
        preview.current.reconfigure(livePreviewOn ? livePreview : []),
        sourceComp.current.reconfigure(livePreviewOn ? [] : sourceMode),
      ],
    });
  }, [livePreviewOn]);

  useEffect(() => {
    view.current?.dispatch({ effects: minimapComp.current.reconfigure(minimapOn ? minimap : []) });
  }, [minimapOn]);

  // Saving a note for the first time gives it a path; images resolve from then on.
  useEffect(() => {
    view.current?.dispatch({ effects: pathComp.current.reconfigure(notePath.of(path)) });
  }, [path]);

  // Switching light/dark re-themes the editor in place.
  useEffect(() => {
    view.current?.dispatch({
      effects: themeComp.current.reconfigure(buildTheme(theme === 'dark')),
    });
  }, [theme]);

  return <div className="cm-host" ref={host} />;
}
