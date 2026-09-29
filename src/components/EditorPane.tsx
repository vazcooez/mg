import { useEffect, useRef, useState } from 'react';
import { Pane, SplitSide, Workspace } from '../types';
import * as S from '../store';
import TabStrip, { getDraggedTab, setDraggedTab } from './TabStrip';
import TodoDocView from './TodoDocView';
import NoteDocView from './NoteDocView';
import DiagramView from './DiagramView';
import ImageView from './ImageView';
import { DiagramDoc } from '../types';

/** Diagrams get the same title header as the other document types. */
function DiagramDocView({ doc }: { doc: DiagramDoc }) {
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!S.takeJustCreated(doc.id)) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [doc.id]);
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
        <span className="doc-kind">Diagram</span>
      </header>
      <div className="doc-body">
        <div className="doc-main">
          <DiagramView doc={doc} />
        </div>
      </div>
    </div>
  );
}

/** Where over a group a dragged tab would land. */
type DropZone = 'center' | SplitSide;

/** How close to an edge, as a share of the group, counts as that edge. */
const EDGE = 0.25;

/**
 * The edge nearest the pointer when it is within reach of one, otherwise the
 * middle. Whichever edge is proportionally closest wins, so the corners split
 * the way the pointer is leaning.
 */
function zoneAt(el: HTMLElement, clientX: number, clientY: number): DropZone {
  const r = el.getBoundingClientRect();
  const x = (clientX - r.left) / r.width;
  const y = (clientY - r.top) / r.height;
  const edges: Array<[SplitSide, number]> = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ];
  const [side, distance] = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
  return distance < EDGE ? side : 'center';
}

export default function EditorPane({
  ws,
  pane,
  index,
}: {
  ws: Workspace;
  pane: Pane;
  index: number;
}) {
  const doc = S.findDoc(ws, pane.activeTabId);
  const focused = ws.layout.activePaneId === pane.id;
  const [zone, setZone] = useState<DropZone | null>(null);

  // A drag that ends anywhere else — Escape, another group, outside the
  // window — must not leave this group's highlight behind.
  useEffect(() => {
    if (!zone) return;
    const clear = () => setZone(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [zone]);

  /**
   * The zone a tab dragged over this group would use, or null when dropping
   * here would change nothing — a group's only tab, dropped on that group.
   */
  const zoneFor = (e: React.DragEvent<HTMLElement>): DropZone | null => {
    const d = getDraggedTab();
    if (!d) return null;
    const own = d.paneId === pane.id;
    if (own && pane.tabs.length === 1) return null;
    const z = zoneAt(e.currentTarget, e.clientX, e.clientY);
    return own && z === 'center' ? null : z;
  };

  return (
    <section
      className={`editor-pane${focused ? ' focused' : ''}`}
      onPointerDownCapture={() => S.focusPane(pane.id)}
    >
      <TabStrip ws={ws} pane={pane} index={index} />
      <div
        className="pane-content"
        // Capture phase: a dragged tab carries its title as text, and an editor
        // underneath would otherwise take the drop and type it into the note.
        onDragOverCapture={(e) => {
          if (!getDraggedTab()) return;
          e.preventDefault();
          e.stopPropagation();
          const z = zoneFor(e);
          e.dataTransfer.dropEffect = z ? 'move' : 'none';
          if (z !== zone) setZone(z);
        }}
        onDragLeaveCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setZone(null);
        }}
        onDropCapture={(e) => {
          const d = getDraggedTab();
          if (!d) return;
          e.preventDefault();
          e.stopPropagation();
          const z = zoneFor(e);
          setZone(null);
          setDraggedTab(null);
          if (z === 'center') S.moveTab(d.paneId, d.docId, pane.id, pane.tabs.length);
          else if (z) S.splitWithTab(d.paneId, d.docId, pane.id, z);
        }}
      >
        {zone && <div className={`drop-overlay ${zone}`} />}
        {!doc ? (
          <EmptyPane paneId={pane.id} />
        ) : doc.type === 'todo' ? (
          <TodoDocView doc={doc} paneId={pane.id} theme={ws.theme} />
        ) : doc.type === 'diagram' ? (
          <DiagramDocView doc={doc} />
        ) : doc.type === 'image' ? (
          <ImageView doc={doc} />
        ) : (
          <NoteDocView ws={ws} doc={doc} paneId={pane.id} />
        )}
      </div>
    </section>
  );
}

function EmptyPane({ paneId }: { paneId: string }) {
  return (
    <div className="empty-pane">
      <div className="empty-title">No document open</div>
      <div className="empty-keys">
        <button type="button" className="ghost-btn" onClick={() => S.createTodoDoc(undefined, paneId)}>
          New todo document
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => S.createNoteDoc(undefined, '', paneId)}
        >
          New free note
        </button>
      </div>
      <div className="empty-hint">
        <kbd>Ctrl</kbd>+<kbd>P</kbd> Goto Anything · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>{' '}
        Command Palette
      </div>
    </div>
  );
}
