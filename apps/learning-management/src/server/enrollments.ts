import { z } from 'zod';
import { zite } from 'zitejs/db';
import { dueState } from '@project/shared/progress';
import { day, iso, num, numOrNull, Params, ref, str } from '@project/shared/server/sql';

/**
 * The enrollments list: one filtered, ordered SQL query behind every list of
 * "who is doing what" — a course's learners, a person's transcript, a group's
 * progress, the org-wide Enrollments page and saved views.
 *
 * Rows carry the learner's name and avatar so the client never needs the
 * whole directory loaded.
 */

export const DUE_FILTERS = ['overdue', 'due_soon', 'on_track', 'no_due', 'done'] as const;

export const enrollmentFilterSchema = z.object({
  q: z.string().max(200).optional(),
  courseIds: z.array(z.string()).max(500).optional(),
  categoryIds: z.array(z.string()).max(100).optional(),
  personIds: z.array(z.string()).max(2000).optional(),
  groupIds: z.array(z.string()).max(200).optional(),
  managerId: z.string().optional(),
  statuses: z.array(z.enum(['Not started', 'In progress', 'Completed', 'Withdrawn'])).optional(),
  due: z.array(z.enum(DUE_FILTERS)).optional(),
  sources: z.array(z.enum(['Assigned', 'Self-enrolled', 'Automatic', 'Path'])).optional(),
  ruleId: z.string().optional(),
  pathEnrollmentIds: z.array(z.string()).max(2000).optional(),
  enrolledFrom: z.string().optional(),
  enrolledTo: z.string().optional(),
  completedFrom: z.string().optional(),
  completedTo: z.string().optional(),
  dueFrom: z.string().optional(),
  dueTo: z.string().optional(),
  /** Rolling windows, so a saved view keeps meaning "the last 30 days" instead of freezing the dates it was saved with. */
  enrolledWithinDays: z.number().int().min(1).max(3650).optional(),
  completedWithinDays: z.number().int().min(1).max(3650).optional(),
  /** Due between today and this many days from now. */
  dueWithinDays: z.number().int().min(1).max(3650).optional(),
  scoreMin: z.number().min(0).max(100).optional(),
  scoreMax: z.number().min(0).max(100).optional(),
  /** No activity for at least this many days (not-completed only). */
  inactiveDays: z.number().int().min(1).max(3650).optional(),
  /** Include earlier recertification cycles. Default: latest cycle only. */
  allCycles: z.boolean().optional(),
  /** A list's status tab, applied on top of every other filter (including status and due filters). */
  tab: z.enum(['all', 'overdue', 'due_soon', 'in_progress', 'not_started', 'completed', 'withdrawn']).optional(),
});
export type EnrollmentTab = NonNullable<z.infer<typeof enrollmentFilterSchema>['tab']>;
export type EnrollmentFilters = z.infer<typeof enrollmentFilterSchema>;

export const ORDERINGS = ['due_asc', 'due_desc', 'progress_asc', 'progress_desc', 'enrolled_desc', 'enrolled_asc', 'activity_desc', 'completed_desc', 'name_asc', 'course_asc', 'score_desc', 'score_asc'] as const;
export type Ordering = (typeof ORDERINGS)[number];

export const enrollmentRowSchema = z.object({
  id: z.string(),
  personId: z.string(),
  personName: z.string(),
  personEmail: z.string(),
  personColor: z.string(),
  personAvatarUrl: z.string().nullable(),
  personTitle: z.string().nullable(),
  personStatus: z.string(),
  managerId: z.string().nullable(),
  courseId: z.string(),
  status: z.enum(['Not started', 'In progress', 'Completed', 'Withdrawn']),
  dueState: z.enum(['done', 'overdue', 'due_soon', 'on_track', 'no_due', 'withdrawn']),
  progress: z.number(),
  dueDate: z.string().nullable(),
  enrolledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  score: z.number().nullable(),
  timeSpentSeconds: z.number(),
  source: z.string(),
  assignedById: z.string().nullable(),
  assignedByName: z.string().nullable(),
  ruleId: z.string().nullable(),
  pathEnrollmentId: z.string().nullable(),
  certificateId: z.string().nullable(),
  cycle: z.number(),
  rating: z.number().nullable(),
  currentLessonId: z.string().nullable(),
  remindedAt: z.string().nullable(),
});
export type EnrollmentListRow = z.infer<typeof enrollmentRowSchema>;

