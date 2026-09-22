import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { assertStaff, getActor } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { addToGroup, ADMIN_ONLY, loadGroupsByIds, removeFromGroup } from '../server/people-admin';

/**
 * Add and remove group members in one call. Adding applies the group's
 * assignment rules that include future members, so joining "Distribution
 * Center" enrolls people in its certification right away.
 *
 * Admins manage every group; a staff member who owns a group manages its members.
 */

const Input = z.object({
  groupId: z.string().min(1),
  add: z.array(z.string()).max(2000).default([]),
  remove: z.array(z.string()).max(2000).default([]),
});

const Output = z.object({ added: z.number(), removed: z.number(), enrolled: z.number(), skipped: z.number() });

export default createEndpoint({
  description: 'Add or remove members of a group, applying its assignment rules',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const { groupId } = parsed.data;
    const group = (await loadGroupsByIds([groupId])).get(groupId);
    if (!group) throw new ZiteError('That group no longer exists', 'NOT_FOUND');
    if (actor.role !== 'Admin' && group.ownerId !== actor.id) throw new ZiteError(`${ADMIN_ONLY} Group owners can manage their own group’s members.`, 'FORBIDDEN');

    const add = [...new Set(parsed.data.add)];
    const remove = [...new Set(parsed.data.remove)].filter(id => !add.includes(id));
    const settings = await getSettings();
    const res = await addToGroup({ groupId, groupName: group.name, personIds: add, actorId: actor.id, settings });
    const removed = await removeFromGroup({ groupId, groupName: group.name, personIds: remove, actorId: actor.id });
    return { added: res.added.length, removed: removed.length, enrolled: res.enrolled, skipped: add.length - res.added.length + (remove.length - removed.length) };
  },
});
