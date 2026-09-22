import { createEndpoint } from 'zitejs/backend';
import { assertStaff, getActor } from '@project/shared/server/people';
import { badInput, loadReports, reportsOutput, scopeSchema, type ReportsOutput } from '../server/reports';

/**
 * The Reports overview and engagement tabs: headline numbers against the
 * period before, activity trends, completion by category, course and group,
 * engagement patterns and the points leaderboard — all for one range and
 * scope, so every panel agrees.
 */
export default createEndpoint({
  description: 'Load learning reports for a date range: KPIs, trends, breakdowns, engagement and leaderboard',
  authenticated: true,
  inputSchema: scopeSchema,
  outputSchema: reportsOutput,
  execute: async ({ input, context }): Promise<ReportsOutput> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = scopeSchema.safeParse(input ?? {});
    if (!parsed.success) badInput(parsed.error);
    return loadReports(parsed.data);
  },
});
