import { zite } from 'zitejs/db';
import { chunked } from './sql';

/**
 * In-app notifications. Each belongs to one app: staff see `Admin` ones in the
 * admin Inbox (work to grade, questions, escalations); learners see `Learn`
 * ones in the learner app (assignments, grades, certificates, replies). A
 * person who is both sees each in the right place.
 *
 * The actor never notifies themselves, and recipients are de-duplicated, so
 * callers can pass "everyone who might care" without filtering first.
 */

export type NotificationType =
  // Learn
  | 'course_assigned'
  | 'path_assigned'
  | 'due_soon'
  | 'overdue'
  | 'certificate_issued'
  | 'certificate_expiring'
  | 'certificate_revoked'
  | 'submission_graded'
  | 'comment_reply'
  | 'session_reminder'
  | 'session_updated'
  | 'nudge'
  // Admin
  | 'submission_received'
  | 'question_posted'
  | 'course_completed'
  | 'course_rated'
  | 'report_overdue'
  | 'session_registration'
  | 'rule_ran'
  | 'mention';

export type NotifyApp = 'Admin' | 'Learn';

export async function notify(n: {
  recipientIds: Array<string | null | undefined>;
  app: NotifyApp;
  type: NotificationType;
  title: string;
  body?: string | null;
  courseId?: string | null;
  pathId?: string | null;
  actorId?: string | null;
  /** A hash route inside the target app, e.g. `/grading/abc`. */
  link?: string | null;
  occurredAt?: string;
}) {
  const recipients = [...new Set(n.recipientIds.filter(Boolean) as string[])].filter(id => id !== n.actorId);
  if (!recipients.length) return 0;
  const now = n.occurredAt ?? new Date().toISOString();
  await chunked(recipients, async batch => {
    await zite.notifications.bulkCreate({
      records: batch.map(recipientId => ({
        title: n.title.slice(0, 240),
        body: n.body ? n.body.slice(0, 2000) : null,
        type: n.type,
        app: n.app,
        recipientId,
        actorId: n.actorId ?? null,
        courseId: n.courseId ?? null,
        pathId: n.pathId ?? null,
        link: n.link ?? null,
        occurredAt: now,
        readAt: null,
        archivedAt: null,
      })),
    });
  });
  return recipients.length;
}

/** `@[Name](personId)` tokens written by the mention composer. */
export function mentionedIds(body: string) {
  const ids = new Set<string>();
  for (const m of body.matchAll(/@\[[^\]]+\]\(([^)\s]+)\)/g)) ids.add(m[1]);
  return [...ids];
}

/** Mentions rendered as plain names, for notification previews and emails. */
export function plainMentions(body: string) {
  return body.replace(/@\[([^\]]+)\]\([^)\s]+\)/g, '@$1');
}
