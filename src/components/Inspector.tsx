import { useMemo, useState } from 'react';
import {
  clamp,
  COLOR_PRESETS,
  fmt,
  NUMBER_DISPLAY_LABEL,
  NUMBER_DISPLAYS,
  PROPERTY_TYPE_LABEL,
  PROPERTY_TYPES,
  PropertyType,
  Repeat,
  REPEAT_UNIT_LABEL,
  REPEAT_UNITS,
  RepeatUnit,
  round1,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUSES,
  TodoDoc,
  TodoItem,
  WEEKDAY_INITIALS,
  WEEKDAY_NAMES,
} from '../types';
import { parseLocal, repeatDayOfMonth, repeatDays, weekdayIndex } from '../calendar';
import * as S from '../store';
import PropertyInput from './PropertyInput';

export default function Inspector({
  doc,
  item,
  onSelect,
  onClose,
}: {
  doc: TodoDoc;
  item: TodoItem | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState<PropertyType>('text');
  const defs = useMemo(() => S.propertyDefsOf(doc), [doc]);

  if (!item) {
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <span>Item</span>
          <button type="button" className="icon-btn" onClick={onClose} title="Hide inspector">
            ⟩
          </button>
        </div>
        <div className="inspector-empty">Select an item to edit its properties.</div>
      </aside>
    );
  }

  const ancestors = S.ancestorsOf(doc.items, item.id).reverse();
  const children = S.childrenOf(doc.items, item.id);
  const resolved = S.resolveColor(doc.items, item);
  const inherited = !item.color;
  const parentColorSource = ancestors.filter((a) => a.color).slice(-1)[0];

  const set = (patch: Partial<TodoItem>, coalesce?: string) =>
    S.updateItem(doc.id, item.id, patch, coalesce);

  const num = (field: 'urgency' | 'importance' | 'weight', label: string, hint: string) => (
    <div className="field">
      <label>
        {label} <span className="field-hint">{hint}</span>
        <span className="field-value">{fmt(item[field])}</span>
      </label>
      <div className="slider-row">
        <input
          type="range"
          min={1}
          max={10}
          step={0.1}
          value={item[field]}
          onChange={(e) => set({ [field]: round1(Number(e.target.value)) }, `s:${item.id}:${field}`)}
        />
        <input
          className="num-input"
          type="number"
          min={1}
          max={10}
          step={0.5}
          value={fmt(item[field])}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (!Number.isNaN(raw)) set({ [field]: round1(clamp(raw, 1, 10)) }, `s:${item.id}:${field}`);
          }}
        />
      </div>
    </div>
  );

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span>Item</span>
        <button type="button" className="icon-btn" onClick={onClose} title="Hide inspector">
          ⟩
        </button>
      </div>

      <div className="inspector-body">
        {ancestors.length > 0 && (
          <div className="breadcrumb">
            {ancestors.map((a) => (
              <button key={a.id} type="button" onClick={() => onSelect(a.id)}>
                {a.title}
              </button>
            ))}
            <span className="crumb-current">{item.title}</span>
          </div>
        )}

        <div className="field">
          <label>Title</label>
          <input
            className="text-input"
            value={item.title}
            onChange={(e) => set({ title: e.target.value }, `t:${item.id}`)}
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label>Parent</label>
          <select
            className="text-input"
            value={item.parentId ?? ''}
            onChange={(e) => S.reparentItem(doc.id, item.id, e.target.value || null)}
          >
            <option value="">— none (root) —</option>
            {doc.items
              .filter((o) => o.id !== item.id && S.canReparent(doc.items, item.id, o.id))
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {'— '.repeat(S.depthOf(doc.items, o.id))}
                  {o.title}
                </option>
              ))}
          </select>
        </div>

        <div className="field">
          <label>Assignee</label>
          <input
            className="text-input"
            value={item.assignee}
            placeholder="Unassigned"
            onChange={(e) => set({ assignee: e.target.value }, `a:${item.id}`)}
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label>Matrix</label>
          <label className="tb-check">
            <input
              type="checkbox"
              checked={item.showInMatrix}
              onChange={(e) => S.setShowInMatrix(doc.id, item.id, e.target.checked)}
            />
            Show this item as a card
          </label>
          {children.length > 0 && (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => S.setSubtreeShownInMatrix(doc.id, item.id, !item.showInMatrix)}
            >
              {item.showInMatrix ? 'Hide' : 'Show'} this item and its {children.length} descendant
              {children.length === 1 ? '' : 's'}
            </button>
          )}
        </div>

        <div className="field">
          <label>
            Schedule <span className="field-hint">calendar view</span>
          </label>
          <div className="slider-row">
            <input
              className="text-input"
              type="datetime-local"
              value={item.scheduledAt ?? ''}
              onChange={(e) => S.setSchedule(doc.id, item.id, e.target.value || null)}
            />
            {item.scheduledAt && (
              <button
                type="button"
                className="row-btn"
                title="Unschedule"
                onClick={() => S.setSchedule(doc.id, item.id, null)}
              >
                ×
              </button>
            )}
          </div>
          <div className="slider-row">
            <input
              className="num-input"
              type="number"
              min={15}
              step={15}
              value={item.durationMin}
              onChange={(e) => S.setDuration(doc.id, item.id, Number(e.target.value) || 15)}
            />
            <span className="field-hint">minutes long</span>
          </div>
        </div>

        <RepeatField doc={doc} item={item} />

        <div className="field">
          <label>Status</label>
          <div className="status-row">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`status-chip${item.status === s ? ' on' : ''}`}
                style={{ ['--chip' as string]: STATUS_COLOR[s] }}
                onClick={() => set({ status: s })}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {num('urgency', 'Urgency', 'matrix x-axis')}
        {num('importance', 'Importance', 'matrix y-axis')}
        {num('weight', 'Weight', 'card size')}

        <div className="field">
          <label>
            Color
            {inherited && (
              <span className="field-hint">
                inherited{parentColorSource ? ` from “${parentColorSource.title}”` : ' (default)'}
              </span>
            )}
          </label>
          <div className="swatches">
            <button
              type="button"
              className={`swatch inherit${inherited ? ' on' : ''}`}
              title="Inherit from parent"
              onClick={() => set({ color: null })}
            >
              ↺
            </button>
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${item.color === c ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => set({ color: c })}
              />
            ))}
            <input
              type="color"
              className="swatch custom"
              value={resolved}
              onChange={(e) => set({ color: e.target.value })}
              title="Custom color"
            />
          </div>
        </div>

        <div className="field">
          <label>Custom properties</label>
          <div className="props">
            {defs.map((def) => (
              <div className="prop-row" key={def.name}>
                <select
                  className="prop-type"
                  value={def.type}
                  title={`"${def.name}" is a ${PROPERTY_TYPE_LABEL[def.type].toLowerCase()} property`}
                  onChange={(e) => S.setPropertyType(doc.id, def.name, e.target.value as PropertyType)}
                >
                  {PROPERTY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {PROPERTY_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <span className="prop-name" title={def.name}>
                  {def.name}
                </span>
                <button
                  type="button"
                  className="row-btn danger"
                  title="Remove this property from every item"
                  onClick={() => {
                    if (confirm(`Remove property "${def.name}" from all items?`))
                      S.removePropertyColumn(doc.id, def.name);
                  }}
                >
                  ×
                </button>
                <PropertyInput doc={doc} item={item} def={def} />
                {def.type === 'number' && (
                  <div className="prop-display">
                    {NUMBER_DISPLAYS.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={(def.display ?? 'digit') === mode ? 'on' : ''}
                        title={`Show "${def.name}" as ${NUMBER_DISPLAY_LABEL[mode].toLowerCase()}`}
                        onClick={() => S.setPropertyDisplay(doc.id, def.name, mode)}
                      >
                        {NUMBER_DISPLAY_LABEL[mode]}
                      </button>
                    ))}
                  </div>
                )}
                {def.type === 'select' && (
                  <input
                    className="prop-options"
                    defaultValue={(def.options ?? []).join(', ')}
                    placeholder="Options, comma separated"
                    spellCheck={false}
                    onBlur={(e) => S.setPropertyOptions(doc.id, def.name, e.target.value.split(','))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                )}
              </div>
            ))}
            {!defs.length && <div className="props-empty">None yet.</div>}
          </div>
          <form
            className="prop-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newKey.trim()) return;
              S.addPropertyColumn(doc.id, newKey, newType);
              setNewKey('');
            }}
          >
            <input
              value={newKey}
              placeholder="Property name"
              onChange={(e) => setNewKey(e.target.value)}
              spellCheck={false}
            />
            <select value={newType} onChange={(e) => setNewType(e.target.value as PropertyType)}>
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROPERTY_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <button type="submit" className="ghost-btn">
              Add
            </button>
          </form>
        </div>

        <div className="field">
          <label>
            Children <span className="field-hint">{children.length}</span>
          </label>
          <div className="child-list">
            {children.map((c) => (
              <button key={c.id} type="button" className="child-row" onClick={() => onSelect(c.id)}>
                <span className="row-swatch" style={{ background: S.resolveColor(doc.items, c) }} />
                {c.title}
              </button>
            ))}
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onSelect(S.addItem(doc.id, item.id))}
            >
              + Add child
            </button>
          </div>
        </div>

        <div className="field">
          <button
            type="button"
            className="ghost-btn danger"
            onClick={() => {
              S.deleteItem(doc.id, item.id);
              onSelect(null);
            }}
          >
            Delete item and children
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * The recurrence rule for one item.
 *
 * A repeat belongs to the item rather than spawning copies, so there is one
 * row here and not a list of dates: change the rule and every occurrence on
 * the calendar follows. Switching it on with no slot yet gives the item one,
 * because a rule with nothing to repeat from would do nothing at all.
 */
