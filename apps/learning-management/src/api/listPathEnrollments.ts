import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { dueState } from '@project/shared/progress';
import { loadPathCourses } from '@project/shared/server/courses';
import { assertStaff, getActor } from '@project/shared/server/people';
import { day, iso, num, Params, ref, str } from '@project/shared/server/sql';
import { requirePath } from '../server/catalog-admin';

/**
 * Who is working through a learning path: one row per person (their latest
 * cycle), with where they are in each course of the path, plus the counts the
 * status tabs show.
 */

const STATUSES = ['Not started', 'In progress', 'Completed', 'Withdrawn'] as const;
const DUE = ['overdue', 'due_soon', 'on_track', 'no_due', 'done'] as const;
const ORDERINGS = ['due_asc', 'progress_asc', 'progress_desc', 'enrolled_desc', 'completed_desc', 'name_asc'] as const;

const Input = z.object({
  pathId: z.string().min(1),
  filters: z.object({ q: z.string().max(200).optional(), statuses: z.array(z.enum(STATUSES)).optional(), due: z.array(z.enum(DUE)).optional() }).optional(),
  ordering: z.enum(ORDERINGS).optional(),
});

const Output = z.object({
  rows: z.array(z.object({
    id: z.string(),
    personId: z.string(),
    personName: z.string(),
    personEmail: z.string(),
    personColor: z.string(),
    personAvatarUrl: z.string().nullable(),
    personTitle: z.string().nullable(),
    personStatus: z.string(),
    status: z.enum(STATUSES),
    progress: z.number(),
    dueDate: z.string().nullable(),
    dueState: z.enum(['done', 'overdue', 'due_soon', 'on_track', 'no_due', 'withdrawn']),
    enrolledAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    remindedAt: z.string().nullable(),
    source: z.string(),
    certificateId: z.string().nullable(),
    cycle: z.number(),
    done: z.number(),
    total: z.number(),
    courses: z.array(z.object({ courseId: z.string(), enrollmentId: z.string().nullable(), status: z.string().nullable(), progress: z.number() })),
  })),
  summary: z.object({ total: z.number(), notStarted: z.number(), inProgress: z.number(), completed: z.number(), overdue: z.number(), dueSoon: z.number(), withdrawn: z.number() }),
  truncated: z.boolean(),
});

const OPEN = `pe."status" IN ('Not started', 'In progress')`;

function dueClause(d: (typeof DUE)[number]) {
  switch (d) {
    case 'overdue':
      return `(${OPEN} AND pe."dueDate" < (NOW() AT TIME ZONE 'UTC')::date)`;
    case 'due_soon':
      return `(${OPEN} AND pe."dueDate" >= (NOW() AT TIME ZONE 'UTC')::date AND pe."dueDate" <= (NOW() AT TIME ZONE 'UTC')::date + 7)`;
    case 'on_track':
      return `(${OPEN} AND pe."dueDate" > (NOW() AT TIME ZONE 'UTC')::date + 7)`;
    case 'no_due':
      return `(${OPEN} AND pe."dueDate" IS NULL)`;
    case 'done':
      return `(pe."status" = 'Completed')`;
  }
}

function orderBy(o: (typeof ORDERINGS)[number]) {
  switch (o) {
    case 'progress_asc':
      return `COALESCE(pe."progress", 0) ASC, pe."dueDate" ASC NULLS LAST, LOWER(p."name")`;
    case 'progress_desc':
      return `COALESCE(pe."progress", 0) DESC, LOWER(p."name")`;
    case 'enrolled_desc':
      return `pe."enrolledAt" DESC NULLS LAST, pe.created_at DESC`;
    case 'completed_desc':
      return `pe."completedAt" DESC NULLS LAST, LOWER(p."name")`;
    case 'name_asc':
      return `LOWER(p."name") ASC`;
    case 'due_asc':
    default:
      return `CASE WHEN pe."status" = 'Completed' THEN 1 WHEN pe."status" = 'Withdrawn' THEN 2 ELSE 0 END ASC, pe."dueDate" ASC NULLS LAST, LOWER(p."name") ASC`;
  }
}

