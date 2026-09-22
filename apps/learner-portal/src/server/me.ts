import { zite } from 'zitejs/db';
import { iso } from '@project/shared/server/sql';

/**
 * Server helpers for the learner's own pages — certificates, sessions, team,
 * leaderboard. (Shared learner helpers live in `learn.ts`.)
 */

export type CertificateRenewal = { id: string; issuedAt: string | null };

/**
 * Columns for a certificate's renewal: the newest active certificate issued
 * later to the same person for the same course or path. The certificate is `ce`.
 */
export const RENEWAL_COLUMNS = `renewal.id AS "renewalId", renewal."issuedAt" AS "renewalIssuedAt"`;

export const RENEWAL_JOIN = `LEFT JOIN LATERAL (
    SELECT n.id::text AS id, n."issuedAt" FROM "Certificates" n
    WHERE n."personId" = ce."personId" AND n."status" = 'Active' AND n."issuedAt" > ce."issuedAt"
      AND COALESCE(n."courseId", '') = COALESCE(ce."courseId", '') AND COALESCE(n."pathId", '') = COALESCE(ce."pathId", '')
    ORDER BY n."issuedAt" DESC LIMIT 1
  ) renewal ON true`;

export function toRenewal(r: Record<string, unknown>): CertificateRenewal | null {
  return r.renewalId ? { id: String(r.renewalId), issuedAt: iso(r.renewalIssuedAt) } : null;
}

/** The renewal of one certificate, by its id. */
export async function loadRenewal(certificateId: string): Promise<CertificateRenewal | null> {
  const { rows } = await zite.sql({
    query: `SELECT ${RENEWAL_COLUMNS} FROM "Certificates" ce ${RENEWAL_JOIN} WHERE ce.id::text = $1 LIMIT 1`,
    params: [certificateId],
  });
  return rows[0] ? toRenewal(rows[0]) : null;
}
