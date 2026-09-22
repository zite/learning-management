import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getLearner } from '@project/shared/server/people';
import { getSettings, learnLink } from '@project/shared/server/settings';
import { certificateOrg, CERTIFICATE_COLUMNS, toCertificateSummary, type CertificateOrg, type CertificateSummary } from '../server/learn';
import { RENEWAL_COLUMNS, RENEWAL_JOIN, toRenewal, type CertificateRenewal } from '../server/me';

/**
 * The learner's certificates, newest first, with what a thumbnail needs to
 * draw them, the newer certificate that replaced an expired one, and the
 * public verification address when the academy's URL is known.
 */

export type MyCertificate = CertificateSummary & {
  renewal: CertificateRenewal | null;
  verifyUrl: string | null;
};

export type MyCertificatesOutput = {
  certificates: MyCertificate[];
  org: CertificateOrg;
};

export default createEndpoint({
  description: "The learner's certificates",
  authenticated: true,
  inputSchema: z.object({}),
  execute: async ({ context }): Promise<MyCertificatesOutput> => {
    const settings = await getSettings();
    const actor = await getLearner(context, settings);
    const { rows } = await zite.sql({
      query: `SELECT ${CERTIFICATE_COLUMNS}, ${RENEWAL_COLUMNS} FROM "Certificates" ce ${RENEWAL_JOIN} WHERE ce."personId" = $1 ORDER BY ce."issuedAt" DESC NULLS LAST, ce.created_at DESC`,
      params: [actor.id],
    });
    return {
      certificates: rows.map(r => {
        const summary = toCertificateSummary(r);
        return {
          ...summary,
          renewal: toRenewal(r),
          verifyUrl: learnLink(settings, `/verify/${summary.credentialId}`) || null,
        };
      }),
      org: certificateOrg(settings),
    };
  },
});
