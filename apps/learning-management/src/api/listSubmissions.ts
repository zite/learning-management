import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { assertStaff, getActor } from '@project/shared/server/people';
import { queueCounts, queueCountsSchema, queueFiltersSchema, queueRowSchema, selectQueue } from '../server/grading';

/**
 * The grading queue: assignment submissions by status, scoped to the grader's
 * own courses or everything, with the counts the tabs show.
 */

const Input = queueFiltersSchema;

const Output = z.object({
  rows: z.array(queueRowSchema),
  counts: queueCountsSchema,
  scope: z.enum(['mine', 'all']),
  /** With "My courses", how much is waiting outside them — so an empty queue can say so. */
  elsewhere: z.object({ submitted: z.number() }).nullable(),
});

export default createEndpoint({
  description: 'List assignment submissions to grade, needing revision or graded, with counts per status',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('That queue filter isn’t valid', 'BAD_REQUEST');
    const filters = parsed.data;
    const [rows, counts, wider] = await Promise.all([
      selectQueue(actor, filters),
      queueCounts(actor, filters),
      filters.scope === 'mine' ? queueCounts(actor, { ...filters, scope: 'all' }) : Promise.resolve(null),
    ]);
    return { rows, counts, scope: filters.scope, elsewhere: wider ? { submitted: Math.max(0, wider.submitted - counts.submitted) } : null };
  },
});
