import { differenceInCalendarDays, format, isThisYear } from 'date-fns';

/**
 * Time zones for live sessions. A session is scheduled in its own zone ("2 PM
 * in Chicago") and shown to each viewer in theirs, with the session's zone as
 * a hint when they differ. Conversions use Intl only — no time zone library.
 */

export const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** Minutes the zone is ahead of UTC at that instant (Chicago in summer: -300). */
export function zoneOffsetMinutes(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** A wall-clock day and time in a zone, as a real instant. */
export function zonedToUtc(day: string, time: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  const first = zoneOffsetMinutes(new Date(guess), timeZone);
  let ts = guess - first * 60000;
  const second = zoneOffsetMinutes(new Date(ts), timeZone);
  if (second !== first) ts = guess - second * 60000;
  return new Date(ts);
}

/** An instant as the day and time on a clock in that zone. */
export function utcToZoned(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` };
}

const safe = <T,>(fn: () => T, fallback: T) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** "CDT", "GMT+1". */
export function zoneAbbr(iso: string, timeZone: string) {
  return safe(() => new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date(iso)).find(p => p.type === 'timeZoneName')?.value ?? timeZone, timeZone);
}

/** "2:00 PM" in a zone (the viewer's when omitted). */
export function clock(iso: string, timeZone?: string) {
  return safe(() => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso)), '');
}

/** "2:00 – 3:30 PM", "11:00 AM – 12:30 PM". */
export function timeRange(startIso: string | null, endIso: string | null, timeZone?: string) {
  if (!startIso) return '';
  const a = clock(startIso, timeZone);
  if (!endIso) return a;
  const b = clock(endIso, timeZone);
  const [aTime, aMer] = a.split(' ');
  const [, bMer] = b.split(' ');
  return aMer && aMer === bMer ? `${aTime} – ${b}` : `${a} – ${b}`;
}

/** Whether a session's own zone reads differently from the viewer's at that moment. */
export const differsFromViewer = (iso: string, timeZone: string) => zoneOffsetMinutes(new Date(iso), timeZone) !== zoneOffsetMinutes(new Date(iso), viewerTimeZone());

/** A friendly city for an IANA zone: "America/Chicago" → "Chicago". */
export const zoneCity = (tz: string) => (tz.split('/').pop() ?? tz).replace(/_/g, ' ');

export function zoneLabel(tz: string, at = new Date().toISOString()) {
  const offset = zoneOffsetMinutes(new Date(at), tz);
  const sign = offset < 0 ? '−' : '+';
  const abs = Math.abs(offset);
  const gmt = `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return { city: zoneCity(tz), region: tz.includes('/') ? tz.split('/')[0].replace(/_/g, ' ') : '', gmt, offset };
}

export function allTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = supported ? safe(() => supported('timeZone'), [] as string[]) : [];
  return list.length ? list : ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Singapore', 'Australia/Sydney'];
}

/** Local calendar day key for grouping in the viewer's zone. */
export const localDayKey = (iso: string) => format(new Date(iso), 'yyyy-MM-dd');

/** "Today", "Tomorrow", "Yesterday", "Thu, Sep 18", "Thu, Sep 18, 2027". */
export function dayHeading(iso: string) {
  const d = new Date(iso);
  const diff = differenceInCalendarDays(d, new Date());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return format(d, isThisYear(d) ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');
}

export type SessionPhase = 'upcoming' | 'live' | 'ended' | 'cancelled';

export function sessionPhase(s: { startsAt: string | null; endsAt: string | null; status: string }, now = Date.now()): SessionPhase {
  if (s.status === 'Cancelled') return 'cancelled';
  const start = s.startsAt ? Date.parse(s.startsAt) : NaN;
  const end = s.endsAt ? Date.parse(s.endsAt) : start;
  if (!Number.isNaN(end) && end < now) return 'ended';
  if (!Number.isNaN(start) && start <= now) return 'live';
  return 'upcoming';
}

/** "Starts in 2 days", "Starts in 3h 20m", "Live now", "Ended 4 days ago". */
export function countdown(s: { startsAt: string | null; endsAt: string | null; status: string }, now = Date.now()) {
  const phase = sessionPhase(s, now);
  if (phase === 'cancelled') return 'Cancelled';
  if (phase === 'live') return 'Live now';
  const at = Date.parse((phase === 'ended' ? s.endsAt ?? s.startsAt : s.startsAt) ?? '');
  if (Number.isNaN(at)) return '';
  const mins = Math.round(Math.abs(at - now) / 60000);
  const span = mins < 60 ? `${Math.max(1, mins)}m` : mins < 24 * 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? '' : 's'}`;
  return phase === 'ended' ? `Ended ${span} ago` : `Starts in ${span}`;
}

export function durationLabel(startIso: string | null, endIso: string | null) {
  if (!startIso || !endIso) return '';
  const mins = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000);
  if (mins <= 0) return '';
  if (mins < 60) return `${mins} min`;
  return mins % 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins / 60} hour${mins === 60 ? '' : 's'}`;
}
