import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { gradeQuiz, mayRevealAnswers, parseAnswers, parseQuizSettings, type QuizAnswers } from '@project/shared/lessons';
import { logActivity } from '@project/shared/server/activity';
import { completeLesson as completeLessonForEnrollment, recomputeEnrollment, touchLesson } from '@project/shared/server/enroll';
import { bool, num, withRetry } from '@project/shared/server/sql';
import { buildReview, certificateSummary, completedSet, loadLessonRecord, loadPlayer, loadProgress, lockFor, nextLessonAfter, requireOpenLesson } from '../server/player';

/**
 * Grade a quiz attempt on the server. The learner's answers are checked
 * against the real key here (the client never had it), the attempt is kept
 * for the record, and a pass completes the lesson with the best score.
 * Correct answers come back only when the quiz's reveal rule allows.
 */

const GRACE_MS = 30_000;

const Input = z.object({
  lessonId: z.string().min(1).max(100),
  courseSlug: z.string().min(1).max(200),
  answers: z.record(z.string().max(60), z.union([z.string().max(1000), z.array(z.string().max(60)).max(50)])),
  startedAt: z.string().max(40).optional(),
});

const Output = z.object({
  attempt: z.object({ number: z.number(), score: z.number(), passed: z.boolean(), submittedAt: z.string() }),
  score: z.number(),
  passed: z.boolean(),
  passingScore: z.number(),
  earned: z.number(),
  total: z.number(),
  attemptsLeft: z.number().nullable(),
  bestScore: z.number(),
  review: z.array(z.object({ id: z.string(), correct: z.boolean(), selected: z.array(z.string()), answerText: z.string(), correctOptionIds: z.array(z.string()), acceptedAnswers: z.array(z.string()), explanation: z.string() })).nullable(),
  progress: z.number(),
  status: z.string(),
  completedNow: z.boolean(),
  certificateId: z.string().nullable(),
  certificate: z.object({ id: z.string(), credentialId: z.string(), issuedAt: z.string().nullable(), expiresAt: z.string().nullable(), status: z.string(), title: z.string(), recipientName: z.string() }).nullable(),
  nextLessonId: z.string().nullable(),
});

export default createEndpoint({
  description: 'Submit and grade a quiz attempt for the signed-in learner',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError("Your answers couldn't be read. Reload the page and try again.", 'BAD_REQUEST');
    const { lessonId, courseSlug } = parsed.data;
    const ctx = await loadPlayer(context, courseSlug);
    const outline = requireOpenLesson(ctx, lessonId);
    if (outline.type !== 'Quiz') throw new ZiteError("That lesson isn't a quiz.", 'BAD_REQUEST');
    const enrollment = ctx.enrollment!;
    const lesson = await loadLessonRecord(lessonId, ctx.course.id);
    const settings = parseQuizSettings(lesson.settings);
    if (!settings.questions.length) throw new ZiteError("This quiz doesn't have any questions yet.", 'BAD_REQUEST');

    const { rows: previous } = await zite.sql({ query: `SELECT "number", "score", "passed" FROM "QuizAttempts" WHERE "enrollmentId" = $1 AND "lessonId" = $2`, params: [enrollment.id, lessonId] });
    const used = previous.length;
    if (settings.maxAttempts > 0 && used >= settings.maxAttempts) {
      throw new ZiteError(`You've used all ${settings.maxAttempts} attempts on this quiz. Ask your instructor if you need another.`, 'BAD_REQUEST');
    }
    const number = Math.max(used, ...previous.map(p => num(p.number))) + 1;

    // The attempt's clock: the start the server recorded, else the browser's (never in the future).
    const now = Date.now();
    const current = ctx.progress.get(lessonId)?.state ?? {};
    const serverStart = typeof current.quizStartedAt === 'string' && num(current.quizAttempt) === used + 1 ? Date.parse(current.quizStartedAt) : NaN;
    const clientStart = parsed.data.startedAt ? Date.parse(parsed.data.startedAt) : NaN;
    const started = Number.isFinite(serverStart) ? serverStart : Number.isFinite(clientStart) ? Math.min(clientStart, now) : now;
    if (settings.timeLimitMinutes && now - started > settings.timeLimitMinutes * 60_000 + GRACE_MS) {
      throw new ZiteError(`This attempt ran past the ${settings.timeLimitMinutes}-minute time limit, so it wasn't counted. Start the quiz again when you're ready.`, 'BAD_REQUEST');
    }

    // Only answers to this quiz's questions are kept.
    const raw = parseAnswers(parsed.data.answers);
    const ids = new Set(settings.questions.map(q => q.id));
    const answers: QuizAnswers = Object.fromEntries(Object.entries(raw).filter(([id]) => ids.has(id)));
    const result = gradeQuiz(settings, answers);
    const submittedAt = new Date(now).toISOString();
    const previouslyPassed = previous.some(p => bool(p.passed)) || ctx.progress.get(lessonId)?.status === 'Completed';

    await withRetry(() =>
      zite.quizAttempts.create({
        record: { enrollmentId: enrollment.id, personId: ctx.actor.id, courseId: ctx.course.id, lessonId, number, answers: JSON.stringify(answers), score: result.score, passed: result.passed, startedAt: new Date(started).toISOString(), submittedAt },
      }),
    );

    // Record the attempt on the lesson (and clear the running clock) before any completion.
    const { quizStartedAt: _s, quizAttempt: _a, ...rest } = current;
    const progressId = await withRetry(() => touchLesson({ enrollment, lessonId, state: rest }));
    const best = Math.max(result.score, ...previous.map(p => num(p.score)));
    await withRetry(() => zite.lessonProgress.update({ id: progressId, record: { attempts: number, score: best } }));

    let outcome: { status: string; progress: number; completedNow: boolean; certificateId: string | null };
    if (result.passed) {
      outcome = await withRetry(() => completeLessonForEnrollment({ enrollment, lessonId, score: result.score, settings: ctx.settings }));
    } else {
      outcome = await withRetry(() => recomputeEnrollment(enrollment.id, { settings: ctx.settings }));
    }

    await logActivity({
      type: 'quiz_attempted',
      personId: ctx.actor.id,
      actorId: ctx.actor.id,
      courseId: ctx.course.id,
      lessonId,
      enrollmentId: enrollment.id,
      data: { number, score: result.score, passed: result.passed, lessonTitle: lesson.title },
    });

    const passedEver = previouslyPassed || result.passed;
    const progress = await loadProgress(enrollment.id);
    const completed = completedSet(progress);
    const locked = lockFor({ ...ctx, enrollment: { ...enrollment, status: outcome.status } }, completed);
    return {
      attempt: { number, score: result.score, passed: result.passed, submittedAt },
      score: result.score,
      passed: result.passed,
      passingScore: settings.passingScore,
      earned: result.earned,
      total: result.total,
      attemptsLeft: settings.maxAttempts > 0 ? Math.max(0, settings.maxAttempts - (used + 1)) : null,
      bestScore: best,
      review: mayRevealAnswers(settings, passedEver, used + 1) ? buildReview(settings, answers) : null,
      progress: outcome.progress,
      status: outcome.status,
      completedNow: outcome.completedNow,
      certificateId: outcome.certificateId,
      certificate: outcome.completedNow ? await certificateSummary(outcome.certificateId, ctx.actor.id) : null,
      nextLessonId: result.passed || passedEver ? nextLessonAfter(ctx.lessons, lessonId, completed, locked) : null,
    };
  },
});
