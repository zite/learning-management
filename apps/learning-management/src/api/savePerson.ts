import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity, type ActivityInput } from '@project/shared/server/activity';
import { findTemplate } from '@project/shared/server/email';
import { getActor, assertStaff } from '@project/shared/server/people';
import { applyRulesForGroupJoin, applyRulesForNewPerson } from '@project/shared/server/rules';
import { getSettings } from '@project/shared/server/settings';
import {
  addToGroup,
  applyEveryoneRules,
  assertNotLastAdmin,
  assertPeopleAdmin,
  dayString,
  insertPeople,
  loadGroupsByIds,
  loadPeopleBasics,
  loadPersonOrThrow,
  peopleByEmail,
  personLabel,
  removeFromGroup,
  reportingLoop,
  ROLE_VALUES,
  sendInvitation,
  validateNewEmail,
  withdrawOpenTraining,
} from '../server/people-admin';

/**
 * Add, edit and manage one person (or a batch typed into the Add people dialog).
 *
 *   create      one person → Invited (or Active), invitation email, groups, rules
 *   createMany  several people sharing role/groups/manager/title
 *   update      profile fields and group memberships
 *   setRole     Admin / Instructor / Learner (never demotes the last admin)
 *   setManager  no loops, not themselves
 *   deactivate  optionally withdraws unfinished training
 *   reactivate  rules that include future members apply again
 *   resendInvite
 *
 * Everything here is admin-only: instructors can view people and enroll them.
 */

const optionalText = (max: number) => z.string().max(max, `Keep it under ${max} characters`);

const shared = {
  title: optionalText(160).default(''),
  role: z.enum(ROLE_VALUES).default('Learner'),
  managerId: z.string().nullable().default(null),
  groupIds: z.array(z.string()).max(50).default([]),
  hireDate: dayString.nullable().default(null),
  sendInvite: z.boolean().default(true),
};

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: optionalText(120).default(''), email: z.string().max(254), externalId: optionalText(120).default(''), ...shared }),
  z.object({ action: z.literal('createMany'), people: z.array(z.object({ name: optionalText(120).default(''), email: z.string().max(254) })).min(1, 'Add at least one email address').max(200, 'Add up to 200 people at a time — use Import CSV for more'), ...shared }),
  z.object({
    action: z.literal('update'),
    id: z.string().min(1),
    name: optionalText(120).optional(),
    title: optionalText(160).optional(),
    hireDate: dayString.nullable().optional(),
    externalId: optionalText(120).optional(),
    bio: optionalText(2000).optional(),
    muteEmails: z.boolean().optional(),
    groupIds: z.array(z.string()).max(100).optional(),
  }),
  z.object({ action: z.literal('setRole'), id: z.string().min(1), role: z.enum(ROLE_VALUES) }),
  z.object({ action: z.literal('setManager'), id: z.string().min(1), managerId: z.string().nullable() }),
  z.object({ action: z.literal('deactivate'), id: z.string().min(1), withdrawOpen: z.boolean().default(false) }),
  z.object({ action: z.literal('reactivate'), id: z.string().min(1) }),
  z.object({ action: z.literal('resendInvite'), id: z.string().min(1) }),
]);

const brief = z.object({ id: z.string(), name: z.string(), email: z.string(), status: z.string() });

const Output = z.object({
  id: z.string().nullable(),
  created: z.array(brief),
  existing: z.array(brief),
  invalid: z.array(z.object({ email: z.string(), error: z.string() })),
  invited: z.number(),
  enrolled: z.number(),
  withdrawn: z.number(),
  delivery: z.enum(['Sent', 'Failed', 'Skipped']).nullable(),
});
type Result = z.infer<typeof Output>;

const empty = (): Result => ({ id: null, created: [], existing: [], invalid: [], invited: 0, enrolled: 0, withdrawn: 0, delivery: null });

