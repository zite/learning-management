import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getLearner } from '@project/shared/server/people';
import { eachWrite, num } from '@project/shared/server/sql';

/** Mark the learner's own notifications read or unread, archive (or un-archive, for undo) them, or mark everything read. */

const Input = z.object({
  action: z.enum(['read', 'unread', 'archive', 'unarchive', 'read_all']),
  ids: z.array(z.string().min(1).max(64)).max(200).default([]),
});

export default createEndpoint({
  description: "Update the learner's notifications",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<{ updated: number; unreadCount: number }> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Choose which notifications to update.', 'BAD_REQUEST');
    const actor = await getLearner(context);
    const { action, ids } = parsed.data;
    if (action !== 'read_all' && !ids.length) throw new ZiteError('Choose which notifications to update.', 'BAD_REQUEST');

    // Only ever the actor's own Learn notifications, whatever ids were sent.
    const { rows } = await zite.sql({
      query: `SELECT id::text AS id, "readAt" FROM "Notifications"
              WHERE "recipientId" = $1 AND "app" = 'Learn' AND ("archivedAt" IS NULL) = $4::boolean
                AND ($2::boolean OR id::text = ANY($3::text[]))`,
      params: [actor.id, action === 'read_all', ids, action !== 'unarchive'],
    });
    const now = new Date().toISOString();
    const targets = action === 'read' || action === 'read_all' ? rows.filter(r => r.readAt == null) : action === 'unread' ? rows.filter(r => r.readAt != null) : rows;
    const record = action === 'archive' ? { archivedAt: now, readAt: now } : action === 'unarchive' ? { archivedAt: null } : action === 'unread' ? { readAt: null } : { readAt: now };
    await eachWrite(targets, r =>
      zite.notifications.update({
        id: String(r.id),
        record: (action === 'archive' && r.readAt ? { archivedAt: now } : record) as never,
      }),
    );

    const { rows: count } = await zite.sql({
      query: `SELECT COUNT(*) AS "unreadTotal" FROM "Notifications" WHERE "recipientId" = $1 AND "app" = 'Learn' AND "archivedAt" IS NULL AND "readAt" IS NULL`,
      params: [actor.id],
    });
    return { updated: targets.length, unreadCount: num(count[0]?.unreadTotal) };
  },
});
