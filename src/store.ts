import { useSyncExternalStore } from 'react';
import {
  baseName,
  clamp,
  DEFAULT_AXES,
  DEFAULT_COLOR,
  DEFAULT_SETTINGS,
  defaultColumnWidth,
  dirName,
  EDITOR_FONT_STACKS,
  Doc,
  DocFile,
  Layout,
  LayoutKind,
  LAYOUTS,
  MatrixAxes,
  minColumnWidth,
  NOTE_EXT,
  NoteDoc,
  NoteView,
  NUMBER_DISPLAYS,
  NumberDisplay,
  Pane,
  paneCount,
  PROPERTY_TYPES,
  PropertyDef,
  PropertyType,
  round1,
  safeFileName,
  SETTING_BOUNDS,
  Settings,
  SortSpec,
  TODO_EXT,
  TodoDoc,
  TodoItem,
  TodoView,
  VaultFile,
  Workspace,
  ZOOM_MAX,
  ZOOM_MIN,
} from './types';

/* ------------------------------------------------------------------ ids */

let counter = 0;
export function uid(prefix = 'i'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/* --------------------------------------------------------------- factory */

export function makeItem(parentId: string | null, overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: uid('it'),
    parentId,
    title: 'New item',
    assignee: '',
    urgency: 5,
    importance: 5,
    weight: 5,
    color: null,
    status: 'planned',
    properties: {},
    collapsed: false,
    showInMatrix: true,
    ...overrides,
  };
}

export function makeTodoDoc(title = 'Untitled todo'): TodoDoc {
  const now = Date.now();
  const doc: TodoDoc = {
    id: uid('doc'),
    type: 'todo',
    title,
    items: [],
    propertyDefs: [],
    view: 'matrix',
    path: null,
    saved: null,
    mtime: null,
    createdAt: now,
    updatedAt: now,
  };
  doc.saved = serializeDoc(doc);
  return doc;
}

export function makeNoteDoc(title = 'Untitled note', content = ''): NoteDoc {
  const now = Date.now();
  const doc: NoteDoc = {
    id: uid('doc'),
    type: 'note',
    title,
    content,
    view: 'markdown',
    mdMode: 'live',
    path: null,
    saved: null,
    mtime: null,
    createdAt: now,
    updatedAt: now,
  };
  doc.saved = serializeDoc(doc);
  return doc;
}

/* ------------------------------------------------------- file (de)serialisation */

/**
 * The exact bytes a document occupies on disk. Notes are plain markdown so the
 * vault stays readable by Obsidian; todo documents use pretty-printed JSON
 * under the app's own `.mgtodo` extension.
 */
export function serializeDoc(doc: Doc): string {
  if (doc.type === 'note') return doc.content;
  // `view`, sort, axes and column sizing are intentionally absent: they are
  // window state, and writing them here would mark the buffer dirty whenever
  // the user merely looked at the document differently.
  return (
    JSON.stringify(
      {
        format: 'mg-todo',
        version: 1,
        title: doc.title,
        propertyDefs: doc.propertyDefs,
        items: doc.items,
      },
      null,
      2
    ) + '\n'
  );
}

/** Rebuilds a document body from file (or buffer) text. */
export function parseDocBody(
  type: 'todo' | 'note',
  title: string,
  text: string
): Omit<TodoDoc, keyof DocFile | 'id' | 'createdAt' | 'updatedAt'> | Omit<
  NoteDoc,
  keyof DocFile | 'id' | 'createdAt' | 'updatedAt'
> {
  if (type === 'note') {
    return { type: 'note', title, content: text, view: 'markdown', mdMode: 'live' };
  }
  type LegacyTodo = Partial<TodoDoc> & { propertyColumns?: string[] };
  let data: LegacyTodo = {};
  try {
    data = JSON.parse(text) as LegacyTodo;
  } catch {
    // A corrupt or hand-edited file still opens — as an empty document — so the
    // user can see the problem instead of losing the tab.
    data = {};
  }
  return {
    type: 'todo',
    title: data.title || title,
    items: normalize((data.items ?? []).map((it) => ({ ...makeItem(it.parentId ?? null), ...it }))),
    propertyDefs: readPropertyDefs(data),
    view: data.view === 'tree' ? 'tree' : 'matrix',
  };
}

/** Accepts the current `propertyDefs` or the original `propertyColumns: string[]`. */
function readPropertyDefs(data: { propertyDefs?: PropertyDef[]; propertyColumns?: string[] }): PropertyDef[] {
  if (Array.isArray(data.propertyDefs)) {
    return data.propertyDefs
      .filter((d) => d && typeof d.name === 'string' && d.name.trim())
      .map((d) => ({
        name: d.name,
        type: PROPERTY_TYPES.includes(d.type) ? d.type : 'text',
        options: Array.isArray(d.options) ? d.options.filter((o) => typeof o === 'string') : undefined,
        display: NUMBER_DISPLAYS.includes(d.display as NumberDisplay) ? d.display : undefined,
        min: typeof d.min === 'number' ? d.min : undefined,
        max: typeof d.max === 'number' ? d.max : undefined,
      }));
  }
  if (Array.isArray(data.propertyColumns)) {
    return data.propertyColumns
      .filter((n) => typeof n === 'string' && n.trim())
      .map((name) => ({ name, type: 'text' as const }));
  }
  return [];
}

/** True when the buffer differs from what is on disk. */
export function isDirty(doc: Doc): boolean {
  return serializeDoc(doc) !== doc.saved;
}

export function extForType(type: 'todo' | 'note'): string {
  return type === 'todo' ? TODO_EXT : NOTE_EXT;
}

/* ------------------------------------------------------------ tree utils */

export function childrenOf(items: TodoItem[], parentId: string | null): TodoItem[] {
  return items.filter((i) => i.parentId === parentId);
}

export function descendantIds(items: TodoItem[], id: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const it of items) {
      if (it.parentId === pid) {
        out.push(it.id);
        walk(it.id);
      }
    }
  };
  walk(id);
  return out;
}

export function ancestorsOf(items: TodoItem[], id: string): TodoItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: TodoItem[] = [];
  let cur = byId.get(id);
  const guard = new Set<string>();
  while (cur && cur.parentId && !guard.has(cur.parentId)) {
    guard.add(cur.parentId);
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    out.push(parent);
    cur = parent;
  }
  return out;
}

export function depthOf(items: TodoItem[], id: string): number {
  return ancestorsOf(items, id).length;
}

export interface FlatRow {
  item: TodoItem;
  depth: number;
  hasChildren: boolean;
}

/**
 * Pre-order traversal. `respectCollapse` hides descendants of collapsed items.
 * `compare` sorts siblings within each parent, so sorting a column reorders
 * rows without ever flattening the hierarchy.
 */
