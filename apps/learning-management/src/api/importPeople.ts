import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity, type ActivityInput } from '@project/shared/server/activity';
import { findTemplate } from '@project/shared/server/email';
import { assertStaff, getActor, isEmail, normaliseEmail } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { chunked, day, eachWrite, ref, str } from '@project/shared/server/sql';
import {
  activeAdminIds,
  addToGroup,
  applyEveryoneRules,
  asRoleValue,
  assertPeopleAdmin,
  insertPeople,
  peopleByEmail,
  personLabel,
  sendInvitation,
  type PersonRole,
} from '../server/people-admin';

/**
 * Bulk import from a spreadsheet, keyed by email: new addresses become people,
 * known addresses are updated (blank cells never erase anything). Managers are
 * matched by email — including people created by the same file — and groups by
 * name, optionally creating the ones that don't exist yet.
 *
 * Always run with `dryRun: true` first: it returns exactly what a commit would
 * do, row by row, without writing anything.
 */

const MAX_ROWS = 2000;
const cell = z.string().max(2000).nullable().optional();

const Input = z.object({
  rows: z
    .array(z.object({ name: cell, email: cell, title: cell, managerEmail: cell, groups: cell, hireDate: cell, externalId: cell, role: cell }))
    .min(1, 'The file has no rows to import')
    .max(MAX_ROWS, `Import up to ${MAX_ROWS.toLocaleString()} people at a time — split the file and import the rest after`),
  createMissingGroups: z.boolean().default(false),
  sendInvites: z.boolean().default(false),
  dryRun: z.boolean().default(true),
});

const Output = z.object({
  rows: z.array(
    z.object({
      row: z.number(),
      email: z.string(),
      name: z.string(),
      action: z.enum(['create', 'update', 'skip']),
      errors: z.array(z.string()),
      notes: z.array(z.string()),
      changes: z.array(z.string()),
      personId: z.string().nullable(),
    }),
  ),
  totals: z.object({ create: z.number(), update: z.number(), skip: z.number(), errors: z.number(), groupsToCreate: z.array(z.string()), invited: z.number(), enrolled: z.number() }),
  committed: z.boolean(),
});
type RowResult = z.infer<typeof Output>['rows'][number];

const clean = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

