import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatDateTime } from '@project/shared/merge';
import { logActivity } from '@project/shared/server/activity';
import { loadCourse } from '@project/shared/server/courses';
import { emailPerson, findTemplate } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { canEditCourse, type Actor } from '@project/shared/server/people';
import { learnLink, type OrgSettings } from '@project/shared/server/settings';
import { bool, eachWrite, iso, num, ref, str, withRetry } from '@project/shared/server/sql';

/**
 * Live sessions: an instructor-led event people register for, optionally tied
 * to a course's "Live session" lesson. Seats are first come, first served;
 * past capacity people join a waitlist and move up, in order, when a seat
 * frees. Marking someone Attended completes the linked lesson for them.
 */

export const REGISTRATION_STATUSES = ['Registered', 'Waitlisted', 'Attended', 'Absent', 'Cancelled'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Everyone who holds (or held) a seat. Waitlisted and cancelled people don't. */
export const SEAT_STATUSES: RegistrationStatus[] = ['Registered', 'Attended', 'Absent'];

export const sessionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  courseId: z.string().nullable(),
  courseTitle: z.string().nullable(),
  courseIcon: z.string(),
  courseColor: z.string(),
  courseStatus: z.string().nullable(),
  lessonId: z.string().nullable(),
  lessonTitle: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  timezone: z.string(),
  location: z.string(),
  meetingUrl: z.string().nullable(),
  recordingUrl: z.string().nullable(),
  capacity: z.number().nullable(),
  instructorId: z.string().nullable(),
  instructorName: z.string().nullable(),
  instructorColor: z.string(),
  instructorAvatarUrl: z.string().nullable(),
  status: z.enum(['Scheduled', 'Cancelled']),
  counts: z.object({ registered: z.number(), waitlisted: z.number(), attended: z.number(), absent: z.number(), cancelled: z.number() }),
});
export type SessionRow = z.infer<typeof sessionRowSchema>;

export const SESSION_FROM = `
  FROM "Sessions" s
  LEFT JOIN "Courses" c ON c.id::text = s."courseId"
  LEFT JOIN "Lessons" l ON l.id::text = s."lessonId"
  LEFT JOIN "People" i ON i.id::text = s."instructorId"
  LEFT JOIN (
    SELECT g."sessionId",
      COUNT(*) FILTER (WHERE g."status" = 'Registered') AS "registeredTotal",
      COUNT(*) FILTER (WHERE g."status" = 'Waitlisted') AS "waitlistedTotal",
      COUNT(*) FILTER (WHERE g."status" = 'Attended') AS "attendedTotal",
      COUNT(*) FILTER (WHERE g."status" = 'Absent') AS "absentTotal",
      COUNT(*) FILTER (WHERE g."status" = 'Cancelled') AS "cancelledTotal"
    FROM "Registrations" g GROUP BY g."sessionId"
  ) reg_totals ON reg_totals."sessionId" = s.id::text`;

export const SESSION_COLUMNS = `s.*, c."title" AS "courseTitle", c."icon" AS "courseIcon", c."color" AS "courseColor", c."status" AS "courseStatus",
  l."title" AS "lessonTitle", i."name" AS "instructorName", i."color" AS "instructorColor", i."avatarUrl" AS "instructorAvatarUrl",
  reg_totals."registeredTotal", reg_totals."waitlistedTotal", reg_totals."attendedTotal", reg_totals."absentTotal", reg_totals."cancelledTotal"`;

export function mapSessionRow(r: Record<string, unknown>): SessionRow {
  return {
    id: String(r.id),
    title: str(r.title) || 'Untitled session',
    description: str(r.description) ?? '',
    courseId: ref(r.courseId),
    courseTitle: ref(r.courseTitle),
    courseIcon: str(r.courseIcon) ?? '',
    courseColor: str(r.courseColor) || '#2f6b55',
    courseStatus: ref(r.courseStatus),
    lessonId: ref(r.lessonId) && r.lessonTitle != null ? String(r.lessonId) : null,
    lessonTitle: ref(r.lessonTitle),
    startsAt: iso(r.startsAt),
    endsAt: iso(r.endsAt),
    timezone: str(r.timezone) || 'UTC',
    location: str(r.location) ?? '',
    meetingUrl: ref(r.meetingUrl),
    recordingUrl: ref(r.recordingUrl),
    capacity: r.capacity == null || r.capacity === '' ? null : num(r.capacity),
    instructorId: ref(r.instructorId),
    instructorName: ref(r.instructorName),
    instructorColor: str(r.instructorColor) || '#8b8d98',
    instructorAvatarUrl: ref(r.instructorAvatarUrl),
    status: r.status === 'Cancelled' ? 'Cancelled' : 'Scheduled',
    counts: {
      registered: num(r.registeredTotal),
      waitlisted: num(r.waitlistedTotal),
      attended: num(r.attendedTotal),
      absent: num(r.absentTotal),
      cancelled: num(r.cancelledTotal),
    },
  };
}