export function flattenTree(
  items: TodoItem[],
  respectCollapse = true,
  compare?: (a: TodoItem, b: TodoItem) => number
): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const kids = childrenOf(items, parentId);
    const ordered = compare ? kids.slice().sort(compare) : kids;
    for (const it of ordered) {
      out.push({ item: it, depth, hasChildren: childrenOf(items, it.id).length > 0 });
      if (!respectCollapse || !it.collapsed) walk(it.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Rewrites the flat array into document order, re-rooting any orphaned items. */
function normalize(items: TodoItem[]): TodoItem[] {
  const ids = new Set(items.map((i) => i.id));
  const fixed = items.map((i) => (i.parentId && !ids.has(i.parentId) ? { ...i, parentId: null } : i));
  const out: TodoItem[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const it of fixed) {
      if (it.parentId !== parentId || seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
      walk(it.id);
    }
  };
  walk(null);
  // Anything left over sat in a parent cycle — flatten it back to the root.
  for (const it of fixed) {
    if (!seen.has(it.id)) out.push({ ...it, parentId: null });
  }
  return out;
}

/** Walks up the parent chain for the first explicit color. */
export function resolveColor(items: TodoItem[], item: TodoItem): string {
  if (item.color) return item.color;
  for (const anc of ancestorsOf(items, item.id)) {
    if (anc.color) return anc.color;
  }
  return DEFAULT_COLOR;
}

/**
 * The document's declared property schema, plus a text definition for any key
 * that only exists on items (hand-edited files, older documents).
 */
export function propertyDefsOf(doc: TodoDoc): PropertyDef[] {
  const declared = doc.propertyDefs ?? [];
  const known = new Set(declared.map((d) => d.name));
  const extra: PropertyDef[] = [];
  for (const it of doc.items) {
    for (const key of Object.keys(it.properties)) {
      if (!known.has(key)) {
        known.add(key);
        extra.push({ name: key, type: 'text' });
      }
    }
  }
  extra.sort((a, b) => a.name.localeCompare(b.name));
  return [...declared, ...extra];
}

export function propertyDef(doc: TodoDoc, name: string): PropertyDef {
  return propertyDefsOf(doc).find((d) => d.name === name) ?? { name, type: 'text' };
}

/* ---------------------------------------------------------------- values */

/** Parses a stored property string according to its declared type. */
export function propertyValue(def: PropertyDef, raw: string | undefined): number | string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (def.type === 'number') {
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  if (def.type === 'date') {
    const t = Date.parse(text);
    return Number.isFinite(t) ? t : null;
  }
  return text;
}

/** Numeric value of any sortable/plottable column, or null when blank. */
export function numericValue(doc: TodoDoc, item: TodoItem, key: string): number | null {
  if (key === 'urgency' || key === 'importance' || key === 'weight') return item[key];
  if (key.startsWith('prop:')) {
    const name = key.slice(5);
    const def = propertyDef(doc, name);
    if (def.type !== 'number' && def.type !== 'date') return null;
    const v = propertyValue(def, item.properties[name]);
    return typeof v === 'number' ? v : null;
  }
  return null;
}

/* --------------------------------------------------------------- sorting */

const STATUS_ORDER: Record<string, number> = {
  planned: 0,
  scheduled: 1,
  'in-progress': 2,
  done: 3,
};

/**
 * Comparator for one column. Blanks always sink to the bottom regardless of
 * direction — an empty cell is "unknown", not "smallest".
 */
export function itemComparator(doc: TodoDoc, sort: SortSpec): (a: TodoItem, b: TodoItem) => number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const { key } = sort;

  const rank = (item: TodoItem): { empty: boolean; num?: number; text?: string } => {
    if (key === 'title') return { empty: false, text: item.title.toLowerCase() };
    if (key === 'assignee')
      return { empty: !item.assignee.trim(), text: item.assignee.toLowerCase() };
    if (key === 'status') return { empty: false, num: STATUS_ORDER[item.status] ?? 0 };
    if (key === 'matrix') return { empty: false, num: item.showInMatrix ? 1 : 0 };
    if (key === 'color') return { empty: !item.color, text: resolveColor(doc.items, item) };
    if (key === 'urgency' || key === 'importance' || key === 'weight')
      return { empty: false, num: item[key] };
    if (key.startsWith('prop:')) {
      const name = key.slice(5);
      const def = propertyDef(doc, name);
      const raw = item.properties[name];
      const value = propertyValue(def, raw);
      if (value == null) return { empty: true };
      if (def.type === 'select') {
        const at = def.options?.indexOf(String(value)) ?? -1;
        return { empty: false, num: at < 0 ? Number.MAX_SAFE_INTEGER : at, text: String(value) };
      }
      if (typeof value === 'number') return { empty: false, num: value };
      return { empty: false, text: String(value).toLowerCase() };
    }
    return { empty: true };
  };

  return (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra.empty !== rb.empty) return ra.empty ? 1 : -1;
    if (ra.empty && rb.empty) return a.title.localeCompare(b.title);
    if (ra.num != null && rb.num != null && ra.num !== rb.num) return (ra.num - rb.num) * sign;
    if (ra.text != null && rb.text != null) {
      const cmp = ra.text.localeCompare(rb.text);
      if (cmp !== 0) return cmp * sign;
    }
    return a.title.localeCompare(b.title);
  };
}

export function setSort(docId: string, sort: SortSpec | null) {
  updateTodo(docId, (d) => ({ ...d, sort }), { noHistory: true });
}

/** Click cycle on a header: ascending → descending → unsorted. */
export function cycleSort(docId: string, key: string) {
  updateTodo(
    docId,
    (d) => {
      const current = d.sort;
      if (!current || current.key !== key) return { ...d, sort: { key, dir: 'asc' } };
      if (current.dir === 'asc') return { ...d, sort: { key, dir: 'desc' } };
      return { ...d, sort: null };
    },
    { noHistory: true }
  );
}

/* ---------------------------------------------------- property schema ops */

export function setPropertyType(docId: string, name: string, type: PropertyType) {
  updateTodo(docId, (d) => {
    const defs = propertyDefsOf(d).map((def) =>
      def.name === name
        ? {
            ...def,
            type,
            display: type === 'number' ? (def.display ?? 'digit') : undefined,
            options: type === 'select' ? (def.options ?? optionsSeenFor(d, name)) : undefined,
          }
        : def
    );
    return { ...d, propertyDefs: defs };
  });
}

/** Existing values become the starting option list when switching to Options. */
function optionsSeenFor(doc: TodoDoc, name: string): string[] {
  const seen = new Set<string>();
  for (const it of doc.items) {
    const v = (it.properties[name] ?? '').trim();
    if (v) seen.add(v);
  }
  return [...seen].sort();
}

export function setPropertyDisplay(docId: string, name: string, display: NumberDisplay) {
  updateTodo(docId, (d) => ({
    ...d,
    propertyDefs: propertyDefsOf(d).map((def) => (def.name === name ? { ...def, display } : def)),
  }));
}

export function setPropertyOptions(docId: string, name: string, options: string[]) {
  const clean = options.map((o) => o.trim()).filter(Boolean);
  updateTodo(docId, (d) => ({
    ...d,
    propertyDefs: propertyDefsOf(d).map((def) =>
      def.name === name ? { ...def, options: [...new Set(clean)] } : def
    ),
  }));
}

export function setPropertyBounds(docId: string, name: string, min?: number, max?: number) {
  updateTodo(docId, (d) => ({
    ...d,
    propertyDefs: propertyDefsOf(d).map((def) => (def.name === name ? { ...def, min, max } : def)),
  }));
}

/** Display mode for the built-in numeric columns; window state. */
export function columnDisplay(doc: TodoDoc, key: string): NumberDisplay {
  if (key.startsWith('prop:')) return propertyDef(doc, key.slice(5)).display ?? 'digit';
  return doc.columnDisplay?.[key] ?? 'digit';
}

export function setColumnDisplay(docId: string, key: string, display: NumberDisplay) {
  if (key.startsWith('prop:')) {
    setPropertyDisplay(docId, key.slice(5), display);
    return;
  }
  updateTodo(
    docId,
    (d) => ({ ...d, columnDisplay: { ...(d.columnDisplay ?? {}), [key]: display } }),
    { noHistory: true }
  );
}

/* -------------------------------------------------------- matrix geometry */

export function axesOf(doc: TodoDoc): MatrixAxes {
  return doc.axes ?? DEFAULT_AXES;
}

export function setAxes(docId: string, patch: Partial<MatrixAxes>) {
  updateTodo(docId, (d) => ({ ...d, axes: { ...axesOf(d), ...patch } }), { noHistory: true });
}

export function resetAxes(docId: string) {
  updateTodo(docId, (d) => ({ ...d, axes: { ...DEFAULT_AXES } }), { noHistory: true });
}

export function zoomOf(doc: TodoDoc): number {
  const z = doc.zoom;
  return Number.isFinite(z) && z! > 0 ? clamp(z!, ZOOM_MIN, ZOOM_MAX) : 1;
}

/** Card scale only — the plot, the axes and every value stay put. */
export function setZoom(docId: string, zoom: number) {
  updateTodo(docId, (d) => ({ ...d, zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX) }), { noHistory: true });
}

export function setShowInMatrix(docId: string, itemId: string, show: boolean) {
  updateItem(docId, itemId, { showInMatrix: show });
}

export function setSubtreeShownInMatrix(docId: string, itemId: string, show: boolean) {
  updateTodo(docId, (d) => {
    const ids = new Set([itemId, ...descendantIds(d.items, itemId)]);
    return { ...d, items: d.items.map((i) => (ids.has(i.id) ? { ...i, showInMatrix: show } : i)) };
  });
}

/* ----------------------------------------------------------------- state */

function makePane(tabs: string[] = [], activeTabId: string | null = null): Pane {
  return { id: uid('pane'), tabs, activeTabId: activeTabId ?? tabs[0] ?? null };
}

function makeLayout(panes: Pane[] = [makePane()], kind: LayoutKind = 'single'): Layout {
  const spec = LAYOUTS[kind];
  return {
    kind,
    panes,
    activePaneId: panes[0].id,
    colSizes: even(spec.cols),
    rowSizes: even(spec.rows),
  };
}

