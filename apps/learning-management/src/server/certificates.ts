import { z } from 'zod';
import { certificateState } from '@project/shared/progress';
import { iso, numOrNull, ref, str } from '@project/shared/server/sql';

/**
 * Certificates on the admin side. States are derived from dates exactly as
 * `certificateState` does (revoked → expired → expiring within 30 days →
 * active), so a tab count, a row's pill and the learner's own page agree.
 */

export const CERTIFICATE_STATES = ['active', 'expiring', 'expired', 'revoked'] as const;
export type CertState = (typeof CERTIFICATE_STATES)[number];

const NOT_REVOKED = `COALESCE(ce."status", '') <> 'Revoked'`;
export const STATE_SQL: Record<CertState, string> = {
  revoked: `ce."status" = 'Revoked'`,
  expired: `(${NOT_REVOKED} AND ce."expiresAt" IS NOT NULL AND ce."expiresAt" <= NOW())`,
  expiring: `(${NOT_REVOKED} AND ce."expiresAt" IS NOT NULL AND ce."expiresAt" > NOW() AND ce."expiresAt" <= NOW() + INTERVAL '30 days')`,
  active: `(${NOT_REVOKED} AND (ce."expiresAt" IS NULL OR ce."expiresAt" > NOW() + INTERVAL '30 days'))`,
};

export const CERT_FROM = `
  FROM "Certificates" ce
  LEFT JOIN "People" p ON p.id::text = ce."personId"
  LEFT JOIN "Courses" c ON c.id::text = ce."courseId"
  LEFT JOIN "Paths" pa ON pa.id::text = ce."pathId"
  LEFT JOIN "People" ib ON ib.id::text = ce."issuedById"`;

export const CERT_COLUMNS = `ce.*, p."name" AS "personName", p."email" AS "personEmail", p."color" AS "personColor", p."avatarUrl" AS "personAvatarUrl", p."status" AS "personStatus",
  c."title" AS "courseTitle", c."icon" AS "courseIcon", c."color" AS "courseColor", pa."title" AS "pathTitle", pa."icon" AS "pathIcon", pa."color" AS "pathColor", ib."name" AS "issuedByName"`;

export const certificateRowSchema = z.object({
  id: z.string(),
  credentialId: z.string(),
  personId: z.string().nullable(),
  personName: z.string(),
  personEmail: z.string(),
  personColor: z.string(),
  personAvatarUrl: z.string().nullable(),
  personStatus: z.string(),
  recipientName: z.string(),
  title: z.string(),
  kind: z.enum(['course', 'path']),
  courseId: z.string().nullable(),
  pathId: z.string().nullable(),
  targetIcon: z.string(),
  targetColor: z.string(),
  enrollmentId: z.string().nullable(),
  issuedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  status: z.enum(['Active', 'Revoked']),
  state: z.enum(CERTIFICATE_STATES),
  score: z.number().nullable(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable(),
  issuedByName: z.string().nullable(),
});
export type CertificateRow = z.infer<typeof certificateRowSchema>;

export function mapCertificateRow(r: Record<string, unknown>): CertificateRow {
  const status = r.status === 'Revoked' ? 'Revoked' : 'Active';
  const expiresAt = iso(r.expiresAt);
  const isPath = Boolean(ref(r.pathId)) && !ref(r.courseId);
  return {
    id: String(r.id),
    credentialId: str(r.credentialId) ?? '',
    personId: ref(r.personId),
    personName: str(r.personName) || str(r.recipientName) || 'Former learner',
    personEmail: str(r.personEmail) ?? '',
    personColor: str(r.personColor) || '#8b8d98',
    personAvatarUrl: ref(r.personAvatarUrl),
    personStatus: str(r.personStatus) || 'Active',
    recipientName: str(r.recipientName) || str(r.personName) || '',
    title: str(r.title) || str(isPath ? r.pathTitle : r.courseTitle) || 'Certificate',
    kind: isPath ? 'path' : 'course',
    courseId: ref(r.courseId),
    pathId: ref(r.pathId),
    targetIcon: str(isPath ? r.pathIcon : r.courseIcon) ?? '',
    targetColor: str(isPath ? r.pathColor : r.courseColor) || '#2f6b55',
    enrollmentId: ref(r.enrollmentId),
    issuedAt: iso(r.issuedAt),
    expiresAt,
    status,
    state: certificateState({ status, expiresAt }),
    score: numOrNull(r.score),
    revokedAt: iso(r.revokedAt),
    revokedReason: ref(r.revokedReason),
    issuedByName: ref(r.issuedByName),
  };
}
