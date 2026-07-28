import { useCallback, useRef } from 'react';
import { LAYOUTS, Workspace } from '../types';
import * as S from '../store';
import EditorPane from './EditorPane';

/**
 * Sublime-style editor groups: a CSS grid of panes with draggable dividers.
 * `colSizes`/`rowSizes` hold fractions that sum to 1.
 */
export default function PaneGrid({ ws }: { ws: Workspace }) {
  const spec = LAYOUTS[ws.layout.kind];
  const { cols, rows } = spec;
  const ref = useRef<HTMLDivElement>(null);

  const startDrag = useCallback(
    (axis: 'col' | 'row', index: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      const host = ref.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const total = axis === 'col' ? rect.width : rect.height;
      const sizes = (axis === 'col' ? ws.layout.colSizes : ws.layout.rowSizes).slice();
      const start = axis === 'col' ? e.clientX : e.clientY;
      const a = sizes[index];
      const b = sizes[index + 1];
      const min = 0.12;

      const move = (ev: PointerEvent) => {
        const delta = ((axis === 'col' ? ev.clientX : ev.clientY) - start) / total;
        const next = sizes.slice();
        next[index] = Math.min(a + b - min, Math.max(min, a + delta));
        next[index + 1] = a + b - next[index];
        S.setSplitSizes(axis, next);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing');
      };
      document.body.classList.add('resizing');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [ws.layout.colSizes, ws.layout.rowSizes]
  );

  // Interleave pane tracks with 1px divider tracks.
  const template = (sizes: number[]) =>
    sizes.map((s) => `${(s * 100).toFixed(4)}fr`).join(' var(--split) ');

  const dividers = [];
  for (let c = 0; c < cols - 1; c++) {
    dividers.push(
      <div
        key={`c${c}`}
        className="split-handle split-col"
        style={{ gridColumn: c * 2 + 2, gridRow: `1 / ${rows * 2}` }}
        onPointerDown={startDrag('col', c)}
      />
    );
  }
  for (let r = 0; r < rows - 1; r++) {
    dividers.push(
      <div
        key={`r${r}`}
        className="split-handle split-row"
        style={{ gridRow: r * 2 + 2, gridColumn: `1 / ${cols * 2}` }}
        onPointerDown={startDrag('row', r)}
      />
    );
  }

  return (
    <div
      className="pane-grid"
      ref={ref}
      style={{
        gridTemplateColumns: template(ws.layout.colSizes),
        gridTemplateRows: template(ws.layout.rowSizes),
      }}
    >
      {ws.layout.panes.map((pane, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        return (
          <div key={pane.id} className="pane-cell" style={{ gridColumn: c * 2 + 1, gridRow: r * 2 + 1 }}>
            <EditorPane ws={ws} pane={pane} index={i} />
          </div>
        );
      })}
      {dividers}
    </div>
  );
}
