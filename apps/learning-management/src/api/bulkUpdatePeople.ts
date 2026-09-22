import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity, type ActivityInput } from '@project/shared/server/activity';
import { findTemplate } from '@project/shared/server/email';
import { assertStaff, getActor } from '@project/shared/server/people';
import { applyRulesForGroupJoin, applyRulesForNewPerson } from '@project/shared/server/rules';
import { getSettings } from '@project/shared/server/settings';
import { eachWrite, withRetry } from '@project/shared/server/sql';
import {
  activeAdminIds,
  addToGroup,
  assertPeopleAdmin,
  loadGroupsByIds,
  loadPeopleBasics,
  removeFromGroup,
  reportingLoop,
  ROLE_VALUES,
  sendInvitation,
  withdrawOpenTraining,
} from '../server/people-admin';

/**
 * One change applied to many people from a list selection. People the change
 * doesn't apply to (already in the group, already deactivated, would report to
 * themselves) are skipped and counted, never an error for the whole batch.
 */

const Input = z.object({
  ids: z.array(z.string()).min(1, 'Choose at least one person').max(2000, 'Choose up to 2,000 people at a time'),
  action: z.enum(['add_to_group', 'remove_from_group', 'set_manager', 'set_role', 'deactivate', 'reactivate', 'resend_invite']),
  groupId: z.string().optional(),
  managerId: z.string().nullable().optional(),
  role: z.enum(ROLE_VALUES).optional(),
  withdrawOpen: z.boolean().default(false),
});

const Output = z.object({ updated: z.number(), skipped: z.number(), enrolled: z.number(), withdrawn: z.number(), message: z.string().nullable() });

