import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuEntry {
  label?: string;
  detail?: string;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
  run?: () => void;
}

export interface MenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

export default function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(state.x, window.innerWidth - r.width - 8),
      y: Math.min(state.y, window.innerHeight - r.height - 8),
    });
  }, [state.x, state.y]);

  useEffect(() => {
    /*
     * Registered in the capture phase so it beats other handlers — which also
     * means it runs before the menu button's own listeners. A pointerdown
     * inside the menu must therefore be ignored here, or the menu would unmount
     * before the click could ever reach the item.
     */
    const close = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return createPortal(
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {state.entries.map((entry, i) =>
        entry.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            type="button"
            className={`ctx-item${entry.disabled ? ' disabled' : ''}${entry.danger ? ' danger' : ''}`}
            disabled={entry.disabled}
            onClick={() => {
              entry.run?.();
              onClose();
            }}
          >
            <span>{entry.label}</span>
            {entry.detail && <span className="ctx-detail">{entry.detail}</span>}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
