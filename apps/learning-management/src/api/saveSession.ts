import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatDateTime } from '@project/shared/merge';
import { logActivity } from '@project/shared/server/activity';
import { loadCourse } from '@project/shared/server/courses';
import { sendEmail } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { assertStaff, canEditCourse, getActor } from '@project/shared/server/people';
import { getSettings, learnLink } from '@project/shared/server/settings';
import { eachWrite, withRetry } from '@project/shared/server/sql';
import { assertCanManageSession, hasEnded, loadPeopleLite, loadSession, promoteWaitlist, registerPeople, seatsCancelledWith, sessionLocation } from '../server/sessions';

/**
 * Schedule, edit, cancel or delete a live session.
 *
 * Cancelling tells everyone registered or waitlisted, in the app and by email.
 * Moving an upcoming session to a new time or place tells them in the app and
 * re-arms their day-before reminder. A session can only be deleted while no
 * attendance has been recorded — after that it's part of people's records.
 */

const fields = z.object({
  title: z.string().trim().min(1, 'Give the session a title').max(200, 'Keep the title under 200 characters'),
  courseId: z.string().nullable().default(null),
  lessonId: z.string().nullable().default(null),
  description: z.string().max(20000).default(''),
  startsAt: z.string().min(1, 'Choose when the session starts'),
  endsAt: z.string().min(1, 'Choose when the session ends'),
  timezone: z.string().min(1).max(64),
  location: z.string().max(240).default(''),
  meetingUrl: z.string().max(1000).nullable().default(null),
  recordingUrl: z.string().max(1000).nullable().default(null),
  capacity: z.number().int().nullable().default(null),
  instructorId: z.string().nullable().default(null),
});

const Input = z.object({
  action: z.enum(['create', 'update', 'cancel', 'delete']),
  id: z.string().optional(),
  session: fields.optional(),
  /** update: only these fields (e.g. just the recording link). */
  patch: fields.partial().optional(),
  /** cancel: a note for registrants. */
  message: z.string().max(2000).optional(),
  /** create: a cancelled session this one replaces — the people whose seats were cancelled with it are registered again. */
  rescheduleOf: z.string().max(100).optional(),
});

const Output = z.object({ id: z.string(), notified: z.number(), promoted: z.number(), registered: z.number().optional() });
type Out = z.infer<typeof Output>;

const validTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const httpsOrNull = (v: string | null | undefined, label: string) => {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (!/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(s)) throw new ZiteError(`The ${label} must be a full https:// link`, 'BAD_REQUEST');
  return s;
};