export async function loadSession(id: string): Promise<SessionRow | null> {
  const { rows } = await zite.sql({ query: `SELECT ${SESSION_COLUMNS} ${SESSION_FROM} WHERE s.id::text = $1`, params: [id] });
  return rows[0] ? mapSessionRow(rows[0]) : null;
}

/** Admins manage every session; instructors the ones they teach, or on courses they can edit. */
export async function canManageSession(actor: Actor, session: Pick<SessionRow, 'instructorId' | 'courseId'>) {
  if (actor.role === 'Admin') return true;
  if (actor.role !== 'Instructor') return false;
  if (session.instructorId === actor.id) return true;
  if (!session.courseId) return false;
  const course = await loadCourse(session.courseId);
  return Boolean(course && canEditCourse(actor, course));
}

export async function assertCanManageSession(actor: Actor, session: Pick<SessionRow, 'instructorId' | 'courseId'>) {
  if (!(await canManageSession(actor, session))) throw new ZiteError('Only the session’s instructor, the course’s instructors or an admin can change this session', 'FORBIDDEN');
}

export const hasEnded = (s: Pick<SessionRow, 'endsAt' | 'startsAt'>) => {
  const end = s.endsAt ?? s.startsAt;
  return Boolean(end && Date.parse(end) < Date.now());
};

export function sessionLocation(s: Pick<SessionRow, 'location' | 'meetingUrl'>) {
  const place = s.location.trim();
  if (place && s.meetingUrl) return /zoom|meet|teams|online|webex/i.test(place) ? `${place} — ${s.meetingUrl}` : `${place} (or join online: ${s.meetingUrl})`;
  return place || s.meetingUrl || 'Details to follow';
}

export function sessionMergeContext(s: Pick<SessionRow, 'title' | 'startsAt' | 'timezone' | 'location' | 'meetingUrl'>) {
  return { session_title: s.title, session_time: formatDateTime(s.startsAt, s.timezone), session_location: sessionLocation(s) };
}

type RegistrationRow = { id: string; personId: string; status: RegistrationStatus; registeredAt: string | null };

async function loadRegistrations(sessionId: string): Promise<RegistrationRow[]> {
  const { rows } = await zite.sql({ query: `SELECT id, "personId", "status", "registeredAt", created_at FROM "Registrations" WHERE "sessionId" = $1 ORDER BY COALESCE("registeredAt", created_at) ASC, created_at ASC`, params: [sessionId] });
  return rows.map(r => ({ id: String(r.id), personId: String(r.personId), status: (REGISTRATION_STATUSES.includes(r.status as RegistrationStatus) ? r.status : 'Registered') as RegistrationStatus, registeredAt: iso(r.registeredAt) ?? iso(r.created_at) }));
}

type PersonLite = { id: string; name: string; email: string; status: string; muteEmails: boolean };

export async function loadPeopleLite(ids: string[]): Promise<Map<string, PersonLite>> {
  if (!ids.length) return new Map();
  const { rows } = await zite.sql({ query: `SELECT id::text AS id, "name", "email", "status", "muteEmails" FROM "People" WHERE id::text = ANY($1::text[])`, params: [ids] });
  return new Map(rows.map(r => [String(r.id), { id: String(r.id), name: str(r.name) ?? '', email: str(r.email) ?? '', status: str(r.status) || 'Active', muteEmails: bool(r.muteEmails) }]));
}

/** Tell people they have a seat: the in-app notice and the "Session registered" email. */
async function confirmSeats(session: SessionRow, people: PersonLite[], settings: OrgSettings, actorId: string | null, promoted = false) {
  if (!people.length || hasEnded(session)) return;
  const when = formatDateTime(session.startsAt, session.timezone);
  await notify({
    recipientIds: people.map(p => p.id),
    app: 'Learn',
    type: 'session_updated',
    title: promoted ? `A seat opened up: you're registered for ${session.title}` : `You're registered: ${session.title}`,
    body: when,
    courseId: session.courseId,
    actorId,
    link: '/sessions',
  });
  const template = await findTemplate('Session registered');
  if (!template) return;
  const context = sessionMergeContext(session);
  for (const person of people) {
    await emailPerson({ trigger: 'Session registered', template, settings, person, context, link: learnLink(settings, '/sessions'), buttonLabel: 'View your sessions' });
  }
}

/**
 * Register people. Seats go in the order people are added; the rest are
 * waitlisted. Someone who cancelled before is registered again; anyone already
 * registered, waitlisted or marked is left alone.
 */
