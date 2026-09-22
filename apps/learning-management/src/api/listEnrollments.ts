import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { assertStaff, getActor } from '@project/shared/server/people';
import { enrollmentFilterSchema, enrollmentRowSchema, ORDERINGS, selectEnrollments, summarySchema } from '../server/enrollments';

const Input = z.object({
  filters: enrollmentFilterSchema.default({}),
  ordering: z.enum(ORDERINGS).default('due_asc'),
  limit: z.number().int().min(1).max(2000).default(500),
});

export default createEndpoint({
  description: 'List course enrollments with filters, ordering and status counts',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ rows: z.array(enrollmentRowSchema), truncated: z.boolean(), summary: summarySchema }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid filters', 'BAD_REQUEST');
    return selectEnrollments(parsed.data.filters, parsed.data.ordering, parsed.data.limit);
  },
});
