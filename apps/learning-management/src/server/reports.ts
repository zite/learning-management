import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { gradeQuiz, parseAnswers, parseAssignmentSettings, parseQuizSettings, type QuestionType, type QuizSettings } from '@project/shared/lessons';
import { addDaysToDay, addMonthsIso, parseIdList, POINTS } from '@project/shared/progress';
import { getSettings } from '@project/shared/server/settings';
import { day, iso, num, numOrNull, Params, ref, str, withRetry } from '@project/shared/server/sql';

/**
 * Reporting for L&D: one vocabulary of ranges, scopes and cohorts behind every
 * report endpoint, so a number on Overview agrees with the same number in a
 * course report, a group row and a CSV.
 *
 * Definitions (shown to people in the UI, so keep them in sync):
 *   - An enrollment is IN THE COHORT for a range when it was open at any point
 *     during it: enrolled before the range ended, and not completed before it
 *     began. Withdrawn enrollments and deactivated people never count.
 *   - Completion rate = cohort enrollments completed by the end of the range.
 *   - Overdue = past its due date and still open at the end of the range (for
 *     ranges ending now, that's "overdue today").
 *   - Active learner = started or completed a lesson in the range.
 *
 * Every aggregate is computed in SQL. Live Zite rate-limits bursts of database
 * requests and caps a result at 2,000 rows, so each endpoint runs a handful of
 * statements (several aggregates folded into one with json_agg) and anything
 * row-shaped pages itself.
 */

// ── Inputs ──────────────────────────────────────────────────────────────────

export const RANGE_IDS = ['30d', '90d', '12m', 'custom'] as const;
export type RangeId = (typeof RANGE_IDS)[number];

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-14');
const idList = (max: number) => z.array(z.string().min(1).max(100)).max(max);

export const scopeFields = {
  range: z.enum(RANGE_IDS).default('90d'),
  from: dayString.optional(),
  to: dayString.optional(),
  groupIds: idList(100).optional(),
  categoryIds: idList(100).optional(),
  courseIds: idList(200).optional(),
};
export const scopeSchema = z.object(scopeFields);
export type ScopeInput = z.infer<typeof scopeSchema>;

export type Scope = { groupIds: string[]; categoryIds: string[]; courseIds: string[] };

export const toScope = (s: Partial<ScopeInput>): Scope => ({ groupIds: s.groupIds ?? [], categoryIds: s.categoryIds ?? [], courseIds: s.courseIds ?? [] });

export function badInput(error: z.ZodError, fallback = "Those report filters aren't valid."): never {
  const issue = error.issues[0];
  throw new ZiteError(issue?.message && !/^(Expected|Required|Invalid)/.test(issue.message) ? issue.message : fallback, 'BAD_REQUEST');
}

/** zite.sql, retried when rate-limited. */
export const sql = (query: string, params: unknown[] = []) => withRetry(() => zite.sql({ query, params }));

/** A json/json_agg column: an object locally, possibly a string through the live proxy. */
export function jsonRows(v: unknown): Array<Record<string, unknown>> {
  let x = v;
  if (typeof x === 'string') {
    try {
      x = JSON.parse(x);
    } catch {
      return [];
    }
  }
  return Array.isArray(x) ? (x as Array<Record<string, unknown>>) : [];
}

// ── Time ────────────────────────────────────────────────────────────────────

