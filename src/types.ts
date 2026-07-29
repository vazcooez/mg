export type ItemStatus = 'planned' | 'scheduled' | 'in-progress' | 'done';

export const STATUSES: ItemStatus[] = ['planned', 'scheduled', 'in-progress', 'done'];

export const STATUS_LABEL: Record<ItemStatus, string> = {
  planned: 'Planned',
  scheduled: 'Scheduled',
  'in-progress': 'In progress',
  done: 'Done',
};

export const STATUS_COLOR: Record<ItemStatus, string> = {
  planned: '#8b93a7',
  scheduled: '#4d9de0',
  'in-progress': '#e0a24d',
  done: '#4fbf7f',
};

/** A single todo item. Hierarchy is expressed via `parentId`; order is array order. */
export interface TodoItem {
  id: string;
  parentId: string | null;
  title: string;
  assignee: string;
  /** 1-10, stored with one decimal of precision so matrix dragging stays smooth. */
  urgency: number;
  /** 1-10 */
  importance: number;
  /** 1-10, drives card size in the matrix. */
  weight: number;
  /** `null` means "inherit from parent" (falling back to the default accent). */
  color: string | null;
  status: ItemStatus;
  /** Long-form markdown notes for the item. */
  description: string;
  properties: Record<string, string>;
  collapsed: boolean;
  /** When set, the item is in the document's trash rather than deleted. */
  deletedAt: number | null;
  /**
   * Whether this item gets a card in the Eisenhower matrix. Grouping parents
   * are often structure rather than work, so they can be kept off the board
   * while still owning their children.
   */
  showInMatrix: boolean;
}

/* ------------------------------------------------ custom property schema */

export type PropertyType = 'text' | 'number' | 'date' | 'select';

/** How a number-typed property renders in the table. */
export type NumberDisplay = 'digit' | 'bar' | 'scale';

export interface PropertyDef {
  name: string;
  type: PropertyType;
  /** Choices for `select`. */
  options?: string[];
  /** Rendering for `number`; ignored for other types. */
  display?: NumberDisplay;
  /** Explicit bar/scale bounds; the data range is used when absent. */
  min?: number;
  max?: number;
}

export const PROPERTY_TYPES: PropertyType[] = ['text', 'number', 'date', 'select'];

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Options',
};

export const NUMBER_DISPLAYS: NumberDisplay[] = ['digit', 'bar', 'scale'];

export const NUMBER_DISPLAY_LABEL: Record<NumberDisplay, string> = {
  digit: 'Digits',
  bar: 'Bar',
  scale: 'Color scale',
};

/* --------------------------------------------------------------- sorting */

export interface SortSpec {
  /** Column id: a built-in key, or `prop:<name>`. */
  key: string;
  dir: 'asc' | 'desc';
}

/* ------------------------------------------------------- matrix geometry */

/** Which way the two scales run on the board. */
export interface MatrixAxes {
  /** Put importance on the horizontal axis and urgency on the vertical one. */
  swap: boolean;
  /** Horizontal axis counts down instead of up. */
  flipX: boolean;
  /** Vertical axis counts down instead of up (1 at the top). */
  flipY: boolean;
}

export const DEFAULT_AXES: MatrixAxes = { swap: false, flipX: false, flipY: false };

export type TodoView = 'matrix' | 'tree' | 'trash';
export type NoteView = 'plain' | 'markdown';

/* ------------------------------------------------------------- quadrant */

/**
 * The Eisenhower quadrant an item falls in. Derived from urgency and
 * importance rather than stored, so it can never drift out of step with the
 * board — and is therefore never editable.
 */
export type Quadrant = 'do' | 'delegate' | 'schedule' | 'drop';

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  do: 'Do now',
  delegate: 'Delegate',
  schedule: 'Schedule',
  drop: 'Drop',
};

/** Midpoint of the 1-10 scales. */
export const QUADRANT_MID = 5.5;

export function quadrantOf(urgency: number, importance: number): Quadrant {
  const urgent = urgency >= QUADRANT_MID;
  const important = importance >= QUADRANT_MID;
  if (important && urgent) return 'do';
  if (important) return 'schedule';
  if (urgent) return 'delegate';
  return 'drop';
}

export const QUADRANT_ORDER: Quadrant[] = ['do', 'schedule', 'delegate', 'drop'];

export const QUADRANT_COLOR: Record<Quadrant, string> = {
  do: '#e05d5d',
  schedule: '#6699cc',
  delegate: '#e0a24d',
  drop: '#8b9aa8',
};

/** Everything tying an open buffer to a file in the vault. */
export interface DocFile {
  /** Vault-relative path such as `Projects/Note.md`; null until first save. */
  path: string | null;
  /** Serialized content as last synced with disk; null for never-saved docs. */
  saved: string | null;
  /** Disk mtime at the last sync, used to spot external edits. */
  mtime: number | null;
  /** The file vanished from the vault while the buffer stayed open. */
  missing?: boolean;
  /** Disk changed underneath an already-dirty buffer. */
  conflict?: boolean;
}

