import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { dayOf } from '@project/shared/progress';
import { loadCourse, loadPath } from '@project/shared/server/courses';
import { audiencePersonIds, describeDue, ruleDueDate, type RuleRecord } from '@project/shared/server/rules';
import { num, ref, str } from '@project/shared/server/sql';

/**
 * Assignment rules on the admin side: the shape a rule is edited in, the
 * checks every save runs, and the numbers the list and the live preview show.
 * Running a rule is the shared engine's job (`applyRule`).
 */

export const ruleConfigSchema = z.object({
  name: z.string().max(200).default(''),
  targetType: z.enum(['Course', 'Path']),
  courseId: z.string().nullable().default(null),
  pathId: z.string().nullable().default(null),
  audience: z.enum(['Everyone', 'Groups', 'People']),
  groupIds: z.array(z.string()).max(200).default([]),
  personIds: z.array(z.string()).max(5000).default([]),
  dueMode: z.enum(['None', 'Relative', 'Fixed']).default('None'),
  dueDays: z.number().int().nullable().default(null),
  dueDate: z.string().nullable().default(null),
  recurrenceMonths: z.number().int().nullable().default(null),
  includeFutureMembers: z.boolean().default(false),
  sendEmail: z.boolean().default(true),
});
export type RuleConfig = z.infer<typeof ruleConfigSchema>;

export type RuleTarget = { id: string; title: string; status: 'Draft' | 'Published' | 'Archived' };

export async function loadTarget(config: Pick<RuleConfig, 'targetType' | 'courseId' | 'pathId'>): Promise<RuleTarget | null> {
  if (config.targetType === 'Path') {
    const p = config.pathId ? await loadPath(config.pathId) : null;
    return p ? { id: p.id, title: p.title, status: p.status } : null;
  }
  const c = config.courseId ? await loadCourse(config.courseId) : null;
  return c ? { id: c.id, title: c.title, status: c.status } : null;
}

/**
 * Everything a saved rule must satisfy. `active` adds the checks that only
 * matter once it runs: a published target and a due date still in the future.
 */
export async function validateRule(config: RuleConfig, opts: { active: boolean; keepDueDate?: string | null }): Promise<{ target: RuleTarget; groupIds: string[]; personIds: string[] }> {
  const kind = config.targetType === 'Path' ? 'learning path' : 'course';
  if (config.targetType === 'Course' && !config.courseId) throw new ZiteError('Choose a course to assign', 'BAD_REQUEST');
  if (config.targetType === 'Path' && !config.pathId) throw new ZiteError('Choose a learning path to assign', 'BAD_REQUEST');
  const target = await loadTarget(config);
  if (!target) throw new ZiteError(`That ${kind} no longer exists`, 'NOT_FOUND');
  if (opts.active && target.status !== 'Published') throw new ZiteError(`Publish “${target.title}” before assigning it with an active rule, or save the rule paused`, 'BAD_REQUEST');

  let groupIds = [...new Set(config.groupIds.filter(Boolean))];
  let personIds = [...new Set(config.personIds.filter(Boolean))];
  if (config.audience === 'Groups') {
    if (!groupIds.length) throw new ZiteError('Choose at least one group', 'BAD_REQUEST');
    const { rows } = await zite.sql({ query: `SELECT id::text AS id FROM "Groups" WHERE id::text = ANY($1::text[])`, params: [groupIds] });
    const found = new Set(rows.map(r => String(r.id)));
    groupIds = groupIds.filter(id => found.has(id));
    if (!groupIds.length) throw new ZiteError('Those groups no longer exist', 'BAD_REQUEST');
    personIds = [];
  } else if (config.audience === 'People') {
    if (!personIds.length) throw new ZiteError('Choose at least one person', 'BAD_REQUEST');
    const { rows } = await zite.sql({ query: `SELECT id::text AS id FROM "People" WHERE id::text = ANY($1::text[])`, params: [personIds] });
    const found = new Set(rows.map(r => String(r.id)));
    personIds = personIds.filter(id => found.has(id));
    if (!personIds.length) throw new ZiteError('Those people no longer exist', 'BAD_REQUEST');
    groupIds = [];
  } else {
    groupIds = [];
    personIds = [];
  }

  if (config.dueMode === 'Relative') {
    if (config.dueDays == null || config.dueDays < 1 || config.dueDays > 365) throw new ZiteError('Give people between 1 and 365 days to finish', 'BAD_REQUEST');
  }
  if (config.dueMode === 'Fixed') {
    if (!config.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(config.dueDate)) throw new ZiteError('Choose a due date', 'BAD_REQUEST');
    const kept = !opts.active && opts.keepDueDate && config.dueDate === opts.keepDueDate;
    if (!kept && config.dueDate <= dayOf(new Date())) throw new ZiteError('Choose a due date in the future', 'BAD_REQUEST');
  }
  if (config.recurrenceMonths != null && (config.recurrenceMonths < 0 || config.recurrenceMonths > 60)) throw new ZiteError('Repeat every 1 to 60 months, or never', 'BAD_REQUEST');
  return { target, groupIds, personIds };
}