const OPEN = `e."status" IN ('Not started', 'In progress')`;

function dueClause(d: (typeof DUE_FILTERS)[number]) {
  switch (d) {
    case 'overdue':
      return `(${OPEN} AND e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date)`;
    case 'due_soon':
      return `(${OPEN} AND e."dueDate" >= (NOW() AT TIME ZONE 'UTC')::date AND e."dueDate" <= (NOW() AT TIME ZONE 'UTC')::date + 7)`;
    case 'on_track':
      return `(${OPEN} AND e."dueDate" > (NOW() AT TIME ZONE 'UTC')::date + 7)`;
    case 'no_due':
      return `(${OPEN} AND e."dueDate" IS NULL)`;
    case 'done':
      return `(e."status" = 'Completed')`;
  }
}

const isDay = (s: string | undefined) => Boolean(s && /^\d{4}-\d{2}-\d{2}/.test(s));

/** The condition for one status tab. */
function tabClause(tab: EnrollmentTab) {
  switch (tab) {
    case 'overdue':
      return dueClause('overdue');
    case 'due_soon':
      return dueClause('due_soon');
    case 'in_progress':
      return `e."status" = 'In progress'`;
    case 'not_started':
      return `e."status" = 'Not started'`;
    case 'completed':
      return `e."status" = 'Completed'`;
    case 'withdrawn':
      return `e."status" = 'Withdrawn'`;
    case 'all':
    default:
      return 'TRUE';
  }
}

/**
 * WHERE for the filters. Withdrawn enrollments are hidden unless a status
 * filter or the Withdrawn tab asks for them. `forCounts` leaves the tab and
 * that default out, so tab counts can be taken over the same rows.
 */
export function buildEnrollmentWhere(f: EnrollmentFilters, p: Params, opts: { forCounts?: boolean } = {}) {
  const w: string[] = [];
  const forCounts = opts.forCounts ?? false;
  if (!f.allCycles) w.push(`NOT EXISTS (SELECT 1 FROM "Enrollments" e2 WHERE e2."personId" = e."personId" AND e2."courseId" = e."courseId" AND COALESCE(e2."cycle", 1) > COALESCE(e."cycle", 1))`);
  if (f.q?.trim()) {
    const like = p.add(`%${f.q.trim().toLowerCase()}%`);
    w.push(`(LOWER(pp."name") LIKE ${like} OR LOWER(pp."email") LIKE ${like} OR LOWER(c."title") LIKE ${like})`);
  }
  if (f.courseIds?.length) w.push(`e."courseId" = ANY(${p.add(f.courseIds)}::text[])`);
  if (f.categoryIds?.length) w.push(`c."categoryId" = ANY(${p.add(f.categoryIds)}::text[])`);
  if (f.personIds?.length) w.push(`e."personId" = ANY(${p.add(f.personIds)}::text[])`);
  if (f.groupIds?.length) w.push(`EXISTS (SELECT 1 FROM "GroupMembers" gm WHERE gm."personId" = e."personId" AND gm."groupId" = ANY(${p.add(f.groupIds)}::text[]))`);
  if (f.managerId) w.push(`pp."managerId" = ${p.add(f.managerId)}`);
  if (f.sources?.length) w.push(`e."source" = ANY(${p.add(f.sources)}::text[])`);
  if (f.ruleId) w.push(`e."ruleId" = ${p.add(f.ruleId)}`);
  if (f.pathEnrollmentIds?.length) w.push(`e."pathEnrollmentId" = ANY(${p.add(f.pathEnrollmentIds)}::text[])`);
  if (isDay(f.enrolledFrom)) w.push(`e."enrolledAt" >= ${p.add(f.enrolledFrom!.slice(0, 10))}::date`);
  if (isDay(f.enrolledTo)) w.push(`e."enrolledAt" < (${p.add(f.enrolledTo!.slice(0, 10))}::date + 1)`);
  if (isDay(f.completedFrom)) w.push(`e."completedAt" >= ${p.add(f.completedFrom!.slice(0, 10))}::date`);
  if (isDay(f.completedTo)) w.push(`e."completedAt" < (${p.add(f.completedTo!.slice(0, 10))}::date + 1)`);
  if (isDay(f.dueFrom)) w.push(`e."dueDate" >= ${p.add(f.dueFrom!.slice(0, 10))}::date`);
  if (isDay(f.dueTo)) w.push(`e."dueDate" <= ${p.add(f.dueTo!.slice(0, 10))}::date`);
  if (f.enrolledWithinDays) w.push(`COALESCE(e."enrolledAt", e.created_at) >= NOW() - (${p.add(f.enrolledWithinDays)}::int * INTERVAL '1 day')`);
  if (f.completedWithinDays) w.push(`e."completedAt" >= NOW() - (${p.add(f.completedWithinDays)}::int * INTERVAL '1 day')`);
  if (f.dueWithinDays) w.push(`(e."dueDate" >= (NOW() AT TIME ZONE 'UTC')::date AND e."dueDate" <= (NOW() AT TIME ZONE 'UTC')::date + ${p.add(f.dueWithinDays)}::int)`);
  if (f.scoreMin != null) w.push(`e."score" >= ${p.add(f.scoreMin)}::numeric`);
  if (f.scoreMax != null) w.push(`e."score" <= ${p.add(f.scoreMax)}::numeric`);
  if (f.inactiveDays) w.push(`(${OPEN} AND COALESCE(e."lastActivityAt", e."enrolledAt", e.created_at) < NOW() - (${p.add(f.inactiveDays)}::int * INTERVAL '1 day'))`);
  if (f.statuses?.length) w.push(`e."status" = ANY(${p.add(f.statuses)}::text[])`);
  else if (!forCounts && f.tab !== 'withdrawn') w.push(`COALESCE(e."status", '') <> 'Withdrawn'`);
  if (f.due?.length) w.push(`(${f.due.map(dueClause).join(' OR ')})`);
  if (!forCounts && f.tab && f.tab !== 'all') w.push(tabClause(f.tab));
  return w.length ? `WHERE ${w.join(' AND ')}` : '';
}

