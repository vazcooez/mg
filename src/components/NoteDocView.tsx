import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NoteDoc, Workspace } from '../types';
import * as S from '../store';
import { extractHeadings, extractLinks, renderMarkdown, resolveImages, toggleTask } from '../markdown';
import MarkdownEditor from './MarkdownEditor';

export default function NoteDocView({
  ws,
  doc,
  paneId,
}: {
  ws: Workspace;
  doc: NoteDoc;
  paneId: string;
}) {
  const [outline, setOutline] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // A document created just now opens with its name selected, ready to type.
  useEffect(() => {
    if (!S.takeJustCreated(doc.id)) return;
    const el = titleRef.current;
    el?.focus();
    el?.select();
  }, [doc.id]);

  const editorRef = useRef<HTMLTextAreaElement>(null);

  const html = useMemo(
    () => (doc.view === 'markdown' ? resolveImages(renderMarkdown(doc.content), doc.path) : ''),
    [doc.content, doc.view, doc.path]
  );
  const headings = useMemo(() => extractHeadings(doc.content), [doc.content]);
  const links = useMemo(() => extractLinks(doc.content), [doc.content]);

  /** Wikilinks open the matching buffer or vault file, creating it when absent. */
  const openTarget = useCallback(
    (title: string) => {
      const open = S.findDocByTitle(ws, title);
      if (open) return void S.openDoc(open.id, paneId);
      const file = S.findFileByTitle(ws, title);
      if (file) return void S.openFile(file.rel, paneId);
      // Obsidian-style: following a missing link creates the note.
      const id = S.createNoteDoc(title, `# ${title}\n\n`, paneId);
      void S.saveDocAs(id, `${title.replace(/[\\/:*?"<>|]/g, '-')}.md`);
    },
    [ws, paneId]
  );

  const onPreviewClick = useCallback(
    (e: React.MouseEvent) => {
      const el = e.target as HTMLElement;

      const link = el.closest<HTMLElement>('a.wikilink');
      if (link) {
        e.preventDefault();
        openTarget(link.dataset.target ?? '');
        return;
      }
      if (el.closest('a.hashtag')) {
        e.preventDefault();
        return;
      }
      const anchor = el.closest<HTMLAnchorElement>('a[href]');
      if (anchor && /^https?:/i.test(anchor.getAttribute('href') ?? '')) {
        e.preventDefault();
        window.open(anchor.href, '_blank');
        return;
      }
      if (el instanceof HTMLInputElement && el.type === 'checkbox' && el.dataset.task != null) {
        e.preventDefault();
        S.setNoteContent(doc.id, toggleTask(doc.content, Number(el.dataset.task)));
      }
    },
    [doc.id, doc.content, openTarget]
  );

  /** Selects a place in the plain-text textarea and scrolls it into view. */
  const revealInTextarea = useCallback(
    (line: number, ch: number, length: number) => {
      const ta = editorRef.current;
      if (!ta) return;
      const before = doc.content.split('\n').slice(0, line - 1).join('\n');
      const pos = before.length + (line > 1 ? 1 : 0) + ch;
      ta.focus();
      ta.setSelectionRange(pos, pos + length);
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.scrollTop = Math.max(0, (line - 1) * lineHeight - ta.clientHeight / 3);
    },
    [doc.content]
  );

  // The markdown editor collects its own jump requests; the textarea needs help.
  useEffect(() => {
    if (doc.view !== 'plain') return;
    const take = () => {
      const target = S.takeReveal(doc.id);
      if (target) revealInTextarea(target.line, target.ch, target.length);
    };
    take();
    return S.onReveal((id) => {
      if (id === doc.id) take();
    });
  }, [doc.id, doc.view, revealInTextarea]);

  /** Jumps to a heading, `line` counted from 0 as the outline reports it. */
  const gotoLine = (line: number) => S.revealInDoc(doc.id, { line: line + 1, ch: 0, length: 0 });

  /** Tab inserts two spaces; Ctrl+B / Ctrl+I wrap the selection. */
  const onEditorKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const wrap = (marker: string) => {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value } = ta;
      const next = value.slice(0, a) + marker + value.slice(a, b) + marker + value.slice(b);
      S.setNoteContent(doc.id, next);
      requestAnimationFrame(() => {
        ta.selectionStart = a + marker.length;
        ta.selectionEnd = b + marker.length;
      });
    };
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value } = ta;
      const next = value.slice(0, a) + '  ' + value.slice(b);
      S.setNoteContent(doc.id, next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = a + 2;
      });
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') wrap('**');
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') wrap('*');
  };

  // Plain text keeps the bare textarea; markdown gets the real editor.
  const editor =
    doc.view === 'plain' ? (
      <textarea
        ref={editorRef}
        className="note-editor plain"
        value={doc.content}
        spellCheck={false}
        placeholder="Start typing…"
        onChange={(e) => S.setNoteContent(doc.id, e.target.value)}
        onKeyDown={onEditorKey}
      />
    ) : (
      <MarkdownEditor
        docId={doc.id}
        value={doc.content}
        livePreviewOn={doc.mdMode === 'live'}
        minimapOn={ws.settings.minimap}
        theme={ws.theme}
        path={doc.path}
        onChange={(next) => S.setNoteContent(doc.id, next)}
        onOpenLink={openTarget}
      />
    );

  /** Saves an image into the note's folder and inserts a markdown link. */
  const attachImage = useCallback(
    async (file: File) => {
      if (!window.api) return;
      const folder = doc.path ? doc.path.slice(0, doc.path.lastIndexOf('/') + 1) : '';
      const clean = (file.name || 'image.png').replace(/[\\/:*?"<>|]/g, '-');
      const wanted = `${folder}${clean}`;
      const unique = (await window.api.file.unique(wanted)).rel ?? wanted;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await window.api.file.writeBinary(unique, Array.from(bytes));
      if (!res.ok) return;
      const name = unique.split('/').pop() ?? unique;
      S.setNoteContent(doc.id, `${doc.content}${doc.content.endsWith('\n') || !doc.content ? '' : '\n'}\n![${name}](${encodeURI(name)})\n`);
      void S.refreshVault();
    },
    [doc.id, doc.content, doc.path]
  );

  const onDropFiles = useCallback(
    (e: React.DragEvent) => {
      const images = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!images.length) return;
      e.preventDefault();
      void (async () => {
        for (const f of images) await attachImage(f);
      })();
    },
    [attachImage]
  );

  const preview = (
    <div className="note-preview markdown-body" onClick={onPreviewClick}>
      {doc.content.trim() ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="preview-empty">Nothing to preview yet.</p>
      )}
    </div>
  );

  return (
    <div className="doc-view">
      <header className="doc-header">
        <input
          className="doc-title"
          ref={titleRef}
          value={doc.title}
          onChange={(e) => S.renameDoc(doc.id, e.target.value)}
          spellCheck={false}
          aria-label="Document title"
        />
        <div className="view-switch">
          <button
            type="button"
            className={doc.view === 'plain' ? 'on' : ''}
            onClick={() => S.setNoteView(doc.id, 'plain')}
            title="Ctrl+Alt+3"
          >
            Plain text
          </button>
          <button
            type="button"
            className={doc.view === 'markdown' ? 'on' : ''}
            onClick={() => S.setNoteView(doc.id, 'markdown')}
            title="Ctrl+Alt+4"
          >
            Markdown
          </button>
        </div>

        {doc.view === 'markdown' && (
          <div className="view-switch small">
            {(
              [
                ['live', 'Live'],
                ['edit', 'Source'],
                ['split', 'Split'],
                ['preview', 'Preview'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={doc.mdMode === mode ? 'on' : ''}
                onClick={() => S.setMdMode(doc.id, mode)}
                title={
                  mode === 'live'
                    ? 'Live preview — only the block with the caret shows markdown source'
                    : undefined
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className={`icon-btn${outline ? ' on' : ''}`}
          title="Toggle outline"
          onClick={() => setOutline((v) => !v)}
        >
          ☰
        </button>
      </header>

      <div className="doc-body">
        <div
          className="doc-main note-main"
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
          }}
          onDrop={onDropFiles}
        >
          {doc.view === 'plain' ? (
            editor
          ) : doc.mdMode === 'live' || doc.mdMode === 'edit' ? (
            editor
          ) : doc.mdMode === 'preview' ? (
            preview
          ) : (
            <div className="note-split">
              {editor}
              <div className="note-split-divider" />
              {preview}
            </div>
          )}
        </div>

        {outline && (
          <aside className="inspector outline">
            <div className="inspector-head">
              <span>Outline</span>
              <button type="button" className="icon-btn" onClick={() => setOutline(false)}>
                ⟩
              </button>
            </div>
            <div className="inspector-body">
              <div className="field">
                <label>Headings</label>
                {headings.length ? (
                  headings.map((h, i) => (
                    <button
                      key={i}
                      type="button"
                      className="outline-row"
                      style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                      onClick={() => gotoLine(h.line)}
                    >
                      <span className="outline-level">H{h.level}</span>
                      {h.text}
                    </button>
                  ))
                ) : (
                  <div className="props-empty">No headings.</div>
                )}
              </div>
              <div className="field">
                <label>Links</label>
                {links.length ? (
                  links.map((l) => {
                    const exists = Boolean(S.findDocByTitle(ws, l) || S.findFileByTitle(ws, l));
                    return (
                      <button
                        key={l}
                        type="button"
                        className={`outline-row link${exists ? '' : ' missing'}`}
                        onClick={() => openTarget(l)}
                      >
                        [[{l}]]
                        {!exists && <span className="outline-level">new</span>}
                      </button>
                    );
                  })
                ) : (
                  <div className="props-empty">No wikilinks.</div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
