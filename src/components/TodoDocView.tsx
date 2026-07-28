import { useEffect, useState } from 'react';
import { TodoDoc } from '../types';
import * as S from '../store';
import EisenhowerView from './EisenhowerView';
import TreeTableView from './TreeTableView';
import Inspector from './Inspector';

export default function TodoDocView({
  doc,
  paneId,
  theme,
}: {
  doc: TodoDoc;
  paneId: string;
  theme: 'dark' | 'light';
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspector, setInspector] = useState(true);

  const selected = doc.items.find((i) => i.id === selectedId) ?? null;

  // Drop a stale selection when the item disappears.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

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
        <div className="view-switch">
          <button
            type="button"
            className={doc.view === 'matrix' ? 'on' : ''}
            onClick={() => S.setTodoView(doc.id, 'matrix')}
            title="Ctrl+Alt+1"
          >
            Eisenhower matrix
          </button>
          <button
            type="button"
            className={doc.view === 'tree' ? 'on' : ''}
            onClick={() => S.setTodoView(doc.id, 'tree')}
            title="Ctrl+Alt+2"
          >
            Tree / property table
          </button>
        </div>
        <button
          type="button"
          className={`icon-btn${inspector ? ' on' : ''}`}
          title="Toggle inspector"
          onClick={() => setInspector((v) => !v)}
        >
          ⚙
        </button>
      </header>

      <div className="doc-body" data-pane={paneId}>
        <div className="doc-main">
          {doc.view === 'matrix' ? (
            <EisenhowerView doc={doc} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <TreeTableView
              doc={doc}
              theme={theme}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>
        {inspector && (
          <Inspector
            doc={doc}
            item={selected}
            onSelect={setSelectedId}
            onClose={() => setInspector(false)}
          />
        )}
      </div>
    </div>
  );
}