export function orderBy(o: Ordering) {
  switch (o) {
    case 'due_desc':
      return `e."dueDate" DESC NULLS LAST, LOWER(pp."name") ASC`;
    case 'progress_asc':
      return `COALESCE(e."progress", 0) ASC, e."dueDate" ASC NULLS LAST`;
    case 'progress_desc':
      return `COALESCE(e."progress", 0) DESC, e."completedAt" DESC NULLS LAST`;
    case 'enrolled_desc':
      return `e."enrolledAt" DESC NULLS LAST, e.created_at DESC`;
    case 'enrolled_asc':
      return `e."enrolledAt" ASC NULLS LAST, e.created_at ASC`;
    case 'activity_desc':
      return `e."lastActivityAt" DESC NULLS LAST, e."enrolledAt" DESC NULLS LAST`;
    case 'completed_desc':
      return `e."completedAt" DESC NULLS LAST, LOWER(pp."name") ASC`;
    case 'name_asc':
      return `LOWER(pp."name") ASC, LOWER(c."title") ASC`;
    case 'course_asc':
      return `LOWER(c."title") ASC, LOWER(pp."name") ASC`;
    case 'score_desc':
      return `e."score" DESC NULLS LAST, LOWER(pp."name") ASC`;
    case 'score_asc':
      return `e."score" ASC NULLS LAST, LOWER(pp."name") ASC`;
    case 'due_asc':
    default:
      // Unfinished work with the nearest due date first; finished work last.
      return `CASE WHEN e."status" = 'Completed' THEN 1 WHEN e."status" = 'Withdrawn' THEN 2 ELSE 0 END ASC, e."dueDate" ASC NULLS LAST, LOWER(pp."name") ASC`;
  }
}

const FROM = `FROM "Enrollments" e JOIN "People" pp ON pp.id::text = e."personId" JOIN "Courses" c ON c.id::text = e."courseId" LEFT JOIN "People" ab ON ab.id::text = e."assignedById"`;

