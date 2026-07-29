import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clamp,
  COLOR_PRESETS,
  DiagramDoc,
  DiagramNode,
  EdgeArrow,
  EdgeStyle,
  GRID,
  NODE_DEFAULT_H,
  NODE_DEFAULT_W,
  NODE_SHAPE_LABEL,
  NODE_SHAPES,
  Port,
} from '../types';
import * as S from '../store';
import ContextMenu, { MenuState } from './ContextMenu';

type Selection = { kind: 'node' | 'edge'; id: string } | null;

type Drag =
  | null
  | { kind: 'move'; id: string; dx: number; dy: number; others: Array<{ id: string; dx: number; dy: number }> }
  | { kind: 'resize'; id: string; x: number; y: number; w: number; h: number; sx: number; sy: number }
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'connect'; from: string; fromPort: Port; x: number; y: number }
  | { kind: 'marquee'; sx: number; sy: number; x: number; y: number };

const PORTS: Exclude<Port, 'auto'>[] = ['top', 'right', 'bottom', 'left'];

/** Anchor point of a port on a node, in diagram coordinates. */
function portPoint(n: DiagramNode, port: Port, towards?: { x: number; y: number }) {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  let p = port;
  if (p === 'auto') {
    const tx = towards?.x ?? cx;
    const ty = towards?.y ?? cy;
    p = Math.abs(tx - cx) * n.h > Math.abs(ty - cy) * n.w ? (tx > cx ? 'right' : 'left') : ty > cy ? 'bottom' : 'top';
  }
  if (p === 'top') return { x: cx, y: n.y };
  if (p === 'bottom') return { x: cx, y: n.y + n.h };
  if (p === 'left') return { x: n.x, y: cy };
  return { x: n.x + n.w, y: cy };
}

/** Orthogonal elbow path, the way draw.io routes by default. */
function edgePath(a: { x: number; y: number }, b: { x: number; y: number }, horizontalFirst: boolean) {
  const mx = horizontalFirst ? (a.x + b.x) / 2 : a.x;
  const my = horizontalFirst ? a.y : (a.y + b.y) / 2;
  return horizontalFirst
    ? `M ${a.x} ${a.y} L ${mx} ${a.y} L ${mx} ${b.y} L ${b.x} ${b.y}`
    : `M ${a.x} ${a.y} L ${a.x} ${my} L ${b.x} ${my} L ${b.x} ${b.y}`;
}

