import { createEndpoint } from 'zitejs/backend';
import { assertStaff, getActor } from '@project/shared/server/people';
import { badInput, complianceInput, complianceOutput, loadCompliance, type ComplianceOutput } from '../server/reports';

/**
 * The compliance matrix: everyone in scope against every item an active
 * assignment rule requires of them, with the status of their latest cycle,
 * whether they currently hold a valid completion, and % compliant per item,
 * per group and overall.
 */
export default createEndpoint({
  description: 'Load the compliance matrix of required training by person, with per-item and per-group compliance',
  authenticated: true,
  inputSchema: complianceInput,
  outputSchema: complianceOutput,
  execute: async ({ input, context }): Promise<ComplianceOutput> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = complianceInput.safeParse(input ?? {});
    if (!parsed.success) badInput(parsed.error);
    return loadCompliance(parsed.data);
  },
});
