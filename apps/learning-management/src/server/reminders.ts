import { zite } from 'zitejs/db';
import { formatDateTime, formatLongDay } from '@project/shared/merge';
import { daysLeftLabel } from '@project/shared/server/enroll';
import { emailPerson, findTemplate } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { runRecertification } from '@project/shared/server/rules';
import { learnLink, type OrgSettings } from '@project/shared/server/settings';
import { bool, day, iso, ref, str, withRetry } from '@project/shared/server/sql';
import { sessionMergeContext } from './sessions';

/**
 * The daily nudges, run at 14:00 UTC (and by hand from Assignment rules).
 *
 * Every nudge is idempotent through a timestamp on the row it's about
 * (`remindedAt`, `overdueNotifiedAt`) or a recent notification, so a retry, an
 * overlap or a manual run straight after the scheduled one never sends twice.
 * Each query is bounded; anything left over is picked up the next day.
 *
 * Course enrollments that belong to a learning path are reminded through the
 * path, so a learner with a five-course path gets one nudge, not six.
 */

const BATCH = 1000;

export type ReminderCounts = {
  dueSoon: number;
  overdue: number;
  managerDigests: number;
  recertified: number;
  expiringCertificates: number;
  sessionReminders: number;
};

type Open = {
  kind: 'course' | 'path';
  id: string;
  personId: string;
  personName: string;
  personEmail: string;
  muteEmails: boolean;
  managerId: string | null;
  targetId: string;
  title: string;
  slug: string;
  dueDate: string;
};