/** The record a validated config is stored as. */
export function ruleRecord(config: RuleConfig, v: { target: RuleTarget; groupIds: string[]; personIds: string[] }, groupNames: string[]) {
  const audienceText = config.audience === 'Everyone' ? 'everyone' : config.audience === 'Groups' ? groupNames.join(', ') || 'groups' : `${v.personIds.length} ${v.personIds.length === 1 ? 'person' : 'people'}`;
  return {
    name: (config.name.trim() || `${v.target.title} for ${audienceText}`).slice(0, 200),
    targetType: config.targetType,
    courseId: config.targetType === 'Course' ? v.target.id : null,
    pathId: config.targetType === 'Path' ? v.target.id : null,
    audience: config.audience,
    groupIds: JSON.stringify(v.groupIds),
    personIds: JSON.stringify(v.personIds),
    dueMode: config.dueMode,
    dueDays: config.dueMode === 'Relative' ? config.dueDays : null,
    dueDate: config.dueMode === 'Fixed' ? config.dueDate : null,
    recurrenceMonths: config.recurrenceMonths && config.recurrenceMonths > 0 ? config.recurrenceMonths : null,
    includeFutureMembers: config.audience === 'People' ? false : config.includeFutureMembers,
    sendEmail: config.sendEmail,
  };
}

export async function groupNames(ids: string[]) {
  if (!ids.length) return [];
  const { rows } = await zite.sql({ query: `SELECT id::text AS id, "name" FROM "Groups" WHERE id::text = ANY($1::text[])`, params: [ids] });
  const byId = new Map(rows.map(r => [String(r.id), str(r.name) ?? '']));
  return ids.map(id => byId.get(id)).filter(Boolean) as string[];
}

/**
 * What running a rule would do right now, without writing anything: who is in
 * the audience, who would be enrolled, and who is skipped and why.
 */
export async function previewRule(config: RuleConfig) {
  const rule = { audience: config.audience, groupIds: config.groupIds, personIds: config.personIds } as Pick<RuleRecord, 'audience' | 'groupIds' | 'personIds'>;
  const [ids, deactivated] = await Promise.all([audiencePersonIds(rule), deactivatedInAudience(rule)]);
  const target = config.targetType === 'Path' ? config.pathId : config.courseId;
  const empty = { audience: ids.length, newEnrollments: 0, alreadyEnrolled: 0, completedAlready: 0, deactivatedSkipped: deactivated, sample: [] as Array<{ name: string; title: string }>, dueDate: null as string | null };
  if (!target || !ids.length) return empty;
  const table = config.targetType === 'Path' ? 'PathEnrollments' : 'Enrollments';
  const col = config.targetType === 'Path' ? 'pathId' : 'courseId';
  const { rows } = await zite.sql({
    query: `SELECT DISTINCT ON ("personId") "personId", "status" FROM "${table}" WHERE "${col}" = $1 AND "personId" = ANY($2::text[]) ORDER BY "personId", COALESCE("cycle", 1) DESC, created_at DESC`,
    params: [target, ids],
  });
  const latest = new Map(rows.map(r => [String(r.personId), str(r.status) ?? '']));
  const fresh: string[] = [];
  let alreadyEnrolled = 0;
  let completedAlready = 0;
  for (const id of ids) {
    const status = latest.get(id);
    if (status === undefined || status === 'Withdrawn') fresh.push(id);
    else if (status === 'Completed') completedAlready++;
    else alreadyEnrolled++;
  }
  const { rows: sampleRows } = fresh.length
    ? await zite.sql({ query: `SELECT "name", "email", "title" FROM "People" WHERE id::text = ANY($1::text[]) ORDER BY LOWER(COALESCE(NULLIF("name", ''), "email")) ASC LIMIT 8`, params: [fresh] })
    : { rows: [] as Record<string, unknown>[] };
  return {
    audience: ids.length,
    newEnrollments: fresh.length,
    alreadyEnrolled,
    completedAlready,
    deactivatedSkipped: deactivated,
    sample: sampleRows.map(r => ({ name: str(r.name) || str(r.email) || 'Unnamed', title: str(r.title) ?? '' })),
    dueDate: ruleDueDate({ dueMode: config.dueMode, dueDays: config.dueDays, dueDate: config.dueDate }),
  };
}

