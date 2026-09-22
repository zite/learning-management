import { zite } from 'zitejs/db';
import { addDaysToDay, addMonthsIso, dayOf, parseIdList } from '../progress';
import { logActivity } from './activity';
import { enrollInCourse, enrollInPath, type EnrollResult } from './enroll';
import { getSettings, type OrgSettings } from './settings';
import { bool, day, iso, numOrNull, ref, str } from './sql';

/**
 * Assignment rules: "assign Security Awareness to Everyone, due 30 days after
 * assignment, every 12 months, including people who join later".
 *
 * A rule runs when it's created or run by hand, when someone joins its
 * audience (a new person, or a group membership) if it includes future
 * members, and daily for recertification.
 */

export type RuleRecord = {
  id: string;
  name: string;
  targetType: 'Course' | 'Path';
  courseId: string | null;
  pathId: string | null;
  audience: 'Everyone' | 'Groups' | 'People';
  groupIds: string[];
  personIds: string[];
  dueMode: 'None' | 'Relative' | 'Fixed';
  dueDays: number | null;
  dueDate: string | null;
  recurrenceMonths: number | null;
  includeFutureMembers: boolean;
  sendEmail: boolean;
  status: 'Active' | 'Paused' | 'Archived';
  createdById: string | null;
  lastRunAt: string | null;
  createdAt: string | null;
};

export function toRule(r: Record<string, unknown>): RuleRecord {
  const audience = r.audience === 'Groups' || r.audience === 'People' ? r.audience : 'Everyone';
  const dueMode = r.dueMode === 'Relative' || r.dueMode === 'Fixed' ? r.dueMode : 'None';
  const status = r.status === 'Paused' || r.status === 'Archived' ? r.status : 'Active';
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    targetType: r.targetType === 'Path' ? 'Path' : 'Course',
    courseId: ref(r.courseId),
    pathId: ref(r.pathId),
    audience,
    groupIds: parseIdList(r.groupIds),
    personIds: parseIdList(r.personIds),
    dueMode,
    dueDays: numOrNull(r.dueDays),
    dueDate: day(r.dueDate),
    recurrenceMonths: numOrNull(r.recurrenceMonths) || null,
    includeFutureMembers: bool(r.includeFutureMembers),
    sendEmail: bool(r.sendEmail),
    status,
    createdById: ref(r.createdById),
    lastRunAt: iso(r.lastRunAt),
    createdAt: iso(r.created_at),
  };
}

