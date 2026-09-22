import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { eachWrite } from '@project/shared/server/sql';

/**
 * Triage the admin inbox: mark read or unread, archive or restore. Only ever
 * touches the signed-in person's own admin notifications.
 *
 * With `all: true`, "read" marks every unread notification read and "archive"
 * sweeps everything already read into Archived (unread items stay put).
 */

const Input = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    all: z.literal(true).optional(),
    action: z.enum(['read', 'unread', 'archive', 'unarchive']),
  })
  .refine(v => v.all || (v.ids && v.ids.length > 0), { message: 'Choose which notifications to update' });

export default createEndpoint({
  description: "Mark the signed-in staff member's admin notifications read, unread, archived or restored",
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ updated: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Choose which notifications to update', 'BAD_REQUEST');
    const { ids, all, action } = parsed.data;
    if (all && (action === 'unread' || action === 'unarchive')) throw new ZiteError('Choose which notifications to update', 'BAD_REQUEST');

    const now = new Date().toISOString();
    const params: unknown[] = [actor.id];
    let target = '';
    if (!all) {
      params.push(ids);
      target = `AND id::text = ANY($2::text[])`;
    }
    const condition =
      // "Mark all read" is about the inbox; marking one archived notification read (U in Archived) is allowed.
      action === 'read' ? (all ? `"readAt" IS NULL AND "archivedAt" IS NULL` : `"readAt" IS NULL`)
      : action === 'unread' ? `"readAt" IS NOT NULL`
      : action === 'archive' ? (all ? `"archivedAt" IS NULL AND "readAt" IS NOT NULL` : `"archivedAt" IS NULL`)
      : `"archivedAt" IS NOT NULL`;

    const { rows } = await zite.sql({
      query: `SELECT id FROM "Notifications" WHERE "recipientId" = $1 AND "app" = 'Admin' ${target} AND ${condition} LIMIT 2000`,
      params,
    });
    const record = action === 'read' ? { readAt: now } : action === 'unread' ? { readAt: null } : action === 'archive' ? { archivedAt: now } : { archivedAt: null };
    // Live Zite rate-limits bursts of writes, so these go two at a time with retries.
    await eachWrite(rows, r => zite.notifications.update({ id: String(r.id), record }));
    return { updated: rows.length };
  },
});