function even(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

function emptyWorkspace(): Workspace {
  return {
    version: 1,
    docs: [],
    layout: makeLayout(),
    theme: 'dark',
    sidebarVisible: true,
    settings: { ...DEFAULT_SETTINGS },
    vaultPath: '',
    files: [],
    dirs: [],
  };
}

/** Documents written into a brand-new, empty vault so it is not a blank slate. */
function seedDocs(): Doc[] {
  const todo = makeTodoDoc('Product launch');
  const root = makeItem(null, {
    title: 'Ship v1',
    urgency: 8,
    importance: 9.5,
    weight: 9,
    color: '#6c7bff',
    status: 'in-progress',
    assignee: 'Team',
    properties: { Due: '2026-08-15' },
  });
  const a = makeItem(root.id, {
    title: 'Fix onboarding crash',
    urgency: 9.5,
    importance: 8.5,
    weight: 7,
    status: 'in-progress',
    assignee: 'Ana',
    properties: { Due: '2026-07-30' },
  });
  const b = makeItem(root.id, {
    title: 'Write launch post',
    urgency: 3.5,
    importance: 7,
    weight: 4,
    status: 'planned',
    assignee: 'Kim',
    color: '#4fbf7f',
  });
  const c = makeItem(b.id, {
    title: 'Draft outline',
    urgency: 4,
    importance: 5.5,
    weight: 2.5,
    status: 'done',
    assignee: 'Kim',
  });
  const d = makeItem(null, {
    title: 'Renew SSL certificate',
    urgency: 8.5,
    importance: 3,
    weight: 3,
    status: 'scheduled',
    assignee: 'Ops',
    color: '#e0a24d',
  });
  const e = makeItem(null, {
    title: 'Refactor legacy exporter',
    urgency: 2,
    importance: 2.5,
    weight: 5,
    status: 'planned',
    color: '#9aa3b5',
  });
  todo.items = [root, a, b, c, d, e];
  todo.propertyDefs = [
    { name: 'Due', type: 'date' },
    { name: 'Effort', type: 'number', display: 'bar', min: 0, max: 10 },
    { name: 'Area', type: 'select', options: ['Product', 'Ops', 'Growth'] },
  ];
  root.properties = { Due: '2026-08-15', Effort: '9', Area: 'Product' };
  a.properties = { Due: '2026-07-30', Effort: '6', Area: 'Product' };
  b.properties = { Due: '2026-08-10', Effort: '3', Area: 'Growth' };
  c.properties = { Effort: '1', Area: 'Growth' };
  d.properties = { Due: '2026-08-01', Effort: '2', Area: 'Ops' };
  e.properties = { Effort: '7', Area: 'Product' };
  // Grouping parents earn their keep in the tree, not on the board.
  root.showInMatrix = true;

  const note = makeNoteDoc(
    'Welcome',
    `# Welcome to MG

A local-first workspace with two document types: **Todo** and **Free note**.

## Todo documents
- **Eisenhower matrix** — cards are placed by *urgency* (x) and *importance* (y); card size is *weight*. Drag to move, drag the corner to resize, double-click to rename.
- **Tree / property table** — the same items as an indented tree with every property in editable columns.

## Free notes
- **Live preview** — markdown renders as you write; only the block holding the caret shows its source.
- **Source** and **Split** are there when you want them, plus a plain-text mode.

## Try it
Link to another document with [[Product launch]], tag things with #launch, and use callouts:

> [!tip] Keyboard
> \`Ctrl+P\` goto anything, \`Ctrl+Shift+P\` command palette, \`Ctrl+S\` save, \`Alt+Shift+2\` split into columns.

- [x] Read this note
- [ ] Make it yours

Notes are plain \`.md\` files in your vault folder, so Obsidian can read them too.
Todo documents use the app's own \`.mgtodo\` format.
`
  );

  return [todo, note];
}

let state: Workspace = emptyWorkspace();
let loaded = false;
const listeners = new Set<() => void>();

const undoStack: Workspace[] = [];
const redoStack: Workspace[] = [];
const MAX_HISTORY = 100;
let lastCoalesceKey: string | null = null;
let lastCoalesceAt = 0;

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getState(): Workspace {
  return state;
}

export function useWorkspace(): Workspace {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Snapshot accessor for code outside React (menu handlers, tests). */
export function getWorkspace(): Workspace {
  return state;
}

export function isLoaded(): boolean {
  return loaded;
}

/* ----------------------------------------------------------- persistence */

/**
 * Session shape written to `<vault>/.mg/session.json`. It holds the window
 * state *and* every open buffer, so unsaved edits survive a restart exactly
 * the way Sublime's hot exit does — closing the app never forces a save.
 */
interface SessionDoc {
  id: string;
  type: 'todo' | 'note';
  path: string | null;
  title: string;
  view: string;
  mdMode?: NoteDoc['mdMode'];
  /* Window state, kept out of the document body. */
  columnWidths?: Record<string, number>;
  columnDisplay?: Record<string, NumberDisplay>;
  sort?: SortSpec | null;
  axes?: MatrixAxes;
  zoom?: number;
  /** Current (possibly unsaved) content. */
  buffer: string;
  /** Content as last synced with disk. */
  saved: string | null;
  mtime: number | null;
}

interface Session {
  version: number;
  theme: 'dark' | 'light';
  sidebarVisible: boolean;
  settings?: Settings;
  layout: Layout;
  docs: SessionDoc[];
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveError: string | null = null;

function toSession(ws: Workspace): Session {
  return {
    version: 1,
    theme: ws.theme,
    sidebarVisible: ws.sidebarVisible,
    settings: ws.settings,
    layout: ws.layout,
    docs: ws.docs.map((d) => ({
      id: d.id,
      type: d.type,
      path: d.path,
      title: d.title,
      view: d.view,
      mdMode: d.type === 'note' ? d.mdMode : undefined,
      columnWidths: d.type === 'todo' ? d.columnWidths : undefined,
      columnDisplay: d.type === 'todo' ? d.columnDisplay : undefined,
      sort: d.type === 'todo' ? (d.sort ?? null) : undefined,
      axes: d.type === 'todo' ? d.axes : undefined,
      zoom: d.type === 'todo' ? d.zoom : undefined,
      buffer: serializeDoc(d),
      saved: d.saved,
      mtime: d.mtime,
    })),
  };
}

function schedulePersistSession() {
  if (!loaded || !window.api) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushSession();
  }, 400);
}

/** Writes the session immediately; used on quit so nothing is lost. */
export async function flushSession(): Promise<void> {
  if (!window.api) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const res = await window.api.session.write(toSession(state));
  const next = res.ok ? null : res.error ?? 'Session write failed';
  if (next !== saveError) {
    saveError = next;
    emit();
  }
}

export function getSaveError(): string | null {
  return saveError;
}

function docFromSession(sd: SessionDoc): Doc {
  const now = Date.now();
  const body = parseDocBody(sd.type, sd.title, sd.buffer);
  const file: DocFile = { path: sd.path, saved: sd.saved, mtime: sd.mtime };
  const base = { id: sd.id, createdAt: now, updatedAt: now, ...file };
  if (body.type === 'note') {
    return {
      ...base,
      ...body,
      title: sd.title,
      view: sd.view === 'plain' ? 'plain' : 'markdown',
      mdMode: sd.mdMode ?? 'live',
    } as NoteDoc;
  }
  return {
    ...base,
    ...body,
    title: sd.title,
    view: sd.view === 'tree' ? 'tree' : 'matrix',
    columnWidths: sd.columnWidths ?? {},
    columnDisplay: sd.columnDisplay ?? {},
    sort: sd.sort ?? null,
    axes: sd.axes ?? { ...DEFAULT_AXES },
    zoom: sd.zoom ?? 1,
  } as TodoDoc;
}

/** Builds a fresh open buffer from a file already on disk. */
export function docFromFile(rel: string, content: string, mtime: number): Doc {
  const type: 'todo' | 'note' = rel.toLowerCase().endsWith(TODO_EXT) ? 'todo' : 'note';
  const now = Date.now();
  const body = parseDocBody(type, baseName(rel), content);
  const doc = {
    id: uid('doc'),
    createdAt: now,
    updatedAt: now,
    path: rel,
    saved: null,
    mtime,
    ...body,
  } as Doc;
  // `saved` is the serialised form, so a freshly opened file reads as clean
  // even when the on-disk JSON was formatted differently.
  doc.saved = serializeDoc(doc);
  return doc;
}

export async function loadWorkspace(): Promise<void> {
  if (!window.api) {
    // Browser preview (vite without electron): keep everything in memory.
    const docs = seedDocs();
    state = {
      ...emptyWorkspace(),
      docs,
      layout: makeLayout([makePane(docs.map((d) => d.id), docs[0].id)]),
      vaultPath: '(in-memory preview)',
    };
    loaded = true;
    emit();
    return;
  }

  const vault = await window.api.vault.get();
  const sessionRes = await window.api.session.read();
  const session = sessionRes.data as Session | null;

  let docs: Doc[] = [];
  let layout: Layout;
  let theme: Workspace['theme'] = 'dark';
  let sidebarVisible = true;
  let settings: Settings = { ...DEFAULT_SETTINGS };

  if (session && Array.isArray(session.docs)) {
    docs = session.docs.map(docFromSession);
    layout = sanitizeLayout(session.layout, new Set(docs.map((d) => d.id)));
    theme = session.theme === 'light' ? 'light' : 'dark';
    sidebarVisible = session.sidebarVisible !== false;
    settings = readSettings(session.settings);
    docs = await reconcileWithDisk(docs);
  } else {
    // First run: plant the seed documents in the vault so it is not empty.
    docs = seedDocs();
    for (const doc of docs) {
      const rel = `${safeFileName(doc.title)}${extForType(doc.type)}`;
      const res = await window.api.file.write(rel, serializeDoc(doc));
      if (res.ok) {
        doc.path = rel;
        doc.mtime = res.mtime ?? null;
        doc.saved = serializeDoc(doc);
      }
    }
    layout = makeLayout([makePane(docs.map((d) => d.id), docs[0]?.id ?? null)]);
  }

  const listing = await window.api.vault.list();
  state = {
    version: 1,
    docs,
    layout,
    theme,
    sidebarVisible,
    settings,
    vaultPath: vault.path ?? '',
    files: listing.files ?? [],
    dirs: listing.dirs ?? [],
  };
  loaded = true;
  emit();
}

/**
 * Compares every restored buffer against the file on disk. A clean buffer
 * silently adopts external edits; a dirty one keeps the user's work and is
 * flagged as conflicted so the UI can say so.
 */
async function reconcileWithDisk(docs: Doc[]): Promise<Doc[]> {
  if (!window.api) return docs;
  const out: Doc[] = [];
  for (const doc of docs) {
    if (!doc.path) {
      out.push(doc);
      continue;
    }
    const stat = await window.api.file.stat(doc.path);
    if (!stat.exists) {
      out.push({ ...doc, missing: true });
      continue;
    }
    if (stat.mtime === doc.mtime) {
      out.push(doc);
      continue;
    }
    const read = await window.api.file.read(doc.path);
    if (!read.ok || read.content == null) {
      out.push({ ...doc, missing: true });
      continue;
    }
    if (isDirty(doc)) {
      out.push({ ...doc, conflict: true });
    } else {
      out.push(carryUiState(docFromFile(doc.path, read.content, read.mtime ?? 0), doc));
    }
  }
  return out;
}

/**
 * The fields that belong to the window rather than the file. Re-reading a
 * document from disk replaces its body, and undo restores a whole-workspace
 * snapshot — neither should disturb how the user is currently looking at it,
 * so both funnel through here.
 */
interface DocUi {
  view?: string;
  mdMode?: NoteDoc['mdMode'];
  columnWidths?: Record<string, number>;
  columnDisplay?: Record<string, NumberDisplay>;
  sort?: SortSpec | null;
  axes?: MatrixAxes;
  zoom?: number;
}

function pickUi(doc: Doc): DocUi {
  if (doc.type === 'note') return { view: doc.view, mdMode: doc.mdMode };
  return {
    view: doc.view,
    columnWidths: doc.columnWidths,
    columnDisplay: doc.columnDisplay,
    sort: doc.sort,
    axes: doc.axes,
    zoom: doc.zoom,
  };
}

function applyUi(doc: Doc, ui: DocUi): Doc {
  if (doc.type === 'note') {
    return {
      ...doc,
      view: ui.view === 'plain' ? 'plain' : 'markdown',
      mdMode: ui.mdMode ?? doc.mdMode,
    };
  }
  return {
    ...doc,
    view: ui.view === 'tree' ? 'tree' : 'matrix',
    columnWidths: ui.columnWidths ?? doc.columnWidths,
    columnDisplay: ui.columnDisplay ?? doc.columnDisplay,
    sort: ui.sort ?? doc.sort,
    axes: ui.axes ?? doc.axes,
    zoom: ui.zoom ?? doc.zoom,
  };
}

function carryUiState(fresh: Doc, prev: Doc): Doc {
  if (fresh.type !== prev.type) return { ...fresh, id: prev.id } as Doc;
  return applyUi({ ...fresh, id: prev.id } as Doc, pickUi(prev));
}

/** Re-applies the live window state onto a restored history snapshot. */
function keepUiAcross(snapshot: Workspace, current: Workspace): Workspace {
  const ui = new Map(current.docs.map((d) => [d.id, pickUi(d)]));
  let changed = false;
  const docs = snapshot.docs.map((d) => {
    const state = ui.get(d.id);
    if (!state) return d;
    const next = applyUi(d, state);
    if (next !== d) changed = true;
    return next;
  });
  return changed ? { ...snapshot, docs } : snapshot;
}

function sanitizeLayout(raw: Layout | undefined, known: Set<string>): Layout {
  const kind: LayoutKind = raw && LAYOUTS[raw.kind] ? raw.kind : 'single';
  const spec = LAYOUTS[kind];
  const wanted = paneCount(kind);

  let panes: Pane[] = (raw?.panes ?? []).map((p) => {
    const tabs = (p.tabs ?? []).filter((id) => known.has(id));
    return {
      id: p.id || uid('pane'),
      tabs,
      activeTabId: tabs.includes(p.activeTabId ?? '') ? p.activeTabId : tabs[0] ?? null,
    };
  });
  if (!panes.length) panes = [makePane()];
  while (panes.length < wanted) panes.push(makePane());
  if (panes.length > wanted) panes = collapsePanes(panes, wanted);

  const activePaneId = panes.some((p) => p.id === raw?.activePaneId)
    ? raw!.activePaneId
    : panes[0].id;

  return {
    kind,
    panes,
    activePaneId,
    colSizes: sanitizeSizes(raw?.colSizes, spec.cols),
    rowSizes: sanitizeSizes(raw?.rowSizes, spec.rows),
  };
}

function sanitizeSizes(sizes: number[] | undefined, n: number): number[] {
  if (!Array.isArray(sizes) || sizes.length !== n) return even(n);
  const clean = sizes.map((s) => (Number.isFinite(s) && s > 0.05 ? s : 1 / n));
  const total = clean.reduce((a, b) => a + b, 0);
  return clean.map((s) => s / total);
}

/** Shrinks a pane list to `wanted`, folding surplus tabs into the last kept pane. */
function collapsePanes(panes: Pane[], wanted: number): Pane[] {
  const kept = panes.slice(0, wanted);
  const surplus = panes.slice(wanted);
  const sink = kept[kept.length - 1];
  const extra = surplus.flatMap((p) => p.tabs).filter((id) => !sink.tabs.includes(id));
  kept[kept.length - 1] = {
    ...sink,
    tabs: [...sink.tabs, ...extra],
    activeTabId: sink.activeTabId ?? extra[0] ?? null,
  };
  return kept;
}

/* -------------------------------------------------------------- mutation */

interface CommitOpts {
  /** Consecutive mutations sharing a key within 700ms collapse into one undo step. */
  coalesce?: string;
  /** Skip the undo snapshot entirely (selection-like changes). */
  noHistory?: boolean;
}

function commit(next: Workspace, opts: CommitOpts = {}) {
  if (next === state) return;
  if (!opts.noHistory) {
    const now = Date.now();
    const coalesced =
      opts.coalesce != null && opts.coalesce === lastCoalesceKey && now - lastCoalesceAt < 700;
    if (!coalesced) {
      undoStack.push(state);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0;
    }
    lastCoalesceKey = opts.coalesce ?? null;
    lastCoalesceAt = now;
  }
  state = next;
  emit();
  schedulePersistSession();
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}
export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(state);
  // Undo rewinds document content, never how the user is viewing it.
  state = keepUiAcross(prev, state);
  lastCoalesceKey = null;
  emit();
  schedulePersistSession();
}

