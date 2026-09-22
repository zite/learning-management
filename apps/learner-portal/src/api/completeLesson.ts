import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { effectiveWatchShare, parseChecklistSettings, parseVideoSettings } from '@project/shared/lessons';
import { completeLesson as completeLessonForEnrollment } from '@project/shared/server/enroll';
import { num, withRetry } from '@project/shared/server/sql';
import { certificateSummary, completedSet, loadLessonRecord, loadPlayer, loadProgress, loadSessionViews, lockFor, nextLessonAfter, requireOpenLesson } from '../server/player';

/**
 * "Mark complete" for lessons the learner finishes on their own: articles,
 * files, embeds, videos (once enough has been watched), checklists (once
 * every item is ticked) and live-session lessons that have no sessions to
 * attend. Quizzes complete by passing and assignments by being graded, so
 * they're refused here.
 */

const Input = z.object({
  lessonId: z.string().min(1).max(100),
  courseSlug: z.string().min(1).max(200),
  state: z.object({ watched: z.number().min(0).max(1).optional(), checked: z.array(z.string().max(60)).max(200).optional() }).optional(),
});

const Output = z.object({
  progress: z.number(),
  status: z.string(),
  completedNow: z.boolean(),
  certificateId: z.string().nullable(),
  certificate: z.object({ id: z.string(), credentialId: z.string(), issuedAt: z.string().nullable(), expiresAt: z.string().nullable(), status: z.string(), title: z.string(), recipientName: z.string() }).nullable(),
  nextLessonId: z.string().nullable(),
});

export default createEndpoint({
  description: 'Mark a self-paced lesson complete for the signed-in learner',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which lesson?', 'BAD_REQUEST');
    const { lessonId, courseSlug, state } = parsed.data;
    const ctx = await loadPlayer(context, courseSlug);
    const outline = requireOpenLesson(ctx, lessonId);
    const enrollment = ctx.enrollment!;
    const current = ctx.progress.get(lessonId)?.state ?? {};
    let saveState: Record<string, unknown> | null = null;

    switch (outline.type) {
      case 'Quiz':
        throw new ZiteError('Quizzes complete when you pass them.', 'BAD_REQUEST');
      case 'Assignment':
        throw new ZiteError('Assignments complete when your instructor grades your submission as passed.', 'BAD_REQUEST');
      case 'Video': {
        const lesson = await loadLessonRecord(lessonId, ctx.course.id);
        const required = effectiveWatchShare(lesson.mediaUrl as string | null, parseVideoSettings(lesson.settings).requiredWatchShare);
        const watched = Math.max(num(current.watched), state?.watched ?? 0);
        if (required > 0 && watched + 0.005 < required) throw new ZiteError(`Watch at least ${Math.round(required * 100)}% of the video to complete this lesson.`, 'BAD_REQUEST');
        if (watched > num(current.watched)) saveState = { ...current, watched };
        break;
      }
      case 'Checklist': {
        const lesson = await loadLessonRecord(lessonId, ctx.course.id);
        const items = parseChecklistSettings(lesson.settings).items;
        const checked = new Set(state?.checked ?? (Array.isArray(current.checked) ? (current.checked as string[]) : []));
        const missing = items.filter(i => !checked.has(i.id));
        if (missing.length) throw new ZiteError(missing.length === 1 ? `Tick “${missing[0].text}” to finish the checklist.` : `Tick the remaining ${missing.length} items to finish the checklist.`, 'BAD_REQUEST');
        saveState = { ...current, checked: items.map(i => i.id) };
        break;
      }
      case 'Live session': {
        const { scheduledCount } = await loadSessionViews({ lessonId, personId: ctx.actor.id });
        if (scheduledCount > 0) throw new ZiteError('This lesson completes when you attend one of its sessions — your instructor records attendance.', 'BAD_REQUEST');
        break;
      }
      default:
        break;
    }

    const result = await withRetry(() => completeLessonForEnrollment({ enrollment, lessonId, state: saveState, settings: ctx.settings }));
    const progress = await loadProgress(enrollment.id);
    const completed = completedSet(progress);
    const locked = lockFor({ ...ctx, enrollment: { ...enrollment, status: result.status } }, completed);
    return {
      progress: result.progress,
      status: result.status,
      completedNow: result.completedNow,
      certificateId: result.certificateId,
      certificate: result.completedNow ? await certificateSummary(result.certificateId, ctx.actor.id) : null,
      nextLessonId: nextLessonAfter(ctx.lessons, lessonId, completed, locked),
    };
  },
});
