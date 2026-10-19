/**
 * Interview times: entered as a local date and time, sent as an ISO
 * date-time with the local offset (`2026-11-03T10:30:00+05:30`), so the
 * server keeps the moment and every device shows it in its own zone.
 */

const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');

/** A local date (`YYYY-MM-DD`) and time (`HH:mm`) as ISO with the offset; null if either is invalid. */
export function localDateTimeToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const local = new Date(`${date}T${time}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return toOffsetIso(local);
}

/** A moment as ISO in this device's zone, with its offset. */
export function toOffsetIso(d: Date): string {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

/** An ISO moment as the local date and time inputs' values. */
export function isoToLocalInputs(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** "Tue, 3 Nov, 10:30" in the device's locale and zone. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "Tue, 3 Nov" for a schedule day. */
export function formatDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How long until the interview: "in 3 days", "in 1 day, 4 hours", "in 40 minutes", "passed". */
export function countdown(iso: string, now: number = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (Number.isNaN(diff)) return '';
  if (diff <= 0) return 'passed';
  const minutes = Math.ceil(diff / 60_000);
  if (diff < HOUR) return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const days = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / HOUR);
  if (days === 0) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const dayText = `${days} ${days === 1 ? 'day' : 'days'}`;
  return days < 3 && hours > 0
    ? `in ${dayText}, ${hours} ${hours === 1 ? 'hour' : 'hours'}`
    : `in ${dayText}`;
}

/** Whether a moment has passed. */
export function isPast(iso: string, now: number = Date.now()): boolean {
  return new Date(iso).getTime() <= now;
}

/** Midnight (local) of a moment's day. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The same local day. */
export function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
