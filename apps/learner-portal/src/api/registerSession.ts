import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatDateTime } from '@project/shared/merge';
import { logActivity } from '@project/shared/server/activity';
import { emailPerson } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { learnLink } from '@project/shared/server/settings';
import { bool, str, withRetry } from '@project/shared/server/sql';
import { loadSessionForLearner, seatsTaken, sessionLocation } from '../server/player';

/**
 * Save a seat at a live session — or a place on the waitlist when it's full.
 * Registering again after cancelling reuses the same row, so the instructor's
 * list never shows someone twice.
 */

const Input = z.object({ sessionId: z.string().min(1).max(100) });

const Output = z.object({ registration: z.object({ id: z.string(), status: z.enum(['Registered', 'Waitlisted']) }), alreadyRegistered: z.boolean() });

export default createEndpoint({
  description: 'Register the signed-in learner for a live session',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which session?', 'BAD_REQUEST');
    const { actor, settings, session, course } = await loadSessionForLearner(context, parsed.data.sessionId);
    if (session.status === 'Cancelled') throw new ZiteError('This session was cancelled. Pick another date.', 'BAD_REQUEST');
    if (session.startsAt && Date.parse(session.endsAt ?? session.startsAt) < Date.now()) throw new ZiteError('This session has already happened.', 'BAD_REQUEST');

    const { rows } = await zite.sql({
      query: `SELECT id, "status" FROM "Registrations" WHERE "sessionId" = $1 AND "personId" = $2 ORDER BY created_at DESC LIMIT 1`,
      params: [session.id, actor.id],
    });
    const existing = rows[0];
    if (existing && (existing.status === 'Registered' || existing.status === 'Waitlisted')) {
      return { registration: { id: String(existing.id), status: existing.status === 'Waitlisted' ? 'Waitlisted' : 'Registered' }, alreadyRegistered: true };
    }
    if (existing && (existing.status === 'Attended' || existing.status === 'Absent')) {
      throw new ZiteError(existing.status === 'Attended' ? 'You already attended this session.' : 'Attendance for this session has already been taken.', 'CONFLICT');
    }

    const full = session.capacity != null && (await seatsTaken(session.id, actor.id)) >= session.capacity;
    const status = full ? ('Waitlisted' as const) : ('Registered' as const);
    const now = new Date().toISOString();
    let id: string;
    if (existing) {
      id = String(existing.id);
      await withRetry(() => zite.registrations.update({ id, record: { status, registeredAt: now, checkedInAt: null, remindedAt: null } }));
    } else {
      const created = await withRetry(() => zite.registrations.create({ record: { sessionId: session.id, personId: actor.id, status, registeredAt: now, checkedInAt: null, remindedAt: null } }));
      id = created.id;
    }

    await logActivity({ type: 'session_registered', personId: actor.id, actorId: actor.id, courseId: session.courseId, lessonId: session.lessonId, data: { sessionId: session.id, sessionTitle: session.title, status } });

    const when = formatDateTime(session.startsAt, session.timezone);
    await withRetry(() =>
      notify({
        recipientIds: [session.instructorId],
        app: 'Admin',
        type: 'session_registration',
        title: status === 'Registered' ? `${actor.name} registered for ${session.title}` : `${actor.name} joined the waitlist for ${session.title}`,
        body: when || null,
        courseId: session.courseId,
        actorId: actor.id,
        link: `/sessions/${session.id}`,
      }),
    );

    if (status === 'Registered') {
      const { rows: people } = await zite.sql({ query: `SELECT "name", "email", "muteEmails" FROM "People" WHERE id::text = $1`, params: [actor.id] });
      const p = people[0];
      if (p) {
        const link = course ? learnLink(settings, session.lessonId ? `/learn/${course.slug || course.id}/${session.lessonId}` : `/courses/${course.slug || course.id}`) : learnLink(settings, '/sessions');
        await emailPerson({
          trigger: 'Session registered',
          settings,
          person: { name: str(p.name), email: str(p.email) ?? actor.email, muteEmails: bool(p.muteEmails) },
          context: { session_title: session.title, session_time: when, session_location: sessionLocation(session), course_title: course?.title ?? '' },
          link,
          buttonLabel: 'View the session',
        });
      }
    }

    return { registration: { id, status }, alreadyRegistered: false };
  },
});
