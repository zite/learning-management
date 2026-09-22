/**
 * Progress, due dates, locks and certificates — the rules both apps show and
 * the server enforces.
 *
 * Stored statuses are deliberately few (Not started, In progress, Completed,
 * Withdrawn). "Overdue", "Due soon" and "Expired" are derived from dates at
 * read time, so they can never go stale waiting for a job to flip them.
 */

export const ENROLLMENT_STATUSES = ['Not started', 'In progress', 'Completed', 'Withdrawn'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const asEnrollmentStatus = (v: unknown): EnrollmentStatus => (ENROLLMENT_STATUSES.includes(v as EnrollmentStatus) ? (v as EnrollmentStatus) : 'Not started');

export const ENROLLMENT_SOURCES = ['Assigned', 'Self-enrolled', 'Automatic', 'Path'] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];

export type DueState = 'done' | 'overdue' | 'due_soon' | 'on_track' | 'no_due' | 'withdrawn';

export const DUE_SOON_DAYS = 7;

export const DUE_STATE_LABEL: Record<DueState, string> = {
  done: 'Completed',
  overdue: 'Overdue',
  due_soon: 'Due soon',
  on_track: 'On track',
  no_due: 'No due date',
  withdrawn: 'Withdrawn',
};

/** Calendar day in UTC, `YYYY-MM-DD`. */
export const dayOf = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

export function daysBetween(fromDay: string, toDay: string) {
  return Math.round((Date.parse(`${toDay.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromDay.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export function dueState(input: { status: string; dueDate: string | null | undefined }, today = dayOf(new Date())): DueState {
  if (input.status === 'Withdrawn') return 'withdrawn';
  if (input.status === 'Completed') return 'done';
  if (!input.dueDate) return 'no_due';
  const days = daysBetween(today, input.dueDate);
  if (days < 0) return 'overdue';
  if (days <= DUE_SOON_DAYS) return 'due_soon';
  return 'on_track';
}

/** Whether a completed enrollment was finished by its due date (no due date counts as on time). */
export function completedOnTime(input: { completedAt: string | null | undefined; dueDate: string | null | undefined }) {
  if (!input.completedAt) return false;
  if (!input.dueDate) return true;
  return dayOf(input.completedAt) <= input.dueDate.slice(0, 10);
}

export function addDaysToDay(day: string, days: number) {
  return new Date(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function addMonthsIso(iso: string, months: number) {
  const d = new Date(iso);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes()));
  // Clamp to the month's last day, so Jan 31 + 1 month is Feb 28/29, not Mar 3.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString();
}

// ── Course progress ───────────────────────────────────────────────────────

export type LessonRef = { id: string; optional: boolean; sectionId?: string | null; position?: number };

/**
 * Percent complete, counted over required lessons. A course made only of
 * optional lessons counts all of them, so it can still be finished.
 */
export function courseProgress(lessons: LessonRef[], completedIds: Set<string>) {
  const counted = lessons.some(l => !l.optional) ? lessons.filter(l => !l.optional) : lessons;
  if (!counted.length) return { percent: 0, done: 0, total: 0, complete: false };
  const done = counted.filter(l => completedIds.has(l.id)).length;
  return { percent: Math.round((done / counted.length) * 100), done, total: counted.length, complete: done === counted.length };
}

/**
 * In a sequential course, a lesson unlocks once every REQUIRED lesson before it
 * is complete. Optional lessons never block. `ordered` must be in outline order.
 */
export function lockedLessonIds(ordered: LessonRef[], completedIds: Set<string>, sequential: boolean) {
  const locked = new Set<string>();
  if (!sequential) return locked;
  let blocked = false;
  for (const l of ordered) {
    if (blocked) locked.add(l.id);
    if (!l.optional && !completedIds.has(l.id)) blocked = true;
  }
  return locked;
}

/** The lesson to resume: the current one if unfinished, else the first unfinished unlocked lesson, else the first. */
export function resumeLessonId(ordered: LessonRef[], completedIds: Set<string>, currentLessonId: string | null | undefined, sequential: boolean) {
  const locked = lockedLessonIds(ordered, completedIds, sequential);
  if (currentLessonId && ordered.some(l => l.id === currentLessonId) && !completedIds.has(currentLessonId) && !locked.has(currentLessonId)) return currentLessonId;
  return ordered.find(l => !completedIds.has(l.id) && !locked.has(l.id))?.id ?? ordered[0]?.id ?? null;
}

// ── Paths ─────────────────────────────────────────────────────────────────

export type PathCourseRef = { courseId: string; optional: boolean; position: number };

export function pathProgress(courses: PathCourseRef[], completedCourseIds: Set<string>) {
  const counted = courses.some(c => !c.optional) ? courses.filter(c => !c.optional) : courses;
  if (!counted.length) return { percent: 0, done: 0, total: 0, complete: false };
  const done = counted.filter(c => completedCourseIds.has(c.courseId)).length;
  return { percent: Math.round((done / counted.length) * 100), done, total: counted.length, complete: done === counted.length };
}

/** Courses a learner can't start yet in a sequential path. */
export function lockedPathCourseIds(courses: PathCourseRef[], completedCourseIds: Set<string>, sequential: boolean) {
  const locked = new Set<string>();
  if (!sequential) return locked;
  let blocked = false;
  for (const c of [...courses].sort((a, b) => a.position - b.position)) {
    if (blocked) locked.add(c.courseId);
    if (!c.optional && !completedCourseIds.has(c.courseId)) blocked = true;
  }
  return locked;
}

// ── Certificates ──────────────────────────────────────────────────────────

export type CertificateState = 'active' | 'expiring' | 'expired' | 'revoked';

export const CERTIFICATE_EXPIRING_DAYS = 30;

export const CERTIFICATE_STATE_LABEL: Record<CertificateState, string> = { active: 'Active', expiring: 'Expiring soon', expired: 'Expired', revoked: 'Revoked' };

export function certificateState(input: { status: string; expiresAt: string | null | undefined }, now = Date.now()): CertificateState {
  if (input.status === 'Revoked') return 'revoked';
  if (!input.expiresAt) return 'active';
  const ms = Date.parse(input.expiresAt) - now;
  if (ms <= 0) return 'expired';
  if (ms <= CERTIFICATE_EXPIRING_DAYS * 86_400_000) return 'expiring';
  return 'active';
}

const CREDENTIAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A short, unambiguous, hard-to-guess credential id like `LX7K-9QPM-3RTA`. */
export function newCredentialId() {
  const pick = () => CREDENTIAL_ALPHABET[Math.floor(Math.random() * CREDENTIAL_ALPHABET.length)];
  const block = () => Array.from({ length: 4 }, pick).join('');
  return `${block()}-${block()}-${block()}`;
}

export const normaliseCredentialId = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-').slice(0, 14);

// ── Points (leaderboard) ──────────────────────────────────────────────────

/** Kept simple and explainable, and shown to learners as such. */
export const POINTS = { lesson: 10, course: 50, path: 150, quizPass: 20, perfectQuiz: 10 } as const;

// ── Misc ──────────────────────────────────────────────────────────────────

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function parseIdList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function parseStringList(raw: unknown, max = 50): string[] {
  return parseIdList(raw)
    .map(s => s.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, max);
}
