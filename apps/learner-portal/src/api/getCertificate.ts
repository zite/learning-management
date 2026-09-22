import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { getLearner } from '@project/shared/server/people';
import { getSettings, learnLink } from '@project/shared/server/settings';
import { certificateOrg, loadVisibleCertificate, type CertificateOrg, type CertificateSummary } from '../server/learn';
import { loadRenewal, type CertificateRenewal } from '../server/me';

/**
 * One certificate, with everything `CertificateArt` draws. Learners open
 * their own; managers can open a direct report's.
 */

const Input = z.object({ id: z.string().min(1).max(64) });

export type CertificateOutput = {
  certificate: CertificateSummary & {
    isMine: boolean;
    revokedAt: string | null;
    revokedReason: string;
    renewal: CertificateRenewal | null;
  };
  org: CertificateOrg;
  /** Empty until the learner app's public URL is known; the client builds one from its own address then. */
  verifyUrl: string | null;
};

export default createEndpoint({
  description: 'A certificate',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<CertificateOutput> => {
    const parsed = Input.safeParse(input ?? {});
    // A malformed id is just a link to nothing.
    if (!parsed.success) throw new ZiteError("We couldn't find that certificate. The link may be mistyped.", 'NOT_FOUND');
    const settings = await getSettings();
    const actor = await getLearner(context, settings);
    const certificate = await loadVisibleCertificate(actor.id, parsed.data.id);
    if (!certificate) throw new ZiteError("We couldn't find that certificate. It may belong to someone else, or the link may be mistyped.", 'NOT_FOUND');
    // A renewal only matters once this one has lapsed.
    const renewal = certificate.state === 'expired' || certificate.state === 'expiring' ? await loadRenewal(certificate.id) : null;
    return {
      certificate: { ...certificate, renewal },
      org: certificateOrg(settings),
      verifyUrl: learnLink(settings, `/verify/${certificate.credentialId}`) || null,
    };
  },
});