export function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(state);
  state = keepUiAcross(next, state);
  lastCoalesceKey = null;
  emit();
  schedulePersistSession();
}

function replaceDoc(docId: string, fn: (doc: Doc) => Doc, opts?: CommitOpts) {
  const idx = state.docs.findIndex((d) => d.id === docId);
  if (idx < 0) return;
  const updated = fn(state.docs[idx]);
  if (updated === state.docs[idx]) return;
  const docs = state.docs.slice();
  docs[idx] = { ...updated, updatedAt: Date.now() };
  commit({ ...state, docs }, opts);
}

function updateTodo(docId: string, fn: (doc: TodoDoc) => TodoDoc, opts?: CommitOpts) {
  replaceDoc(docId, (d) => (d.type === 'todo' ? fn(d) : d), opts);
}

/* ------------------------------------------------------------- doc verbs */

export function setTheme(theme: 'dark' | 'light') {
  commit({ ...state, theme }, { noHistory: true });
}

export function toggleTheme() {
  setTheme(state.theme === 'dark' ? 'light' : 'dark');
}

/* --------------------------------------------------------------- settings */

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const next = { ...state.settings, [key]: value } as Settings;
  if (key !== 'editorFont') {
    const bounds = SETTING_BOUNDS[key as keyof typeof SETTING_BOUNDS];
    if (bounds) {
      (next[key] as number) = clamp(Number(value), bounds[0], bounds[1]);
    }
  }
  commit({ ...state, settings: next }, { noHistory: true });
}

