import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseChecklistSettings, parseQuizSettings } from '@project/shared/lessons';
import { touchLesson } from '@project/shared/server/enroll';
import { num, withRetry } from '@project/shared/server/sql';
import { loadLessonRecord, loadPlayer, requireOpenLesson } from '../server/player';

/**
 * The player's heartbeat: time on a lesson (sent only while the tab is
 * visible, capped per call), where the learner is, and small bits of lesson
 * state — how much of a video they've watched, which checklist items they've
 * ticked, that they opened a file, when they started a timed quiz.
 *
 * State is merged per key and validated against the lesson's current
 * settings, so a stale tab can't tick an item that no longer exists.
 */

const Input = z.object({
  lessonId: z.string().min(1).max(100),
  courseSlug: z.string().min(1).max(200),
  seconds: z.number().min(0).max(120).optional(),
  state: z
    .object({
      watched: z.number().min(0).max(1).optional(),
      checked: z.array(z.string().max(60)).max(200).optional(),
      opened: z.boolean().optional(),
      quizStarted: z.boolean().optional(),
    })
    .optional(),
});

const Output = z.object({ ok: z.boolean(), lessonState: z.enum(['completed', 'in_progress']), state: z.record(z.string(), z.any()), startedCourse: z.boolean() });

export default createEndpoint({
  description: 'Record time and state on a lesson for the signed-in learner',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('That progress update was malformed.', 'BAD_REQUEST');
    const { lessonId, courseSlug, seconds = 0, state } = parsed.data;
    const ctx = await loadPlayer(context, courseSlug);
    const outline = requireOpenLesson(ctx, lessonId);
    const enrollment = ctx.enrollment!;
    const existing = ctx.progress.get(lessonId);
    const current = existing?.state ?? {};

    let next: Record<string, unknown> | null = null;
    if (state) {
      if (outline.type === 'Video' && state.watched != null) {
        const watched = Math.max(num(current.watched), state.watched);
        if (watched > num(current.watched)) next = { ...current, watched: Math.round(watched * 1000) / 1000 };
      } else if (outline.type === 'Checklist' && state.checked) {
        const lesson = await loadLessonRecord(lessonId, ctx.course.id);
        const valid = new Set(parseChecklistSettings(lesson.settings).items.map(i => i.id));
        next = { ...current, checked: [...new Set(state.checked.filter(id => valid.has(id)))] };
      } else if (outline.type === 'File' && state.opened && current.opened !== true) {
        next = { ...current, opened: true };
      } else if (outline.type === 'Quiz' && state.quizStarted) {
        // The server's clock starts a timed attempt, so the countdown survives a reload and can't be wound back.
        const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "attemptTotal" FROM "QuizAttempts" WHERE "enrollmentId" = $1 AND "lessonId" = $2`, params: [enrollment.id, lessonId] });
        const attempt = num(rows[0]?.attemptTotal) + 1;
        const limit = parseQuizSettings((await loadLessonRecord(lessonId, ctx.course.id)).settings).timeLimitMinutes;
        const runningSince = typeof current.quizStartedAt === 'string' && num(current.quizAttempt) === attempt ? Date.parse(current.quizStartedAt) : NaN;
        // Resuming keeps the original clock; an attempt whose time already ran out starts fresh.
        const expired = !Number.isFinite(runningSince) || (limit != null && Date.now() - runningSince > limit * 60_000 + 30_000);
        if (expired) next = { ...current, quizStartedAt: new Date().toISOString(), quizAttempt: attempt };
      }
    }

    // Nothing new to record (a re-render, a duplicate beat): don't spend writes on it.
    if (!next && seconds < 1 && existing && enrollment.currentLessonId === lessonId && enrollment.status !== 'Not started') {
      return { ok: true, lessonState: existing.status === 'Completed' ? 'completed' : 'in_progress', state: current, startedCourse: false };
    }

    await withRetry(() => touchLesson({ enrollment, lessonId, seconds, state: next }));
    return { ok: true, lessonState: existing?.status === 'Completed' ? 'completed' : 'in_progress', state: next ?? current, startedCourse: enrollment.status === 'Not started' };
  },
});
