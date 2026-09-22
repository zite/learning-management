import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseData } from '@project/shared/server/activity';
import { assertStaff, getActor } from '@project/shared/server/people';
import { iso, num, ref, str } from '@project/shared/server/sql';

/**
 * The admin Home: what needs doing today and how training is going this month.
 * Everything here links somewhere you can act — the grading queue, a course's
 * overdue learners, expiring certificates, tomorrow's sessions.
 */

export default createEndpoint({
  description: 'Load the admin home overview: attention items, headline numbers and recent completions',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    kpis: z.object({
      activeLearners30d: z.number(),
      activeLearnersPrev30d: z.number(),
      completions30d: z.number(),
      completionsPrev30d: z.number(),
      onTimeRate: z.number().nullable(),
      completions90d: z.number(),
      overdue: z.number(),
      overduePeople: z.number(),
      expiringCertificates: z.number(),
      stalled: z.number(),
    }),
    weekly: z.array(z.object({ week: z.string(), completions: z.number(), enrollments: z.number() })),
    overdueByCourse: z.array(z.object({ courseId: z.string(), overdue: z.number(), enrolled: z.number() })),
    toGrade: z.array(z.object({ id: z.string(), personName: z.string(), personColor: z.string(), lessonTitle: z.string(), courseId: z.string(), submittedAt: z.string().nullable() })),
    openQuestions: z.array(z.object({ id: z.string(), body: z.string(), personName: z.string(), personColor: z.string(), lessonTitle: z.string(), courseId: z.string(), lessonId: z.string(), postedAt: z.string().nullable() })),
    sessions: z.array(z.object({ id: z.string(), title: z.string(), startsAt: z.string().nullable(), location: z.string(), capacity: z.number().nullable(), registered: z.number(), courseId: z.string().nullable() })),
    recent: z.array(z.object({ id: z.string(), type: z.string(), personId: z.string().nullable(), personName: z.string(), personColor: z.string(), courseId: z.string().nullable(), pathId: z.string().nullable(), data: z.record(z.string(), z.any()), occurredAt: z.string().nullable() })),
  }),
  execute: async ({ context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const [kpiRes, weeklyRes, overdueRes, gradeRes, questionRes, sessionRes, recentRes] = await Promise.all([
      zite.sql({
        query: `SELECT
          (SELECT COUNT(DISTINCT "personId") FROM "LessonProgress" WHERE COALESCE("completedAt", "startedAt") >= NOW() - INTERVAL '30 days') AS "active30",
          (SELECT COUNT(DISTINCT "personId") FROM "LessonProgress" WHERE COALESCE("completedAt", "startedAt") >= NOW() - INTERVAL '60 days' AND COALESCE("completedAt", "startedAt") < NOW() - INTERVAL '30 days') AS "activePrev30",
          (SELECT COUNT(*) FROM "Enrollments" WHERE "status" = 'Completed' AND "completedAt" >= NOW() - INTERVAL '30 days') AS "done30",
          (SELECT COUNT(*) FROM "Enrollments" WHERE "status" = 'Completed' AND "completedAt" >= NOW() - INTERVAL '60 days' AND "completedAt" < NOW() - INTERVAL '30 days') AS "donePrev30",
          (SELECT COUNT(*) FILTER (WHERE "dueDate" IS NULL OR "completedAt"::date <= "dueDate") FROM "Enrollments" WHERE "status" = 'Completed' AND "completedAt" >= NOW() - INTERVAL '90 days') AS "onTime90",
          (SELECT COUNT(*) FROM "Enrollments" WHERE "status" = 'Completed' AND "completedAt" >= NOW() - INTERVAL '90 days') AS "done90",
          (SELECT COUNT(*) FROM "Enrollments" e JOIN "People" p ON p.id::text = e."personId" WHERE e."status" IN ('Not started', 'In progress') AND e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date AND COALESCE(p."status", '') <> 'Deactivated') AS "overdueTotal",
          (SELECT COUNT(DISTINCT e."personId") FROM "Enrollments" e JOIN "People" p ON p.id::text = e."personId" WHERE e."status" IN ('Not started', 'In progress') AND e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date AND COALESCE(p."status", '') <> 'Deactivated') AS "overduePeopleTotal",
          (SELECT COUNT(*) FROM "Certificates" WHERE "status" = 'Active' AND "expiresAt" > NOW() AND "expiresAt" <= NOW() + INTERVAL '30 days') AS "expiringTotal",
          (SELECT COUNT(*) FROM "Enrollments" WHERE "status" = 'In progress' AND COALESCE("lastActivityAt", "enrolledAt") < NOW() - INTERVAL '14 days') AS "stalledTotal"`,
        params: [],
      }),
      zite.sql({
        query: `SELECT to_char(w.week, 'YYYY-MM-DD') AS "week",
                  (SELECT COUNT(*) FROM "Enrollments" e WHERE e."status" = 'Completed' AND e."completedAt" >= w.week AND e."completedAt" < w.week + INTERVAL '7 days') AS "doneTotal",
                  (SELECT COUNT(*) FROM "Enrollments" e WHERE e."enrolledAt" >= w.week AND e."enrolledAt" < w.week + INTERVAL '7 days') AS "enrolledTotal"
                FROM generate_series(date_trunc('week', NOW()) - INTERVAL '11 weeks', date_trunc('week', NOW()), INTERVAL '7 days') AS w(week) ORDER BY w.week ASC`,
        params: [],
      }),
      zite.sql({
        query: `SELECT e."courseId", COUNT(*) FILTER (WHERE e."status" IN ('Not started', 'In progress') AND e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overdueTotal", COUNT(*) FILTER (WHERE COALESCE(e."status", '') <> 'Withdrawn') AS "enrolledTotal"
                FROM "Enrollments" e JOIN "People" p ON p.id::text = e."personId" WHERE COALESCE(p."status", '') <> 'Deactivated' GROUP BY e."courseId" HAVING COUNT(*) FILTER (WHERE e."status" IN ('Not started', 'In progress') AND e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) > 0 ORDER BY 2 DESC LIMIT 6`,
        params: [],
      }),
      zite.sql({
        // Scoped like the sidebar's "to grade" count: an instructor sees work in courses they own or teach (and unowned ones).
        query: `SELECT s.id, s."submittedAt", s."courseId", p."name" AS "personName", p."color" AS "personColor", l."title" AS "lessonTitle"
                FROM "Submissions" s JOIN "People" p ON p.id::text = s."personId" JOIN "Lessons" l ON l.id::text = s."lessonId" JOIN "Courses" c ON c.id::text = s."courseId"
                WHERE s."status" = 'Submitted' AND ($2::text = 'Admin' OR COALESCE(c."ownerId", '') IN ('', $1::text) OR COALESCE(c."instructorIds", '') LIKE '%' || $1::text || '%')
                ORDER BY s."submittedAt" ASC NULLS LAST LIMIT 5`,
        params: [actor.id, actor.role],
      }),
      zite.sql({
        query: `SELECT q.id, q."body", q."postedAt", q."courseId", q."lessonId", p."name" AS "personName", p."color" AS "personColor", l."title" AS "lessonTitle" FROM "Comments" q JOIN "People" p ON p.id::text = q."personId" JOIN "Lessons" l ON l.id::text = q."lessonId"
                WHERE COALESCE(q."parentId", '') = '' AND q."resolvedAt" IS NULL AND p."role" = 'Learner'
                  AND NOT EXISTS (SELECT 1 FROM "Comments" r JOIN "People" rp ON rp.id::text = r."personId" WHERE r."parentId" = q.id::text AND rp."role" IN ('Admin', 'Instructor'))
                ORDER BY q."postedAt" DESC NULLS LAST LIMIT 4`,
        params: [],
      }),
      zite.sql({
        query: `SELECT s.id, s."title", s."startsAt", s."location", s."capacity", s."courseId", (SELECT COUNT(*) FROM "Registrations" r WHERE r."sessionId" = s.id::text AND r."status" IN ('Registered', 'Attended')) AS "registeredTotal"
                FROM "Sessions" s WHERE COALESCE(s."status", '') <> 'Cancelled' AND s."startsAt" > NOW() - INTERVAL '2 hours' ORDER BY s."startsAt" ASC LIMIT 4`,
        params: [],
      }),
      zite.sql({
        query: `SELECT a.id, a."type", a."personId", a."courseId", a."pathId", a."data", a."occurredAt", p."name" AS "personName", p."color" AS "personColor" FROM "Activity" a JOIN "People" p ON p.id::text = a."personId"
                WHERE a."type" IN ('course_completed', 'path_completed', 'certificate_issued') AND a."occurredAt" <= NOW() ORDER BY a."occurredAt" DESC LIMIT 24`,
        params: [],
      }),
    ]);
    const k = kpiRes.rows[0] ?? {};
    return {
      kpis: {
        activeLearners30d: num(k.active30),
        activeLearnersPrev30d: num(k.activePrev30),
        completions30d: num(k.done30),
        completionsPrev30d: num(k.donePrev30),
        onTimeRate: num(k.done90) ? Math.round((num(k.onTime90) / num(k.done90)) * 100) : null,
        completions90d: num(k.done90),
        overdue: num(k.overdueTotal),
        overduePeople: num(k.overduePeopleTotal),
        expiringCertificates: num(k.expiringTotal),
        stalled: num(k.stalledTotal),
      },
      weekly: weeklyRes.rows.map(r => ({ week: str(r.week) ?? '', completions: num(r.doneTotal), enrollments: num(r.enrolledTotal) })),
      overdueByCourse: overdueRes.rows.map(r => ({ courseId: String(r.courseId), overdue: num(r.overdueTotal), enrolled: num(r.enrolledTotal) })),
      toGrade: gradeRes.rows.map(r => ({ id: String(r.id), personName: str(r.personName) ?? '', personColor: str(r.personColor) || '#8b8d98', lessonTitle: str(r.lessonTitle) ?? '', courseId: String(r.courseId), submittedAt: iso(r.submittedAt) })),
      openQuestions: questionRes.rows.map(r => ({ id: String(r.id), body: str(r.body) ?? '', personName: str(r.personName) ?? '', personColor: str(r.personColor) || '#8b8d98', lessonTitle: str(r.lessonTitle) ?? '', courseId: String(r.courseId), lessonId: String(r.lessonId), postedAt: iso(r.postedAt) })),
      sessions: sessionRes.rows.map(r => ({ id: String(r.id), title: str(r.title) ?? '', startsAt: iso(r.startsAt), location: str(r.location) ?? '', capacity: r.capacity == null || r.capacity === '' ? null : num(r.capacity), registered: num(r.registeredTotal), courseId: ref(r.courseId) })),
      recent: recentRes.rows.map(r => ({ id: String(r.id), type: str(r.type) ?? '', personId: ref(r.personId), personName: str(r.personName) ?? '', personColor: str(r.personColor) || '#8b8d98', courseId: ref(r.courseId), pathId: ref(r.pathId), data: parseData(r.data), occurredAt: iso(r.occurredAt) })),
    };
  },
});