export function resetSettings() {
  commit({ ...state, settings: { ...DEFAULT_SETTINGS } }, { noHistory: true });
}

/** Fills in any setting added after a session file was written. */
function readSettings(raw: Partial<Settings> | undefined): Settings {
  const out = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  for (const [key, [lo, hi]] of Object.entries(SETTING_BOUNDS)) {
    const k = key as keyof typeof SETTING_BOUNDS;
    const n = Number(out[k]);
    out[k] = Number.isFinite(n) ? clamp(n, lo, hi) : DEFAULT_SETTINGS[k];
  }
  if (!EDITOR_FONT_STACKS[out.editorFont]) out.editorFont = DEFAULT_SETTINGS.editorFont;
  return out;
}

export function toggleSidebar() {
  commit({ ...state, sidebarVisible: !state.sidebarVisible }, { noHistory: true });
}

/* -------------------------------------------------------- pane/tab verbs */

function withLayout(fn: (l: Layout) => Layout, opts: CommitOpts = { noHistory: true }) {
  const layout = fn(state.layout);
  if (layout === state.layout) return;
  commit({ ...state, layout }, opts);
}

function mapPane(l: Layout, paneId: string, fn: (p: Pane) => Pane): Layout {
  const panes = l.panes.map((p) => (p.id === paneId ? fn(p) : p));
  return { ...l, panes };
}

export function activePane(ws: Workspace): Pane {
  return ws.layout.panes.find((p) => p.id === ws.layout.activePaneId) ?? ws.layout.panes[0];
}

export function activeDocId(ws: Workspace): string | null {
  return activePane(ws)?.activeTabId ?? null;
}

export function focusPane(paneId: string) {
  if (state.layout.activePaneId === paneId) return;
  withLayout((l) => ({ ...l, activePaneId: paneId }));
}

/** Opens a document as a tab. Focuses it if already open in some pane. */
export function openDoc(docId: string, paneId?: string) {
  withLayout((l) => {
    const existing = paneId ? null : l.panes.find((p) => p.tabs.includes(docId));
    const targetId = paneId ?? existing?.id ?? l.activePaneId;
    const panes = l.panes.map((p) =>
      p.id === targetId
        ? { ...p, tabs: p.tabs.includes(docId) ? p.tabs : [...p.tabs, docId], activeTabId: docId }
        : p
    );
    return { ...l, panes, activePaneId: targetId };
  });
}

export function activateTab(paneId: string, docId: string) {
  withLayout((l) => ({
    ...mapPane(l, paneId, (p) => (p.activeTabId === docId ? p : { ...p, activeTabId: docId })),
    activePaneId: paneId,
  }));
}

/** Tabs closed recently, newest last — powers Ctrl+Shift+T. */
const closedTabs: Array<{ paneId: string; docId: string; index: number; path: string | null }> = [];

export function closeTab(paneId: string, docId: string) {
  const doc = state.docs.find((d) => d.id === docId);
  withLayout((l) =>
    mapPane(l, paneId, (p) => {
      const index = p.tabs.indexOf(docId);
      if (index < 0) return p;
      closedTabs.push({ paneId, docId, index, path: doc?.path ?? null });
      if (closedTabs.length > 30) closedTabs.shift();
      const tabs = p.tabs.filter((t) => t !== docId);
      const activeTabId =
        p.activeTabId === docId ? tabs[Math.min(index, tabs.length - 1)] ?? null : p.activeTabId;
      return { ...p, tabs, activeTabId };
    })
  );
  releaseBuffer(docId);
}

/**
 * Once no pane shows a document, a clean saved buffer can be dropped — it is
 * re-read from disk if reopened. Dirty and never-saved buffers are kept so hot
 * exit can restore them.
 */
function releaseBuffer(docId: string) {
  const stillOpen = state.layout.panes.some((p) => p.tabs.includes(docId));
  if (stillOpen) return;
  const doc = state.docs.find((d) => d.id === docId);
  if (!doc || !doc.path || isDirty(doc)) return;
  commit({ ...state, docs: state.docs.filter((d) => d.id !== docId) }, { noHistory: true });
}

export function reopenClosedTab() {
  const last = closedTabs.pop();
  if (!last) return;
  if (!state.docs.some((d) => d.id === last.docId)) {
    // Buffer was released; bring the file back instead.
    if (last.path) void openFile(last.path, last.paneId);
    else reopenClosedTab();
    return;
  }
  withLayout((l) => {
    const target = l.panes.some((p) => p.id === last.paneId) ? last.paneId : l.activePaneId;
    return {
      ...mapPane(l, target, (p) => {
        if (p.tabs.includes(last.docId)) return { ...p, activeTabId: last.docId };
        const tabs = p.tabs.slice();
        tabs.splice(Math.min(last.index, tabs.length), 0, last.docId);
        return { ...p, tabs, activeTabId: last.docId };
      }),
      activePaneId: target,
    };
  });
}

/**
 * Closes a tab, prompting Save / Don't Save / Cancel when the buffer is dirty.
 * Returns false if the user cancelled.
 */
export async function requestCloseTab(paneId: string, docId: string): Promise<boolean> {
  const doc = state.docs.find((d) => d.id === docId);
  const shownElsewhere = state.layout.panes.some(
    (p) => p.id !== paneId && p.tabs.includes(docId)
  );
  if (!doc || shownElsewhere || !isDirty(doc) || !window.api) {
    closeTab(paneId, docId);
    return true;
  }
  const { choice } = await window.api.dialog.confirmClose(doc.title);
  if (choice === 'cancel') return false;
  if (choice === 'save') {
    const res = await saveDoc(docId);
    if (!res.ok) return false;
  } else {
    // Discarding: forget the buffer entirely rather than keeping it dirty.
    commit({ ...state, docs: state.docs.filter((d) => d.id !== docId) }, { noHistory: true });
  }
  closeTab(paneId, docId);
  return true;
}

export function closeOtherTabs(paneId: string, docId: string) {
  withLayout((l) => mapPane(l, paneId, (p) => ({ ...p, tabs: [docId], activeTabId: docId })));
}

export function closeTabsToRight(paneId: string, docId: string) {
  withLayout((l) =>
    mapPane(l, paneId, (p) => {
      const at = p.tabs.indexOf(docId);
      if (at < 0) return p;
      const tabs = p.tabs.slice(0, at + 1);
      return { ...p, tabs, activeTabId: tabs.includes(p.activeTabId ?? '') ? p.activeTabId : docId };
    })
  );
}

export function closeAllTabs(paneId: string) {
  withLayout((l) => mapPane(l, paneId, (p) => ({ ...p, tabs: [], activeTabId: null })));
}

/** Cycles the active tab within a pane. */
export function cycleTab(paneId: string, dir: -1 | 1) {
  withLayout((l) =>
    mapPane(l, paneId, (p) => {
      if (p.tabs.length < 2) return p;
      const at = p.tabs.indexOf(p.activeTabId ?? '');
      const next = (at + dir + p.tabs.length) % p.tabs.length;
      return { ...p, activeTabId: p.tabs[next] };
    })
  );
}

