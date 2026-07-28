import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import PaneGrid from './components/PaneGrid';
import StatusBar from './components/StatusBar';
import Palette, { PaletteEntry } from './components/Palette';
import SettingsPanel from './components/Settings';
import { baseName, EDITOR_FONT_STACKS, LAYOUTS, LayoutKind } from './types';
import * as S from './store';

type PaletteMode = 'goto' | 'command' | null;

/** True when the keystroke belongs to a text field and should not be hijacked. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function App() {
  const ws = S.useWorkspace();
  const [palette, setPalette] = useState<PaletteMode>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Sublime chord support: Ctrl+K arms a prefix consumed by the next keystroke.
  const chord = useRef(false);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pane = S.activePane(ws);
  const activeId = S.activeDocId(ws);
  const activeDoc = S.findDoc(ws, activeId);

  useEffect(() => {
    document.documentElement.dataset.theme = ws.theme;
  }, [ws.theme]);

  // Settings become CSS variables; interface scale is a real window zoom so
  // layout scales with it, not just glyphs.
  useEffect(() => {
    const root = document.documentElement.style;
    const s = ws.settings;
    root.setProperty('--editor-font-size', `${s.editorFontSize}px`);
    root.setProperty('--editor-font', EDITOR_FONT_STACKS[s.editorFont]);
    root.setProperty('--table-font-size', `${s.tableFontSize}px`);
    root.setProperty('--chrome-font-size', `${s.chromeFontSize}px`);
    void window.api?.setUiScale(s.uiScale);
  }, [ws.settings]);

  useEffect(() => {
    const dirty = activeDoc && S.isDirty(activeDoc) ? '● ' : '';
    document.title = activeDoc ? `${dirty}${activeDoc.title} — MG` : 'MG';
  }, [activeDoc, activeDoc && S.isDirty(activeDoc)]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2400);
  }, []);

  /* ------------------------------------------------------------ actions */

  const setDocView = useCallback(
    (view: 'matrix' | 'tree' | 'plain' | 'live' | 'source' | 'split') => {
      const doc = S.findDoc(ws, activeId);
      if (!doc) return;
      if (doc.type === 'todo') {
        if (view === 'matrix' || view === 'tree') S.setTodoView(doc.id, view);
        else flash('That view belongs to free notes.');
        return;
      }
      if (view === 'plain') return S.setNoteView(doc.id, 'plain');
      if (view === 'live' || view === 'source' || view === 'split') {
        S.setNoteView(doc.id, 'markdown');
        S.setMdMode(doc.id, view === 'source' ? 'edit' : view === 'split' ? 'split' : 'live');
        return;
      }
      flash('That view belongs to todo documents.');
    },
    [ws, activeId, flash]
  );

  const save = useCallback(async () => {
    if (!activeDoc) return;
    const res = await S.saveDoc(activeDoc.id);
    if (res.ok) flash(`Saved ${activeDoc.path ?? activeDoc.title}`);
    else if (!res.canceled) flash(`Save failed: ${res.error}`);
  }, [activeDoc, flash]);

  const saveAs = useCallback(async () => {
    if (!activeDoc) return;
    const res = await S.saveDocAsPrompt(activeDoc.id);
    if (res.ok) flash('Saved.');
    else if (!res.canceled) flash(`Save failed: ${res.error}`);
  }, [activeDoc, flash]);

  const saveAll = useCallback(async () => {
    const { saved, failed, needPrompt } = await S.saveAll();
    const bits = [`${saved} saved`];
    if (failed) bits.push(`${failed} failed`);
    if (needPrompt) bits.push(`${needPrompt} need a filename`);
    flash(bits.join(' · '));
  }, [flash]);

  const runMenu = useCallback(
    (action: string) => {
      if (action.startsWith('layout:')) {
        S.setLayoutKind(action.slice(7) as LayoutKind);
        return;
      }
      switch (action) {
        case 'new-todo':
          S.createTodoDoc();
          break;
        case 'new-note':
          S.createNoteDoc();
          break;
        case 'save':
          void save();
          break;
        case 'save-as':
          void saveAs();
          break;
        case 'save-all':
          void saveAll();
          break;
        case 'revert':
          if (activeDoc)
            void S.revertDoc(activeDoc.id).then((r) =>
              flash(r.ok ? 'Reverted to the saved file.' : `Revert failed: ${r.error}`)
            );
          break;
        case 'open-vault':
          void S.chooseVault().then((r) => r.ok && flash('Vault switched.'));
          break;
        case 'reveal-vault':
          void window.api?.vault.reveal();
          break;
        case 'reload-vault':
          void S.syncWithDisk().then(() => flash('Vault reloaded.'));
          break;
        case 'flush-session':
          // The main process is holding the window close until this lands.
          void S.flushSession();
          break;
        case 'goto-anything':
          setPalette('goto');
          break;
        case 'command-palette':
          setPalette('command');
          break;
        case 'next-tab':
          S.cycleTab(pane.id, 1);
          break;
        case 'prev-tab':
          S.cycleTab(pane.id, -1);
          break;
        case 'close-tab':
          if (pane.activeTabId) void S.requestCloseTab(pane.id, pane.activeTabId);
          break;
        case 'reopen-tab':
          S.reopenClosedTab();
          break;
        case 'toggle-sidebar':
          S.toggleSidebar();
          break;
        case 'toggle-theme':
          S.toggleTheme();
          break;
        case 'settings':
          setSettingsOpen(true);
          break;
        case 'font-bigger':
          S.setSetting('editorFontSize', ws.settings.editorFontSize + 1);
          break;
        case 'font-smaller':
          S.setSetting('editorFontSize', ws.settings.editorFontSize - 1);
          break;
        case 'view-matrix':
          setDocView('matrix');
          break;
        case 'view-tree':
          setDocView('tree');
          break;
        case 'view-plain':
          setDocView('plain');
          break;
        case 'view-live':
          setDocView('live');
          break;
        case 'view-source':
          setDocView('source');
          break;
        case 'view-split':
          setDocView('split');
          break;
        case 'undo':
          if (isEditable(document.activeElement) && document.execCommand('undo')) break;
          S.undo();
          break;
        case 'redo':
          if (isEditable(document.activeElement) && document.execCommand('redo')) break;
          S.redo();
          break;
        default:
          break;
      }
    },
    [pane.id, pane.activeTabId, activeDoc, save, saveAs, saveAll, setDocView, flash, ws.settings]
  );

  useEffect(() => window.api?.onMenu(runMenu), [runMenu]);

  // External edits to the vault (git pull, Obsidian, an editor) refresh the tree
  // and reload any buffer that has no unsaved changes.
  useEffect(() => window.api?.onVaultChanged(() => void S.syncWithDisk()), []);

  /* -------------------------------------------------------- key handling */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+K <key> chords.
      if (chord.current) {
        chord.current = false;
        if (chordTimer.current) clearTimeout(chordTimer.current);
        const k = e.key.toLowerCase();
        if (k === 'b') {
          e.preventDefault();
          S.toggleSidebar();
          return;
        }
        if (k === 'w') {
          e.preventDefault();
          if (pane.activeTabId) void S.requestCloseTab(pane.id, pane.activeTabId);
          return;
        }
        if (k === 't') {
          e.preventDefault();
          S.toggleTheme();
          return;
        }
      }
      if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        chord.current = true;
        if (chordTimer.current) clearTimeout(chordTimer.current);
        chordTimer.current = setTimeout(() => {
          chord.current = false;
        }, 1500);
        return;
      }

      if (e.key === 'Escape' && palette) {
        setPalette(null);
        return;
      }

      // Alt+Shift+N — layout presets.
      if (e.altKey && e.shiftKey && /^[1-9]$/.test(e.key)) {
        const map: Record<string, LayoutKind> = {
          '1': 'single',
          '2': 'columns-2',
          '3': 'columns-3',
          '5': 'grid-4',
          '8': 'rows-2',
          '9': 'rows-3',
        };
        const kind = map[e.key];
        if (kind) {
          e.preventDefault();
          S.setLayoutKind(kind);
        }
        return;
      }

      // Alt+N — select tab by index in the active pane.
      if (e.altKey && !e.shiftKey && !ctrl && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        S.selectTabByIndex(pane.id, e.key === '9' ? -1 : Number(e.key) - 1);
        return;
      }

      // Ctrl+N — focus pane N. Ctrl+Shift+N — move the active tab to pane N.
      if (ctrl && !e.altKey && /^[1-9]$/.test(e.key)) {
        const target = ws.layout.panes[Number(e.key) - 1];
        if (!target) return;
        e.preventDefault();
        if (e.shiftKey) S.moveActiveTabToPane(pane.id, target.id);
        else S.focusPane(target.id);
        return;
      }

      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPalette('command');
        return;
      }
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPalette('goto');
        return;
      }
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z' && !isEditable(e.target)) {
        e.preventDefault();
        S.undo();
        return;
      }
      if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        if (isEditable(e.target)) return;
        e.preventDefault();
        S.redo();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pane.id, pane.activeTabId, palette, ws.layout.panes]);

  /* -------------------------------------------------------- palette data */

  const gotoEntries = useMemo<PaletteEntry[]>(() => {
    const seen = new Set<string>();
    const entries: PaletteEntry[] = [];
    // Open buffers first — including never-saved ones, which have no file.
    for (const d of ws.docs) {
      if (d.path) seen.add(d.path);
      entries.push({
        id: d.id,
        label: d.title,
        detail: d.path ?? 'unsaved',
        kind: d.type,
        run: () => S.openDoc(d.id, pane.id),
      });
    }
    for (const f of ws.files) {
      if (seen.has(f.rel)) continue;
      entries.push({
        id: f.rel,
        label: baseName(f.rel),
        detail: f.rel,
        kind: f.type,
        run: () => void S.openFile(f.rel, pane.id),
      });
    }
    return entries;
  }, [ws.docs, ws.files, pane.id]);

  const commandEntries = useMemo<PaletteEntry[]>(() => {
    const list: PaletteEntry[] = [
      { id: 'c:new-note', label: 'File: New Free Note', detail: 'Ctrl+N', run: () => S.createNoteDoc() },
      { id: 'c:new-todo', label: 'File: New Todo Document', detail: 'Ctrl+T', run: () => S.createTodoDoc() },
      { id: 'c:save', label: 'File: Save', detail: 'Ctrl+S', run: () => void save() },
      { id: 'c:save-as', label: 'File: Save As…', detail: 'Ctrl+Shift+S', run: () => void saveAs() },
      { id: 'c:save-all', label: 'File: Save All', detail: 'Ctrl+Alt+S', run: () => void saveAll() },
      {
        id: 'c:revert',
        label: 'File: Revert to Saved',
        run: () => activeDoc && void S.revertDoc(activeDoc.id),
      },
      { id: 'c:vault', label: 'Vault: Open Another Vault…', run: () => void S.chooseVault() },
      { id: 'c:reveal', label: 'Vault: Reveal in Explorer', run: () => void window.api?.vault.reveal() },
      { id: 'c:reload', label: 'Vault: Reload from Disk', detail: 'F5', run: () => void S.syncWithDisk() },
      {
        id: 'c:sidebar',
        label: 'View: Toggle Side Bar',
        detail: 'Ctrl+K Ctrl+B',
        run: () => S.toggleSidebar(),
      },
      {
        id: 'c:theme',
        label: `View: Switch to ${ws.theme === 'dark' ? 'Light' : 'Dark'} Theme`,
        detail: 'Ctrl+K Ctrl+T',
        run: () => S.toggleTheme(),
      },
      { id: 'c:settings', label: 'Preferences: Settings…', detail: 'Ctrl+,', run: () => setSettingsOpen(true) },
      {
        id: 'c:font+',
        label: 'Preferences: Increase Editor Font Size',
        detail: 'Ctrl+=',
        run: () => S.setSetting('editorFontSize', ws.settings.editorFontSize + 1),
      },
      {
        id: 'c:font-',
        label: 'Preferences: Decrease Editor Font Size',
        detail: 'Ctrl+-',
        run: () => S.setSetting('editorFontSize', ws.settings.editorFontSize - 1),
      },
      ...Object.values(LAYOUTS).map((spec) => ({
        id: `c:layout:${spec.kind}`,
        label: `View: Layout — ${spec.label}`,
        detail: spec.accelerator,
        run: () => S.setLayoutKind(spec.kind),
      })),
      {
        id: 'c:close',
        label: 'Tab: Close',
        detail: 'Ctrl+W',
        run: () => pane.activeTabId && void S.requestCloseTab(pane.id, pane.activeTabId),
      },
      { id: 'c:reopen', label: 'Tab: Reopen Closed', detail: 'Ctrl+Shift+T', run: () => S.reopenClosedTab() },
      { id: 'c:undo', label: 'Edit: Undo', detail: 'Ctrl+Z', run: () => S.undo() },
      { id: 'c:redo', label: 'Edit: Redo', detail: 'Ctrl+Shift+Z', run: () => S.redo() },
    ];

    if (activeDoc?.type === 'todo') {
      list.push(
        {
          id: 'c:view-matrix',
          label: 'View: Eisenhower Matrix',
          detail: 'Ctrl+Alt+1',
          run: () => S.setTodoView(activeDoc.id, 'matrix'),
        },
        {
          id: 'c:view-tree',
          label: 'View: Tree / Property Table',
          detail: 'Ctrl+Alt+2',
          run: () => S.setTodoView(activeDoc.id, 'tree'),
        },
        { id: 'c:add-item', label: 'Todo: Add Root Item', run: () => S.addItem(activeDoc.id, null) },
        { id: 'c:expand', label: 'Todo: Expand All', run: () => S.setAllCollapsed(activeDoc.id, false) },
        { id: 'c:collapse', label: 'Todo: Collapse All', run: () => S.setAllCollapsed(activeDoc.id, true) }
      );
    }
    if (activeDoc?.type === 'note') {
      list.push(
        {
          id: 'c:view-live',
          label: 'View: Markdown — Live Preview',
          detail: 'Ctrl+Alt+4',
          run: () => setDocView('live'),
        },
        {
          id: 'c:view-source',
          label: 'View: Markdown — Source',
          detail: 'Ctrl+Alt+5',
          run: () => setDocView('source'),
        },
        {
          id: 'c:view-split',
          label: 'View: Markdown — Split',
          detail: 'Ctrl+Alt+6',
          run: () => setDocView('split'),
        },
        {
          id: 'c:view-plain',
          label: 'View: Plain Text',
          detail: 'Ctrl+Alt+3',
          run: () => setDocView('plain'),
        }
      );
    }
    if (activeDoc) {
      list.push({
        id: 'c:duplicate',
        label: 'Document: Duplicate',
        run: () => void S.duplicateDoc(activeDoc.id),
      });
    }
    return list;
  }, [activeDoc, ws.theme, ws.settings, pane.id, pane.activeTabId, save, saveAs, saveAll, setDocView]);

  return (
    <div className="app">
      <div className="app-body">
        {ws.sidebarVisible && <Sidebar ws={ws} onFlash={flash} />}
        <PaneGrid ws={ws} />
      </div>
      <StatusBar ws={ws} />
      {palette && (
        <Palette
          mode={palette}
          entries={palette === 'goto' ? gotoEntries : commandEntries}
          onClose={() => setPalette(null)}
        />
      )}
      {settingsOpen && <SettingsPanel ws={ws} onClose={() => setSettingsOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
