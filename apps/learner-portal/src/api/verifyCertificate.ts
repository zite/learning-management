import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { certificateState, normaliseCredentialId, type CertificateState } from '@project/shared/progress';
import { getSettings } from '@project/shared/server/settings';
import { iso, ref, str } from '@project/shared/server/sql';
import { RENEWAL_COLUMNS, RENEWAL_JOIN, toRenewal } from '../server/me';

/**
 * Public certificate verification — an employer or auditor with a credential
 * ID confirms it's genuine. No sign-in, so it returns only what a verifier
 * needs: the name on the certificate, what it's for, the organization and its
 * dates. Never an email, a person id or a score.
 */

const Input = z.object({ credentialId: z.string().max(64) });

export type VerifyOutput = {
  found: boolean;
  credentialId: string;
  recipientName: string | null;
  title: string | null;
  kind: 'course' | 'path' | null;
  issuedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  state: CertificateState | null;
  /** An expired certificate whose holder has since earned a newer one for the same course or path. */
  renewed: boolean;
  organizationName: string;
  academyName: string;
  certificateTitle: string;
  signatory: string;
  signatoryTitle: string;
  logoUrl: string | null;
  brandColor: string;
};

export default createEndpoint({
  description: 'Verify a certificate by its credential ID',
  authenticated: false,
  inputSchema: Input,
  execute: async ({ input }): Promise<VerifyOutput> => {
    const parsed = Input.safeParse(input ?? {});
    const credentialId = parsed.success ? normaliseCredentialId(parsed.data.credentialId) : '';
    const settings = await getSettings();
    const base = {
      credentialId,
      organizationName: settings.organizationName,
      academyName: settings.academyName,
      certificateTitle: settings.certificateTitle,
      signatory: settings.certificateSignatory,
      signatoryTitle: settings.certificateSignatoryTitle,
      logoUrl: settings.logoUrl && /^https:\/\//i.test(settings.logoUrl) ? settings.logoUrl : null,
      brandColor: settings.brandColor,
    };
    const empty = {
      ...base,
      found: false,
      recipientName: null,
      title: null,
      kind: null,
      issuedAt: null,
      expiresAt: null,
      revokedAt: null,
      state: null,
      renewed: false,
    };
    // A full id is 12 characters in three blocks; anything shorter can't match, so don't look.
    if (credentialId.length !== 14) return empty;
    const { rows } = await zite.sql({
      query: `SELECT ce."recipientName", ce."title", ce."courseId", ce."pathId", ce."issuedAt", ce."expiresAt", ce."status", ce."revokedAt", ${RENEWAL_COLUMNS}
              FROM "Certificates" ce ${RENEWAL_JOIN}
              WHERE UPPER(ce."credentialId") = $1 ORDER BY ce.created_at DESC LIMIT 1`,
      params: [credentialId],
    });
    const r = rows[0];
    if (!r) return empty;
    const status = r.status === 'Revoked' ? 'Revoked' : 'Active';
    const expiresAt = iso(r.expiresAt);
    const state = certificateState({ status, expiresAt });
    return {
      ...base,
      found: true,
      recipientName: str(r.recipientName) ?? '',
      title: str(r.title) ?? '',
      kind: ref(r.pathId) && !ref(r.courseId) ? 'path' : 'course',
      issuedAt: iso(r.issuedAt),
      expiresAt,
      revokedAt: status === 'Revoked' ? iso(r.revokedAt) : null,
      state,
      // Only whether a newer one exists — never its ID or dates.
      renewed: state === 'expired' && Boolean(toRenewal(r)),
    };
  },
});
