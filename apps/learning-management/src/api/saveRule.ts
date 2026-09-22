import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { dayOf } from '@project/shared/progress';
import { logActivity } from '@project/shared/server/activity';
import { assertAdmin, getActor } from '@project/shared/server/people';
import { applyRule, loadRule, type RuleRecord } from '@project/shared/server/rules';
import { getSettings } from '@project/shared/server/settings';
import { groupNames, loadTarget, ruleConfigSchema, ruleRecord, validateRule } from '../server/assignmentRules';

/**
 * Create, edit, pause, resume, archive or delete an assignment rule. Admins
 * only. Creating an active rule and resuming a paused one run it straight
 * away, so "Save and assign 12 people" means exactly that.
 *
 * Deleting a rule never touches the enrollments it created — people keep
 * their training and its history.
 */

const Input = z.object({
  action: z.enum(['create', 'update', 'pause', 'resume', 'archive', 'delete']),
  id: z.string().optional(),
  rule: ruleConfigSchema.optional(),
  /** create: save as Active (runs now) or Paused. */
  status: z.enum(['Active', 'Paused']).optional(),
  /** update: also run the rule now (active rules only). */
  apply: z.boolean().optional(),
});

const Applied = z.object({ created: z.number(), reactivated: z.number(), skipped: z.number(), skippedInactive: z.number(), audience: z.number() });
const Output = z.object({ id: z.string(), status: z.enum(['Active', 'Paused', 'Archived']).nullable(), applied: Applied.nullable() });
type Out = z.infer<typeof Output>;

async function run(rule: RuleRecord, actorId: string) {
  const res = await applyRule(rule, { actorId, settings: await getSettings() });
  return { created: res.created.length, reactivated: res.reactivated.length, skipped: res.skipped, skippedInactive: res.skippedInactive, audience: res.audience };
}

export default createEndpoint({
  description: 'Create, update, pause, resume, archive or delete an assignment rule',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<Out> => {
    const actor = await getActor(context);
    assertAdmin(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'That rule is incomplete', 'BAD_REQUEST');
    const { action, id, rule: config } = parsed.data;

    if (action === 'create') {
      if (!config) throw new ZiteError('Describe the rule to create', 'BAD_REQUEST');
      const status = parsed.data.status ?? 'Active';
      const v = await validateRule(config, { active: status === 'Active' });
      const record = ruleRecord(config, v, await groupNames(v.groupIds));
      const created = await zite.assignmentRules.create({ record: { ...record, status, createdById: actor.id } as never });
      await logActivity({ type: 'rule_created', actorId: actor.id, courseId: record.courseId, pathId: record.pathId, data: { ruleId: created.id, ruleName: record.name, status } });
      const saved = await loadRule(created.id);
      const applied = status === 'Active' && saved ? await run(saved, actor.id) : null;
      return { id: created.id, status, applied };
    }

    if (!id) throw new ZiteError('Which rule?', 'BAD_REQUEST');
    const existing = await loadRule(id);
    if (!existing) throw new ZiteError('That rule no longer exists', 'NOT_FOUND');

    switch (action) {
      case 'update': {
        if (!config) throw new ZiteError('Describe the changes to save', 'BAD_REQUEST');
        const active = existing.status === 'Active';
        // A paused rule can keep a fixed date that has since passed; it's checked again on resume.
        const v = await validateRule(config, { active, keepDueDate: existing.dueDate });
        const record = ruleRecord(config, v, await groupNames(v.groupIds));
        await zite.assignmentRules.update({ id, record: record as never });
        const saved = await loadRule(id);
        const applied = active && parsed.data.apply && saved ? await run(saved, actor.id) : null;
        return { id, status: existing.status, applied };
      }
      case 'pause': {
        // Pausing an archived rule restores it without running it.
        await zite.assignmentRules.update({ id, record: { status: 'Paused' } });
        return { id, status: 'Paused', applied: null };
      }
      case 'resume': {
        const target = await loadTarget(existing);
        if (!target) throw new ZiteError(`The ${existing.targetType === 'Path' ? 'learning path' : 'course'} this rule assigns no longer exists`, 'BAD_REQUEST');
        if (target.status !== 'Published') throw new ZiteError(`Publish “${target.title}” before resuming this rule`, 'BAD_REQUEST');
        if (existing.dueMode === 'Fixed' && existing.dueDate && existing.dueDate <= dayOf(new Date())) throw new ZiteError("This rule's due date has passed. Edit it to choose a new date before resuming.", 'BAD_REQUEST');
        if (existing.audience === 'Groups' && !existing.groupIds.length) throw new ZiteError('Choose at least one group before resuming this rule', 'BAD_REQUEST');
        if (existing.audience === 'People' && !existing.personIds.length) throw new ZiteError('Choose at least one person before resuming this rule', 'BAD_REQUEST');
        await zite.assignmentRules.update({ id, record: { status: 'Active' } });
        const applied = await run({ ...existing, status: 'Active' }, actor.id);
        return { id, status: 'Active', applied };
      }
      case 'archive': {
        await zite.assignmentRules.update({ id, record: { status: 'Archived' } });
        return { id, status: 'Archived', applied: null };
      }
      case 'delete': {
        await zite.assignmentRules.delete({ id });
        return { id, status: null, applied: null };
      }
    }
    throw new ZiteError('Unknown action', 'BAD_REQUEST');
  },
});