export default function DiagramView({ doc }: { doc: DiagramDoc }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const zoom = doc.zoom ?? 1;
  const pan = { x: doc.panX ?? 0, y: doc.panY ?? 0 };
  const byId = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes]);

  /** Screen point → diagram coordinates. */
  const toDiagram = useCallback(
    (clientX: number, clientY: number) => {
      const r = hostRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return { x: (clientX - r.left - pan.x) / zoom, y: (clientY - r.top - pan.y) / zoom };
    },
    [pan.x, pan.y, zoom]
  );

  const snap = (v: number) => (doc.snap === false ? Math.round(v) : Math.round(v / GRID) * GRID);

  /* --------------------------------------------------------- interactions */

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const p = toDiagram(e.clientX, e.clientY);

      if (d.kind === 'move') {
        S.moveDiagramNodes(doc.id, [
          { id: d.id, x: snap(p.x - d.dx), y: snap(p.y - d.dy) },
          ...d.others.map((o) => ({ id: o.id, x: snap(p.x - o.dx), y: snap(p.y - o.dy) })),
        ]);
      } else if (d.kind === 'resize') {
        S.updateDiagramNode(doc.id, d.id, {
          w: Math.max(60, snap(d.w + (p.x - d.sx))),
          h: Math.max(36, snap(d.h + (p.y - d.sy))),
        });
      } else if (d.kind === 'pan') {
        S.setDiagramPan(doc.id, d.px + (e.clientX - d.sx), d.py + (e.clientY - d.sy));
      } else if (d.kind === 'connect') {
        setGhost(p);
      } else if (d.kind === 'marquee') {
        setMarquee({
          x: Math.min(d.sx, p.x),
          y: Math.min(d.sy, p.y),
          w: Math.abs(p.x - d.sx),
          h: Math.abs(p.y - d.sy),
        });
      }
    };

    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      document.body.classList.remove('dragging');
      if (!d) return;

      if (d.kind === 'connect') {
        const p = toDiagram(e.clientX, e.clientY);
        const target = doc.nodes.find(
          (n) => p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h
        );
        if (target && target.id !== d.from) {
          S.addDiagramEdge(doc.id, d.from, target.id, d.fromPort);
        } else if (!target) {
          // Dropping on empty canvas creates the next node, wired up.
          const id = S.addDiagramNode(doc.id, {
            x: snap(p.x - NODE_DEFAULT_W / 2),
            y: snap(p.y - NODE_DEFAULT_H / 2),
          });
          S.addDiagramEdge(doc.id, d.from, id, d.fromPort);
          setSel({ kind: 'node', id });
          setEditing(id);
        }
        setGhost(null);
      } else if (d.kind === 'marquee' && marquee) {
        const hit = doc.nodes
          .filter(
            (n) =>
              n.x + n.w >= marquee.x &&
              n.x <= marquee.x + marquee.w &&
              n.y + n.h >= marquee.y &&
              n.y <= marquee.y + marquee.h
          )
          .map((n) => n.id);
        setMulti(hit);
        setSel(hit.length ? { kind: 'node', id: hit[0] } : null);
        setMarquee(null);
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [doc.id, doc.nodes, doc.snap, toDiagram, marquee]);

  // Wheel zooms about the pointer; space/middle drag pans.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = host.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const next = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.25, 3);
      // Keep the point under the cursor fixed while scaling.
      S.setDiagramView(doc.id, next, mx - ((mx - pan.x) / zoom) * next, my - ((my - pan.y) / zoom) * next);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [doc.id, zoom, pan.x, pan.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        if (sel.kind === 'node') S.removeDiagramNode(doc.id, sel.id);
        else S.removeDiagramEdge(doc.id, sel.id);
        setSel(null);
        setMulti([]);
      }
      if (e.key === 'Escape') {
        setSel(null);
        setMulti([]);
      }
      if (e.key === 'Enter' && sel?.kind === 'node') {
        e.preventDefault();
        setEditing(sel.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc.id, sel, editing]);

  /* ------------------------------------------------------------- rendering */

  const selectedNode = sel?.kind === 'node' ? byId.get(sel.id) : null;
  const selectedEdge = sel?.kind === 'edge' ? doc.edges.find((e) => e.id === sel.id) : null;

  const addNodeAt = (clientX: number, clientY: number) => {
    const p = toDiagram(clientX, clientY);
    const id = S.addDiagramNode(doc.id, {
      x: snap(p.x - NODE_DEFAULT_W / 2),
      y: snap(p.y - NODE_DEFAULT_H / 2),
    });
    setSel({ kind: 'node', id });
    setEditing(id);
  };

  return (
    <div className="diagram-view">
      <div className="view-toolbar">
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            const r = hostRef.current?.getBoundingClientRect();
            if (r) addNodeAt(r.left + r.width / 2, r.top + r.height / 3);
          }}
        >
          + Shape
        </button>
        <span className="tb-sep" />
        {selectedNode && (
          <>
            <div className="axis-controls">
              {NODE_SHAPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={selectedNode.shape === s ? 'on' : ''}
                  title={NODE_SHAPE_LABEL[s]}
                  onClick={() => S.updateDiagramNode(doc.id, selectedNode.id, { shape: s })}
                >
                  {NODE_SHAPE_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="swatches compact">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch${selectedNode.color === c ? ' on' : ''}`}
                  style={{ background: c }}
                  onClick={() => S.updateDiagramNode(doc.id, selectedNode.id, { color: c })}
                />
              ))}
            </div>
          </>
        )}
        {selectedEdge && (
          <div className="axis-controls">
            {(['solid', 'dashed'] as EdgeStyle[]).map((s) => (
              <button
                key={s}
                type="button"
                className={selectedEdge.style === s ? 'on' : ''}
                onClick={() => S.updateDiagramEdge(doc.id, selectedEdge.id, { style: s })}
              >
                {s}
              </button>
            ))}
            {(['end', 'both', 'none'] as EdgeArrow[]).map((a) => (
              <button
                key={a}
                type="button"
                className={selectedEdge.arrow === a ? 'on' : ''}
                onClick={() => S.updateDiagramEdge(doc.id, selectedEdge.id, { arrow: a })}
              >
                {a === 'end' ? '→' : a === 'both' ? '↔' : '—'}
              </button>
            ))}
          </div>
        )}
        <span className="tb-spacer" />
        <label className="tb-check">
          <input
            type="checkbox"
            checked={doc.snap !== false}
            onChange={(e) => S.setDiagramSnap(doc.id, e.target.checked)}
          />
          Snap to grid
        </label>
        <div className="zoom-controls">
          <button type="button" onClick={() => S.setDiagramView(doc.id, zoom / 1.2, pan.x, pan.y)}>
            −
          </button>
          <button
            type="button"
            className="zoom-value"
            onClick={() => S.setDiagramView(doc.id, 1, 0, 0)}
            title="Reset view"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => S.setDiagramView(doc.id, zoom * 1.2, pan.x, pan.y)}>
            +
          </button>
        </div>
        <span className="tb-hint">double-click canvas to add · drag a port to connect</span>
      </div>

      <div
        className="diagram-canvas"
        ref={hostRef}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('diagram-surface'))
            addNodeAt(e.clientX, e.clientY);
        }}
        onPointerDown={(e) => {
          const isSurface =
            e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('diagram-surface');
          if (!isSurface) return;
          if (e.button === 1 || e.shiftKey) {
            drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
          } else {
            const p = toDiagram(e.clientX, e.clientY);
            drag.current = { kind: 'marquee', sx: p.x, sy: p.y, x: p.x, y: p.y };
            setSel(null);
            setMulti([]);
          }
          document.body.classList.add('dragging');
        }}
        onContextMenu={(e) => {
          const isSurface =
            e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('diagram-surface');
          if (!isSurface) return;
          e.preventDefault();
          const { clientX, clientY } = e;
          setMenu({
            x: clientX,
            y: clientY,
            entries: [
              { label: 'Add shape here', run: () => addNodeAt(clientX, clientY) },
              { label: 'Reset view', run: () => S.setDiagramView(doc.id, 1, 0, 0) },
            ],
          });
        }}
      >
        <div
          className="diagram-surface"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            backgroundSize: `${GRID * 5}px ${GRID * 5}px`,
          }}
        >
          <svg className="diagram-edges" overflow="visible">
            <defs>
              <marker id="mg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-dim)" />
              </marker>
            </defs>
            {doc.edges.map((edge) => {
              const a = byId.get(edge.from);
              const b = byId.get(edge.to);
              if (!a || !b) return null;
              const pb = portPoint(b, edge.toPort, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
              const pa = portPoint(a, edge.fromPort, pb);
              const horizontal = Math.abs(pb.x - pa.x) > Math.abs(pb.y - pa.y);
              const d = edgePath(pa, pb, horizontal);
              const on = sel?.kind === 'edge' && sel.id === edge.id;
              return (
                <g key={edge.id} className={`d-edge${on ? ' sel' : ''}`}>
                  <path className="d-edge-hit" d={d} onPointerDown={() => setSel({ kind: 'edge', id: edge.id })} />
                  <path
                    className="d-edge-line"
                    d={d}
                    strokeDasharray={edge.style === 'dashed' ? '6 5' : undefined}
                    markerEnd={edge.arrow === 'none' ? undefined : 'url(#mg-arrow)'}
                    markerStart={edge.arrow === 'both' ? 'url(#mg-arrow)' : undefined}
                  />
                  {edge.label && (
                    <text className="d-edge-label" x={(pa.x + pb.x) / 2} y={(pa.y + pb.y) / 2 - 6}>
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
            {ghost && drag.current?.kind === 'connect' && (
              <path
                className="d-edge-ghost"
                d={(() => {
                  const from = byId.get(drag.current.from);
                  if (!from) return '';
                  const pa = portPoint(from, drag.current.fromPort, ghost);
                  return edgePath(pa, ghost, Math.abs(ghost.x - pa.x) > Math.abs(ghost.y - pa.y));
                })()}
              />
            )}
            {marquee && (
              <rect className="d-marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} />
            )}
          </svg>

          {doc.nodes.map((n) => {
            const on = (sel?.kind === 'node' && sel.id === n.id) || multi.includes(n.id);
            return (
              <div
                key={n.id}
                className={`d-node shape-${n.shape}${on ? ' sel' : ''}`}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h, ['--node' as string]: n.color }}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('.d-port, .d-resize, textarea')) return;
                  e.stopPropagation();
                  setSel({ kind: 'node', id: n.id });
                  const p = toDiagram(e.clientX, e.clientY);
                  const others = multi.includes(n.id)
                    ? multi.filter((id) => id !== n.id).map((id) => {
                        const o = byId.get(id)!;
                        return { id, dx: p.x - o.x, dy: p.y - o.y };
                      })
                    : [];
                  if (!multi.includes(n.id)) setMulti([]);
                  drag.current = { kind: 'move', id: n.id, dx: p.x - n.x, dy: p.y - n.y, others };
                  document.body.classList.add('dragging');
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditing(n.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSel({ kind: 'node', id: n.id });
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    entries: [
                      { label: 'Edit text', run: () => setEditing(n.id) },
                      { label: 'Duplicate', run: () => S.duplicateDiagramNode(doc.id, n.id) },
                      { label: 'Bring to front', run: () => S.raiseDiagramNode(doc.id, n.id) },
                      { separator: true },
                      {
                        label: 'Delete shape',
                        danger: true,
                        run: () => {
                          if (confirm(`Delete "${n.text || 'this shape'}" and its connections?`))
                            S.removeDiagramNode(doc.id, n.id);
                        },
                      },
                    ],
                  });
                }}
              >
                {editing === n.id ? (
                  <textarea
                    className="d-node-edit"
                    autoFocus
                    value={n.text}
                    onChange={(e) => S.updateDiagramNode(doc.id, n.id, { text: e.target.value }, `t:${n.id}`)}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                        e.preventDefault();
                        setEditing(null);
                      }
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <span className="d-node-text">{n.text}</span>
                )}

                {on && !editing && (
                  <>
                    {PORTS.map((port) => (
                      <span
                        key={port}
                        className={`d-port port-${port}`}
                        title="Drag to connect"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          drag.current = { kind: 'connect', from: n.id, fromPort: port, x: 0, y: 0 };
                          setGhost(toDiagram(e.clientX, e.clientY));
                          document.body.classList.add('dragging');
                        }}
                      />
                    ))}
                    <span
                      className="d-resize"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const p = toDiagram(e.clientX, e.clientY);
                        drag.current = { kind: 'resize', id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, sx: p.x, sy: p.y };
                        document.body.classList.add('dragging');
                      }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>

        {!doc.nodes.length && (
          <div className="diagram-empty">
            Double-click anywhere to add your first shape.
            <br />
            Select a shape and drag one of its ports to connect it to another.
          </div>
        )}
      </div>

      {selectedEdge && (
        <div className="edge-label-bar">
          <label>
            Connector label
            <input
              value={selectedEdge.label}
              placeholder="—"
              onChange={(e) => S.updateDiagramEdge(doc.id, selectedEdge.id, { label: e.target.value }, `l:${selectedEdge.id}`)}
            />
          </label>
          <button
            type="button"
            className="ghost-btn danger"
            onClick={() => {
              S.removeDiagramEdge(doc.id, selectedEdge.id);
              setSel(null);
            }}
          >
            Delete connector
          </button>
        </div>
      )}

      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
