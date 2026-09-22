import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity, type ActivityInput } from '@project/shared/server/activity';
import { emailPerson, findTemplate, type TemplateRow } from '@project/shared/server/email';
import { colorFor, isEmail, nameFromEmail, normaliseEmail, type Actor } from '@project/shared/server/people';
import { applyRule, applyRulesForGroupJoin, toRule } from '@project/shared/server/rules';
import { learnLink, type OrgSettings } from '@project/shared/server/settings';
import { chunked, eachWrite, iso, Params, ref, str } from '@project/shared/server/sql';

/**
 * The people directory for staff: filtering and paging people with their
 * training counts, memberships, managers and the guards around roles and
 * access. Every people/group endpoint in the admin app reads through here.
 *
 * Organizations can have thousands of people, so nothing here loads the whole
 * directory: lists are filtered and paged in SQL, and writes touch only the
 * rows they change.
 */

export const ROLE_VALUES = ['Admin', 'Instructor', 'Learner'] as const;
export type PersonRole = (typeof ROLE_VALUES)[number];
export const STATUS_VALUES = ['Active', 'Invited', 'Deactivated'] as const;
export const PEOPLE_TABS = ['everyone', 'learners', 'staff', 'invited', 'deactivated'] as const;
export type PeopleTab = (typeof PEOPLE_TABS)[number];
export const PEOPLE_ORDERINGS = ['name', 'recent_activity', 'overdue_desc', 'hired_desc'] as const;
export type PeopleOrdering = (typeof PEOPLE_ORDERINGS)[number];
export const COMPLIANCE_FILTERS = ['overdue', 'on_track', 'not_started', 'no_training'] as const;
export const GROUP_KIND_VALUES = ['Department', 'Team', 'Location', 'Cohort', 'Customer', 'Partner'] as const;

export const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31');

export const peopleFilterSchema = z.object({
  q: z.string().max(200).optional(),
  tab: z.enum(PEOPLE_TABS).optional(),
  roles: z.array(z.enum(ROLE_VALUES)).max(3).optional(),
  statuses: z.array(z.enum(STATUS_VALUES)).max(3).optional(),
  groupIds: z.array(z.string()).max(200).optional(),
  /** A person id, or "none" for people without a manager. */
  managerId: z.string().max(100).optional(),
  compliance: z.enum(COMPLIANCE_FILTERS).optional(),
});
export type PeopleFilters = z.infer<typeof peopleFilterSchema>;

export const ADMIN_ONLY = 'Only admins can add or change people. Instructors can view people and enroll them in training.';

export function assertPeopleAdmin(actor: Actor) {
  if (actor.role !== 'Admin') throw new ZiteError(ADMIN_ONLY, 'FORBIDDEN');
}

// ── SQL building blocks ───────────────────────────────────────────────────

/** Only the newest recertification cycle of each course counts toward a person's numbers. */
export const LATEST_CYCLE = (alias = 'e') =>
  `NOT EXISTS (SELECT 1 FROM "Enrollments" later WHERE later."personId" = ${alias}."personId" AND later."courseId" = ${alias}."courseId" AND COALESCE(later."cycle", 1) > COALESCE(${alias}."cycle", 1))`;

const OPEN = (alias = 'e') => `${alias}."status" IN ('Not started', 'In progress')`;

/**
 * Per-person training numbers, as CTEs to join onto "People" p.
 * `narrow` limits the scan to some people, given the person-id column
 * (e.g. `col => \`${col} = ANY($1::text[])\``) when the caller already knows who.
 */
