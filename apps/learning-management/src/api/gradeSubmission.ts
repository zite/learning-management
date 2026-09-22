import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { loadCourse } from '@project/shared/server/courses';
import { emailPerson } from '@project/shared/server/email';
import { completeLesson, loadEnrollment } from '@project/shared/server/enroll';
import { notify } from '@project/shared/server/notify';
import { assertStaff, canEditCourse, getActor } from '@project/shared/server/people';
import { getSettings, learnLink } from '@project/shared/server/settings';
import { bool, iso, ref, str, withRetry } from '@project/shared/server/sql';
import { asSubmissionStatus, queueFiltersSchema, queueIds } from '../server/grading';

/**
 * Grade an assignment submission.
 *
 * Passing completes the assignment lesson through the engine (which moves the
 * enrollment on and may finish the course and issue its certificate). "Needs
 * revision" sends it back: the learner resubmits as a new attempt.
 *
 * Regrading is allowed where it can't contradict what already happened: a
 * "Needs revision" can become a pass (or get new feedback) until the learner
 * resubmits, and a pass can have its grade or feedback corrected — but a pass
 * can't be sent back for revision, because the lesson is already complete.
 */

const Input = z.object({
  id: z.string().min(1),
  grade: z.number({ invalid_type_error: 'Enter a grade from 0 to 100' }).min(0, 'Grades run from 0 to 100').max(100, 'Grades run from 0 to 100'),
  feedback: z.string().max(10000, 'Keep feedback under 10,000 characters').default(''),
  outcome: z.enum(['Passed', 'Needs revision']),
  queue: queueFiltersSchema.optional(),
});

const Output = z.object({
  id: z.string(),
  status: z.enum(['Passed', 'Needs revision']),
  grade: z.number(),
  gradedAt: z.string(),
  regraded: z.boolean(),
  lessonCompleted: z.boolean(),
  courseCompleted: z.boolean(),
  enrollment: z.object({ id: z.string(), status: z.string(), progress: z.number() }).nullable(),
  nextId: z.string().nullable(),
});

