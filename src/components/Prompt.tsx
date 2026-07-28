import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface PromptState {
  title: string;
  /** Helper text under the title. */
  hint?: string;
  value: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
}

/**
 * Replaces `window.prompt`, which Electron does not implement — a menu item
 * that called it would appear to do nothing at all.
 */
export default function Prompt({ state, onClose }: { state: PromptState; onClose: () => void }) {
  const [value, setValue] = useState(state.value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, []);

  const submit = () => {
    state.onSubmit(value);
    onClose();
  };

  return createPortal(
    <div className="palette-backdrop" onMouseDown={onClose}>
      <form
        className="prompt-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="prompt-title">{state.title}</div>
        {state.hint && <p className="setting-hint">{state.hint}</p>}
        <input
          ref={inputRef}
          className="text-input"
          value={value}
          placeholder={state.placeholder}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="prompt-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ghost-btn primary">
            {state.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
