import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseIdList } from '@project/shared/progress';
import { loadOutline } from '@project/shared/server/courses';
import { assertStaff, getActor } from '@project/shared/server/people';
import { bool, day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { firstNameInitial, requireCourse } from '../server/catalog-admin';

/**
 * How a course is doing: who's enrolled and how far they got, where people
 * drop off lesson by lesson, how quizzes and assignments are going, what
 * learners said, and what feeds people into it (paths and assignment rules).
 *
 * Learner numbers count each person once, on their latest recertification
 * cycle, and leave out withdrawn enrollments — the same rows the Learners tab
 * lists. `range` narrows that cohort to people enrolled in the last N days.
 */

const RANGES = { all: 0, '30d': 30, '90d': 90, '365d': 365 } as const;

const Input = z.object({ courseId: z.string().min(1), range: z.enum(['all', '30d', '90d', '365d']).optional() });

const Output = z.object({
  courseId: z.string(),
  range: z.enum(['all', '30d', '90d', '365d']),
  kpis: z.object({
    enrolled: z.number(),
    notStarted: z.number(),
    inProgress: z.number(),
    completed: z.number(),
    overdue: z.number(),
    completionRate: z.number().nullable(),
    onTimeRate: z.number().nullable(),
    averageScore: z.number().nullable(),
    medianDaysToComplete: z.number().nullable(),
    averageTimeSeconds: z.number().nullable(),
    ratingAverage: z.number().nullable(),
    ratingCount: z.number(),
  }),
  weekly: z.array(z.object({ week: z.string(), enrollments: z.number(), completions: z.number() })),
  funnel: z.object({ enrolled: z.number(), started: z.number(), halfway: z.number(), completed: z.number() }),
  lessons: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      type: z.string(),
      sectionId: z.string().nullable(),
      sectionTitle: z.string().nullable(),
      optional: z.boolean(),
      durationMinutes: z.number(),
      reached: z.number(),
      completed: z.number(),
      reachedRate: z.number().nullable(),
      completedRate: z.number().nullable(),
      averageTimeSeconds: z.number().nullable(),
      quizAverage: z.number().nullable(),
      firstAttemptPassRate: z.number().nullable(),
      firstAttempts: z.number(),
      pendingGrading: z.number(),
    }),
  ),
  ratings: z.object({
    distribution: z.array(z.object({ stars: z.number(), count: z.number() })),
    reviews: z.array(z.object({ id: z.string(), author: z.string(), rating: z.number(), review: z.string(), ratedAt: z.string().nullable() })),
  }),
  paths: z.array(z.object({ id: z.string(), title: z.string(), icon: z.string(), color: z.string(), status: z.string(), optional: z.boolean(), step: z.number(), courseCount: z.number() })),
  rules: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      audience: z.string(),
      groupIds: z.array(z.string()),
      personCount: z.number(),
      status: z.string(),
      dueMode: z.string(),
      dueDays: z.number().nullable(),
      dueDate: z.string().nullable(),
      recurrenceMonths: z.number().nullable(),
      viaPath: z.object({ id: z.string(), title: z.string() }).nullable(),
    }),
  ),
  sessions: z.object({ upcoming: z.number(), nextStartsAt: z.string().nullable() }),
});

