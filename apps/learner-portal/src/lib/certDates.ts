import { certificateDate, certificateDaysUntil } from '@project/shared/certificateDates';

/**
 * Certificate dates in the issuing organization's time zone — the same dates
 * the certificate and its PDF print (see packages/shared/certificateDates).
 */

/** "July 13, 2026" */
export const certLongDate = (iso: string | null | undefined) => certificateDate(iso, 'long');

/** "Jul 13", or "Jul 13, 2027" outside this year. */
export const certShortDate = (iso: string | null | undefined) => certificateDate(iso, 'short');

/** Whole calendar days from today to `iso` (negative when past). */
export const certDaysUntil = (iso: string, now = new Date()) => certificateDaysUntil(iso, now);

type StateLike = {
  state: 'active' | 'expiring' | 'expired' | 'revoked';
  expiresAt: string | null;
};

/** "Valid · no expiry", "Valid until Jul 13, 2027", "Expires in 12 days", "Expired Sep 12", "Revoked". */
export function certStateText(c: StateLike) {
  if (c.state === 'revoked') return 'Revoked';
  if (!c.expiresAt) return 'Valid · no expiry';
  if (c.state === 'expired') return `Expired ${certShortDate(c.expiresAt)}`;
  if (c.state === 'expiring') {
    const days = certDaysUntil(c.expiresAt);
    return days <= 0 ? 'Expires today' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
  }
  return `Valid until ${certShortDate(c.expiresAt)}`;
}
