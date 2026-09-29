import { useCallback, useRef } from 'react';
import { LayoutNode, SplitDir, Workspace } from '../types';
import * as S from '../store';
import EditorPane from './EditorPane';

/** A box in the editor area, as fractions of its width and height. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A draggable boundary between two children of one split. */
interface Divider {
  key: string;
  /** Child indices from the root down to the split that owns it. */
  path: number[];
  /** The boundary sits after this child. */
  index: number;
  dir: SplitDir;
  sizes: number[];
  /** The split's own box, and where along it the boundary falls (0–1). */
  box: Rect;
  at: number;
}

/** Walks the split tree once, placing every group and every divider. */
function place(root: LayoutNode): { cells: Map<string, Rect>; dividers: Divider[] } {
  const cells = new Map<string, Rect>();
  const dividers: Divider[] = [];
  const walk = (node: LayoutNode, box: Rect, path: number[]) => {
    if (node.type === 'pane') {
      cells.set(node.paneId, box);
      return;
    }
    let offset = 0;
    node.children.forEach((child, i) => {
      const size = node.sizes[i];
      const sub =
        node.dir === 'row'
          ? { x: box.x + offset * box.w, y: box.y, w: size * box.w, h: box.h }
          : { x: box.x, y: box.y + offset * box.h, w: box.w, h: size * box.h };
      walk(child, sub, [...path, i]);
      offset += size;
      if (i < node.children.length - 1) {
        dividers.push({
          key: `${path.join('.')}:${i}`,
          path,
          index: i,
          dir: node.dir,
          sizes: node.sizes,
          box,
          at: offset,
        });
      }
    });
  };
  walk(root, { x: 0, y: 0, w: 1, h: 1 }, []);
  return { cells, dividers };
}

const pct = (n: number) => `${(n * 100).toFixed(4)}%`;
/** Half the gutter between groups; a group only gives it up on an inner edge. */
const HALF = 'calc(var(--split) / 2)';
const EPS = 1e-6;

/**
 * The editor area: groups laid out by the split tree, VS Code-style, with a
 * draggable divider on every boundary.
 *
 * Every group is an absolutely positioned child of this one element, keyed by
 * its id, so reshaping the layout — splitting, closing a group — moves groups
 * around without ever remounting them: an open editor keeps its caret, scroll
 * and undo history through any rearrangement.
 */
export default function PaneGrid({ ws }: { ws: Workspace }) {
  const ref = useRef<HTMLDivElement>(null);
  const { cells, dividers } = place(ws.layout.root);

  const startDrag = useCallback(
    (d: Divider) => (e: React.PointerEvent) => {
      e.preventDefault();
      const host = ref.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const row = d.dir === 'row';
      // Pixel length of the split being resized.
      const total = row ? rect.width * d.box.w : rect.height * d.box.h;
      const start = row ? e.clientX : e.clientY;
      const a = d.sizes[d.index];
      const b = d.sizes[d.index + 1];
      // Neither neighbour may shrink below a usable width.
      const min = Math.min((a + b) / 2, 140 / Math.max(total, 1));

      const move = (ev: PointerEvent) => {
        const delta = ((row ? ev.clientX : ev.clientY) - start) / total;
        const next = d.sizes.slice();
        next[d.index] = Math.min(a + b - min, Math.max(min, a + delta));
        next[d.index + 1] = a + b - next[d.index];
        S.setSplitSizes(d.path, next);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing', 'resizing-row');
      };
      document.body.classList.add('resizing', ...(row ? [] : ['resizing-row']));
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    []
  );

  return (
    <div className="pane-grid" ref={ref}>
      {ws.layout.panes.map((pane, i) => {
        const r = cells.get(pane.id);
        if (!r) return null;
        const inset = (edge: number, inner: boolean) =>
          inner ? `calc(${pct(edge)} + ${HALF})` : pct(edge);
        const left = r.x > EPS;
        const top = r.y > EPS;
        const right = r.x + r.w < 1 - EPS;
        const bottom = r.y + r.h < 1 - EPS;
        return (
          <div
            key={pane.id}
            className="pane-cell"
            style={{
              left: inset(r.x, left),
              top: inset(r.y, top),
              right: inset(1 - r.x - r.w, right),
              bottom: inset(1 - r.y - r.h, bottom),
            }}
          >
            <EditorPane ws={ws} pane={pane} index={i} />
          </div>
        );
      })}
      {dividers.map((d) => {
        const { box } = d;
        const style =
          d.dir === 'row'
            ? {
                left: `calc(${pct(box.x + d.at * box.w)} - ${HALF})`,
                top: pct(box.y),
                height: pct(box.h),
              }
            : {
                top: `calc(${pct(box.y + d.at * box.h)} - ${HALF})`,
                left: pct(box.x),
                width: pct(box.w),
              };
        return (
          <div
            key={d.key}
            className={`split-handle ${d.dir === 'row' ? 'split-col' : 'split-row'}`}
            style={style}
            onPointerDown={startDrag(d)}
          />
        );
      })}
    </div>
  );
}
