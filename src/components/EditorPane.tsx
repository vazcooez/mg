import { Pane, Workspace } from '../types';
import * as S from '../store';
import TabStrip, { getDraggedTab, setDraggedTab } from './TabStrip';
import TodoDocView from './TodoDocView';
import NoteDocView from './NoteDocView';
import DiagramView from './DiagramView';
import { DiagramDoc } from '../types';

/** Diagrams get the same title header as the other document types. */
function DiagramDocView({ doc }: { doc: DiagramDoc }) {
  return (
    <div className="doc-view">
      <header className="doc-header">
        <input
          className="doc-title"
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

  return (
    <section
      className={`editor-pane${focused ? ' focused' : ''}`}
      onPointerDownCapture={() => S.focusPane(pane.id)}
      onDragOver={(e) => {
        if (getDraggedTab()) e.preventDefault();
      }}
      onDrop={(e) => {
        const d = getDraggedTab();
        if (!d || d.paneId === pane.id) return;
        e.preventDefault();
        S.moveTab(d.paneId, d.docId, pane.id, pane.tabs.length);
        setDraggedTab(null);
      }}
    >
      <TabStrip ws={ws} pane={pane} index={index} />
      <div className="pane-content">
        {!doc ? (
          <EmptyPane paneId={pane.id} />
        ) : doc.type === 'todo' ? (
          <TodoDocView doc={doc} paneId={pane.id} theme={ws.theme} />
        ) : doc.type === 'diagram' ? (
          <DiagramDocView doc={doc} />
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
