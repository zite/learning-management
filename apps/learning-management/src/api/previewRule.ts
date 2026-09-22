import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { assertStaff, getActor } from '@project/shared/server/people';
import { previewRule, ruleConfigSchema } from '../server/assignmentRules';

/**
 * A dry run of an unsaved rule, for the editor's live preview: audience size,
 * how many would be enrolled now, and who is skipped because they're already
 * enrolled, already finished or deactivated. Writes nothing.
 */

const Input = ruleConfigSchema;
const Output = z.object({
  audience: z.number(),
  newEnrollments: z.number(),
  alreadyEnrolled: z.number(),
  completedAlready: z.number(),
  deactivatedSkipped: z.number(),
  sample: z.array(z.object({ name: z.string(), title: z.string() })),
  dueDate: z.string().nullable(),
});

export default createEndpoint({
  description: 'Preview who an assignment rule would enroll, without saving it',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'That rule is incomplete', 'BAD_REQUEST');
    return previewRule(parsed.data);
  },
});