export default createEndpoint({
  description: 'Apply one change to many people: groups, manager, role, access, invitations',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    assertPeopleAdmin(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const { action, groupId, managerId, role, withdrawOpen } = parsed.data;
    const people = await loadPeopleBasics(parsed.data.ids);
    const list = [...people.values()];
    if (!list.length) throw new ZiteError('Those people no longer exist', 'NOT_FOUND');
    const settings = await getSettings();
    const now = new Date().toISOString();
    let updated = 0;
    let skipped = parsed.data.ids.length - list.length;
    let enrolled = 0;
    let withdrawn = 0;
    let message: string | null = null;

    switch (action) {
      case 'add_to_group':
      case 'remove_from_group': {
        if (!groupId) throw new ZiteError('Choose a group', 'BAD_REQUEST');
        const group = (await loadGroupsByIds([groupId])).get(groupId);
        if (!group) throw new ZiteError('That group no longer exists', 'NOT_FOUND');
        if (action === 'add_to_group') {
          const res = await addToGroup({ groupId, groupName: group.name, personIds: list.map(p => p.id), actorId: actor.id, settings });
          updated = res.added.length;
          skipped += list.length - res.added.length;
          enrolled = res.enrolled;
        } else {
          const removed = await removeFromGroup({ groupId, groupName: group.name, personIds: list.map(p => p.id), actorId: actor.id });
          updated = removed.length;
          skipped += list.length - removed.length;
        }
        break;
      }

      case 'set_manager': {
        let managerName = 'that manager';
        if (managerId) {
          const manager = (await loadPeopleBasics([managerId])).get(managerId);
          if (!manager) throw new ZiteError('That manager no longer exists', 'BAD_REQUEST');
          managerName = manager.name;
        }
        const targets: string[] = [];
        let already = 0;
        for (const p of list) {
          if (p.managerId === (managerId ?? null)) {
            skipped++;
            already++;
          }
          else if (managerId && (await reportingLoop(p.id, managerId))) {
            skipped++;
            message = `Skipped anyone ${managerName} already reports to, and ${managerName} themselves.`;
          } else targets.push(p.id);
        }
        await eachWrite(targets, id => zite.people.update({ id, record: { managerId: managerId ?? null } }));
        updated = targets.length;
        if (!message && already && !updated) message = managerId ? `${already === 1 ? 'They already report' : 'Everyone selected already reports'} to ${managerName}.` : 'Nobody selected has a manager.';
        break;
      }

      case 'set_role': {
        if (!role) throw new ZiteError('Choose a role', 'BAD_REQUEST');
        const targets = list.filter(p => p.role !== role);
        skipped += list.length - targets.length;
        if (role !== 'Admin') {
          const admins = await activeAdminIds();
          const demoted = new Set(targets.filter(p => p.role === 'Admin').map(p => p.id));
          if (admins.length && admins.every(id => demoted.has(id))) throw new ZiteError('This workspace needs at least one active admin. Keep someone as an admin, or make someone else an admin first.', 'CONFLICT');
        }
        await eachWrite(targets, p => zite.people.update({ id: p.id, record: { role } }));
        await logActivity(targets.map(p => ({ type: 'role_changed' as const, personId: p.id, actorId: actor.id, data: { from: p.role, to: role } })));
        updated = targets.length;
        break;
      }

      case 'deactivate': {
        const targets = list.filter(p => p.status !== 'Deactivated' && p.id !== actor.id);
        skipped += list.length - targets.length;
        if (list.some(p => p.id === actor.id)) message = 'You were skipped — you can’t deactivate yourself.';
        const admins = await activeAdminIds();
        const leaving = new Set(targets.filter(p => p.role === 'Admin').map(p => p.id));
        if (admins.length && admins.every(id => leaving.has(id))) throw new ZiteError('This workspace needs at least one active admin. Leave at least one admin active.', 'CONFLICT');
        await eachWrite(targets, p => zite.people.update({ id: p.id, record: { status: 'Deactivated', deactivatedAt: now } }));
        const activity: ActivityInput[] = [];
        for (const p of targets) {
          const n = withdrawOpen ? await withdrawOpenTraining(p.id, actor.id, 'Deactivated') : 0;
          withdrawn += n;
          activity.push({ type: 'person_deactivated', personId: p.id, actorId: actor.id, data: { withdrawn: n } });
        }
        await logActivity(activity);
        updated = targets.length;
        break;
      }

      case 'reactivate': {
        const targets = list.filter(p => p.status === 'Deactivated');
        skipped += list.length - targets.length;
        await eachWrite(targets, p => zite.people.update({ id: p.id, record: { status: !p.lastSeenAt && !p.lastLearnedAt && p.invitedAt ? 'Invited' : 'Active', deactivatedAt: null } }));
        await logActivity(targets.map(p => ({ type: 'person_reactivated' as const, personId: p.id, actorId: actor.id })));
        for (const p of targets) enrolled += await applyRulesForNewPerson(p.id, settings);
        if (targets.length) {
          const { rows } = await zite.sql({ query: `SELECT "groupId", string_agg("personId", ',') AS "ids" FROM "GroupMembers" WHERE "personId" = ANY($1::text[]) GROUP BY "groupId"`, params: [targets.map(t => t.id)] });
          for (const r of rows) enrolled += await applyRulesForGroupJoin(String(r.ids).split(','), String(r.groupId), settings);
        }
        updated = targets.length;
        break;
      }

      case 'resend_invite': {
        const targets = list.filter(p => p.status !== 'Deactivated' && !p.lastSeenAt && !p.lastLearnedAt);
        skipped += list.length - targets.length;
        const template = await findTemplate('Invitation');
        if (!template) throw new ZiteError('The Invitation email template is turned off. Turn it on in Settings → Emails to send invitations.', 'CONFLICT');
        const activity: ActivityInput[] = [];
        for (const p of targets) {
          const delivery = await sendInvitation(p, settings, template);
          if (delivery === 'Sent') {
            await withRetry(() => zite.people.update({ id: p.id, record: { invitedAt: now } }));
            activity.push({ type: 'person_invited', personId: p.id, actorId: actor.id, data: { resent: true } });
            updated++;
          } else skipped++;
        }
        await logActivity(activity);
        if (skipped && !updated) message = 'Everyone selected has already signed in or is deactivated.';
        break;
      }
    }

    return { updated, skipped, enrolled, withdrawn, message };
  },
});
