import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { iso, ref, str } from '@project/shared/server/sql';
import { canManageSession, loadSession, REGISTRATION_STATUSES, registrationRowSchema, seatsCancelledWith, sessionRowSchema, type RegistrationStatus } from '../server/sessions';

/**
 * One live session with everyone who registered, in the order staff work
 * through them: registered, waitlisted (in queue order), attended, absent,
 * cancelled.
 */

const Input = z.object({ id: z.string().min(1) });
const Output = z.object({
  session: sessionRowSchema,
  canManage: z.boolean(),
  registrations: z.array(registrationRowSchema),
  /** For a cancelled session: how many people rescheduling it would register again. */
  rescheduleCount: z.number(),
});

export default createEndpoint({
  description: 'Load a live session with its registrations',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which session?', 'BAD_REQUEST');
    const session = await loadSession(parsed.data.id);
    if (!session) throw new ZiteError('That session no longer exists', 'NOT_FOUND');
    const { rows } = await zite.sql({
      query: `SELECT g.id, g."personId", g."status", g."registeredAt", g."checkedInAt", g."remindedAt", g.created_at,
                p."name", p."email", p."title", p."color", p."avatarUrl", p."status" AS "personStatus"
              FROM "Registrations" g JOIN "People" p ON p.id::text = g."personId"
              WHERE g."sessionId" = $1
              ORDER BY CASE g."status" WHEN 'Registered' THEN 0 WHEN 'Waitlisted' THEN 1 WHEN 'Attended' THEN 2 WHEN 'Absent' THEN 3 ELSE 4 END,
                COALESCE(g."registeredAt", g.created_at) ASC`,
      params: [session.id],
    });
    return {
      session,
      canManage: await canManageSession(actor, session),
      rescheduleCount: session.status === 'Cancelled' ? (await seatsCancelledWith(session.id)).length : 0,
      registrations: rows.map(r => ({
        id: String(r.id),
        personId: String(r.personId),
        name: str(r.name) || str(r.email) || 'Unnamed',
        email: str(r.email) ?? '',
        title: ref(r.title),
        color: str(r.color) || '#8b8d98',
        avatarUrl: ref(r.avatarUrl),
        personStatus: str(r.personStatus) || 'Active',
        status: (REGISTRATION_STATUSES.includes(r.status as RegistrationStatus) ? r.status : 'Registered') as RegistrationStatus,
        registeredAt: iso(r.registeredAt) ?? iso(r.created_at),
        checkedInAt: iso(r.checkedInAt),
        remindedAt: iso(r.remindedAt),
      })),
    };
  },
});