export function safeTimeZone(tz: string | null | undefined) {
  try {
    if (!tz) return 'UTC';
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function tzOffsetMs(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(ms / 1000) * 1000;
}

/** The instant a calendar day starts in a timezone. */
export function zonedDayStart(dayStr: string, tz: string) {
  const guess = Date.parse(`${dayStr}T00:00:00Z`);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

/** The calendar day of an instant in a timezone, `YYYY-MM-DD`. */
export function localDay(ms: number, tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export type Bucket = 'day' | 'week' | 'month';

function bucketStart(d: string, bucket: Bucket) {
  if (bucket === 'month') return `${d.slice(0, 7)}-01`;
  if (bucket === 'week') {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return addDaysToDay(d, -((dow + 6) % 7));
  }
  return d;
}

function nextBucket(d: string, bucket: Bucket) {
  if (bucket === 'month') return addMonthsIso(`${d}T00:00:00Z`, 1).slice(0, 10);
  return addDaysToDay(d, bucket === 'week' ? 7 : 1);
}

export const rangeSchema = z.object({
  id: z.enum(RANGE_IDS),
  from: z.string(),
  to: z.string(),
  prevFrom: z.string(),
  prevTo: z.string(),
  fromDay: z.string(),
  toDay: z.string(),
  prevFromDay: z.string(),
  prevToDay: z.string(),
  days: z.number(),
  bucket: z.enum(['day', 'week', 'month']),
  buckets: z.array(z.string()),
  timeZone: z.string(),
});
export type ResolvedRange = z.infer<typeof rangeSchema>;

const DAY_MS = 86_400_000;

/**
 * A range as instants, plus the equal-length period before it and the chart
 * buckets it spans (in the organization's timezone). Custom ranges are whole
 * days, inclusive.
 */
export function resolveRange(input: Pick<ScopeInput, 'range' | 'from' | 'to'>, timeZone: string, now = Date.now()): ResolvedRange {
  const tz = safeTimeZone(timeZone);
  let fromMs: number;
  let toMs: number;
  if (input.range === 'custom') {
    if (!input.from || !input.to) throw new ZiteError('Choose a start and end date for a custom range.', 'BAD_REQUEST');
    const [a, b] = input.from <= input.to ? [input.from, input.to] : [input.to, input.from];
    fromMs = zonedDayStart(a, tz);
    toMs = Math.min(zonedDayStart(addDaysToDay(b, 1), tz), Math.max(now, fromMs + DAY_MS));
    if (toMs - fromMs > 3 * 366 * DAY_MS) throw new ZiteError('Custom ranges can cover up to three years.', 'BAD_REQUEST');
  } else {
    toMs = now;
    fromMs = input.range === '12m' ? Date.parse(addMonthsIso(new Date(now).toISOString(), -12)) : now - (input.range === '30d' ? 30 : 90) * DAY_MS;
  }
  const len = toMs - fromMs;
  const days = Math.max(1, Math.round(len / DAY_MS));
  const bucket: Bucket = input.range === '12m' || days > 180 ? 'month' : days <= 14 ? 'day' : 'week';
  const fromDay = localDay(fromMs, tz);
  const toDay = localDay(toMs - 1, tz);
  const buckets: string[] = [];
  for (let b = bucketStart(fromDay, bucket); b <= toDay && buckets.length < 400; b = nextBucket(b, bucket)) buckets.push(b);
  return {
    id: input.range,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    prevFrom: new Date(fromMs - len).toISOString(),
    prevTo: new Date(fromMs).toISOString(),
    fromDay,
    toDay,
    prevFromDay: localDay(fromMs - len, tz),
    prevToDay: localDay(fromMs - 1, tz),
    days,
    bucket,
    buckets,
    timeZone: tz,
  };
}

export async function orgTimeZone() {
  const settings = await getSettings();
  return { settings, timeZone: safeTimeZone(settings.timezone) };
}

// ── SQL fragments ───────────────────────────────────────────────────────────

/** Scope clauses bound once; each call returns SQL for a column. */
export function scopeSql(p: Params, s: Scope) {
  const groups = s.groupIds.length ? p.add(s.groupIds) : null;
  const courses = s.courseIds.length ? p.add(s.courseIds) : null;
  const categories = s.categoryIds.length ? p.add(s.categoryIds) : null;
  return {
    groups,
    person: (col: string) => (groups ? `EXISTS (SELECT 1 FROM "GroupMembers" sgm WHERE sgm."personId" = ${col} AND sgm."groupId" = ANY(${groups}::text[]))` : 'TRUE'),
    course: (col: string) =>
      [courses && `${col} = ANY(${courses}::text[])`, categories && `EXISTS (SELECT 1 FROM "Courses" scc WHERE scc.id::text = ${col} AND scc."categoryId" = ANY(${categories}::text[]))`].filter(Boolean).join(' AND ') || 'TRUE',
    /** Paths answer to a category filter; a course filter leaves them out. */
    path: (col: string) => (courses ? 'FALSE' : categories ? `EXISTS (SELECT 1 FROM "Paths" spp WHERE spp.id::text = ${col} AND spp."categoryId" = ANY(${categories}::text[]))` : 'TRUE'),
  };
}

const between = (col: string, f: string, t: string) => `(${col} >= ${f}::timestamptz AND ${col} < ${t}::timestamptz)`;

/** Open at any point in [f, t). Expects `e` = Enrollments. */
const inCohort = (f: string, t: string) => `COALESCE(e."status", '') <> 'Withdrawn' AND COALESCE(e."enrolledAt", e.created_at) < ${t}::timestamptz AND (e."completedAt" IS NULL OR e."completedAt" >= ${f}::timestamptz)`;

/** Past due and still open when the range ended. Expects `e` = Enrollments. */
const overdueAt = (t: string) =>
  `(COALESCE(e."status", '') <> 'Withdrawn' AND e."dueDate" IS NOT NULL AND e."dueDate" < (LEAST(${t}::timestamptz, NOW()))::date AND COALESCE(e."enrolledAt", e.created_at) < ${t}::timestamptz
    AND COALESCE(CASE WHEN e."status" = 'Completed' THEN e."completedAt" >= ${t}::timestamptz ELSE e."completedAt" IS NULL OR e."completedAt" >= ${t}::timestamptz END, false))`;

const ACTIVE_PERSON = (alias: string) => `COALESCE(${alias}."status", '') <> 'Deactivated'`;

const bucketExpr = (col: string, unit: string, tz: string) => `to_char(date_trunc(${unit}::text, (${col})::timestamptz AT TIME ZONE ${tz}::text), 'YYYY-MM-DD')`;

const round1 = (n: number) => Math.round(n * 10) / 10;
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// ── getReports ──────────────────────────────────────────────────────────────

const kpiPair = z.object({ value: z.number(), prev: z.number() });
const ratePair = z.object({ value: z.number().nullable(), prev: z.number().nullable(), part: z.number(), whole: z.number(), prevPart: z.number(), prevWhole: z.number() });

export const reportsOutput = z.object({
  range: rangeSchema,
  kpis: z.object({
    activeLearners: kpiPair,
    enrollments: kpiPair,
    completions: kpiPair,
    completionRate: ratePair,
    onTimeRate: ratePair,
    overdue: kpiPair,
    averageScore: z.object({ value: z.number().nullable(), prev: z.number().nullable(), attempts: z.number() }),
    learningHours: kpiPair,
    certificates: kpiPair,
  }),
  trends: z.array(z.object({ bucket: z.string(), enrollments: z.number(), completions: z.number(), activeLearners: z.number(), hours: z.number(), partial: z.boolean() })),
  categories: z.array(z.object({ categoryId: z.string().nullable(), enrolled: z.number(), completed: z.number(), overdue: z.number() })),
  courses: z.array(z.object({ courseId: z.string(), enrolled: z.number(), completed: z.number(), overdue: z.number(), completionRate: z.number().nullable(), overdueRate: z.number().nullable(), averageScore: z.number().nullable(), averageRating: z.number().nullable(), ratings: z.number() })),
  groups: z.array(z.object({ groupId: z.string(), members: z.number(), active: z.number(), enrolled: z.number(), completed: z.number(), overdue: z.number(), completionRate: z.number().nullable(), overdueRate: z.number().nullable(), activeRate: z.number().nullable(), averageScore: z.number().nullable() })),
  engagement: z.object({
    people: z.number(),
    activeDays: z.array(z.object({ label: z.string(), people: z.number() })),
    heatmap: z.array(z.object({ dow: z.number(), hour: z.number(), count: z.number() })),
    inactive: z.object({ count: z.number(), people: z.array(z.object({ id: z.string(), name: z.string(), color: z.string(), avatarUrl: z.string().nullable(), lastLearnedAt: z.string().nullable(), open: z.number(), overdue: z.number() })) }),
    sources: z.array(z.object({ source: z.string(), count: z.number() })),
  }),
  leaders: z.array(z.object({ personId: z.string(), name: z.string(), color: z.string(), avatarUrl: z.string().nullable(), points: z.number(), lessons: z.number(), courses: z.number(), paths: z.number(), quizPasses: z.number(), perfectQuizzes: z.number() })),
});
export type ReportsOutput = z.infer<typeof reportsOutput>;

export const ACTIVE_DAY_BUCKETS = ['No activity', '1 day', '2–3 days', '4–7 days', '8–14 days', '15+ days'];

function kpiColumns(p: Params, sc: ReturnType<typeof scopeSql>, fromIso: string, toIso: string, s: string) {
  const f = p.add(fromIso);
  const t = p.add(toIso);
  const lpWhere = `(${between('lp."startedAt"', f, t)} OR ${between('lp."completedAt"', f, t)}) AND ${sc.person('lp."personId"')} AND ${sc.course('lp."courseId"')}`;
  const eScope = `${sc.person('e."personId"')} AND ${sc.course('e."courseId"')}`;
  return [
    `(SELECT COUNT(DISTINCT lp."personId") FROM "LessonProgress" lp WHERE ${lpWhere}) AS "active_${s}"`,
    `(SELECT COALESCE(SUM(lp."timeSpentSeconds"), 0) FROM "LessonProgress" lp WHERE ${lpWhere}) AS "seconds_${s}"`,
    `(SELECT COUNT(*) FROM "Enrollments" e WHERE ${between('e."enrolledAt"', f, t)} AND ${eScope}) AS "enrolled_${s}"`,
    `(SELECT COUNT(*) FROM "Enrollments" e WHERE e."status" = 'Completed' AND ${between('e."completedAt"', f, t)} AND ${eScope}) AS "done_${s}"`,
    `(SELECT COUNT(*) FROM "Enrollments" e WHERE e."status" = 'Completed' AND ${between('e."completedAt"', f, t)} AND (e."dueDate" IS NULL OR e."completedAt"::date <= e."dueDate") AND ${eScope}) AS "ontime_${s}"`,
    `(SELECT COUNT(*) FROM "Enrollments" e JOIN "People" pp ON pp.id::text = e."personId" WHERE ${inCohort(f, t)} AND ${ACTIVE_PERSON('pp')} AND ${eScope}) AS "cohort_${s}"`,
    `(SELECT COUNT(*) FROM "Enrollments" e JOIN "People" pp ON pp.id::text = e."personId" WHERE ${inCohort(f, t)} AND e."status" = 'Completed' AND e."completedAt" < ${t}::timestamptz AND ${ACTIVE_PERSON('pp')} AND ${eScope}) AS "cohortdone_${s}"`,
    `(SELECT COUNT(*) FROM "Enrollments" e JOIN "People" pp ON pp.id::text = e."personId" WHERE ${overdueAt(t)} AND ${ACTIVE_PERSON('pp')} AND ${eScope}) AS "overdue_${s}"`,
    `(SELECT AVG(qa."score") FROM "QuizAttempts" qa WHERE ${between('qa."submittedAt"', f, t)} AND ${sc.person('qa."personId"')} AND ${sc.course('qa."courseId"')}) AS "score_${s}"`,
    `(SELECT COUNT(*) FROM "QuizAttempts" qa WHERE ${between('qa."submittedAt"', f, t)} AND ${sc.person('qa."personId"')} AND ${sc.course('qa."courseId"')}) AS "attempts_${s}"`,
    `(SELECT COUNT(*) FROM "Certificates" ce WHERE ${between('ce."issuedAt"', f, t)} AND ${sc.person('ce."personId"')} AND (CASE WHEN COALESCE(ce."courseId", '') <> '' THEN ${sc.course('ce."courseId"')} ELSE ${sc.path('ce."pathId"')} END)) AS "certs_${s}"`,
  ];
}

export async function loadReports(input: ScopeInput): Promise<ReportsOutput> {
  const { timeZone } = await orgTimeZone();
  const range = resolveRange(input, timeZone);
  const scope = toScope(input);

  // 1 — headline numbers for the range and the period before it.
  const kp = new Params();
  const ksc = scopeSql(kp, scope);
  const kpiQuery = `SELECT ${[...kpiColumns(kp, ksc, range.from, range.to, 'now'), ...kpiColumns(kp, ksc, range.prevFrom, range.prevTo, 'prev')].join(',\n')}`;

  // 2 — trend buckets.
  const tp = new Params();
  const tsc = scopeSql(tp, scope);
  const tf = tp.add(range.from);
  const tt = tp.add(range.to);
  const unit = tp.add(range.bucket);
  const tz = tp.add(range.timeZone);
  const lpScope = `${tsc.person('lp."personId"')} AND ${tsc.course('lp."courseId"')}`;
  const eScopeT = `${tsc.person('e."personId"')} AND ${tsc.course('e."courseId"')}`;
  const trendQuery = `
    SELECT 'enrolled' AS "series", ${bucketExpr('e."enrolledAt"', unit, tz)} AS "bucket", COUNT(*)::numeric AS "value"
      FROM "Enrollments" e WHERE ${between('e."enrolledAt"', tf, tt)} AND ${eScopeT} GROUP BY 2
    UNION ALL
    SELECT 'completed', ${bucketExpr('e."completedAt"', unit, tz)}, COUNT(*)::numeric
      FROM "Enrollments" e WHERE e."status" = 'Completed' AND ${between('e."completedAt"', tf, tt)} AND ${eScopeT} GROUP BY 2
    UNION ALL
    SELECT 'active', ev."bucket", COUNT(DISTINCT ev."personId")::numeric FROM (
      SELECT lp."personId", ${bucketExpr('lp."startedAt"', unit, tz)} AS "bucket" FROM "LessonProgress" lp WHERE ${between('lp."startedAt"', tf, tt)} AND ${lpScope}
      UNION ALL
      SELECT lp."personId", ${bucketExpr('lp."completedAt"', unit, tz)} FROM "LessonProgress" lp WHERE ${between('lp."completedAt"', tf, tt)} AND ${lpScope}
    ) ev GROUP BY 2
    UNION ALL
    SELECT 'seconds', ${bucketExpr(`CASE WHEN ${between('lp."completedAt"', tf, tt)} THEN lp."completedAt" ELSE lp."startedAt" END`, unit, tz)}, COALESCE(SUM(lp."timeSpentSeconds"), 0)::numeric
      FROM "LessonProgress" lp WHERE (${between('lp."startedAt"', tf, tt)} OR ${between('lp."completedAt"', tf, tt)}) AND ${lpScope} GROUP BY 2`;

  // 3 — breakdowns by course, category and group.
  const bp = new Params();
  const bsc = scopeSql(bp, scope);
  const bf = bp.add(range.from);
  const bt = bp.add(range.to);
  const breakdownQuery = `
    WITH cohort_rows AS (
      SELECT e.id::text AS "enrollmentId", e."personId", e."courseId", e."score", e."rating",
             (e."status" = 'Completed' AND e."completedAt" < ${bt}::timestamptz) AS "isDone",
             ${overdueAt(bt)} AS "isOverdue"
        FROM "Enrollments" e JOIN "People" pp ON pp.id::text = e."personId"
       WHERE ${inCohort(bf, bt)} AND ${ACTIVE_PERSON('pp')} AND ${bsc.person('e."personId"')} AND ${bsc.course('e."courseId"')}
    ),
    course_stats AS (
      SELECT cr."courseId", COUNT(*) AS "cohortTotal", COUNT(*) FILTER (WHERE cr."isDone") AS "doneTotal", COUNT(*) FILTER (WHERE cr."isOverdue") AS "overdueTotal",
             AVG(cr."score") AS "scoreAverage", AVG(cr."rating") FILTER (WHERE cr."rating" > 0) AS "ratingAverage", COUNT(*) FILTER (WHERE cr."rating" > 0) AS "ratingTotal"
        FROM cohort_rows cr GROUP BY 1
    ),
    category_stats AS (
      SELECT COALESCE(c."categoryId", '') AS "categoryId", COUNT(*) AS "cohortTotal", COUNT(*) FILTER (WHERE cr."isDone") AS "doneTotal", COUNT(*) FILTER (WHERE cr."isOverdue") AS "overdueTotal"
        FROM cohort_rows cr JOIN "Courses" c ON c.id::text = cr."courseId" GROUP BY 1
    ),
    member_rows AS (
      SELECT DISTINCT gm."groupId", gm."personId" FROM "GroupMembers" gm JOIN "People" mp ON mp.id::text = gm."personId"
       WHERE ${ACTIVE_PERSON('mp')} ${bsc.groups ? `AND gm."groupId" = ANY(${bsc.groups}::text[])` : ''}
    ),
    active_rows AS (
      SELECT DISTINCT lp."personId" FROM "LessonProgress" lp
       WHERE (${between('lp."startedAt"', bf, bt)} OR ${between('lp."completedAt"', bf, bt)}) AND ${bsc.course('lp."courseId"')}
    ),
    group_reach AS (
      SELECT mr."groupId", COUNT(*) AS "memberTotal", COUNT(ar."personId") AS "activeTotal" FROM member_rows mr LEFT JOIN active_rows ar ON ar."personId" = mr."personId" GROUP BY 1
    ),
    group_work AS (
      SELECT mr."groupId", COUNT(*) AS "cohortTotal", COUNT(*) FILTER (WHERE cr."isDone") AS "doneTotal", COUNT(*) FILTER (WHERE cr."isOverdue") AS "overdueTotal", AVG(cr."score") AS "scoreAverage"
        FROM member_rows mr JOIN cohort_rows cr ON cr."personId" = mr."personId" GROUP BY 1
    )
    SELECT
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT * FROM course_stats ORDER BY "cohortTotal" DESC, "doneTotal" DESC LIMIT 10) x) AS "courses",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT * FROM category_stats ORDER BY "cohortTotal" DESC) x) AS "categories",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT gr."groupId", gr."memberTotal", gr."activeTotal", COALESCE(gw."cohortTotal", 0) AS "cohortTotal", COALESCE(gw."doneTotal", 0) AS "doneTotal", COALESCE(gw."overdueTotal", 0) AS "overdueTotal", gw."scoreAverage"
           FROM group_reach gr LEFT JOIN group_work gw ON gw."groupId" = gr."groupId"
      ) x) AS "groups"`;

  // 4 — engagement and the points leaderboard.
  const ep = new Params();
  const esc = scopeSql(ep, scope);
  const ef = ep.add(range.from);
  const et = ep.add(range.to);
  const etz = ep.add(range.timeZone);
  const elp = esc.course('lp."courseId"');
  const engagementQuery = `
    WITH scope_people AS (
      SELECT p.id::text AS "personId", p."name", p."color", p."avatarUrl", p."lastLearnedAt" FROM "People" p
       WHERE ${ACTIVE_PERSON('p')} AND ${esc.person('p.id::text')}
    ),
    activity_events AS (
      SELECT lp."personId", lp."startedAt" AS "at" FROM "LessonProgress" lp WHERE ${between('lp."startedAt"', ef, et)} AND ${elp}
      UNION ALL
      SELECT lp."personId", lp."completedAt" FROM "LessonProgress" lp WHERE ${between('lp."completedAt"', ef, et)} AND ${elp}
    ),
    day_counts AS (
      SELECT sp."personId", COUNT(DISTINCT (ae."at" AT TIME ZONE ${etz}::text)::date) AS "dayTotal"
        FROM scope_people sp LEFT JOIN activity_events ae ON ae."personId" = sp."personId" GROUP BY 1
    ),
    last_learning AS (
      SELECT lp."personId", MAX(GREATEST(lp."startedAt", lp."completedAt")) AS "lastAt" FROM "LessonProgress" lp GROUP BY 1
    ),
    inactive_rows AS (
      SELECT sp."personId", sp."name", sp."color", sp."avatarUrl", GREATEST(ll."lastAt", sp."lastLearnedAt") AS "lastAt"
        FROM scope_people sp LEFT JOIN last_learning ll ON ll."personId" = sp."personId"
       WHERE GREATEST(ll."lastAt", sp."lastLearnedAt") IS NULL OR GREATEST(ll."lastAt", sp."lastLearnedAt") < NOW() - INTERVAL '30 days'
    ),
    open_work AS (
      SELECT e."personId", COUNT(*) AS "openTotal", COUNT(*) FILTER (WHERE e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overdueTotal"
        FROM "Enrollments" e WHERE e."status" IN ('Not started', 'In progress') GROUP BY 1
    ),
    lesson_points AS (
      SELECT lp."personId", COUNT(*) AS "n" FROM "LessonProgress" lp WHERE lp."status" = 'Completed' AND ${between('lp."completedAt"', ef, et)} AND ${elp} GROUP BY 1
    ),
    course_points AS (
      SELECT e."personId", COUNT(*) AS "n" FROM "Enrollments" e WHERE e."status" = 'Completed' AND ${between('e."completedAt"', ef, et)} AND ${esc.course('e."courseId"')} GROUP BY 1
    ),
    path_points AS (
      SELECT pe."personId", COUNT(*) AS "n" FROM "PathEnrollments" pe WHERE pe."status" = 'Completed' AND ${between('pe."completedAt"', ef, et)} AND ${esc.path('pe."pathId"')} GROUP BY 1
    ),
    quiz_points AS (
      SELECT qa."personId",
             COUNT(DISTINCT qa."enrollmentId" || ':' || qa."lessonId") FILTER (WHERE COALESCE(qa."passed", false)) AS "passTotal",
             COUNT(DISTINCT qa."enrollmentId" || ':' || qa."lessonId") FILTER (WHERE qa."score" >= 100) AS "perfectTotal"
        FROM "QuizAttempts" qa WHERE ${between('qa."submittedAt"', ef, et)} AND ${esc.course('qa."courseId"')} GROUP BY 1
    ),
    point_totals AS (
      SELECT sp."personId", sp."name", sp."color", sp."avatarUrl",
             COALESCE(lpt."n", 0) AS "lessonTotal", COALESCE(cpt."n", 0) AS "courseTotal", COALESCE(ppt."n", 0) AS "pathTotal",
             COALESCE(qpt."passTotal", 0) AS "passTotal", COALESCE(qpt."perfectTotal", 0) AS "perfectTotal",
             COALESCE(lpt."n", 0) * ${POINTS.lesson} + COALESCE(cpt."n", 0) * ${POINTS.course} + COALESCE(ppt."n", 0) * ${POINTS.path}
               + COALESCE(qpt."passTotal", 0) * ${POINTS.quizPass} + COALESCE(qpt."perfectTotal", 0) * ${POINTS.perfectQuiz} AS "pointTotal"
        FROM scope_people sp
        LEFT JOIN lesson_points lpt ON lpt."personId" = sp."personId"
        LEFT JOIN course_points cpt ON cpt."personId" = sp."personId"
        LEFT JOIN path_points ppt ON ppt."personId" = sp."personId"
        LEFT JOIN quiz_points qpt ON qpt."personId" = sp."personId"
    )
    SELECT
      (SELECT COUNT(*) FROM scope_people) AS "peopleTotal",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT CASE WHEN "dayTotal" = 0 THEN 0 WHEN "dayTotal" = 1 THEN 1 WHEN "dayTotal" <= 3 THEN 2 WHEN "dayTotal" <= 7 THEN 3 WHEN "dayTotal" <= 14 THEN 4 ELSE 5 END AS "bucket", COUNT(*) AS "total"
           FROM day_counts GROUP BY 1
      ) x) AS "activeDays",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT EXTRACT(ISODOW FROM lp."completedAt" AT TIME ZONE ${etz}::text)::int AS "dow", EXTRACT(HOUR FROM lp."completedAt" AT TIME ZONE ${etz}::text)::int AS "hour", COUNT(*) AS "total"
           FROM "LessonProgress" lp WHERE lp."status" = 'Completed' AND ${between('lp."completedAt"', ef, et)} AND ${esc.person('lp."personId"')} AND ${elp} GROUP BY 1, 2
      ) x) AS "heatmap",
      (SELECT COUNT(*) FROM inactive_rows) AS "inactiveTotal",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT ir."personId", ir."name", ir."color", ir."avatarUrl", ir."lastAt", COALESCE(ow."openTotal", 0) AS "openTotal", COALESCE(ow."overdueTotal", 0) AS "overdueTotal"
           FROM inactive_rows ir LEFT JOIN open_work ow ON ow."personId" = ir."personId"
          ORDER BY COALESCE(ow."overdueTotal", 0) DESC, COALESCE(ow."openTotal", 0) DESC, ir."lastAt" ASC NULLS FIRST, LOWER(ir."name") ASC LIMIT 100
      ) x) AS "inactive",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT COALESCE(NULLIF(e."source", ''), 'Assigned') AS "source", COUNT(*) AS "total"
           FROM "Enrollments" e WHERE ${between('e."enrolledAt"', ef, et)} AND ${esc.person('e."personId"')} AND ${esc.course('e."courseId"')} GROUP BY 1
      ) x) AS "sources",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT * FROM point_totals WHERE "pointTotal" > 0 ORDER BY "pointTotal" DESC, LOWER("name") ASC LIMIT 10
      ) x) AS "leaders"`;

  const [kpiRes, trendRes, breakdownRes, engagementRes] = await Promise.all([sql(kpiQuery, kp.values), sql(trendQuery, tp.values), sql(breakdownQuery, bp.values), sql(engagementQuery, ep.values)]);

  const k = kpiRes.rows[0] ?? {};
  const series = new Map<string, number>();
  for (const r of trendRes.rows) series.set(`${r.series}:${str(r.bucket)}`, num(r.value));
  const lastBucket = range.buckets[range.buckets.length - 1];
  const trends = range.buckets.map(b => ({
    bucket: b,
    enrollments: series.get(`enrolled:${b}`) ?? 0,
    completions: series.get(`completed:${b}`) ?? 0,
    activeLearners: series.get(`active:${b}`) ?? 0,
    hours: round1((series.get(`seconds:${b}`) ?? 0) / 3600),
    partial: b < range.fromDay || (b === lastBucket && nextBucket(b, range.bucket) > addDaysToDay(range.toDay, 1)),
  }));

  const b = breakdownRes.rows[0] ?? {};
  const e = engagementRes.rows[0] ?? {};
  const activeDayCounts = new Map(jsonRows(e.activeDays).map(r => [num(r.bucket), num(r.total)]));

  return {
    range,
    kpis: {
      activeLearners: { value: num(k.active_now), prev: num(k.active_prev) },
      enrollments: { value: num(k.enrolled_now), prev: num(k.enrolled_prev) },
      completions: { value: num(k.done_now), prev: num(k.done_prev) },
      completionRate: { value: rate(num(k.cohortdone_now), num(k.cohort_now)), prev: rate(num(k.cohortdone_prev), num(k.cohort_prev)), part: num(k.cohortdone_now), whole: num(k.cohort_now), prevPart: num(k.cohortdone_prev), prevWhole: num(k.cohort_prev) },
      onTimeRate: { value: rate(num(k.ontime_now), num(k.done_now)), prev: rate(num(k.ontime_prev), num(k.done_prev)), part: num(k.ontime_now), whole: num(k.done_now), prevPart: num(k.ontime_prev), prevWhole: num(k.done_prev) },
      overdue: { value: num(k.overdue_now), prev: num(k.overdue_prev) },
      averageScore: { value: k.score_now == null ? null : round1(num(k.score_now)), prev: k.score_prev == null ? null : round1(num(k.score_prev)), attempts: num(k.attempts_now) },
      learningHours: { value: round1(num(k.seconds_now) / 3600), prev: round1(num(k.seconds_prev) / 3600) },
      certificates: { value: num(k.certs_now), prev: num(k.certs_prev) },
    },
    trends,
    categories: jsonRows(b.categories).map(r => ({ categoryId: ref(r.categoryId), enrolled: num(r.cohortTotal), completed: num(r.doneTotal), overdue: num(r.overdueTotal) })),
    courses: jsonRows(b.courses).map(r => ({
      courseId: String(r.courseId),
      enrolled: num(r.cohortTotal),
      completed: num(r.doneTotal),
      overdue: num(r.overdueTotal),
      completionRate: rate(num(r.doneTotal), num(r.cohortTotal)),
      overdueRate: rate(num(r.overdueTotal), num(r.cohortTotal)),
      averageScore: r.scoreAverage == null ? null : round1(num(r.scoreAverage)),
      averageRating: r.ratingAverage == null ? null : round1(num(r.ratingAverage)),
      ratings: num(r.ratingTotal),
    })),
    groups: jsonRows(b.groups).map(r => ({
      groupId: String(r.groupId),
      members: num(r.memberTotal),
      active: num(r.activeTotal),
      enrolled: num(r.cohortTotal),
      completed: num(r.doneTotal),
      overdue: num(r.overdueTotal),
      completionRate: rate(num(r.doneTotal), num(r.cohortTotal)),
      overdueRate: rate(num(r.overdueTotal), num(r.cohortTotal)),
      activeRate: rate(num(r.activeTotal), num(r.memberTotal)),
      averageScore: r.scoreAverage == null ? null : round1(num(r.scoreAverage)),
    })),
    engagement: {
      people: num(e.peopleTotal),
      activeDays: ACTIVE_DAY_BUCKETS.map((label, i) => ({ label, people: activeDayCounts.get(i) ?? 0 })),
      heatmap: jsonRows(e.heatmap).map(r => ({ dow: num(r.dow), hour: num(r.hour), count: num(r.total) })),
      inactive: {
        count: num(e.inactiveTotal),
        people: jsonRows(e.inactive).map(r => ({ id: String(r.personId), name: str(r.name) || 'Unknown person', color: str(r.color) || '#8b8d98', avatarUrl: ref(r.avatarUrl), lastLearnedAt: iso(r.lastAt), open: num(r.openTotal), overdue: num(r.overdueTotal) })),
      },
      sources: jsonRows(e.sources).map(r => ({ source: str(r.source) || 'Assigned', count: num(r.total) })),
    },
    leaders: jsonRows(e.leaders).map(r => ({
      personId: String(r.personId),
      name: str(r.name) || 'Someone',
      color: str(r.color) || '#8b8d98',
      avatarUrl: ref(r.avatarUrl),
      points: num(r.pointTotal),
      lessons: num(r.lessonTotal),
      courses: num(r.courseTotal),
      paths: num(r.pathTotal),
      quizPasses: num(r.passTotal),
      perfectQuizzes: num(r.perfectTotal),
    })),
  };
}

// ── Compliance ──────────────────────────────────────────────────────────────

export const COMPLIANCE_STATUSES = ['completed', 'in_progress', 'not_started', 'overdue', 'expired', 'not_assigned'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const complianceInput = z.object({
  groupIds: idList(100).optional(),
  managerId: z.string().max(100).optional(),
  itemIds: idList(200).optional(),
  gapsOnly: z.boolean().optional(),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(500).default(500),
});
export type ComplianceInput = z.infer<typeof complianceInput>;

/**
 * One matrix cell. A full page is up to 500 people × every required item, so
 * empty fields are left out rather than sent as null — it keeps a 40-column
 * page well under a megabyte per 200 rows.
 */
const cellSchema = z.object({
  status: z.enum(COMPLIANCE_STATUSES),
  compliant: z.boolean(),
  dueDate: z.string().optional(),
  completedAt: z.string().optional(),
  certificateExpiresAt: z.string().optional(),
  revoked: z.boolean().optional(),
  progress: z.number().optional(),
  enrollmentId: z.string().optional(),
});
export type ComplianceCell = z.infer<typeof cellSchema>;

const statusCounts = z.object(Object.fromEntries(COMPLIANCE_STATUSES.map(s => [s, z.number()])) as Record<ComplianceStatus, z.ZodNumber>);

export const complianceOutput = z.object({
  items: z.array(z.object({
    id: z.string(),
    kind: z.enum(['course', 'path']),
    targetId: z.string(),
    title: z.string(),
    icon: z.string(),
    color: z.string(),
    rules: z.array(z.object({ id: z.string(), name: z.string() })),
    audience: z.string(),
    recurrenceMonths: z.number().nullable(),
    required: z.number(),
    compliant: z.number(),
    compliantRate: z.number().nullable(),
    counts: statusCounts,
  })),
  /** Every required item, before the item filter — for the picker. */
  availableItems: z.array(z.object({ id: z.string(), kind: z.enum(['course', 'path']), title: z.string(), icon: z.string(), color: z.string() })),
  rows: z.array(z.object({
    personId: z.string(),
    name: z.string(),
    email: z.string(),
    color: z.string(),
    avatarUrl: z.string().nullable(),
    title: z.string().nullable(),
    status: z.string(),
    groupIds: z.array(z.string()),
    required: z.number(),
    compliant: z.number(),
    gaps: z.number(),
    /** Aligned with `items`: `cells[i]` is this person's status for `items[i]`, or null when it isn't required of them. */
    cells: z.array(cellSchema.nullable()),
  })),
  /** `late` counts required items that are overdue or whose certificate has expired — what needs attention. */
  groups: z.array(z.object({ groupId: z.string(), people: z.number(), required: z.number(), compliant: z.number(), late: z.number(), compliantRate: z.number().nullable(), items: z.record(z.string(), z.object({ required: z.number(), compliant: z.number(), late: z.number(), compliantRate: z.number().nullable() })) })),
  overall: z.object({ required: z.number(), compliant: z.number(), compliantRate: z.number().nullable(), people: z.number(), peopleWithGaps: z.number(), counts: statusCounts }),
  manager: z.object({ id: z.string(), name: z.string() }).nullable(),
  page: z.object({ offset: z.number(), limit: z.number(), total: z.number() }),
});
export type ComplianceOutput = z.infer<typeof complianceOutput>;

type Item = {
  id: string;
  kind: 'course' | 'path';
  targetId: string;
  title: string;
  icon: string;
  color: string;
  rules: Array<{ id: string; name: string }>;
  everyone: boolean;
  groupIds: Set<string>;
  personIds: Set<string>;
  recurrenceMonths: number | null;
};

/** Required items: the targets of Active assignment rules, merged when several rules assign the same thing. */
async function requiredItems(groupNames: Map<string, string>) {
  const { rows } = await sql(
    `SELECT r.id::text AS "ruleId", r."name", r."targetType", r."courseId", r."pathId", r."audience", r."groupIds", r."personIds", r."recurrenceMonths",
            c."title" AS "courseTitle", c."icon" AS "courseIcon", c."color" AS "courseColor",
            pa."title" AS "pathTitle", pa."icon" AS "pathIcon", pa."color" AS "pathColor"
       FROM "AssignmentRules" r
       LEFT JOIN "Courses" c ON r."targetType" = 'Course' AND c.id::text = r."courseId"
       LEFT JOIN "Paths" pa ON r."targetType" = 'Path' AND pa.id::text = r."pathId"
      WHERE r."status" = 'Active'
      ORDER BY r.created_at ASC`,
  );
  const items = new Map<string, Item>();
  for (const r of rows) {
    const isPath = r.targetType === 'Path';
    const targetId = ref(isPath ? r.pathId : r.courseId);
    const title = str(isPath ? r.pathTitle : r.courseTitle);
    if (!targetId || title == null) continue; // the course or path was deleted
    const id = `${isPath ? 'path' : 'course'}:${targetId}`;
    const item =
      items.get(id) ??
      ({ id, kind: isPath ? 'path' : 'course', targetId, title, icon: str(isPath ? r.pathIcon : r.courseIcon) ?? '', color: str(isPath ? r.pathColor : r.courseColor) || '#2f6b55', rules: [], everyone: false, groupIds: new Set(), personIds: new Set(), recurrenceMonths: null } satisfies Item);
    item.rules.push({ id: String(r.ruleId), name: str(r.name) ?? '' });
    if (r.audience === 'Groups') parseIdList(r.groupIds).forEach(g => item.groupIds.add(g));
    else if (r.audience === 'People') parseIdList(r.personIds).forEach(p => item.personIds.add(p));
    else item.everyone = true;
    const months = numOrNull(r.recurrenceMonths);
    if (months && months > 0) item.recurrenceMonths = item.recurrenceMonths ? Math.min(item.recurrenceMonths, months) : months;
    items.set(id, item);
  }
  const audience = (i: Item) => {
    if (i.everyone) return 'Everyone';
    const parts = [...[...i.groupIds].map(g => groupNames.get(g) ?? 'A deleted group'), ...(i.personIds.size ? [`${i.personIds.size} ${i.personIds.size === 1 ? 'person' : 'people'}`] : [])];
    return parts.join(', ') || 'Nobody';
  };
  return { items: [...items.values()], audience };
}

/**
 * The compliance CTEs: every (person, required item) pair in scope with its
 * status from the latest cycle, and whether the person currently holds a
 * valid completion (a previous cycle still in date counts — someone part-way
 * through recertifying is still certified until it lapses).
 */
function complianceCte(p: Params, items: Item[], opts: { groupIds: string[]; managerId: string | null }) {
  const scope = [`COALESCE(p."status", '') <> 'Deactivated'`];
  if (opts.groupIds.length) scope.push(`EXISTS (SELECT 1 FROM "GroupMembers" sgm WHERE sgm."personId" = p.id::text AND sgm."groupId" = ANY(${p.add(opts.groupIds)}::text[]))`);
  if (opts.managerId) scope.push(`p."managerId" = ${p.add(opts.managerId)}`);
  const keys = p.add(items.map(i => i.id));
  const kinds = p.add(items.map(i => i.kind));
  const targets = p.add(items.map(i => i.targetId));
  const recurrence = p.add(items.map(i => i.recurrenceMonths ?? 0));
  const everyone = p.add(items.filter(i => i.everyone).map(i => i.id));
  const groupPairs = items.flatMap(i => [...i.groupIds].map(g => [i.id, g]));
  const personPairs = items.flatMap(i => [...i.personIds].map(pid => [i.id, pid]));
  const gKeys = p.add(groupPairs.map(x => x[0]));
  const gIds = p.add(groupPairs.map(x => x[1]));
  const pKeys = p.add(personPairs.map(x => x[0]));
  const pIds = p.add(personPairs.map(x => x[1]));
  const courseTargets = p.add(items.filter(i => i.kind === 'course').map(i => i.targetId));
  const pathTargets = p.add(items.filter(i => i.kind === 'path').map(i => i.targetId));
  return `
    WITH scope_people AS (
      SELECT p.id::text AS "personId" FROM "People" p WHERE ${scope.join(' AND ')}
    ),
    item_list AS (
      SELECT * FROM unnest(${keys}::text[], ${kinds}::text[], ${targets}::text[], ${recurrence}::int[]) AS il("itemKey", "kind", "targetId", "recurrence")
    ),
    required_pairs AS (
      SELECT ev."itemKey", sp."personId" FROM unnest(${everyone}::text[]) AS ev("itemKey") CROSS JOIN scope_people sp
      UNION
      SELECT gp."itemKey", sp."personId" FROM unnest(${gKeys}::text[], ${gIds}::text[]) AS gp("itemKey", "groupId")
        JOIN "GroupMembers" gm ON gm."groupId" = gp."groupId" JOIN scope_people sp ON sp."personId" = gm."personId"
      UNION
      SELECT xp."itemKey", sp."personId" FROM unnest(${pKeys}::text[], ${pIds}::text[]) AS xp("itemKey", "personId") JOIN scope_people sp ON sp."personId" = xp."personId"
    ),
    latest_work AS (
      (SELECT DISTINCT ON (e."personId", e."courseId") 'course'::text AS "kind", e."personId", e."courseId" AS "targetId", e.id::text AS "workId", e."status", e."dueDate", e."progress"
         FROM "Enrollments" e JOIN scope_people sp ON sp."personId" = e."personId"
        WHERE e."courseId" = ANY(${courseTargets}::text[])
        ORDER BY e."personId", e."courseId", (e."status" = 'Withdrawn') ASC, COALESCE(e."cycle", 1) DESC, e.created_at DESC)
      UNION ALL
      (SELECT DISTINCT ON (pe."personId", pe."pathId") 'path'::text, pe."personId", pe."pathId", pe.id::text, pe."status", pe."dueDate", pe."progress"
         FROM "PathEnrollments" pe JOIN scope_people sp ON sp."personId" = pe."personId"
        WHERE pe."pathId" = ANY(${pathTargets}::text[])
        ORDER BY pe."personId", pe."pathId", (pe."status" = 'Withdrawn') ASC, COALESCE(pe."cycle", 1) DESC, pe.created_at DESC)
    ),
    last_completion AS (
      (SELECT DISTINCT ON (e."personId", e."courseId") 'course'::text AS "kind", e."personId", e."courseId" AS "targetId", e.id::text AS "workId", e."completedAt", ce."expiresAt", ce."status" AS "certStatus"
         FROM "Enrollments" e JOIN scope_people sp ON sp."personId" = e."personId" LEFT JOIN "Certificates" ce ON ce.id::text = e."certificateId"
        WHERE e."status" = 'Completed' AND e."courseId" = ANY(${courseTargets}::text[])
        ORDER BY e."personId", e."courseId", e."completedAt" DESC NULLS LAST, COALESCE(e."cycle", 1) DESC)
      UNION ALL
      (SELECT DISTINCT ON (pe."personId", pe."pathId") 'path'::text, pe."personId", pe."pathId", pe.id::text, pe."completedAt", ce."expiresAt", ce."status"
         FROM "PathEnrollments" pe JOIN scope_people sp ON sp."personId" = pe."personId" LEFT JOIN "Certificates" ce ON ce.id::text = pe."certificateId"
        WHERE pe."status" = 'Completed' AND pe."pathId" = ANY(${pathTargets}::text[])
        ORDER BY pe."personId", pe."pathId", pe."completedAt" DESC NULLS LAST, COALESCE(pe."cycle", 1) DESC)
    ),
    joined_cells AS (
      SELECT rp."itemKey", rp."personId", il."kind", il."targetId",
             lw."workId", lw."status" AS "workStatus", lw."dueDate", COALESCE(lw."progress", 0) AS "progress",
             lc."workId" AS "completionId", lc."completedAt", lc."certStatus",
             COALESCE(lc."expiresAt", CASE WHEN il."recurrence" > 0 AND lc."completedAt" IS NOT NULL THEN lc."completedAt" + il."recurrence" * INTERVAL '1 month' END) AS "expiresAt"
        FROM required_pairs rp
        JOIN item_list il ON il."itemKey" = rp."itemKey"
        LEFT JOIN latest_work lw ON lw."personId" = rp."personId" AND lw."kind" = il."kind" AND lw."targetId" = il."targetId"
        LEFT JOIN last_completion lc ON lc."personId" = rp."personId" AND lc."kind" = il."kind" AND lc."targetId" = il."targetId"
    ),
    judged_cells AS (
      SELECT jc.*, (jc."completedAt" IS NOT NULL AND COALESCE(jc."certStatus", '') <> 'Revoked' AND (jc."expiresAt" IS NULL OR jc."expiresAt" > NOW())) AS "compliant"
        FROM joined_cells jc
    ),
    matrix_cells AS (
      SELECT jc.*,
        CASE
          WHEN jc."workId" IS NULL OR jc."workStatus" = 'Withdrawn' THEN CASE WHEN jc."compliant" THEN 'completed' WHEN jc."completedAt" IS NOT NULL THEN 'expired' ELSE 'not_assigned' END
          WHEN jc."workStatus" = 'Completed' THEN CASE WHEN jc."compliant" THEN 'completed' ELSE 'expired' END
          WHEN jc."dueDate" IS NOT NULL AND jc."dueDate" < (NOW() AT TIME ZONE 'UTC')::date THEN 'overdue'
          WHEN jc."completedAt" IS NOT NULL AND NOT jc."compliant" THEN 'expired'
          WHEN jc."workStatus" = 'In progress' THEN 'in_progress'
          ELSE 'not_started'
        END AS "cellStatus"
        FROM judged_cells jc
    ),
    person_summary AS (
      SELECT mc."personId", COUNT(*) AS "requiredTotal", COUNT(*) FILTER (WHERE mc."compliant") AS "compliantTotal", COUNT(*) FILTER (WHERE NOT mc."compliant") AS "gapTotal"
        FROM matrix_cells mc GROUP BY 1
    )`;
}

const emptyCounts = () => Object.fromEntries(COMPLIANCE_STATUSES.map(s => [s, 0])) as Record<ComplianceStatus, number>;

export async function loadCompliance(input: ComplianceInput): Promise<ComplianceOutput> {
  const [{ rows: groupRows }, managerRes] = await Promise.all([
    sql(`SELECT id::text AS "id", "name" FROM "Groups"`),
    input.managerId ? sql(`SELECT id::text AS "id", "name" FROM "People" WHERE id::text = $1`, [input.managerId]) : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
  ]);
  const groupNames = new Map(groupRows.map(g => [String(g.id), str(g.name) ?? '']));
  const manager = managerRes.rows[0] ? { id: String(managerRes.rows[0].id), name: str(managerRes.rows[0].name) ?? '' } : null;
  const { items: allItems, audience } = await requiredItems(groupNames);
  const wanted = input.itemIds?.length ? new Set(input.itemIds) : null;
  const items = wanted ? allItems.filter(i => wanted.has(i.id)) : allItems;
  const base = {
    availableItems: allItems.map(i => ({ id: i.id, kind: i.kind, title: i.title, icon: i.icon, color: i.color })),
    manager,
  };
  if (!items.length) {
    return { ...base, items: [], rows: [], groups: [], overall: { required: 0, compliant: 0, compliantRate: null, people: 0, peopleWithGaps: 0, counts: emptyCounts() }, page: { offset: input.offset, limit: input.limit, total: 0 } };
  }
  const opts = { groupIds: input.groupIds ?? [], managerId: input.managerId || null };

  // Rows for this page, each person's cells folded into one JSON column.
  const rp = new Params();
  const rowCte = complianceCte(rp, items, opts);
  const gapsOnly = rp.add(Boolean(input.gapsOnly));
  const offset = rp.add(input.offset);
  const limit = rp.add(input.limit);
  const rowQuery = `${rowCte},
    page_people AS (
      SELECT ps.*, COUNT(*) OVER () AS "matchTotal" FROM person_summary ps JOIN "People" p ON p.id::text = ps."personId"
       WHERE (${gapsOnly}::boolean = false OR ps."gapTotal" > 0)
       ORDER BY LOWER(p."name") ASC, ps."personId" ASC OFFSET ${offset}::int LIMIT ${limit}::int
    ),
    path_current AS (
      SELECT DISTINCT ON (e."pathEnrollmentId") e."pathEnrollmentId", e.id::text AS "enrollmentId"
        FROM "Enrollments" e JOIN page_people pg ON pg."personId" = e."personId"
        LEFT JOIN "PathEnrollments" pe ON pe.id::text = e."pathEnrollmentId"
        LEFT JOIN "PathCourses" pc ON pc."pathId" = pe."pathId" AND pc."courseId" = e."courseId"
       WHERE COALESCE(e."pathEnrollmentId", '') <> ''
       ORDER BY e."pathEnrollmentId", (e."status" = 'Completed') ASC, COALESCE(pc."position", 0) ASC
    ),
    member_lists AS (
      SELECT gm."personId", string_agg(DISTINCT gm."groupId", ',') AS "groupIdList" FROM "GroupMembers" gm JOIN page_people pg ON pg."personId" = gm."personId" GROUP BY 1
    )
    SELECT pg."personId", pg."requiredTotal", pg."compliantTotal", pg."gapTotal", pg."matchTotal",
           p."name", p."email", p."color", p."avatarUrl", p."title", p."status", ml."groupIdList",
           json_agg(json_build_object(
             'k', mc."itemKey", 's', mc."cellStatus", 'c', mc."compliant", 'd', mc."dueDate", 'f', mc."completedAt",
             'x', mc."expiresAt", 'r', COALESCE(mc."certStatus", '') = 'Revoked', 'p', mc."progress",
             'e', CASE WHEN mc."kind" = 'course' THEN COALESCE(mc."workId", mc."completionId") ELSE COALESCE(pcw."enrollmentId", pcc."enrollmentId") END
           )) AS "cellList"
      FROM page_people pg
      JOIN "People" p ON p.id::text = pg."personId"
      LEFT JOIN member_lists ml ON ml."personId" = pg."personId"
      JOIN matrix_cells mc ON mc."personId" = pg."personId"
      LEFT JOIN path_current pcw ON mc."kind" = 'path' AND pcw."pathEnrollmentId" = mc."workId"
      LEFT JOIN path_current pcc ON mc."kind" = 'path' AND pcc."pathEnrollmentId" = mc."completionId"
     GROUP BY pg."personId", pg."requiredTotal", pg."compliantTotal", pg."gapTotal", pg."matchTotal", p."name", p."email", p."color", p."avatarUrl", p."title", p."status", ml."groupIdList"
     ORDER BY LOWER(p."name") ASC, pg."personId" ASC`;

  // Aggregates across everyone in scope, not just this page.
  const ap = new Params();
  const aggCte = complianceCte(ap, items, opts);
  const groupFilter = opts.groupIds.length ? `WHERE gm."groupId" = ANY(${ap.add(opts.groupIds)}::text[])` : '';
  const aggQuery = `${aggCte}
    SELECT
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT mc."itemKey", mc."cellStatus", COUNT(*) AS "total", COUNT(*) FILTER (WHERE mc."compliant") AS "compliantTotal" FROM matrix_cells mc GROUP BY 1, 2
      ) x) AS "items",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT gm."groupId", mc."itemKey", COUNT(*) AS "total", COUNT(*) FILTER (WHERE mc."compliant") AS "compliantTotal", COUNT(*) FILTER (WHERE mc."cellStatus" IN ('overdue', 'expired')) AS "lateTotal", COUNT(DISTINCT mc."personId") AS "peopleTotal"
           FROM matrix_cells mc JOIN (SELECT DISTINCT "groupId", "personId" FROM "GroupMembers") gm ON gm."personId" = mc."personId"
           ${groupFilter}
          GROUP BY 1, 2
      ) x) AS "groups",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT gm."groupId", COUNT(DISTINCT ps."personId") AS "peopleTotal"
           FROM person_summary ps JOIN (SELECT DISTINCT "groupId", "personId" FROM "GroupMembers") gm ON gm."personId" = ps."personId"
           ${groupFilter}
          GROUP BY 1
      ) x) AS "groupPeople",
      (SELECT COUNT(*) FROM person_summary) AS "peopleTotal",
      (SELECT COUNT(*) FROM person_summary WHERE "gapTotal" > 0) AS "gapPeopleTotal"`;

  const [rowRes, aggRes] = await Promise.all([sql(rowQuery, rp.values), sql(aggQuery, ap.values)]);
  const agg = aggRes.rows[0] ?? {};

  const perItem = new Map<string, { required: number; compliant: number; counts: Record<ComplianceStatus, number> }>();
  const overallCounts = emptyCounts();
  for (const r of jsonRows(agg.items)) {
    const key = String(r.itemKey);
    const status = String(r.cellStatus) as ComplianceStatus;
    const entry = perItem.get(key) ?? { required: 0, compliant: 0, counts: emptyCounts() };
    entry.required += num(r.total);
    entry.compliant += num(r.compliantTotal);
    if (status in entry.counts) {
      entry.counts[status] += num(r.total);
      overallCounts[status] += num(r.total);
    }
    perItem.set(key, entry);
  }

  const groupPeople = new Map(jsonRows(agg.groupPeople).map(r => [String(r.groupId), num(r.peopleTotal)]));
  const perGroup = new Map<string, ComplianceOutput['groups'][number]>();
  for (const r of jsonRows(agg.groups)) {
    const gid = String(r.groupId);
    if (!groupNames.has(gid)) continue;
    const g = perGroup.get(gid) ?? { groupId: gid, people: groupPeople.get(gid) ?? 0, required: 0, compliant: 0, late: 0, compliantRate: null, items: {} };
    g.required += num(r.total);
    g.compliant += num(r.compliantTotal);
    g.late += num(r.lateTotal);
    g.items[String(r.itemKey)] = { required: num(r.total), compliant: num(r.compliantTotal), late: num(r.lateTotal), compliantRate: rate(num(r.compliantTotal), num(r.total)) };
    perGroup.set(gid, g);
  }

  const required = [...perItem.values()].reduce((s, x) => s + x.required, 0);
  const compliant = [...perItem.values()].reduce((s, x) => s + x.compliant, 0);
  const itemIndex = new Map(items.map((i, n) => [i.id, n]));

  return {
    ...base,
    items: items.map(i => {
      const s = perItem.get(i.id) ?? { required: 0, compliant: 0, counts: emptyCounts() };
      return { id: i.id, kind: i.kind, targetId: i.targetId, title: i.title, icon: i.icon, color: i.color, rules: i.rules, audience: audience(i), recurrenceMonths: i.recurrenceMonths, required: s.required, compliant: s.compliant, compliantRate: rate(s.compliant, s.required), counts: s.counts };
    }),
    rows: rowRes.rows.map(r => {
      const cells: Array<ComplianceCell | null> = items.map(() => null);
      for (const c of jsonRows(r.cellList)) {
        const key = itemIndex.get(String(c.k));
        if (key == null) continue;
        const status = (COMPLIANCE_STATUSES as readonly string[]).includes(String(c.s)) ? (c.s as ComplianceStatus) : 'not_assigned';
        const cell: ComplianceCell = { status, compliant: c.c === true || c.c === 'true' };
        const due = day(c.d);
        const completed = iso(c.f);
        const expires = iso(c.x);
        const enrollmentId = ref(c.e);
        const progress = num(c.p);
        if (due) cell.dueDate = due;
        if (completed) cell.completedAt = completed;
        if (expires) cell.certificateExpiresAt = expires;
        if (c.r === true || c.r === 'true') cell.revoked = true;
        if (progress && status !== 'completed') cell.progress = progress;
        if (enrollmentId) cell.enrollmentId = enrollmentId;
        cells[key] = cell;
      }
      return {
        personId: String(r.personId),
        name: str(r.name) || str(r.email) || 'Unknown person',
        email: str(r.email) ?? '',
        color: str(r.color) || '#8b8d98',
        avatarUrl: ref(r.avatarUrl),
        title: ref(r.title),
        status: str(r.status) || 'Active',
        groupIds: (str(r.groupIdList) ?? '').split(',').filter(g => g && groupNames.has(g)),
        required: num(r.requiredTotal),
        compliant: num(r.compliantTotal),
        gaps: num(r.gapTotal),
        cells,
      };
    }),
    groups: [...perGroup.values()].map(g => ({ ...g, compliantRate: rate(g.compliant, g.required) })).sort((a, b) => (groupNames.get(a.groupId) ?? '').localeCompare(groupNames.get(b.groupId) ?? '')),
    overall: { required, compliant, compliantRate: rate(compliant, required), people: num(agg.peopleTotal), peopleWithGaps: num(agg.gapPeopleTotal), counts: overallCounts },
    page: { offset: input.offset, limit: input.limit, total: rowRes.rows.length ? num(rowRes.rows[0].matchTotal) : input.offset === 0 ? 0 : input.gapsOnly ? num(agg.gapPeopleTotal) : num(agg.peopleTotal) },
  };
}

// ── Course report ───────────────────────────────────────────────────────────

export const DURATION_BUCKETS = ['Same day', '1–3 days', '4–7 days', '1–2 weeks', '2–4 weeks', '1–2 months', '2+ months'];
export const GRADE_BUCKETS = ['Under 50', '50–59', '60–69', '70–79', '80–89', '90–100'];

export const courseReportInput = z.object({ courseId: z.string().min(1).max(100), ...scopeFields });

export const courseReportOutput = z.object({
  range: rangeSchema,
  course: z.object({ id: z.string(), title: z.string(), status: z.string(), icon: z.string(), color: z.string() }),
  kpis: z.object({
    enrolled: z.number(),
    completed: z.number(),
    completionRate: z.number().nullable(),
    overdue: z.number(),
    averageScore: z.number().nullable(),
    averageRating: z.number().nullable(),
    ratings: z.number(),
    newEnrollments: z.number(),
    completionsInRange: z.number(),
    medianDays: z.number().nullable(),
    stuck: z.number(),
  }),
  funnel: z.array(z.object({ lessonId: z.string(), title: z.string(), type: z.string(), optional: z.boolean(), reached: z.number(), completed: z.number(), averageSeconds: z.number().nullable(), dropOff: z.number().nullable() })),
  durations: z.array(z.object({ label: z.string(), count: z.number() })),
  trend: z.array(z.object({ bucket: z.string(), enrollments: z.number(), completions: z.number(), partial: z.boolean() })),
  grades: z.object({ hasAssignments: z.boolean(), passingGrade: z.number().nullable(), graded: z.number(), passed: z.number(), passRate: z.number().nullable(), average: z.number().nullable(), waiting: z.number(), buckets: z.array(z.object({ label: z.string(), min: z.number(), count: z.number() })) }),
  ratings: z.array(z.object({ stars: z.number(), count: z.number() })),
});
export type CourseReportOutput = z.infer<typeof courseReportOutput>;

export async function loadCourseReport(input: z.infer<typeof courseReportInput>): Promise<CourseReportOutput> {
  const { timeZone } = await orgTimeZone();
  const range = resolveRange(input, timeZone);
  const scope = toScope({ groupIds: input.groupIds });
  const [courseRes, lessonRes] = await Promise.all([
    sql(`SELECT id::text AS "id", "title", "status", "icon", "color" FROM "Courses" WHERE id::text = $1`, [input.courseId]),
    sql(
      `SELECT l.id::text AS "id", l."title", l."type", l."optional", l."settings" FROM "Lessons" l LEFT JOIN "Sections" s ON s.id::text = l."sectionId"
        WHERE l."courseId" = $1 ORDER BY CASE WHEN s.id IS NULL THEN 0 ELSE 1 END, COALESCE(s."position", 0) ASC, s.created_at ASC, COALESCE(l."position", 0) ASC, l.created_at ASC`,
      [input.courseId],
    ),
  ]);
  const c = courseRes.rows[0];
  if (!c) throw new ZiteError('That course no longer exists.', 'NOT_FOUND');

  const p = new Params();
  const sc = scopeSql(p, scope);
  const cid = p.add(input.courseId);
  const f = p.add(range.from);
  const t = p.add(range.to);
  const unit = p.add(range.bucket);
  const tz = p.add(range.timeZone);
  const person = sc.person('e."personId"');
  const query = `
    WITH cohort_rows AS (
      SELECT e.id::text AS "enrollmentId", e."score", e."rating", (e."status" = 'Completed' AND e."completedAt" < ${t}::timestamptz) AS "isDone", ${overdueAt(t)} AS "isOverdue"
        FROM "Enrollments" e JOIN "People" pp ON pp.id::text = e."personId"
       WHERE e."courseId" = ${cid} AND ${inCohort(f, t)} AND ${ACTIVE_PERSON('pp')} AND ${person}
    ),
    lesson_stats AS (
      SELECT lp."lessonId", COUNT(DISTINCT lp."enrollmentId") AS "reachedTotal", COUNT(DISTINCT lp."enrollmentId") FILTER (WHERE lp."status" = 'Completed') AS "doneTotal",
             AVG(lp."timeSpentSeconds") FILTER (WHERE lp."status" = 'Completed' AND lp."timeSpentSeconds" > 0) AS "secondsAverage"
        FROM "LessonProgress" lp JOIN cohort_rows cr ON cr."enrollmentId" = lp."enrollmentId"
       WHERE lp."courseId" = ${cid} GROUP BY 1
    ),
    completion_rows AS (
      SELECT e."completedAt", EXTRACT(EPOCH FROM (e."completedAt" - COALESCE(e."enrolledAt", e.created_at))) / 86400.0 AS "dayTotal"
        FROM "Enrollments" e WHERE e."courseId" = ${cid} AND e."status" = 'Completed' AND ${between('e."completedAt"', f, t)} AND ${person}
    ),
    graded_rows AS (
      SELECT s."status", s."grade" FROM "Submissions" s
       WHERE s."courseId" = ${cid} AND s."status" IN ('Passed', 'Needs revision') AND s."grade" IS NOT NULL AND ${between('s."gradedAt"', f, t)} AND ${sc.person('s."personId"')}
    )
    SELECT
      (SELECT COUNT(*) FROM cohort_rows) AS "cohortTotal",
      (SELECT COUNT(*) FROM cohort_rows WHERE "isDone") AS "doneTotal",
      (SELECT COUNT(*) FROM cohort_rows WHERE "isOverdue") AS "overdueTotal",
      (SELECT AVG("score") FROM cohort_rows) AS "scoreAverage",
      (SELECT AVG("rating") FROM cohort_rows WHERE "rating" > 0) AS "ratingAverage",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT ROUND("rating")::int AS "stars", COUNT(*) AS "total" FROM cohort_rows WHERE "rating" > 0 GROUP BY 1) x) AS "ratings",
      (SELECT COUNT(*) FROM "Enrollments" e WHERE e."courseId" = ${cid} AND ${between('e."enrolledAt"', f, t)} AND ${person}) AS "enrolledTotal",
      (SELECT COUNT(*) FROM completion_rows) AS "completedTotal",
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "dayTotal") FROM completion_rows) AS "dayMedian",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT CASE WHEN "dayTotal" < 1 THEN 0 WHEN "dayTotal" < 4 THEN 1 WHEN "dayTotal" < 8 THEN 2 WHEN "dayTotal" < 15 THEN 3 WHEN "dayTotal" < 31 THEN 4 WHEN "dayTotal" < 61 THEN 5 ELSE 6 END AS "bucket", COUNT(*) AS "total"
           FROM completion_rows GROUP BY 1
      ) x) AS "durations",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM lesson_stats x) AS "lessons",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT 'enrolled' AS "series", ${bucketExpr('e."enrolledAt"', unit, tz)} AS "bucket", COUNT(*) AS "total" FROM "Enrollments" e WHERE e."courseId" = ${cid} AND ${between('e."enrolledAt"', f, t)} AND ${person} GROUP BY 2
         UNION ALL
         SELECT 'completed', ${bucketExpr('cr2."completedAt"', unit, tz)}, COUNT(*) FROM completion_rows cr2 GROUP BY 2
      ) x) AS "trend",
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT CASE WHEN "grade" < 50 THEN 0 WHEN "grade" < 60 THEN 1 WHEN "grade" < 70 THEN 2 WHEN "grade" < 80 THEN 3 WHEN "grade" < 90 THEN 4 ELSE 5 END AS "bucket", COUNT(*) AS "total" FROM graded_rows GROUP BY 1
      ) x) AS "grades",
      (SELECT COUNT(*) FROM graded_rows) AS "gradedTotal",
      (SELECT COUNT(*) FROM graded_rows WHERE "status" = 'Passed') AS "passedTotal",
      (SELECT AVG("grade") FROM graded_rows) AS "gradeAverage",
      (SELECT COUNT(*) FROM "Submissions" s WHERE s."courseId" = ${cid} AND s."status" = 'Submitted' AND ${sc.person('s."personId"')}) AS "waitingTotal",
      (SELECT COUNT(*) FROM "Enrollments" e JOIN "People" pp ON pp.id::text = e."personId"
        WHERE e."courseId" = ${cid} AND e."status" = 'In progress' AND COALESCE(e."lastActivityAt", e."enrolledAt", e.created_at) < NOW() - INTERVAL '14 days' AND ${ACTIVE_PERSON('pp')} AND ${person}) AS "stuckTotal"`;
  const { rows } = await sql(query, p.values);
  const r = rows[0] ?? {};

  const lessonStats = new Map(jsonRows(r.lessons).map(x => [String(x.lessonId), x]));
  const cohort = num(r.cohortTotal);
  // The first required lesson is compared with everyone enrolled.
  let prevDone: number | null = cohort;
  const funnel = lessonRes.rows.map(l => {
    const s = lessonStats.get(String(l.id));
    const completed = num(s?.doneTotal);
    const dropOff = prevDone == null ? null : prevDone > 0 ? Math.max(0, Math.round(((prevDone - completed) / prevDone) * 1000) / 10) : null;
    const optional = l.optional === true || l.optional === 'true';
    if (!optional) prevDone = completed;
    return { lessonId: String(l.id), title: str(l.title) ?? '', type: str(l.type) || 'Article', optional, reached: num(s?.reachedTotal), completed, averageSeconds: s?.secondsAverage == null ? null : Math.round(num(s.secondsAverage)), dropOff: optional ? null : dropOff };
  });

  const trendMap = new Map(jsonRows(r.trend).map(x => [`${x.series}:${x.bucket}`, num(x.total)]));
  const lastBucket = range.buckets[range.buckets.length - 1];
  const durations = new Map(jsonRows(r.durations).map(x => [num(x.bucket), num(x.total)]));
  const grades = new Map(jsonRows(r.grades).map(x => [num(x.bucket), num(x.total)]));
  const ratings = new Map(jsonRows(r.ratings).map(x => [num(x.stars), num(x.total)]));
  const assignmentLessons = lessonRes.rows.filter(l => l.type === 'Assignment');
  const passingGrades = assignmentLessons.map(l => parseAssignmentSettings(l.settings).passingGrade);

  return {
    range,
    course: { id: String(c.id), title: str(c.title) ?? '', status: str(c.status) || 'Draft', icon: str(c.icon) ?? '', color: str(c.color) || '#2f6b55' },
    kpis: {
      enrolled: cohort,
      completed: num(r.doneTotal),
      completionRate: rate(num(r.doneTotal), cohort),
      overdue: num(r.overdueTotal),
      averageScore: r.scoreAverage == null ? null : round1(num(r.scoreAverage)),
      averageRating: r.ratingAverage == null ? null : round1(num(r.ratingAverage)),
      ratings: [...ratings.values()].reduce((a, b) => a + b, 0),
      newEnrollments: num(r.enrolledTotal),
      completionsInRange: num(r.completedTotal),
      medianDays: r.dayMedian == null ? null : round1(num(r.dayMedian)),
      stuck: num(r.stuckTotal),
    },
    funnel,
    durations: DURATION_BUCKETS.map((label, i) => ({ label, count: durations.get(i) ?? 0 })),
    trend: range.buckets.map(b => ({ bucket: b, enrollments: trendMap.get(`enrolled:${b}`) ?? 0, completions: trendMap.get(`completed:${b}`) ?? 0, partial: b < range.fromDay || (b === lastBucket && nextBucket(b, range.bucket) > addDaysToDay(range.toDay, 1)) })),
    grades: {
      hasAssignments: assignmentLessons.length > 0,
      passingGrade: passingGrades.length ? Math.min(...passingGrades) : null,
      graded: num(r.gradedTotal),
      passed: num(r.passedTotal),
      passRate: rate(num(r.passedTotal), num(r.gradedTotal)),
      average: r.gradeAverage == null ? null : round1(num(r.gradeAverage)),
      waiting: num(r.waitingTotal),
      buckets: GRADE_BUCKETS.map((label, i) => ({ label, min: [0, 50, 60, 70, 80, 90][i], count: grades.get(i) ?? 0 })),
    },
    ratings: [5, 4, 3, 2, 1].map(stars => ({ stars, count: ratings.get(stars) ?? 0 })),
  };
}

// ── Quiz report ─────────────────────────────────────────────────────────────

export const quizReportInput = z.object({ lessonId: z.string().max(100).optional(), ...scopeFields });

const ATTEMPT_BATCH = 2000;
const MAX_ANALYZED = 10_000;

export const quizReportOutput = z.object({
  range: rangeSchema,
  quizzes: z.array(z.object({ lessonId: z.string(), title: z.string(), courseId: z.string(), courseTitle: z.string(), questions: z.number(), passingScore: z.number(), attempts: z.number(), learners: z.number(), firstPassRate: z.number().nullable(), passRate: z.number().nullable(), averageScore: z.number().nullable(), lastAttemptAt: z.string().nullable() })),
  report: z
    .object({
      lessonId: z.string(),
      title: z.string(),
      courseId: z.string(),
      courseTitle: z.string(),
      passingScore: z.number(),
      maxAttempts: z.number(),
      attempts: z.number(),
      learners: z.number(),
      firstPassRate: z.number().nullable(),
      passRate: z.number().nullable(),
      averageScore: z.number().nullable(),
      averageAttempts: z.number().nullable(),
      scores: z.array(z.object({ label: z.string(), min: z.number(), count: z.number() })),
      attemptsPerLearner: z.array(z.object({ label: z.string(), count: z.number() })),
      items: z.array(z.object({
        questionId: z.string(),
        position: z.number(),
        prompt: z.string(),
        type: z.enum(['single', 'multiple', 'true_false', 'short']),
        answered: z.number(),
        correct: z.number(),
        correctRate: z.number().nullable(),
        difficulty: z.enum(['easy', 'moderate', 'hard', 'unknown']),
        topWrongOption: z.object({ text: z.string(), count: z.number(), share: z.number() }).nullable(),
        topWrongAnswers: z.array(z.object({ text: z.string(), count: z.number() })),
      })),
      analyzedAttempts: z.number(),
      truncated: z.boolean(),
      removedQuestionAnswers: z.number(),
    })
    .nullable(),
});
export type QuizReportOutput = z.infer<typeof quizReportOutput>;

const normaliseAnswer = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function difficultyOf(correctRate: number | null, answered: number): 'easy' | 'moderate' | 'hard' | 'unknown' {
  if (correctRate == null || answered < 3) return 'unknown';
  if (correctRate >= 85) return 'easy';
  if (correctRate >= 50) return 'moderate';
  return 'hard';
}

/** Per-question analysis, graded against the quiz as it is NOW — answers to questions since deleted are ignored and counted. */
function analyzeAttempts(settings: QuizSettings, answerSets: unknown[]) {
  type Acc = { answered: number; correct: number; wrongOptions: Map<string, number>; wrongShort: Map<string, number>; wrongTotal: number };
  const acc = new Map<string, Acc>(settings.questions.map(q => [q.id, { answered: 0, correct: 0, wrongOptions: new Map(), wrongShort: new Map(), wrongTotal: 0 }]));
  const known = new Set(settings.questions.map(q => q.id));
  let removed = 0;
  for (const raw of answerSets) {
    const answers = parseAnswers(raw);
    const graded = gradeQuiz(settings, answers);
    for (const key of Object.keys(answers)) if (!known.has(key)) removed++;
    graded.results.forEach((res, i) => {
      const q = settings.questions[i];
      if (!(q.id in answers)) return; // added after this attempt, or skipped
      const a = acc.get(q.id)!;
      a.answered++;
      if (res.correct) {
        a.correct++;
        return;
      }
      a.wrongTotal++;
      const given = answers[q.id];
      if (q.type === 'short') {
        const text = normaliseAnswer(Array.isArray(given) ? given.join(' ') : given ?? '');
        const k = text || '(blank)';
        a.wrongShort.set(k, (a.wrongShort.get(k) ?? 0) + 1);
      } else {
        const right = new Set(q.options.filter(o => o.correct).map(o => o.id));
        for (const id of Array.isArray(given) ? given : given ? [given] : []) if (!right.has(id)) a.wrongOptions.set(id, (a.wrongOptions.get(id) ?? 0) + 1);
      }
    });
  }
  const items = settings.questions.map((q, i) => {
    const a = acc.get(q.id)!;
    const correctRate = a.answered ? Math.round((a.correct / a.answered) * 1000) / 10 : null;
    const [topId, topCount] = [...a.wrongOptions.entries()].sort((x, y) => y[1] - x[1])[0] ?? [null, 0];
    return {
      questionId: q.id,
      position: i + 1,
      prompt: q.prompt,
      type: q.type as QuestionType,
      answered: a.answered,
      correct: a.correct,
      correctRate,
      difficulty: difficultyOf(correctRate, a.answered),
      topWrongOption: topId ? { text: q.options.find(o => o.id === topId)?.text || 'A choice that has since been removed', count: topCount, share: a.wrongTotal ? Math.round((topCount / a.wrongTotal) * 100) : 0 } : null,
      topWrongAnswers: [...a.wrongShort.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 3).map(([text, count]) => ({ text, count })),
    };
  });
  return { items, removed };
}

export async function loadQuizReport(input: z.infer<typeof quizReportInput>): Promise<QuizReportOutput> {
  const { timeZone } = await orgTimeZone();
  const range = resolveRange(input, timeZone);
  const scope = toScope(input);

  const lp = new Params();
  const lsc = scopeSql(lp, scope);
  const lf = lp.add(range.from);
  const lt = lp.add(range.to);
  const listQuery = `
    SELECT l.id::text AS "lessonId", l."title", l."courseId", c."title" AS "courseTitle", l."settings",
           COUNT(qa.id) AS "attemptTotal", COUNT(DISTINCT qa."enrollmentId") AS "learnerTotal",
           COUNT(DISTINCT qa."enrollmentId") FILTER (WHERE COALESCE(qa."passed", false)) AS "passedTotal",
           COUNT(qa.id) FILTER (WHERE COALESCE(qa."number", 1) = 1) AS "firstTotal",
           COUNT(qa.id) FILTER (WHERE COALESCE(qa."number", 1) = 1 AND COALESCE(qa."passed", false)) AS "firstPassedTotal",
           AVG(qa."score") AS "scoreAverage", MAX(qa."submittedAt") AS "lastAt"
      FROM "Lessons" l
      JOIN "Courses" c ON c.id::text = l."courseId"
      LEFT JOIN "QuizAttempts" qa ON qa."lessonId" = l.id::text AND ${between('qa."submittedAt"', lf, lt)} AND ${lsc.person('qa."personId"')}
     WHERE l."type" = 'Quiz' AND ${lsc.course('l."courseId"')}
     GROUP BY l.id, l."title", l."courseId", l."settings", l."position", c."status", c."title"
    HAVING c."status" <> 'Archived' OR COUNT(qa.id) > 0
     ORDER BY COUNT(qa.id) DESC, LOWER(c."title") ASC, COALESCE(l."position", 0) ASC`;

  let reportPromise: Promise<QuizReportOutput['report']> = Promise.resolve(null);
  if (input.lessonId) {
    const lessonId = input.lessonId;
    reportPromise = (async () => {
      const rp = new Params();
      const rsc = scopeSql(rp, toScope({ groupIds: input.groupIds }));
      const lid = rp.add(lessonId);
      const rf = rp.add(range.from);
      const rt = rp.add(range.to);
      const attemptWhere = `qa."lessonId" = ${lid} AND ${between('qa."submittedAt"', rf, rt)} AND ${rsc.person('qa."personId"')}`;
      const aggQuery = `
        WITH attempt_rows AS (
          SELECT qa."enrollmentId", COALESCE(qa."number", 1) AS "number", COALESCE(qa."score", 0) AS "score", COALESCE(qa."passed", false) AS "passed" FROM "QuizAttempts" qa WHERE ${attemptWhere}
        ),
        learner_rows AS (
          SELECT "enrollmentId", COUNT(*) AS "attemptTotal", BOOL_OR("passed") AS "everPassed" FROM attempt_rows GROUP BY 1
        )
        SELECT
          (SELECT l."title" FROM "Lessons" l WHERE l.id::text = ${lid}) AS "title",
          (SELECT l."courseId" FROM "Lessons" l WHERE l.id::text = ${lid}) AS "courseId",
          (SELECT l."type" FROM "Lessons" l WHERE l.id::text = ${lid}) AS "type",
          (SELECT l."settings" FROM "Lessons" l WHERE l.id::text = ${lid}) AS "settings",
          (SELECT c."title" FROM "Lessons" l JOIN "Courses" c ON c.id::text = l."courseId" WHERE l.id::text = ${lid}) AS "courseTitle",
          (SELECT COUNT(*) FROM attempt_rows) AS "attemptTotal",
          (SELECT COUNT(*) FROM learner_rows) AS "learnerTotal",
          (SELECT COUNT(*) FROM learner_rows WHERE "everPassed") AS "passedTotal",
          (SELECT COUNT(*) FROM attempt_rows WHERE "number" = 1) AS "firstTotal",
          (SELECT COUNT(*) FROM attempt_rows WHERE "number" = 1 AND "passed") AS "firstPassedTotal",
          (SELECT AVG("score") FROM attempt_rows) AS "scoreAverage",
          (SELECT AVG("attemptTotal") FROM learner_rows) AS "attemptsAverage",
          (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT LEAST(9, GREATEST(0, FLOOR("score" / 10)))::int AS "bucket", COUNT(*) AS "total" FROM attempt_rows GROUP BY 1) x) AS "scores",
          (SELECT COALESCE(json_agg(x), '[]'::json) FROM (SELECT LEAST(4, "attemptTotal")::int AS "bucket", COUNT(*) AS "total" FROM learner_rows GROUP BY 1) x) AS "attempts"`;
      const { rows } = await sql(aggQuery, rp.values);
      const r = rows[0] ?? {};
      if (r.title == null) throw new ZiteError('That quiz no longer exists.', 'NOT_FOUND');
      if (r.type !== 'Quiz') throw new ZiteError('That lesson isn’t a quiz.', 'BAD_REQUEST');
      const settings = parseQuizSettings(r.settings);

      // Item analysis: page the answers in bounded batches, most recent first.
      const answerSets: unknown[] = [];
      let cursor: { at: string; id: string } | null = null;
      let truncated = false;
      while (answerSets.length < MAX_ANALYZED) {
        const bp = new Params();
        const bsc = scopeSql(bp, toScope({ groupIds: input.groupIds }));
        const where = [`qa."lessonId" = ${bp.add(lessonId)}`, between('qa."submittedAt"', bp.add(range.from), bp.add(range.to)), bsc.person('qa."personId"')];
        if (cursor) where.push(`(qa.created_at, qa.id::text) < (${bp.add(cursor.at)}::timestamptz, ${bp.add(cursor.id)}::text)`);
        const { rows: batch } = await sql(`SELECT qa.id::text AS "id", qa.created_at AS "createdAt", qa."answers" FROM "QuizAttempts" qa WHERE ${where.join(' AND ')} ORDER BY qa.created_at DESC, qa.id::text DESC LIMIT ${ATTEMPT_BATCH}`, bp.values);
        for (const a of batch) answerSets.push(a.answers);
        if (batch.length < ATTEMPT_BATCH) break;
        const last = batch[batch.length - 1];
        cursor = { at: iso(last.createdAt) ?? new Date(0).toISOString(), id: String(last.id) };
        if (answerSets.length >= MAX_ANALYZED) truncated = true;
      }
      const analysis = analyzeAttempts(settings, answerSets.slice(0, MAX_ANALYZED));
      const scoreBuckets = new Map(jsonRows(r.scores).map(x => [num(x.bucket), num(x.total)]));
      const attemptBuckets = new Map(jsonRows(r.attempts).map(x => [num(x.bucket), num(x.total)]));
      return {
        lessonId,
        title: str(r.title) ?? '',
        courseId: String(r.courseId),
        courseTitle: str(r.courseTitle) ?? '',
        passingScore: settings.passingScore,
        maxAttempts: settings.maxAttempts,
        attempts: num(r.attemptTotal),
        learners: num(r.learnerTotal),
        firstPassRate: rate(num(r.firstPassedTotal), num(r.firstTotal)),
        passRate: rate(num(r.passedTotal), num(r.learnerTotal)),
        averageScore: r.scoreAverage == null ? null : round1(num(r.scoreAverage)),
        averageAttempts: r.attemptsAverage == null ? null : round1(num(r.attemptsAverage)),
        scores: Array.from({ length: 10 }, (_, i) => ({ label: i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`, min: i * 10, count: scoreBuckets.get(i) ?? 0 })),
        attemptsPerLearner: ['1 attempt', '2 attempts', '3 attempts', '4 or more'].map((label, i) => ({ label, count: attemptBuckets.get(i + 1) ?? 0 })),
        items: analysis.items,
        analyzedAttempts: Math.min(answerSets.length, MAX_ANALYZED),
        truncated,
        removedQuestionAnswers: analysis.removed,
      };
    })();
  }

  const [listRes, report] = await Promise.all([sql(listQuery, lp.values), reportPromise]);
  return {
    range,
    quizzes: listRes.rows.map(r => {
      const s = parseQuizSettings(r.settings);
      return {
        lessonId: String(r.lessonId),
        title: str(r.title) ?? '',
        courseId: String(r.courseId),
        courseTitle: str(r.courseTitle) ?? '',
        questions: s.questions.length,
        passingScore: s.passingScore,
        attempts: num(r.attemptTotal),
        learners: num(r.learnerTotal),
        firstPassRate: rate(num(r.firstPassedTotal), num(r.firstTotal)),
        passRate: rate(num(r.passedTotal), num(r.learnerTotal)),
        averageScore: r.scoreAverage == null ? null : round1(num(r.scoreAverage)),
        lastAttemptAt: iso(r.lastAt),
      };
    }),
    report,
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

export function csvCell(v: unknown) {
  if (v == null) return '';
  let s = typeof v === 'number' ? String(v) : String(v);
  // Spreadsheet formula injection: a cell starting with = + - @ is data, not a formula.
  if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]) {
  // A BOM so Excel reads accented names (Marín, Sørensen) as UTF-8.
  return `﻿${[headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export const EXPORT_KINDS = ['enrollments', 'compliance', 'courses', 'groups', 'quiz', 'learners'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const MAX_EXPORT_ROWS = 20_000;

/** Page an ordered, row-shaped query past zite.sql's 2,000-row cap. `build` binds its own params and returns SQL ending in ORDER BY. */
export async function pagedRows(build: (p: Params) => string, max = MAX_EXPORT_ROWS) {
  const out: Array<Record<string, unknown>> = [];
  let truncated = false;
  for (let offset = 0; ; offset += 2000) {
    const p = new Params();
    const query = `${build(p)} LIMIT 2000 OFFSET ${offset}`;
    const { rows } = await sql(query, p.values);
    out.push(...rows);
    if (rows.length < 2000) break;
    if (out.length >= max) {
      truncated = true;
      break;
    }
  }
  return { rows: out.slice(0, max), truncated };
}

export async function enrollmentExportRows(input: ScopeInput) {
  const { timeZone } = await orgTimeZone();
  const range = resolveRange(input, timeZone);
  const scope = toScope(input);
  const { rows, truncated } = await pagedRows(p => {
    const sc = scopeSql(p, scope);
    const f = p.add(range.from);
    const t = p.add(range.to);
    return `
      SELECT pp."name" AS "personName", pp."email" AS "personEmail", mgr."name" AS "managerName", gl."groupNames", c."title" AS "courseTitle", cat."name" AS "categoryName",
             e."source", e."status", e."enrolledAt", e."startedAt", e."completedAt", e."dueDate", e."progress", e."score", e."rating", e."timeSpentSeconds", COALESCE(e."cycle", 1) AS "cycle",
             ${overdueAt(t)} AS "isOverdue", (e."status" = 'Completed' AND (e."dueDate" IS NULL OR e."completedAt"::date <= e."dueDate")) AS "isOnTime"
        FROM "Enrollments" e
        JOIN "People" pp ON pp.id::text = e."personId"
        JOIN "Courses" c ON c.id::text = e."courseId"
        LEFT JOIN "Categories" cat ON cat.id::text = c."categoryId"
        LEFT JOIN "People" mgr ON mgr.id::text = pp."managerId"
        LEFT JOIN (SELECT gm."personId", string_agg(g."name", '; ' ORDER BY g."name") AS "groupNames" FROM "GroupMembers" gm JOIN "Groups" g ON g.id::text = gm."groupId" GROUP BY 1) gl ON gl."personId" = e."personId"
       WHERE ${inCohort(f, t)} AND ${ACTIVE_PERSON('pp')} AND ${sc.person('e."personId"')} AND ${sc.course('e."courseId"')}
       ORDER BY LOWER(pp."name") ASC, LOWER(c."title") ASC, COALESCE(e."cycle", 1) ASC, e.id ASC`;
  });
  return { range, rows, truncated };
}

/** Every course with cohort numbers for the range — the CSV twin of "Top courses". */
export async function courseExportRows(input: ScopeInput) {
  const { timeZone } = await orgTimeZone();
  const range = resolveRange(input, timeZone);
  const scope = toScope(input);
  const { rows, truncated } = await pagedRows(p => {
    const sc = scopeSql(p, scope);
    const f = p.add(range.from);
    const t = p.add(range.to);
    return `
      WITH cohort_rows AS (
        SELECT e."courseId", e."score", e."rating", e."timeSpentSeconds", (e."status" = 'Completed' AND e."completedAt" < ${t}::timestamptz) AS "isDone", ${overdueAt(t)} AS "isOverdue"
          FROM "Enrollments" e JOIN "People" pp ON pp.id::text = e."personId"
         WHERE ${inCohort(f, t)} AND ${ACTIVE_PERSON('pp')} AND ${sc.person('e."personId"')} AND ${sc.course('e."courseId"')}
      ),
      event_counts AS (
        SELECT e."courseId",
               COUNT(*) FILTER (WHERE ${between('e."enrolledAt"', f, t)}) AS "enrolledTotal",
               COUNT(*) FILTER (WHERE e."status" = 'Completed' AND ${between('e."completedAt"', f, t)}) AS "completedTotal"
          FROM "Enrollments" e WHERE ${sc.person('e."personId"')} AND ${sc.course('e."courseId"')} GROUP BY 1
      )
      SELECT c."title", c."status" AS "courseStatus", cat."name" AS "categoryName",
             COUNT(cr."courseId") AS "cohortTotal", COUNT(cr."courseId") FILTER (WHERE cr."isDone") AS "doneTotal", COUNT(cr."courseId") FILTER (WHERE cr."isOverdue") AS "overdueTotal",
             AVG(cr."score") AS "scoreAverage", AVG(cr."rating") FILTER (WHERE cr."rating" > 0) AS "ratingAverage", COUNT(cr."courseId") FILTER (WHERE cr."rating" > 0) AS "ratingTotal",
             AVG(cr."timeSpentSeconds") FILTER (WHERE cr."isDone") AS "secondsAverage",
             COALESCE(MAX(ec."enrolledTotal"), 0) AS "enrolledTotal", COALESCE(MAX(ec."completedTotal"), 0) AS "completedTotal"
        FROM "Courses" c
        LEFT JOIN "Categories" cat ON cat.id::text = c."categoryId"
        LEFT JOIN cohort_rows cr ON cr."courseId" = c.id::text
        LEFT JOIN event_counts ec ON ec."courseId" = c.id::text
       WHERE ${sc.course('c.id::text')}
       GROUP BY c.id, c."title", c."status", cat."name"
      HAVING COUNT(cr."courseId") > 0 OR COALESCE(MAX(ec."enrolledTotal"), 0) > 0 OR c."status" = 'Published'
       ORDER BY COUNT(cr."courseId") DESC, LOWER(c."title") ASC, c.id ASC`;
  });
  return { range, rows, truncated };
}

/** Every group with cohort numbers for the range — the CSV twin of "Groups compared". */
export async function groupExportRows(input: ScopeInput) {
  const { timeZone } = await orgTimeZone();
  const range = resolveRange(input, timeZone);
  const scope = toScope(input);
  const p = new Params();
  const sc = scopeSql(p, scope);
  const f = p.add(range.from);
  const t = p.add(range.to);
  const { rows } = await sql(
    `WITH cohort_rows AS (
       SELECT e."personId", e."score", (e."status" = 'Completed' AND e."completedAt" < ${t}::timestamptz) AS "isDone", ${overdueAt(t)} AS "isOverdue"
         FROM "Enrollments" e JOIN "People" pp ON pp.id::text = e."personId"
        WHERE ${inCohort(f, t)} AND ${ACTIVE_PERSON('pp')} AND ${sc.course('e."courseId"')}
     ),
     member_rows AS (
       SELECT DISTINCT gm."groupId", gm."personId" FROM "GroupMembers" gm JOIN "People" mp ON mp.id::text = gm."personId"
        WHERE ${ACTIVE_PERSON('mp')} ${sc.groups ? `AND gm."groupId" = ANY(${sc.groups}::text[])` : ''}
     ),
     active_rows AS (
       SELECT DISTINCT lp."personId" FROM "LessonProgress" lp WHERE (${between('lp."startedAt"', f, t)} OR ${between('lp."completedAt"', f, t)}) AND ${sc.course('lp."courseId"')}
     ),
     group_reach AS (
       SELECT mr."groupId", COUNT(*) AS "memberTotal", COUNT(ar."personId") AS "activeTotal" FROM member_rows mr LEFT JOIN active_rows ar ON ar."personId" = mr."personId" GROUP BY 1
     ),
     group_work AS (
       SELECT mr."groupId", COUNT(*) AS "cohortTotal", COUNT(*) FILTER (WHERE cr."isDone") AS "doneTotal", COUNT(*) FILTER (WHERE cr."isOverdue") AS "overdueTotal", AVG(cr."score") AS "scoreAverage"
         FROM member_rows mr JOIN cohort_rows cr ON cr."personId" = mr."personId" GROUP BY 1
     )
     SELECT g."name", g."kind", gr."memberTotal", gr."activeTotal", COALESCE(gw."cohortTotal", 0) AS "cohortTotal", COALESCE(gw."doneTotal", 0) AS "doneTotal", COALESCE(gw."overdueTotal", 0) AS "overdueTotal", gw."scoreAverage"
       FROM group_reach gr JOIN "Groups" g ON g.id::text = gr."groupId" LEFT JOIN group_work gw ON gw."groupId" = gr."groupId"
      ORDER BY LOWER(g."name") ASC`,
    p.values,
  );
  return { range, rows };
}

/** Everyone in scope with their learning in the range — the CSV twin of Engagement. */
export async function learnerExportRows(input: ScopeInput) {
  const { timeZone } = await orgTimeZone();
  const range = resolveRange(input, timeZone);
  const scope = toScope(input);
  const { rows, truncated } = await pagedRows(p => {
    const sc = scopeSql(p, scope);
    const f = p.add(range.from);
    const t = p.add(range.to);
    const tz = p.add(range.timeZone);
    const lpc = sc.course('lp."courseId"');
    return `
      WITH activity_events AS (
        SELECT lp."personId", lp."startedAt" AS "at", 0 AS "seconds", false AS "done" FROM "LessonProgress" lp WHERE ${between('lp."startedAt"', f, t)} AND ${lpc}
        UNION ALL
        SELECT lp."personId", lp."completedAt", 0, true FROM "LessonProgress" lp WHERE ${between('lp."completedAt"', f, t)} AND lp."status" = 'Completed' AND ${lpc}
      ),
      day_counts AS (
        SELECT "personId", COUNT(DISTINCT ("at" AT TIME ZONE ${tz}::text)::date) AS "dayTotal", COUNT(*) FILTER (WHERE "done") AS "lessonTotal" FROM activity_events GROUP BY 1
      ),
      time_totals AS (
        SELECT lp."personId", SUM(lp."timeSpentSeconds") AS "secondsTotal" FROM "LessonProgress" lp WHERE (${between('lp."startedAt"', f, t)} OR ${between('lp."completedAt"', f, t)}) AND ${lpc} GROUP BY 1
      ),
      course_points AS (
        SELECT e."personId", COUNT(*) AS "n" FROM "Enrollments" e WHERE e."status" = 'Completed' AND ${between('e."completedAt"', f, t)} AND ${sc.course('e."courseId"')} GROUP BY 1
      ),
      path_points AS (
        SELECT pe."personId", COUNT(*) AS "n" FROM "PathEnrollments" pe WHERE pe."status" = 'Completed' AND ${between('pe."completedAt"', f, t)} AND ${sc.path('pe."pathId"')} GROUP BY 1
      ),
      quiz_points AS (
        SELECT qa."personId",
               COUNT(DISTINCT qa."enrollmentId" || ':' || qa."lessonId") FILTER (WHERE COALESCE(qa."passed", false)) AS "passTotal",
               COUNT(DISTINCT qa."enrollmentId" || ':' || qa."lessonId") FILTER (WHERE qa."score" >= 100) AS "perfectTotal"
          FROM "QuizAttempts" qa WHERE ${between('qa."submittedAt"', f, t)} AND ${sc.course('qa."courseId"')} GROUP BY 1
      ),
      last_learning AS (
        SELECT lp."personId", MAX(GREATEST(lp."startedAt", lp."completedAt")) AS "lastAt" FROM "LessonProgress" lp GROUP BY 1
      ),
      open_work AS (
        SELECT e."personId", COUNT(*) AS "openTotal", COUNT(*) FILTER (WHERE e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overdueTotal" FROM "Enrollments" e WHERE e."status" IN ('Not started', 'In progress') GROUP BY 1
      ),
      member_lists AS (
        SELECT gm."personId", string_agg(g."name", '; ' ORDER BY g."name") AS "groupNames" FROM "GroupMembers" gm JOIN "Groups" g ON g.id::text = gm."groupId" GROUP BY 1
      )
      SELECT p."name", p."email", p."title", p."status", mgr."name" AS "managerName", ml."groupNames",
             COALESCE(dc."dayTotal", 0) AS "dayTotal", COALESCE(dc."lessonTotal", 0) AS "lessonTotal", COALESCE(cp."n", 0) AS "courseTotal", COALESCE(pp2."n", 0) AS "pathTotal",
             COALESCE(qp."passTotal", 0) AS "passTotal", COALESCE(qp."perfectTotal", 0) AS "perfectTotal", COALESCE(tt."secondsTotal", 0) AS "secondsTotal",
             GREATEST(ll."lastAt", p."lastLearnedAt") AS "lastAt", COALESCE(ow."openTotal", 0) AS "openTotal", COALESCE(ow."overdueTotal", 0) AS "overdueTotal"
        FROM "People" p
        LEFT JOIN "People" mgr ON mgr.id::text = p."managerId"
        LEFT JOIN member_lists ml ON ml."personId" = p.id::text
        LEFT JOIN day_counts dc ON dc."personId" = p.id::text
        LEFT JOIN time_totals tt ON tt."personId" = p.id::text
        LEFT JOIN course_points cp ON cp."personId" = p.id::text
        LEFT JOIN path_points pp2 ON pp2."personId" = p.id::text
        LEFT JOIN quiz_points qp ON qp."personId" = p.id::text
        LEFT JOIN last_learning ll ON ll."personId" = p.id::text
        LEFT JOIN open_work ow ON ow."personId" = p.id::text
       WHERE ${ACTIVE_PERSON('p')} AND ${sc.person('p.id::text')}
       ORDER BY LOWER(p."name") ASC, p.id ASC`;
  });
  return { range, rows, truncated };
}