async function deactivatedInAudience(rule: Pick<RuleRecord, 'audience' | 'groupIds' | 'personIds'>) {
  if (rule.audience === 'Everyone') {
    const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "total" FROM "People" WHERE "status" = 'Deactivated'`, params: [] });
    return num(rows[0]?.total);
  }
  if (rule.audience === 'Groups') {
    if (!rule.groupIds.length) return 0;
    const { rows } = await zite.sql({
      query: `SELECT COUNT(DISTINCT p.id) AS "total" FROM "GroupMembers" gm JOIN "People" p ON p.id::text = gm."personId" WHERE gm."groupId" = ANY($1::text[]) AND p."status" = 'Deactivated'`,
      params: [rule.groupIds],
    });
    return num(rows[0]?.total);
  }
  if (!rule.personIds.length) return 0;
  const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "total" FROM "People" WHERE id::text = ANY($1::text[]) AND "status" = 'Deactivated'`, params: [rule.personIds] });
  return num(rows[0]?.total);
}

export const ruleRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  targetType: z.enum(['Course', 'Path']),
  courseId: z.string().nullable(),
  pathId: z.string().nullable(),
  targetTitle: z.string(),
  targetIcon: z.string(),
  targetColor: z.string(),
  targetStatus: z.string(),
  audience: z.enum(['Everyone', 'Groups', 'People']),
  groupIds: z.array(z.string()),
  personIds: z.array(z.string()),
  audienceSummary: z.string(),
  audienceSize: z.number(),
  dueMode: z.enum(['None', 'Relative', 'Fixed']),
  dueDays: z.number().nullable(),
  dueDate: z.string().nullable(),
  dueText: z.string(),
  recurrenceMonths: z.number().nullable(),
  includeFutureMembers: z.boolean(),
  sendEmail: z.boolean(),
  status: z.enum(['Active', 'Paused', 'Archived']),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  counts: z.object({ enrolled: z.number(), completed: z.number(), overdue: z.number() }),
});
export type RuleRow = z.infer<typeof ruleRowSchema>;

/** Enrolled / completed / overdue for each rule, over each person's latest cycle. */
export async function ruleCounts() {
  const { rows } = await zite.sql({
    query: `
      SELECT x."ruleId",
        COUNT(*) FILTER (WHERE COALESCE(x."status", '') <> 'Withdrawn') AS "enrolledTotal",
        COUNT(*) FILTER (WHERE x."status" = 'Completed') AS "completedTotal",
        COUNT(*) FILTER (WHERE x."status" IN ('Not started', 'In progress') AND x."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overdueTotal"
      FROM (
        SELECT DISTINCT ON (e."ruleId", e."personId") e."ruleId", e."personId", e."status", e."dueDate"
        FROM "Enrollments" e JOIN "AssignmentRules" r ON r.id::text = e."ruleId" AND r."targetType" = 'Course' AND r."courseId" = e."courseId"
        ORDER BY e."ruleId", e."personId", COALESCE(e."cycle", 1) DESC, e.created_at DESC
      ) x GROUP BY x."ruleId"
      UNION ALL
      SELECT y."ruleId",
        COUNT(*) FILTER (WHERE COALESCE(y."status", '') <> 'Withdrawn') AS "enrolledTotal",
        COUNT(*) FILTER (WHERE y."status" = 'Completed') AS "completedTotal",
        COUNT(*) FILTER (WHERE y."status" IN ('Not started', 'In progress') AND y."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overdueTotal"
      FROM (
        SELECT DISTINCT ON (pe."ruleId", pe."personId") pe."ruleId", pe."personId", pe."status", pe."dueDate"
        FROM "PathEnrollments" pe JOIN "AssignmentRules" r ON r.id::text = pe."ruleId" AND r."targetType" = 'Path' AND r."pathId" = pe."pathId"
        ORDER BY pe."ruleId", pe."personId", COALESCE(pe."cycle", 1) DESC, pe.created_at DESC
      ) y GROUP BY y."ruleId"`,
    params: [],
  });
  return new Map(rows.map(r => [String(r.ruleId), { enrolled: num(r.enrolledTotal), completed: num(r.completedTotal), overdue: num(r.overdueTotal) }]));
}