export function statsCtes(narrow?: (column: string) => string) {
  const onlyEnrollments = narrow ? ` AND ${narrow('e."personId"')}` : '';
  const onlyCertificates = narrow ? ` AND ${narrow('ce."personId"')}` : '';
  return `
    enrollment_stats AS (
      SELECT e."personId" AS "pid",
        COUNT(*) FILTER (WHERE ${OPEN()}) AS "openTotal",
        COUNT(*) FILTER (WHERE ${OPEN()} AND e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overdueTotal",
        COUNT(*) FILTER (WHERE e."status" = 'Completed') AS "doneTotal",
        COUNT(*) FILTER (WHERE e."status" IN ('In progress', 'Completed')) AS "startedTotal",
        MAX(e."lastActivityAt") AS "lastActivity"
      FROM "Enrollments" e
      WHERE COALESCE(e."status", '') <> 'Withdrawn' AND ${LATEST_CYCLE()}${onlyEnrollments}
      GROUP BY e."personId"
    ),
    certificate_stats AS (
      SELECT ce."personId" AS "pid", COUNT(*) AS "certTotal"
      FROM "Certificates" ce
      WHERE ce."status" = 'Active' AND (ce."expiresAt" IS NULL OR ce."expiresAt" > NOW())${onlyCertificates}
      GROUP BY ce."personId"
    )`;
}

const ROLE_SQL = `COALESCE(NULLIF(p."role", ''), 'Learner')`;
const STATUS_SQL = `COALESCE(NULLIF(p."status", ''), 'Active')`;

function tabClause(tab: PeopleTab | undefined) {
  switch (tab) {
    case 'learners':
      return `(${ROLE_SQL} = 'Learner' AND ${STATUS_SQL} <> 'Deactivated')`;
    case 'staff':
      return `(${ROLE_SQL} IN ('Admin', 'Instructor') AND ${STATUS_SQL} <> 'Deactivated')`;
    case 'invited':
      return `(${STATUS_SQL} = 'Invited')`;
    case 'deactivated':
      return `(${STATUS_SQL} = 'Deactivated')`;
    case 'everyone':
    default:
      return `(${STATUS_SQL} <> 'Deactivated')`;
  }
}

/** Filters except the tab, roles and statuses — those split the tab counts. */
export function basePeopleWhere(f: PeopleFilters, p: Params) {
  const w: string[] = [];
  const q = f.q?.trim().toLowerCase();
  if (q) {
    const like = p.add(`%${q}%`);
    w.push(`(LOWER(COALESCE(p."name", '')) LIKE ${like} OR LOWER(COALESCE(p."email", '')) LIKE ${like} OR LOWER(COALESCE(p."title", '')) LIKE ${like} OR LOWER(COALESCE(p."externalId", '')) LIKE ${like})`);
  }
  if (f.groupIds?.length) w.push(`EXISTS (SELECT 1 FROM "GroupMembers" gm WHERE gm."personId" = p.id::text AND gm."groupId" = ANY(${p.add(f.groupIds)}::text[]))`);
  if (f.managerId === 'none') w.push(`COALESCE(p."managerId", '') = ''`);
  else if (f.managerId) w.push(`p."managerId" = ${p.add(f.managerId)}`);
  switch (f.compliance) {
    case 'overdue':
      w.push(`COALESCE(es."overdueTotal", 0) > 0`);
      break;
    case 'not_started':
      w.push(`COALESCE(es."overdueTotal", 0) = 0 AND COALESCE(es."openTotal", 0) > 0 AND COALESCE(es."startedTotal", 0) = 0`);
      break;
    case 'on_track':
      w.push(`COALESCE(es."overdueTotal", 0) = 0 AND COALESCE(es."startedTotal", 0) > 0`);
      break;
    case 'no_training':
      w.push(`COALESCE(es."openTotal", 0) = 0 AND COALESCE(es."doneTotal", 0) = 0`);
      break;
  }
  return w;
}

export function scopeClause(f: PeopleFilters, p: Params) {
  const w = [tabClause(f.tab)];
  if (f.roles?.length) w.push(`${ROLE_SQL} = ANY(${p.add(f.roles)}::text[])`);
  if (f.statuses?.length) w.push(`${STATUS_SQL} = ANY(${p.add(f.statuses)}::text[])`);
  return w.join(' AND ');
}

export function peopleOrderBy(o: PeopleOrdering) {
  const name = `LOWER(COALESCE(NULLIF(p."name", ''), p."email")) ASC, p.id ASC`;
  switch (o) {
    case 'recent_activity':
      return `GREATEST(p."lastLearnedAt", p."lastSeenAt", es."lastActivity") DESC NULLS LAST, ${name}`;
    case 'overdue_desc':
      return `COALESCE(es."overdueTotal", 0) DESC, COALESCE(es."openTotal", 0) DESC, ${name}`;
    case 'hired_desc':
      return `p."hireDate" DESC NULLS LAST, ${name}`;
    case 'name':
    default:
      return name;
  }
}

