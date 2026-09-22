import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity, type ActivityInput } from '@project/shared/server/activity';
import { loadCourse } from '@project/shared/server/courses';
import { completeLesson, enrollInCourse, findActiveEnrollment } from '@project/shared/server/enroll';
import { assertStaff, getActor } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { withRetry } from '@project/shared/server/sql';
import { assertCanManageSession, loadSession, promoteWaitlist, registerPeople } from '../server/sessions';

/**
 * Registrations and attendance for one session, in one call:
 *
 *   add     — register people; past capacity they're waitlisted
 *   cancel  — cancel registrations; a freed seat goes to the earliest waitlisted person
 *   status  — mark Attended, Absent, or back to Registered
 *
 * Marking someone Attended completes the session's linked lesson for them
 * (enrolling them in the course first if they aren't). Completion is final, so
 * switching them to Absent later doesn't undo it.
 */

const Input = z.object({
  sessionId: z.string().min(1),
  add: z.array(z.string()).max(1000).default([]),
  cancel: z.array(z.string()).max(1000).default([]),
  status: z.object({ registrationIds: z.array(z.string()).min(1).max(1000), value: z.enum(['Attended', 'Absent', 'Registered']) }).optional(),
});

const Output = z.object({
  added: z.number(),
  waitlisted: z.number(),
  cancelled: z.number(),
  promoted: z.number(),
  updated: z.number(),
  lessonsCompleted: z.number(),
  enrolled: z.number(),
  skipped: z.number(),
  notEnrolled: z.number(),
});

/** Attendance can be taken from shortly before the start. */
const ATTENDANCE_OPENS_MS = 60 * 60_000;

export default createEndpoint({
  description: 'Register people for a session, cancel registrations and record attendance',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Nothing to change', 'BAD_REQUEST');
    const { sessionId, add, cancel, status } = parsed.data;
    const session = await loadSession(sessionId);
    if (!session) throw new ZiteError('That session no longer exists', 'NOT_FOUND');
    await assertCanManageSession(actor, session);
    const settings = await getSettings();
    const out = { added: 0, waitlisted: 0, cancelled: 0, promoted: 0, updated: 0, lessonsCompleted: 0, enrolled: 0, skipped: 0, notEnrolled: 0 };

    if ((add.length || status) && session.status === 'Cancelled') throw new ZiteError('This session was cancelled, so its registrations can’t change', 'BAD_REQUEST');

    const { rows: regRows } = await zite.sql({ query: `SELECT id::text AS id, "personId", "status" FROM "Registrations" WHERE "sessionId" = $1`, params: [session.id] });
    const regById = new Map(regRows.map(r => [String(r.id), { id: String(r.id), personId: String(r.personId), status: String(r.status) }]));

    // ── Cancel ──────────────────────────────────────────────────────────
    if (cancel.length) {
      const removed: ActivityInput[] = [];
      for (const rid of new Set(cancel)) {
        const reg = regById.get(rid);
        if (!reg || reg.status === 'Cancelled') {
          out.skipped++;
          continue;
        }
        if (reg.status === 'Attended' || reg.status === 'Absent') {
          out.skipped++;
          continue;
        }
        await withRetry(() => zite.registrations.update({ id: rid, record: { status: 'Cancelled', checkedInAt: null } }));
        removed.push({ type: 'session_cancelled', personId: reg.personId, actorId: actor.id, courseId: session.courseId, lessonId: session.lessonId, data: { sessionId: session.id, sessionTitle: session.title, previousStatus: reg.status, reason: 'staff' } });
        reg.status = 'Cancelled';
        out.cancelled++;
      }
      await logActivity(removed);
    }

    // ── Add ─────────────────────────────────────────────────────────────
    if (add.length) {
      const res = await registerPeople(session, add, { actorId: actor.id, settings });
      out.added += res.added;
      out.waitlisted += res.waitlisted;
      out.skipped += res.skipped;
    }

    // ── Attendance ──────────────────────────────────────────────────────
    if (status) {
      if (status.value !== 'Registered' && session.startsAt && Date.parse(session.startsAt) - ATTENDANCE_OPENS_MS > Date.now()) {
        throw new ZiteError('Attendance opens an hour before the session starts', 'BAD_REQUEST');
      }
      const course = session.courseId ? await loadCourse(session.courseId) : null;
      const now = new Date().toISOString();
      const activity: ActivityInput[] = [];
      for (const rid of new Set(status.registrationIds)) {
        const reg = regById.get(rid);
        if (!reg || reg.status === 'Cancelled' || reg.status === status.value) {
          out.skipped++;
          continue;
        }
        await withRetry(() => zite.registrations.update({ id: rid, record: { status: status.value, checkedInAt: status.value === 'Attended' ? now : null } }));
        reg.status = status.value;
        out.updated++;
        activity.push({ type: 'attendance_marked', personId: reg.personId, actorId: actor.id, courseId: session.courseId, lessonId: session.lessonId, data: { status: status.value, sessionId: session.id, sessionTitle: session.title } });

        if (status.value === 'Attended' && session.lessonId && course) {
          let enrollment = await findActiveEnrollment(reg.personId, course.id);
          if (!enrollment && course.status === 'Published') {
            const res = await enrollInCourse({ courseId: course.id, personIds: [reg.personId], source: 'Assigned', assignedById: actor.id, notify: false, settings });
            if (res.created.length || res.reactivated.length) out.enrolled++;
            enrollment = await findActiveEnrollment(reg.personId, course.id);
          }
          if (!enrollment) {
            out.notEnrolled++;
            continue;
          }
          const { rows: done } = await zite.sql({ query: `SELECT 1 FROM "LessonProgress" WHERE "enrollmentId" = $1 AND "lessonId" = $2 AND "status" = 'Completed' LIMIT 1`, params: [enrollment.id, session.lessonId] });
          if (!done.length) {
            await completeLesson({ enrollment, lessonId: session.lessonId, actorId: actor.id, settings });
            out.lessonsCompleted++;
          }
        }
      }
      await logActivity(activity);
    }

    // A freed seat goes to the next person waiting.
    if (out.cancelled) {
      const fresh = await loadSession(session.id);
      if (fresh) out.promoted = await promoteWaitlist(fresh, { actorId: actor.id, settings });
    }
    return out;
  },
});