export interface TodoDoc extends DocFile {
  id: string;
  type: 'todo';
  title: string;
  items: TodoItem[];
  /** Custom property schema, in column order. */
  propertyDefs: PropertyDef[];
  /*
   * Everything below is *window* state: it rides along in the session and is
   * deliberately excluded from `serializeDoc`, so changing a view, sorting a
   * column or dragging a column edge never dirties the buffer.
   */
  view: TodoView;
  /** Display order of every column, built-ins included. */
  columnOrder?: string[];
  /** What drives card colour on the matrix: own colour, or a property. */
  colorBy?: string;
  /** Column widths in px, keyed by column id (`prop:<name>` for properties). */
  columnWidths?: Record<string, number>;
  /** Display mode for the built-in numeric columns. */
  columnDisplay?: Record<string, NumberDisplay>;
  sort?: SortSpec | null;
  axes?: MatrixAxes;
  /** Matrix card scale. Purely visual — positions and values are untouched. */
  zoom?: number;
  createdAt: number;
  updatedAt: number;
}

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 3;

export const COLUMN_DEFAULTS: Record<string, number> = {
  title: 300,
  matrix: 52,
  status: 122,
  assignee: 140,
  urgency: 78,
  importance: 78,
  weight: 78,
  color: 82,
  actions: 152,
};

export const PROP_COLUMN_DEFAULT = 140;
export const COLUMN_MIN = 56;
export const TITLE_COLUMN_MIN = 150;

export function defaultColumnWidth(key: string): number {
  return COLUMN_DEFAULTS[key] ?? PROP_COLUMN_DEFAULT;
}

export function minColumnWidth(key: string): number {
  return key === 'title' ? TITLE_COLUMN_MIN : COLUMN_MIN;
}

export interface NoteDoc extends DocFile {
  id: string;
  type: 'note';
  title: string;
  content: string;
  view: NoteView;
  /**
   * Markdown editing mode. `live` is the Obsidian-style WYSIWYG editor where
   * every block renders except the one holding the caret, which shows source.
   */
  mdMode: 'live' | 'edit' | 'preview' | 'split';
  createdAt: number;
  updatedAt: number;
}

/* -------------------------------------------------------------- diagrams */

export type NodeShape = 'rect' | 'round' | 'ellipse' | 'diamond';

export const NODE_SHAPES: NodeShape[] = ['rect', 'round', 'ellipse', 'diamond'];

export const NODE_SHAPE_LABEL: Record<NodeShape, string> = {
  rect: 'Rectangle',
  round: 'Rounded',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export interface DiagramNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  shape: NodeShape;
  color: string;
}

export type EdgeStyle = 'solid' | 'dashed';
export type EdgeArrow = 'end' | 'both' | 'none';

/** Which side of a node an edge attaches to; `auto` picks the nearest. */
export type Port = 'auto' | 'top' | 'right' | 'bottom' | 'left';

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  style: EdgeStyle;
  arrow: EdgeArrow;
  fromPort: Port;
  toPort: Port;
}

