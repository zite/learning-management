import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { Pdf } from 'zitejs/pdf';
import { certificateFilename, certificateHtml } from '@project/shared/certificateHtml';
import { assertStaff, getActor } from '@project/shared/server/people';
import { getSettings, learnLink } from '@project/shared/server/settings';
import { CERT_COLUMNS, CERT_FROM, mapCertificateRow } from '../server/certificates';

/** A certificate as a landscape PDF, laid out exactly like the one on screen. */

const Input = z.object({ id: z.string().min(1), paper: z.enum(['a4', 'letter']).default('letter') });

export default createEndpoint({
  description: 'Download a certificate as a PDF',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ url: z.string(), filename: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which certificate?', 'BAD_REQUEST');
    const { rows } = await zite.sql({ query: `SELECT ${CERT_COLUMNS} ${CERT_FROM} WHERE ce.id::text = $1`, params: [parsed.data.id] });
    if (!rows[0]) throw new ZiteError('That certificate no longer exists', 'NOT_FOUND');
    const cert = mapCertificateRow(rows[0]);
    const settings = await getSettings();
    const props = {
      timeZone: settings.timezone,
      recipientName: cert.recipientName || cert.personName,
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
      verifyUrl: settings.learnUrl ? learnLink(settings, `/verify/${cert.credentialId}`) : null,
      paper: parsed.data.paper,
    };
    const filename = certificateFilename(props);
    const res = await Pdf.renderHtml({ html: certificateHtml(props), filename });
    return { url: res.url, filename: res.filename || filename };
  },
});