export function selectTabByIndex(paneId: string, index: number) {
  withLayout((l) =>
    mapPane(l, paneId, (p) => {
      const target = index === -1 ? p.tabs[p.tabs.length - 1] : p.tabs[index];
      return target ? { ...p, activeTabId: target } : p;
    })
  );
}

/** Drag-and-drop tab move, within a pane or across panes. */
export function moveTab(fromPaneId: string, docId: string, toPaneId: string, toIndex: number) {
  withLayout((l) => {
    const from = l.panes.find((p) => p.id === fromPaneId);
    if (!from || !from.tabs.includes(docId)) return l;
    const sameStrip = fromPaneId === toPaneId;
    if (sameStrip && from.tabs.indexOf(docId) === toIndex) return l;

    const panes = l.panes.map((p) => {
      if (p.id !== fromPaneId) return p;
      const tabs = p.tabs.filter((t) => t !== docId);
      const activeTabId =
        p.activeTabId === docId && !sameStrip
          ? tabs[Math.min(p.tabs.indexOf(docId), tabs.length - 1)] ?? null
          : p.activeTabId;
      return { ...p, tabs, activeTabId };
    });

    const target = panes.find((p) => p.id === toPaneId);
    if (!target) return l;
    const tabs = target.tabs.filter((t) => t !== docId);
    tabs.splice(clamp(toIndex, 0, tabs.length), 0, docId);
    const next = panes.map((p) => (p.id === toPaneId ? { ...p, tabs, activeTabId: docId } : p));
    return { ...l, panes: next, activePaneId: toPaneId };
  });
}

/** Sends the active tab of one pane to the neighbouring pane. */
export function moveActiveTabToPane(fromPaneId: string, toPaneId: string) {
  const from = state.layout.panes.find((p) => p.id === fromPaneId);
  if (!from?.activeTabId || fromPaneId === toPaneId) return;
  const to = state.layout.panes.find((p) => p.id === toPaneId);
  moveTab(fromPaneId, from.activeTabId, toPaneId, to ? to.tabs.length : 0);
}

export function setLayoutKind(kind: LayoutKind) {
  withLayout((l) => {
    if (l.kind === kind) return l;
    const spec = LAYOUTS[kind];
    const wanted = spec.cols * spec.rows;
    let panes = l.panes.slice();
    while (panes.length < wanted) panes.push(makePane());
    if (panes.length > wanted) panes = collapsePanes(panes, wanted);
    const activePaneId = panes.some((p) => p.id === l.activePaneId) ? l.activePaneId : panes[0].id;
    return { kind, panes, activePaneId, colSizes: even(spec.cols), rowSizes: even(spec.rows) };
  });
}

export function setSplitSizes(axis: 'col' | 'row', sizes: number[]) {
  withLayout((l) => ({ ...l, [axis === 'col' ? 'colSizes' : 'rowSizes']: sizes }) as Layout);
}

/* --------------------------------------------------------- doc lifecycle */

/** Next free "Untitled N" name, counting both open buffers and vault files. */
function untitledName(type: 'todo' | 'note'): string {
  const stem = type === 'todo' ? 'Untitled todo' : 'Untitled';
  const taken = new Set([
    ...state.docs.map((d) => d.title),
    ...state.files.map((f) => baseName(f.rel)),
  ]);
  if (!taken.has(stem)) return stem;
  for (let n = 2; n < 999; n++) if (!taken.has(`${stem} ${n}`)) return `${stem} ${n}`;
  return `${stem} ${Date.now()}`;
}

export function createTodoDoc(title?: string, paneId?: string): string {
  const doc = makeTodoDoc(title || untitledName('todo'));
  commit({ ...state, docs: [...state.docs, doc] });
  openDoc(doc.id, paneId ?? state.layout.activePaneId);
  return doc.id;
}

export function createNoteDoc(title?: string, content?: string, paneId?: string): string {
  const doc = makeNoteDoc(title || untitledName('note'), content ?? '');
  commit({ ...state, docs: [...state.docs, doc] });
  openDoc(doc.id, paneId ?? state.layout.activePaneId);
  return doc.id;
}

export function addDoc(doc: Doc) {
  commit({ ...state, docs: [...state.docs, doc] });
  openDoc(doc.id);
}

export function renameDoc(docId: string, title: string) {
  replaceDoc(docId, (d) => ({ ...d, title }), { coalesce: `rename:${docId}` });
}

/** Drops a buffer from the session. The file on disk is left untouched. */
export function closeDoc(docId: string) {
  const docs = state.docs.filter((d) => d.id !== docId);
  const panes = state.layout.panes.map((p) => {
    if (!p.tabs.includes(docId)) return p;
    const index = p.tabs.indexOf(docId);
    const tabs = p.tabs.filter((t) => t !== docId);
    return {
      ...p,
      tabs,
      activeTabId:
        p.activeTabId === docId ? tabs[Math.min(index, tabs.length - 1)] ?? null : p.activeTabId,
    };
  });
  commit({ ...state, docs, layout: { ...state.layout, panes } });
}

/** Copies a document to a new file beside the original and opens it. */
export async function duplicateDoc(docId: string): Promise<void> {
  const doc = state.docs.find((d) => d.id === docId);
  if (!doc) return;
  const now = Date.now();
  let copy: Doc;
  if (doc.type === 'todo') {
    const idMap = new Map(doc.items.map((i) => [i.id, uid('it')]));
    copy = {
      ...doc,
      id: uid('doc'),
      createdAt: now,
      updatedAt: now,
      items: doc.items.map((i) => ({
        ...i,
        id: idMap.get(i.id)!,
        parentId: i.parentId ? idMap.get(i.parentId) ?? null : null,
        properties: { ...i.properties },
      })),
    };
  } else {
    copy = { ...doc, id: uid('doc'), createdAt: now, updatedAt: now };
  }

  const folder = doc.path ? dirName(doc.path) : '';
  const wanted = `${folder ? folder + '/' : ''}${safeFileName(doc.title)}${extForType(doc.type)}`;
  const unique = window.api ? (await window.api.file.unique(wanted)).rel ?? wanted : wanted;
  copy.path = null;
  copy.title = baseName(unique);
  copy.saved = null;

  commit({ ...state, docs: [...state.docs, copy] });
  openDoc(copy.id);
  await saveDocAs(copy.id, unique);
}

export function setTodoView(docId: string, view: TodoView) {
  updateTodo(docId, (d) => (d.view === view ? d : { ...d, view }), { noHistory: true });
}

export function setNoteView(docId: string, view: NoteView) {
  replaceDoc(docId, (d) => (d.type === 'note' && d.view !== view ? { ...d, view } : d), {
    noHistory: true,
  });
}

export function setMdMode(docId: string, mdMode: NoteDoc['mdMode']) {
  replaceDoc(docId, (d) => (d.type === 'note' ? { ...d, mdMode } : d), { noHistory: true });
}

export function setNoteContent(docId: string, content: string) {
  replaceDoc(docId, (d) => (d.type === 'note' ? { ...d, content } : d), {
    coalesce: `note:${docId}`,
  });
}

/* ------------------------------------------------------------ item verbs */

export function addItem(docId: string, parentId: string | null, overrides?: Partial<TodoItem>): string {
  const item = makeItem(parentId, overrides);
  updateTodo(docId, (d) => {
    // Insert directly after the parent's existing subtree so it lands last.
    const items = d.items.slice();
    if (parentId) {
      const kids = descendantIds(items, parentId);
      const anchor = kids.length ? kids[kids.length - 1] : parentId;
      const at = items.findIndex((i) => i.id === anchor);
      items.splice(at + 1, 0, item);
    } else {
      items.push(item);
    }
    return { ...d, items: normalize(items) };
  });
  return item.id;
}

export function updateItem(
  docId: string,
  itemId: string,
  patch: Partial<TodoItem>,
  coalesce?: string
) {
  updateTodo(
    docId,
    (d) => ({
      ...d,
      items: d.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    }),
    coalesce ? { coalesce } : undefined
  );
}

