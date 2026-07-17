/**
 * The API stores dates as `YYYY-MM-DD` and times as `HH:mm` strings; Material's
 * datepicker and timepicker both work in `Date`. These convert at that boundary
 * so the wire format never leaks into the form and vice versa.
 *
 * All conversions are local-time. `toISOString()` is deliberately avoided — it
 * converts to UTC first, which shifts the calendar day either side of midnight.
 */

/** `Date` -> `YYYY-MM-DD` in local time. */
export function toIsoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** `YYYY-MM-DD` -> `Date` at local midnight. Null for empty or unparseable. */
export function fromIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `Date` -> `HH:mm` in local time. */
export function toHm(d: Date): string {
  const h = `${d.getHours()}`.padStart(2, '0');
  const m = `${d.getMinutes()}`.padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * `HH:mm` -> a `Date` carrying that time of day. The calendar portion is
 * arbitrary — the timepicker only reads hours and minutes — so it is pinned to
 * a fixed epoch rather than "today", which would silently change the value's
 * date part depending on when the form was opened.
 */
export function fromHm(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return new Date(1970, 0, 1, h, m);
}

/** Combines a calendar date with a time-of-day into one instant. */
export function combineDateTime(date: Date | null, time: Date | null): Date | null {
  if (!date || !time) return null;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.getHours(),
    time.getMinutes(),
  );
}
