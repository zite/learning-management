import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { ref, withRetry } from '@project/shared/server/sql';
import { loadLessonContext } from '../server/player';

/**
 * Edit or delete your own question or reply. Deleting a question that already
 * has answers keeps the thread (marked as deleted) so other people's replies
 * aren't lost with it.
 */

const Input = z.object({ id: z.string().min(1).max(100), body: z.string().max(5000).optional(), delete: z.boolean().optional() });

const Output = z.object({ id: z.string(), deleted: z.boolean(), editedAt: z.string().nullable() });

export default createEndpoint({
  description: "Edit or delete the signed-in learner's own comment",
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.path.includes('body') ? 'Keep it under 5,000 characters.' : 'Which comment?', 'BAD_REQUEST');
    const { rows } = await zite.sql({ query: `SELECT id, "personId", "lessonId", "parentId" FROM "Comments" WHERE id::text = $1`, params: [parsed.data.id] });
    const comment = rows[0];
    if (!comment) throw new ZiteError('That comment was already deleted.', 'NOT_FOUND');
    const { ctx } = await loadLessonContext(context, String(comment.lessonId));
    if (String(comment.personId) !== ctx.actor.id) throw new ZiteError('You can only change your own comments.', 'FORBIDDEN');
    if (!ctx.settings.discussionsEnabled) throw new ZiteError('Questions are turned off in this academy.', 'FORBIDDEN');

    if (parsed.data.delete) {
      const isTop = !ref(comment.parentId);
      const { rows: replies } = isTop ? await zite.sql({ query: `SELECT 1 FROM "Comments" WHERE "parentId" = $1 LIMIT 1`, params: [String(comment.id)] }) : { rows: [] as unknown[] };
      if (replies.length) await withRetry(() => zite.comments.update({ id: String(comment.id), record: { body: '', editedAt: new Date().toISOString() } }));
      else await withRetry(() => zite.comments.delete({ id: String(comment.id) }));
      return { id: String(comment.id), deleted: true, editedAt: null };
    }

    const body = (parsed.data.body ?? '').trim();
    if (!body) throw new ZiteError('Write something, or delete the comment instead.', 'BAD_REQUEST');
    const editedAt = new Date().toISOString();
    await withRetry(() => zite.comments.update({ id: String(comment.id), record: { body, editedAt } }));
    return { id: String(comment.id), deleted: false, editedAt };
  },
});