function RepeatField({ doc, item }: { doc: TodoDoc; item: TodoItem }) {
  const start = parseLocal(item.scheduledAt) ?? new Date();
  const repeat = item.repeat;

  const set = (next: Repeat | null) => S.setRepeat(doc.id, item.id, next);

  const pick = (unit: '' | RepeatUnit) => {
    if (!unit) return set(null);
    // Carry the days and date across a change of unit so flipping between
    // Weekly and Monthly to compare them does not lose what was chosen.
    const base: Repeat = { unit, until: repeat?.until ?? null };
    if (unit === 'weekly') base.days = repeat?.days ?? [weekdayIndex(start)];
    if (unit === 'monthly') base.dayOfMonth = repeat?.dayOfMonth ?? start.getDate();
    set(base);
  };

  const toggleDay = (n: number) => {
    if (!repeat) return;
    const current = repeatDays(repeat, start);
    const next = current.includes(n) ? current.filter((d) => d !== n) : [...current, n];
    // Every weekday off would be a rule that never happens; the last one stays.
    set({ ...repeat, days: next.length ? next.sort((a, b) => a - b) : current });
  };

  const chosenDays = repeat ? repeatDays(repeat, start) : [];

  return (
    <div className="field">
      <label>
        Repeats <span className="field-hint">calendar view</span>
      </label>
      <select
        className="text-input"
        value={repeat?.unit ?? ''}
        onChange={(e) => pick(e.target.value as '' | RepeatUnit)}
      >
        <option value="">Does not repeat</option>
        {REPEAT_UNITS.map((u) => (
          <option key={u} value={u}>
            {REPEAT_UNIT_LABEL[u]}
          </option>
        ))}
      </select>

      {repeat?.unit === 'weekly' && (
        <div className="weekday-row">
          {WEEKDAY_INITIALS.map((initial, n) => (
            <button
              key={WEEKDAY_NAMES[n]}
              type="button"
              className={`weekday-chip${chosenDays.includes(n) ? ' on' : ''}`}
              title={WEEKDAY_NAMES[n]}
              aria-pressed={chosenDays.includes(n)}
              onClick={() => toggleDay(n)}
            >
              {initial}
            </button>
          ))}
        </div>
      )}

      {repeat?.unit === 'monthly' && (
        <div className="slider-row">
          <span className="field-hint">on day</span>
          <input
            className="num-input"
            type="number"
            min={1}
            max={31}
            value={repeatDayOfMonth(repeat, start)}
            onChange={(e) =>
              set({ ...repeat, dayOfMonth: clamp(Math.round(Number(e.target.value) || 1), 1, 31) })
            }
          />
          <span className="field-hint">of the month</span>
        </div>
      )}

      {repeat && (
        <>
          <div className="slider-row">
            <span className="field-hint">until</span>
            <input
              className="text-input"
              type="date"
              value={repeat.until ?? ''}
              onChange={(e) => set({ ...repeat, until: e.target.value || null })}
            />
            {repeat.until && (
              <button
                type="button"
                className="row-btn"
                title="Repeat with no end"
                onClick={() => set({ ...repeat, until: null })}
              >
                ×
              </button>
            )}
          </div>
          <p className="field-hint">
            Starts {start.toLocaleDateString()}; earlier days are left alone.
            {repeat.unit === 'monthly' && repeatDayOfMonth(repeat, start) > 28
              ? ' Months without that date are skipped.'
              : ''}
          </p>
        </>
      )}
    </div>
  );
}
