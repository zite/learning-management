import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { notify } from '@project/shared/server/notify';
import { assertStaff, getActor } from '@project/shared/server/people';
import { eachWrite, ref, withRetry } from '@project/shared/server/sql';
import { loadThread, threadSchema } from '../server/discussions';

/**
 * Staff actions on lesson Q&A: reply, edit or delete a comment, and pin or
 * resolve a thread.
 *
 * Staff may edit only their own words, but can delete anything (moderation);
 * deleting a question deletes its replies with it. A reply tells the person
 * who asked, in the learner app, with a link straight to the thread.
 */

const Input = z.object({
  action: z.enum(['reply', 'edit', 'delete', 'pin', 'unpin', 'resolve', 'reopen']),
  id: z.string().max(80).optional(),
  threadId: z.string().max(80).optional(),
  body: z.string().max(5000, 'Keep replies under 5,000 characters').optional(),
});

const Output = z.object({
  /** The thread after the change, or null when the thread itself was deleted. */
  thread: threadSchema.nullable(),
  deletedId: z.string().nullable(),
});

export default createEndpoint({
  description: 'Reply to, edit, delete, pin or resolve lesson discussion comments as staff',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Check the comment and try again', 'BAD_REQUEST');
    const { action } = parsed.data;
    const body = (parsed.data.body ?? '').trim();
    const now = new Date().toISOString();

    if (action === 'reply') {
      if (!parsed.data.threadId) throw new ZiteError('Which thread are you replying to?', 'BAD_REQUEST');
      if (!body) throw new ZiteError('Write a reply first', 'BAD_REQUEST');
      const thread = await loadThread(parsed.data.threadId);
      if (!thread) throw new ZiteError('That question was deleted', 'NOT_FOUND');
      await withRetry(() => zite.comments.create({ record: { body, courseId: thread.courseId, lessonId: thread.lessonId, personId: actor.id, parentId: thread.id, postedAt: now, pinned: false } }));
      await withRetry(() => notify({
        recipientIds: [thread.author.id],
        app: 'Learn',
        type: 'comment_reply',
        title: `${actor.name} replied to your question on “${thread.lessonTitle}”`,
        body: body.replace(/\s+/g, ' ').slice(0, 280),
        courseId: thread.courseId,
        actorId: actor.id,
        link: `/learn/${thread.courseSlug || thread.courseId}/${thread.lessonId}?thread=${thread.id}`,
        occurredAt: now,
      }));
      return { thread: await loadThread(thread.id), deletedId: null };
    }

    const id = parsed.data.id;
    if (!id) throw new ZiteError('Which comment?', 'BAD_REQUEST');
    const { rows } = await zite.sql({ query: `SELECT id, "personId", "parentId", "pinned", "resolvedAt" FROM "Comments" WHERE id::text = $1`, params: [id] });
    const c = rows[0];
    if (!c) throw new ZiteError('That comment was already deleted', 'NOT_FOUND');
    const parentId = ref(c.parentId);
    const threadId = parentId ?? String(c.id);

    if (action === 'edit') {
      if (String(c.personId) !== actor.id) throw new ZiteError('You can only edit your own comments', 'FORBIDDEN');
      if (!body) throw new ZiteError('A comment can’t be empty. Delete it instead.', 'BAD_REQUEST');
      await withRetry(() => zite.comments.update({ id, record: { body, editedAt: now } }));
      return { thread: await loadThread(threadId), deletedId: null };
    }

    if (action === 'delete') {
      if (!parentId) {
        const { rows: replies } = await zite.sql({ query: `SELECT id FROM "Comments" WHERE "parentId" = $1`, params: [id] });
        await eachWrite(replies, r => zite.comments.delete({ id: String(r.id) }));
      }
      await withRetry(() => zite.comments.delete({ id }));
      return { thread: parentId ? await loadThread(parentId) : null, deletedId: id };
    }

    if (parentId) throw new ZiteError(`Only questions can be ${action === 'pin' || action === 'unpin' ? 'pinned' : 'resolved'}, not replies`, 'BAD_REQUEST');
    // Resolving twice keeps the original time.
    if (action === 'resolve' && c.resolvedAt) return { thread: await loadThread(threadId), deletedId: null };
    const record = action === 'pin' ? { pinned: true } : action === 'unpin' ? { pinned: false } : { resolvedAt: action === 'resolve' ? now : null };
    await withRetry(() => zite.comments.update({ id, record }));
    return { thread: await loadThread(threadId), deletedId: null };
  },
});
