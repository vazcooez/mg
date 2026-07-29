import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, rectangularSelection } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  standardKeymap,
} from '@codemirror/commands';
import { markdown, markdownLanguage, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { indentUnit, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { livePreview } from '../editor/livePreview';

/**
 * A real text editor for notes, built on CodeMirror.
 *
 * The block-renderer this replaces could not support select-all-then-delete,
 * caret motion across blocks, or clicking below the text — those are properties
 * of a genuine editor, not something a set of rendered divs can be patched into.
 */

const highlight = HighlightStyle.define([
  { tag: tags.heading1, class: 'cm-h1-tok' },
  { tag: tags.heading2, class: 'cm-h2-tok' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, class: 'cm-mono-tok' },
  { tag: tags.link, class: 'cm-link-tok' },
  { tag: tags.url, class: 'cm-url-tok' },
  { tag: tags.quote, class: 'cm-quote-tok' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-scroller': {
    fontFamily: 'var(--editor-font)',
    fontSize: 'var(--editor-font-size)',
    lineHeight: '1.7',
    padding: '18px 0 40vh',
  },
  '.cm-content': { maxWidth: '46rem', margin: '0 auto', padding: '0 28px', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--sel) 18%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 34%, transparent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '2px' },
  '.cm-gutters': { display: 'none' },
});

export default function MarkdownEditor({
  value,
  livePreviewOn,
  onChange,
  onOpenLink,
}: {
  value: string;
  livePreviewOn: boolean;
  onChange: (next: string) => void;
  onOpenLink: (target: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const preview = useRef(new Compartment());
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
        drawSelection(),
        rectangularSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        indentUnit.of('  '),
        markdown({ base: markdownLanguage, addKeymap: false }),
        syntaxHighlighting(highlight),
        preview.current.of(livePreviewOn ? livePreview : []),
        keymap.of([
          // Enter continues lists and quotes; Tab indents them.
          { key: 'Enter', run: insertNewlineContinueMarkup },
          { key: 'Tab', run: indentMore, shift: indentLess },
          ...standardKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
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
    return () => {
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
      effects: preview.current.reconfigure(livePreviewOn ? livePreview : []),
    });
  }, [livePreviewOn]);

  return <div className="cm-host" ref={host} />;
}
