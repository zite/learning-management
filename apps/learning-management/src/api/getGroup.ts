import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { certificateState, dueState, type CertificateState } from '@project/shared/progress';
import { assertStaff, getActor } from '@project/shared/server/people';
import { describeDue, toRule } from '@project/shared/server/rules';
import { day, iso, num, Params, ref, str } from '@project/shared/server/sql';
import { asRoleValue, asStatusValue, LATEST_CYCLE, statsCtes } from '../server/people-admin';

/**
 * A group's page: the group and its owner, a page of members with their
 * training numbers, the assignment rules that reach it, and — on request — the
 * compliance matrix: every member against every item an active rule requires
 * of this group (or of everyone), with the latest status of each.
 */

const MATRIX_MAX_PEOPLE = 500;

const Input = z.object({
  id: z.string().min(1),
  q: z.string().max(200).default(''),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  compliance: z.boolean().default(false),
});

const statusEnum = z.enum(['Not started', 'In progress', 'Completed', 'Withdrawn']);
const dueEnum = z.enum(['done', 'overdue', 'due_soon', 'on_track', 'no_due', 'withdrawn']);

const Output = z.object({
  group: z.object({ id: z.string(), name: z.string(), kind: z.string(), description: z.string(), color: z.string(), ownerId: z.string().nullable(), position: z.number(), createdAt: z.string().nullable() }),
  owner: z.object({ id: z.string(), name: z.string(), title: z.string().nullable(), color: z.string(), avatarUrl: z.string().nullable(), status: z.string() }).nullable(),
  memberCount: z.number(),
  deactivatedCount: z.number(),
  stats: z.object({ enrolled: z.number(), completed: z.number(), overdue: z.number(), overduePeople: z.number() }),
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      title: z.string().nullable(),
      role: z.enum(['Admin', 'Instructor', 'Learner']),
      status: z.enum(['Active', 'Invited', 'Deactivated']),
      color: z.string(),
      avatarUrl: z.string().nullable(),
      addedAt: z.string().nullable(),
      counts: z.object({ active: z.number(), overdue: z.number(), completed: z.number() }),
    }),
  ),
  membersTotal: z.number(),
  rules: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      targetType: z.enum(['Course', 'Path']),
      courseId: z.string().nullable(),
      pathId: z.string().nullable(),
      audience: z.enum(['Everyone', 'Groups', 'People']),
      groupIds: z.array(z.string()),
      status: z.enum(['Active', 'Paused', 'Archived']),
      dueLabel: z.string(),
      recurrenceMonths: z.number().nullable(),
      includeFutureMembers: z.boolean(),
      onlyThisGroup: z.boolean(),
    }),
  ),
  compliance: z
    .object({
      columns: z.array(z.object({ key: z.string(), type: z.enum(['Course', 'Path']), targetId: z.string(), ruleNames: z.array(z.string()), compliant: z.number(), enrolled: z.number(), overdue: z.number(), percent: z.number() })),
      rows: z.array(
        z.object({
          personId: z.string(),
          name: z.string(),
          email: z.string(),
          title: z.string().nullable(),
          color: z.string(),
          avatarUrl: z.string().nullable(),
          status: z.string(),
          compliant: z.number(),
          cells: z.record(
            z
              .object({
                id: z.string(),
                status: statusEnum,
                dueState: dueEnum,
                progress: z.number(),
                dueDate: z.string().nullable(),
                completedAt: z.string().nullable(),
                cycle: z.number(),
                certState: z.enum(['active', 'expiring', 'expired', 'revoked']).nullable(),
                certExpiresAt: z.string().nullable(),
                compliant: z.boolean(),
              })
              .nullable(),
          ),
        }),
      ),
      truncated: z.boolean(),
    })
    .nullable(),
  canEdit: z.boolean(),
  canManageMembers: z.boolean(),
});
type Out = z.infer<typeof Output>;
type Cell = NonNullable<NonNullable<Out['compliance']>['rows'][number]['cells'][string]>;

const asStatus = (v: unknown) => statusEnum.catch('Not started').parse(v);

