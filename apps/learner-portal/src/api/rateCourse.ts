import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { notify } from '@project/shared/server/notify';
import { withRetry } from '@project/shared/server/sql';
import { loadPlayer, requireEnrollment } from '../server/player';

/**
 * A learner's star rating (and optional review) of a course they finished.
 * Changing it later is fine; the course owner hears about the first one.
 */

const Input = z.object({ courseSlug: z.string().min(1).max(200), rating: z.number().int().min(1).max(5), review: z.string().max(2000).optional() });

const Output = z.object({ rating: z.number(), review: z.string(), ratedAt: z.string() });

export default createEndpoint({
  description: 'Rate a completed course as the signed-in learner',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.path.includes('review') ? 'Keep your review under 2,000 characters.' : 'Pick between one and five stars.', 'BAD_REQUEST');
    const ctx = await loadPlayer(context, parsed.data.courseSlug, { withPathLock: false });
    const enrollment = requireEnrollment(ctx);
    if (enrollment.status !== 'Completed') throw new ZiteError('You can rate this course once you’ve completed it.', 'BAD_REQUEST');

    const { rating } = parsed.data;
    const review = (parsed.data.review ?? '').trim();
    const ratedAt = new Date().toISOString();
    const first = enrollment.rating == null;
    await withRetry(() => zite.enrollments.update({ id: enrollment.id, record: { rating, review, ratedAt } }));
    await logActivity({ type: 'course_rated', personId: ctx.actor.id, actorId: ctx.actor.id, courseId: ctx.course.id, enrollmentId: enrollment.id, data: { rating, review: review.slice(0, 280), courseTitle: ctx.course.title, previous: enrollment.rating } });
    if (first) {
      await withRetry(() =>
        notify({
          recipientIds: [ctx.course.ownerId],
          app: 'Admin',
          type: 'course_rated',
          title: `${ctx.actor.name} rated ${ctx.course.title} ${rating} star${rating === 1 ? '' : 's'}`,
          body: review ? `“${review.length > 180 ? `${review.slice(0, 179)}…` : review}”` : null,
          courseId: ctx.course.id,
          actorId: ctx.actor.id,
          link: `/courses/${ctx.course.id}`,
        }),
      );
    }
    return { rating, review, ratedAt };
  },
});