export const PERSON_COLUMNS = `p.id, p."name", p."email", p."title", p."role", p."status", p."color", p."avatarUrl", p."managerId", p."hireDate", p."externalId", p."lastLearnedAt", p."lastSeenAt", p."invitedAt", p."deactivatedAt"`;

export const asRoleValue = (v: unknown): PersonRole => (v === 'Admin' || v === 'Instructor' ? v : 'Learner');
export const asStatusValue = (v: unknown): (typeof STATUS_VALUES)[number] => (v === 'Invited' || v === 'Deactivated' ? v : 'Active');

export const splitIds = (v: unknown) => (v ? String(v).split(',').filter(Boolean) : []);

export function lastActive(r: Record<string, unknown>) {
  const times = [iso(r.lastLearnedAt), iso(r.lastSeenAt), iso(r.lastActivity)].filter(Boolean) as string[];
  return times.length ? times.sort().at(-1)! : null;
}

// ── Lookups ───────────────────────────────────────────────────────────────

export type PersonBasics = { id: string; name: string; email: string; role: PersonRole; status: string; managerId: string | null; invitedAt: string | null; lastSeenAt: string | null; lastLearnedAt: string | null; muteEmails: boolean };

export async function loadPeopleBasics(ids: string[]): Promise<Map<string, PersonBasics>> {
  const out = new Map<string, PersonBasics>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 1000) {
    const { rows } = await zite.sql({
      query: `SELECT id::text AS id, "name", "email", "role", "status", "managerId", "invitedAt", "lastSeenAt", "lastLearnedAt", "muteEmails" FROM "People" WHERE id::text = ANY($1::text[])`,
      params: [unique.slice(i, i + 1000)],
    });
    for (const r of rows) {
      out.set(String(r.id), {
        id: String(r.id),
        name: str(r.name) || str(r.email) || 'Unnamed',
        email: str(r.email) ?? '',
        role: asRoleValue(r.role),
        status: asStatusValue(r.status),
        managerId: ref(r.managerId),
        invitedAt: iso(r.invitedAt),
        lastSeenAt: iso(r.lastSeenAt),
        lastLearnedAt: iso(r.lastLearnedAt),
        muteEmails: r.muteEmails === true,
      });
    }
  }
  return out;
}

export async function loadPersonOrThrow(id: string) {
  const person = (await loadPeopleBasics([id])).get(id);
  if (!person) throw new ZiteError('That person no longer exists', 'NOT_FOUND');
  return person;
}