/** Current audience sizes (active people only), for every rule at once. */
export async function audienceSizes(rules: RuleRecord[]) {
  const out = new Map<string, number>();
  const groupIds = [...new Set(rules.filter(r => r.audience === 'Groups').flatMap(r => r.groupIds))];
  const personIds = [...new Set(rules.filter(r => r.audience === 'People').flatMap(r => r.personIds))];
  const [everyone, members, people] = await Promise.all([
    rules.some(r => r.audience === 'Everyone') ? zite.sql({ query: `SELECT COUNT(*) AS "total" FROM "People" WHERE COALESCE("status", '') <> 'Deactivated'`, params: [] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    groupIds.length
      ? zite.sql({ query: `SELECT gm."groupId", gm."personId" FROM "GroupMembers" gm JOIN "People" p ON p.id::text = gm."personId" WHERE gm."groupId" = ANY($1::text[]) AND COALESCE(p."status", '') <> 'Deactivated'`, params: [groupIds] })
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    personIds.length ? zite.sql({ query: `SELECT id::text AS id FROM "People" WHERE id::text = ANY($1::text[]) AND COALESCE("status", '') <> 'Deactivated'`, params: [personIds] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ]);
  const everyoneCount = num(everyone.rows[0]?.total);
  const byGroup = new Map<string, Set<string>>();
  for (const m of members.rows) {
    const g = String(m.groupId);
    if (!byGroup.has(g)) byGroup.set(g, new Set());
    byGroup.get(g)!.add(String(m.personId));
  }
  const activePeople = new Set(people.rows.map(r => String(r.id)));
  for (const r of rules) {
    if (r.audience === 'Everyone') out.set(r.id, everyoneCount);
    else if (r.audience === 'Groups') {
      const all = new Set<string>();
      for (const g of r.groupIds) for (const p of byGroup.get(g) ?? []) all.add(p);
      out.set(r.id, all.size);
    } else out.set(r.id, r.personIds.filter(id => activePeople.has(id)).length);
  }
  return out;
}

export function mapRuleRow(rule: RuleRecord, raw: Record<string, unknown>, extra: { groupName: (id: string) => string | undefined; counts?: RuleRow['counts']; audienceSize: number }): RuleRow {
  const isPath = rule.targetType === 'Path';
  const groups = rule.groupIds.map(extra.groupName).filter(Boolean) as string[];
  const audienceSummary = rule.audience === 'Everyone' ? 'Everyone' : rule.audience === 'Groups' ? groups.join(', ') || 'No groups' : `${rule.personIds.length} ${rule.personIds.length === 1 ? 'person' : 'people'}`;
  return {
    id: rule.id,
    name: rule.name,
    targetType: rule.targetType,
    courseId: rule.courseId,
    pathId: rule.pathId,
    targetTitle: str(isPath ? raw.pathTitle : raw.courseTitle) || (isPath ? 'Deleted learning path' : 'Deleted course'),
    targetIcon: str(isPath ? raw.pathIcon : raw.courseIcon) ?? '',
    targetColor: str(isPath ? raw.pathColor : raw.courseColor) || '#2f6b55',
    targetStatus: str(isPath ? raw.pathStatus : raw.courseStatus) || 'Missing',
    audience: rule.audience,
    groupIds: rule.groupIds,
    personIds: rule.personIds,
    audienceSummary,
    audienceSize: extra.audienceSize,
    dueMode: rule.dueMode,
    dueDays: rule.dueDays,
    dueDate: rule.dueDate,
    dueText: describeDue(rule),
    recurrenceMonths: rule.recurrenceMonths,
    includeFutureMembers: rule.includeFutureMembers,
    sendEmail: rule.sendEmail,
    status: rule.status,
    createdById: rule.createdById,
    createdByName: ref(raw.createdByName),
    createdAt: rule.createdAt,
    lastRunAt: rule.lastRunAt,
    counts: extra.counts ?? { enrolled: 0, completed: 0, overdue: 0 },
  };
}

export const RULE_SELECT = `
  SELECT r.*, c."title" AS "courseTitle", c."icon" AS "courseIcon", c."color" AS "courseColor", c."status" AS "courseStatus",
    pa."title" AS "pathTitle", pa."icon" AS "pathIcon", pa."color" AS "pathColor", pa."status" AS "pathStatus",
    cb."name" AS "createdByName"
  FROM "AssignmentRules" r
  LEFT JOIN "Courses" c ON c.id::text = r."courseId"
  LEFT JOIN "Paths" pa ON pa.id::text = r."pathId"
  LEFT JOIN "People" cb ON cb.id::text = r."createdById"`;
