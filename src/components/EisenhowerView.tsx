import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cardBox,
  clamp,
  fmt,
  round1,
  sizeToWeight,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUSES,
  TodoDoc,
  TodoItem,
  weightToSize,
} from '../types';
import * as S from '../store';
import PropertyInput from './PropertyInput';

interface Props {
  doc: TodoDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Maps the two scales onto screen axes. `swap` puts importance across the
 * bottom; `flipX`/`flipY` reverse a direction. Both the layout and the drag
 * maths read from here, so they can never disagree.
 */
interface Geometry {
  xField: 'urgency' | 'importance';
  yField: 'urgency' | 'importance';
  flipX: boolean;
  flipY: boolean;
}

function geometryOf(axes: { swap: boolean; flipX: boolean; flipY: boolean }): Geometry {
  return {
    xField: axes.swap ? 'importance' : 'urgency',
    yField: axes.swap ? 'urgency' : 'importance',
    flipX: axes.flipX,
    flipY: axes.flipY,
  };
}

/** Position of an item as percentages of the plot, honouring the orientation. */
function place(item: TodoItem, g: Geometry) {
  const xv = (item[g.xField] - 1) / 9;
  const yv = (item[g.yField] - 1) / 9;
  return {
    left: (g.flipX ? 1 - xv : xv) * 100,
    // Screen y grows downward, so the un-flipped axis is already inverted.
    top: (g.flipY ? yv : 1 - yv) * 100,
  };
}

/** Which quadrant sits in each corner, given the current orientation. */
function quadrantFor(corner: 'tl' | 'tr' | 'bl' | 'br', g: Geometry) {
  const xHigh = corner === 'tr' || corner === 'br';
  const yHigh = corner === 'tl' || corner === 'tr';
  const highX = g.flipX ? !xHigh : xHigh;
  const highY = g.flipY ? !yHigh : yHigh;
  const urgent = g.xField === 'urgency' ? highX : highY;
  const important = g.xField === 'urgency' ? highY : highX;

  if (important && urgent) return { key: 'do', tag: 'Do first', sub: 'important · urgent' };
  if (important && !urgent) return { key: 'schedule', tag: 'Schedule', sub: 'important · not urgent' };
  if (!important && urgent) return { key: 'delegate', tag: 'Delegate', sub: 'not important · urgent' };
  return { key: 'drop', tag: 'Drop', sub: 'not important · not urgent' };
}

type Gesture =
  | null
  | {
      kind: 'move';
      id: string;
      startX: number;
      startY: number;
      xValue: number;
      yValue: number;
      rect: DOMRect;
      moved: boolean;
    }
  | {
      kind: 'resize';
      id: string;
      startX: number;
      startY: number;
      size: number;
    };

export default function EisenhowerView({ doc, selectedId, onSelect }: Props) {
  const plotRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [snap, setSnap] = useState(false);
  const [showLinks, setShowLinks] = useState(true);

  const axes = S.axesOf(doc);
  const geo = geometryOf(axes);
  const zoom = S.zoomOf(doc);

  const live = S.liveItems(doc);
  const visible = live.filter((i) => i.showInMatrix && !(hideDone && i.status === 'done'));
  const visibleIds = new Set(visible.map((i) => i.id));
  const hiddenCount = live.length - visible.length;
  const colorBy = doc.colorBy ?? 'own';

  /* ------------------------------------------------------------ gestures */

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      if (g.kind === 'move') {
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        g.moved = true;
        // Screen delta → value delta, undoing whatever flips are in effect.
        const xDelta = (dx / g.rect.width) * 9 * (geo.flipX ? -1 : 1);
        const yDelta = (dy / g.rect.height) * 9 * (geo.flipY ? 1 : -1);
        let xValue = clamp(g.xValue + xDelta, 1, 10);
        let yValue = clamp(g.yValue + yDelta, 1, 10);
        if (snap !== e.altKey) {
          xValue = Math.round(xValue);
          yValue = Math.round(yValue);
        }
        S.setMetrics(
          doc.id,
          g.id,
          { [geo.xField]: xValue, [geo.yField]: yValue },
          `drag:${g.id}`
        );
      } else {
        // Divide by zoom so a corner drag feels the same at any scale.
        const delta = (e.clientX - g.startX + (e.clientY - g.startY)) / zoom;
        let weight = sizeToWeight(g.size + delta);
        if (snap !== e.altKey) weight = Math.round(weight);
        S.setMetrics(doc.id, g.id, { weight }, `resize:${g.id}`);
      }
    };
    const up = () => {
      if (!gesture.current) return;
      gesture.current = null;
      document.body.classList.remove('dragging');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [doc.id, snap, zoom, geo.xField, geo.yField, geo.flipX, geo.flipY]);