export default createEndpoint({
  description: 'Load a group with members, rules and its compliance matrix',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<Out> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const { id, q, limit, offset } = parsed.data;

    const { rows: groupRows } = await zite.sql({ query: `SELECT g.*, g.created_at AS "createdAt" FROM "Groups" g WHERE g.id::text = $1`, params: [id] });
    const g = groupRows[0];
    if (!g) throw new ZiteError('That group no longer exists', 'NOT_FOUND');
    const ownerId = ref(g.ownerId);

    const inGroup = (col: string) => `${col} IN (SELECT gm."personId" FROM "GroupMembers" gm WHERE gm."groupId" = $1)`;
    const mp = new Params();
    mp.add(id);
    let search = '';
    if (q.trim()) {
      const like = mp.add(`%${q.trim().toLowerCase()}%`);
      search = `AND (LOWER(COALESCE(p."name", '')) LIKE ${like} OR LOWER(COALESCE(p."email", '')) LIKE ${like} OR LOWER(COALESCE(p."title", '')) LIKE ${like})`;
    }

    const [ownerRes, countRes, statsRes, membersRes, membersTotalRes, rulesRes] = await Promise.all([
      ownerId ? zite.sql({ query: `SELECT id, "name", "email", "title", "color", "avatarUrl", "status" FROM "People" WHERE id::text = $1`, params: [ownerId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      zite.sql({
        query: `SELECT COUNT(*) FILTER (WHERE COALESCE(p."status", '') <> 'Deactivated') AS "activeTotal", COUNT(*) FILTER (WHERE p."status" = 'Deactivated') AS "deactivatedTotal"
                FROM (SELECT DISTINCT "personId" FROM "GroupMembers" WHERE "groupId" = $1) gm JOIN "People" p ON p.id::text = gm."personId"`,
        params: [id],
      }),
      zite.sql({
        query: `SELECT COUNT(*) AS "enrolledTotal", COUNT(*) FILTER (WHERE e."status" = 'Completed') AS "doneTotal",
                  COUNT(*) FILTER (WHERE e."status" IN ('Not started', 'In progress') AND e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overdueTotal",
                  COUNT(DISTINCT e."personId") FILTER (WHERE e."status" IN ('Not started', 'In progress') AND e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overduePeopleTotal"
                FROM "Enrollments" e JOIN "People" p ON p.id::text = e."personId"
                WHERE ${inGroup('e."personId"')} AND COALESCE(p."status", '') <> 'Deactivated' AND COALESCE(e."status", '') <> 'Withdrawn' AND ${LATEST_CYCLE()}`,
        params: [id],
      }),
      zite.sql({
        query: `WITH ${statsCtes(inGroup)}
                SELECT p.id, p."name", p."email", p."title", p."role", p."status", p."color", p."avatarUrl", gm."addedAt",
                  COALESCE(es."openTotal", 0) AS "openTotal", COALESCE(es."overdueTotal", 0) AS "overdueTotal", COALESCE(es."doneTotal", 0) AS "doneTotal"
                FROM (SELECT "personId", MIN("addedAt") AS "addedAt" FROM "GroupMembers" WHERE "groupId" = $1 GROUP BY "personId") gm
                JOIN "People" p ON p.id::text = gm."personId"
                LEFT JOIN enrollment_stats es ON es."pid" = p.id::text
                WHERE TRUE ${search}
                ORDER BY CASE WHEN p."status" = 'Deactivated' THEN 1 ELSE 0 END, LOWER(COALESCE(NULLIF(p."name", ''), p."email")) ASC, p.id ASC
                LIMIT ${limit} OFFSET ${offset}`,
        params: mp.values,
      }),
      zite.sql({
        query: `SELECT COUNT(*) AS "total" FROM (SELECT DISTINCT "personId" FROM "GroupMembers" WHERE "groupId" = $1) gm JOIN "People" p ON p.id::text = gm."personId" WHERE TRUE ${search}`,
        params: mp.values,
      }),
      zite.sql({ query: `SELECT * FROM "AssignmentRules" WHERE COALESCE("status", '') <> 'Archived' AND ("audience" = 'Everyone' OR COALESCE("groupIds", '') LIKE '%' || $1::text || '%') ORDER BY created_at ASC`, params: [id] }),
    ]);

    const rules = rulesRes.rows.map(toRule).filter(r => r.audience === 'Everyone' || (r.audience === 'Groups' && r.groupIds.includes(id)));
    const c = countRes.rows[0] ?? {};
    const st = statsRes.rows[0] ?? {};
    const o = ownerRes.rows[0];

    const out: Out = {
      group: { id: String(g.id), name: str(g.name) ?? '', kind: str(g.kind) || 'Team', description: str(g.description) ?? '', color: str(g.color) || '#64748b', ownerId, position: num(g.position), createdAt: iso(g.createdAt) },
      owner: o ? { id: String(o.id), name: str(o.name) || str(o.email) || 'Unnamed', title: ref(o.title), color: str(o.color) || '#8b8d98', avatarUrl: ref(o.avatarUrl), status: str(o.status) || 'Active' } : null,
      memberCount: num(c.activeTotal),
      deactivatedCount: num(c.deactivatedTotal),
      stats: { enrolled: num(st.enrolledTotal), completed: num(st.doneTotal), overdue: num(st.overdueTotal), overduePeople: num(st.overduePeopleTotal) },
      members: membersRes.rows.map(m => ({
        id: String(m.id),
        name: str(m.name) || str(m.email) || 'Unnamed',
        email: str(m.email) ?? '',
        title: ref(m.title),
        role: asRoleValue(m.role),
        status: asStatusValue(m.status),
        color: str(m.color) || '#8b8d98',
        avatarUrl: ref(m.avatarUrl),
        addedAt: iso(m.addedAt),
        counts: { active: num(m.openTotal), overdue: num(m.overdueTotal), completed: num(m.doneTotal) },
      })),
      membersTotal: num(membersTotalRes.rows[0]?.total),
      rules: rules.map(r => ({
        id: r.id,
        name: r.name,
        targetType: r.targetType,
        courseId: r.courseId,
        pathId: r.pathId,
        audience: r.audience,
        groupIds: r.groupIds,
        status: r.status,
        dueLabel: describeDue(r),
        recurrenceMonths: r.recurrenceMonths,
        includeFutureMembers: r.includeFutureMembers,
        onlyThisGroup: r.audience === 'Groups' && r.groupIds.length === 1 && r.groupIds[0] === id,
      })),
      compliance: null,
      canEdit: actor.role === 'Admin',
      canManageMembers: actor.role === 'Admin' || ownerId === actor.id,
    };

    if (!parsed.data.compliance) return out;

    // ── Compliance matrix ──
    const columns = new Map<string, { key: string; type: 'Course' | 'Path'; targetId: string; ruleNames: string[] }>();
    for (const r of rules) {
      if (r.status !== 'Active') continue;
      const targetId = r.targetType === 'Path' ? r.pathId : r.courseId;
      if (!targetId) continue;
      const key = `${r.targetType}:${targetId}`;
      if (!columns.has(key)) columns.set(key, { key, type: r.targetType, targetId, ruleNames: [] });
      columns.get(key)!.ruleNames.push(r.name);
    }
    const courseIds = [...columns.values()].filter(col => col.type === 'Course').map(col => col.targetId);
    const pathIds = [...columns.values()].filter(col => col.type === 'Path').map(col => col.targetId);

    const peopleRes = await zite.sql({
      query: `SELECT p.id, p."name", p."email", p."title", p."color", p."avatarUrl", p."status"
              FROM (SELECT DISTINCT "personId" FROM "GroupMembers" WHERE "groupId" = $1) gm JOIN "People" p ON p.id::text = gm."personId"
              WHERE COALESCE(p."status", '') <> 'Deactivated'
              ORDER BY LOWER(COALESCE(NULLIF(p."name", ''), p."email")) ASC, p.id ASC LIMIT ${MATRIX_MAX_PEOPLE + 1}`,
      params: [id],
    });
    const people = peopleRes.rows.slice(0, MATRIX_MAX_PEOPLE);

    // One latest enrollment and certificate per person and item, for the people shown — in chunks, since reads are capped.
    const enrollmentByKey = new Map<string, Record<string, unknown>>();
    const certByKey = new Map<string, { state: CertificateState; expiresAt: string | null }>();
    const none = Promise.resolve({ rows: [] as Record<string, unknown>[] });
    const perChunk = Math.max(20, Math.floor(1500 / Math.max(1, columns.size)));
    for (let i = 0; i < people.length; i += perChunk) {
      const ids = people.slice(i, i + perChunk).map(p => String(p.id));
      const [courseCells, pathCells, courseCerts, pathCerts] = await Promise.all([
        courseIds.length
          ? zite.sql({
              query: `SELECT DISTINCT ON (e."personId", e."courseId") e.id, e."personId", e."courseId" AS "targetId", e."status", e."progress", e."dueDate", e."completedAt", e."cycle"
                      FROM "Enrollments" e WHERE e."courseId" = ANY($1::text[]) AND e."personId" = ANY($2::text[])
                      ORDER BY e."personId", e."courseId", COALESCE(e."cycle", 1) DESC, CASE WHEN e."status" = 'Withdrawn' THEN 1 ELSE 0 END, e.created_at DESC`,
              params: [courseIds, ids],
            })
          : none,
        pathIds.length
          ? zite.sql({
              query: `SELECT DISTINCT ON (e."personId", e."pathId") e.id, e."personId", e."pathId" AS "targetId", e."status", e."progress", e."dueDate", e."completedAt", e."cycle"
                      FROM "PathEnrollments" e WHERE e."pathId" = ANY($1::text[]) AND e."personId" = ANY($2::text[])
                      ORDER BY e."personId", e."pathId", COALESCE(e."cycle", 1) DESC, CASE WHEN e."status" = 'Withdrawn' THEN 1 ELSE 0 END, e.created_at DESC`,
              params: [pathIds, ids],
            })
          : none,
        courseIds.length
          ? zite.sql({
              query: `SELECT DISTINCT ON (c."personId", c."courseId") c."personId", c."courseId" AS "targetId", c."expiresAt"
                      FROM "Certificates" c WHERE c."status" = 'Active' AND c."courseId" = ANY($1::text[]) AND c."personId" = ANY($2::text[])
                      ORDER BY c."personId", c."courseId", c."issuedAt" DESC NULLS LAST`,
              params: [courseIds, ids],
            })
          : none,
        pathIds.length
          ? zite.sql({
              query: `SELECT DISTINCT ON (c."personId", c."pathId") c."personId", c."pathId" AS "targetId", c."expiresAt"
                      FROM "Certificates" c WHERE c."status" = 'Active' AND c."pathId" = ANY($1::text[]) AND c."personId" = ANY($2::text[])
                      ORDER BY c."personId", c."pathId", c."issuedAt" DESC NULLS LAST`,
              params: [pathIds, ids],
            })
          : none,
      ]);
      for (const r of courseCells.rows) enrollmentByKey.set(`${r.personId}|Course:${r.targetId}`, r);
      for (const r of pathCells.rows) enrollmentByKey.set(`${r.personId}|Path:${r.targetId}`, r);
      for (const r of courseCerts.rows) certByKey.set(`${r.personId}|Course:${r.targetId}`, { state: certificateState({ status: 'Active', expiresAt: iso(r.expiresAt) }), expiresAt: iso(r.expiresAt) });
      for (const r of pathCerts.rows) certByKey.set(`${r.personId}|Path:${r.targetId}`, { state: certificateState({ status: 'Active', expiresAt: iso(r.expiresAt) }), expiresAt: iso(r.expiresAt) });
    }

    const cols = [...columns.values()].map(col => ({ ...col, compliant: 0, enrolled: 0, overdue: 0, percent: 0 }));
    const rows = people.map(p => {
      const personId = String(p.id);
      const cells: Record<string, Cell | null> = {};
      let compliantCount = 0;
      for (const col of cols) {
        const e = enrollmentByKey.get(`${personId}|${col.key}`);
        const cert = certByKey.get(`${personId}|${col.key}`) ?? null;
        if (!e && !cert) {
          cells[col.key] = null;
          continue;
        }
        const status = asStatus(e?.status ?? 'Completed');
        const dueDate = e ? day(e.dueDate) : null;
        const certState = cert?.state ?? null;
        const compliant = certState === 'active' || certState === 'expiring' || (status === 'Completed' && certState !== 'expired');
        cells[col.key] = {
          id: e ? String(e.id) : '',
          status,
          dueState: dueState({ status, dueDate }),
          progress: status === 'Completed' ? 100 : num(e?.progress),
          dueDate,
          completedAt: e ? iso(e.completedAt) : null,
          cycle: num(e?.cycle, 1) || 1,
          certState,
          certExpiresAt: cert?.expiresAt ?? null,
          compliant,
        };
        if (compliant) {
          col.compliant++;
          compliantCount++;
        }
        if (e && status !== 'Withdrawn') col.enrolled++;
        if (cells[col.key]?.dueState === 'overdue') col.overdue++;
      }
      return { personId, name: str(p.name) || str(p.email) || 'Unnamed', email: str(p.email) ?? '', title: ref(p.title), color: str(p.color) || '#8b8d98', avatarUrl: ref(p.avatarUrl), status: str(p.status) || 'Active', compliant: compliantCount, cells };
    });
    for (const col of cols) col.percent = rows.length ? Math.round((col.compliant / rows.length) * 100) : 0;

    return { ...out, compliance: { columns: cols, rows, truncated: peopleRes.rows.length > MATRIX_MAX_PEOPLE } };
  },
});
