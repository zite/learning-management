import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { toRule } from '@project/shared/server/rules';
import { str } from '@project/shared/server/sql';
import { audienceSizes, mapRuleRow, RULE_SELECT, ruleCounts, ruleRowSchema } from '../server/assignmentRules';

/**
 * Every assignment rule with what it targets, who it reaches, and how the
 * people it enrolled are doing (each person's latest cycle). Admins manage
 * rules; instructors can see them.
 */

const Output = z.object({ rules: z.array(ruleRowSchema), canManage: z.boolean() });

export default createEndpoint({
  description: 'List assignment rules with audience, due dates and enrollment counts',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: Output,
  execute: async ({ context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const [{ rows }, counts, { rows: groups }] = await Promise.all([
      zite.sql({ query: `${RULE_SELECT} ORDER BY r.created_at DESC`, params: [] }),
      ruleCounts(),
      zite.sql({ query: `SELECT id::text AS id, "name" FROM "Groups"`, params: [] }),
    ]);
    const rules = rows.map(toRule);
    const sizes = await audienceSizes(rules);
    const groupName = new Map(groups.map(g => [String(g.id), str(g.name) ?? '']));
    return {
      canManage: actor.role === 'Admin',
      rules: rules.map((rule, i) => mapRuleRow(rule, rows[i], { groupName: id => groupName.get(id), counts: counts.get(rule.id), audienceSize: sizes.get(rule.id) ?? 0 })),
    };
  },
});