  /**
   * Wheel zooms the cards, not the board: positions, axes and values are
   * untouched — only the rendered card size and its type scale.
   */
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0012);
      S.setZoom(doc.id, S.zoomOf(S.getWorkspace().docs.find((d) => d.id === doc.id) as TodoDoc) * factor);
    };
    pad.addEventListener('wheel', onWheel, { passive: false });
    return () => pad.removeEventListener('wheel', onWheel);
  }, [doc.id]);

  const startMove = useCallback(
    (item: TodoItem) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('.card-resize, input, textarea, button, select')) return;
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect) return;
      onSelect(item.id);
      gesture.current = {
        kind: 'move',
        id: item.id,
        startX: e.clientX,
        startY: e.clientY,
        xValue: item[geo.xField],
        yValue: item[geo.yField],
        rect,
        moved: false,
      };
      document.body.classList.add('dragging');
    },
    [onSelect, geo.xField, geo.yField]
  );

  const startResize = useCallback(
    (item: TodoItem) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      onSelect(item.id);
      gesture.current = {
        kind: 'resize',
        id: item.id,
        startX: e.clientX,
        startY: e.clientY,
        size: weightToSize(item.weight),
      };
      document.body.classList.add('dragging');
    },
    [onSelect]
  );

  /* ------------------------------------------- keyboard nudge / shortcuts */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId || editingId) return;
      // Chords belong to the app and the menu: Ctrl+- is "smaller font", not
      // "shrink this card". Bare keys only.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const item = doc.items.find((i) => i.id === selectedId);
      if (!item) return;

      const step = e.shiftKey ? 1 : 0.1;
      const nudge = (du: number, di: number) => {
        e.preventDefault();
        S.setMetrics(
          doc.id,
          item.id,
          { urgency: item.urgency + du, importance: item.importance + di },
          `nudge:${item.id}`
        );
      };
      if (e.key === 'ArrowLeft') return nudge(-step, 0);
      if (e.key === 'ArrowRight') return nudge(step, 0);
      if (e.key === 'ArrowUp') return nudge(0, step);
      if (e.key === 'ArrowDown') return nudge(0, -step);
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        S.setMetrics(doc.id, item.id, { weight: item.weight + step }, `w:${item.id}`);
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        S.setMetrics(doc.id, item.id, { weight: item.weight - step }, `w:${item.id}`);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        setEditingId(item.id);
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        const kids = S.descendantIds(doc.items, item.id).length;
        const what = kids ? `"${item.title}" and ${kids} descendant${kids === 1 ? '' : 's'}` : `"${item.title}"`;
        if (!confirm(`Move ${what} to this document's trash?`)) return;
        S.deleteItem(doc.id, item.id);
        onSelect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc.id, doc.items, selectedId, editingId, onSelect]);

  /* --------------------------------------------------------------- render */

  const addAt = (e: React.MouseEvent) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || e.target !== e.currentTarget) return;
    let fx = (e.clientX - rect.left) / rect.width;
    let fy = 1 - (e.clientY - rect.top) / rect.height;
    if (geo.flipX) fx = 1 - fx;
    if (geo.flipY) fy = 1 - fy;
    const id = S.addItem(doc.id, null, {
      title: 'New item',
      [geo.xField]: round1(clamp(1 + fx * 9, 1, 10)),
      [geo.yField]: round1(clamp(1 + fy * 9, 1, 10)),
    });
    onSelect(id);
    setEditingId(id);
  };

  const xLabel = geo.xField === 'urgency' ? 'Urgency' : 'Importance';
  const yLabel = geo.yField === 'urgency' ? 'Urgency' : 'Importance';
  const corners = ['tl', 'tr', 'bl', 'br'] as const;

  return (
    <div className="matrix-view">
      <div className="view-toolbar">
        <button type="button" className="ghost-btn" onClick={() => {
          const id = S.addItem(doc.id, null);
          onSelect(id);
          setEditingId(id);
        }}>
          + Item
        </button>
        <span className="tb-sep" />
        <label className="tb-check">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          Snap to whole numbers
        </label>
        <label className="tb-check">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide done
        </label>
        <label className="tb-check">
          <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
          Parent links
        </label>
        <span className="tb-sep" />
        <label className="tb-check color-by">
          Colour by
          <select value={colorBy} onChange={(e) => S.setColorBy(doc.id, e.target.value)}>
            {S.colorByOptions(doc).map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="tb-sep" />
        <div className="axis-controls" role="group" aria-label="Matrix orientation">
          <button
            type="button"
            className={axes.swap ? 'on' : ''}
            title="Swap the axes — put importance across the bottom"
            onClick={() => S.setAxes(doc.id, { swap: !axes.swap })}
          >
            ⇄ Swap
          </button>
          <button
            type="button"
            className={axes.flipX ? 'on' : ''}
            title={`Reverse the horizontal axis (${xLabel})`}
            onClick={() => S.setAxes(doc.id, { flipX: !axes.flipX })}
          >
            ⇋ Flip {xLabel.toLowerCase()}
          </button>
          <button
            type="button"
            className={axes.flipY ? 'on' : ''}
            title={`Reverse the vertical axis (${yLabel})`}
            onClick={() => S.setAxes(doc.id, { flipY: !axes.flipY })}
          >
            ⇅ Flip {yLabel.toLowerCase()}
          </button>
          {(axes.swap || axes.flipX || axes.flipY) && (
            <button type="button" title="Back to the standard orientation" onClick={() => S.resetAxes(doc.id)}>
              Reset
            </button>
          )}
        </div>
        <span className="tb-sep" />
        <div className="zoom-controls">
          <button type="button" title="Smaller cards" onClick={() => S.setZoom(doc.id, zoom / 1.2)}>
            −
          </button>
          <button
            type="button"
            className="zoom-value"
            title="Reset card size to 100%"
            onClick={() => S.setZoom(doc.id, 1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" title="Larger cards" onClick={() => S.setZoom(doc.id, zoom * 1.2)}>
            +
          </button>
        </div>
        <span className="tb-spacer" />
        {hiddenCount > 0 && (
          <span className="tb-hint">{hiddenCount} hidden</span>
        )}
        <span className="tb-hint">
          scroll to zoom · drag to move · corner to resize · <kbd>Alt</kbd> inverts snap
        </span>
      </div>

      <div className="matrix-frame">
        <div className="axis-label axis-y">
          {yLabel} <span className="axis-arrow">{geo.flipY ? '↓' : '↑'}</span>
        </div>
        <div className="axis-label axis-x">
          {xLabel} <span className="axis-arrow">{geo.flipX ? '←' : '→'}</span>
        </div>

        <div className="matrix-pad" ref={padRef}>
          {/* Quadrants span the full area; the plot is inset by the card gutter
              but shares the same centre, so the cross still sits at 5.5/5.5.
              Which quadrant lands in which corner follows the orientation. */}
          {corners.map((corner) => {
            const q = quadrantFor(corner, geo);
            return (
              <div key={corner} className={`quad q-${corner} quad-${q.key}`}>
                <span className="quad-tag">{q.tag}</span>
                <span className="quad-sub">{q.sub}</span>
              </div>
            );
          })}

          <div className="matrix-plot" ref={plotRef} onDoubleClick={addAt} onClick={(e) => {
            if (e.target === e.currentTarget) onSelect(null);
          }}>
            {showLinks && (
              <svg className="link-layer">
                {visible.map((item) => {
                  if (!item.parentId || !visibleIds.has(item.parentId)) return null;
                  const parent = live.find((p) => p.id === item.parentId)!;
                  const a = place(parent, geo);
                  const b = place(item, geo);
                  return (
                    <line
                      key={item.id}
                      x1={`${a.left}%`}
                      y1={`${a.top}%`}
                      x2={`${b.left}%`}
                      y2={`${b.top}%`}
                      stroke={S.resolveColor(doc.items, parent)}
                    />
                  );
                })}
              </svg>
            )}

            {visible.map((item) => (
              <Card
                key={item.id}
                doc={doc}
                item={item}
                geo={geo}
                zoom={zoom}
                selected={selectedId === item.id}
                editing={editingId === item.id}
                onEditDone={() => setEditingId(null)}
                onStartEdit={() => setEditingId(item.id)}
                onPointerDown={startMove(item)}
                onResizeDown={startResize(item)}
              />
            ))}
          </div>
        </div>

        <div className="scale-mark scale-x-min">1</div>
        <div className="scale-mark scale-x-max">10</div>
        <div className="scale-mark scale-y-min">1</div>
        <div className="scale-mark scale-y-max">10</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the card */

function Card({
  doc,
  item,
  geo,
  zoom,
  selected,
  editing,
  onEditDone,
  onStartEdit,
  onPointerDown,
  onResizeDown,
}: {
  doc: TodoDoc;
  item: TodoItem;
  geo: Geometry;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onEditDone: () => void;
  onStartEdit: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeDown: (e: React.PointerEvent) => void;
}) {
  const box = cardBox(item.weight, zoom);
  const { left, top } = place(item, geo);
  const color = S.cardColor(doc, item);
  const inherited = !item.color;
  const defs = S.propertyDefsOf(doc);
  // Ancestors give the card its place in the tree at a glance.
  const trail = S.ancestorsOf(doc.items, item.id)
    .reverse()
    .map((a) => a.title);

  return (
    <div
      className={`ecard${selected ? ' selected' : ''}${item.status === 'done' ? ' done' : ''}${
        inherited ? ' inherited' : ''
      }${editing ? ' editing' : ''}`}
      style={{
        left: `${left}%`,
        top: `${top}%`,
        // While editing the card grows into a form, so it drops its fixed box.
        width: editing ? undefined : box.w,
        height: editing ? undefined : box.h,
        // Larger cards sit underneath so small ones stay clickable.
        zIndex: editing ? 1000 : selected ? 999 : 200 - Math.round(item.weight * 10),
        ['--card-color' as string]: color,
        // Every inner size is in em, so type scales with the card. The editor
        // stays at a fixed, readable size whatever the zoom.
        fontSize: editing ? '12px' : `${12 * zoom}px`,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
      title={`${item.title}\nurgency ${fmt(item.urgency)} · importance ${fmt(
        item.importance
      )} · weight ${fmt(item.weight)}`}
    >
      <div className="ecard-top">
        <span className="ecard-status" style={{ background: STATUS_COLOR[item.status] }} />
        {trail.length > 0 && (
          <span className="ecard-path" title={[...trail, item.title].join(' › ')}>
            {trail.join(' › ')}
          </span>
        )}
        {item.assignee && <span className="ecard-assignee">{item.assignee}</span>}
      </div>

      {editing ? (
        <div
          className="ecard-editor"
          // Keep every gesture inside the form: no dragging the card by its own editor.
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onEditDone();
            e.stopPropagation();
          }}
        >
          <textarea
            className="ecard-edit"
            autoFocus
            rows={2}
            value={item.title}
            placeholder="Title"
            spellCheck={false}
            onChange={(e) =>
              S.updateItem(doc.id, item.id, { title: e.target.value }, `t:${item.id}`)
            }
            onKeyDown={(e) => {
              // Titles are single-line; Enter commits rather than inserting one.
              if (e.key === 'Enter') {
                e.preventDefault();
                onEditDone();
              }
            }}
          />

          <label className="ecard-field">
            <span>Status</span>
            <select
              value={item.status}
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
          </label>

          <label className="ecard-field">
            <span>Assignee</span>
            <input
              value={item.assignee}
              placeholder="Unassigned"
              spellCheck={false}
              onChange={(e) =>
                S.updateItem(doc.id, item.id, { assignee: e.target.value }, `a:${item.id}`)
              }
            />
          </label>

          {defs.map((def) => (
            <label className="ecard-field" key={def.name}>
              <span title={def.name}>{def.name}</span>
              <PropertyInput doc={doc} item={item} def={def} className="" />
            </label>
          ))}

          <div className="ecard-editor-foot">
            <span className="ecard-metrics">
              U{fmt(item.urgency)} · I{fmt(item.importance)} · W{fmt(item.weight)}
            </span>
            <button type="button" className="ghost-btn" onClick={onEditDone}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="ecard-title">{item.title}</div>

          <div className="ecard-foot">
            <span title={STATUS_LABEL[item.status]}>U{fmt(item.urgency)}</span>
            <span>I{fmt(item.importance)}</span>
            <span>W{fmt(item.weight)}</span>
          </div>

          <div className="card-resize" onPointerDown={onResizeDown} title="Drag to change weight" />
        </>
      )}
    </div>
  );
}
