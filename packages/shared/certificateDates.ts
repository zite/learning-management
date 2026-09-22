/**
 * Certificate dates are the issuing organization's calendar dates: a course
 * finished at 9pm in Chicago is dated that day on the certificate, the PDF,
 * every list and the public verification page, wherever it's viewed from.
 *
 * Each app sets the organization's time zone once when its settings load; the
 * server-side PDF passes the zone explicitly.
 */

let orgZone = 'UTC';

const isZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export function setCertificateTimeZone(tz: string | null | undefined) {
  orgZone = tz && isZone(tz) ? tz : 'UTC';
}

export const certificateTimeZone = () => orgZone;

const valid = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The calendar day ("2026-09-14") an instant falls on in the zone. */
export function certificateDay(iso: string | Date, timeZone = orgZone) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(d);
}

/**
 * "September 14, 2026" (long), "Sep 14" or "Sep 14, 2027" outside this year
 * (short), "Sep 2027" (month).
 */
export function certificateDate(iso: string | null | undefined, style: 'long' | 'short' | 'month' = 'long', timeZone = orgZone) {
  const d = valid(iso);
  if (!d) return '';
  if (style === 'long') return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone }).format(d);
  if (style === 'month') return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone }).format(d);
  const sameYear = certificateDay(d, timeZone).slice(0, 4) === certificateDay(new Date(), timeZone).slice(0, 4);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone }).format(d);
}

/** Whole calendar days in the zone from today to `iso` (negative when past). */
export function certificateDaysUntil(iso: string, now = new Date(), timeZone = orgZone) {
  const day = (d: Date) => Date.parse(`${certificateDay(d, timeZone)}T00:00:00Z`);
  return Math.round((day(new Date(iso)) - day(now)) / 86_400_000);
}
