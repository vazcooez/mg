import { useEffect, useRef, useState } from 'react';
import {
  BOOLEAN_FALSE,
  BOOLEAN_TRUE,
  isTrueValue,
  PropertyDef,
  TodoDoc,
  TodoItem,
} from '../types';
import * as S from '../store';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date that reads as an em dash until it holds a value, matching every other
 * column — a bare `input[type=date]` would show `mm/dd/yyyy` instead. Clicking
 * it swaps in the real picker.
 */
function DateInput({
  className,
  value,
  onChange,
}: {
  className: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const has = ISO.test(value.trim());

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    el?.focus();
    // `showPicker` throws if the element is not user-activated; ignore that.
    try {
      (el as unknown as { showPicker?: () => void })?.showPicker?.();
    } catch {
      /* the field is still editable by typing */
    }
  }, [open]);

  if (!has && !open) {
    return (
      <input
        className={className}
        value=""
        placeholder="—"
        readOnly
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onMouseDown={() => setOpen(true)}
      />
    );
  }

  return (
    <input
      ref={ref}
      className={`${className} date`}
      type="date"
      value={has ? value.trim() : ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setOpen(false)}
    />
  );
}

/**
 * Value editor matching a property's declared type. Shared by the inspector and
 * the on-card editor so a property behaves identically wherever it is edited.
 */
export default function PropertyInput({
  doc,
  item,
  def,
  className = 'prop-value',
}: {
  doc: TodoDoc;
  item: TodoItem;
  def: PropertyDef;
  className?: string;
}) {
  const raw = item.properties[def.name] ?? '';
  const set = (v: string) => S.setItemProperty(doc.id, item.id, def.name, v);

  // Numbers edit as free text: a spinner adds nothing and blocks partial input.
  if (def.type === 'number') {
    return (
      <input
        className={className}
        value={raw}
        placeholder="—"
        spellCheck={false}
        onChange={(e) => set(e.target.value)}
      />
    );
  }

  if (def.type === 'date') return <DateInput className={className} value={raw} onChange={set} />;

  // A bare input, not a wrapping label: callers already put this inside their
  // own label, and nesting labels makes the click target ambiguous.
  if (def.type === 'boolean') {
    return (
      <input
        type="checkbox"
        className={`${className} prop-check`}
        checked={isTrueValue(raw)}
        onChange={(e) => set(e.target.checked ? BOOLEAN_TRUE : BOOLEAN_FALSE)}
      />
    );
  }

  if (def.type === 'select') {
    const options = def.options ?? [];
    const missing = raw.trim() && !options.includes(raw.trim());
    return (
      <select className={className} value={raw.trim()} onChange={(e) => set(e.target.value)}>
        <option value="">—</option>
        {missing && <option value={raw.trim()}>{raw.trim()} (not an option)</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className={className}
      value={raw}
      placeholder="—"
      spellCheck={false}
      onChange={(e) => set(e.target.value)}
    />
  );
}