export default createEndpoint({
  description: 'Grade an assignment submission as passed or needing revision, completing the lesson on a pass',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Check the grade and try again', 'BAD_REQUEST');
    const { id, outcome, queue } = parsed.data;
    const grade = Math.round(parsed.data.grade);
    const feedback = parsed.data.feedback.trim();

    const { rows } = await zite.sql({
      query: `SELECT s.*, p."name" AS "personName", p."email" AS "personEmail", p."muteEmails" AS "personMute", l."title" AS "lessonTitle", l.id AS "lessonRowId"
              FROM "Submissions" s LEFT JOIN "People" p ON p.id::text = s."personId" LEFT JOIN "Lessons" l ON l.id::text = s."lessonId"
              WHERE s.id::text = $1`,
      params: [id],
    });
    const s = rows[0];
    if (!s) throw new ZiteError('That submission no longer exists', 'NOT_FOUND');
    const course = await loadCourse(String(s.courseId ?? ''));
    if (!course) throw new ZiteError('The course for this submission no longer exists', 'NOT_FOUND');
    assertStaff(actor);
    if (!canEditCourse(actor, course)) throw new ZiteError(`Only the course owner, its instructors or an admin can grade work in “${course.title}”`, 'FORBIDDEN');

    const previous = asSubmissionStatus(s.status);
    const personName = str(s.personName) || 'The learner';
    const lessonTitle = str(s.lessonTitle) || 'this assignment';
    if (outcome === 'Needs revision' && !feedback) throw new ZiteError(`Add feedback so ${personName.split(' ')[0]} knows what to change`, 'BAD_REQUEST');

    if (previous !== 'Submitted') {
      const { rows: later } = await zite.sql({
        query: `SELECT id, "attempt" FROM "Submissions" WHERE "personId" = $1 AND "lessonId" = $2 AND id::text <> $3 AND (COALESCE("attempt", 1) > $4::int OR (COALESCE("attempt", 1) = $4::int AND "submittedAt" > $5::timestamptz)) LIMIT 1`,
        params: [String(s.personId), String(s.lessonId), id, Number(s.attempt) || 1, iso(s.submittedAt) ?? new Date(0).toISOString()],
      });
      if (later[0]) throw new ZiteError(`${personName} has already resubmitted this assignment. Grade attempt ${Number(later[0].attempt) || 2} instead.`, 'CONFLICT');
      if (previous === 'Passed' && outcome === 'Needs revision') {
        throw new ZiteError('This submission already passed and the lesson is complete, so it can’t be sent back for revision. You can still change the grade or feedback.', 'CONFLICT');
      }
    }

    const before = queue ? await queueIds(actor, queue) : [];
    const now = new Date().toISOString();
    // Live Zite rate-limits bursts of writes; each write here retries rather than failing the grade halfway.
    await withRetry(() => zite.submissions.update({ id, record: { status: outcome, grade, feedback: feedback || null, gradedById: actor.id, gradedAt: now } }));
    const regraded = previous !== 'Submitted';

    // A pass completes the lesson — unless the learner was withdrawn meanwhile, when the grade stands on its own.
    // Correcting an existing pass leaves lesson progress alone: it was completed when it first passed.
    let lessonCompleted = false;
    let courseCompleted = false;
    let enrollment: z.infer<typeof Output>['enrollment'] = null;
    const settings = await getSettings();
    const enrollmentId = ref(s.enrollmentId);
    const e = enrollmentId ? await loadEnrollment(enrollmentId) : null;
    if (e) enrollment = { id: e.id, status: e.status, progress: e.progress };
    if (outcome === 'Passed' && previous !== 'Passed' && e && e.status !== 'Withdrawn' && s.lessonRowId) {
      const res = await withRetry(() => completeLesson({ enrollment: e, lessonId: String(s.lessonId), score: grade, actorId: actor.id, settings, occurredAt: now }));
      lessonCompleted = true;
      courseCompleted = res.completedNow;
      enrollment = { id: e.id, status: res.status, progress: res.progress };
    }

    await withRetry(() => logActivity({
      type: 'assignment_graded',
      personId: String(s.personId),
      actorId: actor.id,
      courseId: course.id,
      lessonId: String(s.lessonId),
      enrollmentId,
      occurredAt: now,
      data: { grade, status: outcome, attempt: Number(s.attempt) || 1, lessonTitle, ...(regraded ? { previousStatus: previous, previousGrade: s.grade == null || s.grade === '' ? null : Number(s.grade) } : {}) },
    }));

    const learnPath = `/learn/${course.slug || course.id}/${String(s.lessonId)}`;
    const verdict = outcome === 'Passed' ? `Passed with ${grade}` : 'Needs another look';
    await withRetry(() => notify({
      recipientIds: [String(s.personId)],
      app: 'Learn',
      type: 'submission_graded',
      title: regraded && previous === outcome ? `Your grade for “${lessonTitle}” was updated` : outcome === 'Passed' ? `“${lessonTitle}” passed` : `“${lessonTitle}” needs revision`,
      body: feedback ? `${verdict} · ${feedback.replace(/\s+/g, ' ').slice(0, 280)}` : verdict,
      courseId: course.id,
      actorId: actor.id,
      link: learnPath,
      occurredAt: now,
    }));

    // Email when the outcome is news; a corrected grade or note is an in-app update only.
    if (previous !== outcome && s.personEmail) {
      await emailPerson({
        trigger: 'Submission graded',
        settings,
        person: { email: String(s.personEmail), name: str(s.personName), muteEmails: bool(s.personMute) },
        context: { lesson_title: lessonTitle, course_title: course.title, grade: String(grade), feedback: feedback || 'No written feedback.', course_link: learnLink(settings, learnPath) },
        link: learnLink(settings, learnPath),
        buttonLabel: outcome === 'Passed' ? 'Continue the course' : 'Revise your submission',
      });
    }

    let nextId: string | null = null;
    if (queue) {
      // "Next" is whatever followed this item in the queue as it was, if it's still waiting; otherwise the nearest one left.
      const after = await queueIds(actor, queue);
      const remaining = new Set(after.filter(x => x !== id));
      const i = before.indexOf(id);
      if (i >= 0) nextId = before.slice(i + 1).find(x => remaining.has(x)) ?? [...before.slice(0, i)].reverse().find(x => remaining.has(x)) ?? null;
      if (!nextId) nextId = after.find(x => x !== id) ?? null;
    }

    return { id, status: outcome, grade, gradedAt: now, regraded, lessonCompleted, courseCompleted, enrollment, nextId };
  },
});