async function validate(input: z.infer<typeof fields>) {
  const starts = Date.parse(input.startsAt);
  const ends = Date.parse(input.endsAt);
  if (Number.isNaN(starts)) throw new ZiteError('Choose when the session starts', 'BAD_REQUEST');
  if (Number.isNaN(ends)) throw new ZiteError('Choose when the session ends', 'BAD_REQUEST');
  if (ends <= starts) throw new ZiteError('The session has to end after it starts', 'BAD_REQUEST');
  if (ends - starts > 24 * 3600_000) throw new ZiteError('A session can run for at most 24 hours. Schedule longer training as several sessions.', 'BAD_REQUEST');
  if (!validTimeZone(input.timezone)) throw new ZiteError('Choose a time zone from the list', 'BAD_REQUEST');
  if (input.capacity != null && (input.capacity < 1 || input.capacity > 100000)) throw new ZiteError('Capacity must be at least 1, or blank for unlimited', 'BAD_REQUEST');

  let course: Awaited<ReturnType<typeof loadCourse>> = null;
  if (input.courseId) {
    course = await loadCourse(input.courseId);
    if (!course) throw new ZiteError('That course no longer exists', 'BAD_REQUEST');
  }
  if (input.lessonId) {
    if (!course) throw new ZiteError('Choose the course before linking a lesson', 'BAD_REQUEST');
    const { rows } = await zite.sql({ query: `SELECT "type", "courseId" FROM "Lessons" WHERE id::text = $1`, params: [input.lessonId] });
    if (!rows[0] || String(rows[0].courseId) !== course.id) throw new ZiteError(`That lesson isn't part of “${course.title}”`, 'BAD_REQUEST');
    if (rows[0].type !== 'Live session') throw new ZiteError('Only a “Live session” lesson can be linked to a session', 'BAD_REQUEST');
  }
  if (input.instructorId) {
    const { rows } = await zite.sql({ query: `SELECT "role", "status" FROM "People" WHERE id::text = $1`, params: [input.instructorId] });
    if (!rows[0]) throw new ZiteError('That instructor no longer exists', 'BAD_REQUEST');
    if (rows[0].status === 'Deactivated') throw new ZiteError('That instructor has been deactivated', 'BAD_REQUEST');
  }
  return {
    record: {
      title: input.title.trim(),
      courseId: course?.id ?? null,
      lessonId: input.lessonId || null,
      description: input.description.trim(),
      startsAt: new Date(starts).toISOString(),
      endsAt: new Date(ends).toISOString(),
      timezone: input.timezone,
      location: input.location.trim(),
      meetingUrl: httpsOrNull(input.meetingUrl, 'meeting link'),
      recordingUrl: httpsOrNull(input.recordingUrl, 'recording link'),
      capacity: input.capacity ?? null,
      instructorId: input.instructorId || null,
    },
    course,
  };
}

