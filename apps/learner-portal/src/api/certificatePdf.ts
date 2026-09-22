import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { Pdf } from 'zitejs/pdf';
import { certificateFilename, certificateHtml } from '@project/shared/certificateHtml';
import { getLearner } from '@project/shared/server/people';
import { getSettings, learnLink } from '@project/shared/server/settings';
import { loadVisibleCertificate } from '../server/learn';

/** A print-quality PDF of a certificate the actor may see. */

const Input = z.object({ id: z.string().min(1).max(64), verifyUrl: z.string().url().max(500).optional() });

export default createEndpoint({
  description: 'Download a certificate as a PDF',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<{ url: string; filename: string }> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('That link is missing the certificate.', 'BAD_REQUEST');
    const settings = await getSettings();
    const actor = await getLearner(context, settings);
    const cert = await loadVisibleCertificate(actor.id, parsed.data.id);
    if (!cert) throw new ZiteError("We couldn't find that certificate. It may belong to someone else, or the link may be mistyped.", 'NOT_FOUND');

    // Prefer the academy's known address; fall back to the one the browser is on (it must point at this certificate's verify page).
    const clientUrl = parsed.data.verifyUrl && /^https:\/\//.test(parsed.data.verifyUrl) && parsed.data.verifyUrl.includes(`/verify/${cert.credentialId}`) ? parsed.data.verifyUrl : null;
    const verifyUrl = learnLink(settings, `/verify/${cert.credentialId}`) || clientUrl;
    const props = {
      timeZone: settings.timezone,
      recipientName: cert.recipientName,
      title: cert.title,
      kind: cert.kind,
      organizationName: settings.organizationName,
      academyName: settings.academyName,
      certificateTitle: settings.certificateTitle,
      issuedAt: cert.issuedAt,
      expiresAt: cert.expiresAt,
      credentialId: cert.credentialId,
      signatory: settings.certificateSignatory || null,
      signatoryTitle: settings.certificateSignatoryTitle || null,
      logoUrl: settings.logoUrl,
      brandColor: settings.brandColor,
      revoked: cert.status === 'Revoked',
      verifyUrl,
    };
    const filename = certificateFilename(props);
    const { url } = await Pdf.renderHtml({ html: certificateHtml(props), filename });
    return { url, filename };
  },
});