export async function loadRule(id: string) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "AssignmentRules" WHERE id::text = $1`, params: [id] });
  return rows[0] ? toRule(rows[0]) : null;
}

const AUDIENCE_PAGE = 2000;

/**
 * Active people the rule targets — optionally only among `onlyPersonIds`
 * (a newcomer, a group's new members), filtered in SQL. `zite.sql` caps a
 * result at 2,000 rows, so large audiences are read in pages by id.
 */
export async function audiencePersonIds(rule: Pick<RuleRecord, 'audience' | 'groupIds' | 'personIds'>, onlyPersonIds?: string[]): Promise<string[]> {
  if (onlyPersonIds && !onlyPersonIds.length) return [];
  let base: string;
  const params: unknown[] = [];
  if (rule.audience === 'Everyone') {
    base = `SELECT p.id::text AS id FROM "People" p WHERE COALESCE(p."status", '') <> 'Deactivated'`;
  } else if (rule.audience === 'Groups') {
    if (!rule.groupIds.length) return [];
    params.push(rule.groupIds);
    base = `SELECT DISTINCT p.id::text AS id FROM "GroupMembers" gm JOIN "People" p ON p.id::text = gm."personId" WHERE gm."groupId" = ANY($1::text[]) AND COALESCE(p."status", '') <> 'Deactivated'`;
  } else {
    if (!rule.personIds.length) return [];
    params.push(rule.personIds);
    base = `SELECT p.id::text AS id FROM "People" p WHERE p.id::text = ANY($1::text[]) AND COALESCE(p."status", '') <> 'Deactivated'`;
  }
  if (onlyPersonIds) {
    params.push(onlyPersonIds);
    base = `SELECT q.id FROM (${base}) q WHERE q.id = ANY($${params.length}::text[])`;
  }
  const out: string[] = [];
  for (let after = ''; ; ) {
    const { rows } = await zite.sql({ query: `SELECT a.id FROM (${base}) a WHERE a.id > $${params.length + 1} ORDER BY a.id LIMIT ${AUDIENCE_PAGE}`, params: [...params, after] });
    out.push(...rows.map(r => String(r.id)));
    if (rows.length < AUDIENCE_PAGE) return out;
    after = out[out.length - 1];
  }
}

export function ruleDueDate(rule: Pick<RuleRecord, 'dueMode' | 'dueDays' | 'dueDate'>, from = dayOf(new Date())) {
  if (rule.dueMode === 'Relative' && rule.dueDays) return addDaysToDay(from, rule.dueDays);
  if (rule.dueMode === 'Fixed' && rule.dueDate) return rule.dueDate;
  return null;
}

/** Run a rule for its whole audience, or only for `onlyPersonIds` (who must be in it). */
export async function applyRule(rule: RuleRecord, opts: { actorId?: string | null; settings?: OrgSettings; onlyPersonIds?: string[] } = {}): Promise<EnrollResult & { audience: number }> {
  const empty = { created: [], reactivated: [], skipped: 0, skippedInactive: 0, audience: 0 };
  if (rule.status !== 'Active') return empty;
  const ids = await audiencePersonIds(rule, opts.onlyPersonIds);
  if (!ids.length) return empty;
  const settings = opts.settings ?? (await getSettings());
  const common = { personIds: ids, source: 'Automatic' as const, assignedById: opts.actorId ?? rule.createdById, dueDate: ruleDueDate(rule), ruleId: rule.id, notify: rule.sendEmail, settings };
  const res = rule.targetType === 'Path' && rule.pathId ? await enrollInPath({ ...common, pathId: rule.pathId }) : rule.courseId ? await enrollInCourse({ ...common, courseId: rule.courseId }) : null;
  if (!opts.onlyPersonIds) await zite.assignmentRules.update({ id: rule.id, record: { lastRunAt: new Date().toISOString() } });
  if (!res) return empty;
  if (!opts.onlyPersonIds) {
    await logActivity({ type: 'rule_ran', actorId: opts.actorId ?? null, courseId: rule.courseId, pathId: rule.pathId, data: { ruleId: rule.id, ruleName: rule.name, enrolled: res.created.length + res.reactivated.length, skipped: res.skipped } });
  }
  return { ...res, audience: ids.length };
}

async function futureRules(filter: 'Everyone' | 'Groups', groupIds: string[] = []) {
  const { rows } = await zite.sql({
    query: `SELECT * FROM "AssignmentRules" WHERE "status" = 'Active' AND COALESCE("includeFutureMembers", false) = true AND "audience" = $1 ORDER BY created_at ASC`,
    params: [filter],
  });
  return rows.map(toRule).filter(r => filter === 'Everyone' || r.groupIds.some(g => groupIds.includes(g)));
}

/** A brand-new person: apply every "Everyone" rule that includes future members. */
export async function applyRulesForNewPerson(personId: string, settings?: OrgSettings) {
  let enrolled = 0;
  const s = settings ?? (await getSettings());
  for (const rule of await futureRules('Everyone')) {
    const r = await applyRule(rule, { onlyPersonIds: [personId], settings: s }).catch(e => (console.error('Rule failed', rule.id, e), null));
    enrolled += (r?.created.length ?? 0) + (r?.reactivated.length ?? 0);
  }
  return enrolled;
}

/** People just added to a group: apply group rules that include future members. */
export async function applyRulesForGroupJoin(personIds: string[], groupId: string, settings?: OrgSettings) {
  if (!personIds.length) return 0;
  let enrolled = 0;
  const s = settings ?? (await getSettings());
  for (const rule of await futureRules('Groups', [groupId])) {
    const r = await applyRule(rule, { onlyPersonIds: personIds, settings: s }).catch(e => (console.error('Rule failed', rule.id, e), null));
    enrolled += (r?.created.length ?? 0) + (r?.reactivated.length ?? 0);
  }
  return enrolled;
}

export const RECERTIFY_LEAD_DAYS = 30;

/**
 * Recertification: for rules that repeat, start the next cycle for anyone
 * whose last completion is within RECERTIFY_LEAD_DAYS of falling due again.
 * The new enrollment is due on the anniversary. Returns the people enrolled.
 */
export async function runRecertification(settings?: OrgSettings) {
  const s = settings ?? (await getSettings());
  const { rows } = await zite.sql({ query: `SELECT * FROM "AssignmentRules" WHERE "status" = 'Active' AND COALESCE("recurrenceMonths", 0) > 0`, params: [] });
  let total = 0;
  for (const rule of rows.map(toRule)) {
    // One broken rule (say, its course was unpublished) must never stop the others.
    try {
      total += await recertifyRule(rule, s);
    } catch (e) {
      console.error('Recertification failed for rule', rule.id, e instanceof Error ? e.message : e);
    }
  }
  return total;
}

async function recertifyRule(rule: RuleRecord, s: OrgSettings) {
  let total = 0;
  {
    const audience = new Set(await audiencePersonIds(rule));
    if (!audience.size || !rule.recurrenceMonths) return 0;
    const table = rule.targetType === 'Path' ? 'PathEnrollments' : 'Enrollments';
    const col = rule.targetType === 'Path' ? 'pathId' : 'courseId';
    const target = rule.targetType === 'Path' ? rule.pathId : rule.courseId;
    if (!target) return 0;
    // Latest cycle per person, paged by person id (zite.sql returns at most 2,000 rows).
    const latest: Array<Record<string, unknown>> = [];
    for (let after = ''; ; ) {
      const { rows } = await zite.sql({
        query: `SELECT x."personId", x."status", x."completedAt" FROM "${table}" x
                WHERE x."${col}" = $1 AND x."personId" > $2
                  AND NOT EXISTS (SELECT 1 FROM "${table}" y WHERE y."${col}" = x."${col}" AND y."personId" = x."personId" AND (COALESCE(y."cycle", 1) > COALESCE(x."cycle", 1) OR (COALESCE(y."cycle", 1) = COALESCE(x."cycle", 1) AND y.created_at > x.created_at)))
                ORDER BY x."personId" LIMIT 2000`,
        params: [target, after],
      });
      latest.push(...rows);
      if (rows.length < 2000) break;
      after = String(rows[rows.length - 1].personId);
    }
    const byDue = new Map<string, string[]>();
    for (const r of latest) {
      const pid = String(r.personId);
      if (!audience.has(pid) || r.status !== 'Completed' || !r.completedAt) continue;
      const renewAt = addMonthsIso(String(r.completedAt), rule.recurrenceMonths);
      if (Date.parse(renewAt) - RECERTIFY_LEAD_DAYS * 86_400_000 > Date.now()) continue;
      const due = dayOf(renewAt) < dayOf(new Date()) ? addDaysToDay(dayOf(new Date()), 14) : dayOf(renewAt);
      byDue.set(due, [...(byDue.get(due) ?? []), pid]);
    }
    for (const [dueDate, personIds] of byDue) {
      const common = { personIds, source: 'Automatic' as const, assignedById: rule.createdById, dueDate, ruleId: rule.id, notify: rule.sendEmail, newCycle: true, settings: s };
      const res = rule.targetType === 'Path' ? await enrollInPath({ ...common, pathId: target }) : await enrollInCourse({ ...common, courseId: target });
      total += res.created.length;
    }
  }
  return total;
}

export const describeDue = (rule: Pick<RuleRecord, 'dueMode' | 'dueDays' | 'dueDate'>) =>
  rule.dueMode === 'Relative' && rule.dueDays ? `Due ${rule.dueDays} day${rule.dueDays === 1 ? '' : 's'} after assignment` : rule.dueMode === 'Fixed' && rule.dueDate ? `Due ${rule.dueDate}` : 'No due date';