export default createEndpoint({
  description: 'List the people enrolled in a learning path with their progress through each course',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const { filters = {}, ordering = 'due_asc' } = parsed.data;
    const path = await requirePath(parsed.data.pathId);
    const courses = await loadPathCourses(path.id);

    const build = (p: Params, withStatus: boolean) => {
      const w = [
        `pe."pathId" = ${p.add(path.id)}`,
        `NOT EXISTS (SELECT 1 FROM "PathEnrollments" pe2 WHERE pe2."pathId" = pe."pathId" AND pe2."personId" = pe."personId" AND (COALESCE(pe2."cycle", 1) > COALESCE(pe."cycle", 1) OR (COALESCE(pe2."cycle", 1) = COALESCE(pe."cycle", 1) AND pe2.created_at > pe.created_at)))`,
      ];
      if (filters.q?.trim()) {
        const like = p.add(`%${filters.q.trim().toLowerCase()}%`);
        w.push(`(LOWER(p."name") LIKE ${like} OR LOWER(p."email") LIKE ${like} OR LOWER(COALESCE(p."title", '')) LIKE ${like})`);
      }
      if (withStatus) {
        if (filters.statuses?.length) w.push(`pe."status" = ANY(${p.add(filters.statuses)}::text[])`);
        else w.push(`COALESCE(pe."status", '') <> 'Withdrawn'`);
        if (filters.due?.length) w.push(`(${filters.due.map(dueClause).join(' OR ')})`);
      }
      return `FROM "PathEnrollments" pe JOIN "People" p ON p.id::text = pe."personId" WHERE ${w.join(' AND ')}`;
    };

    const p = new Params();
    const from = build(p, true);
    const sp = new Params();
    const summaryFrom = build(sp, false);
    const LIMIT = 2000;
    const [rowsRes, summaryRes] = await Promise.all([
      zite.sql({
        query: `SELECT pe.*, p."name" AS "personName", p."email" AS "personEmail", p."color" AS "personColor", p."avatarUrl" AS "personAvatarUrl", p."title" AS "personTitle", p."status" AS "personStatus"
                ${from} ORDER BY ${orderBy(ordering)} LIMIT ${LIMIT}`,
        params: p.values,
      }),
      zite.sql({
        query: `SELECT COUNT(*) FILTER (WHERE COALESCE(pe."status", '') <> 'Withdrawn') AS "allTotal",
                  COUNT(*) FILTER (WHERE pe."status" = 'Not started') AS "idleTotal",
                  COUNT(*) FILTER (WHERE pe."status" = 'In progress') AS "activeTotal",
                  COUNT(*) FILTER (WHERE pe."status" = 'Completed') AS "doneTotal",
                  COUNT(*) FILTER (WHERE ${OPEN} AND pe."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "lateTotal",
                  COUNT(*) FILTER (WHERE ${OPEN} AND pe."dueDate" >= (NOW() AT TIME ZONE 'UTC')::date AND pe."dueDate" <= (NOW() AT TIME ZONE 'UTC')::date + 7) AS "soonTotal",
                  COUNT(*) FILTER (WHERE pe."status" = 'Withdrawn') AS "withdrawnTotal"
                ${summaryFrom}`,
        params: sp.values,
      }),
    ]);

    const personIds = [...new Set(rowsRes.rows.map(r => String(r.personId)))];
    const courseIds = courses.map(c => c.courseId);
    const byPerson = new Map<string, Map<string, { enrollmentId: string; status: string; progress: number }>>();
    if (personIds.length && courseIds.length) {
      const { rows } = await zite.sql({
        query: `SELECT DISTINCT ON (e."personId", e."courseId") e.id, e."personId", e."courseId", e."status", e."progress"
                FROM "Enrollments" e WHERE e."personId" = ANY($1::text[]) AND e."courseId" = ANY($2::text[])
                ORDER BY e."personId", e."courseId", COALESCE(e."cycle", 1) DESC, e.created_at DESC`,
        params: [personIds, courseIds],
      });
      for (const r of rows) {
        const pid = String(r.personId);
        if (!byPerson.has(pid)) byPerson.set(pid, new Map());
        byPerson.get(pid)!.set(String(r.courseId), { enrollmentId: String(r.id), status: str(r.status) || 'Not started', progress: r.status === 'Completed' ? 100 : num(r.progress) });
      }
    }
    const counted = courses.some(c => !c.optional) ? courses.filter(c => !c.optional) : courses;
    const s = summaryRes.rows[0] ?? {};

    return {
      rows: rowsRes.rows.map(r => {
        const status = (STATUSES.includes(r.status as (typeof STATUSES)[number]) ? r.status : 'Not started') as (typeof STATUSES)[number];
        const dueDate = day(r.dueDate);
        const mine = byPerson.get(String(r.personId)) ?? new Map();
        return {
          id: String(r.id),
          personId: String(r.personId),
          personName: str(r.personName) || str(r.personEmail) || 'Unknown person',
          personEmail: str(r.personEmail) ?? '',
          personColor: str(r.personColor) || '#8b8d98',
          personAvatarUrl: ref(r.personAvatarUrl),
          personTitle: ref(r.personTitle),
          personStatus: str(r.personStatus) || 'Active',
          status,
          progress: status === 'Completed' ? 100 : num(r.progress),
          dueDate,
          dueState: dueState({ status, dueDate }),
          enrolledAt: iso(r.enrolledAt),
          completedAt: iso(r.completedAt),
          remindedAt: iso(r.remindedAt),
          source: str(r.source) || 'Assigned',
          certificateId: ref(r.certificateId),
          cycle: num(r.cycle, 1) || 1,
          done: counted.filter(c => mine.get(c.courseId)?.status === 'Completed').length,
          total: counted.length,
          courses: courses.map(c => {
            const e = mine.get(c.courseId);
            return { courseId: c.courseId, enrollmentId: e?.enrollmentId ?? null, status: e?.status ?? null, progress: e?.progress ?? 0 };
          }),
        };
      }),
      summary: {
        total: num(s.allTotal),
        notStarted: num(s.idleTotal),
        inProgress: num(s.activeTotal),
        completed: num(s.doneTotal),
        overdue: num(s.lateTotal),
        dueSoon: num(s.soonTotal),
        withdrawn: num(s.withdrawnTotal),
      },
      truncated: rowsRes.rows.length >= LIMIT,
    };
  },
});
