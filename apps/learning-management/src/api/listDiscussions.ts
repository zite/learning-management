import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { assertStaff, getActor } from '@project/shared/server/people';
import { DISCUSSION_FILTERS, discussionCounts, discussionCountsSchema, loadThread, selectThreads, threadSchema } from '../server/discussions';

/**
 * Learner questions across every course (or one), with their replies, for
 * staff to answer, pin and resolve. `threadId` makes sure a deep-linked thread
 * comes back even when it isn't in the current filter.
 */

const Input = z.object({
  filter: z.enum(DISCUSSION_FILTERS).default('unanswered'),
  courseId: z.string().max(80).nullable().optional(),
  q: z.string().max(200).optional(),
  threadId: z.string().max(80).nullable().optional(),
});

const Output = z.object({
  threads: z.array(threadSchema),
  counts: discussionCountsSchema,
  focus: threadSchema.nullable(),
});

export default createEndpoint({
  description: 'List lesson discussion threads with replies, filtered by unanswered, resolved or pinned, with counts',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('That discussion filter isn’t valid', 'BAD_REQUEST');
    const f = parsed.data;
    const threads = await selectThreads(f);
    const counts = await discussionCounts(f);
    let focus: z.infer<typeof threadSchema> | null = null;
    if (f.threadId) focus = threads.find(t => t.id === f.threadId) ?? (await loadThread(f.threadId));
    return { threads, counts, focus };
  },
});
