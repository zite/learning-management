import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { firstName, formatLongDay } from '@project/shared/merge';
import { dueState } from '@project/shared/progress';
import { logActivity } from '@project/shared/server/activity';
import { emailPerson } from '@project/shared/server/email';
import { daysLeftLabel } from '@project/shared/server/enroll';
import { notify } from '@project/shared/server/notify';
import { getLearner } from '@project/shared/server/people';
import { getSettings, learnLink } from '@project/shared/server/settings';
import { bool, day, iso, str } from '@project/shared/server/sql';

/**
 * A manager nudges a direct report about one piece of open training: an
 * in-app reminder from them, plus the reminder email when the training has a
 * due date. At most once a day per enrollment, so a nudge stays a nudge.
 */

const Input = z.object({ enrollmentId: z.string().min(1).max(64) });

const DAY_MS = 24 * 60 * 60 * 1000;

export default createEndpoint({
  description: 'Remind a direct report about their training',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<{ remindedAt: string; emailed: boolean }> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Choose the training to send a reminder about.', 'BAD_REQUEST');
    const settings = await getSettings();
    const actor = await getLearner(context, settings);

    const { rows } = await zite.sql({
      query: `SELECT e.id::text AS id, e."status", e."dueDate", e."remindedAt", e."personId",
                p."name" AS "personName", p."email" AS "personEmail", p."muteEmails", p."managerId", p."status" AS "personStatus",
                c.id::text AS "courseKey", c."title" AS "courseTitle", c."slug" AS "courseSlug"
              FROM "Enrollments" e
              JOIN "People" p ON p.id::text = e."personId"
              JOIN "Courses" c ON c.id::text = e."courseId"
              WHERE e.id::text = $1`,
      params: [parsed.data.enrollmentId],
    });
    const e = rows[0];
    // Someone else's report reads as not found, so enrollment ids can't be probed.
    if (!e || e.managerId !== actor.id || e.personStatus === 'Deactivated') throw new ZiteError("We couldn't find that training on your team.", 'NOT_FOUND');
    const name = str(e.personName) ?? 'They';
    if (e.status !== 'Not started' && e.status !== 'In progress') throw new ZiteError(`${firstName(name)} has already finished this training.`, 'CONFLICT');

    const last = iso(e.remindedAt);
    if (last && Date.now() - Date.parse(last) < DAY_MS) {
      const minutes = Math.round((Date.now() - Date.parse(last)) / 60_000);
      const hours = Math.round(minutes / 60);
      const ago = minutes < 2 ? 'just now' : minutes < 60 ? `${minutes} minutes ago` : hours === 1 ? 'an hour ago' : `${hours} hours ago`;
      throw new ZiteError(`${firstName(name)} was reminded about this ${ago}. You can send another reminder tomorrow.`, 'CONFLICT');
    }

    const now = new Date().toISOString();
    await zite.enrollments.update({ id: String(e.id), record: { remindedAt: now } });

    const courseTitle = str(e.courseTitle) ?? 'your training';
    const dueDate = day(e.dueDate);
    const state = dueState({ status: String(e.status), dueDate });
    const link = `/courses/${str(e.courseSlug) || String(e.courseKey)}`;
    const managerFirst = firstName(actor.name) || 'Your manager';
    await notify({
      recipientIds: [String(e.personId)],
      app: 'Learn',
      type: 'nudge',
      title: `${managerFirst} sent you a reminder about ${courseTitle}`,
      body: dueDate ? (state === 'overdue' ? `It was due ${formatLongDay(dueDate)}.` : `It's due ${formatLongDay(dueDate)}.`) : 'Pick it up whenever you have a few minutes.',
      courseId: String(e.courseKey),
      actorId: actor.id,
      link,
    });

    await logActivity({ type: 'nudge', personId: String(e.personId), actorId: actor.id, courseId: String(e.courseKey), enrollmentId: String(e.id), data: { courseTitle } });

    let emailed = false;
    if (dueDate) {
      const result = await emailPerson({
        trigger: state === 'overdue' ? 'Overdue' : 'Due reminder',
        settings,
        person: { email: str(e.personEmail) ?? '', name, muteEmails: bool(e.muteEmails) },
        context: { course_title: courseTitle, due_date: formatLongDay(dueDate), days_left: daysLeftLabel(dueDate), course_link: learnLink(settings, link) },
        link: learnLink(settings, link),
        buttonLabel: 'Continue the course',
      });
      emailed = result === 'Sent';
    }
    return { remindedAt: now, emailed };
  },
});
