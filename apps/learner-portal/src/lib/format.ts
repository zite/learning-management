import { differenceInCalendarDays, format, formatDistanceToNowStrict, isThisYear, parseISO } from 'date-fns';

export { formatMinutes } from '@project/shared/lessons';

/** Seconds as "12m", "1h 20m", "3h". */
export function formatDuration(seconds: number | null | undefined) {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (s < 60) return s ? '<1m' : '0m';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

export function parseDay(day: string) {
  // Date-only strings must be read as LOCAL midnight; `new Date('2026-09-12')` is UTC and shifts a day west of Greenwich.
  return parseISO(day.length === 10 ? `${day}T00:00:00` : day);
}

export function toDayString(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

export function todayString() {
  return toDayString(new Date());
}

export function addDays(days: number) {
  return toDayString(new Date(Date.now() + days * 86_400_000));
}

/** "3m ago", "2h ago", "5d ago", then "Sep 4". */
export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '';
  const d = parseISO(iso);
  const days = Math.abs(differenceInCalendarDays(new Date(), d));
  if (days > 30) return shortDate(iso);
  const s = formatDistanceToNowStrict(d, { roundingMethod: 'floor' });
  if (d.getTime() > Date.now() + 60_000) return `in ${s.replace(/ minutes?/, 'm').replace(/ hours?/, 'h').replace(/ days?/, 'd')}`;
  if (s.startsWith('0 ') || s.includes('second')) return 'just now';
  return `${s.replace(/ minutes?/, 'm').replace(/ hours?/, 'h').replace(/ days?/, 'd').replace(/ months?/, 'mo')} ago`;
}

export function shortDate(value: string | null | undefined) {
  if (!value) return '';
  const d = parseDay(value);
  return isThisYear(d) ? format(d, 'MMM d') : format(d, 'MMM d, yyyy');
}

export function longDate(value: string | null | undefined) {
  if (!value) return '';
  return format(parseDay(value), 'MMMM d, yyyy');
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '';
  return format(parseISO(iso), "MMM d, yyyy 'at' h:mm a");
}

export function shortDateTime(iso: string | null | undefined) {
  if (!iso) return '';
  const d = parseISO(iso);
  return format(d, isThisYear(d) ? "MMM d, h:mm a" : "MMM d, yyyy, h:mm a");
}

export type DueTone = 'overdue' | 'soon' | 'normal';

/** A due date the way people say it: "Today", "Tomorrow", "Fri", "Sep 30". */
export function dueLabel(day: string | null | undefined): { label: string; tone: DueTone; days: number } | null {
  if (!day) return null;
  const days = differenceInCalendarDays(parseDay(day), new Date());
  if (days < 0) return { label: days === -1 ? 'Yesterday' : shortDate(day), tone: 'overdue', days };
  if (days === 0) return { label: 'Today', tone: 'soon', days };
  if (days === 1) return { label: 'Tomorrow', tone: 'soon', days };
  if (days < 7) return { label: format(parseDay(day), 'EEEE'), tone: days <= 2 ? 'soon' : 'normal', days };
  return { label: shortDate(day), tone: 'normal', days };
}

/** A deadline countdown: "Closes in 12 days", "Closes today at 5:00 PM", "Closed Sep 3". */
export function deadlineLabel(iso: string | null | undefined) {
  if (!iso) return { label: 'Rolling — no deadline', tone: 'normal' as DueTone };
  const d = parseISO(iso);
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return { label: `Closed ${shortDate(iso)}`, tone: 'normal' as DueTone };
  const days = differenceInCalendarDays(d, new Date());
  if (days === 0) return { label: `Closes today at ${format(d, 'h:mm a')}`, tone: 'overdue' as DueTone };
  if (days === 1) return { label: `Closes tomorrow at ${format(d, 'h:mm a')}`, tone: 'soon' as DueTone };
  if (days < 14) return { label: `Closes in ${days} days`, tone: days <= 7 ? ('soon' as DueTone) : ('normal' as DueTone) };
  return { label: `Closes ${shortDate(iso)}`, tone: 'normal' as DueTone };
}

export function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** A link to this app's own route, for copying. */
export function appUrl(hashPath: string) {
  return `${window.location.origin}${window.location.pathname}#${hashPath.startsWith('/') ? hashPath : `/${hashPath}`}`;
}

export function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