export default createEndpoint({
  description: 'Create, update, change the role or manager of, deactivate, reactivate or re-invite people',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<Result> => {
    const actor = await getActor(context);
    assertStaff(actor);
    assertPeopleAdmin(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const data = parsed.data;
    const settings = await getSettings();
    const now = new Date().toISOString();
    const result = empty();

    const checkManager = async (managerId: string | null) => {
      if (!managerId) return null;
      const m = (await loadPeopleBasics([managerId])).get(managerId);
      if (!m) throw new ZiteError('That manager no longer exists', 'BAD_REQUEST');
      return m;
    };
    const checkGroups = async (groupIds: string[]) => {
      const groups = await loadGroupsByIds(groupIds);
      const missing = groupIds.filter(id => !groups.has(id));
      if (missing.length) throw new ZiteError(missing.length === 1 ? 'One of those groups no longer exists' : 'Some of those groups no longer exist', 'BAD_REQUEST');
      return groups;
    };

    switch (data.action) {
      case 'create':
      case 'createMany': {
        const entries = data.action === 'create' ? [{ name: data.name, email: data.email }] : data.people;
        await checkManager(data.managerId);
        const groups = await checkGroups(data.groupIds);

        const seen = new Set<string>();
        const valid: Array<{ name: string; email: string }> = [];
        for (const e of entries) {
          const { email, error } = validateNewEmail(e.email);
          if (error) {
            if (data.action === 'create') throw new ZiteError(error, 'BAD_REQUEST');
            result.invalid.push({ email: e.email, error });
            continue;
          }
          if (seen.has(email)) continue;
          seen.add(email);
          valid.push({ name: e.name.trim(), email });
        }
        const existing = await peopleByEmail(valid.map(v => v.email));
        const fresh = valid.filter(v => !existing.has(v.email));
        for (const v of valid) {
          const ex = existing.get(v.email);
          if (ex) result.existing.push({ id: String(ex.id), name: personLabel(ex), email: String(ex.email), status: String(ex.status || 'Active') });
        }
        if (data.action === 'create' && result.existing.length) {
          const ex = result.existing[0];
          throw new ZiteError(`${ex.name} already uses ${ex.email}${ex.status === 'Deactivated' ? ' — they’re deactivated, so reactivate them instead' : ''}.`, 'CONFLICT');
        }
        if (!fresh.length) return result;

        const ids = await insertPeople(
          fresh.map(f => ({ name: f.name, email: f.email, title: data.title, role: data.role, managerId: data.managerId, hireDate: data.hireDate, externalId: data.action === 'create' ? data.externalId : null })),
          { invite: data.sendInvite },
        );
        const people = fresh.map((f, i) => ({ id: ids[i], name: f.name || f.email, email: f.email }));
        const created = await loadPeopleBasics(ids);
        result.created = people.map(p => ({ id: p.id, name: created.get(p.id)?.name ?? p.name, email: p.email, status: data.sendInvite ? 'Invited' : 'Active' }));
        result.id = ids[0] ?? null;

        const activity: ActivityInput[] = result.created.map(p => ({ type: 'person_created', personId: p.id, actorId: actor.id, data: { role: data.role } }));
        if (data.sendInvite) {
          const template = await findTemplate('Invitation');
          for (const p of result.created) {
            const delivery = await sendInvitation(p, settings, template);
            if (data.action === 'create') result.delivery = delivery;
            if (delivery === 'Sent') {
              result.invited++;
              activity.push({ type: 'person_invited', personId: p.id, actorId: actor.id });
            }
          }
        }
        await logActivity(activity);

        for (const groupId of data.groupIds) {
          const res = await addToGroup({ groupId, groupName: groups.get(groupId)?.name ?? 'Group', personIds: ids, actorId: actor.id, settings });
          result.enrolled += res.enrolled;
        }
        result.enrolled += data.action === 'create' ? await applyRulesForNewPerson(ids[0], settings) : await applyEveryoneRules(ids, settings);
        return result;
      }

      case 'update': {
        const person = await loadPersonOrThrow(data.id);
        const record: Record<string, unknown> = {};
        if (data.name !== undefined) {
          if (!data.name.trim()) throw new ZiteError('A person needs a name', 'BAD_REQUEST');
          record.name = data.name.trim();
        }
        if (data.title !== undefined) record.title = data.title.trim() || null;
        if (data.hireDate !== undefined) record.hireDate = data.hireDate;
        if (data.externalId !== undefined) record.externalId = data.externalId.trim() || null;
        if (data.bio !== undefined) record.bio = data.bio.trim() || null;
        if (data.muteEmails !== undefined) record.muteEmails = data.muteEmails;
        if (Object.keys(record).length) await zite.people.update({ id: person.id, record: record as never });

        if (data.groupIds) {
          const wanted = [...new Set(data.groupIds)];
          const groups = await checkGroups(wanted);
          const { rows } = await zite.sql({ query: `SELECT DISTINCT gm."groupId", g."name" FROM "GroupMembers" gm JOIN "Groups" g ON g.id::text = gm."groupId" WHERE gm."personId" = $1`, params: [person.id] });
          const current = new Map(rows.map(r => [String(r.groupId), String(r.name ?? 'Group')]));
          for (const groupId of wanted.filter(g => !current.has(g))) {
            const res = await addToGroup({ groupId, groupName: groups.get(groupId)?.name ?? 'Group', personIds: [person.id], actorId: actor.id, settings, applyRules: person.status !== 'Deactivated' });
            result.enrolled += res.enrolled;
          }
          for (const [groupId, groupName] of current) {
            if (!wanted.includes(groupId)) await removeFromGroup({ groupId, groupName, personIds: [person.id], actorId: actor.id });
          }
        }
        result.id = person.id;
        return result;
      }

      case 'setRole': {
        const person = await loadPersonOrThrow(data.id);
        if (person.role === data.role) return { ...result, id: person.id };
        if (person.role === 'Admin' && person.status !== 'Deactivated') await assertNotLastAdmin([person.id], person.id === actor.id ? 'change your own role' : `change ${person.name}’s role`);
        await zite.people.update({ id: person.id, record: { role: data.role } });
        await logActivity({ type: 'role_changed', personId: person.id, actorId: actor.id, data: { from: person.role, to: data.role } });
        return { ...result, id: person.id };
      }

      case 'setManager': {
        const person = await loadPersonOrThrow(data.id);
        if (data.managerId) {
          if (data.managerId === person.id) throw new ZiteError('Someone can’t be their own manager', 'BAD_REQUEST');
          const manager = await checkManager(data.managerId);
          if (await reportingLoop(person.id, data.managerId)) throw new ZiteError(`${manager?.name ?? 'That person'} already reports to ${person.name}, directly or through others. Pick someone higher up.`, 'BAD_REQUEST');
        }
        await zite.people.update({ id: person.id, record: { managerId: data.managerId } });
        return { ...result, id: person.id };
      }

      case 'deactivate': {
        const person = await loadPersonOrThrow(data.id);
        if (person.id === actor.id) throw new ZiteError('You can’t deactivate yourself. Ask another admin.', 'BAD_REQUEST');
        if (person.status === 'Deactivated') return { ...result, id: person.id };
        if (person.role === 'Admin') await assertNotLastAdmin([person.id], `deactivate ${person.name}`);
        await zite.people.update({ id: person.id, record: { status: 'Deactivated', deactivatedAt: now } });
        if (data.withdrawOpen) result.withdrawn = await withdrawOpenTraining(person.id, actor.id, 'Deactivated');
        await logActivity({ type: 'person_deactivated', personId: person.id, actorId: actor.id, data: { withdrawn: result.withdrawn } });
        return { ...result, id: person.id };
      }

      case 'reactivate': {
        const person = await loadPersonOrThrow(data.id);
        if (person.status !== 'Deactivated') return { ...result, id: person.id };
        const neverSignedIn = !person.lastSeenAt && !person.lastLearnedAt && Boolean(person.invitedAt);
        await zite.people.update({ id: person.id, record: { status: neverSignedIn ? 'Invited' : 'Active', deactivatedAt: null } });
        await logActivity({ type: 'person_reactivated', personId: person.id, actorId: actor.id });
        // Rules skipped them while they were away; anything they were withdrawn from comes back with progress intact.
        result.enrolled += await applyRulesForNewPerson(person.id, settings);
        const { rows } = await zite.sql({ query: `SELECT DISTINCT "groupId" FROM "GroupMembers" WHERE "personId" = $1`, params: [person.id] });
        for (const r of rows) result.enrolled += await applyRulesForGroupJoin([person.id], String(r.groupId), settings);
        return { ...result, id: person.id };
      }

      case 'resendInvite': {
        const person = await loadPersonOrThrow(data.id);
        if (person.status === 'Deactivated') throw new ZiteError(`${person.name} is deactivated. Reactivate them first.`, 'CONFLICT');
        if (person.status === 'Active' && (person.lastSeenAt || person.lastLearnedAt)) throw new ZiteError(`${person.name} has already signed in`, 'CONFLICT');
        const delivery = await sendInvitation(person, settings);
        if (delivery === 'Skipped') throw new ZiteError('The Invitation email template is turned off. Turn it on in Settings → Emails to send invitations.', 'CONFLICT');
        await zite.people.update({ id: person.id, record: { invitedAt: now } });
        if (delivery === 'Sent') await logActivity({ type: 'person_invited', personId: person.id, actorId: actor.id, data: { resent: true } });
        return { ...result, id: person.id, delivery, invited: delivery === 'Sent' ? 1 : 0 };
      }
    }
  },
});
