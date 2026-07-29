import { useCallback, useMemo, useRef, useState } from 'react';
import {
  clamp,
  fmt,
  QUADRANT_COLOR,
  QUADRANT_LABEL,
  quadrantOf,
  minColumnWidth,
  NUMBER_DISPLAY_LABEL,
  NUMBER_DISPLAYS,
  PROPERTY_TYPE_LABEL,
  PROPERTY_TYPES,
  PropertyDef,
  round1,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUSES,
  TodoDoc,
  TodoItem,
} from '../types';
import * as S from '../store';
import { fraction, Range, rangeOf, scaleStyle } from '../scale';
import ContextMenu, { MenuEntry, MenuState } from './ContextMenu';
import Prompt, { PromptState } from './Prompt';
import PropertyInput from './PropertyInput';

interface Props {
  doc: TodoDoc;
  theme: 'dark' | 'light';
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const INDENT = 18;

interface Column {
  key: string;
  label: string;
  title?: string;
  def?: PropertyDef;
  className: string;
  /** Numeric columns accept the digit/bar/scale display modes. */
  numeric?: boolean;
  fixed?: boolean;
  sortable?: boolean;
}

export default function TreeTableView({ doc, theme, selectedId, onSelect }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [newColumn, setNewColumn] = useState('');
  const dragId = useRef<string | null>(null);
  const colRefs = useRef<Record<string, HTMLTableColElement | null>>({});
  const [resizing, setResizing] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  /** Row whose title input should take focus once it renders. */
  const [focusItem, setFocusItem] = useState<string | null>(null);
  /** Property column being dragged by its header, and the slot it would land in. */
  const dragCol = useRef<string | null>(null);
  const [colDropAt, setColDropAt] = useState<number | null>(null);

  const defs = useMemo(() => S.propertyDefsOf(doc), [doc]);
  const sort = doc.sort ?? null;

  // A sort is a flat ranking of every item; without one we show the tree.
  const rows = useMemo(() => {
    const live = S.liveItems(doc);
    if (!sort) return S.flattenTree(live, true);
    return live
      .slice()
      .sort(S.itemComparator(doc, sort))
      .map((item) => ({ item, depth: 0, hasChildren: false }));
  }, [doc, sort]);

  const columns = useMemo<Column[]>(() => {
    const spec: Record<string, Omit<Column, 'key'>> = {
      matrix: { label: '◧', title: 'Show on the matrix', className: 'col-matrix', sortable: true },
      title: { label: 'Item', className: 'col-title', sortable: true },
      quadrant: { label: 'Quadrant', title: 'Derived from urgency and importance', className: 'col-quadrant', sortable: true },
      status: { label: 'Status', className: 'col-status', sortable: true },
      assignee: { label: 'Assignee', className: 'col-assignee', sortable: true },
      urgency: { label: 'Urg', className: 'col-num', numeric: true, sortable: true },
      importance: { label: 'Imp', className: 'col-num', numeric: true, sortable: true },
      weight: { label: 'Wgt', className: 'col-num', numeric: true, sortable: true },
      color: { label: 'Color', className: 'col-color', sortable: true },
    };
    const byName = new Map(defs.map((d) => [d.name, d]));
    const cols = S.orderedColumnKeys(doc).map((key): Column => {
      if (spec[key]) return { key, ...spec[key] };
      const def = byName.get(key.slice(5));
      return {
        key,
        label: def?.name ?? key.slice(5),
        def,
        className: 'col-prop',
        numeric: def?.type === 'number',
        sortable: true,
      };
    });
    return [...cols, { key: 'actions', label: '', className: 'col-actions', fixed: true }];
  }, [doc, defs]);

  const widths = columns.map((c) => S.columnWidth(doc, c.key));
  const tableWidth = widths.reduce((a, b) => a + b, 0);

  /** Value ranges for the bar/scale encodings, computed once per render. */
  const ranges = useMemo(() => {
    const out: Record<string, Range> = {
      urgency: { min: 1, max: 10 },
      importance: { min: 1, max: 10 },
      weight: { min: 1, max: 10 },
    };
    for (const def of defs) {
      if (def.type !== 'number') continue;
      out[`prop:${def.name}`] = rangeOf(
        doc.items.map((i) => S.numericValue(doc, i, `prop:${def.name}`)),
        { min: def.min, max: def.max }
      );
    }
    return out;
  }, [doc, defs]);

  /* ------------------------------------------------------------ resizing */

  const startResize = useCallback(
    (key: string, startWidth: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const col = colRefs.current[key];
      const table = col?.closest('table') as HTMLTableElement | null;
      const startX = e.clientX;
      const min = minColumnWidth(key);
      let next = startWidth;

      const move = (ev: PointerEvent) => {
        next = Math.max(min, startWidth + (ev.clientX - startX));
        if (col) col.style.width = `${next}px`;
        if (table) table.style.width = `${tableWidth - startWidth + next}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing');
        setResizing(null);
        S.setColumnWidth(doc.id, key, next);
      };

      document.body.classList.add('resizing');
      setResizing(key);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [doc.id, tableWidth]
  );

  /* --------------------------------------------------------- header menu */

  const headerMenu = (col: Column, x: number, y: number): MenuState => {
    const order = S.orderedColumnKeys(doc);
    const entries: MenuEntry[] = [
      { label: 'Sort ascending', run: () => S.setSort(doc.id, { key: col.key, dir: 'asc' }) },
      { label: 'Sort descending', run: () => S.setSort(doc.id, { key: col.key, dir: 'desc' }) },
      {
        label: 'Clear sort',
        disabled: sort?.key !== col.key,
        run: () => S.setSort(doc.id, null),
      },
      { separator: true },
      { label: 'Reset width', run: () => S.resetColumnWidth(doc.id, col.key) },
      {
        label: 'Move column left',
        disabled: order.indexOf(col.key) <= 0,
        run: () => S.moveColumn(doc.id, col.key, order.indexOf(col.key) - 1),
      },
      {
        label: 'Move column right',
        disabled: order.indexOf(col.key) >= order.length - 1,
        run: () => S.moveColumn(doc.id, col.key, order.indexOf(col.key) + 2),
      },
      { label: 'Reset column order', run: () => S.resetColumnOrder(doc.id) },
    ];

    if (col.key === 'assignee') {
      entries.push({ separator: true });
      for (const t of ['text', 'select'] as const) {
        const on = (doc.assigneeType ?? 'text') === t;
        entries.push({
          label: `${on ? '✓ ' : '   '}Type: ${t === 'text' ? 'Text' : 'Options'}`,
          run: () => S.setAssigneeType(doc.id, t),
        });
      }
      entries.push({
        label: 'Edit people…',
        run: () =>
          setPrompt({
            title: 'People',
            hint: 'Comma separated. Used when Assignee is an options column, and to colour by assignee.',
            value: S.assigneeOptions(doc).join(', '),
            placeholder: 'Ana, Kim, Ravi',
            onSubmit: (v) => {
              S.setAssigneeOptions(doc.id, v.split(','));
              S.setAssigneeType(doc.id, 'select');
            },
          }),
      });
    }

    if (col.numeric) {
      entries.push({ separator: true });
      for (const mode of NUMBER_DISPLAYS) {
        const on = S.columnDisplay(doc, col.key) === mode;
        entries.push({
          label: `${on ? '✓ ' : '   '}Show as ${NUMBER_DISPLAY_LABEL[mode].toLowerCase()}`,
          run: () => S.setColumnDisplay(doc.id, col.key, mode),
        });
      }
    }

    if (col.def) {
      const name = col.def.name;
      entries.push({ separator: true });
      for (const type of PROPERTY_TYPES) {
        const on = col.def.type === type;
        entries.push({
          label: `${on ? '✓ ' : '   '}Type: ${PROPERTY_TYPE_LABEL[type]}`,
          run: () => S.setPropertyType(doc.id, name, type),
        });
      }
      if (col.def.type === 'select') {
        entries.push({
          label: 'Edit options…',
          run: () =>
            setPrompt({
              title: `Options for “${name}”`,
              hint: 'Comma separated. Existing values that are no longer options stay put and are flagged.',
              value: (col.def!.options ?? []).join(', '),
              placeholder: 'Draft, Review, Done',
              onSubmit: (v) => S.setPropertyOptions(doc.id, name, v.split(',')),
            }),
        });
      }
      if (col.def.type === 'number') {
        entries.push({
          label: 'Set bar/scale range…',
          run: () =>
            setPrompt({
              title: `Range for “${name}”`,
              hint: 'As min,max — leave blank to scale to the values in the column.',
              value:
                col.def!.min != null || col.def!.max != null
                  ? `${col.def!.min ?? ''},${col.def!.max ?? ''}`
                  : '',
              placeholder: '0,100',
              onSubmit: (v) => {
                const [lo, hi] = v.split(',').map((s) => Number(s.trim()));
                S.setPropertyBounds(
                  doc.id,
                  name,
                  Number.isFinite(lo) ? lo : undefined,
                  Number.isFinite(hi) ? hi : undefined
                );
              },
            }),
        });
      }
      entries.push(
        { separator: true },
        {
          label: 'Rename property…',
          run: () =>
            setPrompt({
              title: 'Rename property',
              value: name,
              confirmLabel: 'Rename',
              onSubmit: (v) => S.renamePropertyColumn(doc.id, name, v),
            }),
        },
        {
          label: 'Remove property',
          danger: true,
          run: () => {
            if (confirm(`Remove property "${name}" from all items?`))
              S.removePropertyColumn(doc.id, name);
          },
        }
      );
    }
    return { x, y, entries };
  };

  const rowMenu = (item: TodoItem, x: number, y: number): MenuState => ({
    x,
    y,
    entries: [
      { label: 'Add child', run: () => onSelect(S.addItem(doc.id, item.id)) },
      { label: 'Add sibling', run: () => onSelect(S.addItem(doc.id, item.parentId)) },
      { separator: true },
      {
        label: item.showInMatrix ? 'Hide from matrix' : 'Show on matrix',
        run: () => S.setShowInMatrix(doc.id, item.id, !item.showInMatrix),
      },
      {
        label: item.showInMatrix ? 'Hide subtree from matrix' : 'Show subtree on matrix',
        run: () => S.setSubtreeShownInMatrix(doc.id, item.id, !item.showInMatrix),
      },
      { separator: true },
      { label: 'Indent', detail: 'Tab', run: () => S.indentItem(doc.id, item.id) },
      { label: 'Outdent', detail: 'Shift+Tab', run: () => S.outdentItem(doc.id, item.id) },
      {
        label: 'Move up',
        disabled: !!sort,
        run: () => S.moveItem(doc.id, item.id, -1),
      },
      {
        label: 'Move down',
        disabled: !!sort,
        run: () => S.moveItem(doc.id, item.id, 1),
      },
      { label: 'Move to root', run: () => S.reparentItem(doc.id, item.id, null) },
      { separator: true },
      {
        label: item.color ? 'Inherit color from parent' : 'Color is inherited',
        disabled: !item.color,
        run: () => S.updateItem(doc.id, item.id, { color: null }),
      },
      { separator: true },
      {
        label: 'Delete (with children)',
        danger: true,
        run: () => {
          const kids = S.descendantIds(doc.items, item.id).length;
          const what = kids ? `"${item.title}" and ${kids} descendant${kids === 1 ? '' : 's'}` : `"${item.title}"`;
          if (!confirm(`Move ${what} to this document's trash?`)) return;
          S.deleteItem(doc.id, item.id);
          if (selectedId === item.id) onSelect(null);
        },
      },
    ],
  });

  const onRowKey = (e: React.KeyboardEvent, item: TodoItem) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) S.outdentItem(doc.id, item.id);
      else S.indentItem(doc.id, item.id);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Focus follows the new row, so you can keep typing down the list.
      const id = S.addItem(doc.id, item.parentId);
      onSelect(id);
      setFocusItem(id);
    } else if (e.altKey && e.key === 'ArrowUp' && !sort) {
      e.preventDefault();
      S.moveItem(doc.id, item.id, -1);
    } else if (e.altKey && e.key === 'ArrowDown' && !sort) {
      e.preventDefault();
      S.moveItem(doc.id, item.id, 1);
    }
  };

  const hiddenCount = doc.items.filter((i) => !i.showInMatrix).length;

  return (
    <div className="tree-view">
      <div className="view-toolbar">
        <button type="button" className="ghost-btn" onClick={() => onSelect(S.addItem(doc.id, null))}>
          + Root item
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={!selectedId}
          onClick={() => selectedId && onSelect(S.addItem(doc.id, selectedId))}
        >
          + Child
        </button>
        <span className="tb-sep" />
        <button type="button" className="ghost-btn" onClick={() => S.setAllCollapsed(doc.id, false)}>
          Expand all
        </button>
        <button type="button" className="ghost-btn" onClick={() => S.setAllCollapsed(doc.id, true)}>
          Collapse all
        </button>
        <button
          type="button"
          className="ghost-btn"
          title="Reset every column to its default width"
          onClick={() => S.resetAllColumnWidths(doc.id)}
        >
          Reset widths
        </button>
        {sort && (
          <button
            type="button"
            className="ghost-btn on"
            title="Rows are sorted; manual reordering is paused"
            onClick={() => S.setSort(doc.id, null)}
          >
            Sorted by {columns.find((c) => c.key === sort.key)?.label ?? sort.key}{' '}
            {sort.dir === 'asc' ? '▲' : '▼'} ✕
          </button>
        )}
        {hiddenCount > 0 && <span className="tb-hint">{hiddenCount} hidden from matrix</span>}
        <span className="tb-spacer" />
        <form
          className="col-add"
          onSubmit={(e) => {
            e.preventDefault();
            S.addPropertyColumn(doc.id, newColumn);
            setNewColumn('');
          }}
        >
          <input
            value={newColumn}
            placeholder="New property column"
            onChange={(e) => setNewColumn(e.target.value)}
            spellCheck={false}
          />
          <button type="submit" className="ghost-btn">
            Add
          </button>
        </form>
      </div>

      <div className="table-scroll">
        <table className="prop-table" style={{ width: tableWidth }}>
          <colgroup>
            {columns.map((col, i) => (
              <col
                key={col.key}
                ref={(el) => {
                  colRefs.current[col.key] = el;
                }}
                style={{ width: widths[i] }}
              />
            ))}
          </colgroup>
          <thead>
            <tr
              onDragOver={(e) => {
                if (dragId.current) {
                  e.preventDefault();
                  setDropTarget('__root__');
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId.current) S.reparentItem(doc.id, dragId.current, null);
                dragId.current = null;
                setDropTarget(null);
              }}
              className={dropTarget === '__root__' ? 'root-drop' : ''}
            >
              {columns.map((col, i) => {
                const sorted = sort?.key === col.key;
                const dropSide =
                  !col.fixed && colDropAt != null
                    ? colDropAt === i
                      ? 'before'
                      : colDropAt === i + 1 && i === columns.length - 2
                        ? 'after'
                        : ''
                    : '';
                return (
                  <th
                    key={col.key}
                    className={`${col.className}${sorted ? ' sorted' : ''}${
                      col.def ? ' draggable-col' : ''
                    }${dropSide ? ` drop-${dropSide}` : ''}`}
                    title={col.title ?? col.label}
                    // Any column reorders by dragging its header.
                    draggable={!col.fixed}
                    onDragStart={(e) => {
                      if (col.fixed) return;
                      dragCol.current = col.key;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', col.label);
                    }}
                    onDragEnd={() => {
                      dragCol.current = null;
                      setColDropAt(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragCol.current || col.fixed) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      setColDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
                    }}
                    onDrop={(e) => {
                      const key = dragCol.current;
                      if (!key || colDropAt == null) return;
                      e.preventDefault();
                      e.stopPropagation();
                      S.moveColumn(doc.id, key, colDropAt);
                      dragCol.current = null;
                      setColDropAt(null);
                    }}
                    onContextMenu={(e) => {
                      if (col.fixed) return;
                      e.preventDefault();
                      setMenu(headerMenu(col, e.clientX, e.clientY));
                    }}
                  >
                    <button
                      type="button"
                      className="th-label"
                      disabled={!col.sortable}
                      onClick={() => col.sortable && S.cycleSort(doc.id, col.key)}
                    >
                      {col.key === 'title' && dropTarget === '__root__'
                        ? 'Item — drop to move to root'
                        : col.label}
                      {sorted && <span className="sort-arrow">{sort!.dir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                    {!col.fixed && (
                      <button
                        type="button"
                        className="th-menu"
                        title="Column options"
                        onClick={(e) => setMenu(headerMenu(col, e.clientX, e.clientY))}
                      >
                        ⋮
                      </button>
                    )}
                    {!col.fixed && (
                      <span
                        className={`col-resizer${resizing === col.key ? ' active' : ''}`}
                        title="Drag to resize · double-click to reset"
                        onPointerDown={startResize(col.key, widths[i])}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          S.resetColumnWidth(doc.id, col.key);
                        }}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, depth, hasChildren }) => {
              const invalidDrop =
                dragId.current != null && !S.canReparent(doc.items, dragId.current, item.id);
              return (
                <tr
                  key={item.id}
                  className={`${selectedId === item.id ? 'sel ' : ''}${
                    item.status === 'done' ? 'done ' : ''
                  }${item.showInMatrix ? '' : 'off-matrix '}${
                    dropTarget === item.id ? (invalidDrop ? 'bad-drop' : 'good-drop') : ''
                  }`}
                  onClick={() => onSelect(item.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onSelect(item.id);
                    setMenu(rowMenu(item, e.clientX, e.clientY));
                  }}
                  draggable={!sort}
                  onDragStart={(e) => {
                    if (sort) return;
                    dragId.current = item.id;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', item.title);
                  }}
                  onDragEnd={() => {
                    dragId.current = null;
                    setDropTarget(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragId.current || dragId.current === item.id) return;
                    e.preventDefault();
                    setDropTarget(item.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = dragId.current;
                    dragId.current = null;
                    setDropTarget(null);
                    if (id && S.canReparent(doc.items, id, item.id)) S.reparentItem(doc.id, id, item.id);
                  }}
                >
                  {columns.map((col) => (
                    <Cell
                      key={col.key}
                      col={col}
                      doc={doc}
                      item={item}
                      depth={depth}
                      hasChildren={hasChildren}
                      theme={theme}
                      ranges={ranges}
                      sorted={Boolean(sort)}
                      focusItem={focusItem}
                      onFocused={() => setFocusItem(null)}
                      onSelect={onSelect}
                      onRowKey={onRowKey}
                      selectedId={selectedId}
                    />
                  ))}
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td className="table-empty" colSpan={columns.length}>
                  No items yet — add a root item to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
      {prompt && <Prompt state={prompt} onClose={() => setPrompt(null)} />}
    </div>
  );
}


/* ------------------------------------------------------------- one cell */

/**
 * Renders whichever column it is handed. Both the header row and the body map
 * over the same `columns` array, so reordering a column moves its data with it.
 */
function Cell({
  col,
  doc,
  item,
  depth,
  hasChildren,
  theme,
  ranges,
  sorted,
  focusItem,
  onFocused,
  onSelect,
  onRowKey,
  selectedId,
}: {
  col: Column;
  doc: TodoDoc;
  item: TodoItem;
  depth: number;
  hasChildren: boolean;
  theme: 'dark' | 'light';
  ranges: Record<string, Range>;
  sorted: boolean;
  focusItem: string | null;
  onFocused: () => void;
  onSelect: (id: string | null) => void;
  onRowKey: (e: React.KeyboardEvent, item: TodoItem) => void;
  selectedId: string | null;
}) {
  if (col.def) {
    return (
      <PropertyCell
        doc={doc}
        item={item}
        def={col.def}
        theme={theme}
        range={ranges[`prop:${col.def.name}`]}
      />
    );
  }

  switch (col.key) {
    case 'matrix':
      return (
        <td className="col-matrix">
          <input
            type="checkbox"
            className="matrix-check"
            checked={item.showInMatrix}
            title={item.showInMatrix ? 'Shown on the matrix' : 'Hidden from the matrix'}
            onChange={(e) => S.setShowInMatrix(doc.id, item.id, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
          />
        </td>
      );

    case 'title': {
      const color = S.resolveColor(doc.items, item);
      const inherited = !item.color;
      return (
        <td className="col-title">
          {/* Sorting flattens the list, so indentation and twisties go away. */}
          <div className="tree-cell" style={{ paddingLeft: sorted ? 0 : depth * INDENT }}>
            {!sorted && (
              <button
                type="button"
                className={`twisty${hasChildren ? '' : ' leaf'}${
                  hasChildren && !item.collapsed ? ' open' : ''
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasChildren) S.toggleCollapse(doc.id, item.id);
                }}
              >
                {hasChildren ? '▸' : '·'}
              </button>
            )}
            <span
              className={`row-swatch${inherited ? ' inherited' : ''}`}
              style={{ background: color }}
              title={inherited ? 'Inherited color' : 'Own color'}
            />
            <input
              className="cell-input title-input"
              ref={(el) => {
                if (el && focusItem === item.id) {
                  el.focus();
                  el.select();
                  onFocused();
                }
              }}
              value={item.title}
              onChange={(e) => S.updateItem(doc.id, item.id, { title: e.target.value }, `t:${item.id}`)}
              onKeyDown={(e) => onRowKey(e, item)}
              onFocus={() => onSelect(item.id)}
              spellCheck={false}
            />
          </div>
        </td>
      );
    }

    case 'quadrant': {
      const q = quadrantOf(item.urgency, item.importance);
      return (
        <td className="col-quadrant">
          <span
            className="quadrant-chip"
            style={{ ['--chip' as string]: QUADRANT_COLOR[q] }}
            title="Derived from urgency and importance — not editable"
          >
            {QUADRANT_LABEL[q]}
          </span>
        </td>
      );
    }

    case 'status':
      return (
        <td className="col-status">
          <select
            className="cell-select"
            value={item.status}
            style={{ color: STATUS_COLOR[item.status] }}
            onChange={(e) =>
              S.updateItem(doc.id, item.id, { status: e.target.value as TodoItem['status'] })
            }
          >
            {STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_LABEL[st]}
              </option>
            ))}
          </select>
        </td>
      );

    case 'assignee': {
      // Assignee can be a free-text field or a list of people to choose from.
      const options = S.assigneeOptions(doc);
      if (S.assigneeIsSelect(doc)) {
        const missing = item.assignee.trim() && !options.includes(item.assignee.trim());
        return (
          <td className="col-assignee">
            <select
              className={`cell-select${missing ? ' missing' : ''}`}
              value={item.assignee.trim()}
              onChange={(e) => S.updateItem(doc.id, item.id, { assignee: e.target.value })}
            >
              <option value="">—</option>
              {missing && <option value={item.assignee.trim()}>{item.assignee.trim()} (not an option)</option>}
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </td>
        );
      }
      return (
        <td className="col-assignee">
          <input
            className="cell-input"
            value={item.assignee}
            placeholder="—"
            onChange={(e) => S.updateItem(doc.id, item.id, { assignee: e.target.value }, `a:${item.id}`)}
            spellCheck={false}
          />
        </td>
      );
    }

    case 'urgency':
    case 'importance':
    case 'weight': {
      const field = col.key as 'urgency' | 'importance' | 'weight';
      return (
        <NumberCell
          display={S.columnDisplay(doc, field)}
          value={item[field]}
          range={ranges[field]}
          theme={theme}
          step={0.5}
          min={1}
          max={10}
          onCommit={(n) =>
            S.updateItem(doc.id, item.id, { [field]: round1(clamp(n, 1, 10)) }, `n:${item.id}:${field}`)
          }
        />
      );
    }

    case 'color': {
      const color = S.resolveColor(doc.items, item);
      const inherited = !item.color;
      return (
        <td className="col-color">
          <div className="color-cell">
            <input
              type="color"
              value={color}
              onChange={(e) => S.updateItem(doc.id, item.id, { color: e.target.value })}
              title={inherited ? 'Inherited — pick to override' : 'Own color'}
            />
            <button
              type="button"
              className="col-x"
              disabled={inherited}
              title="Inherit from parent"
              onClick={() => S.updateItem(doc.id, item.id, { color: null })}
            >
              ↺
            </button>
          </div>
        </td>
      );
    }

    case 'actions':
      return (
        <td className="col-actions">
          <button
            type="button"
            className="row-btn"
            title="Add child"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(S.addItem(doc.id, item.id));
            }}
          >
            +
          </button>
          <button
            type="button"
            className="row-btn"
            title="Outdent (Shift+Tab)"
            disabled={!item.parentId || sorted}
            onClick={(e) => {
              e.stopPropagation();
              S.outdentItem(doc.id, item.id);
            }}
          >
            ←
          </button>
          <button
            type="button"
            className="row-btn"
            title="Indent (Tab)"
            disabled={sorted}
            onClick={(e) => {
              e.stopPropagation();
              S.indentItem(doc.id, item.id);
            }}
          >
            →
          </button>
          <button
            type="button"
            className="row-btn"
            title={sorted ? 'Clear the sort to reorder manually' : 'Move up'}
            disabled={sorted}
            onClick={(e) => {
              e.stopPropagation();
              S.moveItem(doc.id, item.id, -1);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className="row-btn"
            title={sorted ? 'Clear the sort to reorder manually' : 'Move down'}
            disabled={sorted}
            onClick={(e) => {
              e.stopPropagation();
              S.moveItem(doc.id, item.id, 1);
            }}
          >
            ↓
          </button>
          <button
            type="button"
            className="row-btn danger"
            title="Move to trash"
            onClick={(e) => {
              e.stopPropagation();
              const kids = S.descendantIds(doc.items, item.id).length;
              const what = kids
                ? `"${item.title}" and ${kids} descendant${kids === 1 ? '' : 's'}`
                : `"${item.title}"`;
              if (!confirm(`Move ${what} to this document's trash?`)) return;
              S.deleteItem(doc.id, item.id);
              if (selectedId === item.id) onSelect(null);
            }}
          >
            ×
          </button>
        </td>
      );

    default:
      return <td />;
  }
}

/* ------------------------------------------------------------ number cell */

/**
 * A number that stays editable in every display mode. `bar` draws a thin meter
 * along the cell's baseline; `scale` tints the cell from the sequential ramp
 * and picks the label ink by measured contrast.
 */
function NumberCell({
  display,
  value,
  raw,
  range,
  theme,
  min,
  max,
  step,
  onCommit,
  onText,
}: {
  display: 'digit' | 'bar' | 'scale';
  value: number | null;
  /** Present for custom properties, which edit as free text. */
  raw?: string;
  range: Range;
  theme: 'dark' | 'light';
  min?: number;
  max?: number;
  step?: number;
  onCommit?: (n: number) => void;
  onText?: (v: string) => void;
}) {
  const has = value != null && Number.isFinite(value);
  const f = has ? fraction(value!, range) : 0;
  const tint = has && display === 'scale' ? scaleStyle(value!, range, theme) : null;
  const asText = Boolean(onText);

  return (
    <td className={`col-num num-cell ${display}`} style={tint ? { background: tint.background } : undefined}>
      <input
        className="cell-input num"
        type={asText ? 'text' : 'number'}
        min={asText ? undefined : min}
        max={asText ? undefined : max}
        step={asText ? undefined : step ?? 'any'}
        placeholder="—"
        value={asText ? (raw ?? '') : has ? fmt(value!) : ''}
        style={tint ? { color: tint.color } : undefined}
        onChange={(e) => {
          if (onText) return onText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onCommit?.(n);
        }}
      />
      {display === 'bar' && has && (
        <span className="meter" aria-hidden="true">
          <span className="meter-fill" style={{ width: `${Math.max(f * 100, 2)}%` }} />
        </span>
      )}
    </td>
  );
}

/* ---------------------------------------------------------- property cell */

function PropertyCell({
  doc,
  item,
  def,
  theme,
  range,
}: {
  doc: TodoDoc;
  item: TodoItem;
  def: PropertyDef;
  theme: 'dark' | 'light';
  range?: Range;
}) {
  const raw = item.properties[def.name] ?? '';
  const set = (v: string) => S.setItemProperty(doc.id, item.id, def.name, v);

  if (def.type === 'number') {
    const n = raw.trim() === '' ? null : Number(raw);
    return (
      <NumberCell
        display={def.display ?? 'digit'}
        value={n != null && Number.isFinite(n) ? n : null}
        raw={raw}
        range={range ?? { min: 0, max: 1 }}
        theme={theme}
        onText={set}
      />
    );
  }

  return (
    <td className="col-prop">
      <PropertyInput doc={doc} item={item} def={def} className="cell-input" />
    </td>
  );
}