/** Clamps and rounds the three numeric scales in one shot (used by the matrix). */
export function setMetrics(
  docId: string,
  itemId: string,
  metrics: { urgency?: number; importance?: number; weight?: number },
  coalesce?: string
) {
  const patch: Partial<TodoItem> = {};
  if (metrics.urgency != null) patch.urgency = round1(clamp(metrics.urgency, 1, 10));
  if (metrics.importance != null) patch.importance = round1(clamp(metrics.importance, 1, 10));
  if (metrics.weight != null) patch.weight = round1(clamp(metrics.weight, 1, 10));
  updateItem(docId, itemId, patch, coalesce);
}

export function deleteItem(docId: string, itemId: string) {
  updateTodo(docId, (d) => {
    const doomed = new Set([itemId, ...descendantIds(d.items, itemId)]);
    return { ...d, items: d.items.filter((i) => !doomed.has(i.id)) };
  });
}

export function toggleCollapse(docId: string, itemId: string) {
  updateTodo(
    docId,
    (d) => ({
      ...d,
      items: d.items.map((i) => (i.id === itemId ? { ...i, collapsed: !i.collapsed } : i)),
    }),
    { noHistory: true }
  );
}

export function setAllCollapsed(docId: string, collapsed: boolean) {
  updateTodo(
    docId,
    (d) => ({ ...d, items: d.items.map((i) => ({ ...i, collapsed })) }),
    { noHistory: true }
  );
}

/** Moves an item among its siblings. `dir` is -1 (up) or +1 (down). */
export function moveItem(docId: string, itemId: string, dir: -1 | 1) {
  updateTodo(docId, (d) => {
    const item = d.items.find((i) => i.id === itemId);
    if (!item) return d;
    const siblings = childrenOf(d.items, item.parentId);
    const pos = siblings.findIndex((s) => s.id === itemId);
    const target = siblings[pos + dir];
    if (!target) return d;
    const items = d.items.slice();
    const ia = items.findIndex((i) => i.id === itemId);
    const ib = items.findIndex((i) => i.id === target.id);
    [items[ia], items[ib]] = [items[ib], items[ia]];
    return { ...d, items: normalize(items) };
  });
}

/** Makes an item a child of its previous sibling. */
export function indentItem(docId: string, itemId: string) {
  updateTodo(docId, (d) => {
    const item = d.items.find((i) => i.id === itemId);
    if (!item) return d;
    const siblings = childrenOf(d.items, item.parentId);
    const pos = siblings.findIndex((s) => s.id === itemId);
    const prev = siblings[pos - 1];
    if (!prev) return d;
    const items = d.items.map((i) => (i.id === itemId ? { ...i, parentId: prev.id } : i));
    // Move to the end of the array so it becomes the new parent's last child.
    const idx = items.findIndex((i) => i.id === itemId);
    const [moved] = items.splice(idx, 1);
    items.push(moved);
    return {
      ...d,
      items: normalize(items).map((i) => (i.id === prev.id ? { ...i, collapsed: false } : i)),
    };
  });
}

/** Promotes an item to sit right after its former parent. */
export function outdentItem(docId: string, itemId: string) {
  updateTodo(docId, (d) => {
    const item = d.items.find((i) => i.id === itemId);
    if (!item || !item.parentId) return d;
    const parent = d.items.find((i) => i.id === item.parentId);
    if (!parent) return d;
    const items = d.items.map((i) => (i.id === itemId ? { ...i, parentId: parent.parentId } : i));
    const idx = items.findIndex((i) => i.id === itemId);
    const [moved] = items.splice(idx, 1);
    const pidx = items.findIndex((i) => i.id === parent.id);
    items.splice(pidx + 1, 0, moved);
    return { ...d, items: normalize(items) };
  });
}

export function canReparent(items: TodoItem[], itemId: string, newParentId: string | null): boolean {
  if (newParentId === null) return true;
  if (newParentId === itemId) return false;
  return !descendantIds(items, itemId).includes(newParentId);
}

/** Re-parents an item (with its subtree). `null` moves it to the root. */
export function reparentItem(docId: string, itemId: string, newParentId: string | null) {
  updateTodo(docId, (d) => {
    if (!canReparent(d.items, itemId, newParentId)) return d;
    const item = d.items.find((i) => i.id === itemId);
    if (!item || item.parentId === newParentId) return d;
    const items = d.items.map((i) =>
      i.id === itemId
        ? { ...i, parentId: newParentId }
        : i.id === newParentId
          ? { ...i, collapsed: false }
          : i
    );
    const idx = items.findIndex((i) => i.id === itemId);
    const [moved] = items.splice(idx, 1);
    items.push(moved);
    return { ...d, items: normalize(items) };
  });
}

/* ------------------------------------------------------- custom property */

export function setItemProperty(docId: string, itemId: string, key: string, value: string) {
  const k = key.trim();
  if (!k) return;
  updateTodo(
    docId,
    (d) => ({
      ...d,
      items: d.items.map((i) =>
        i.id === itemId ? { ...i, properties: { ...i.properties, [k]: value } } : i
      ),
    }),
    { coalesce: `prop:${itemId}:${k}` }
  );
}

export function renameItemProperty(docId: string, itemId: string, from: string, to: string) {
  const target = to.trim();
  if (!target || target === from) return;
  updateTodo(docId, (d) => ({
    ...d,
    items: d.items.map((i) => {
      if (i.id !== itemId || !(from in i.properties)) return i;
      const props: Record<string, string> = {};
      for (const [k, v] of Object.entries(i.properties)) props[k === from ? target : k] = v;
      return { ...i, properties: props };
    }),
  }));
}

export function removeItemProperty(docId: string, itemId: string, key: string) {
  updateTodo(docId, (d) => ({
    ...d,
    items: d.items.map((i) => {
      if (i.id !== itemId) return i;
      const props = { ...i.properties };
      delete props[key];
      return { ...i, properties: props };
    }),
  }));
}

/* --------------------------------------------------------- column sizing */

export function columnWidth(doc: TodoDoc, key: string): number {
  const stored = doc.columnWidths?.[key];
  return stored && stored > 0 ? stored : defaultColumnWidth(key);
}

/** Window state, so it never marks the document dirty and never lands in undo. */
export function setColumnWidth(docId: string, key: string, width: number) {
  const w = Math.max(minColumnWidth(key), Math.round(width));
  updateTodo(
    docId,
    (d) =>
      columnWidth(d, key) === w
        ? d
        : { ...d, columnWidths: { ...(d.columnWidths ?? {}), [key]: w } },
    { noHistory: true }
  );
}

export function resetColumnWidth(docId: string, key: string) {
  updateTodo(
    docId,
    (d) => {
      if (!d.columnWidths || !(key in d.columnWidths)) return d;
      const next = { ...d.columnWidths };
      delete next[key];
      return { ...d, columnWidths: next };
    },
    { noHistory: true }
  );
}

export function resetAllColumnWidths(docId: string) {
  updateTodo(docId, (d) => ({ ...d, columnWidths: {} }), { noHistory: true });
}

export function addPropertyColumn(docId: string, key: string, type: PropertyType = 'text') {
  const k = key.trim();
  if (!k) return;
  updateTodo(docId, (d) => {
    const defs = propertyDefsOf(d);
    if (defs.some((def) => def.name === k)) return d;
    const def: PropertyDef = { name: k, type };
    if (type === 'number') def.display = 'digit';
    if (type === 'select') def.options = [];
    return { ...d, propertyDefs: [...defs, def] };
  });
}

export function removePropertyColumn(docId: string, key: string) {
  updateTodo(docId, (d) => ({
    ...d,
    propertyDefs: propertyDefsOf(d).filter((def) => def.name !== key),
    items: d.items.map((i) => {
      if (!(key in i.properties)) return i;
      const props = { ...i.properties };
      delete props[key];
      return { ...i, properties: props };
    }),
  }));
}

export function renamePropertyColumn(docId: string, from: string, to: string) {
  const target = to.trim();
  if (!target || target === from) return;
  updateTodo(docId, (d) => {
    const defs = propertyDefsOf(d);
    if (defs.some((def) => def.name === target)) return d;
    return {
      ...d,
      propertyDefs: defs.map((def) => (def.name === from ? { ...def, name: target } : def)),
      items: d.items.map((i) => {
        if (!(from in i.properties)) return i;
        const props: Record<string, string> = {};
        for (const [k, v] of Object.entries(i.properties)) props[k === from ? target : k] = v;
        return { ...i, properties: props };
      }),
    };
  });
}

