import { PropertyDef, TodoDoc, TodoItem } from '../types';
import * as S from '../store';

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

  if (def.type === 'number') {
    return (
      <input
        className={className}
        type="number"
        value={raw}
        placeholder="—"
        onChange={(e) => set(e.target.value)}
      />
    );
  }

  if (def.type === 'date') {
    return (
      <input
        className={className}
        type="date"
        value={/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? raw.trim() : ''}
        onChange={(e) => set(e.target.value)}
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