export interface DiagramDoc extends DocFile {
  id: string;
  type: 'diagram';
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /* Window state. */
  zoom?: number;
  panX?: number;
  panY?: number;
  snap?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The three document kinds, as used for file extensions and icons. */
export type DocKindName = 'todo' | 'note' | 'diagram';

export const DIAGRAM_EXT = '.mgdiagram';

export const NODE_DEFAULT_W = 150;
export const NODE_DEFAULT_H = 66;
export const GRID = 10;

export type Doc = TodoDoc | NoteDoc | DiagramDoc;

/* ------------------------------------------------- sublime-style layout */

/** One editor group: an ordered tab strip plus the tab it is showing. */
export interface Pane {
  id: string;
  /** Document ids, in tab-strip order. */
  tabs: string[];
  activeTabId: string | null;
}

export type LayoutKind =
  | 'single'
  | 'columns-2'
  | 'columns-3'
  | 'rows-2'
  | 'rows-3'
  | 'grid-4';

export interface LayoutSpec {
  kind: LayoutKind;
  cols: number;
  rows: number;
  label: string;
  accelerator: string;
}

export const LAYOUTS: Record<LayoutKind, LayoutSpec> = {
  single: { kind: 'single', cols: 1, rows: 1, label: 'Single', accelerator: 'Alt+Shift+1' },
  'columns-2': { kind: 'columns-2', cols: 2, rows: 1, label: 'Columns: 2', accelerator: 'Alt+Shift+2' },
  'columns-3': { kind: 'columns-3', cols: 3, rows: 1, label: 'Columns: 3', accelerator: 'Alt+Shift+3' },
  'rows-2': { kind: 'rows-2', cols: 1, rows: 2, label: 'Rows: 2', accelerator: 'Alt+Shift+8' },
  'rows-3': { kind: 'rows-3', cols: 1, rows: 3, label: 'Rows: 3', accelerator: 'Alt+Shift+9' },
  'grid-4': { kind: 'grid-4', cols: 2, rows: 2, label: 'Grid: 4', accelerator: 'Alt+Shift+5' },
};

export function paneCount(kind: LayoutKind): number {
  const spec = LAYOUTS[kind];
  return spec.cols * spec.rows;
}

export interface Layout {
  kind: LayoutKind;
  panes: Pane[];
  activePaneId: string;
  /** Fractional column widths, length === LAYOUTS[kind].cols. */
  colSizes: number[];
  /** Fractional row heights, length === LAYOUTS[kind].rows. */
  rowSizes: number[];
}

/* -------------------------------------------------------------- settings */

export type EditorFont = 'mono' | 'sans' | 'serif';

export interface Settings {
  /** Whole-interface scale, applied as the window's zoom factor. */
  uiScale: number;
  /** Note editor and rendered markdown, in px. */
  editorFontSize: number;
  editorFont: EditorFont;
  /** Property table rows, in px. */
  tableFontSize: number;
  /** Sidebar and tab strip, in px. */
  chromeFontSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  uiScale: 1,
  editorFontSize: 14,
  editorFont: 'mono',
  tableFontSize: 12,
  chromeFontSize: 12,
};

export const EDITOR_FONT_STACKS: Record<EditorFont, string> = {
  mono: "'Cascadia Mono', 'Consolas', 'JetBrains Mono', ui-monospace, monospace",
  sans: "'Segoe UI', 'Inter', system-ui, sans-serif",
  serif: "'Georgia', 'Iowan Old Style', 'Times New Roman', serif",
};

export const EDITOR_FONT_LABEL: Record<EditorFont, string> = {
  mono: 'Monospace',
  sans: 'Sans serif',
  serif: 'Serif',
};

/** Keeps a setting inside its supported range. */
export const SETTING_BOUNDS: Record<keyof Omit<Settings, 'editorFont'>, [number, number]> = {
  uiScale: [0.6, 2],
  editorFontSize: [10, 28],
  tableFontSize: [9, 20],
  chromeFontSize: [9, 18],
};

export interface VaultFile {
  rel: string;
  name: string;
  type: DocKindName;
  mtime: number;
}

export interface VaultDir {
  rel: string;
  name: string;
}

export interface Workspace {
  version: number;
  /** Open buffers. A file in the vault is only here once it has been opened. */
  docs: Doc[];
  layout: Layout;
  theme: 'dark' | 'light';
  sidebarVisible: boolean;
  settings: Settings;
  /** Absolute path of the vault folder on disk. */
  vaultPath: string;
  /** Everything currently on disk in the vault, for the file explorer. */
  files: VaultFile[];
  dirs: VaultDir[];
}

export const NOTE_EXT = '.md';
export const TODO_EXT = '.mgtodo';

export function baseName(rel: string): string {
  const name = rel.split('/').pop() ?? rel;
  return name.replace(/\.(md|mgtodo|mgdiagram)$/i, '');
}

export function dirName(rel: string): string {
  const at = rel.lastIndexOf('/');
  return at < 0 ? '' : rel.slice(0, at);
}

/** Strips characters Windows refuses in filenames. */
export function safeFileName(title: string): string {
  return (title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled').slice(0, 120);
}

export const DEFAULT_COLOR = '#6c7bff';

export const COLOR_PRESETS = [
  '#6c7bff',
  '#4d9de0',
  '#4fbf7f',
  '#e0a24d',
  '#e05d5d',
  '#c264e0',
  '#43c6c6',
  '#9aa3b5',
];

/** Card edge length in px for a given weight (1-10). */
/**
 * Card edge lengths. Cards are centred on their data point, so the matrix
 * reserves a gutter of MAX_CARD/2 around the plot — keep `--m-gutter` in
 * styles.css in sync with half of MAX_CARD.
 */
export const MIN_CARD = 76;
export const MAX_CARD = 176;

/** Geometric mean of the card's edges — weight drives area, not one edge. */
export function weightToSize(weight: number): number {
  const w = clamp(weight, 1, 10);
  return MIN_CARD + ((w - 1) / 9) * (MAX_CARD - MIN_CARD);
}

export function sizeToWeight(size: number): number {
  const raw = 1 + ((size - MIN_CARD) / (MAX_CARD - MIN_CARD)) * 9;
  return round1(clamp(raw, 1, 10));
}

/** Cards are 2:1 landscape rectangles. */
export const CARD_RATIO = 2;

export function cardBox(weight: number, zoom = 1): { w: number; h: number } {
  const mean = weightToSize(weight) * zoom;
  const h = mean / Math.SQRT2;
  return { w: h * CARD_RATIO, h };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
