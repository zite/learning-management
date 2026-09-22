import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { assertAdmin, getActor } from '@project/shared/server/people';
import { applyRule, loadRule } from '@project/shared/server/rules';
import { getSettings } from '@project/shared/server/settings';
import { loadTarget } from '../server/assignmentRules';

/**
 * Run a rule now for its whole audience. Safe to repeat: people already
 * enrolled (or finished) are skipped, withdrawn enrollments are restored.
 */

const Input = z.object({ id: z.string().min(1) });
const Output = z.object({ created: z.number(), reactivated: z.number(), skipped: z.number(), skippedInactive: z.number(), audience: z.number(), lastRunAt: z.string() });

export default createEndpoint({
  description: 'Run an assignment rule now',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertAdmin(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which rule?', 'BAD_REQUEST');
    const rule = await loadRule(parsed.data.id);
    if (!rule) throw new ZiteError('That rule no longer exists', 'NOT_FOUND');
    if (rule.status !== 'Active') throw new ZiteError(rule.status === 'Paused' ? 'Resume this rule before running it' : 'Restore this rule before running it', 'BAD_REQUEST');
    const target = await loadTarget(rule);
    if (!target) throw new ZiteError(`The ${rule.targetType === 'Path' ? 'learning path' : 'course'} this rule assigns no longer exists`, 'BAD_REQUEST');
    if (target.status !== 'Published') throw new ZiteError(`Publish “${target.title}” before running this rule`, 'BAD_REQUEST');
    const res = await applyRule(rule, { actorId: actor.id, settings: await getSettings() });
    return { created: res.created.length, reactivated: res.reactivated.length, skipped: res.skipped, skippedInactive: res.skippedInactive, audience: res.audience, lastRunAt: new Date().toISOString() };
  },
});
