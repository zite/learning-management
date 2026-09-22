import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { iso, Params, ref, str } from '@project/shared/server/sql';

/**
 * People for pickers: search by name, email or title, or resolve specific ids
 * (to label chips that were picked earlier). Deactivated people are left out
 * unless asked for.
 */

const Input = z.object({
  q: z.string().max(200).default(''),
  ids: z.array(z.string()).max(500).optional(),
  groupId: z.string().optional(),
  roles: z.array(z.enum(['Admin', 'Instructor', 'Learner'])).optional(),
  includeDeactivated: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(30),
});

const personLiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  title: z.string().nullable(),
  color: z.string(),
  avatarUrl: z.string().nullable(),
  managerId: z.string().nullable(),
  lastLearnedAt: z.string().nullable(),
});

export default createEndpoint({
  description: 'Search people by name or email for pickers',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ people: z.array(personLiteSchema) }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Invalid search', 'BAD_REQUEST');
    const { q, ids, groupId, roles, includeDeactivated, limit } = parsed.data;
    const p = new Params();
    const w: string[] = [];
    if (ids?.length) w.push(`p.id::text = ANY(${p.add(ids)}::text[])`);
    if (!includeDeactivated && !ids?.length) w.push(`COALESCE(p."status", '') <> 'Deactivated'`);
    if (groupId) w.push(`EXISTS (SELECT 1 FROM "GroupMembers" gm WHERE gm."personId" = p.id::text AND gm."groupId" = ${p.add(groupId)})`);
    if (roles?.length) w.push(`p."role" = ANY(${p.add(roles)}::text[])`);
    let order = 'LOWER(p."name") ASC';
    if (q.trim()) {
      const term = q.trim().toLowerCase();
      const like = p.add(`%${term}%`);
      const prefix = p.add(`${term}%`);
      w.push(`(LOWER(p."name") LIKE ${like} OR LOWER(p."email") LIKE ${like} OR LOWER(COALESCE(p."title", '')) LIKE ${like})`);
      order = `CASE WHEN LOWER(p."name") LIKE ${prefix} OR LOWER(p."email") LIKE ${prefix} THEN 0 ELSE 1 END, LOWER(p."name") ASC`;
    }
    const { rows } = await zite.sql({
      query: `SELECT p.id, p."name", p."email", p."role", p."status", p."title", p."color", p."avatarUrl", p."managerId", p."lastLearnedAt" FROM "People" p ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ${ids?.length ? Math.min(500, ids.length) : limit}`,
      params: p.values,
    });
    return {
      people: rows.map(r => ({
        id: String(r.id),
        name: str(r.name) || str(r.email) || 'Unnamed',
        email: str(r.email) ?? '',
        role: str(r.role) || 'Learner',
        status: str(r.status) || 'Active',
        title: ref(r.title),
        color: str(r.color) || '#8b8d98',
        avatarUrl: ref(r.avatarUrl),
        managerId: ref(r.managerId),
        lastLearnedAt: iso(r.lastLearnedAt),
      })),
    };
  },
});
