import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { LATEST_CYCLE } from '../server/people-admin';

/**
 * Every group with the numbers the Groups page shows: active members, owner,
 * how much of the training assigned to its members is complete, and what's
 * overdue. One aggregate over current enrollments, not one query per group.
 */

const Output = z.object({
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      description: z.string(),
      color: z.string(),
      position: z.number(),
      createdAt: z.string().nullable(),
      owner: z.object({ id: z.string(), name: z.string(), color: z.string(), avatarUrl: z.string().nullable() }).nullable(),
      memberCount: z.number(),
      enrolled: z.number(),
      completed: z.number(),
      overdue: z.number(),
      overduePeople: z.number(),
      completionRate: z.number().nullable(),
      ruleCount: z.number(),
    }),
  ),
});

export default createEndpoint({
  description: 'List groups with member counts, completion and overdue numbers',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: Output,
  execute: async ({ context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const [groupsRes, statsRes, rulesRes] = await Promise.all([
      zite.sql({
        query: `SELECT g.*, g.created_at AS "createdAt", o."name" AS "ownerName", o."color" AS "ownerColor", o."avatarUrl" AS "ownerAvatarUrl",
                  (SELECT COUNT(DISTINCT gm."personId") FROM "GroupMembers" gm JOIN "People" p ON p.id::text = gm."personId" WHERE gm."groupId" = g.id::text AND COALESCE(p."status", '') <> 'Deactivated') AS "memberTotal"
                FROM "Groups" g LEFT JOIN "People" o ON o.id::text = g."ownerId"
                ORDER BY COALESCE(g."position", 0) ASC, LOWER(g."name") ASC`,
        params: [],
      }),
      zite.sql({
        query: `WITH member_enrollments AS (
                  SELECT DISTINCT gm."groupId" AS "gid", e.id AS "eid", e."status", e."dueDate", e."personId"
                  FROM "GroupMembers" gm
                  JOIN "People" p ON p.id::text = gm."personId" AND COALESCE(p."status", '') <> 'Deactivated'
                  JOIN "Enrollments" e ON e."personId" = gm."personId"
                  WHERE COALESCE(e."status", '') <> 'Withdrawn' AND ${LATEST_CYCLE()}
                )
                SELECT "gid", COUNT(*) AS "enrolledTotal",
                  COUNT(*) FILTER (WHERE "status" = 'Completed') AS "doneTotal",
                  COUNT(*) FILTER (WHERE "status" IN ('Not started', 'In progress') AND "dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overdueTotal",
                  COUNT(DISTINCT "personId") FILTER (WHERE "status" IN ('Not started', 'In progress') AND "dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overduePeopleTotal"
                FROM member_enrollments GROUP BY "gid"`,
        params: [],
      }),
      zite.sql({ query: `SELECT "groupIds" FROM "AssignmentRules" WHERE "status" = 'Active' AND "audience" = 'Groups'`, params: [] }),
    ]).catch(e => {
      console.error('listGroups failed', e);
      throw new ZiteError("Couldn't load groups", 'BAD_REQUEST');
    });

    const stats = new Map(statsRes.rows.map(r => [String(r.gid), r]));
    const ruleCounts = new Map<string, number>();
    for (const r of rulesRes.rows) {
      let ids: string[] = [];
      try {
        const v = JSON.parse(String(r.groupIds ?? '[]'));
        ids = Array.isArray(v) ? v.map(String) : [];
      } catch {
        ids = [];
      }
      for (const id of new Set(ids)) ruleCounts.set(id, (ruleCounts.get(id) ?? 0) + 1);
    }

    return {
      groups: groupsRes.rows.map(g => {
        const s = stats.get(String(g.id));
        const enrolled = num(s?.enrolledTotal);
        const completed = num(s?.doneTotal);
        const ownerId = ref(g.ownerId);
        return {
          id: String(g.id),
          name: str(g.name) ?? '',
          kind: str(g.kind) || 'Team',
          description: str(g.description) ?? '',
          color: str(g.color) || '#64748b',
          position: num(g.position),
          createdAt: iso(g.createdAt),
          owner: ownerId && g.ownerName ? { id: ownerId, name: String(g.ownerName), color: str(g.ownerColor) || '#8b8d98', avatarUrl: ref(g.ownerAvatarUrl) } : null,
          memberCount: num(g.memberTotal),
          enrolled,
          completed,
          overdue: num(s?.overdueTotal),
          overduePeople: num(s?.overduePeopleTotal),
          completionRate: enrolled ? Math.round((completed / enrolled) * 100) : null,
          ruleCount: ruleCounts.get(String(g.id)) ?? 0,
        };
      }),
    };
  },
});
