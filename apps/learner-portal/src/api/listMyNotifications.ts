import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getLearner } from '@project/shared/server/people';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { httpsOrNull, validColor } from '../server/learn';

/** The learner's in-app notifications (Learn app only), newest first. Archived ones are gone for good. */

const Input = z.object({ filter: z.enum(['all', 'unread']).default('all'), limit: z.number().int().min(1).max(100).default(50) });

export type LearnNotification = {
  id: string;
  title: string;
  body: string;
  type: string;
  link: string | null;
  occurredAt: string | null;
  readAt: string | null;
  actor: { name: string; color: string; avatarUrl: string | null } | null;
  course: { icon: string; color: string } | null;
};

export type NotificationsOutput = { items: LearnNotification[]; unreadCount: number; total: number };

export default createEndpoint({
  description: "The learner's notifications",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<NotificationsOutput> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Choose all or unread notifications.', 'BAD_REQUEST');
    const actor = await getLearner(context);
    const { filter, limit } = parsed.data;
    const { rows } = await zite.sql({
      query: `SELECT n.id::text AS id, n."title", n."body", n."type", n."link", n."occurredAt", n."readAt",
                a."name" AS "actorName", a."color" AS "actorColor", a."avatarUrl" AS "actorAvatar",
                c."icon" AS "courseIcon", c."color" AS "courseColor", c.id::text AS "courseKey",
                COUNT(*) FILTER (WHERE n."readAt" IS NULL) OVER () AS "unreadTotal",
                COUNT(*) OVER () AS "allTotal"
              FROM "Notifications" n
              LEFT JOIN "People" a ON a.id::text = n."actorId"
              LEFT JOIN "Courses" c ON c.id::text = n."courseId"
              WHERE n."recipientId" = $1 AND n."app" = 'Learn' AND n."archivedAt" IS NULL
              ORDER BY n."occurredAt" DESC NULLS LAST, n.created_at DESC`,
      params: [actor.id],
    });
    const unreadCount = num(rows[0]?.unreadTotal);
    const visible = filter === 'unread' ? rows.filter(r => r.readAt == null) : rows;
    return {
      items: visible.slice(0, limit).map(r => ({
        id: String(r.id),
        title: str(r.title) ?? '',
        body: str(r.body) ?? '',
        type: str(r.type) ?? '',
        link: ref(r.link),
        occurredAt: iso(r.occurredAt),
        readAt: iso(r.readAt),
        actor: ref(r.actorName) ? { name: String(r.actorName), color: validColor(r.actorColor), avatarUrl: httpsOrNull(r.actorAvatar) } : null,
        course: ref(r.courseKey) ? { icon: str(r.courseIcon) ?? '', color: validColor(r.courseColor) } : null,
      })),
      unreadCount,
      total: filter === 'unread' ? unreadCount : num(rows[0]?.allTotal),
    };
  },
});
