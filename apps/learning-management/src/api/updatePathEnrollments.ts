import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatLongDay } from '@project/shared/merge';
import { logActivity } from '@project/shared/server/activity';
import { toPath } from '@project/shared/server/courses';
import { emailPerson, findTemplate } from '@project/shared/server/email';
import { daysLeftLabel, recomputeEnrollment, recomputePathEnrollment, toPathEnrollment } from '@project/shared/server/enroll';
import { notify } from '@project/shared/server/notify';
import { assertStaff, getActor } from '@project/shared/server/people';
import { getSettings, learnLink } from '@project/shared/server/settings';
import { bool, str, withRetry } from '@project/shared/server/sql';

/**
 * Bulk changes to learning path enrollments: move the due date (and the due
 * date of the path's unfinished courses with it), remind, withdraw or restore.
 *
 * Withdrawing a path also withdraws the course enrollments the path created
 * that aren't finished yet — completed courses stay on the learner's record.
 * Restoring brings back exactly those, identified by being withdrawn at the
 * same moment as the path.
 */

const Input = z.object({
  ids: z.array(z.string()).min(1, 'Choose at least one learner').max(2000),
  action: z.enum(['set_due', 'remind', 'withdraw', 'restore']),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const SAME_MOMENT_MS = 5_000;

export default createEndpoint({
  description: 'Change due dates, remind, withdraw or restore learning path enrollments in bulk',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ updated: z.number(), skipped: z.number(), courseEnrollments: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const { ids, action, dueDate } = parsed.data;
    if (action === 'set_due' && dueDate === undefined) throw new ZiteError('Choose a due date, or clear it', 'BAD_REQUEST');

    const { rows } = await zite.sql({
      query: `SELECT pe.*, p."name" AS "personName", p."email" AS "personEmail", p."muteEmails" AS "personMute" FROM "PathEnrollments" pe JOIN "People" p ON p.id::text = pe."personId" WHERE pe.id::text = ANY($1::text[])`,
      params: [ids],
    });
    if (!rows.length) throw new ZiteError('Those enrollments no longer exist', 'NOT_FOUND');
    const pathIds = [...new Set(rows.map(r => String(r.pathId)))];
    const { rows: pathRows } = await zite.sql({ query: `SELECT * FROM "Paths" WHERE id::text = ANY($1::text[])`, params: [pathIds] });
    const paths = new Map(pathRows.map(r => [String(r.id), toPath(r)]));
    const settings = await getSettings();
    const reminder = action === 'remind' ? await findTemplate('Due reminder') : null;
    const now = new Date().toISOString();
    let updated = 0;
    let skipped = 0;
    let courseEnrollments = 0;

    for (const r of rows) {
      const pe = toPathEnrollment(r);
      const path = paths.get(pe.pathId);
      const title = path?.title ?? 'your learning path';
      const open = pe.status === 'Not started' || pe.status === 'In progress';
      switch (action) {
        case 'set_due': {
          if (!open) {
            skipped++;
            break;
          }
          await withRetry(() => zite.pathEnrollments.update({ id: pe.id, record: { dueDate: dueDate ?? null, remindedAt: null, overdueNotifiedAt: null } }));
          const { rows: linked } = await zite.sql({ query: `SELECT id FROM "Enrollments" WHERE "pathEnrollmentId" = $1 AND "status" IN ('Not started', 'In progress')`, params: [pe.id] });
          for (const e of linked) await withRetry(() => zite.enrollments.update({ id: String(e.id), record: { dueDate: dueDate ?? null, remindedAt: null, overdueNotifiedAt: null } }));
          courseEnrollments += linked.length;
          await logActivity({ type: 'due_date_changed', personId: pe.personId, actorId: actor.id, pathId: pe.pathId, data: { from: pe.dueDate, to: dueDate ?? null, pathTitle: title } });
          updated++;
          break;
        }
        case 'remind': {
          if (!open) {
            skipped++;
            break;
          }
          const link = `/paths/${path?.slug || pe.pathId}`;
          await notify({ recipientIds: [pe.personId], app: 'Learn', type: 'nudge', title: `Reminder: ${title}`, body: pe.dueDate ? `Due ${formatLongDay(pe.dueDate)}` : 'Pick up where you left off', pathId: pe.pathId, actorId: actor.id, link });
          await emailPerson({
            trigger: 'Due reminder',
            template: reminder,
            settings,
            person: { email: str(r.personEmail) ?? '', name: str(r.personName), muteEmails: bool(r.personMute) },
            context: { course_title: title, due_date: pe.dueDate ? formatLongDay(pe.dueDate) : 'soon', days_left: pe.dueDate ? daysLeftLabel(pe.dueDate) : 'a few days', course_link: learnLink(settings, link) },
            link: learnLink(settings, link),
            buttonLabel: 'Continue the path',
          });
          await withRetry(() => zite.pathEnrollments.update({ id: pe.id, record: { remindedAt: now } }));
          updated++;
          break;
        }
        case 'withdraw': {
          if (pe.status === 'Withdrawn') {
            skipped++;
            break;
          }
          await withRetry(() => zite.pathEnrollments.update({ id: pe.id, record: { status: 'Withdrawn', withdrawnAt: now } }));
          const { rows: linked } = await zite.sql({ query: `SELECT id, "courseId" FROM "Enrollments" WHERE "pathEnrollmentId" = $1 AND "source" = 'Path' AND "status" IN ('Not started', 'In progress')`, params: [pe.id] });
          for (const e of linked) {
            await withRetry(() => zite.enrollments.update({ id: String(e.id), record: { status: 'Withdrawn', withdrawnAt: now } }));
            await logActivity({ type: 'withdrawn', personId: pe.personId, actorId: actor.id, courseId: String(e.courseId), enrollmentId: String(e.id), data: { viaPath: pe.pathId, pathTitle: title } });
          }
          courseEnrollments += linked.length;
          await logActivity({ type: 'withdrawn', personId: pe.personId, actorId: actor.id, pathId: pe.pathId, data: { pathTitle: title, courses: linked.length } });
          updated++;
          break;
        }
        case 'restore': {
          if (pe.status !== 'Withdrawn') {
            skipped++;
            break;
          }
          await withRetry(() => zite.pathEnrollments.update({ id: pe.id, record: { status: 'Not started', withdrawnAt: null } }));
          const { rows: linked } = await zite.sql({ query: `SELECT id, "courseId", "progress", "withdrawnAt" FROM "Enrollments" WHERE "pathEnrollmentId" = $1 AND "status" = 'Withdrawn'`, params: [pe.id] });
          const at = pe.withdrawnAt ? Date.parse(pe.withdrawnAt) : NaN;
          for (const e of linked) {
            const when = e.withdrawnAt ? Date.parse(new Date(e.withdrawnAt as string).toISOString()) : NaN;
            // Only what the path withdrawal took with it; a course withdrawn on its own stays withdrawn.
            if (!Number.isFinite(at) || !Number.isFinite(when) || Math.abs(when - at) > SAME_MOMENT_MS) continue;
            await withRetry(() => zite.enrollments.update({ id: String(e.id), record: { status: Number(e.progress) > 0 ? 'In progress' : 'Not started', withdrawnAt: null } }));
            await recomputeEnrollment(String(e.id), { actorId: actor.id, settings, quiet: true });
            await logActivity({ type: 'restored', personId: pe.personId, actorId: actor.id, courseId: String(e.courseId), enrollmentId: String(e.id), data: { viaPath: pe.pathId, pathTitle: title } });
            courseEnrollments++;
          }
          await recomputePathEnrollment(pe.id, { actorId: actor.id, settings, quiet: true });
          await logActivity({ type: 'restored', personId: pe.personId, actorId: actor.id, pathId: pe.pathId, data: { pathTitle: title } });
          updated++;
          break;
        }
      }
    }
    return { updated, skipped, courseEnrollments };
  },
});
