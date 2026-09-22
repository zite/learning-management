import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseIdList } from '@project/shared/progress';
import { assertStaff, getActor } from '@project/shared/server/people';
import { eachWrite, str } from '@project/shared/server/sql';
import { GROUP_KIND_VALUES, loadPeopleBasics } from '../server/people-admin';

/**
 * Create, edit or delete a group. Deleting removes its memberships and takes
 * it out of assignment rules; a rule that targeted only this group is paused,
 * so it can't silently start enrolling nobody (or somebody) later.
 */

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour');
const name = z.string().trim().min(1, 'Give the group a name').max(80, 'Keep the name under 80 characters');

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name, kind: z.enum(GROUP_KIND_VALUES).default('Team'), description: z.string().max(1000).default(''), color: color.default('#64748b'), ownerId: z.string().nullable().default(null) }),
  z.object({ action: z.literal('update'), id: z.string().min(1), name: name.optional(), kind: z.enum(GROUP_KIND_VALUES).optional(), description: z.string().max(1000).optional(), color: color.optional(), ownerId: z.string().nullable().optional() }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
]);

const Output = z.object({ id: z.string(), rulesUpdated: z.number(), rulesPaused: z.number(), membersRemoved: z.number() });

export default createEndpoint({
  description: 'Create, update or delete a group',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    if (actor.role !== 'Admin') throw new ZiteError('Only admins can create, edit or delete groups', 'FORBIDDEN');
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const data = parsed.data;

    const assertUniqueName = async (value: string, exceptId?: string) => {
      const { rows } = await zite.sql({ query: `SELECT id::text AS id FROM "Groups" WHERE LOWER(TRIM("name")) = LOWER($1::text) AND id::text <> $2::text LIMIT 1`, params: [value.trim(), exceptId ?? ''] });
      if (rows.length) throw new ZiteError(`There's already a group called “${value.trim()}”`, 'CONFLICT');
    };
    const assertOwner = async (ownerId: string | null | undefined) => {
      if (!ownerId) return;
      if (!(await loadPeopleBasics([ownerId])).has(ownerId)) throw new ZiteError('That owner no longer exists', 'BAD_REQUEST');
    };

    if (data.action === 'create') {
      await assertUniqueName(data.name);
      await assertOwner(data.ownerId);
      const { rows } = await zite.sql({ query: `SELECT COALESCE(MAX("position"), 0) AS "top" FROM "Groups"`, params: [] });
      const created = await zite.groups.create({ record: { name: data.name.trim(), kind: data.kind, description: data.description.trim() || null, color: data.color, ownerId: data.ownerId, position: Number(rows[0]?.top ?? 0) + 1 } });
      return { id: created.id, rulesUpdated: 0, rulesPaused: 0, membersRemoved: 0 };
    }

    const { rows: found } = await zite.sql({ query: `SELECT id::text AS id, "name" FROM "Groups" WHERE id::text = $1`, params: [data.id] });
    if (!found[0]) throw new ZiteError('That group no longer exists', 'NOT_FOUND');

    if (data.action === 'update') {
      const record: Record<string, unknown> = {};
      if (data.name !== undefined) {
        await assertUniqueName(data.name, data.id);
        record.name = data.name.trim();
      }
      if (data.kind !== undefined) record.kind = data.kind;
      if (data.description !== undefined) record.description = data.description.trim() || null;
      if (data.color !== undefined) record.color = data.color;
      if (data.ownerId !== undefined) {
        await assertOwner(data.ownerId);
        record.ownerId = data.ownerId;
      }
      if (Object.keys(record).length) await zite.groups.update({ id: data.id, record: record as never });
      return { id: data.id, rulesUpdated: 0, rulesPaused: 0, membersRemoved: 0 };
    }

    // Delete: rules first, then memberships, then the group.
    const { rows: rules } = await zite.sql({ query: `SELECT id::text AS id, "groupIds", "audience", "status" FROM "AssignmentRules" WHERE COALESCE("groupIds", '') LIKE '%' || $1::text || '%'`, params: [data.id] });
    let rulesUpdated = 0;
    let rulesPaused = 0;
    const ruleWrites: Array<{ id: string; record: Record<string, unknown> }> = [];
    for (const rule of rules) {
      const ids = parseIdList(rule.groupIds);
      if (!ids.includes(data.id)) continue;
      const rest = ids.filter(id => id !== data.id);
      const record: Record<string, unknown> = { groupIds: JSON.stringify(rest) };
      if (!rest.length && rule.audience === 'Groups' && str(rule.status) === 'Active') {
        record.status = 'Paused';
        rulesPaused++;
      }
      ruleWrites.push({ id: String(rule.id), record });
      rulesUpdated++;
    }
    await eachWrite(ruleWrites, w => zite.assignmentRules.update({ id: w.id, record: w.record as never }));
    // Reads are capped, so a very large group is cleared in rounds.
    let membersRemoved = 0;
    for (let round = 0; round < 100; round++) {
      const { rows: members } = await zite.sql({ query: `SELECT id::text AS id FROM "GroupMembers" WHERE "groupId" = $1 LIMIT 1000`, params: [data.id] });
      if (!members.length) break;
      await eachWrite(members, m => zite.groupMembers.delete({ id: String(m.id) }));
      membersRemoved += members.length;
    }
    await zite.groups.delete({ id: data.id });
    return { id: data.id, rulesUpdated, rulesPaused, membersRemoved };
  },
});
