import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { iso, ref, str } from '@project/shared/server/sql';

/** ⌘K search across people, courses, lessons, paths, groups and sessions. */

const Input = z.object({ query: z.string().max(200), limit: z.number().int().min(1).max(25).default(8) });

export default createEndpoint({
  description: 'Search people, courses, lessons, paths, groups and sessions',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    people: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), title: z.string().nullable(), color: z.string(), avatarUrl: z.string().nullable(), status: z.string() })),
    lessons: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), courseId: z.string(), courseTitle: z.string() })),
    sessions: z.array(z.object({ id: z.string(), title: z.string(), startsAt: z.string().nullable() })),
  }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    const q = parsed.success ? parsed.data.query.trim().toLowerCase() : '';
    const limit = parsed.success ? parsed.data.limit : 8;
    if (!q) return { people: [], lessons: [], sessions: [] };
    const like = `%${q}%`;
    const [people, lessons, sessions] = await Promise.all([
      zite.sql({
        query: `SELECT id, "name", "email", "title", "color", "avatarUrl", "status" FROM "People" WHERE LOWER("name") LIKE $1 OR LOWER("email") LIKE $1 ORDER BY CASE WHEN LOWER("name") LIKE $2 THEN 0 ELSE 1 END, LOWER("name") LIMIT ${limit}`,
        params: [like, `${q}%`],
      }),
      zite.sql({ query: `SELECT l.id, l."title", l."type", l."courseId", c."title" AS "courseTitle" FROM "Lessons" l JOIN "Courses" c ON c.id::text = l."courseId" WHERE LOWER(l."title") LIKE $1 ORDER BY LOWER(l."title") LIMIT ${limit}`, params: [like] }),
      zite.sql({ query: `SELECT id, "title", "startsAt" FROM "Sessions" WHERE LOWER("title") LIKE $1 ORDER BY "startsAt" DESC NULLS LAST LIMIT ${limit}`, params: [like] }),
    ]);
    return {
      people: people.rows.map(r => ({ id: String(r.id), name: str(r.name) || str(r.email) || '', email: str(r.email) ?? '', title: ref(r.title), color: str(r.color) || '#8b8d98', avatarUrl: ref(r.avatarUrl), status: str(r.status) || 'Active' })),
      lessons: lessons.rows.map(r => ({ id: String(r.id), title: str(r.title) ?? '', type: str(r.type) || 'Article', courseId: String(r.courseId), courseTitle: str(r.courseTitle) ?? '' })),
      sessions: sessions.rows.map(r => ({ id: String(r.id), title: str(r.title) ?? '', startsAt: iso(r.startsAt) })),
    };
  },
});
