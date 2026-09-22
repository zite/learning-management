import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatDateTime } from '@project/shared/merge';
import { logActivity } from '@project/shared/server/activity';
import { emailPerson } from '@project/shared/server/email';
import { loadCourse } from '@project/shared/server/courses';
import { notify } from '@project/shared/server/notify';
import { learnLink } from '@project/shared/server/settings';
import { bool, str, withRetry } from '@project/shared/server/sql';
import { loadSessionForLearner, seatsTaken, sessionLocation } from '../server/player';

/**
 * Give up a seat (or a waitlist place). A freed seat goes straight to whoever
 * joined the waitlist first, and they're told they're in.
 */

const Input = z.object({ sessionId: z.string().min(1).max(100) });

const Output = z.object({ status: z.literal('Cancelled'), promotedSomeone: z.boolean() });

export default createEndpoint({
  description: "Cancel the signed-in learner's registration for a live session",
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which session?', 'BAD_REQUEST');
    const { actor, settings, session } = await loadSessionForLearner(context, parsed.data.sessionId);

    const { rows } = await zite.sql({
      query: `SELECT id, "status" FROM "Registrations" WHERE "sessionId" = $1 AND "personId" = $2 AND "status" IN ('Registered', 'Waitlisted') ORDER BY created_at DESC LIMIT 1`,
      params: [session.id, actor.id],
    });
    const mine = rows[0];
    if (!mine) throw new ZiteError("You're not registered for this session.", 'BAD_REQUEST');
    if (session.startsAt && Date.parse(session.endsAt ?? session.startsAt) < Date.now()) throw new ZiteError('This session has already happened.', 'BAD_REQUEST');

    await withRetry(() => zite.registrations.update({ id: String(mine.id), record: { status: 'Cancelled' } }));
    await logActivity({ type: 'session_cancelled', personId: actor.id, actorId: actor.id, courseId: session.courseId, lessonId: session.lessonId, data: { sessionId: session.id, sessionTitle: session.title, previousStatus: mine.status } });

    let promotedSomeone = false;
    if (mine.status === 'Registered' && session.status !== 'Cancelled') {
      const free = session.capacity == null || (await seatsTaken(session.id)) < session.capacity;
      if (free) {
        const { rows: waiting } = await zite.sql({
          query: `SELECT r.id, r."personId", p."name", p."email", p."muteEmails" FROM "Registrations" r JOIN "People" p ON p.id::text = r."personId"
                  WHERE r."sessionId" = $1 AND r."status" = 'Waitlisted' AND COALESCE(p."status", '') <> 'Deactivated'
                  ORDER BY r."registeredAt" ASC NULLS LAST, r.created_at ASC LIMIT 1`,
          params: [session.id],
        });
        const next = waiting[0];
        if (next) {
          promotedSomeone = true;
          await withRetry(() => zite.registrations.update({ id: String(next.id), record: { status: 'Registered' } }));
          const course = session.courseId ? await loadCourse(session.courseId) : null;
          const when = formatDateTime(session.startsAt, session.timezone);
          const hash = course ? (session.lessonId ? `/learn/${course.slug || course.id}/${session.lessonId}` : `/courses/${course.slug || course.id}`) : '/sessions';
          await withRetry(() =>
            notify({
              recipientIds: [String(next.personId)],
              app: 'Learn',
              type: 'session_updated',
              title: `A spot opened up — you're registered for ${session.title}`,
              body: when || null,
              courseId: session.courseId,
              link: hash,
            }),
          );
          await logActivity({ type: 'session_registered', personId: String(next.personId), actorId: null, courseId: session.courseId, lessonId: session.lessonId, data: { sessionId: session.id, sessionTitle: session.title, status: 'Registered', fromWaitlist: true } });
          await emailPerson({
            trigger: 'Session registered',
            settings,
            person: { name: str(next.name), email: str(next.email) ?? '', muteEmails: bool(next.muteEmails) },
            context: { session_title: session.title, session_time: when, session_location: sessionLocation(session), course_title: course?.title ?? '' },
            link: learnLink(settings, hash),
            buttonLabel: 'View the session',
          });
        }
      }
    }

    await withRetry(() =>
      notify({
        recipientIds: [session.instructorId],
        app: 'Admin',
        type: 'session_registration',
        title: `${actor.name} cancelled their ${mine.status === 'Waitlisted' ? 'waitlist place' : 'registration'} for ${session.title}`,
        body: promotedSomeone ? 'The first person on the waitlist took the seat.' : null,
        courseId: session.courseId,
        actorId: actor.id,
        link: `/sessions/${session.id}`,
      }),
    );

    return { status: 'Cancelled', promotedSomeone };
  },
});
