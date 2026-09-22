import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { loadCourse, loadOutline } from '@project/shared/server/courses';
import { assertStaff, getActor } from '@project/shared/server/people';
import { parseData } from '@project/shared/server/activity';
import { day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { mapEnrollmentRow, enrollmentRowSchema } from '../server/enrollments';

/**
 * One learner's enrollment in detail: every lesson with its status, time and
 * score, quiz attempts, assignment submissions, certificate, earlier cycles
 * and the activity trail. Powers the enrollment peek anywhere in the app.
 */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Load one enrollment with lesson progress, attempts, submissions and history',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    enrollment: enrollmentRowSchema,
    course: z.object({ id: z.string(), title: z.string(), slug: z.string(), sequential: z.boolean(), certificateEnabled: z.boolean() }),
    lessons: z.array(z.object({
      id: z.string(), title: z.string(), type: z.string(), sectionId: z.string().nullable(), optional: z.boolean(), durationMinutes: z.number(),
      status: z.enum(['Not started', 'In progress', 'Completed']), startedAt: z.string().nullable(), completedAt: z.string().nullable(), timeSpentSeconds: z.number(), score: z.number().nullable(), attempts: z.number(),
    })),
    sections: z.array(z.object({ id: z.string(), title: z.string() })),
    attempts: z.array(z.object({ id: z.string(), lessonId: z.string(), number: z.number(), score: z.number(), passed: z.boolean(), submittedAt: z.string().nullable() })),
    submissions: z.array(z.object({ id: z.string(), lessonId: z.string(), attempt: z.number(), status: z.string(), grade: z.number().nullable(), feedback: z.string(), submittedAt: z.string().nullable(), gradedAt: z.string().nullable(), gradedByName: z.string().nullable() })),
    certificate: z.object({ id: z.string(), credentialId: z.string(), issuedAt: z.string().nullable(), expiresAt: z.string().nullable(), status: z.string() }).nullable(),
    path: z.object({ id: z.string(), title: z.string(), status: z.string(), progress: z.number() }).nullable(),
    cycles: z.array(z.object({ id: z.string(), cycle: z.number(), status: z.string(), completedAt: z.string().nullable(), dueDate: z.string().nullable() })),
    activity: z.array(z.object({ id: z.string(), type: z.string(), actorId: z.string().nullable(), actorName: z.string().nullable(), lessonId: z.string().nullable(), data: z.record(z.string(), z.any()), occurredAt: z.string().nullable() })),
  }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which enrollment?', 'BAD_REQUEST');
    const { rows } = await zite.sql({
      query: `SELECT e.*, pp."name" AS "personName", pp."email" AS "personEmail", pp."color" AS "personColor", pp."avatarUrl" AS "personAvatarUrl", pp."title" AS "personTitle", pp."status" AS "personStatus", pp."managerId" AS "managerId", ab."name" AS "assignedByName"
              FROM "Enrollments" e JOIN "People" pp ON pp.id::text = e."personId" LEFT JOIN "People" ab ON ab.id::text = e."assignedById" WHERE e.id::text = $1`,
      params: [parsed.data.id],
    });
    if (!rows[0]) throw new ZiteError('That enrollment no longer exists', 'NOT_FOUND');
    const enrollment = mapEnrollmentRow(rows[0]);
    const course = await loadCourse(enrollment.courseId);
    if (!course) throw new ZiteError('That course no longer exists', 'NOT_FOUND');

    const [outline, progressRes, attemptsRes, submissionsRes, certRes, pathRes, cyclesRes, activityRes] = await Promise.all([
      loadOutline(course.id),
      zite.sql({ query: `SELECT * FROM "LessonProgress" WHERE "enrollmentId" = $1`, params: [enrollment.id] }),
      zite.sql({ query: `SELECT id, "lessonId", "number", "score", "passed", "submittedAt" FROM "QuizAttempts" WHERE "enrollmentId" = $1 ORDER BY "submittedAt" ASC NULLS LAST`, params: [enrollment.id] }),
      zite.sql({
        query: `SELECT s.id, s."lessonId", s."attempt", s."status", s."grade", s."feedback", s."submittedAt", s."gradedAt", g."name" AS "gradedByName" FROM "Submissions" s LEFT JOIN "People" g ON g.id::text = s."gradedById" WHERE s."enrollmentId" = $1 ORDER BY s."submittedAt" ASC NULLS LAST`,
        params: [enrollment.id],
      }),
      enrollment.certificateId ? zite.sql({ query: `SELECT id, "credentialId", "issuedAt", "expiresAt", "status" FROM "Certificates" WHERE id::text = $1`, params: [enrollment.certificateId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      enrollment.pathEnrollmentId
        ? zite.sql({ query: `SELECT p.id, p."title", pe."status", pe."progress" FROM "PathEnrollments" pe JOIN "Paths" p ON p.id::text = pe."pathId" WHERE pe.id::text = $1`, params: [enrollment.pathEnrollmentId] })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      zite.sql({ query: `SELECT id, "cycle", "status", "completedAt", "dueDate" FROM "Enrollments" WHERE "personId" = $1 AND "courseId" = $2 ORDER BY COALESCE("cycle", 1) DESC, created_at DESC`, params: [enrollment.personId, course.id] }),
      zite.sql({
        query: `SELECT a.id, a."type", a."actorId", a."lessonId", a."data", a."occurredAt", p."name" AS "actorName" FROM "Activity" a LEFT JOIN "People" p ON p.id::text = a."actorId"
                WHERE a."enrollmentId" = $1 OR (a."personId" = $2 AND a."courseId" = $3 AND COALESCE(a."enrollmentId", '') = '') ORDER BY a."occurredAt" DESC NULLS LAST LIMIT 100`,
        params: [enrollment.id, enrollment.personId, course.id],
      }),
    ]);
    const progress = new Map(progressRes.rows.map(r => [String(r.lessonId), r]));
    const cert = certRes.rows[0];
    const path = pathRes.rows[0];

    return {
      enrollment,
      course: { id: course.id, title: course.title, slug: course.slug, sequential: course.sequential, certificateEnabled: course.certificateEnabled },
      sections: outline.sections.map(s => ({ id: s.id, title: s.title })),
      lessons: outline.lessons.map(l => {
        const p = progress.get(l.id);
        return {
          id: l.id,
          title: l.title,
          type: l.type,
          sectionId: l.sectionId,
          optional: l.optional,
          durationMinutes: l.durationMinutes,
          status: p?.status === 'Completed' ? ('Completed' as const) : p ? ('In progress' as const) : ('Not started' as const),
          startedAt: iso(p?.startedAt),
          completedAt: iso(p?.completedAt),
          timeSpentSeconds: num(p?.timeSpentSeconds),
          score: numOrNull(p?.score),
          attempts: num(p?.attempts),
        };
      }),
      attempts: attemptsRes.rows.map(a => ({ id: String(a.id), lessonId: String(a.lessonId), number: num(a.number, 1), score: num(a.score), passed: a.passed === true, submittedAt: iso(a.submittedAt) })),
      submissions: submissionsRes.rows.map(s => ({ id: String(s.id), lessonId: String(s.lessonId), attempt: num(s.attempt, 1), status: str(s.status) || 'Submitted', grade: numOrNull(s.grade), feedback: str(s.feedback) ?? '', submittedAt: iso(s.submittedAt), gradedAt: iso(s.gradedAt), gradedByName: ref(s.gradedByName) })),
      certificate: cert ? { id: String(cert.id), credentialId: str(cert.credentialId) ?? '', issuedAt: iso(cert.issuedAt), expiresAt: iso(cert.expiresAt), status: str(cert.status) || 'Active' } : null,
      path: path ? { id: String(path.id), title: str(path.title) ?? '', status: str(path.status) || 'Not started', progress: num(path.progress) } : null,
      cycles: cyclesRes.rows.map(c => ({ id: String(c.id), cycle: num(c.cycle, 1) || 1, status: str(c.status) || 'Not started', completedAt: iso(c.completedAt), dueDate: day(c.dueDate) })),
      activity: activityRes.rows.map(a => ({ id: String(a.id), type: str(a.type) ?? '', actorId: ref(a.actorId), actorName: ref(a.actorName), lessonId: ref(a.lessonId), data: parseData(a.data), occurredAt: iso(a.occurredAt) })),
    };
  },
});
