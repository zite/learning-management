import { zite } from 'zitejs/db';
import { chunked } from './sql';

/**
 * The audit trail — what a compliance auditor or a manager asks about: who
 * assigned this, when was it finished, who changed the due date, who reset it.
 * Person transcripts and course activity are read straight from it.
 */

export type ActivityType =
  | 'enrolled'
  | 'enrolled_path'
  | 'self_enrolled'
  | 'started'
  | 'lesson_completed'
  | 'quiz_attempted'
  | 'assignment_submitted'
  | 'assignment_graded'
  | 'course_completed'
  | 'path_completed'
  | 'certificate_issued'
  | 'certificate_revoked'
  | 'certificate_restored'
  | 'due_date_changed'
  | 'withdrawn'
  | 'restored'
  | 'progress_reset'
  | 'marked_complete'
  | 'course_rated'
  | 'nudge'
  | 'tutor_asked'
  | 'session_registered'
  | 'session_cancelled'
  | 'attendance_marked'
  | 'person_invited'
  | 'person_created'
  | 'role_changed'
  | 'manager_changed'
  | 'profile_updated'
  | 'person_deactivated'
  | 'person_reactivated'
  | 'group_joined'
  | 'group_left'
  | 'course_created'
  | 'course_published'
  | 'course_unpublished'
  | 'course_archived'
  | 'course_unarchived'
  | 'course_deleted'
  | 'path_published'
  | 'path_unpublished'
  | 'path_archived'
  | 'path_unarchived'
  | 'path_deleted'
  | 'rule_created'
  | 'rule_paused'
  | 'rule_resumed'
  | 'rule_archived'
  | 'rule_ran';

export type ActivityInput = {
  type: ActivityType;
  personId?: string | null;
  actorId?: string | null;
  courseId?: string | null;
  pathId?: string | null;
  lessonId?: string | null;
  enrollmentId?: string | null;
  data?: Record<string, unknown>;
  occurredAt?: string;
};

export async function logActivity(entries: ActivityInput | ActivityInput[]) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) return;
  const now = new Date().toISOString();
  await chunked(list, async batch => {
    await zite.activity.bulkCreate({
      records: batch.map(e => ({
        type: e.type,
        personId: e.personId ?? null,
        actorId: e.actorId ?? null,
        courseId: e.courseId ?? null,
        pathId: e.pathId ?? null,
        lessonId: e.lessonId ?? null,
        enrollmentId: e.enrollmentId ?? null,
        data: e.data ? JSON.stringify(e.data) : null,
        occurredAt: e.occurredAt ?? now,
      })),
    });
  });
}

export function parseData(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