export async function registerPeople(session: SessionRow, personIds: string[], ctx: { actorId: string; settings: OrgSettings }) {
  const out = { added: 0, waitlisted: 0, skipped: 0 };
  const ids = [...new Set(personIds.filter(Boolean))];
  if (!ids.length) return out;
  const [existing, people] = await Promise.all([loadRegistrations(session.id), loadPeopleLite(ids)]);
  const byPerson = new Map(existing.map(r => [r.personId, r]));
  let seatsTaken = existing.filter(r => SEAT_STATUSES.includes(r.status)).length;
  const now = new Date().toISOString();
  const seated: PersonLite[] = [];
  const waitlisted: PersonLite[] = [];

  for (const personId of ids) {
    const person = people.get(personId);
    if (!person || person.status === 'Deactivated') {
      out.skipped++;
      continue;
    }
    const prior = byPerson.get(personId);
    if (prior && prior.status !== 'Cancelled') {
      out.skipped++;
      continue;
    }
    const hasSeat = session.capacity == null || seatsTaken < session.capacity;
    const status: RegistrationStatus = hasSeat ? 'Registered' : 'Waitlisted';
    if (hasSeat) seatsTaken++;
    if (prior) await withRetry(() => zite.registrations.update({ id: prior.id, record: { status, registeredAt: now, checkedInAt: null, remindedAt: null } }));
    else await withRetry(() => zite.registrations.create({ record: { sessionId: session.id, personId, status, registeredAt: now } }));
    (hasSeat ? seated : waitlisted).push(person);
    if (hasSeat) out.added++;
    else out.waitlisted++;
  }

  await logActivity([...seated, ...waitlisted].map(p => ({ type: 'session_registered' as const, personId: p.id, actorId: ctx.actorId, courseId: session.courseId, lessonId: session.lessonId, data: { sessionId: session.id, sessionTitle: session.title, status: seated.includes(p) ? 'Registered' : 'Waitlisted' } })));
  await confirmSeats(session, seated, ctx.settings, ctx.actorId);
  if (waitlisted.length && !hasEnded(session)) {
    await notify({ recipientIds: waitlisted.map(p => p.id), app: 'Learn', type: 'session_updated', title: `You're on the waitlist for ${session.title}`, body: "The session is full. If a seat opens up you'll be registered automatically and we'll let you know.", courseId: session.courseId, actorId: ctx.actorId, link: '/sessions' });
  }
  return out;
}

/**
 * The people whose seats were cancelled along with a session — the ones to
 * invite back when it's rescheduled. Cancellations are logged with a reason;
 * anyone who cancelled their own seat, or was removed by staff, stays out.
 * Registrations cancelled before reasons were logged count as the session's.
 */
export async function seatsCancelledWith(sessionId: string): Promise<string[]> {
  const { rows: regs } = await zite.sql({ query: `SELECT DISTINCT "personId" FROM "Registrations" WHERE "sessionId" = $1 AND "status" = 'Cancelled'`, params: [sessionId] });
  const personIds = regs.map(r => String(r.personId)).filter(Boolean);
  if (!personIds.length) return [];
  const { rows: logs } = await zite.sql({
    query: `SELECT "personId", "data"::text AS "data" FROM "Activity" WHERE "type" = 'session_cancelled' AND "personId" = ANY($1::text[]) AND "data"::text LIKE $2`,
    params: [personIds, `%${sessionId}%`],
  });
  const reasons = new Map<string, Set<string>>();
  for (const row of logs) {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(String(row.data ?? '{}'));
    } catch {
      continue;
    }
    if (data.sessionId !== sessionId) continue;
    const set = reasons.get(String(row.personId)) ?? new Set<string>();
    set.add(typeof data.reason === 'string' ? data.reason : 'self');
    reasons.set(String(row.personId), set);
  }
  return personIds.filter(id => {
    const set = reasons.get(id);
    return !set || set.has('session');
  });
}

/** Fill free seats from the waitlist, earliest first. Only before the session ends. */
export async function promoteWaitlist(session: SessionRow, ctx: { actorId: string | null; settings: OrgSettings }) {
  if (session.status === 'Cancelled' || hasEnded(session)) return 0;
  const regs = await loadRegistrations(session.id);
  const seatsTaken = regs.filter(r => SEAT_STATUSES.includes(r.status)).length;
  const waiting = regs.filter(r => r.status === 'Waitlisted');
  const free = session.capacity == null ? waiting.length : Math.max(0, session.capacity - seatsTaken);
  const moving = waiting.slice(0, free);
  if (!moving.length) return 0;
  await eachWrite(moving, r => zite.registrations.update({ id: r.id, record: { status: 'Registered', remindedAt: null } }));
  const people = await loadPeopleLite(moving.map(r => r.personId));
  await confirmSeats(session, [...people.values()].filter(p => p.status !== 'Deactivated'), ctx.settings, ctx.actorId, true);
  return moving.length;
}

export const registrationRowSchema = z.object({
  id: z.string(),
  personId: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string().nullable(),
  color: z.string(),
  avatarUrl: z.string().nullable(),
  personStatus: z.string(),
  status: z.enum(REGISTRATION_STATUSES),
  registeredAt: z.string().nullable(),
  checkedInAt: z.string().nullable(),
  remindedAt: z.string().nullable(),
});
