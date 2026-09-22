import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { day, iso, num, Params, ref, str } from '@project/shared/server/sql';
import { asRoleValue, asStatusValue, basePeopleWhere, lastActive, PEOPLE_ORDERINGS, PERSON_COLUMNS, peopleFilterSchema, peopleOrderBy, scopeClause, splitIds, statsCtes } from '../server/people-admin';

/**
 * The People directory: one filtered, ordered, paged query with each person's
 * training numbers, plus counts for every tab under the same filters so the
 * tabs never need their own requests.
 */

const Input = peopleFilterSchema.extend({
  ordering: z.enum(PEOPLE_ORDERINGS).default('name'),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).max(1_000_000).default(0),
});

const Row = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string().nullable(),
  role: z.enum(['Admin', 'Instructor', 'Learner']),
  status: z.enum(['Active', 'Invited', 'Deactivated']),
  color: z.string(),
  avatarUrl: z.string().nullable(),
  managerId: z.string().nullable(),
  managerName: z.string().nullable(),
  managerColor: z.string().nullable(),
  managerAvatarUrl: z.string().nullable(),
  hireDate: z.string().nullable(),
  externalId: z.string().nullable(),
  groupIds: z.array(z.string()),
  counts: z.object({ active: z.number(), overdue: z.number(), completed: z.number(), certificates: z.number() }),
  lastLearnedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  lastActiveAt: z.string().nullable(),
  invitedAt: z.string().nullable(),
  deactivatedAt: z.string().nullable(),
});

const Output = z.object({
  rows: z.array(Row),
  total: z.number(),
  tabs: z.object({ everyone: z.number(), learners: z.number(), staff: z.number(), invited: z.number(), deactivated: z.number() }),
  offset: z.number(),
  hasMore: z.boolean(),
});

export default createEndpoint({
  description: 'List people with filters, training counts and tab counts',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid filters', 'BAD_REQUEST');
    const { ordering, limit, offset, ...filters } = parsed.data;

    const p = new Params();
    const base = basePeopleWhere(filters, p);
    const scope = scopeClause(filters, p);
    const where = [...base, scope].join(' AND ');
    const listQuery = `
      WITH ${statsCtes()}
      SELECT ${PERSON_COLUMNS},
        m."name" AS "managerName", m."color" AS "managerColor", m."avatarUrl" AS "managerAvatarUrl",
        (SELECT string_agg(gm."groupId", ',') FROM "GroupMembers" gm WHERE gm."personId" = p.id::text) AS "groupList",
        COALESCE(es."openTotal", 0) AS "openTotal", COALESCE(es."overdueTotal", 0) AS "overdueTotal", COALESCE(es."doneTotal", 0) AS "doneTotal",
        COALESCE(cs."certTotal", 0) AS "certTotal", es."lastActivity" AS "lastActivity"
      FROM "People" p
      LEFT JOIN enrollment_stats es ON es."pid" = p.id::text
      LEFT JOIN certificate_stats cs ON cs."pid" = p.id::text
      LEFT JOIN "People" m ON m.id::text = p."managerId"
      WHERE ${where}
      ORDER BY ${peopleOrderBy(ordering)}
      LIMIT ${limit + 1} OFFSET ${offset}`;

    const cp = new Params();
    const countBase = basePeopleWhere(filters, cp);
    const countScope = scopeClause(filters, cp);
    const countQuery = `
      WITH ${statsCtes()}
      SELECT
        COUNT(*) FILTER (WHERE ${scopeClause({ tab: 'everyone' }, cp)}) AS "everyoneTotal",
        COUNT(*) FILTER (WHERE ${scopeClause({ tab: 'learners' }, cp)}) AS "learnersTotal",
        COUNT(*) FILTER (WHERE ${scopeClause({ tab: 'staff' }, cp)}) AS "staffTotal",
        COUNT(*) FILTER (WHERE ${scopeClause({ tab: 'invited' }, cp)}) AS "invitedTotal",
        COUNT(*) FILTER (WHERE ${scopeClause({ tab: 'deactivated' }, cp)}) AS "deactivatedTotal",
        COUNT(*) FILTER (WHERE ${countScope}) AS "matchTotal"
      FROM "People" p
      LEFT JOIN enrollment_stats es ON es."pid" = p.id::text
      ${countBase.length ? `WHERE ${countBase.join(' AND ')}` : ''}`;

    const [{ rows }, { rows: countRows }] = await Promise.all([zite.sql({ query: listQuery, params: p.values }), zite.sql({ query: countQuery, params: cp.values })]);
    const c = countRows[0] ?? {};
    const page = rows.slice(0, limit);

    return {
      rows: page.map(r => ({
        id: String(r.id),
        name: str(r.name) || str(r.email) || 'Unnamed',
        email: str(r.email) ?? '',
        title: ref(r.title),
        role: asRoleValue(r.role),
        status: asStatusValue(r.status),
        color: str(r.color) || '#8b8d98',
        avatarUrl: ref(r.avatarUrl),
        managerId: ref(r.managerId),
        managerName: ref(r.managerName),
        managerColor: ref(r.managerColor),
        managerAvatarUrl: ref(r.managerAvatarUrl),
        hireDate: day(r.hireDate),
        externalId: ref(r.externalId),
        groupIds: splitIds(r.groupList),
        counts: { active: num(r.openTotal), overdue: num(r.overdueTotal), completed: num(r.doneTotal), certificates: num(r.certTotal) },
        lastLearnedAt: iso(r.lastLearnedAt),
        lastSeenAt: iso(r.lastSeenAt),
        lastActiveAt: lastActive(r),
        invitedAt: iso(r.invitedAt),
        deactivatedAt: iso(r.deactivatedAt),
      })),
      total: num(c.matchTotal),
      tabs: { everyone: num(c.everyoneTotal), learners: num(c.learnersTotal), staff: num(c.staffTotal), invited: num(c.invitedTotal), deactivated: num(c.deactivatedTotal) },
      offset,
      hasMore: rows.length > limit,
    };
  },
});
