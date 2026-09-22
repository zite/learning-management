import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatLongDay } from '@project/shared/merge';
import { logActivity } from '@project/shared/server/activity';
import { loadCourse } from '@project/shared/server/courses';
import { emailPerson, findTemplate } from '@project/shared/server/email';
import { daysLeftLabel, markEnrollmentComplete, recomputeEnrollment, recomputePathEnrollment, resetEnrollment, toEnrollment } from '@project/shared/server/enroll';
import { notify } from '@project/shared/server/notify';
import { assertStaff, getActor } from '@project/shared/server/people';
import { getSettings, learnLink } from '@project/shared/server/settings';
import { bool, str } from '@project/shared/server/sql';

/**
 * Bulk changes to enrollments from any list: change the due date, send a
 * reminder now, withdraw or restore, reset progress, or mark complete (for
 * training done offline). Each change is logged against the learner.
 */

const Input = z.object({
  ids: z.array(z.string()).min(1, 'Choose at least one enrollment').max(2000),
  action: z.enum(['set_due', 'remind', 'withdraw', 'restore', 'reset', 'complete']),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().max(1000).optional(),
});

export default createEndpoint({
  description: 'Change due dates, remind, withdraw, restore, reset or complete enrollments in bulk',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ updated: z.number(), skipped: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const { ids, action, dueDate, note } = parsed.data;
    if (action === 'set_due' && dueDate === undefined) throw new ZiteError('Choose a due date, or clear it', 'BAD_REQUEST');

    const { rows } = await zite.sql({
      query: `SELECT e.*, p."name" AS "personName", p."email" AS "personEmail", p."muteEmails" AS "personMute", p."status" AS "personStatus" FROM "Enrollments" e JOIN "People" p ON p.id::text = e."personId" WHERE e.id::text = ANY($1::text[])`,
      params: [ids],
    });
    if (!rows.length) throw new ZiteError('Those enrollments no longer exist', 'NOT_FOUND');
    const settings = await getSettings();
    const now = new Date().toISOString();
    let updated = 0;
    let skipped = 0;
    const courseCache = new Map<string, Awaited<ReturnType<typeof loadCourse>>>();
    const courseFor = async (id: string) => {
      if (!courseCache.has(id)) courseCache.set(id, await loadCourse(id));
      return courseCache.get(id)!;
    };
    const reminder = action === 'remind' ? await findTemplate('Due reminder') : null;

    for (const r of rows) {
      const e = toEnrollment(r);
      const course = await courseFor(e.courseId);
      const title = course?.title ?? 'this course';
      switch (action) {
        case 'set_due': {
          if (e.status === 'Completed' || e.status === 'Withdrawn') {
            skipped++;
            break;
          }
          await zite.enrollments.update({ id: e.id, record: { dueDate: dueDate ?? null, remindedAt: null, overdueNotifiedAt: null } });
          await logActivity({ type: 'due_date_changed', personId: e.personId, actorId: actor.id, courseId: e.courseId, enrollmentId: e.id, data: { from: e.dueDate, to: dueDate ?? null } });
          updated++;
          break;
        }
        case 'remind': {
          if (e.status === 'Completed' || e.status === 'Withdrawn') {
            skipped++;
            break;
          }
          const link = `/courses/${course?.slug || e.courseId}`;
          await notify({ recipientIds: [e.personId], app: 'Learn', type: 'nudge', title: `Reminder: ${title}`, body: e.dueDate ? `Due ${formatLongDay(e.dueDate)}` : 'Pick up where you left off', courseId: e.courseId, actorId: actor.id, link });
          await emailPerson({
            trigger: 'Due reminder',
            template: reminder,
            settings,
            person: { email: str(r.personEmail) ?? '', name: str(r.personName), muteEmails: bool(r.personMute) },
            context: { course_title: title, due_date: e.dueDate ? formatLongDay(e.dueDate) : 'soon', days_left: e.dueDate ? daysLeftLabel(e.dueDate) : 'a few days', course_link: learnLink(settings, link) },
            link: learnLink(settings, link),
            buttonLabel: 'Continue the course',
          });
          await zite.enrollments.update({ id: e.id, record: { remindedAt: now } });
          updated++;
          break;
        }
        case 'withdraw': {
          if (e.status === 'Withdrawn') {
            skipped++;
            break;
          }
          await zite.enrollments.update({ id: e.id, record: { status: 'Withdrawn', withdrawnAt: now } });
          await logActivity({ type: 'withdrawn', personId: e.personId, actorId: actor.id, courseId: e.courseId, enrollmentId: e.id, data: note ? { note } : undefined });
          updated++;
          break;
        }
        case 'restore': {
          if (e.status !== 'Withdrawn') {
            skipped++;
            break;
          }
          await zite.enrollments.update({ id: e.id, record: { status: e.progress > 0 ? 'In progress' : 'Not started', withdrawnAt: null } });
          await recomputeEnrollment(e.id, { actorId: actor.id, settings });
          await logActivity({ type: 'restored', personId: e.personId, actorId: actor.id, courseId: e.courseId, enrollmentId: e.id });
          updated++;
          break;
        }
        case 'reset': {
          await resetEnrollment(e.id, actor.id);
          if (e.pathEnrollmentId) await recomputePathEnrollment(e.pathEnrollmentId, { settings });
          updated++;
          break;
        }
        case 'complete': {
          if (e.status === 'Completed' || e.status === 'Withdrawn') {
            skipped++;
            break;
          }
          await markEnrollmentComplete(e.id, { actorId: actor.id, settings, note });
          updated++;
          break;
        }
      }
    }
    return { updated, skipped };
  },
});
