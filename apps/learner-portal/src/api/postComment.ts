import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { notify } from '@project/shared/server/notify';
import { courseStaffIds } from '@project/shared/server/people';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { loadLessonContext } from '../server/player';

/**
 * Ask a question on a lesson, or reply in a thread. A new question lands in
 * the course staff's inbox; a reply tells the person who asked. When the asker
 * follows up on their own thread, staff hear about that too.
 */

const Input = z.object({ lessonId: z.string().min(1).max(100), body: z.string().max(5000), parentId: z.string().max(100).optional().nullable() });

const Output = z.object({ id: z.string(), parentId: z.string().nullable(), postedAt: z.string() });

const excerpt = (s: string, n = 180) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export default createEndpoint({
  description: 'Post a question or reply on a lesson as the signed-in learner',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.path.includes('body') ? 'Keep it under 5,000 characters.' : 'Which lesson?', 'BAD_REQUEST');
    const body = parsed.data.body.trim();
    if (!body) throw new ZiteError('Write something before posting.', 'BAD_REQUEST');
    const { ctx, lesson } = await loadLessonContext(context, parsed.data.lessonId);
    if (!ctx.settings.discussionsEnabled) throw new ZiteError('Questions are turned off in this academy.', 'FORBIDDEN');

    let parentId: string | null = null;
    let threadAuthorId: string | null = null;
    if (parsed.data.parentId) {
      const { rows } = await zite.sql({ query: `SELECT id, "parentId", "personId", "lessonId" FROM "Comments" WHERE id::text = $1`, params: [parsed.data.parentId] });
      const target = rows[0];
      if (!target || String(target.lessonId) !== lesson.id) throw new ZiteError('That question was deleted.', 'NOT_FOUND');
      // Replies stay one level deep: replying to a reply joins its thread.
      parentId = ref(target.parentId) ?? String(target.id);
      if (parentId !== String(target.id)) {
        const { rows: top } = await zite.sql({ query: `SELECT "personId" FROM "Comments" WHERE id::text = $1`, params: [parentId] });
        threadAuthorId = ref(top[0]?.personId);
      } else threadAuthorId = ref(target.personId);
    }

    const postedAt = new Date().toISOString();
    const created = await withRetry(() => zite.comments.create({ record: { body, courseId: ctx.course.id, lessonId: lesson.id, personId: ctx.actor.id, parentId, postedAt, editedAt: null, pinned: false, resolvedAt: null } }));
    const threadId = parentId ?? created.id;
    const learnHash = `/learn/${ctx.course.slug || ctx.course.id}/${lesson.id}?thread=${threadId}`;

    if (!parentId) {
      await withRetry(async () =>
        notify({
          recipientIds: await courseStaffIds(ctx.course.id),
          app: 'Admin',
          type: 'question_posted',
          title: `${ctx.actor.name} asked a question on “${lesson.title}”`,
          body: excerpt(body),
          courseId: ctx.course.id,
          actorId: ctx.actor.id,
          link: `/discussions?thread=${created.id}`,
        }),
      );
    } else if (threadAuthorId === ctx.actor.id) {
      await withRetry(async () =>
        notify({
          recipientIds: await courseStaffIds(ctx.course.id),
          app: 'Admin',
          type: 'question_posted',
          title: `${ctx.actor.name} followed up on their question in “${lesson.title}”`,
          body: excerpt(body),
          courseId: ctx.course.id,
          actorId: ctx.actor.id,
          link: `/discussions?thread=${parentId}`,
        }),
      );
    } else if (threadAuthorId) {
      await withRetry(() =>
        notify({
          recipientIds: [threadAuthorId],
          app: 'Learn',
          type: 'comment_reply',
          title: `${str(ctx.actor.name) || 'Someone'} replied to your question on “${lesson.title}”`,
          body: excerpt(body),
          courseId: ctx.course.id,
          actorId: ctx.actor.id,
          link: learnHash,
        }),
      );
    }

    return { id: created.id, parentId, postedAt };
  },
});
