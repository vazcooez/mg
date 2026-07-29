/**
 * Local-time helpers for the calendar view.
 *
 * Scheduled times are stored as `YYYY-MM-DDTHH:mm` with no timezone: a todo
 * document is a personal plan, and "09:00 on Tuesday" should stay 09:00 on
 * Tuesday whichever machine or timezone opens the file.
 */

export const SLOT_MINUTES = 15;
export const MINUTES_PER_DAY = 24 * 60;

const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseLocal(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = LOCAL_ISO.exec(value.trim());
  if (!m) {
    // Tolerate a bare date, and anything Date can make sense of.
    const loose = new Date(value);
    return Number.isFinite(loose.getTime()) ? loose : null;
  }
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
    0
  );
  return Number.isFinite(d.getTime()) ? d : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function formatDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/** Monday-first, matching most planning tools. */
export function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -day);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Rebuilds a date from a day and a minutes-past-midnight offset. */
export function atMinutes(day: Date, minutes: number): Date {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - SLOT_MINUTES, minutes));
  const d = startOfDay(day);
  d.setMinutes(clamped);
  return d;
}

export function snapMinutes(minutes: number, slot = SLOT_MINUTES): number {
  return Math.round(minutes / slot) * slot;
}

export function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRange(start: Date, minutes: number): string {
  const end = new Date(start.getTime() + minutes * 60000);
  return `${formatTime(start)}–${formatTime(end)}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function dayLabel(d: Date): string {
  return DAY_NAMES[(d.getDay() + 6) % 7];
}

export function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
