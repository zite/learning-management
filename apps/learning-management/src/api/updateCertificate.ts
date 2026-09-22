import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { notify, type NotificationType } from '@project/shared/server/notify';
import { assertAdmin, getActor } from '@project/shared/server/people';
import { CERT_COLUMNS, CERT_FROM, certificateRowSchema, mapCertificateRow } from '../server/certificates';

/**
 * Revoke a certificate (with a reason, which the learner and anyone verifying
 * it will see as "revoked") or restore it. Admins only.
 */

const Input = z.object({
  id: z.string().min(1),
  action: z.enum(['revoke', 'restore']),
  reason: z.string().max(500).optional(),
});

export default createEndpoint({
  description: 'Revoke or restore a certificate',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ certificate: certificateRowSchema }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertAdmin(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid request', 'BAD_REQUEST');
    const { id, action } = parsed.data;
    const load = async () => {
      const { rows } = await zite.sql({ query: `SELECT ${CERT_COLUMNS} ${CERT_FROM} WHERE ce.id::text = $1`, params: [id] });
      return rows[0] ? mapCertificateRow(rows[0]) : null;
    };
    const cert = await load();
    if (!cert) throw new ZiteError('That certificate no longer exists', 'NOT_FOUND');

    if (action === 'revoke') {
      const reason = (parsed.data.reason ?? '').trim();
      if (reason.length < 3) throw new ZiteError('Say why the certificate is being revoked', 'BAD_REQUEST');
      if (cert.status === 'Revoked') throw new ZiteError('This certificate is already revoked', 'CONFLICT');
      await zite.certificates.update({ id, record: { status: 'Revoked', revokedAt: new Date().toISOString(), revokedReason: reason } });
      await logActivity({ type: 'certificate_revoked', personId: cert.personId, actorId: actor.id, courseId: cert.courseId, pathId: cert.pathId, data: { certificateId: id, credentialId: cert.credentialId, title: cert.title, reason } });
      await notify({
        recipientIds: [cert.personId],
        app: 'Learn',
        // Not yet in the shared union; the column is free text and the learner inbox falls back gracefully.
        type: 'certificate_revoked' as unknown as NotificationType,
        title: `Your certificate for ${cert.title} was revoked`,
        body: reason,
        courseId: cert.courseId,
        pathId: cert.pathId,
        actorId: actor.id,
        link: `/certificates/${id}`,
      });
    } else {
      if (cert.status !== 'Revoked') throw new ZiteError('This certificate isn’t revoked', 'CONFLICT');
      await zite.certificates.update({ id, record: { status: 'Active', revokedAt: null, revokedReason: null } });
    }
    const fresh = await load();
    return { certificate: fresh ?? cert };
  },
});