export async function peopleByEmail(emails: string[]) {
  const out = new Map<string, Record<string, unknown>>();
  const unique = [...new Set(emails.map(normaliseEmail).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 1000) {
    const { rows } = await zite.sql({
      query: `SELECT id::text AS id, LOWER("email") AS "emailKey", "name", "email", "title", "role", "status", "managerId", "hireDate", "externalId" FROM "People" WHERE LOWER("email") = ANY($1::text[]) ORDER BY created_at ASC`,
      params: [unique.slice(i, i + 1000)],
    });
    for (const r of rows) if (!out.has(String(r.emailKey))) out.set(String(r.emailKey), r);
  }
  return out;
}

export async function activeAdminIds(): Promise<string[]> {
  const { rows } = await zite.sql({ query: `SELECT id::text AS id FROM "People" WHERE "role" = 'Admin' AND COALESCE("status", '') <> 'Deactivated'`, params: [] });
  return rows.map(r => String(r.id));
}

/** Refuses to leave the organization without an active admin. */
export async function assertNotLastAdmin(personIds: string[], verb: string) {
  const admins = await activeAdminIds();
  const leaving = new Set(personIds);
  if (admins.length && admins.every(id => leaving.has(id))) {
    throw new ZiteError(`This workspace needs at least one active admin. Make someone else an admin before you ${verb}.`, 'CONFLICT');
  }
}

/**
 * Would making `managerId` the manager of `personId` create a reporting loop?
 * Walks up from the manager; `overrides` are pending changes (for imports).
 * Returns the name chain when it loops, for a useful error.
 */
export async function reportingLoop(personId: string, managerId: string, overrides = new Map<string, string | null>()): Promise<boolean> {
  if (personId === managerId) return true;
  const cache = new Map<string, string | null>(overrides);
  let current: string | null = managerId;
  for (let depth = 0; current && depth < 200; depth++) {
    if (current === personId) return true;
    if (!cache.has(current)) {
      const { rows } = await zite.sql({ query: `SELECT "managerId" FROM "People" WHERE id::text = $1`, params: [current] });
      cache.set(current, ref(rows[0]?.managerId));
    }
    current = cache.get(current) ?? null;
  }
  return false;
}

// ── Invitations ───────────────────────────────────────────────────────────

export async function sendInvitation(person: { email: string; name: string }, settings: OrgSettings, template?: TemplateRow | null) {
  const link = learnLink(settings);
  return emailPerson({
    trigger: 'Invitation',
    template: template === undefined ? await findTemplate('Invitation') : template,
    settings,
    person: { email: person.email, name: person.name },
    link: link || null,
    buttonLabel: `Open ${settings.academyName}`,
  });
}

// ── Memberships ───────────────────────────────────────────────────────────

export async function existingMemberships(groupId: string, personIds: string[]) {
  const out = new Map<string, string[]>();
  for (let i = 0; i < personIds.length; i += 1000) {
    const { rows } = await zite.sql({
      query: `SELECT id::text AS id, "personId" FROM "GroupMembers" WHERE "groupId" = $1 AND "personId" = ANY($2::text[])`,
      params: [groupId, personIds.slice(i, i + 1000)],
    });
    for (const r of rows) out.set(String(r.personId), [...(out.get(String(r.personId)) ?? []), String(r.id)]);
  }
  return out;
}

/**
 * Add people to a group: skips existing members, applies group rules that
 * include future members, and logs each join. Returns who was added and how
 * many enrollments the rules created.
 */
export async function addToGroup(opts: { groupId: string; groupName: string; personIds: string[]; actorId: string | null; settings: OrgSettings; applyRules?: boolean; log?: boolean }) {
  const ids = [...new Set(opts.personIds.filter(Boolean))];
  if (!ids.length) return { added: [] as string[], enrolled: 0 };
  const existing = await existingMemberships(opts.groupId, ids);
  const toAdd = ids.filter(id => !existing.has(id));
  const now = new Date().toISOString();
  await chunked(toAdd, async batch => {
    await zite.groupMembers.bulkCreate({ records: batch.map(personId => ({ groupId: opts.groupId, personId, addedAt: now, addedById: opts.actorId })) });
  });
  let enrolled = 0;
  if (toAdd.length && opts.applyRules !== false) {
    const people = await loadPeopleBasics(toAdd);
    const active = toAdd.filter(id => people.get(id)?.status !== 'Deactivated');
    enrolled = await applyRulesForGroupJoin(active, opts.groupId, opts.settings);
  }
  if (opts.log !== false && toAdd.length) {
    await logActivity(toAdd.map(personId => ({ type: 'group_joined' as const, personId, actorId: opts.actorId, data: { groupId: opts.groupId, groupName: opts.groupName } })));
  }
  return { added: toAdd, enrolled };
}

export async function removeFromGroup(opts: { groupId: string; groupName: string; personIds: string[]; actorId: string | null; log?: boolean }) {
  const ids = [...new Set(opts.personIds.filter(Boolean))];
  if (!ids.length) return [] as string[];
  const existing = await existingMemberships(opts.groupId, ids);
  const rowIds = [...existing.values()].flat();
  await eachWrite(rowIds, id => zite.groupMembers.delete({ id }));
  const removed = [...existing.keys()];
  if (opts.log !== false && removed.length) {
    await logActivity(removed.map(personId => ({ type: 'group_left' as const, personId, actorId: opts.actorId, data: { groupId: opts.groupId, groupName: opts.groupName } })));
  }
  return removed;
}

export async function loadGroupsByIds(ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; name: string; ownerId: string | null }>();
  const { rows } = await zite.sql({ query: `SELECT id::text AS id, "name", "ownerId" FROM "Groups" WHERE id::text = ANY($1::text[])`, params: [[...new Set(ids)]] });
  return new Map(rows.map(r => [String(r.id), { id: String(r.id), name: str(r.name) ?? 'Group', ownerId: ref(r.ownerId) }]));
}