export default createEndpoint({
  description: 'Create, update, cancel or delete a live session',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<Out> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'That session is incomplete', 'BAD_REQUEST');
    const { action, id } = parsed.data;
    const settings = await getSettings();

    if (action === 'create') {
      if (!parsed.data.session) throw new ZiteError('Describe the session to schedule', 'BAD_REQUEST');
      const { record, course } = await validate(parsed.data.session);
      if (actor.role !== 'Admin') {
        const teaches = record.instructorId === actor.id;
        if (!teaches && !(course && canEditCourse(actor, course))) throw new ZiteError('Instructors can schedule sessions for courses they teach, or sessions they lead themselves', 'FORBIDDEN');
      }
      const original = parsed.data.rescheduleOf ? await loadSession(parsed.data.rescheduleOf) : null;
      if (original) await assertCanManageSession(actor, original);
      const created = await zite.sessions.create({ record: { ...record, status: 'Scheduled' } as never });
      let registered = 0;
      if (original?.status === 'Cancelled') {
        const personIds = await seatsCancelledWith(original.id);
        const fresh = personIds.length ? await loadSession(created.id) : null;
        if (fresh) {
          const res = await registerPeople(fresh, personIds, { actorId: actor.id, settings });
          registered = res.added + res.waitlisted;
        }
      }
      return { id: created.id, notified: 0, promoted: 0, registered };
    }

    if (!id) throw new ZiteError('Which session?', 'BAD_REQUEST');
    const session = await loadSession(id);
    if (!session) throw new ZiteError('That session no longer exists', 'NOT_FOUND');
    await assertCanManageSession(actor, session);

    const { rows: regs } = await zite.sql({ query: `SELECT id, "personId", "status" FROM "Registrations" WHERE "sessionId" = $1`, params: [session.id] });
    const activeRegs = regs.filter(r => r.status === 'Registered' || r.status === 'Waitlisted');

    if (action === 'update') {
      const merged = {
        title: session.title,
        courseId: session.courseId,
        lessonId: session.lessonId,
        description: session.description,
        startsAt: session.startsAt ?? '',
        endsAt: session.endsAt ?? '',
        timezone: session.timezone,
        location: session.location,
        meetingUrl: session.meetingUrl,
        recordingUrl: session.recordingUrl,
        capacity: session.capacity,
        instructorId: session.instructorId,
        ...(parsed.data.session ?? {}),
        ...(parsed.data.patch ?? {}),
      };
      const { record, course } = await validate(merged as z.infer<typeof fields>);
      if (actor.role !== 'Admin' && record.courseId && record.courseId !== session.courseId && !(course && canEditCourse(actor, course)) && record.instructorId !== actor.id) {
        throw new ZiteError('You can only move a session to a course you teach', 'FORBIDDEN');
      }
      await zite.sessions.update({ id, record: record as never });

      let notified = 0;
      const timeChanged = record.startsAt !== session.startsAt || record.endsAt !== session.endsAt;
      const placeChanged = record.location !== session.location || record.meetingUrl !== session.meetingUrl;
      if (session.status !== 'Cancelled' && !hasEnded(session) && (timeChanged || placeChanged) && activeRegs.length) {
        const when = formatDateTime(record.startsAt, record.timezone);
        notified = await notify({
          recipientIds: activeRegs.map(r => String(r.personId)),
          app: 'Learn',
          type: 'session_updated',
          title: timeChanged ? `New time for ${record.title}` : `New location for ${record.title}`,
          body: timeChanged ? `Now ${when}` : `Now at ${sessionLocation({ location: record.location, meetingUrl: record.meetingUrl })}`,
          courseId: record.courseId,
          actorId: actor.id,
          link: '/sessions',
        });
        if (timeChanged) await eachWrite(activeRegs.filter(r => r.status === 'Registered'), r => zite.registrations.update({ id: String(r.id), record: { remindedAt: null } }));
      }
      const fresh = await loadSession(id);
      const promoted = fresh ? await promoteWaitlist(fresh, { actorId: actor.id, settings }) : 0;
      return { id, notified, promoted };
    }

    if (action === 'cancel') {
      if (session.status === 'Cancelled') return { id, notified: 0, promoted: 0 };
      await zite.sessions.update({ id, record: { status: 'Cancelled' } });
      await eachWrite(activeRegs, r => zite.registrations.update({ id: String(r.id), record: { status: 'Cancelled' } }));
      await logActivity(
        activeRegs.map(r => ({ type: 'session_cancelled' as const, personId: String(r.personId), actorId: actor.id, courseId: session.courseId, lessonId: session.lessonId, data: { sessionId: session.id, sessionTitle: session.title, previousStatus: String(r.status), reason: 'session' } })),
      );
      const note = (parsed.data.message ?? '').trim();
      const when = formatDateTime(session.startsAt, session.timezone);
      const notified = await notify({
        recipientIds: activeRegs.map(r => String(r.personId)),
        app: 'Learn',
        type: 'session_updated',
        title: `Cancelled: ${session.title}`,
        body: note || `The session on ${when} won't go ahead.`,
        courseId: session.courseId,
        actorId: actor.id,
        link: '/sessions',
      });
      if (!hasEnded(session)) {
        const people = await loadPeopleLite(activeRegs.map(r => String(r.personId)));
        for (const person of people.values()) {
          if (person.status === 'Deactivated' || person.muteEmails || person.id === actor.id) continue;
          const first = person.name.trim().split(/\s+/)[0] || 'there';
          await withRetry(() =>
            sendEmail({
              to: person.email,
              subject: `Cancelled: ${session.title}`,
              text: `Hi ${first},\n\n${session.title}, scheduled for ${when}, has been cancelled.${note ? `\n\n${note}` : ''}\n\nYou don't need to do anything. We'll let you know if it's rescheduled.`,
              settings,
              button: learnLink(settings, '/sessions') ? { label: 'See other sessions', href: learnLink(settings, '/sessions') } : null,
            }),
          );
        }
      }
      return { id, notified, promoted: 0 };
    }

    // delete
    if (regs.some(r => r.status === 'Attended' || r.status === 'Absent')) {
      throw new ZiteError('Attendance has been recorded for this session, so it stays on record. Cancel it instead.', 'CONFLICT');
    }
    await eachWrite(regs, r => zite.registrations.delete({ id: String(r.id) }));
    await zite.sessions.delete({ id });
    return { id, notified: 0, promoted: 0 };
  },
});
