import { useRef, useState } from 'react';
import { Pane, Workspace } from '../types';
import * as S from '../store';
import ContextMenu, { MenuState } from './ContextMenu';
import DocIcon from './DocIcon';

/** Shared across strips so a tab can be dragged from one pane into another. */
const dragRef: { value: { paneId: string; docId: string } | null } = { value: null };

export function setDraggedTab(v: { paneId: string; docId: string } | null) {
  dragRef.value = v;
}
export function getDraggedTab() {
  return dragRef.value;
}

export default function TabStrip({
  ws,
  pane,
  index,
}: {
  ws: Workspace;
  pane: Pane;
  index: number;
}) {
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const docs = pane.tabs
    .map((id) => ws.docs.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  const tabMenu = (docId: string, x: number, y: number): MenuState => {
    const others = ws.layout.panes.filter((p) => p.id !== pane.id);
    const doc = ws.docs.find((d) => d.id === docId);
    return {
      x,
      y,
      entries: [
        { label: 'Save', detail: 'Ctrl+S', run: () => void S.saveDoc(docId) },
        { label: 'Save As…', detail: 'Ctrl+Shift+S', run: () => void S.saveDocAsPrompt(docId) },
        {
          label: 'Revert to Saved',
          disabled: !doc?.path || !doc || !S.isDirty(doc),
          run: () => void S.revertDoc(docId),
        },
        { separator: true },
        { label: 'Close Tab', detail: 'Ctrl+W', run: () => void S.requestCloseTab(pane.id, docId) },
        { label: 'Close Other Tabs', run: () => void S.closeOtherTabs(pane.id, docId) },
        { label: 'Close Tabs to the Right', run: () => void S.closeTabsToRight(pane.id, docId) },
        { label: 'Close All Tabs', run: () => void S.closeAllTabs(pane.id) },
        { separator: true },
        ...others.map((p, i) => ({
          label: `Move to Group ${ws.layout.panes.indexOf(p) + 1}`,
          detail: i === 0 ? 'Ctrl+Shift+N' : undefined,
          run: () => S.moveTab(pane.id, docId, p.id, p.tabs.length),
        })),
        ...(others.length ? [{ separator: true }] : []),
        { label: 'Duplicate', run: () => void S.duplicateDoc(docId) },
        {
          label: 'Reveal in Explorer',
          disabled: !doc?.path,
          run: () => doc?.path && void window.api?.file.reveal(doc.path),
        },
        {
          label: 'Delete File',
          danger: true,
          disabled: !doc?.path,
          run: () => {
            if (doc?.path && confirm(`Move "${doc.title}" to the recycle bin?`))
              void S.deleteFile(doc.path);
          },
        },
      ],
    };
  };

  /** Converts a pointer x-position into an insertion index in the strip. */
  const indexAt = (clientX: number): number => {
    const strip = stripRef.current;
    if (!strip) return docs.length;
    const tabs = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab]'));
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return tabs.length;
  };

  return (
    <div className={`tab-strip${ws.layout.activePaneId === pane.id ? ' focused' : ''}`}>
      <div
        className="tabs"
        ref={stripRef}
        onDragOver={(e) => {
          if (!getDraggedTab()) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropAt(indexAt(e.clientX));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const d = getDraggedTab();
          setDropAt(null);
          if (!d) return;
          let to = indexAt(e.clientX);
          // Removing the tab first shifts everything after it left by one.
          if (d.paneId === pane.id && pane.tabs.indexOf(d.docId) < to) to -= 1;
          S.moveTab(d.paneId, d.docId, pane.id, to);
          setDraggedTab(null);
        }}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) S.createNoteDoc(undefined, '', pane.id);
        }}
      >
        {docs.map((doc, i) => {
          const active = pane.activeTabId === doc.id;
          const dirty = S.isDirty(doc);
          const warn = doc.conflict ? 'conflict' : doc.missing ? 'missing' : '';
          return (
            <div
              key={doc.id}
              data-tab
              className={`tab${active ? ' active' : ''}${dropAt === i ? ' drop-before' : ''}${
                dirty ? ' dirty' : ''
              }${warn ? ' ' + warn : ''}`}
              draggable
              title={
                (doc.path ?? `${doc.title} (unsaved)`) +
                (doc.conflict ? '\nChanged on disk since you edited it' : '') +
                (doc.missing ? '\nFile no longer exists in the vault' : '')
              }
              onDragStart={(e) => {
                setDraggedTab({ paneId: pane.id, docId: doc.id });
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', doc.title);
              }}
              onDragEnd={() => {
                setDraggedTab(null);
                setDropAt(null);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void S.requestCloseTab(pane.id, doc.id);
                } else if (e.button === 0) {
                  S.activateTab(pane.id, doc.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                S.activateTab(pane.id, doc.id);
                setMenu(tabMenu(doc.id, e.clientX, e.clientY));
              }}
            >
              <DocIcon kind={doc.type} />
              <span className="tab-label">{doc.title || 'Untitled'}</span>
              {/* Sublime shows a dot for unsaved buffers; it becomes × on hover. */}
              <button
                type="button"
                className="tab-close"
                title={dirty ? 'Unsaved changes — click to close' : 'Close'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void S.requestCloseTab(pane.id, doc.id);
                }}
              >
                <span className="tab-x">×</span>
                <span className="tab-dirty-dot" />
              </button>
            </div>
          );
        })}
        {dropAt === docs.length && <div className="drop-marker" />}
      </div>

      <div className="tab-strip-actions">
        <span className="group-badge" title="Editor group">
          {index + 1}
        </span>
        <button
          type="button"
          className="icon-btn"
          title="New free note in this group (Ctrl+N)"
          onClick={() => S.createNoteDoc(undefined, '', pane.id)}
        >
          +
        </button>
      </div>

      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
