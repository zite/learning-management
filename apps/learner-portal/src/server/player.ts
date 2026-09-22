import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { asLessonType, gradeQuiz, type LessonType, type QuizAnswers, type QuizSettings } from '@project/shared/lessons';
import { dueState, lockedLessonIds, type DueState } from '@project/shared/progress';
import { parseData } from '@project/shared/server/activity';
import { loadCourse, loadOutline, type CourseRecord, type OutlineLesson, type OutlineSection } from '@project/shared/server/courses';
import { findActiveEnrollment, pathLockFor, type EnrollmentRow } from '@project/shared/server/enroll';
import { getLearner, type Actor } from '@project/shared/server/people';
import { getSettings, type OrgSettings } from '@project/shared/server/settings';
import { bool, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';

/**
 * The course player's access rules, shared by every player endpoint.
 *
 * One function answers "may this person see this course, and which lessons
 * are open to them", so the outline the learner sees and what the server lets
 * them do can never disagree:
 *
 *   - the course must be Published (Archived stays readable for people already
 *     enrolled, so a record doesn't vanish when a course is retired)
 *   - the learner needs an active (not withdrawn) enrollment of their own
 *   - a sequential course locks lessons behind unfinished required ones
 *   - a sequential path locks the whole course behind an earlier course
 *
 * A finished enrollment is never locked: completion is final, and someone
 * reviewing a course they passed shouldn't be stopped by a lesson added later.
 */

export type NoAccessReason = 'not_enrolled' | 'withdrawn' | 'unpublished';

export type ProgressEntry = { id: string; status: 'In progress' | 'Completed'; state: Record<string, unknown>; score: number | null; attempts: number };

export type LessonState = 'completed' | 'in_progress' | 'locked' | 'available';

export type PlayerContext = {
  actor: Actor;
  settings: OrgSettings;
  course: CourseRecord;
  sections: OutlineSection[];
  lessons: OutlineLesson[];
  enrollment: EnrollmentRow | null;
  reason: NoAccessReason | null;
  progress: Map<string, ProgressEntry>;
  completed: Set<string>;
  locked: Set<string>;
  /** The course that must be finished first, in a sequential path. */
  pathLock: string | null;
};

export async function loadProgress(enrollmentId: string): Promise<Map<string, ProgressEntry>> {
  const { rows } = await zite.sql({
    query: `SELECT id, "lessonId", "status", "state", "score", "attempts" FROM "LessonProgress" WHERE "enrollmentId" = $1 ORDER BY created_at ASC`,
    params: [enrollmentId],
  });
  const out = new Map<string, ProgressEntry>();
  for (const r of rows) {
    const lessonId = String(r.lessonId);
    // The engine reads the oldest row per lesson; so do we.
    if (out.has(lessonId)) continue;
    out.set(lessonId, { id: String(r.id), status: r.status === 'Completed' ? 'Completed' : 'In progress', state: parseData(r.state), score: numOrNull(r.score), attempts: num(r.attempts) });
  }
  return out;
}

export function completedSet(progress: Map<string, ProgressEntry>) {
  return new Set([...progress].filter(([, p]) => p.status === 'Completed').map(([id]) => id));
}

export function lockFor(ctx: Pick<PlayerContext, 'lessons' | 'enrollment' | 'course'>, completed: Set<string>) {
  if (!ctx.enrollment || ctx.enrollment.status === 'Completed') return new Set<string>();
  return lockedLessonIds(ctx.lessons, completed, ctx.course.sequential);
}

/** Load a course for the signed-in learner. Never throws for "no access" — `reason` says why. */
export async function loadPlayer(context: { user?: unknown }, slugOrId: string, opts: { withPathLock?: boolean } = {}): Promise<PlayerContext> {
  const settings = await getSettings();
  const actor = await getLearner(context as never, settings);
  const course = slugOrId ? await loadCourse(slugOrId) : null;
  if (!course) throw new ZiteError("We couldn't find that course. It may have been removed.", 'NOT_FOUND');
  const enrollment = await findActiveEnrollment(actor.id, course.id);
  let reason: NoAccessReason | null = null;
  if (course.status === 'Draft' || (course.status === 'Archived' && !enrollment)) reason = 'unpublished';
  else if (!enrollment) {
    const { rows } = await zite.sql({ query: `SELECT 1 FROM "Enrollments" WHERE "personId" = $1 AND "courseId" = $2 AND "status" = 'Withdrawn' LIMIT 1`, params: [actor.id, course.id] });
    reason = rows.length ? 'withdrawn' : 'not_enrolled';
  }

  const ctx: PlayerContext = { actor, settings, course, sections: [], lessons: [], enrollment: reason ? null : enrollment, reason, progress: new Map(), completed: new Set(), locked: new Set(), pathLock: null };
  if (reason || !enrollment) return ctx;

  const [outline, progress] = await Promise.all([loadOutline(course.id), loadProgress(enrollment.id)]);
  ctx.sections = outline.sections;
  ctx.lessons = outline.lessons;
  ctx.progress = progress;
  ctx.completed = completedSet(progress);
  ctx.locked = lockFor(ctx, ctx.completed);
  if (opts.withPathLock !== false && enrollment.status !== 'Completed') ctx.pathLock = await pathLockFor(enrollment);
  return ctx;
}

const NO_ACCESS_MESSAGE: Record<NoAccessReason, (title: string) => string> = {
  not_enrolled: title => `You're not enrolled in “${title}”. Enroll from the course page to start learning.`,
  withdrawn: title => `You were withdrawn from “${title}”. Ask your administrator if you need access again.`,
  unpublished: title => `“${title}” isn't available right now.`,
};

/** The actor's enrollment, or a clear refusal. */
export function requireEnrollment(ctx: PlayerContext): EnrollmentRow {
  if (ctx.reason || !ctx.enrollment) throw new ZiteError(NO_ACCESS_MESSAGE[ctx.reason ?? 'not_enrolled'](ctx.course.title), 'FORBIDDEN');
  return ctx.enrollment;
}

/** The first unfinished required lesson before this one — what a sequential course is waiting for. */
export function blockerFor(ctx: Pick<PlayerContext, 'lessons' | 'completed'>, lessonId: string): OutlineLesson | null {
  for (const l of ctx.lessons) {
    if (l.id === lessonId) return null;
    if (!l.optional && !ctx.completed.has(l.id)) return l;
  }
  return null;
}

/** A lesson in this course the learner may open right now. */
export function requireOpenLesson(ctx: PlayerContext, lessonId: string): OutlineLesson {
  requireEnrollment(ctx);
  const lesson = ctx.lessons.find(l => l.id === lessonId);
  if (!lesson) throw new ZiteError("That lesson isn't part of this course any more.", 'NOT_FOUND');
  if (ctx.pathLock) throw new ZiteError(`This course unlocks once you finish “${ctx.pathLock}”.`, 'FORBIDDEN');
  if (ctx.locked.has(lessonId)) {
    const blocker = blockerFor(ctx, lessonId);
    throw new ZiteError(blocker ? `Finish “${blocker.title}” first — this course is taken in order.` : 'This lesson is still locked.', 'FORBIDDEN');
  }
  return lesson;
}

export function lessonStateOf(ctx: Pick<PlayerContext, 'progress' | 'locked' | 'pathLock'>, lessonId: string): LessonState {
  const p = ctx.progress.get(lessonId);
  if (p?.status === 'Completed') return 'completed';
  if (ctx.pathLock || ctx.locked.has(lessonId)) return 'locked';
  return p ? 'in_progress' : 'available';
}

export type LessonRecord = {
  id: string;
  title: string;
  type: LessonType;
  body: string;
  mediaUrl: string | null;
  mediaName: string | null;
  settings: unknown;
  durationMinutes: number;
  optional: boolean;
  sectionId: string | null;
};

export async function loadLessonRecord(lessonId: string, courseId: string): Promise<LessonRecord> {
  const { rows } = await zite.sql({
    query: `SELECT id, "title", "type", "body", "mediaUrl", "mediaName", "settings", "durationMinutes", "optional", "sectionId" FROM "Lessons" WHERE id::text = $1 AND "courseId" = $2`,
    params: [lessonId, courseId],
  });
  const r = rows[0];
  if (!r) throw new ZiteError("That lesson isn't part of this course any more.", 'NOT_FOUND');
  return {
    id: String(r.id),
    title: str(r.title) ?? '',
    type: asLessonType(r.type),
    body: str(r.body) ?? '',
    mediaUrl: ref(r.mediaUrl),
    mediaName: ref(r.mediaName),
    settings: r.settings,
    durationMinutes: num(r.durationMinutes),
    optional: bool(r.optional),
    sectionId: ref(r.sectionId),
  };
}

/** Where to go after finishing a lesson: the next unfinished open lesson after it, else any unfinished one. */
export function nextLessonAfter(lessons: OutlineLesson[], lessonId: string, completed: Set<string>, locked: Set<string>) {
  const i = lessons.findIndex(l => l.id === lessonId);
  const open = (l: OutlineLesson) => !completed.has(l.id) && !locked.has(l.id) && l.id !== lessonId;
  return lessons.slice(i + 1).find(open)?.id ?? lessons.find(open)?.id ?? null;
}

export type CertificateSummary = { id: string; credentialId: string; issuedAt: string | null; expiresAt: string | null; status: string; title: string; recipientName: string };

export async function certificateSummary(id: string | null | undefined, personId: string): Promise<CertificateSummary | null> {
  if (!id) return null;
  const { rows } = await zite.sql({ query: `SELECT id, "credentialId", "issuedAt", "expiresAt", "status", "title", "recipientName" FROM "Certificates" WHERE id::text = $1 AND "personId" = $2`, params: [id, personId] });
  const r = rows[0];
  if (!r) return null;
  return { id: String(r.id), credentialId: str(r.credentialId) ?? '', issuedAt: iso(r.issuedAt), expiresAt: iso(r.expiresAt), status: str(r.status) || 'Active', title: str(r.title) ?? '', recipientName: str(r.recipientName) ?? '' };
}

export function enrollmentSummary(e: EnrollmentRow): { id: string; status: string; progress: number; dueDate: string | null; dueState: DueState; currentLessonId: string | null; certificateId: string | null; rating: number | null; review: string; completedAt: string | null } {
  return { id: e.id, status: e.status, progress: e.progress, dueDate: e.dueDate, dueState: dueState(e), currentLessonId: e.currentLessonId, certificateId: e.certificateId, rating: e.rating, review: e.review, completedAt: e.completedAt };
}

// ── Quizzes ───────────────────────────────────────────────────────────────

export type QuestionReview = { id: string; correct: boolean; selected: string[]; answerText: string; correctOptionIds: string[]; acceptedAnswers: string[]; explanation: string };

/** Per-question feedback for one attempt. Only call once `mayRevealAnswers` allows it. */
export function buildReview(settings: QuizSettings, answers: QuizAnswers): QuestionReview[] {
  const graded = gradeQuiz(settings, answers);
  const correctById = new Map(graded.results.map(r => [r.id, r.correct]));
  return settings.questions.map(q => {
    const given = answers[q.id];
    return {
      id: q.id,
      correct: correctById.get(q.id) ?? false,
      selected: q.type === 'short' ? [] : Array.isArray(given) ? given : typeof given === 'string' && given ? [given] : [],
      answerText: q.type === 'short' ? (typeof given === 'string' ? given : Array.isArray(given) ? given.join(' ') : '') : '',
      correctOptionIds: q.options.filter(o => o.correct).map(o => o.id),
      acceptedAnswers: q.type === 'short' ? q.acceptedAnswers : [],
      explanation: q.explanation,
    };
  });
}

// ── Live sessions ─────────────────────────────────────────────────────────

export type SessionView = {
  id: string;
  title: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  location: string;
  online: boolean;
  meetingUrl: string | null;
  recordingUrl: string | null;
  capacity: number | null;
  registeredCount: number;
  waitlistCount: number;
  cancelled: boolean;
  phase: 'upcoming' | 'live' | 'ended';
  instructorName: string | null;
  myRegistration: { id: string; status: string; waitlistPosition: number | null } | null;
};

const HOUR = 3_600_000;

/** Sessions for a lesson (or one session), as this learner may see them. */
export async function loadSessionViews(opts: { lessonId?: string; sessionId?: string; personId: string }): Promise<{ sessions: SessionView[]; scheduledCount: number }> {
  const { rows } = await zite.sql({
    query: `SELECT s.id, s."title", s."description", s."startsAt", s."endsAt", s."timezone", s."location", s."meetingUrl", s."recordingUrl", s."capacity", s."status", i."name" AS "instructorName",
              (SELECT COUNT(*) FROM "Registrations" r WHERE r."sessionId" = s.id::text AND r."status" IN ('Registered', 'Attended')) AS "takenTotal",
              (SELECT COUNT(*) FROM "Registrations" r WHERE r."sessionId" = s.id::text AND r."status" = 'Waitlisted') AS "waitTotal",
              mine.id AS "myId", mine."status" AS "myStatus",
              (SELECT COUNT(*) FROM "Registrations" w WHERE w."sessionId" = s.id::text AND w."status" = 'Waitlisted' AND mine."status" = 'Waitlisted' AND (w."registeredAt" < mine."registeredAt" OR (w."registeredAt" = mine."registeredAt" AND w.created_at < mine.created_at))) AS "aheadTotal"
            FROM "Sessions" s
            LEFT JOIN "People" i ON i.id::text = s."instructorId"
            LEFT JOIN LATERAL (SELECT r.id, r."status", r."registeredAt", r.created_at FROM "Registrations" r WHERE r."sessionId" = s.id::text AND r."personId" = $2 ORDER BY r.created_at DESC LIMIT 1) mine ON true
            WHERE ${opts.sessionId ? 's.id::text = $1' : 's."lessonId" = $1'}
            ORDER BY s."startsAt" ASC NULLS LAST`,
    params: [opts.sessionId ?? opts.lessonId ?? '', opts.personId],
  });
  const now = Date.now();
  let scheduledCount = 0;
  const sessions: SessionView[] = [];
  for (const r of rows) {
    const cancelled = r.status === 'Cancelled';
    if (!cancelled) scheduledCount++;
    const startsAt = iso(r.startsAt);
    const endsAt = iso(r.endsAt) ?? (startsAt ? new Date(Date.parse(startsAt) + HOUR).toISOString() : null);
    const start = startsAt ? Date.parse(startsAt) : 0;
    const end = endsAt ? Date.parse(endsAt) : 0;
    const phase: SessionView['phase'] = end && end < now ? 'ended' : start && start - 10 * 60_000 <= now ? 'live' : 'upcoming';
    const myStatus = str(r.myStatus);
    const mine = r.myId ? { id: String(r.myId), status: myStatus ?? 'Registered', waitlistPosition: myStatus === 'Waitlisted' ? num(r.aheadTotal) + 1 : null } : null;
    const active = mine && (mine.status === 'Registered' || mine.status === 'Attended');
    // For the lesson view: skip cancelled sessions nobody here signed up for, and old sessions this learner had nothing to do with.
    if (!opts.sessionId) {
      if (cancelled && !(mine && mine.status !== 'Cancelled')) continue;
      if (phase === 'ended' && !mine && (!ref(r.recordingUrl) || end < now - 60 * 24 * HOUR)) continue;
    }
    const meetingUrl = ref(r.meetingUrl);
    sessions.push({
      id: String(r.id),
      title: str(r.title) ?? '',
      description: str(r.description) ?? '',
      startsAt,
      endsAt,
      timezone: str(r.timezone) || 'UTC',
      location: str(r.location) ?? '',
      online: Boolean(meetingUrl) || /zoom|meet|teams|online|webex/i.test(str(r.location) ?? ''),
      // The join link is for people with a seat, from an hour before until the session ends.
      meetingUrl: active && !cancelled && start && now >= start - HOUR && now <= end ? meetingUrl : null,
      recordingUrl: phase === 'ended' && !cancelled ? ref(r.recordingUrl) : null,
      capacity: numOrNull(r.capacity) || null,
      registeredCount: num(r.takenTotal),
      waitlistCount: num(r.waitTotal),
      cancelled,
      phase,
      instructorName: ref(r.instructorName),
      myRegistration: mine,
    });
  }
  return { sessions, scheduledCount };
}

/** Section headings in a lesson body, for tutor citations and starter questions. */
export function headingsOf(markdown: string) {
  return [...markdown.matchAll(/^#{1,3}\s+(.+?)\s*#*\s*$/gm)].map(m => m[1].replace(/[*_`]/g, '').trim()).filter(Boolean);
}

export type SubmissionFile = { name: string; url: string; size: number; type: string };

export function parseFiles(raw: unknown): SubmissionFile[] {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter(f => f && typeof f === 'object' && typeof (f as { url?: unknown }).url === 'string')
    .map(f => {
      const o = f as Record<string, unknown>;
      return { name: String(o.name ?? 'File').slice(0, 200), url: String(o.url), size: num(o.size), type: String(o.type ?? '') };
    });
}

export type SessionRecord = {
  id: string;
  title: string;
  courseId: string | null;
  lessonId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  location: string;
  meetingUrl: string | null;
  capacity: number | null;
  instructorId: string | null;
  status: string;
};

/**
 * A session the signed-in learner may register for: it's scheduled, and if it
 * belongs to a course, they're actively enrolled in that (published) course.
 */
export async function loadSessionForLearner(context: { user?: unknown }, sessionId: string) {
  const settings = await getSettings();
  const actor = await getLearner(context as never, settings);
  const { rows } = await zite.sql({
    query: `SELECT id, "title", "courseId", "lessonId", "startsAt", "endsAt", "timezone", "location", "meetingUrl", "capacity", "instructorId", "status" FROM "Sessions" WHERE id::text = $1`,
    params: [sessionId],
  });
  const r = rows[0];
  if (!r) throw new ZiteError('That session no longer exists.', 'NOT_FOUND');
  const session: SessionRecord = {
    id: String(r.id),
    title: str(r.title) ?? 'Session',
    courseId: ref(r.courseId),
    lessonId: ref(r.lessonId),
    startsAt: iso(r.startsAt),
    endsAt: iso(r.endsAt),
    timezone: str(r.timezone) || settings.timezone,
    location: str(r.location) ?? '',
    meetingUrl: ref(r.meetingUrl),
    capacity: numOrNull(r.capacity) || null,
    instructorId: ref(r.instructorId),
    status: str(r.status) || 'Scheduled',
  };
  let course: CourseRecord | null = null;
  if (session.courseId) {
    const ctx = await loadPlayer(context, session.courseId, { withPathLock: false });
    requireEnrollment(ctx);
    course = ctx.course;
  }
  return { actor, settings, session, course };
}

/** Seats taken (registered or attended), excluding one person. */
export async function seatsTaken(sessionId: string, exceptPersonId?: string) {
  const { rows } = await zite.sql({
    query: `SELECT COUNT(*) AS "takenTotal" FROM "Registrations" WHERE "sessionId" = $1 AND "status" IN ('Registered', 'Attended') AND "personId" <> $2`,
    params: [sessionId, exceptPersonId ?? ''],
  });
  return num(rows[0]?.takenTotal);
}

export function sessionLocation(s: Pick<SessionRecord, 'location' | 'meetingUrl'>) {
  if (s.location && s.meetingUrl) return `${s.location} — join from the academy`;
  return s.location || (s.meetingUrl ? 'Online — join from the academy' : 'Details in the academy');
}

/** The player context for a lesson addressed by id alone (comments, the tutor). */
export async function loadLessonContext(context: { user?: unknown }, lessonId: string) {
  const { rows } = await zite.sql({ query: `SELECT "courseId" FROM "Lessons" WHERE id::text = $1`, params: [lessonId] });
  const courseId = ref(rows[0]?.courseId);
  if (!courseId) throw new ZiteError("That lesson isn't available any more.", 'NOT_FOUND');
  const ctx = await loadPlayer(context, courseId);
  const lesson = requireOpenLesson(ctx, lessonId);
  return { ctx, lesson };
}

export type CommentAuthor = { id: string; name: string; initials: string; color: string; avatarUrl: string | null; badge: 'Instructor' | 'Admin' | null };

/** Learners appear as "Priya N." to each other; staff by full name with their role. */
export function commentAuthor(r: Record<string, unknown>, courseStaff: Set<string>): CommentAuthor {
  const id = String(r.personId ?? '');
  const full = (str(r.authorName) ?? '').trim() || 'Former member';
  const parts = full.split(/\s+/).filter(Boolean);
  const role = str(r.authorRole);
  const staff = role === 'Admin' || role === 'Instructor' || courseStaff.has(id);
  const name = staff || parts.length < 2 ? full : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
  return {
    id,
    name,
    initials: (parts[0]?.[0] ?? '?').toUpperCase() + (parts.length > 1 ? parts[parts.length - 1][0].toUpperCase() : ''),
    color: str(r.authorColor) || '#6b7280',
    avatarUrl: ref(r.authorAvatarUrl),
    badge: staff ? (role === 'Admin' && !courseStaff.has(id) ? 'Admin' : 'Instructor') : null,
  };
}