export function movePropertyColumn(docId: string, key: string, dir: -1 | 1) {
  updateTodo(docId, (d) => {
    const defs = propertyDefsOf(d);
    const at = defs.findIndex((def) => def.name === key);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= defs.length) return d;
    const next = defs.slice();
    [next[at], next[to]] = [next[to], next[at]];
    return { ...d, propertyDefs: next };
  });
}

/** Drops a property column at an arbitrary position (header drag-and-drop). */
export function reorderPropertyColumn(docId: string, key: string, toIndex: number) {
  updateTodo(docId, (d) => {
    const defs = propertyDefsOf(d);
    const from = defs.findIndex((def) => def.name === key);
    if (from < 0) return d;
    const next = defs.slice();
    const [moved] = next.splice(from, 1);
    // Removing first shifts everything after `from` left by one.
    const target = clamp(from < toIndex ? toIndex - 1 : toIndex, 0, next.length);
    next.splice(target, 0, moved);
    if (next.every((def, i) => def === defs[i])) return d;
    return { ...d, propertyDefs: next };
  });
}

/* --------------------------------------------------------------- lookups */

export function findDoc(ws: Workspace, id: string | null): Doc | null {
  if (!id) return null;
  return ws.docs.find((d) => d.id === id) ?? null;
}

/** Wikilink resolution: prefers an open buffer, then any file in the vault. */
export function findDocByTitle(ws: Workspace, title: string): Doc | null {
  const t = title.trim().toLowerCase();
  return ws.docs.find((d) => d.title.trim().toLowerCase() === t) ?? null;
}

export function findFileByTitle(ws: Workspace, title: string): VaultFile | null {
  const t = title.trim().toLowerCase();
  return (
    ws.files.find((f) => baseName(f.rel).toLowerCase() === t) ??
    ws.files.find((f) => f.rel.toLowerCase() === t.toLowerCase()) ??
    null
  );
}

export function docForPath(ws: Workspace, rel: string): Doc | null {
  return ws.docs.find((d) => d.path === rel) ?? null;
}

export function dirtyDocs(ws: Workspace): Doc[] {
  return ws.docs.filter(isDirty);
}

/* ------------------------------------------------------------ vault I/O */

async function refreshListing() {
  if (!window.api) return;
  const listing = await window.api.vault.list();
  if (!listing.ok) return;
  commit({ ...state, files: listing.files ?? [], dirs: listing.dirs ?? [] }, { noHistory: true });
}

export async function refreshVault(): Promise<void> {
  await refreshListing();
}

/** Opens a vault file, reusing the tab if that file is already open. */
export async function openFile(rel: string, paneId?: string): Promise<string | null> {
  const already = docForPath(state, rel);
  if (already) {
    openDoc(already.id, paneId);
    return already.id;
  }
  if (!window.api) return null;
  const res = await window.api.file.read(rel);
  if (!res.ok || res.content == null) {
    await window.api.dialog.message('Could not open file', res.error ?? rel);
    return null;
  }
  const doc = docFromFile(rel, res.content, res.mtime ?? 0);
  commit({ ...state, docs: [...state.docs, doc] });
  openDoc(doc.id, paneId ?? state.layout.activePaneId);
  return doc.id;
}

export interface SaveResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
}

/** Writes a buffer to its file, prompting for a location when it has none. */
export async function saveDoc(docId: string): Promise<SaveResult> {
  const doc = state.docs.find((d) => d.id === docId);
  if (!doc) return { ok: false, error: 'No such document' };
  if (!window.api) return { ok: false, error: 'Saving needs the desktop app' };
  if (!doc.path) return saveDocAsPrompt(docId);
  return writeDoc(doc, doc.path);
}

/** Save As with the system dialog, restricted to the vault. */
export async function saveDocAsPrompt(docId: string): Promise<SaveResult> {
  const doc = state.docs.find((d) => d.id === docId);
  if (!doc || !window.api) return { ok: false, error: 'Saving needs the desktop app' };
  const suggestion = doc.path ?? `${safeFileName(doc.title)}${extForType(doc.type)}`;
  const picked = await window.api.dialog.savePath(suggestion, doc.type);
  if (!picked.ok || !picked.rel) return { ok: false, canceled: true };
  return writeDoc(doc, picked.rel);
}

/** Save As to a known path, without a dialog. */
export async function saveDocAs(docId: string, rel: string): Promise<SaveResult> {
  const doc = state.docs.find((d) => d.id === docId);
  if (!doc) return { ok: false, error: 'No such document' };
  return writeDoc(doc, rel);
}

async function writeDoc(doc: Doc, rel: string): Promise<SaveResult> {
  if (!window.api) return { ok: false, error: 'Saving needs the desktop app' };
  const text = serializeDoc(doc);
  const res = await window.api.file.write(rel, text);
  if (!res.ok) return { ok: false, error: res.error };

  replaceDoc(
    doc.id,
    (d) => ({
      ...d,
      path: rel,
      title: baseName(rel),
      saved: text,
      mtime: res.mtime ?? null,
      missing: false,
      conflict: false,
    }),
    { noHistory: true }
  );
  await refreshListing();
  return { ok: true };
}

export async function saveAll(): Promise<{ saved: number; failed: number; needPrompt: number }> {
  let saved = 0;
  let failed = 0;
  let needPrompt = 0;
  for (const doc of state.docs.filter(isDirty)) {
    if (!doc.path) {
      needPrompt += 1;
      continue;
    }
    const res = await saveDoc(doc.id);
    if (res.ok) saved += 1;
    else failed += 1;
  }
  return { saved, failed, needPrompt };
}

/** Throws away buffer changes and re-reads the file. */
export async function revertDoc(docId: string): Promise<SaveResult> {
  const doc = state.docs.find((d) => d.id === docId);
  if (!doc?.path || !window.api) return { ok: false, error: 'Document has never been saved' };
  const res = await window.api.file.read(doc.path);
  if (!res.ok || res.content == null) return { ok: false, error: res.error };
  const fresh = docFromFile(doc.path, res.content, res.mtime ?? 0);
  replaceDoc(doc.id, (d) => carryUiState(fresh, d));
  return { ok: true };
}

/** Moves the file on disk and keeps the open buffer pointed at it. */
export async function renameFile(rel: string, nextName: string): Promise<SaveResult> {
  if (!window.api) return { ok: false, error: 'Renaming needs the desktop app' };
  const folder = dirName(rel);
  const ext = rel.toLowerCase().endsWith(TODO_EXT) ? TODO_EXT : NOTE_EXT;
  const clean = safeFileName(nextName.replace(/\.(md|mgtodo)$/i, ''));
  const target = `${folder ? folder + '/' : ''}${clean}${ext}`;
  if (target === rel) return { ok: true };

  const res = await window.api.file.rename(rel, target);
  if (!res.ok) return { ok: false, error: res.error };

  const open = docForPath(state, rel);
  if (open) {
    replaceDoc(open.id, (d) => ({ ...d, path: target, title: baseName(target) }), {
      noHistory: true,
    });
  }
  await refreshListing();
  return { ok: true };
}

/** Sends a file to the recycle bin and closes any buffer showing it. */
export async function deleteFile(rel: string): Promise<SaveResult> {
  if (!window.api) return { ok: false, error: 'Deleting needs the desktop app' };
  const res = await window.api.file.trash(rel);
  if (!res.ok) return { ok: false, error: res.error };
  const open = docForPath(state, rel);
  if (open) closeDoc(open.id);
  await refreshListing();
  return { ok: true };
}

export async function createFolder(rel: string): Promise<SaveResult> {
  if (!window.api) return { ok: false, error: 'Needs the desktop app' };
  const res = await window.api.file.mkdir(rel);
  if (!res.ok) return { ok: false, error: res.error };
  await refreshListing();
  return { ok: true };
}

export async function chooseVault(): Promise<SaveResult> {
  if (!window.api) return { ok: false, error: 'Needs the desktop app' };
  // Everything unsaved goes into the current vault's session before switching.
  await flushSession();
  const res = await window.api.vault.choose();
  if (!res.ok) return { ok: false, canceled: true };
  loaded = false;
  await loadWorkspace();
  return { ok: true };
}

/**
 * Re-reads the vault after an external change. Clean buffers pick up the new
 * content; dirty ones keep the user's edits and get flagged.
 */
export async function syncWithDisk(): Promise<void> {
  if (!window.api) return;
  const reconciled = await reconcileWithDisk(state.docs);
  const changed = reconciled.some((d, i) => d !== state.docs[i]);
  if (changed) commit({ ...state, docs: reconciled }, { noHistory: true });
  await refreshListing();
}
