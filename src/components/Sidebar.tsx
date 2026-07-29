import { useMemo, useState } from 'react';
import { baseName, dirName, VaultFile, Workspace } from '../types';
import * as S from '../store';
import ContextMenu, { MenuState } from './ContextMenu';
import Prompt, { PromptState } from './Prompt';

interface TreeNode {
  rel: string;
  name: string;
  children: TreeNode[];
  files: VaultFile[];
}

/** Builds a folder tree from the flat vault listing. */
function buildTree(ws: Workspace): TreeNode {
  const root: TreeNode = { rel: '', name: '', children: [], files: [] };
  const byRel = new Map<string, TreeNode>([['', root]]);

  const ensure = (rel: string): TreeNode => {
    const hit = byRel.get(rel);
    if (hit) return hit;
    const parent = ensure(dirName(rel));
    const node: TreeNode = { rel, name: rel.split('/').pop() ?? rel, children: [], files: [] };
    parent.children.push(node);
    byRel.set(rel, node);
    return node;
  };

  for (const dir of [...ws.dirs].sort((a, b) => a.rel.localeCompare(b.rel))) ensure(dir.rel);
  for (const file of ws.files) ensure(dirName(file.rel)).files.push(file);

  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

export default function Sidebar({ ws, onFlash }: { ws: Workspace; onFlash: (m: string) => void }) {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const tree = useMemo(() => buildTree(ws), [ws.files, ws.dirs]);
  const openPaths = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of ws.docs) if (d.path) map.set(d.path, d.id);
    return map;
  }, [ws.docs]);
  const activeId = S.activeDocId(ws);
  const q = query.trim().toLowerCase();

  /** Unsaved buffers that have no file yet still belong in the list. */
  const untitled = ws.docs.filter((d) => !d.path);

  const matches = (rel: string) => !q || rel.toLowerCase().includes(q);

  const fileMenu = (file: VaultFile, x: number, y: number): MenuState => ({
    x,
    y,
    entries: [
      { label: 'Open', run: () => void S.openFile(file.rel) },
      ...ws.layout.panes
        .filter((p) => p.id !== ws.layout.activePaneId)
        .map((p) => ({
          label: `Open in Group ${ws.layout.panes.indexOf(p) + 1}`,
          run: () => void S.openFile(file.rel, p.id),
        })),
      { separator: true },
      { label: 'Rename…', detail: 'F2', run: () => setRenaming(file.rel) },
      {
        label: 'Duplicate',
        run: async () => {
          const id = openPaths.get(file.rel) ?? (await S.openFile(file.rel));
          if (id) await S.duplicateDoc(id);
        },
      },
      { label: 'Reveal in Explorer', run: () => void window.api?.file.reveal(file.rel) },
      { separator: true },
      {
        label: 'Delete',
        danger: true,
        run: async () => {
          if (!confirm(`Move "${file.name}" to the recycle bin?`)) return;
          const res = await S.deleteFile(file.rel);
          onFlash(res.ok ? `Deleted ${file.name}` : `Delete failed: ${res.error}`);
        },
      },
    ],
  });

  const folderMenu = (rel: string, x: number, y: number): MenuState => ({
    x,
    y,
    entries: [
      {
        label: 'New note here',
        run: async () => {
          const id = S.createNoteDoc();
          await S.saveDocAs(id, `${rel ? rel + '/' : ''}Untitled.md`);
        },
      },
      {
        label: 'New todo document here',
        run: async () => {
          const id = S.createTodoDoc();
          await S.saveDocAs(id, `${rel ? rel + '/' : ''}Untitled todo.mgtodo`);
        },
      },
      {
        label: 'New diagram here',
        run: async () => {
          const id = S.createDiagramDoc();
          await S.saveDocAs(id, `${rel ? rel + '/' : ''}Untitled diagram.mgdiagram`);
        },
      },
      {
        label: 'New folder…',
        run: () =>
          setPrompt({
            title: 'New folder',
            hint: rel ? `Inside ${rel}` : 'At the top level of the vault',
            value: '',
            placeholder: 'Projects',
            confirmLabel: 'Create',
            onSubmit: async (name) => {
              if (!name.trim()) return;
              const res = await S.createFolder(`${rel ? rel + '/' : ''}${name.trim()}`);
              if (!res.ok) onFlash(`Could not create folder: ${res.error}`);
            },
          }),
      },
    ],
  });

  const renderNode = (node: TreeNode, depth: number) => {
    const isOpen = !collapsed[node.rel];
    const visibleFiles = node.files.filter((f) => matches(f.rel));
    return (
      <div key={node.rel || '__root__'}>
        {node.rel !== '' && (
          <div
            className="side-folder"
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => setCollapsed((c) => ({ ...c, [node.rel]: !c[node.rel] }))}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(folderMenu(node.rel, e.clientX, e.clientY));
            }}
          >
            <span className={`twisty${isOpen ? ' open' : ''}`}>▸</span>
            <span className="side-doc-name">{node.name}</span>
          </div>
        )}
        {isOpen && (
          <>
            {node.children.map((child) => renderNode(child, node.rel === '' ? depth : depth + 1))}
            {visibleFiles.map((file) => {
              const docId = openPaths.get(file.rel);
              const doc = docId ? ws.docs.find((d) => d.id === docId) : null;
              const dirty = doc ? S.isDirty(doc) : false;
              return (
                <div
                  key={file.rel}
                  className={`side-doc${activeId === docId ? ' active' : ''}${
                    docId ? ' open' : ''
                  }`}
                  style={{ paddingLeft: 14 + (node.rel === '' ? depth : depth + 1) * 12 }}
                  onClick={() => void S.openFile(file.rel)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu(fileMenu(file, e.clientX, e.clientY));
                  }}
                >
                  <span className={`tab-dot ${file.type}`} />
                  {renaming === file.rel ? (
                    <input
                      className="rename-input"
                      autoFocus
                      defaultValue={baseName(file.rel)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={async (e) => {
                        const next = e.target.value.trim();
                        setRenaming(null);
                        if (!next || next === baseName(file.rel)) return;
                        const res = await S.renameFile(file.rel, next);
                        if (!res.ok) onFlash(`Rename failed: ${res.error}`);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    <span className="side-doc-name">{baseName(file.rel)}</span>
                  )}
                  {dirty && <span className="side-dirty" title="Unsaved changes" />}
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title" title={ws.vaultPath}>
          {ws.vaultPath ? ws.vaultPath.split(/[\\/]/).pop() : 'Vault'}
        </span>
        <div className="sidebar-head-actions">
          <button
            type="button"
            className="icon-btn"
            title="New free note (Ctrl+N)"
            onClick={() => S.createNoteDoc()}
          >
            ✎
          </button>
          <button
            type="button"
            className="icon-btn"
            title="New todo document (Ctrl+T)"
            onClick={() => S.createTodoDoc()}
          >
            ▤
          </button>
          <button
            type="button"
            className="icon-btn"
            title="New diagram"
            onClick={() => S.createDiagramDoc()}
          >
            ◇
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Vault actions"
            onClick={(e) =>
              setMenu({
                x: e.clientX,
                y: e.clientY,
                entries: [
                  { label: 'Reload vault', detail: 'F5', run: () => void S.refreshVault() },
                  { label: 'Reveal vault in Explorer', run: () => void window.api?.vault.reveal() },
                  { separator: true },
                  {
                    label: 'Open another vault…',
                    run: async () => {
                      const res = await S.chooseVault();
                      if (res.ok) onFlash('Vault switched.');
                    },
                  },
                  { separator: true },
                  ...folderMenu('', 0, 0).entries,
                ],
              })
            }
          >
            ⋯
          </button>
        </div>
      </div>

      <div className="sidebar-search">
        <input
          value={query}
          placeholder="Filter files…"
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {query && (
          <button type="button" className="icon-btn" onClick={() => setQuery('')} title="Clear">
            ×
          </button>
        )}
      </div>

      <div
        className="sidebar-tree"
        title="Double-click empty space for a new note"
        onDoubleClick={(e) => {
          // Empty space only: double-clicking a file or folder means something else.
          if (e.target === e.currentTarget) S.createNoteDoc();
        }}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setMenu(folderMenu('', e.clientX, e.clientY));
          }
        }}
      >
        {untitled.length > 0 && (
          <div className="side-group">
            <div className="side-group-label">Unsaved</div>
            {untitled.map((doc) => (
              <div
                key={doc.id}
                className={`side-doc${activeId === doc.id ? ' active' : ''} open`}
                style={{ paddingLeft: 14 }}
                onClick={() => S.openDoc(doc.id)}
              >
                <span className={`tab-dot ${doc.type}`} />
                <span className="side-doc-name">{doc.title}</span>
                <span className="side-dirty" title="Never saved" />
              </div>
            ))}
          </div>
        )}

        {renderNode(tree, 0)}

        {!ws.files.length && !untitled.length && (
          <div className="side-empty">Vault is empty — create a note to get started.</div>
        )}
      </div>

      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
      {prompt && <Prompt state={prompt} onClose={() => setPrompt(null)} />}
    </aside>
  );
}
