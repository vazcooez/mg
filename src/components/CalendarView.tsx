import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TodoDoc, TodoItem } from '../types';
import * as S from '../store';
import {
  addDays,
  atMinutes,
  dayLabel,
  formatDateOnly,
  formatDuration,
  formatLocal,
  formatRange,
  minutesOfDay,
  MINUTES_PER_DAY,
  monthLabel,
  parseLocal,
  sameDay,
  SLOT_MINUTES,
  snapMinutes,
  startOfDay,
  startOfWeek,
} from '../calendar';

const HOUR_PX = 46;
const PX_PER_MIN = HOUR_PX / 60;
const MIN_DURATION = SLOT_MINUTES;

interface Props {
  doc: TodoDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

type Gesture =
  | null
  | { kind: 'move'; id: string; grabMin: number; duration: number }
  | { kind: 'resize'; id: string; startMin: number };

/** Events that overlap in time share the column width between them. */
interface Placed {
  item: TodoItem;
  start: Date;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

function packDay(items: Array<{ item: TodoItem; start: Date }>): Placed[] {
  const sorted = items
    .map(({ item, start }) => ({
      item,
      start,
      from: minutesOfDay(start),
      to: minutesOfDay(start) + Math.max(MIN_DURATION, item.durationMin),
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const out: Placed[] = [];
  let cluster: typeof sorted = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    // Greedy lane assignment inside the overlapping cluster.
    const laneEnds: number[] = [];
    const assigned = cluster.map((e) => {
      let lane = laneEnds.findIndex((end) => end <= e.from);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(e.to);
      } else {
        laneEnds[lane] = e.to;
      }
      return { ...e, lane };
    });
    for (const e of assigned) {
      out.push({
        item: e.item,
        start: e.start,
        top: e.from * PX_PER_MIN,
        height: Math.max(MIN_DURATION, e.to - e.from) * PX_PER_MIN,
        lane: e.lane,
        lanes: laneEnds.length,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const e of sorted) {
    if (cluster.length && e.from >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.to);
  }
  flush();
  return out;
}

export default function CalendarView({ doc, selectedId, onSelect }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>(null);
  const [now, setNow] = useState(() => new Date());
  const [showRail, setShowRail] = useState(true);
  const dragUnscheduled = useRef<string | null>(null);

  const mode = doc.calMode ?? 'week';
  const anchor = useMemo(
    () => parseLocal(doc.calAnchor ? `${doc.calAnchor}T00:00` : null) ?? startOfDay(new Date()),
    [doc.calAnchor]
  );

  const days = useMemo(() => {
    const first = mode === 'week' ? startOfWeek(anchor) : startOfDay(anchor);
    return Array.from({ length: mode === 'week' ? 7 : 1 }, (_, i) => addDays(first, i));
  }, [anchor, mode]);

  const scheduled = useMemo(() => S.scheduledItems(doc), [doc]);
  const unscheduled = useMemo(() => S.unscheduledItems(doc), [doc]);

  /** Placed events, per visible day. */
  const perDay = useMemo(
    () =>
      days.map((day) =>
        packDay(
          scheduled
            .map((item) => ({ item, start: parseLocal(item.scheduledAt) }))
            .filter((e): e is { item: TodoItem; start: Date } => Boolean(e.start && sameDay(e.start, day)))
        )
      ),
    [days, scheduled]
  );

  // A ticking "now" line, refreshed once a minute.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Open on the working day rather than at midnight.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollTop === 0) el.scrollTop = 8 * HOUR_PX;
  }, []);

  const setAnchor = (d: Date) => S.setCalendarAnchor(doc.id, formatDateOnly(d));

  /** Which day column and minute a pointer position falls in. */
  const hitTest = useCallback(
    (clientX: number, clientY: number) => {
      const grid = gridRef.current;
      if (!grid) return null;
      const r = grid.getBoundingClientRect();
      const col = Math.min(
        days.length - 1,
        Math.max(0, Math.floor(((clientX - r.left) / r.width) * days.length))
      );
      const minutes = Math.max(0, Math.min(MINUTES_PER_DAY, (clientY - r.top + grid.scrollTop) / PX_PER_MIN));
      return { day: days[col], minutes };
    },
    [days]
  );

  /* ------------------------------------------------------------ gestures */

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const hit = hitTest(e.clientX, e.clientY);
      if (!hit) return;

      if (g.kind === 'move') {
        // Keep the grab offset so the block does not jump under the cursor.
        const startMin = snapMinutes(hit.minutes - g.grabMin);
        const at = atMinutes(hit.day, Math.min(startMin, MINUTES_PER_DAY - g.duration));
        S.setSchedule(doc.id, g.id, formatLocal(at), undefined, `cal:${g.id}`);
      } else {
        const live = S.getWorkspace().docs.find((d) => d.id === doc.id);
        const item =
          live && live.type === 'todo' ? live.items.find((i) => i.id === g.id) : undefined;
        const start = parseLocal(item?.scheduledAt);
        const from = start ? minutesOfDay(start) : g.startMin;
        const minutes = Math.max(MIN_DURATION, snapMinutes(hit.minutes - from));
        S.setDuration(doc.id, g.id, minutes, `caldur:${g.id}`);
      }
    };
    const up = () => {
      if (!gesture.current) return;
      gesture.current = null;
      document.body.classList.remove('dragging');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [doc.id, hitTest]);

  const label =
    mode === 'day'
      ? days[0].toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(
          undefined,
          { day: 'numeric', month: 'short' }
        )} · ${monthLabel(days[0])}`;

  const step = mode === 'week' ? 7 : 1;

  return (
    <div className="calendar-view">
      <div className="view-toolbar">
        <div className="view-switch small">
          {(['day', 'week'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'on' : ''}
              onClick={() => S.setCalendarMode(doc.id, m)}
            >
              {m === 'day' ? 'Day' : 'Week'}
            </button>
          ))}
        </div>
        <div className="axis-controls">
          <button type="button" title="Previous" onClick={() => setAnchor(addDays(anchor, -step))}>
            ‹
          </button>
          <button type="button" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button type="button" title="Next" onClick={() => setAnchor(addDays(anchor, step))}>
            ›
          </button>
        </div>
        <span className="cal-label">{label}</span>
        <span className="tb-spacer" />
        <button
          type="button"
          className={`ghost-btn${showRail ? ' on' : ''}`}
          title="Schedule-quadrant work that has no time yet"
          onClick={() => setShowRail((v) => !v)}
        >
          To schedule ({unscheduled.length})
        </button>
        <span className="tb-hint">drag to move · drag the bottom edge to change duration</span>
      </div>

      <div className="cal-body">
        <div className="cal-scroll" ref={scrollRef}>
          <div className="cal-head" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
            <div className="cal-gutter-head" />
            {days.map((d) => (
              <div key={d.toISOString()} className={`cal-day-head${sameDay(d, now) ? ' today' : ''}`}>
                <span className="cal-day-name">{dayLabel(d)}</span>
                <span className="cal-day-num">{d.getDate()}</span>
              </div>
            ))}
          </div>

          <div className="cal-grid-wrap" style={{ gridTemplateColumns: `56px 1fr` }}>
            <div className="cal-gutter">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="cal-hour-label" style={{ height: HOUR_PX }}>
                  <span>{String(h).padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>

            <div
              className="cal-grid"
              ref={gridRef}
              style={{
                height: 24 * HOUR_PX,
                gridTemplateColumns: `repeat(${days.length}, 1fr)`,
                backgroundSize: `100% ${HOUR_PX}px`,
              }}
              onDragOver={(e) => {
                if (dragUnscheduled.current) e.preventDefault();
              }}
              onDrop={(e) => {
                const id = dragUnscheduled.current;
                dragUnscheduled.current = null;
                if (!id) return;
                e.preventDefault();
                const hit = hitTest(e.clientX, e.clientY);
                if (!hit) return;
                S.setSchedule(doc.id, id, formatLocal(atMinutes(hit.day, snapMinutes(hit.minutes))));
                onSelect(id);
              }}
            >
              {days.map((day, col) => (
                <div
                  key={day.toISOString()}
                  className={`cal-col${sameDay(day, now) ? ' today' : ''}`}
                  onDoubleClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const hit = hitTest(e.clientX, e.clientY);
                    if (!hit) return;
                    const id = S.addItem(doc.id, null, {
                      title: 'New item',
                      status: 'scheduled',
                      scheduledAt: formatLocal(atMinutes(hit.day, snapMinutes(hit.minutes))),
                    });
                    onSelect(id);
                  }}
                >
                  {perDay[col].map((p) => {
                    const width = 100 / p.lanes;
                    return (
                      <div
                        key={p.item.id}
                        className={`cal-event${selectedId === p.item.id ? ' selected' : ''}${
                          p.item.status === 'done' ? ' done' : ''
                        }`}
                        style={{
                          top: p.top,
                          height: Math.max(p.height, 16),
                          left: `${p.lane * width}%`,
                          width: `calc(${width}% - 3px)`,
                          ['--card-color' as string]: S.cardColor(doc, p.item),
                        }}
                        title={`${p.item.title}\n${formatRange(p.start, p.item.durationMin)} · ${formatDuration(
                          p.item.durationMin
                        )}`}
                        onPointerDown={(e) => {
                          if ((e.target as HTMLElement).closest('.cal-resize')) return;
                          e.stopPropagation();
                          onSelect(p.item.id);
                          const hit = hitTest(e.clientX, e.clientY);
                          if (!hit) return;
                          gesture.current = {
                            kind: 'move',
                            id: p.item.id,
                            grabMin: hit.minutes - minutesOfDay(p.start),
                            duration: Math.max(MIN_DURATION, p.item.durationMin),
                          };
                          document.body.classList.add('dragging');
                        }}
                      >
                        <span className="cal-event-time">{formatRange(p.start, p.item.durationMin)}</span>
                        <span className="cal-event-title">{p.item.title}</span>
                        <span
                          className="cal-resize"
                          title="Drag to change duration"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            // Capture so the gesture survives the pointer
                            // leaving this 10px strip, which it does at once.
                            e.currentTarget.setPointerCapture(e.pointerId);
                            onSelect(p.item.id);
                            gesture.current = {
                              kind: 'resize',
                              id: p.item.id,
                              startMin: minutesOfDay(p.start),
                            };
                            document.body.classList.add('dragging');
                          }}
                        />
                      </div>
                    );
                  })}

                  {sameDay(day, now) && (
                    <div className="cal-now" style={{ top: minutesOfDay(now) * PX_PER_MIN }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {showRail && (
          <aside className="cal-rail">
            <div className="inspector-head">
              <span title="Important but not urgent, and not yet given a time">
                To schedule
              </span>
              <button type="button" className="icon-btn" onClick={() => setShowRail(false)}>
                ⟩
              </button>
            </div>
            <p className="cal-rail-hint">Schedule quadrant, no time yet.</p>
            <div className="cal-rail-list">
              {unscheduled.map((item) => (
                <div
                  key={item.id}
                  className={`cal-rail-item${selectedId === item.id ? ' selected' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    dragUnscheduled.current = item.id;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', item.title);
                  }}
                  onDragEnd={() => {
                    dragUnscheduled.current = null;
                  }}
                  onClick={() => onSelect(item.id)}
                  title="Drag onto the calendar to schedule it"
                >
                  <span
                    className="row-swatch"
                    style={{ background: S.resolveColor(doc.items, item) }}
                  />
                  <span className="cal-rail-title">{item.title}</span>
                </div>
              ))}
              {!unscheduled.length && (
                <div className="props-empty">
                  Nothing waiting. Items land here when they sit in the Schedule quadrant —
                  important, not urgent — without a time.
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
