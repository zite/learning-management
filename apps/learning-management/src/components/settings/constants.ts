import { PALETTE } from '@project/shared/palette';
import type { LucideIcon } from 'lucide-react';
import { Award, BellRing, BookOpen, CalendarCheck, CalendarClock, ClipboardCheck, Hourglass, Route, TriangleAlert, UserPlus, UsersRound } from 'lucide-react';

/**
 * Vocabulary for Settings: what each automatic email is for and when it goes
 * out, brand swatches, and a fallback time zone list for browsers without
 * `Intl.supportedValuesOf`.
 */

export type Trigger =
  | 'Invitation'
  | 'Course assigned'
  | 'Path assigned'
  | 'Due reminder'
  | 'Overdue'
  | 'Manager overdue digest'
  | 'Submission graded'
  | 'Certificate issued'
  | 'Certificate expiring'
  | 'Session registered'
  | 'Session reminder';

/** Same order as TEMPLATE_TRIGGERS on the server. */
export const TRIGGERS: Trigger[] = [
  'Invitation',
  'Course assigned',
  'Path assigned',
  'Due reminder',
  'Overdue',
  'Manager overdue digest',
  'Submission graded',
  'Certificate issued',
  'Certificate expiring',
  'Session registered',
  'Session reminder',
];

export const TRIGGER_INFO: Record<Trigger, { title: string; when: string; to: string; icon: LucideIcon; group: 'People' | 'Training' | 'Reminders' | 'Certificates' | 'Live sessions'; button: string }> = {
  Invitation: { title: 'Invitation', when: 'When an admin invites someone to the academy.', to: 'The person invited', icon: UserPlus, group: 'People', button: 'Open the academy' },
  'Course assigned': { title: 'Course assigned', when: 'When staff or an assignment rule enrolls someone in a course. Self-enrolling doesn’t send it.', to: 'The learner', icon: BookOpen, group: 'Training', button: 'Start the course' },
  'Path assigned': { title: 'Learning path assigned', when: 'When staff or an assignment rule enrolls someone in a learning path.', to: 'The learner', icon: Route, group: 'Training', button: 'Open the path' },
  'Due reminder': { title: 'Due date reminder', when: 'Daily, once unfinished training is due within the set number of days — at most every few days per enrollment. Staff can also send one by hand.', to: 'The learner', icon: BellRing, group: 'Reminders', button: 'Continue the course' },
  Overdue: { title: 'Overdue training', when: 'Daily once training is past its due date and still unfinished — at most once a week per enrollment.', to: 'The learner', icon: TriangleAlert, group: 'Reminders', button: 'Finish the course' },
  'Manager overdue digest': { title: 'Manager digest', when: 'At most weekly, when the manager digest is on and a manager’s direct reports have overdue training.', to: 'The manager', icon: UsersRound, group: 'Reminders', button: 'See your team' },
  'Submission graded': { title: 'Assignment graded', when: 'When an instructor grades a submission as passed or asks for a revision.', to: 'The learner', icon: ClipboardCheck, group: 'Training', button: 'See your feedback' },
  'Certificate issued': { title: 'Certificate earned', when: 'When someone completes a course or learning path that awards a certificate.', to: 'The learner', icon: Award, group: 'Certificates', button: 'View your certificate' },
  'Certificate expiring': { title: 'Certificate expiring', when: 'Before a certificate expires, when the learner is re-enrolled to recertify.', to: 'The learner', icon: Hourglass, group: 'Certificates', button: 'Recertify now' },
  'Session registered': { title: 'Session registration', when: 'When someone registers for a live session, or staff register them.', to: 'The registrant', icon: CalendarCheck, group: 'Live sessions', button: 'Session details' },
  'Session reminder': { title: 'Session reminder', when: 'The day before a live session starts, to everyone registered.', to: 'Registrants', icon: CalendarClock, group: 'Live sessions', button: 'Session details' },
};

export const asTrigger = (t: string): Trigger | null => ((TRIGGERS as string[]).includes(t) ? (t as Trigger) : null);

/** Brand colours that hold up as buttons and links in both learner themes. */
export { BRAND_SWATCHES } from '@project/shared/palette';

export const CATEGORY_COLORS = PALETTE;
export const CATEGORY_ICONS = ['🛡️', '📜', '🤝', '🌲', '📦', '🎯', '🛎️', '💬', '🧭', '⛑️', '📈', '✨', '🧠', '🎓', '🚀', '💡', '🏗️', '🧾', '🗂️', '🧰', '🌍', '💻', '❤️', '⚖️'];

export const FALLBACK_TIMEZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Toronto',
  'America/Mexico_City', 'America/Bogota', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Atlantic/Reykjavik', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon',
  'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul', 'Africa/Lagos',
  'Africa/Johannesburg', 'Africa/Nairobi', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Hong_Kong',
  'Asia/Shanghai', 'Asia/Manila', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];