/** YYYY-MM-DD, or M/D/YYYY (US spreadsheets), or a date Excel wrote out in words. */
function parseHireDate(raw: string): string | null | 'invalid' {
  const v = raw.trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  const t = Date.parse(v);
  if (!Number.isNaN(t) && /[a-z]/i.test(v)) return new Date(t).toISOString().slice(0, 10);
  return 'invalid';
  function valid(y: number, mo: number, d: number) {
    const date = new Date(Date.UTC(y, mo - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : 'invalid';
  }
}

function parseRole(raw: string): PersonRole | null | 'invalid' {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === 'admin' || v === 'administrator') return 'Admin';
  if (v === 'instructor' || v === 'teacher' || v === 'trainer') return 'Instructor';
  if (v === 'learner' || v === 'employee' || v === 'student' || v === 'user') return 'Learner';
  return 'invalid';
}

export default createEndpoint({
  description: 'Preview or import people from a CSV: upsert by email, managers by email, groups by name',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    assertPeopleAdmin(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'The file could not be read', 'BAD_REQUEST');
    const { createMissingGroups, sendInvites, dryRun } = parsed.data;

    // ── Read everything the file refers to, in a few queries ──
    const input_ = parsed.data.rows.map((r, i) => ({
      row: i + 1,
      name: clean(r.name),
      rawEmail: clean(r.email),
      email: normaliseEmail(r.email),
      title: clean(r.title),
      managerEmail: normaliseEmail(r.managerEmail),
      groups: clean(r.groups).split(/[;|]/).map(g => g.trim()).filter(Boolean),
      hireDate: clean(r.hireDate),
      externalId: clean(r.externalId),
      role: clean(r.role),
    }));
    const existing = await peopleByEmail([...input_.map(r => r.email), ...input_.map(r => r.managerEmail)].filter(e => e && isEmail(e)));
    const { rows: groupRows } = await zite.sql({ query: `SELECT id::text AS id, "name" FROM "Groups"`, params: [] });
    const groupByName = new Map(groupRows.map(g => [String(g.name ?? '').trim().toLowerCase(), { id: String(g.id), name: String(g.name) }]));

    const fileEmails = new Map<string, number>();
    const results: RowResult[] = [];
    const groupsToCreate = new Map<string, string>();
    const plans: Array<{ r: (typeof input_)[number]; result: RowResult; role: PersonRole | null; hireDate: string | null; existingId: string | null; record: Record<string, unknown> }> = [];

    for (const r of input_) {
      const result: RowResult = { row: r.row, email: r.email || r.rawEmail, name: r.name, action: 'skip', errors: [], notes: [], changes: [], personId: null };
      results.push(result);
      if (!r.email) {
        result.errors.push('Email is missing');
        continue;
      }
      if (!isEmail(r.email)) {
        result.errors.push(`“${r.rawEmail}” isn't a valid email address`);
        continue;
      }
      if (fileEmails.has(r.email)) {
        result.errors.push(`Same email as row ${fileEmails.get(r.email)} — only the first is imported`);
        continue;
      }
      fileEmails.set(r.email, r.row);

      const role = parseRole(r.role);
      if (role === 'invalid') result.errors.push(`Role “${r.role}” isn't Admin, Instructor or Learner`);
      const hireDate = parseHireDate(r.hireDate);
      if (hireDate === 'invalid') result.errors.push(`Hire date “${r.hireDate}” isn't a date — use YYYY-MM-DD`);
      if (r.managerEmail) {
        if (r.managerEmail === r.email) result.errors.push('Someone can’t be their own manager');
        else if (!isEmail(r.managerEmail)) result.errors.push(`Manager email “${r.managerEmail}” isn't valid`);
      }
      for (const g of r.groups) {
        const key = g.toLowerCase();
        if (groupByName.has(key)) continue;
        if (createMissingGroups) {
          if (!groupsToCreate.has(key)) groupsToCreate.set(key, g);
          result.notes.push(`Creates the group “${g}”`);
        } else result.errors.push(`There's no group called “${g}”`);
      }
      const ex = existing.get(r.email);
      const record: Record<string, unknown> = {};
      if (ex) {
        result.personId = String(ex.id);
        result.name = r.name || str(ex.name) || r.email;
        if (r.name && r.name !== str(ex.name)) (record.name = r.name), result.changes.push('name');
        if (r.title && r.title !== (str(ex.title) ?? '')) (record.title = r.title), result.changes.push('title');
        if (r.externalId && r.externalId !== (str(ex.externalId) ?? '')) (record.externalId = r.externalId), result.changes.push('employee ID');
        if (hireDate && hireDate !== 'invalid' && hireDate !== day(ex.hireDate)) (record.hireDate = hireDate), result.changes.push('hire date');
        if (role && role !== 'invalid' && role !== asRoleValue(ex.role)) (record.role = role), result.changes.push('role');
        if (ex.status === 'Deactivated') result.notes.push('Deactivated — details update, access stays off');
      }
      plans.push({ r, result, role: role === 'invalid' ? null : role, hireDate: hireDate === 'invalid' ? null : hireDate, existingId: ex ? String(ex.id) : null, record });
    }

    // ── Managers (second pass: they may be defined further down the file) ──
    const creatable = (email: string) => plans.some(p => p.r.email === email && !p.result.errors.length);
    const fileManager = new Map<string, string>();
    for (const plan of plans) if (!plan.result.errors.length && plan.r.managerEmail) fileManager.set(plan.r.email, plan.r.managerEmail);
    const emailById = new Map<string, string>([...existing].map(([email, ex]) => [String(ex.id), email]));
    /** Who someone reports to once this file is applied: the file wins, then the directory. */
    const managerOf = async (email: string): Promise<string | null> => {
      if (fileManager.has(email)) return fileManager.get(email)!;
      const managerId = ref(existing.get(email)?.managerId);
      if (!managerId) return null;
      if (!emailById.has(managerId)) {
        const { rows } = await zite.sql({ query: `SELECT id::text AS id, LOWER("email") AS "emailKey", "name", "managerId" FROM "People" WHERE id::text = $1`, params: [managerId] });
        if (!rows[0]) return null;
        emailById.set(managerId, String(rows[0].emailKey));
        if (!existing.has(String(rows[0].emailKey))) existing.set(String(rows[0].emailKey), rows[0]);
      }
      return emailById.get(managerId) ?? null;
    };
    for (const plan of plans) {
      const { r, result } = plan;
      if (!r.managerEmail || result.errors.length) continue;
      const known = existing.get(r.managerEmail);
      if (!known && !creatable(r.managerEmail)) {
        const managerRow = plans.find(p => p.r.email === r.managerEmail);
        result.errors.push(managerRow ? `Their manager on row ${managerRow.r.row} isn't being imported, so it can't be set` : `No one with the email ${r.managerEmail} — add them to this file, or add them under People first`);
        fileManager.delete(r.email);
        continue;
      }
      let cursor: string | null = r.managerEmail;
      for (let depth = 0; cursor && depth < 200; depth++) {
        if (cursor === r.email) {
          result.errors.push(`${known ? personLabel(known) : r.managerEmail} would end up reporting to this person, so they can't be their manager`);
          fileManager.delete(r.email);
          break;
        }
        cursor = await managerOf(cursor);
      }
      if (result.errors.length) continue;
      if (!known) result.notes.push('Manager is added by this file');
      if (plan.existingId && (!known || ref(existing.get(r.email)?.managerId) !== String(known.id))) result.changes.push('manager');
    }
    // Groups the person would join that they aren't in yet count as a change for existing people.
    const existingIds = plans.filter(p => p.existingId && p.r.groups.length).map(p => p.existingId!);
    const memberships = new Set<string>();
    if (existingIds.length) {
      const { rows } = await zite.sql({ query: `SELECT "personId", "groupId" FROM "GroupMembers" WHERE "personId" = ANY($1::text[])`, params: [existingIds] });
      for (const m of rows) memberships.add(`${m.personId}:${m.groupId}`);
    }

    for (const plan of plans) {
      const { r, result } = plan;
      if (result.errors.length) {
        result.action = 'skip';
        continue;
      }
      if (!plan.existingId) {
        result.action = 'create';
        result.name = r.name || r.email;
        continue;
      }
      const newGroups = r.groups.filter(g => {
        const known = groupByName.get(g.toLowerCase());
        return !known || !memberships.has(`${plan.existingId}:${known.id}`);
      });
      if (newGroups.length) result.changes.push(newGroups.length === 1 ? `joins ${newGroups[0]}` : `joins ${newGroups.length} groups`);
      result.action = result.changes.length ? 'update' : 'skip';
      if (!result.changes.length) result.notes.push('Already up to date');
    }

    // Demoting every admin through a file is refused before anything is written.
    const demoted = new Set(plans.filter(p => p.result.action === 'update' && p.record.role && p.record.role !== 'Admin' && existing.get(p.r.email)?.role === 'Admin').map(p => p.existingId!));
    if (demoted.size) {
      const admins = await activeAdminIds();
      if (admins.length && admins.every(id => demoted.has(id))) {
        for (const p of plans) if (demoted.has(p.existingId!)) p.result.errors.push('This workspace needs at least one active admin — this row would remove the last one'), (p.result.action = 'skip');
      }
    }

    const totals = {
      create: results.filter(r => r.action === 'create').length,
      update: results.filter(r => r.action === 'update').length,
      skip: results.filter(r => r.action === 'skip').length,
      errors: results.filter(r => r.errors.length).length,
      groupsToCreate: [...groupsToCreate.values()].filter(name => plans.some(p => p.result.action !== 'skip' && p.r.groups.some(g => g.toLowerCase() === name.toLowerCase()))),
      invited: 0,
      enrolled: 0,
    };
    if (dryRun) return { rows: results, totals, committed: false };

    // ── Commit ──
    const settings = await getSettings();
    const activity: ActivityInput[] = [];

    for (const name of totals.groupsToCreate) {
      const { rows } = await zite.sql({ query: `SELECT COALESCE(MAX("position"), 0) AS "top" FROM "Groups"`, params: [] });
      const created = await zite.groups.create({ record: { name, kind: 'Team', description: null, color: '#64748b', ownerId: null, position: Number(rows[0]?.top ?? 0) + 1 } });
      groupByName.set(name.toLowerCase(), { id: created.id, name });
    }

    // Pass 1: people. New people first, without managers; updates without managers.
    const creates = plans.filter(p => p.result.action === 'create');
    const newIds = await insertPeople(
      creates.map(p => ({ name: p.r.name, email: p.r.email, title: p.r.title, role: p.role ?? 'Learner', hireDate: p.hireDate, externalId: p.r.externalId })),
      { invite: sendInvites },
    );
    const idByEmail = new Map<string, string>();
    for (const [email, ex] of existing) idByEmail.set(email, String(ex.id));
    creates.forEach((p, i) => {
      p.result.personId = newIds[i];
      idByEmail.set(p.r.email, newIds[i]);
      activity.push({ type: 'person_created', personId: newIds[i], actorId: actor.id, data: { source: 'import' } });
    });
    const updates = plans.filter(p => p.result.action === 'update' && p.existingId && Object.keys(p.record).length);
    await eachWrite(updates, p => zite.people.update({ id: p.existingId!, record: p.record as never }));
    for (const p of updates) if (p.record.role) activity.push({ type: 'role_changed', personId: p.existingId!, actorId: actor.id, data: { from: asRoleValue(existing.get(p.r.email)?.role), to: p.record.role } });

    // Pass 2: managers, now that everyone in the file has an id.
    const managerWrites = plans
      .filter(p => p.result.action !== 'skip' && p.r.managerEmail && idByEmail.has(p.r.managerEmail) && p.result.personId)
      .filter(p => p.result.action === 'create' || p.result.changes.includes('manager'))
      .map(p => ({ id: p.result.personId!, managerId: idByEmail.get(p.r.managerEmail)! }));
    await eachWrite(managerWrites, w => zite.people.update({ id: w.id, record: { managerId: w.managerId } }));

    // Invitations go out before rules send "Course assigned" emails, so the welcome arrives first.
    if (sendInvites && creates.length) {
      const template = await findTemplate('Invitation');
      for (const p of creates) {
        const delivery = await sendInvitation({ email: p.r.email, name: p.r.name || p.r.email }, settings, template);
        if (delivery === 'Sent') {
          totals.invited++;
          activity.push({ type: 'person_invited', personId: p.result.personId, actorId: actor.id });
        }
      }
    }

    // Groups, with their rules.
    const joins = new Map<string, string[]>();
    for (const p of plans) {
      if (p.result.action === 'skip' || !p.result.personId) continue;
      for (const g of p.r.groups) {
        const group = groupByName.get(g.toLowerCase());
        if (group) joins.set(group.id, [...(joins.get(group.id) ?? []), p.result.personId]);
      }
    }
    for (const [groupId, personIds] of joins) {
      const name = [...groupByName.values()].find(g => g.id === groupId)?.name ?? 'Group';
      const res = await addToGroup({ groupId, groupName: name, personIds, actorId: actor.id, settings });
      totals.enrolled += res.enrolled;
    }
    totals.enrolled += await applyEveryoneRules(newIds, settings);
    await chunked(activity, async batch => logActivity(batch), 500);
    return { rows: results, totals, committed: true };
  },
});
