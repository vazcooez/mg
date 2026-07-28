import { useCallback, useMemo, useRef, useState } from 'react';
import {
  clamp,
  fmt,
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

  const defs = useMemo(() => S.propertyDefsOf(doc), [doc]);
  const sort = doc.sort ?? null;

  const rows = useMemo(
    () => S.flattenTree(doc.items, true, sort ? S.itemComparator(doc, sort) : undefined),
    [doc, sort]
  );

  const columns = useMemo<Column[]>(
    () => [
      { key: 'matrix', label: '◧', title: 'Show on the matrix', className: 'col-matrix', sortable: true },
      { key: 'title', label: 'Item', className: 'col-title', sortable: true },
      { key: 'status', label: 'Status', className: 'col-status', sortable: true },
      { key: 'assignee', label: 'Assignee', className: 'col-assignee', sortable: true },
      { key: 'urgency', label: 'Urg', className: 'col-num', numeric: true, sortable: true },
      { key: 'importance', label: 'Imp', className: 'col-num', numeric: true, sortable: true },
      { key: 'weight', label: 'Wgt', className: 'col-num', numeric: true, sortable: true },
      { key: 'color', label: 'Color', className: 'col-color', sortable: true },
      ...defs.map((def) => ({
        key: `prop:${def.name}`,
        label: def.name,
        def,
        className: 'col-prop',
        numeric: def.type === 'number',
        sortable: true,
      })),
      { key: 'actions', label: '', className: 'col-actions', fixed: true },
    ],
    [defs]
  );

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
    ];

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
          run: () => {
            const next = prompt(
              `Options for "${name}" (comma separated)`,
              (col.def!.options ?? []).join(', ')
            );
            if (next != null) S.setPropertyOptions(doc.id, name, next.split(','));
          },
        });
      }
      if (col.def.type === 'number') {
        entries.push({
          label: 'Set bar/scale range…',
          run: () => {
            const next = prompt(
              `Range for "${name}" as min,max — blank to use the data range`,
              col.def!.min != null || col.def!.max != null
                ? `${col.def!.min ?? ''},${col.def!.max ?? ''}`
                : ''
            );
            if (next == null) return;
            const [lo, hi] = next.split(',').map((s) => Number(s.trim()));
            S.setPropertyBounds(
              doc.id,
              name,
              Number.isFinite(lo) ? lo : undefined,
              Number.isFinite(hi) ? hi : undefined
            );
          },
        });
      }
      entries.push(
        { separator: true },
        {
          label: 'Rename property…',
          run: () => {
            const next = prompt('Property name', name);
            if (next) S.renamePropertyColumn(doc.id, name, next);
          },
        },
        { label: 'Move left', run: () => S.movePropertyColumn(doc.id, name, -1) },
        { label: 'Move right', run: () => S.movePropertyColumn(doc.id, name, 1) },
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
      onSelect(S.addItem(doc.id, item.parentId));
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
                return (
                  <th
                    key={col.key}
                    className={`${col.className}${sorted ? ' sorted' : ''}`}
                    title={col.title ?? col.label}
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
              const color = S.resolveColor(doc.items, item);
              const inherited = !item.color;
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
                  draggable
                  onDragStart={(e) => {
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

                  <td className="col-title">
                    <div className="tree-cell" style={{ paddingLeft: depth * INDENT }}>
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
                      <span
                        className={`row-swatch${inherited ? ' inherited' : ''}`}
                        style={{ background: color }}
                        title={inherited ? 'Inherited color' : 'Own color'}
                      />
                      <input
                        className="cell-input title-input"
                        value={item.title}
                        onChange={(e) => S.updateItem(doc.id, item.id, { title: e.target.value }, `t:${item.id}`)}
                        onKeyDown={(e) => onRowKey(e, item)}
                        onFocus={() => onSelect(item.id)}
                        spellCheck={false}
                      />
                    </div>
                  </td>

                  <td className="col-status">
                    <select
                      className="cell-select"
                      value={item.status}
                      style={{ color: STATUS_COLOR[item.status] }}
                      onChange={(e) =>
                        S.updateItem(doc.id, item.id, { status: e.target.value as TodoItem['status'] })
                      }
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="col-assignee">
                    <input
                      className="cell-input"
                      value={item.assignee}
                      placeholder="—"
                      onChange={(e) =>
                        S.updateItem(doc.id, item.id, { assignee: e.target.value }, `a:${item.id}`)
                      }
                      spellCheck={false}
                    />
                  </td>

                  {(['urgency', 'importance', 'weight'] as const).map((field) => (
                    <NumberCell
                      key={field}
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
                  ))}

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

                  {defs.map((def) => (
                    <PropertyCell
                      key={def.name}
                      doc={doc}
                      item={item}
                      def={def}
                      theme={theme}
                      range={ranges[`prop:${def.name}`]}
                    />
                  ))}

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
                      disabled={!item.parentId}
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
                      title={sort ? 'Clear the sort to reorder manually' : 'Move up'}
                      disabled={!!sort}
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
                      title={sort ? 'Clear the sort to reorder manually' : 'Move down'}
                      disabled={!!sort}
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
                      title="Delete with children"
                      onClick={(e) => {
                        e.stopPropagation();
                        S.deleteItem(doc.id, item.id);
                        if (selectedId === item.id) onSelect(null);
                      }}
                    >
                      ×
                    </button>
                  </td>
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
    </div>
  );
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
  range,
  theme,
  min,
  max,
  step,
  onCommit,
}: {
  display: 'digit' | 'bar' | 'scale';
  value: number | null;
  range: Range;
  theme: 'dark' | 'light';
  min?: number;
  max?: number;
  step?: number;
  onCommit: (n: number) => void;
}) {
  const has = value != null && Number.isFinite(value);
  const f = has ? fraction(value!, range) : 0;
  const tint = has && display === 'scale' ? scaleStyle(value!, range, theme) : null;

  return (
    <td className={`col-num num-cell ${display}`} style={tint ? { background: tint.background } : undefined}>
      <input
        className="cell-input num"
        type="number"
        min={min}
        max={max}
        step={step ?? 'any'}
        value={has ? fmt(value!) : ''}
        style={tint ? { color: tint.color } : undefined}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onCommit(n);
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
        range={range ?? { min: 0, max: 1 }}
        theme={theme}
        onCommit={(v) => set(String(v))}
      />
    );
  }

  if (def.type === 'date') {
    return (
      <td className="col-prop">
        <input
          className="cell-input date"
          type="date"
          value={/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? raw.trim() : ''}
          onChange={(e) => set(e.target.value)}
        />
      </td>
    );
  }

  if (def.type === 'select') {
    const options = def.options ?? [];
    const missing = raw.trim() && !options.includes(raw.trim());
    return (
      <td className="col-prop">
        <select
          className={`cell-select${missing ? ' missing' : ''}`}
          value={raw.trim()}
          onChange={(e) => set(e.target.value)}
        >
          <option value="">—</option>
          {missing && <option value={raw.trim()}>{raw.trim()} (not an option)</option>}
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
    <td className="col-prop">
      <input
        className="cell-input"
        value={raw}
        placeholder="—"
        onChange={(e) => set(e.target.value)}
        spellCheck={false}
      />
    </td>
  );
}
