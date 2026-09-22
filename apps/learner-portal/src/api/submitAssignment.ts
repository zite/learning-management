import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseAssignmentSettings } from '@project/shared/lessons';
import { logActivity } from '@project/shared/server/activity';
import { touchLesson } from '@project/shared/server/enroll';
import { notify } from '@project/shared/server/notify';
import { courseStaffIds } from '@project/shared/server/people';
import { num, withRetry } from '@project/shared/server/sql';
import { loadLessonRecord, loadPlayer, parseFiles, requireOpenLesson } from '../server/player';

/**
 * Hand in an assignment for grading. One submission waits for review at a
 * time; after "Needs revision" the learner submits again as the next attempt,
 * and once it's passed there's nothing more to hand in. The course's staff
 * hear about it in their inbox.
 */

const FileInput = z.object({ name: z.string().min(1).max(200), url: z.string().url().max(2000), size: z.number().min(0).max(1e10), type: z.string().max(120) });

const Input = z.object({
  lessonId: z.string().min(1).max(100),
  courseSlug: z.string().min(1).max(200),
  body: z.string().max(20000),
  files: z.array(FileInput).max(10),
});

const Output = z.object({
  submission: z.object({ id: z.string(), attempt: z.number(), status: z.string(), body: z.string(), files: z.array(FileInput), submittedAt: z.string() }),
});

export default createEndpoint({
  description: 'Submit an assignment for grading as the signed-in learner',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue?.path.includes('files')) throw new ZiteError(issue.code === 'too_big' ? 'Attach up to 10 files.' : 'One of the files didn’t upload properly. Remove it and add it again.', 'BAD_REQUEST');
      if (issue?.path.includes('body')) throw new ZiteError('Your answer is too long — keep it under 20,000 characters.', 'BAD_REQUEST');
      throw new ZiteError("Your submission couldn't be read. Reload the page and try again.", 'BAD_REQUEST');
    }
    const { lessonId, courseSlug } = parsed.data;
    const body = parsed.data.body.trim();
    const files = parsed.data.files.filter(f => /^https?:\/\//i.test(f.url));
    const ctx = await loadPlayer(context, courseSlug);
    const outline = requireOpenLesson(ctx, lessonId);
    if (outline.type !== 'Assignment') throw new ZiteError("That lesson isn't an assignment.", 'BAD_REQUEST');
    const enrollment = ctx.enrollment!;
    const lesson = await loadLessonRecord(lessonId, ctx.course.id);
    const settings = parseAssignmentSettings(lesson.settings);

    if (settings.submissionType !== 'file' && !body) throw new ZiteError('Write your answer before submitting.', 'BAD_REQUEST');
    if (settings.submissionType !== 'text' && !files.length) throw new ZiteError('Attach at least one file before submitting.', 'BAD_REQUEST');

    const { rows } = await zite.sql({
      query: `SELECT "attempt", "status" FROM "Submissions" WHERE "enrollmentId" = $1 AND "lessonId" = $2 AND "personId" = $3`,
      params: [enrollment.id, lessonId, ctx.actor.id],
    });
    if (rows.some(r => r.status === 'Submitted')) throw new ZiteError('Your last submission is still waiting for review. You can submit again if it needs revision.', 'CONFLICT');
    if (rows.some(r => r.status === 'Passed') || ctx.progress.get(lessonId)?.status === 'Completed') throw new ZiteError('You’ve already passed this assignment.', 'CONFLICT');

    const attempt = Math.max(rows.length, ...rows.map(r => num(r.attempt))) + 1;
    const submittedAt = new Date().toISOString();
    const stored = settings.submissionType === 'file' ? '' : body;
    const storedFiles = settings.submissionType === 'text' ? [] : files;
    const created = await withRetry(() =>
      zite.submissions.create({
        record: { enrollmentId: enrollment.id, personId: ctx.actor.id, courseId: ctx.course.id, lessonId, attempt, body: stored, files: JSON.stringify(storedFiles), status: 'Submitted', grade: null, feedback: null, gradedById: null, submittedAt, gradedAt: null },
      }),
    );

    await withRetry(() => touchLesson({ enrollment, lessonId }));
    await logActivity({ type: 'assignment_submitted', personId: ctx.actor.id, actorId: ctx.actor.id, courseId: ctx.course.id, lessonId, enrollmentId: enrollment.id, data: { attempt, lessonTitle: lesson.title, submissionId: created.id } });
    await withRetry(async () =>
      notify({
        recipientIds: await courseStaffIds(ctx.course.id),
        app: 'Admin',
        type: 'submission_received',
        title: `${ctx.actor.name} submitted “${lesson.title}”${attempt > 1 ? ` (attempt ${attempt})` : ''}`,
        body: `${ctx.course.title} · ready to grade`,
        courseId: ctx.course.id,
        actorId: ctx.actor.id,
        link: `/grading/${created.id}`,
      }),
    );

    // Re-read through the same parser the lesson view uses.
    return { submission: { id: created.id, attempt, status: 'Submitted', body: stored, files: parseFiles(JSON.stringify(storedFiles)), submittedAt } };
  },
});
