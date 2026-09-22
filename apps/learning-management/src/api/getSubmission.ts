import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseAssignmentSettings } from '@project/shared/lessons';
import { assertStaff, canEditCourse, getActor } from '@project/shared/server/people';
import { day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { asSubmissionStatus, parseFiles, queueFiltersSchema, queueIds, SUBMISSION_STATUSES } from '../server/grading';

/**
 * One submission with everything a grader needs beside it: the assignment's
 * instructions and private rubric, the learner and their enrollment, earlier
 * attempts with the feedback they already got, and where it sits in the queue.
 */

const Input = z.object({ id: z.string().min(1), queue: queueFiltersSchema.optional() });

const attemptSchema = z.object({
  id: z.string(),
  attempt: z.number(),
  status: z.enum(SUBMISSION_STATUSES),
  grade: z.number().nullable(),
  feedback: z.string(),
  submittedAt: z.string().nullable(),
  gradedAt: z.string().nullable(),
  gradedByName: z.string().nullable(),
  current: z.boolean(),
});

const Output = z.object({
  submission: z.object({
    id: z.string(),
    attempt: z.number(),
    status: z.enum(SUBMISSION_STATUSES),
    grade: z.number().nullable(),
    feedback: z.string(),
    body: z.string(),
    files: z.array(z.object({ name: z.string(), url: z.string(), size: z.number(), type: z.string() })),
    submittedAt: z.string().nullable(),
    gradedAt: z.string().nullable(),
    gradedById: z.string().nullable(),
    gradedByName: z.string().nullable(),
    enrollmentId: z.string().nullable(),
    /** A later attempt by the same learner on this lesson, if they resubmitted. */
    supersededById: z.string().nullable(),
  }),
  lesson: z.object({
    id: z.string(),
    title: z.string(),
    exists: z.boolean(),
    instructions: z.string(),
    submissionType: z.enum(['text', 'file', 'text_and_file']),
    passingGrade: z.number(),
    rubric: z.string(),
  }),
  course: z.object({ id: z.string(), title: z.string(), slug: z.string(), icon: z.string(), color: z.string() }),
  learner: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    title: z.string().nullable(),
    color: z.string(),
    avatarUrl: z.string().nullable(),
    status: z.string(),
    managerId: z.string().nullable(),
    managerName: z.string().nullable(),
  }),
  attempts: z.array(attemptSchema),
  enrollment: z.object({ id: z.string(), status: z.string(), progress: z.number(), dueDate: z.string().nullable(), cycle: z.number(), completedAt: z.string().nullable() }).nullable(),
  queue: z.object({ index: z.number(), total: z.number(), prevId: z.string().nullable(), nextId: z.string().nullable() }),
  canGrade: z.boolean(),
});