const shortDay = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T12:00:00Z`));

/** Open course (outside paths) and path enrollments matching a due-date condition, active learners only. */
async function openEnrollments(condition: string, stampColumn: 'remindedAt' | 'overdueNotifiedAt' | null, olderThan: string | null): Promise<Open[]> {
  const stamp = (alias: string) => (stampColumn && olderThan ? `AND (${alias}."${stampColumn}" IS NULL OR ${alias}."${stampColumn}" < NOW() - INTERVAL '${olderThan}')` : '');
  const { rows } = await zite.sql({
    query: `
      SELECT 'course' AS "kind", e.id::text AS id, e."personId", p."name" AS "personName", p."email" AS "personEmail", p."muteEmails", p."managerId",
        c.id::text AS "targetId", c."title", c."slug", e."dueDate"
      FROM "Enrollments" e
      JOIN "People" p ON p.id::text = e."personId"
      JOIN "Courses" c ON c.id::text = e."courseId"
      WHERE e."status" IN ('Not started', 'In progress') AND e."dueDate" IS NOT NULL AND ${condition.replace(/\$due/g, 'e."dueDate"')}
        AND COALESCE(p."status", '') <> 'Deactivated' AND COALESCE(c."status", '') <> 'Archived'
        AND NOT (e."source" = 'Path' AND COALESCE(e."pathEnrollmentId", '') <> '')
        ${stamp('e')}
      UNION ALL
      SELECT 'path' AS "kind", pe.id::text AS id, pe."personId", p."name" AS "personName", p."email" AS "personEmail", p."muteEmails", p."managerId",
        pa.id::text AS "targetId", pa."title", pa."slug", pe."dueDate"
      FROM "PathEnrollments" pe
      JOIN "People" p ON p.id::text = pe."personId"
      JOIN "Paths" pa ON pa.id::text = pe."pathId"
      WHERE pe."status" IN ('Not started', 'In progress') AND pe."dueDate" IS NOT NULL AND ${condition.replace(/\$due/g, 'pe."dueDate"')}
        AND COALESCE(p."status", '') <> 'Deactivated' AND COALESCE(pa."status", '') <> 'Archived'
        ${stamp('pe')}
      ORDER BY "dueDate" ASC
      LIMIT ${BATCH}`,
    params: [],
  });
  return rows.map(r => ({
    kind: r.kind === 'path' ? 'path' : 'course',
    id: String(r.id),
    personId: String(r.personId),
    personName: str(r.personName) ?? '',
    personEmail: str(r.personEmail) ?? '',
    muteEmails: bool(r.muteEmails),
    managerId: ref(r.managerId),
    targetId: String(r.targetId),
    title: str(r.title) ?? '',
    slug: str(r.slug) ?? '',
    dueDate: day(r.dueDate) ?? '',
  }));
}

const linkFor = (o: Pick<Open, 'kind' | 'slug' | 'targetId'>) => `/${o.kind === 'path' ? 'paths' : 'courses'}/${o.slug || o.targetId}`;

async function stamp(o: Open, record: Record<string, string>) {
  await withRetry(() => (o.kind === 'path' ? zite.pathEnrollments.update({ id: o.id, record: record as never }) : zite.enrollments.update({ id: o.id, record: record as never })));
}

/** 1. Due within the reminder window, not reminded in the last 3 days. */
async function dueSoon(settings: OrgSettings) {
  const list = await openEnrollments(`$due >= (NOW() AT TIME ZONE 'UTC')::date AND $due <= (NOW() AT TIME ZONE 'UTC')::date + ${Math.max(0, Math.min(30, Math.round(settings.reminderDaysBefore)))}`, 'remindedAt', '3 days');
  if (!list.length) return 0;
  const template = await findTemplate('Due reminder');
  const now = new Date().toISOString();
  for (const o of list) {
    const left = daysLeftLabel(o.dueDate);
    const link = linkFor(o);
    await notify({ recipientIds: [o.personId], app: 'Learn', type: 'due_soon', title: left === 'today' ? `Due today: ${o.title}` : `Due in ${left}: ${o.title}`, body: `Due ${formatLongDay(o.dueDate)}`, courseId: o.kind === 'course' ? o.targetId : null, pathId: o.kind === 'path' ? o.targetId : null, link });
    await emailPerson({
      trigger: 'Due reminder',
      template,
      settings,
      person: { email: o.personEmail, name: o.personName, muteEmails: o.muteEmails },
      context: { course_title: o.title, due_date: formatLongDay(o.dueDate), days_left: left, course_link: learnLink(settings, link) },
      link: learnLink(settings, link),
      buttonLabel: o.kind === 'path' ? 'Continue the path' : 'Continue the course',
    });
    await stamp(o, { remindedAt: now });
  }
  return list.length;
}

/** 2. Past due, not told in the last 7 days. */
async function overdue(settings: OrgSettings) {
  const list = await openEnrollments(`$due < (NOW() AT TIME ZONE 'UTC')::date`, 'overdueNotifiedAt', '7 days');
  if (!list.length) return 0;
  const template = await findTemplate('Overdue');
  const now = new Date().toISOString();
  for (const o of list) {
    const link = linkFor(o);
    await notify({ recipientIds: [o.personId], app: 'Learn', type: 'overdue', title: `Overdue: ${o.title}`, body: `Was due ${formatLongDay(o.dueDate)}`, courseId: o.kind === 'course' ? o.targetId : null, pathId: o.kind === 'path' ? o.targetId : null, link });
    await emailPerson({
      trigger: 'Overdue',
      template,
      settings,
      person: { email: o.personEmail, name: o.personName, muteEmails: o.muteEmails },
      context: { course_title: o.title, due_date: formatLongDay(o.dueDate), days_left: 'overdue', course_link: learnLink(settings, link) },
      link: learnLink(settings, link),
      buttonLabel: o.kind === 'path' ? 'Open the path' : 'Open the course',
    });
    await stamp(o, { overdueNotifiedAt: now });
  }
  return list.length;
}

/** 3. One digest per manager with overdue reports, at most weekly. */
async function managerDigests(settings: OrgSettings) {
  if (!settings.escalateOverdue) return 0;
  const list = (await openEnrollments(`$due < (NOW() AT TIME ZONE 'UTC')::date`, null, null)).filter(o => o.managerId);
  if (!list.length) return 0;
  const byManager = new Map<string, Open[]>();
  for (const o of list) byManager.set(o.managerId!, [...(byManager.get(o.managerId!) ?? []), o]);
  const managerIds = [...byManager.keys()];
  const [{ rows: managers }, { rows: recent }] = await Promise.all([
    zite.sql({ query: `SELECT id::text AS id, "name", "email", "muteEmails" FROM "People" WHERE id::text = ANY($1::text[]) AND COALESCE("status", '') <> 'Deactivated'`, params: [managerIds] }),
    // Weekly, with half a day of slack so a daily run a few seconds early doesn't slip a whole day.
    zite.sql({ query: `SELECT DISTINCT "recipientId" FROM "Notifications" WHERE "type" = 'report_overdue' AND "recipientId" = ANY($1::text[]) AND "occurredAt" > NOW() - INTERVAL '6 days 12 hours'`, params: [managerIds] }),
  ]);
  const told = new Set(recent.map(r => String(r.recipientId)));
  const template = await findTemplate('Manager overdue digest');
  let sent = 0;
  for (const m of managers) {
    const managerId = String(m.id);
    if (told.has(managerId)) continue;
    const items = (byManager.get(managerId) ?? []).filter(o => o.personId !== managerId);
    if (!items.length) continue;
    const people = new Set(items.map(o => o.personId));
    const lines = items.slice(0, 20).map(o => `• ${o.personName || o.personEmail} — ${o.title} (due ${shortDay(o.dueDate)})`);
    if (items.length > 20) lines.push(`• …and ${items.length - 20} more`);
    const names = [...new Set(items.map(o => (o.personName || o.personEmail).split(' ')[0]))];
    await notify({
      recipientIds: [managerId],
      app: 'Learn',
      type: 'report_overdue',
      title: `${people.size} ${people.size === 1 ? 'person' : 'people'} on your team ${people.size === 1 ? 'has' : 'have'} overdue training`,
      body: `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''} · ${items.length} item${items.length === 1 ? '' : 's'}`,
      link: '/team',
    });
    await emailPerson({
      trigger: 'Manager overdue digest',
      template,
      settings,
      person: { email: str(m.email) ?? '', name: str(m.name), muteEmails: bool(m.muteEmails) },
      context: { manager_name: (str(m.name) ?? '').split(' ')[0] || 'there', overdue_list: lines.join('\n') },
      link: learnLink(settings, '/team'),
      buttonLabel: 'See your team',
    });
    sent++;
  }
  return sent;
}

/** 5. Certificates expiring within 30 days that the holder hasn't been told about. */
async function expiringCertificates(settings: OrgSettings) {
  const { rows } = await zite.sql({
    query: `
      SELECT ce.id::text AS id, ce."title", ce."expiresAt", ce."courseId", ce."pathId", ce."credentialId", p.id::text AS "personId", p."name", p."email", p."muteEmails"
      FROM "Certificates" ce JOIN "People" p ON p.id::text = ce."personId"
      WHERE COALESCE(ce."status", '') <> 'Revoked' AND ce."expiresAt" IS NOT NULL AND ce."expiresAt" > NOW() AND ce."expiresAt" <= NOW() + INTERVAL '30 days'
        AND COALESCE(p."status", '') <> 'Deactivated'
        AND NOT EXISTS (
          SELECT 1 FROM "Notifications" n
          WHERE n."type" = 'certificate_expiring' AND n."recipientId" = ce."personId" AND n."link" = '/certificates/' || ce.id::text AND n."occurredAt" > NOW() - INTERVAL '35 days'
        )
      ORDER BY ce."expiresAt" ASC
      LIMIT ${BATCH}`,
    params: [],
  });
  if (!rows.length) return 0;
  const template = await findTemplate('Certificate expiring');
  for (const r of rows) {
    const expires = formatLongDay(iso(r.expiresAt));
    const link = `/certificates/${r.id}`;
    await notify({ recipientIds: [String(r.personId)], app: 'Learn', type: 'certificate_expiring', title: `Your ${str(r.title)} certificate expires ${expires}`, body: 'Recertify before then to stay current.', courseId: ref(r.courseId), pathId: ref(r.pathId), link });
    await emailPerson({
      trigger: 'Certificate expiring',
      template,
      settings,
      person: { email: str(r.email) ?? '', name: str(r.name), muteEmails: bool(r.muteEmails) },
      context: { course_title: str(r.title) ?? '', expires_on: expires, credential_id: str(r.credentialId) ?? '', certificate_link: learnLink(settings, link) },
      link: learnLink(settings, link),
      buttonLabel: 'View your certificate',
    });
  }
  return rows.length;
}

/** 6. Registered for a session starting in the next 24 hours and not yet reminded. */
async function sessionReminders(settings: OrgSettings) {
  const { rows } = await zite.sql({
    query: `
      SELECT g.id::text AS id, s.id::text AS "sessionId", s."title", s."startsAt", s."timezone", s."location", s."meetingUrl", s."courseId",
        p.id::text AS "personId", p."name", p."email", p."muteEmails"
      FROM "Registrations" g
      JOIN "Sessions" s ON s.id::text = g."sessionId"
      JOIN "People" p ON p.id::text = g."personId"
      WHERE g."status" = 'Registered' AND g."remindedAt" IS NULL
        AND COALESCE(s."status", '') <> 'Cancelled' AND s."startsAt" > NOW() AND s."startsAt" <= NOW() + INTERVAL '24 hours'
        AND COALESCE(p."status", '') <> 'Deactivated'
      ORDER BY s."startsAt" ASC
      LIMIT ${BATCH}`,
    params: [],
  });
  if (!rows.length) return 0;
  const template = await findTemplate('Session reminder');
  const now = new Date().toISOString();
  for (const r of rows) {
    const session = { title: str(r.title) ?? 'Live session', startsAt: iso(r.startsAt), timezone: str(r.timezone) || settings.timezone, location: str(r.location) ?? '', meetingUrl: ref(r.meetingUrl) };
    await notify({ recipientIds: [String(r.personId)], app: 'Learn', type: 'session_reminder', title: `Starting soon: ${session.title}`, body: formatDateTime(session.startsAt, session.timezone), courseId: ref(r.courseId), link: '/sessions' });
    await emailPerson({
      trigger: 'Session reminder',
      template,
      settings,
      person: { email: str(r.email) ?? '', name: str(r.name), muteEmails: bool(r.muteEmails) },
      context: sessionMergeContext(session),
      link: session.meetingUrl ?? learnLink(settings, '/sessions'),
      buttonLabel: session.meetingUrl ? 'Join the session' : 'View your sessions',
    });
    await withRetry(() => zite.registrations.update({ id: String(r.id), record: { remindedAt: now } }));
  }
  return rows.length;
}

/** Each step runs even if an earlier one fails, so one bad row can't silence the rest. */
export async function runDailyReminders(settings: OrgSettings): Promise<ReminderCounts> {
  const safe = async (label: string, fn: () => Promise<number>) => {
    try {
      return await fn();
    } catch (e) {
      console.error(`Reminders: ${label} failed`, e instanceof Error ? e.message : e);
      return 0;
    }
  };
  return {
    dueSoon: await safe('due soon', () => dueSoon(settings)),
    overdue: await safe('overdue', () => overdue(settings)),
    managerDigests: await safe('manager digests', () => managerDigests(settings)),
    recertified: await safe('recertification', () => runRecertification(settings)),
    expiringCertificates: await safe('expiring certificates', () => expiringCertificates(settings)),
    sessionReminders: await safe('session reminders', () => sessionReminders(settings)),
  };
}
