/**
 * One sentence per activity type, used by every timeline (enrollment peek,
 * person transcript, course activity). `actor` is the person who acted, when
 * known; `subject` is the learner the event is about.
 */
import { shortDate } from '../../lib/format';

const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? shortDate(v) : String(v ?? ''));

export function activityText(type: string, data: Record<string, unknown>, opts: { actor?: string | null; subject?: string | null; lessonTitle?: string | null } = {}) {
  const actor = opts.actor || 'Someone';
  const subject = opts.subject || 'the learner';
  const course = (data.courseTitle as string) || (data.title as string) || (data.pathTitle as string) || 'the course';
  const lesson = opts.lessonTitle ? `“${opts.lessonTitle}”` : 'a lesson';
  switch (type) {
    case 'enrolled':
      return data.source === 'Automatic' ? `Enrolled by an assignment rule` : data.source === 'Path' ? 'Enrolled through a learning path' : `${actor} enrolled ${subject}`;
    case 'enrolled_path':
      return `${data.source === 'Automatic' ? 'An assignment rule' : actor} enrolled ${subject} in ${course}`;
    case 'self_enrolled':
      return `${subject} enrolled from the catalog`;
    case 'started':
      return `${subject} started`;
    case 'lesson_completed':
      return `${subject} completed ${lesson}`;
    case 'quiz_attempted':
      return `${subject} took ${lesson}${data.score != null ? ` · ${data.score}%` : ''}`;
    case 'assignment_submitted':
      return `${subject} submitted ${lesson}`;
    case 'assignment_graded':
      return `${actor} graded ${lesson}${data.grade != null ? ` · ${data.grade}` : ''}${data.status === 'Needs revision' ? ' · needs revision' : ''}`;
    case 'course_completed':
      return `${subject} completed ${course}`;
    case 'path_completed':
      return `${subject} completed the ${course} path`;
    case 'certificate_issued':
      return `Certificate issued${data.credentialId ? ` · ${data.credentialId}` : ''}`;
    case 'certificate_revoked':
      return `${actor} revoked the certificate${data.reason ? ` — ${data.reason}` : ''}`;
    case 'due_date_changed':
      return data.to ? `${actor} ${data.from ? 'moved' : 'set'} the due date${data.from ? ` from ${day(data.from)}` : ''} to ${day(data.to)}` : `${actor} removed the due date`;
    case 'withdrawn':
      return `${actor} withdrew ${subject}${data.note ? ` — ${data.note}` : ''}`;
    case 'restored':
      return `${actor} restored the enrollment`;
    case 'progress_reset':
      return `${actor} reset progress`;
    case 'marked_complete':
      return `${actor} marked it complete${data.note ? ` — ${data.note}` : ''}`;
    case 'tutor_asked':
      return `${subject} asked the study assistant about ${lesson}`;
    case 'nudge':
      return `${actor} sent ${subject} a reminder`;
    case 'course_rated':
      return `${subject} rated it ${data.rating ?? ''}★`;
    case 'session_registered':
      return `${subject} registered for ${(data.sessionTitle as string) || 'a live session'}`;
    case 'session_cancelled': {
      const title = (data.sessionTitle as string) || 'a live session';
      if (data.reason === 'session') return `${actor} cancelled ${title}`;
      if (data.reason === 'staff') return `${actor} cancelled ${subject}’s registration for ${title}`;
      return `${subject} cancelled their registration for ${title}`;
    }
    case 'attendance_marked':
      return `${actor} marked ${subject} ${String(data.status ?? 'attended').toLowerCase()}`;
    case 'person_invited':
      return `${actor} invited ${subject}`;
    case 'person_created':
      return `${actor} added ${subject}`;
    case 'role_changed':
      return data.from ? `${actor} changed ${subject}’s role from ${data.from} to ${data.to ?? ''}` : `${actor} made ${subject} ${data.to === 'Admin' ? 'an admin' : data.to === 'Instructor' ? 'an instructor' : 'a learner'}`;
    case 'manager_changed':
      return data.toName ? `${actor} set ${subject}’s manager to ${data.toName}` : data.to ? `${actor} changed ${subject}’s manager` : `${actor} removed ${subject}’s manager`;
    case 'profile_updated':
      return `${actor} updated ${subject}’s profile${Array.isArray(data.fields) && data.fields.length ? ` (${(data.fields as string[]).join(', ')})` : ''}`;
    case 'person_deactivated':
      return `${actor} deactivated ${subject}`;
    case 'person_reactivated':
      return `${actor} reactivated ${subject}`;
    case 'group_joined':
      return `${actor} added ${subject} to ${(data.groupName as string) || 'a group'}`;
    case 'group_left':
      return `${actor} removed ${subject} from ${(data.groupName as string) || 'a group'}`;
    case 'course_created':
      return `${actor} created ${course}`;
    case 'course_published':
      return `${actor} published ${course}`;
    case 'course_unpublished':
      return `${actor} moved ${course} back to draft`;
    case 'course_archived':
      return `${actor} archived ${course}`;
    case 'course_unarchived':
      return `${actor} restored ${course} from the archive`;
    case 'course_deleted':
      return `${actor} deleted ${course}`;
    case 'path_published':
      return `${actor} published the ${course} path`;
    case 'path_unpublished':
      return `${actor} moved the ${course} path back to draft`;
    case 'path_archived':
      return `${actor} archived the ${course} path`;
    case 'path_unarchived':
      return `${actor} restored the ${course} path from the archive`;
    case 'path_deleted':
      return `${actor} deleted the ${course} path`;
    case 'certificate_restored':
      return `${actor} restored the certificate`;
    case 'rule_paused':
      return `${actor} paused the ${(data.ruleName as string) || 'assignment'} rule`;
    case 'rule_resumed':
      return `${actor} resumed the ${(data.ruleName as string) || 'assignment'} rule`;
    case 'rule_archived':
      return `${actor} archived the ${(data.ruleName as string) || 'assignment'} rule`;
    case 'rule_created':
      return `${actor} created the ${(data.ruleName as string) || 'assignment'} rule`;
    case 'rule_ran':
      return `${(data.ruleName as string) || 'An assignment rule'} ran · ${data.enrolled ?? 0} enrolled`;
    default:
      return type.replace(/_/g, ' ');
  }
}
