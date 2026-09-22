import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { bool, iso, str } from '@project/shared/server/sql';
import { commentAuthor, loadLessonContext } from '../server/player';

/**
 * Questions and answers on one lesson: pinned threads first, then the newest,
 * each with its replies in order. Learners see each other by first name and
 * last initial; instructors by full name with a badge, so an answer from
 * staff is easy to spot.
 */

const Input = z.object({ lessonId: z.string().min(1).max(100) });

const Author = z.object({ id: z.string(), name: z.string(), initials: z.string(), color: z.string(), avatarUrl: z.string().nullable(), badge: z.enum(['Instructor', 'Admin']).nullable() });
const Comment = z.object({ id: z.string(), body: z.string(), postedAt: z.string().nullable(), editedAt: z.string().nullable(), own: z.boolean(), deleted: z.boolean(), author: Author });

const Output = z.object({
  enabled: z.boolean(),
  threads: z.array(Comment.extend({ pinned: z.boolean(), resolved: z.boolean(), replies: z.array(Comment) })),
});

export default createEndpoint({
  description: "Questions and replies on a lesson the signed-in learner can open",
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which lesson?', 'BAD_REQUEST');
    const { ctx, lesson } = await loadLessonContext(context, parsed.data.lessonId);
    if (!ctx.settings.discussionsEnabled) return { enabled: false, threads: [] };

    const { rows } = await zite.sql({
      query: `SELECT c.id, c."body", c."personId", c."parentId", c."postedAt", c."editedAt", c."pinned", c."resolvedAt", c.created_at,
                     p."name" AS "authorName", p."role" AS "authorRole", p."color" AS "authorColor", p."avatarUrl" AS "authorAvatarUrl"
              FROM "Comments" c LEFT JOIN "People" p ON p.id::text = c."personId"
              WHERE c."lessonId" = $1
              ORDER BY COALESCE(c."postedAt", c.created_at) ASC`,
      params: [lesson.id],
    });
    const staff = new Set([ctx.course.ownerId, ...ctx.course.instructorIds].filter(Boolean) as string[]);
    const toComment = (r: Record<string, unknown>) => {
      const body = str(r.body) ?? '';
      return {
        id: String(r.id),
        body,
        postedAt: iso(r.postedAt) ?? iso(r.created_at),
        editedAt: iso(r.editedAt),
        own: String(r.personId) === ctx.actor.id,
        deleted: !body.trim(),
        author: commentAuthor(r, staff),
      };
    };

    const tops = rows.filter(r => !str(r.parentId));
    const topIds = new Set(tops.map(r => String(r.id)));
    const replies = new Map<string, ReturnType<typeof toComment>[]>();
    for (const r of rows) {
      const parent = str(r.parentId);
      if (!parent || !topIds.has(parent) || !(str(r.body) ?? '').trim()) continue;
      replies.set(parent, [...(replies.get(parent) ?? []), toComment(r)]);
    }

    const threads = tops
      .map(r => ({ ...toComment(r), pinned: bool(r.pinned), resolved: Boolean(iso(r.resolvedAt)), replies: replies.get(String(r.id)) ?? [] }))
      // A deleted question stays only while someone's answer hangs off it.
      .filter(t => !t.deleted || t.replies.length > 0)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.postedAt ?? '') - Date.parse(a.postedAt ?? ''));

    return { enabled: true, threads };
  },
});