const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export default createEndpoint({
  description: 'Course analytics: learners, completion, lesson drop-off, quiz results, ratings and what assigns it',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which course?', 'BAD_REQUEST');
    const range = parsed.data.range ?? 'all';
    const days = RANGES[range];
    const course = await requireCourse(parsed.data.courseId);
    const id = course.id;

    const COHORT = `latest_cycle AS (
        SELECT DISTINCT ON (e."personId") e.id, e."personId", e."status", e."progress", e."dueDate", e."enrolledAt", e."startedAt", e."completedAt", e."score", e."timeSpentSeconds"
        FROM "Enrollments" e WHERE e."courseId" = $1
        ORDER BY e."personId", COALESCE(e."cycle", 1) DESC, e.created_at DESC
      ), cohort AS (
        SELECT * FROM latest_cycle WHERE COALESCE("status", '') <> 'Withdrawn' AND ($2::int = 0 OR COALESCE("enrolledAt", NOW()) >= NOW() - ($2::int * INTERVAL '1 day'))
      )`;

    const [kpiRes, durationsRes, weeklyRes, lessonRes, quizRes, pendingRes, distRes, reviewsRes, pathsRes, rulesRes, sessionsRes, outline] = await Promise.all([
      zite.sql({
        query: `WITH ${COHORT}
          SELECT COUNT(*) AS "enrolledTotal",
            COUNT(*) FILTER (WHERE "status" = 'Not started') AS "notStartedTotal",
            COUNT(*) FILTER (WHERE "status" = 'In progress') AS "inProgressTotal",
            COUNT(*) FILTER (WHERE "status" = 'Completed') AS "completedTotal",
            COUNT(*) FILTER (WHERE "status" IN ('Not started', 'In progress') AND "dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overdueTotal",
            COUNT(*) FILTER (WHERE "status" = 'Completed' AND ("dueDate" IS NULL OR "completedAt"::date <= "dueDate")) AS "onTimeTotal",
            COUNT(*) FILTER (WHERE "status" IN ('In progress', 'Completed') OR "startedAt" IS NOT NULL) AS "startedTotal",
            COUNT(*) FILTER (WHERE "status" = 'Completed' OR COALESCE("progress", 0) >= 50) AS "halfTotal",
            AVG("score") FILTER (WHERE "score" IS NOT NULL) AS "scoreAverage",
            AVG("timeSpentSeconds") FILTER (WHERE "status" = 'Completed' AND COALESCE("timeSpentSeconds", 0) > 0) AS "doneTimeAverage",
            AVG("timeSpentSeconds") FILTER (WHERE COALESCE("timeSpentSeconds", 0) > 0) AS "anyTimeAverage"
          FROM cohort`,
        params: [id, days],
      }),
      zite.sql({
        query: `WITH ${COHORT}
          SELECT EXTRACT(EPOCH FROM ("completedAt" - COALESCE("enrolledAt", "startedAt", "completedAt"))) AS "seconds" FROM cohort WHERE "status" = 'Completed' AND "completedAt" IS NOT NULL`,
        params: [id, days],
      }),
      zite.sql({
        query: `SELECT to_char(w.week, 'YYYY-MM-DD') AS "week",
                  (SELECT COUNT(*) FROM "Enrollments" e WHERE e."courseId" = $1 AND e."enrolledAt" >= w.week AND e."enrolledAt" < w.week + INTERVAL '7 days') AS "enrolledTotal",
                  (SELECT COUNT(*) FROM "Enrollments" e WHERE e."courseId" = $1 AND e."status" = 'Completed' AND e."completedAt" >= w.week AND e."completedAt" < w.week + INTERVAL '7 days') AS "doneTotal"
                FROM generate_series(date_trunc('week', NOW()) - INTERVAL '11 weeks', date_trunc('week', NOW()), INTERVAL '7 days') AS w(week) ORDER BY w.week ASC`,
        params: [id],
      }),
      zite.sql({
        query: `WITH ${COHORT}
          SELECT lp."lessonId",
            COUNT(DISTINCT lp."enrollmentId") AS "reachedTotal",
            COUNT(DISTINCT lp."enrollmentId") FILTER (WHERE lp."status" = 'Completed') AS "doneTotal",
            AVG(lp."timeSpentSeconds") FILTER (WHERE COALESCE(lp."timeSpentSeconds", 0) > 0) AS "timeAverage",
            AVG(lp."score") FILTER (WHERE lp."score" IS NOT NULL) AS "scoreAverage"
          FROM "LessonProgress" lp JOIN cohort c ON c.id::text = lp."enrollmentId"
          WHERE lp."courseId" = $1
          GROUP BY lp."lessonId"`,
        params: [id, days],
      }),
      zite.sql({
        query: `WITH ${COHORT}
          SELECT qa."lessonId", COUNT(*) AS "firstTotal", COUNT(*) FILTER (WHERE COALESCE(qa."passed", false) = true) AS "passTotal"
          FROM "QuizAttempts" qa JOIN cohort c ON c.id::text = qa."enrollmentId"
          WHERE qa."courseId" = $1 AND COALESCE(qa."number", 1) = 1
          GROUP BY qa."lessonId"`,
        params: [id, days],
      }),
      zite.sql({ query: `SELECT "lessonId", COUNT(*) AS "pendingTotal" FROM "Submissions" WHERE "courseId" = $1 AND "status" = 'Submitted' GROUP BY "lessonId"`, params: [id] }),
      zite.sql({
        query: `SELECT ROUND("rating")::int AS "stars", COUNT(*) AS "ratingTotal" FROM "Enrollments"
                WHERE "courseId" = $1 AND "rating" > 0 AND ($2::int = 0 OR COALESCE("ratedAt", "completedAt", created_at) >= NOW() - ($2::int * INTERVAL '1 day'))
                GROUP BY ROUND("rating")::int`,
        params: [id, days],
      }),
      zite.sql({
        query: `SELECT e.id, e."rating", e."review", e."ratedAt", e."completedAt", p."name" AS "personName" FROM "Enrollments" e JOIN "People" p ON p.id::text = e."personId"
                WHERE e."courseId" = $1 AND e."rating" > 0 AND COALESCE(e."review", '') <> '' AND ($2::int = 0 OR COALESCE(e."ratedAt", e."completedAt", e.created_at) >= NOW() - ($2::int * INTERVAL '1 day'))
                ORDER BY COALESCE(e."ratedAt", e."completedAt") DESC NULLS LAST LIMIT 6`,
        params: [id, days],
      }),
      zite.sql({
        query: `SELECT pa.id, pa."title", pa."icon", pa."color", pa."status", pc."optional", pc."position",
                  (SELECT COUNT(*) FROM "PathCourses" x WHERE x."pathId" = pa.id::text) AS "courseTotal",
                  (SELECT COUNT(*) FROM "PathCourses" x WHERE x."pathId" = pa.id::text AND (COALESCE(x."position", 0) < COALESCE(pc."position", 0) OR (COALESCE(x."position", 0) = COALESCE(pc."position", 0) AND x.created_at < pc.created_at))) AS "beforeTotal"
                FROM "PathCourses" pc JOIN "Paths" pa ON pa.id::text = pc."pathId"
                WHERE pc."courseId" = $1
                ORDER BY CASE pa."status" WHEN 'Published' THEN 0 WHEN 'Draft' THEN 1 ELSE 2 END, LOWER(pa."title")`,
        params: [id],
      }),
      zite.sql({
        query: `SELECT r.*, pa.id AS "viaPathId", pa."title" AS "viaPathTitle" FROM "AssignmentRules" r
                LEFT JOIN "Paths" pa ON r."targetType" = 'Path' AND pa.id::text = r."pathId"
                WHERE COALESCE(r."status", '') <> 'Archived'
                  AND ((r."targetType" = 'Course' AND r."courseId" = $1)
                    OR (r."targetType" = 'Path' AND EXISTS (SELECT 1 FROM "PathCourses" pc WHERE pc."pathId" = r."pathId" AND pc."courseId" = $1)))
                ORDER BY CASE r."status" WHEN 'Active' THEN 0 ELSE 1 END, r.created_at ASC`,
        params: [id],
      }),
      zite.sql({
        query: `SELECT COUNT(*) FILTER (WHERE "startsAt" > NOW() AND COALESCE("status", '') <> 'Cancelled') AS "upcomingTotal",
                  MIN("startsAt") FILTER (WHERE "startsAt" > NOW() AND COALESCE("status", '') <> 'Cancelled') AS "nextStart"
                FROM "Sessions" WHERE "courseId" = $1`,
        params: [id],
      }),
      loadOutline(id),
    ]);

    const k = kpiRes.rows[0] ?? {};
    const enrolled = num(k.enrolledTotal);
    const completed = num(k.completedTotal);

    const durations = durationsRes.rows.map(r => num(r.seconds)).filter(s => s >= 0).sort((a, b) => a - b);
    const median = durations.length ? (durations.length % 2 ? durations[(durations.length - 1) / 2] : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2) : null;

    const dist = new Map(distRes.rows.map(r => [num(r.stars), num(r.ratingTotal)]));
    const ratingCount = [...dist.values()].reduce((a, b) => a + b, 0);
    const ratingSum = [...dist.entries()].reduce((a, [stars, n]) => a + stars * n, 0);

    const lessonStats = new Map(lessonRes.rows.map(r => [String(r.lessonId), r]));
    const quizStats = new Map(quizRes.rows.map(r => [String(r.lessonId), r]));
    const pending = new Map(pendingRes.rows.map(r => [String(r.lessonId), num(r.pendingTotal)]));
    const sectionTitle = new Map(outline.sections.map(s => [s.id, s.title]));

    const s = sessionsRes.rows[0] ?? {};

    return {
      courseId: id,
      range,
      kpis: {
        enrolled,
        notStarted: num(k.notStartedTotal),
        inProgress: num(k.inProgressTotal),
        completed,
        overdue: num(k.overdueTotal),
        completionRate: rate(completed, enrolled),
        onTimeRate: rate(num(k.onTimeTotal), completed),
        averageScore: k.scoreAverage != null ? Math.round(num(k.scoreAverage)) : null,
        medianDaysToComplete: median == null ? null : Math.round((median / 86_400) * 10) / 10,
        averageTimeSeconds: k.doneTimeAverage != null ? Math.round(num(k.doneTimeAverage)) : k.anyTimeAverage != null ? Math.round(num(k.anyTimeAverage)) : null,
        ratingAverage: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
        ratingCount,
      },
      weekly: weeklyRes.rows.map(r => ({ week: String(r.week), enrollments: num(r.enrolledTotal), completions: num(r.doneTotal) })),
      funnel: { enrolled, started: num(k.startedTotal), halfway: num(k.halfTotal), completed },
      lessons: outline.lessons.map(l => {
        const st = lessonStats.get(l.id);
        const q = quizStats.get(l.id);
        const reached = num(st?.reachedTotal);
        const done = num(st?.doneTotal);
        const firstTotal = num(q?.firstTotal);
        return {
          id: l.id,
          title: l.title,
          type: l.type,
          sectionId: l.sectionId,
          sectionTitle: l.sectionId ? sectionTitle.get(l.sectionId) ?? null : null,
          optional: l.optional,
          durationMinutes: l.durationMinutes,
          reached,
          completed: done,
          reachedRate: rate(reached, enrolled),
          completedRate: rate(done, enrolled),
          averageTimeSeconds: st?.timeAverage != null ? Math.round(num(st.timeAverage)) : null,
          quizAverage: l.type === 'Quiz' && st?.scoreAverage != null ? Math.round(num(st.scoreAverage)) : null,
          firstAttemptPassRate: l.type === 'Quiz' ? rate(num(q?.passTotal), firstTotal) : null,
          firstAttempts: firstTotal,
          pendingGrading: pending.get(l.id) ?? 0,
        };
      }),
      ratings: {
        distribution: [5, 4, 3, 2, 1].map(stars => ({ stars, count: dist.get(stars) ?? 0 })),
        reviews: reviewsRes.rows.map(r => ({ id: String(r.id), author: firstNameInitial(str(r.personName)), rating: num(r.rating), review: str(r.review) ?? '', ratedAt: iso(r.ratedAt) ?? iso(r.completedAt) })),
      },
      paths: pathsRes.rows.map(r => ({
        id: String(r.id),
        title: str(r.title) ?? '',
        icon: str(r.icon) ?? '',
        color: str(r.color) || '#2f6b55',
        status: str(r.status) || 'Draft',
        optional: bool(r.optional),
        step: num(r.beforeTotal) + 1,
        courseCount: num(r.courseTotal),
      })),
      rules: rulesRes.rows.map(r => ({
        id: String(r.id),
        name: str(r.name) ?? '',
        audience: str(r.audience) || 'Everyone',
        groupIds: parseIdList(r.groupIds),
        personCount: parseIdList(r.personIds).length,
        status: str(r.status) || 'Active',
        dueMode: str(r.dueMode) || 'None',
        dueDays: numOrNull(r.dueDays),
        dueDate: day(r.dueDate),
        recurrenceMonths: numOrNull(r.recurrenceMonths) || null,
        viaPath: r.targetType === 'Path' && ref(r.viaPathId) ? { id: String(r.viaPathId), title: str(r.viaPathTitle) ?? '' } : null,
      })),
      sessions: { upcoming: num(s.upcomingTotal), nextStartsAt: iso(s.nextStart) },
    };
  },
});
