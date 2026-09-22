import { certStateText } from './certDates';
import { differenceInCalendarDays, format, isThisYear, isToday, isTomorrow, parseISO } from 'date-fns';
import type { CertificateState, DueState } from '@project/shared/progress';
import { appUrl, parseDay, shortDate } from './format';

/** Words for the learner app's pages: sources, due dates, certificate states, calendars and share links. */

/** "Good morning", from the device's clock. */
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

type SourceLike = { source: string; assignedByName: string | null; ruleName?: string | null; path?: { title: string } | null };

/** Why this is on someone's list: "Assigned by Maya Okafor", "Part of Manager Essentials", "Required for everyone". */
export function sourceText(e: SourceLike) {
  if (e.path && e.source !== 'Self-enrolled') return `Part of ${e.path.title}`;
  if (e.source === 'Self-enrolled') return 'You enrolled';
  // Rule names are written for admins ("Manager Essentials for people leaders"), so learners just see that it's required.
  if (e.source === 'Automatic') return 'Required training';
  if (e.assignedByName) return `Assigned by ${e.assignedByName}`;
  return 'Assigned to you';
}

/** A due date the way a person says it, relative to today. */
export function dueText(dueDate: string | null, state: DueState) {
  if (!dueDate) return state === 'done' ? 'Completed' : 'No due date';
  const d = parseDay(dueDate);
  const days = differenceInCalendarDays(d, new Date());
  if (state === 'overdue') return days === -1 ? 'Overdue · was due yesterday' : `Overdue · was due ${shortDate(dueDate)}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 7) return `Due ${format(d, 'EEEE')}`;
  return `Due ${shortDate(dueDate)}`;
}

export const DUE_TONE: Record<DueState, 'danger' | 'warning' | 'neutral' | 'success'> = { overdue: 'danger', due_soon: 'warning', on_track: 'neutral', no_due: 'neutral', done: 'success', withdrawn: 'neutral' };

export const CERT_TONE: Record<CertificateState, 'success' | 'warning' | 'neutral' | 'danger'> = { active: 'success', expiring: 'warning', expired: 'neutral', revoked: 'danger' };

/** "Valid · no expiry", "Expires in 12 days", "Expired Sep 11", "Revoked" — in UTC, like the certificate itself. */
export function certificateStateText(state: CertificateState, expiresAt: string | null) {
  return certStateText({ state, expiresAt });
}

/** Session time in the viewer's own zone: "Tue, Sep 16 · 3:00–3:45 PM". */
export function sessionWhen(startsAt: string | null, endsAt: string | null) {
  if (!startsAt) return 'Time to be confirmed';
  const s = parseISO(startsAt);
  const day = isToday(s) ? 'Today' : isTomorrow(s) ? 'Tomorrow' : format(s, isThisYear(s) ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');
  if (!endsAt) return `${day} · ${format(s, 'h:mm a')}`;
  const e = parseISO(endsAt);
  const sameMeridiem = format(s, 'a') === format(e, 'a');
  return `${day} · ${format(s, sameMeridiem ? 'h:mm' : 'h:mm a')}–${format(e, 'h:mm a')}`;
}

/** The device's short time-zone name, e.g. "CDT". */
export function localZone() {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** Where to verify a certificate: the academy's known address, else this app's own. */
export function verifyLink(credentialId: string, known?: string | null) {
  return known || appUrl(`/verify/${credentialId}`);
}

/** LinkedIn's "Add licence or certification" form, prefilled. */
export function linkedInUrl(c: { title: string; organizationName: string; issuedAt: string | null; expiresAt: string | null; credentialId: string; verifyUrl: string }) {
  const params = new URLSearchParams({ startTask: 'CERTIFICATION_NAME', name: c.title, organizationName: c.organizationName, certUrl: c.verifyUrl, certId: c.credentialId });
  if (c.issuedAt) {
    const d = parseISO(c.issuedAt);
    params.set('issueYear', String(d.getUTCFullYear()));
    params.set('issueMonth', String(d.getUTCMonth() + 1));
  }
  if (c.expiresAt) {
    const d = parseISO(c.expiresAt);
    params.set('expirationYear', String(d.getUTCFullYear()));
    params.set('expirationMonth', String(d.getUTCMonth() + 1));
  }
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** An .ics file for one session, saved from the browser. */
export function downloadIcs(s: { id: string; title: string; description?: string; startsAt: string | null; endsAt: string | null; location?: string; meetingUrl?: string | null; courseTitle?: string | null; link?: string }) {
  if (!s.startsAt) return;
  const end = s.endsAt ?? new Date(Date.parse(s.startsAt) + 60 * 60 * 1000).toISOString();
  const details = [s.description, s.courseTitle ? `Part of ${s.courseTitle}` : '', s.meetingUrl ? `Join: ${s.meetingUrl}` : '', s.link ?? ''].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Learning Management//Academy//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${s.id}@lms`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(s.startsAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(s.title)}`,
    details ? `DESCRIPTION:${icsText(details)}` : '',
    s.location || s.meetingUrl ? `LOCATION:${icsText(s.location || s.meetingUrl || '')}` : '',
    s.meetingUrl ? `URL:${s.meetingUrl}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${s.title.replace(/[^\w\s-]+/g, '').trim().slice(0, 60) || 'session'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Minutes as "45 min", "1 hr 20 min"; hours for big totals. */
export function hoursText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} hr`;
}

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