/** "Everyone" rules that include future members, applied once to a batch of newcomers. */
export async function applyEveryoneRules(personIds: string[], settings: OrgSettings) {
  if (!personIds.length) return 0;
  const { rows } = await zite.sql({
    query: `SELECT * FROM "AssignmentRules" WHERE "status" = 'Active' AND COALESCE("includeFutureMembers", false) = true AND "audience" = 'Everyone' ORDER BY created_at ASC`,
    params: [],
  });
  let enrolled = 0;
  for (const rule of rows.map(toRule)) {
    const res = await applyRule(rule, { onlyPersonIds: personIds, settings }).catch(e => (console.error('Rule failed', rule.id, e), null));
    enrolled += (res?.created.length ?? 0) + (res?.reactivated.length ?? 0);
  }
  return enrolled;
}

// ── Access changes ────────────────────────────────────────────────────────

/** Withdraw everything a person hasn't finished. Completed training stays on their record. */
export async function withdrawOpenTraining(personId: string, actorId: string, note: string) {
  const now = new Date().toISOString();
  const { rows } = await zite.sql({ query: `SELECT id::text AS id, "courseId" FROM "Enrollments" WHERE "personId" = $1 AND "status" IN ('Not started', 'In progress')`, params: [personId] });
  const { rows: paths } = await zite.sql({ query: `SELECT id::text AS id FROM "PathEnrollments" WHERE "personId" = $1 AND "status" IN ('Not started', 'In progress')`, params: [personId] });
  await eachWrite(rows, r => zite.enrollments.update({ id: String(r.id), record: { status: 'Withdrawn', withdrawnAt: now } }));
  await eachWrite(paths, r => zite.pathEnrollments.update({ id: String(r.id), record: { status: 'Withdrawn', withdrawnAt: now } }));
  const entries: ActivityInput[] = rows.map(r => ({ type: 'withdrawn', personId, actorId, courseId: String(r.courseId), enrollmentId: String(r.id), data: { note } }));
  await logActivity(entries);
  return rows.length;
}

// ── Creating people ───────────────────────────────────────────────────────

export type NewPersonInput = {
  name?: string | null;
  email: string;
  title?: string | null;
  role?: PersonRole;
  managerId?: string | null;
  hireDate?: string | null;
  externalId?: string | null;
};

/** Insert people (already validated and de-duplicated). Returns ids in input order. */
export async function insertPeople(list: NewPersonInput[], opts: { invite: boolean }) {
  const now = new Date().toISOString();
  const ids: string[] = [];
  await chunked(list, async batch => {
    const res = await zite.people.bulkCreate({
      records: batch.map(p => {
        const email = normaliseEmail(p.email);
        return {
          name: (p.name ?? '').trim() || nameFromEmail(email),
          email,
          role: p.role ?? 'Learner',
          status: opts.invite ? 'Invited' : 'Active',
          title: (p.title ?? '').trim() || null,
          managerId: p.managerId || null,
          hireDate: p.hireDate || null,
          externalId: (p.externalId ?? '').trim() || null,
          color: colorFor(email),
          muteEmails: false,
          invitedAt: opts.invite ? now : null,
        };
      }) as never,
    });
    ids.push(...res.records.map(r => r.id));
  });
  return ids;
}

export function validateNewEmail(raw: string) {
  const email = normaliseEmail(raw);
  if (!email) return { email, error: 'Enter an email address' };
  if (!isEmail(email)) return { email, error: `“${raw.trim()}” isn't a valid email address` };
  return { email, error: null };
}

export const personLabel = (p: { name?: unknown; email?: unknown }) => str(p.name) || str(p.email) || 'Someone';
