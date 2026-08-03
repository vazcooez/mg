import { LAYOUTS, Workspace } from '../types';
import * as S from '../store';

export default function StatusBar({ ws }: { ws: Workspace }) {
  const pane = S.activePane(ws);
  const doc = S.findDoc(ws, pane.activeTabId);
  const dirtyCount = S.dirtyDocs(ws).length;

  let info = 'No document';
  let viewName = '';
  if (doc?.type === 'todo') {
    const done = doc.items.filter((i) => i.status === 'done').length;
    const depth = doc.items.reduce((m, i) => Math.max(m, S.depthOf(doc.items, i.id) + 1), 0);
    info = `${doc.items.length} items · ${done} done · depth ${depth}`;
    viewName = doc.view === 'matrix' ? 'Eisenhower Matrix' : 'Tree / Property Table';
  } else if (doc?.type === 'note') {
    const words = doc.content.trim() ? doc.content.trim().split(/\s+/).length : 0;
    info = `${doc.content.length} chars · ${words} words · ${doc.content.split('\n').length} lines`;
    viewName =
      doc.view === 'plain'
        ? 'Plain Text'
        : doc.mdMode === 'live'
          ? 'Markdown · Live'
          : doc.mdMode === 'edit'
            ? 'Markdown · Source'
            : `Markdown · ${doc.mdMode}`;
  } else if (doc?.type === 'diagram') {
    info = `${doc.nodes.length} shapes · ${doc.edges.length} connectors`;
    viewName = 'Diagram';
  } else if (doc?.type === 'image') {
    info = `${Math.round((doc.zoom ?? 1) * 100)}% zoom`;
    viewName = 'Image';
  }

  const where = doc ? (doc.path ?? 'unsaved buffer') : ws.vaultPath;

  return (
    <footer className="status-bar">
      <button
        type="button"
        className="status-btn"
        title="Toggle side bar (Ctrl+K Ctrl+B)"
        onClick={() => S.toggleSidebar()}
      >
        ☰
      </button>

      <span className="status-cell path" title={ws.vaultPath}>
        {where}
      </span>
      {doc && S.isDirty(doc) && (
        <button
          type="button"
          className="status-btn dirty"
          title="Unsaved changes — click to save (Ctrl+S)"
          onClick={() => void S.saveDoc(doc.id)}
        >
          ● unsaved
        </button>
      )}
      {doc?.conflict && <span className="status-cell warn">changed on disk</span>}
      {doc?.missing && <span className="status-cell warn">file missing</span>}

      <span className="status-spacer" />

      <span className="status-cell">{info}</span>
      {dirtyCount > 1 && (
        <button
          type="button"
          className="status-btn"
          title="Save every modified document (Ctrl+Alt+S)"
          onClick={() => void S.saveAll()}
        >
          {dirtyCount} unsaved
        </button>
      )}
      <span className="status-cell dim">
        Group {ws.layout.panes.indexOf(pane) + 1}/{ws.layout.panes.length}
      </span>
      <span className="status-cell dim">{LAYOUTS[ws.layout.kind].label}</span>
      {viewName && <span className="status-cell">{viewName}</span>}
      <button
        type="button"
        className="status-btn"
        title="Toggle theme (Ctrl+K Ctrl+T)"
        onClick={() => S.toggleTheme()}
      >
        {ws.theme === 'dark' ? '◐' : '◑'}
      </button>
    </footer>
  );
}