export default createEndpoint({
  description: 'Load one assignment submission with its lesson, rubric, learner, earlier attempts and queue position',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which submission?', 'BAD_REQUEST');
    const { id } = parsed.data;

    const { rows } = await zite.sql({
      query: `SELECT s.*, g."name" AS "gradedByName",
                c."title" AS "courseTitle", c."slug" AS "courseSlug", c."icon" AS "courseIcon", c."color" AS "courseColor", c."ownerId" AS "courseOwnerId", c."instructorIds" AS "courseInstructorIds",
                l.id AS "lessonRowId", l."title" AS "lessonTitle", l."body" AS "lessonBody", l."settings" AS "lessonSettings",
                p."name" AS "personName", p."email" AS "personEmail", p."title" AS "personTitle", p."color" AS "personColor", p."avatarUrl" AS "personAvatarUrl", p."status" AS "personStatus", p."managerId" AS "personManagerId",
                m."name" AS "managerName"
              FROM "Submissions" s
              LEFT JOIN "People" g ON g.id::text = s."gradedById"
              LEFT JOIN "Courses" c ON c.id::text = s."courseId"
              LEFT JOIN "Lessons" l ON l.id::text = s."lessonId"
              LEFT JOIN "People" p ON p.id::text = s."personId"
              LEFT JOIN "People" m ON m.id::text = p."managerId"
              WHERE s.id::text = $1`,
      params: [id],
    });
    const r = rows[0];
    if (!r) throw new ZiteError('That submission no longer exists', 'NOT_FOUND');

    const personId = String(r.personId ?? '');
    const lessonId = String(r.lessonId ?? '');
    const enrollmentId = ref(r.enrollmentId);
    const settings = parseAssignmentSettings(r.lessonSettings);

    const [attemptsRes, enrollmentRes, ids] = await Promise.all([
      zite.sql({
        query: `SELECT s.id, s."attempt", s."status", s."grade", s."feedback", s."submittedAt", s."gradedAt", g."name" AS "gradedByName"
                FROM "Submissions" s LEFT JOIN "People" g ON g.id::text = s."gradedById"
                WHERE s."personId" = $1 AND s."lessonId" = $2 ORDER BY COALESCE(s."attempt", 1) ASC, s."submittedAt" ASC NULLS LAST`,
        params: [personId, lessonId],
      }),
      enrollmentId
        ? zite.sql({ query: `SELECT id, "status", "progress", "dueDate", "cycle", "completedAt" FROM "Enrollments" WHERE id::text = $1`, params: [enrollmentId] })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      parsed.data.queue ? queueIds(actor, parsed.data.queue) : Promise.resolve([] as string[]),
    ]);

    const attempts = attemptsRes.rows.map(a => ({
      id: String(a.id),
      attempt: num(a.attempt, 1) || 1,
      status: asSubmissionStatus(a.status),
      grade: numOrNull(a.grade),
      feedback: str(a.feedback) ?? '',
      submittedAt: iso(a.submittedAt),
      gradedAt: iso(a.gradedAt),
      gradedByName: ref(a.gradedByName),
      current: String(a.id) === String(r.id),
    }));
    const currentIndex = attempts.findIndex(a => a.current);
    const later = currentIndex >= 0 ? attempts.slice(currentIndex + 1) : [];

    const index = ids.indexOf(String(r.id));
    const e = enrollmentRes.rows[0];

    return {
      submission: {
        id: String(r.id),
        attempt: num(r.attempt, 1) || 1,
        status: asSubmissionStatus(r.status),
        grade: numOrNull(r.grade),
        feedback: str(r.feedback) ?? '',
        body: str(r.body) ?? '',
        files: parseFiles(r.files),
        submittedAt: iso(r.submittedAt),
        gradedAt: iso(r.gradedAt),
        gradedById: ref(r.gradedById),
        gradedByName: ref(r.gradedByName),
        enrollmentId,
        supersededById: later.length ? later[later.length - 1].id : null,
      },
      lesson: {
        id: lessonId,
        title: str(r.lessonTitle) || 'Deleted lesson',
        exists: Boolean(r.lessonRowId),
        instructions: str(r.lessonBody) ?? '',
        submissionType: settings.submissionType,
        passingGrade: settings.passingGrade,
        rubric: settings.rubric,
      },
      course: { id: String(r.courseId ?? ''), title: str(r.courseTitle) || 'Deleted course', slug: str(r.courseSlug) ?? '', icon: str(r.courseIcon) ?? '', color: str(r.courseColor) || '#2f6b55' },
      learner: {
        id: personId,
        name: str(r.personName) || 'Unknown learner',
        email: str(r.personEmail) ?? '',
        title: ref(r.personTitle),
        color: str(r.personColor) || '#8b8d98',
        avatarUrl: ref(r.personAvatarUrl),
        status: str(r.personStatus) || 'Active',
        managerId: ref(r.personManagerId),
        managerName: ref(r.managerName),
      },
      attempts,
      enrollment: e ? { id: String(e.id), status: str(e.status) || 'Not started', progress: num(e.progress), dueDate: day(e.dueDate), cycle: num(e.cycle, 1) || 1, completedAt: iso(e.completedAt) } : null,
      queue: {
        index,
        total: ids.length,
        prevId: index > 0 ? ids[index - 1] : null,
        nextId: index >= 0 ? ids[index + 1] ?? null : ids.find(x => x !== String(r.id)) ?? null,
      },
      canGrade: Boolean(r.courseId) && canEditCourse(actor, { ownerId: ref(r.courseOwnerId), instructorIds: r.courseInstructorIds }),
    };
  },
});
