import { z } from 'zod';
import { zite } from 'zitejs/db';
import { canEditCourse, type Actor } from '@project/shared/server/people';
import { iso, num, numOrNull, Params, ref, str } from '@project/shared/server/sql';

/**
 * The grading queue: assignment submissions filtered, ordered and counted the
 * same way for the list, the detail view's neighbours and "what's next" after
 * a grade, so moving through the queue never skips or repeats an item.
 *
 * "Mine" means courses the grader owns or teaches, plus courses nobody owns —
 * the courses an instructor is responsible for. Admins can grade everything,
 * but "Mine" still narrows to their own courses so the toggle means something.
 *
 * A "Needs revision" submission stays in that tab only while it is the
 * learner's latest attempt; once they resubmit, the new attempt is what waits.
 */

export const QUEUE_STATUSES = ['Submitted', 'Needs revision', 'Passed', 'all'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const queueFiltersSchema = z.object({
  status: z.enum(QUEUE_STATUSES).default('Submitted'),
  courseId: z.string().max(80).nullable().optional(),
  scope: z.enum(['mine', 'all']).default('all'),
  q: z.string().max(200).optional(),
  ordering: z.enum(['oldest', 'newest']).default('oldest'),
});
export type QueueFilters = z.infer<typeof queueFiltersSchema>;

export const SUBMISSION_STATUSES = ['Submitted', 'Passed', 'Needs revision'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const asSubmissionStatus = (v: unknown): SubmissionStatus => (v === 'Passed' || v === 'Needs revision' ? v : 'Submitted');

/** A later attempt by the same learner on the same lesson. */
const SUPERSEDED = `EXISTS (SELECT 1 FROM "Submissions" n WHERE n."lessonId" = s."lessonId" AND n."personId" = s."personId" AND n.id::text <> s.id::text
  AND (COALESCE(n."attempt", 1) > COALESCE(s."attempt", 1) OR (COALESCE(n."attempt", 1) = COALESCE(s."attempt", 1) AND n."submittedAt" > s."submittedAt")))`;

const FROM = `FROM "Submissions" s
  JOIN "People" p ON p.id::text = s."personId"
  JOIN "Courses" c ON c.id::text = s."courseId"
  LEFT JOIN "Lessons" l ON l.id::text = s."lessonId"
  LEFT JOIN "People" g ON g.id::text = s."gradedById"`;

/** Everything except the status: scope, course and search. Counts per status share it. */
function baseWhere(actor: Actor, f: Pick<QueueFilters, 'scope' | 'courseId' | 'q'>, params: Params) {
  // Submissions for a deleted assignment lesson stay on record but can't be graded, so they leave the queue.
  const clauses: string[] = ['l.id IS NOT NULL'];
  if (f.scope === 'mine') {
    const me = params.add(actor.id);
    clauses.push(`(COALESCE(c."ownerId", '') IN ('', ${me}::text) OR COALESCE(c."instructorIds", '') LIKE '%' || ${me}::text || '%')`);
  }
  if (f.courseId) clauses.push(`s."courseId" = ${params.add(f.courseId)}`);
  const q = (f.q ?? '').trim();
  if (q) {
    const like = params.add(q);
    clauses.push(`(p."name" ILIKE '%' || ${like}::text || '%' OR p."email" ILIKE '%' || ${like}::text || '%' OR l."title" ILIKE '%' || ${like}::text || '%' OR c."title" ILIKE '%' || ${like}::text || '%')`);
  }
  return clauses;
}

function statusClause(status: QueueStatus) {
  if (status === 'Submitted') return `s."status" = 'Submitted'`;
  if (status === 'Passed') return `s."status" = 'Passed'`;
  if (status === 'Needs revision') return `s."status" = 'Needs revision' AND NOT ${SUPERSEDED}`;
  return '';
}

function orderBy(f: Pick<QueueFilters, 'status' | 'ordering'>) {
  const dir = f.ordering === 'newest' ? 'DESC' : 'ASC';
  const col = f.status === 'Passed' || f.status === 'Needs revision' ? `COALESCE(s."gradedAt", s."submittedAt")` : `s."submittedAt"`;
  return `ORDER BY ${col} ${dir} NULLS LAST, s.created_at ${dir}, s.id ${dir}`;
}

function whereSql(actor: Actor, f: QueueFilters, params: Params) {
  const clauses = baseWhere(actor, f, params);
  const s = statusClause(f.status);
  if (s) clauses.push(s);
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

export const queueRowSchema = z.object({
  id: z.string(),
  personId: z.string(),
  personName: z.string(),
  personColor: z.string(),
  personAvatarUrl: z.string().nullable(),
  personTitle: z.string().nullable(),
  courseId: z.string(),
  courseTitle: z.string(),
  courseIcon: z.string(),
  courseColor: z.string(),
  lessonId: z.string(),
  lessonTitle: z.string(),
  enrollmentId: z.string().nullable(),
  attempt: z.number(),
  status: z.enum(SUBMISSION_STATUSES),
  grade: z.number().nullable(),
  submittedAt: z.string().nullable(),
  gradedAt: z.string().nullable(),
  gradedByName: z.string().nullable(),
  waitingDays: z.number().nullable(),
  canGrade: z.boolean(),
});
export type QueueRow = z.infer<typeof queueRowSchema>;

export const queueCountsSchema = z.object({
  submitted: z.number(),
  needsRevision: z.number(),
  passed: z.number(),
  all: z.number(),
  gradedThisWeek: z.number(),
  gradedByMeThisWeek: z.number(),
});

const DAY = 86_400_000;

export async function selectQueue(actor: Actor, f: QueueFilters, limit = 500): Promise<QueueRow[]> {
  const params = new Params();
  const where = whereSql(actor, f, params);
  const { rows } = await zite.sql({
    query: `SELECT s.id, s."personId", s."courseId", s."lessonId", s."enrollmentId", s."attempt", s."status", s."grade", s."submittedAt", s."gradedAt",
              p."name" AS "personName", p."color" AS "personColor", p."avatarUrl" AS "personAvatarUrl", p."title" AS "personTitle",
              c."title" AS "courseTitle", c."icon" AS "courseIcon", c."color" AS "courseColor", c."ownerId" AS "courseOwnerId", c."instructorIds" AS "courseInstructorIds",
              l."title" AS "lessonTitle", g."name" AS "gradedByName"
            ${FROM} ${where} ${orderBy(f)} LIMIT ${Math.max(1, Math.min(1000, limit))}`,
    params: params.values,
  });
  const now = Date.now();
  return rows.map(r => {
    const status = asSubmissionStatus(r.status);
    const submittedAt = iso(r.submittedAt);
    return {
      id: String(r.id),
      personId: String(r.personId ?? ''),
      personName: str(r.personName) || 'Unknown learner',
      personColor: str(r.personColor) || '#8b8d98',
      personAvatarUrl: ref(r.personAvatarUrl),
      personTitle: ref(r.personTitle),
      courseId: String(r.courseId ?? ''),
      courseTitle: str(r.courseTitle) ?? '',
      courseIcon: str(r.courseIcon) ?? '',
      courseColor: str(r.courseColor) || '#2f6b55',
      lessonId: String(r.lessonId ?? ''),
      lessonTitle: str(r.lessonTitle) || 'Deleted lesson',
      enrollmentId: ref(r.enrollmentId),
      attempt: num(r.attempt, 1) || 1,
      status,
      grade: numOrNull(r.grade),
      submittedAt,
      gradedAt: iso(r.gradedAt),
      gradedByName: ref(r.gradedByName),
      waitingDays: status === 'Submitted' && submittedAt ? Math.max(0, Math.floor((now - Date.parse(submittedAt)) / DAY)) : null,
      canGrade: canEditCourse(actor, { ownerId: ref(r.courseOwnerId), instructorIds: r.courseInstructorIds }),
    };
  });
}

/** Ids in queue order — for neighbours and "next". */
export async function queueIds(actor: Actor, f: QueueFilters, limit = 1000): Promise<string[]> {
  const params = new Params();
  const where = whereSql(actor, f, params);
  const { rows } = await zite.sql({ query: `SELECT s.id ${FROM} ${where} ${orderBy(f)} LIMIT ${limit}`, params: params.values });
  return rows.map(r => String(r.id));
}

export async function queueCounts(actor: Actor, f: Pick<QueueFilters, 'scope' | 'courseId' | 'q'>) {
  const params = new Params();
  const clauses = baseWhere(actor, f, params);
  const me = params.add(actor.id);
  const { rows } = await zite.sql({
    query: `SELECT COUNT(*) FILTER (WHERE s."status" = 'Submitted') AS "submittedTotal",
              COUNT(*) FILTER (WHERE s."status" = 'Needs revision' AND NOT ${SUPERSEDED}) AS "revisionTotal",
              COUNT(*) FILTER (WHERE s."status" = 'Passed') AS "passedTotal",
              COUNT(*) AS "everyTotal",
              COUNT(*) FILTER (WHERE s."gradedAt" >= NOW() - INTERVAL '7 days') AS "weekTotal",
              COUNT(*) FILTER (WHERE s."gradedAt" >= NOW() - INTERVAL '7 days' AND s."gradedById" = ${me}::text) AS "myWeekTotal"
            ${FROM} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}`,
    params: params.values,
  });
  const r = rows[0] ?? {};
  return {
    submitted: num(r.submittedTotal),
    needsRevision: num(r.revisionTotal),
    passed: num(r.passedTotal),
    all: num(r.everyTotal),
    gradedThisWeek: num(r.weekTotal),
    gradedByMeThisWeek: num(r.myWeekTotal),
  };
}

export type SubmissionFile = { name: string; url: string; size: number; type: string };

export function parseFiles(raw: unknown): SubmissionFile[] {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = raw.trim() ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter(f => f && typeof f === 'object' && typeof (f as { url?: unknown }).url === 'string')
    .map(f => {
      const o = f as Record<string, unknown>;
      const url = String(o.url);
      return { name: typeof o.name === 'string' && o.name ? o.name : decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? 'File'), url, size: num(o.size), type: typeof o.type === 'string' ? o.type : '' };
    })
    .filter(f => /^https?:\/\//.test(f.url));
}