export function mapEnrollmentRow(r: Record<string, unknown>): EnrollmentListRow {
  const status = (['Not started', 'In progress', 'Completed', 'Withdrawn'].includes(String(r.status)) ? r.status : 'Not started') as EnrollmentListRow['status'];
  const dueDate = day(r.dueDate);
  return {
    id: String(r.id),
    personId: String(r.personId),
    personName: str(r.personName) || str(r.personEmail) || 'Unknown person',
    personEmail: str(r.personEmail) ?? '',
    personColor: str(r.personColor) || '#8b8d98',
    personAvatarUrl: ref(r.personAvatarUrl),
    personTitle: ref(r.personTitle),
    personStatus: str(r.personStatus) || 'Active',
    managerId: ref(r.managerId),
    courseId: String(r.courseId),
    status,
    dueState: dueState({ status, dueDate }),
    progress: status === 'Completed' ? 100 : num(r.progress),
    dueDate,
    enrolledAt: iso(r.enrolledAt),
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
    lastActivityAt: iso(r.lastActivityAt),
    score: numOrNull(r.score),
    timeSpentSeconds: num(r.timeSpentSeconds),
    source: str(r.source) || 'Assigned',
    assignedById: ref(r.assignedById),
    assignedByName: ref(r.assignedByName),
    ruleId: ref(r.ruleId),
    pathEnrollmentId: ref(r.pathEnrollmentId),
    certificateId: ref(r.certificateId),
    cycle: num(r.cycle, 1) || 1,
    rating: numOrNull(r.rating),
    currentLessonId: ref(r.currentLessonId),
    remindedAt: iso(r.remindedAt),
  };
}

export async function selectEnrollments(filters: EnrollmentFilters, ordering: Ordering, limit = 500) {
  const p = new Params();
  const where = buildEnrollmentWhere(filters, p);
  const cap = Math.min(2000, Math.max(1, limit));
  // One extra row tells us whether there's more, without a second count query.
  const { rows: fetched, truncated } = await zite.sql({
    query: `SELECT e.*, pp."name" AS "personName", pp."email" AS "personEmail", pp."color" AS "personColor", pp."avatarUrl" AS "personAvatarUrl", pp."title" AS "personTitle", pp."status" AS "personStatus", pp."managerId" AS "managerId", ab."name" AS "assignedByName"
            ${FROM} ${where} ORDER BY ${orderBy(ordering)} LIMIT ${cap + 1}`,
    params: p.values,
  });
  const rows = fetched.slice(0, cap);

  const sp = new Params();
  const baseWhere = buildEnrollmentWhere(filters, sp, { forCounts: true });
  // "All" hides withdrawn work unless the filters asked for statuses explicitly.
  const allClause = filters.statuses?.length ? 'TRUE' : `COALESCE(e."status", '') <> 'Withdrawn'`;
  const { rows: summaryRows } = await zite.sql({
    query: `SELECT
              COUNT(*) FILTER (WHERE ${allClause}) AS "allTotal",
              COUNT(*) FILTER (WHERE ${tabClause('not_started')}) AS "notStartedTotal",
              COUNT(*) FILTER (WHERE ${tabClause('in_progress')}) AS "inProgressTotal",
              COUNT(*) FILTER (WHERE ${tabClause('completed')}) AS "completedTotal",
              COUNT(*) FILTER (WHERE ${tabClause('overdue')}) AS "overdueTotal",
              COUNT(*) FILTER (WHERE ${tabClause('due_soon')}) AS "dueSoonTotal",
              COUNT(*) FILTER (WHERE ${tabClause('withdrawn')}) AS "withdrawnTotal",
              AVG(e."score") FILTER (WHERE e."score" IS NOT NULL AND ${allClause}) AS "scoreAverage"
            ${FROM} ${baseWhere}`,
    params: sp.values,
  });
  const s = summaryRows[0] ?? {};
  return {
    rows: rows.map(mapEnrollmentRow),
    truncated: Boolean(truncated) || fetched.length > cap,
    summary: {
      total: num(s.allTotal),
      notStarted: num(s.notStartedTotal),
      inProgress: num(s.inProgressTotal),
      completed: num(s.completedTotal),
      overdue: num(s.overdueTotal),
      dueSoon: num(s.dueSoonTotal),
      withdrawn: num(s.withdrawnTotal),
      averageScore: s.scoreAverage != null ? Math.round(num(s.scoreAverage)) : null,
    },
  };
}

export const summarySchema = z.object({
  total: z.number(),
  notStarted: z.number(),
  inProgress: z.number(),
  completed: z.number(),
  overdue: z.number(),
  dueSoon: z.number(),
  withdrawn: z.number(),
  averageScore: z.number().nullable(),
});
