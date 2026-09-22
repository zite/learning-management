import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatLongDay } from '../merge';
import { addMonthsIso, courseProgress, daysBetween, dayOf, lockedPathCourseIds, newCredentialId, pathProgress, type EnrollmentSource } from '../progress';
import { logActivity, type ActivityInput } from './activity';
import { loadCourse, loadOutline, loadPath, loadPathCourses } from './courses';
import { emailPerson, findTemplate } from './email';
import { notify } from './notify';
import { getSettings, learnLink, type OrgSettings } from './settings';
import { bool, chunked, day, iso, num, numOrNull, ref, str } from './sql';

/**
 * The enrollment engine, shared by both apps.
 *
 *   enroll → learner works through lessons → progress recomputed from lesson
 *   rows → course completes → certificate → any path containing it recomputes
 *
 * Progress is always DERIVED from Lesson Progress rows by `recomputeEnrollment`,
 * never incremented, so a retry, a reordered outline or a lesson added later
 * can't leave a percentage that disagrees with what was actually done.
 *
 * Completion is final: adding lessons to a course doesn't un-complete people
 * who already finished it (that's what an audit expects). Recertification
 * creates a NEW enrollment in the next `cycle` instead of reopening the old one.
 */

export type EnrollmentRow = {
  id: string;
  personId: string;
  courseId: string;
  pathEnrollmentId: string | null;
  ruleId: string | null;
  source: string;
  assignedById: string | null;
  status: string;
  progress: number;
  dueDate: string | null;
  enrolledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
  currentLessonId: string | null;
  score: number | null;
  timeSpentSeconds: number;
  certificateId: string | null;
  cycle: number;
  rating: number | null;
  review: string;
  withdrawnAt: string | null;
};

export function toEnrollment(r: Record<string, unknown>): EnrollmentRow {
  return {
    id: String(r.id),
    personId: String(r.personId ?? ''),
    courseId: String(r.courseId ?? ''),
    pathEnrollmentId: ref(r.pathEnrollmentId),
    ruleId: ref(r.ruleId),
    source: str(r.source) || 'Assigned',
    assignedById: ref(r.assignedById),
    status: str(r.status) || 'Not started',
    progress: num(r.progress),
    dueDate: day(r.dueDate),
    enrolledAt: iso(r.enrolledAt),
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
    lastActivityAt: iso(r.lastActivityAt),
    currentLessonId: ref(r.currentLessonId),
    score: numOrNull(r.score),
    timeSpentSeconds: num(r.timeSpentSeconds),
    certificateId: ref(r.certificateId),
    cycle: num(r.cycle, 1) || 1,
    rating: numOrNull(r.rating),
    review: str(r.review) ?? '',
    withdrawnAt: iso(r.withdrawnAt),
  };
}

type PersonLite = { id: string; name: string; email: string; status: string; muteEmails: boolean; managerId: string | null };

/** zite.sql returns at most 2,000 rows, so id lists are looked up in slices well under that. */
const LOOKUP_SLICE = 500;
const slices = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / LOOKUP_SLICE) }, (_, i) => items.slice(i * LOOKUP_SLICE, (i + 1) * LOOKUP_SLICE));

async function loadPeople(ids: string[]): Promise<Map<string, PersonLite>> {
  const out = new Map<string, PersonLite>();
  for (const slice of slices(ids)) {
    const { rows } = await zite.sql({ query: `SELECT id, "name", "email", "status", "muteEmails", "managerId" FROM "People" WHERE id::text = ANY($1::text[])`, params: [slice] });
    for (const r of rows) out.set(String(r.id), { id: String(r.id), name: str(r.name) ?? '', email: str(r.email) ?? '', status: str(r.status) || 'Active', muteEmails: bool(r.muteEmails), managerId: ref(r.managerId) });
  }
  return out;
}

/** Latest enrollment (highest cycle, newest) per person for a course. */
async function latestEnrollments(courseId: string, personIds: string[]) {
  const out = new Map<string, EnrollmentRow>();
  for (const slice of slices(personIds)) {
    const { rows } = await zite.sql({
      query: `SELECT * FROM "Enrollments" WHERE "courseId" = $1 AND "personId" = ANY($2::text[]) ORDER BY COALESCE("cycle", 1) DESC, created_at DESC`,
      params: [courseId, slice],
    });
    for (const r of rows) {
      const e = toEnrollment(r);
      if (!out.has(e.personId)) out.set(e.personId, e);
    }
  }
  return out;
}

/** The enrollment a learner is working on for a course: the latest one that isn't withdrawn. */
export async function findActiveEnrollment(personId: string, courseId: string): Promise<EnrollmentRow | null> {
  const { rows } = await zite.sql({
    query: `SELECT * FROM "Enrollments" WHERE "personId" = $1 AND "courseId" = $2 AND COALESCE("status", '') <> 'Withdrawn' ORDER BY COALESCE("cycle", 1) DESC, created_at DESC LIMIT 1`,
    params: [personId, courseId],
  });
  return rows[0] ? toEnrollment(rows[0]) : null;
}

export async function loadEnrollment(id: string): Promise<EnrollmentRow | null> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Enrollments" WHERE id::text = $1`, params: [id] });
  return rows[0] ? toEnrollment(rows[0]) : null;
}

export type EnrollResult = { created: string[]; reactivated: string[]; skipped: number; skippedInactive: number };

/**
 * Enroll people in a course. Idempotent per person: someone already working
 * on it (or finished, outside a recertification) is skipped, a withdrawn
 * enrollment is restored with its progress intact.
 */
export async function enrollInCourse(opts: {
  courseId: string;
  personIds: string[];
  source: EnrollmentSource;
  assignedById?: string | null;
  dueDate?: string | null;
  ruleId?: string | null;
  pathEnrollmentId?: string | null;
  /** Send the in-app notice and "Course assigned" email. Defaults to true for Assigned/Automatic. */
  notify?: boolean;
  /** Start a new cycle for people who already completed it (recertification). */
  newCycle?: boolean;
  settings?: OrgSettings;
  allowUnpublished?: boolean;
}): Promise<EnrollResult> {
  const result: EnrollResult = { created: [], reactivated: [], skipped: 0, skippedInactive: 0 };
  const personIds = [...new Set(opts.personIds.filter(Boolean))];
  if (!personIds.length) return result;
  const course = await loadCourse(opts.courseId);
  if (!course) throw new ZiteError('That course no longer exists', 'NOT_FOUND');
  if (course.status !== 'Published' && !opts.allowUnpublished) throw new ZiteError(`Publish “${course.title}” before enrolling people in it`, 'BAD_REQUEST');

  const settings = opts.settings ?? (await getSettings());
  const people = await loadPeople(personIds);
  const latest = await latestEnrollments(course.id, personIds);
  const now = new Date().toISOString();
  const toCreate: Array<Record<string, unknown>> = [];
  const createdFor: string[] = [];
  const activity: ActivityInput[] = [];

  for (const personId of personIds) {
    const person = people.get(personId);
    if (!person || person.status === 'Deactivated') {
      result.skippedInactive++;
      continue;
    }
    const existing = latest.get(personId);
    const base = {
      label: `${person.name || person.email} · ${course.title}`.slice(0, 240),
      personId,
      courseId: course.id,
      pathEnrollmentId: opts.pathEnrollmentId ?? null,
      ruleId: opts.ruleId ?? null,
      source: opts.source,
      assignedById: opts.assignedById ?? null,
      status: 'Not started',
      progress: 0,
      dueDate: opts.dueDate ?? null,
      enrolledAt: now,
      timeSpentSeconds: 0,
    };
    if (!existing) {
      toCreate.push({ ...base, cycle: 1 });
      createdFor.push(personId);
    } else if (existing.status === 'Withdrawn') {
      await zite.enrollments.update({
        id: existing.id,
        record: { status: existing.progress > 0 ? 'In progress' : 'Not started', withdrawnAt: null, dueDate: opts.dueDate ?? existing.dueDate, source: opts.source, assignedById: opts.assignedById ?? existing.assignedById, ruleId: opts.ruleId ?? existing.ruleId, pathEnrollmentId: opts.pathEnrollmentId ?? existing.pathEnrollmentId },
      });
      await recomputeEnrollment(existing.id, { settings, quiet: true });
      result.reactivated.push(existing.id);
      activity.push({ type: 'restored', personId, actorId: opts.assignedById ?? null, courseId: course.id, enrollmentId: existing.id });
    } else if (existing.status === 'Completed' && opts.newCycle) {
      toCreate.push({ ...base, cycle: existing.cycle + 1 });
      createdFor.push(personId);
    } else {
      // Already enrolled. Fill gaps (a due date, a path link) without overriding what's set.
      const patch: Record<string, unknown> = {};
      if (opts.dueDate && !existing.dueDate && existing.status !== 'Completed') patch.dueDate = opts.dueDate;
      if (opts.pathEnrollmentId && !existing.pathEnrollmentId) patch.pathEnrollmentId = opts.pathEnrollmentId;
      if (Object.keys(patch).length) await zite.enrollments.update({ id: existing.id, record: patch as never });
      result.skipped++;
    }
  }

  await chunked(toCreate, async batch => {
    const res = await zite.enrollments.bulkCreate({ records: batch as never });
    result.created.push(...res.records.map(r => r.id));
  });

  result.created.forEach((id, i) => {
    activity.push({
      type: opts.source === 'Self-enrolled' ? 'self_enrolled' : 'enrolled',
      personId: createdFor[i],
      actorId: opts.assignedById ?? null,
      courseId: course.id,
      enrollmentId: id,
      data: { source: opts.source, dueDate: opts.dueDate ?? null, ruleId: opts.ruleId ?? null, courseTitle: course.title },
    });
  });
  await logActivity(activity);

  const shouldNotify = opts.notify ?? (opts.source === 'Assigned' || opts.source === 'Automatic');
  if (shouldNotify && createdFor.length) {
    await notify({
      recipientIds: createdFor,
      app: 'Learn',
      type: 'course_assigned',
      title: `New training: ${course.title}`,
      body: opts.dueDate ? `Due ${formatLongDay(opts.dueDate)}` : course.summary || null,
      courseId: course.id,
      actorId: opts.assignedById ?? null,
      link: `/courses/${course.slug || course.id}`,
    });
    const template = await findTemplate('Course assigned');
    if (template) {
      for (const personId of createdFor) {
        const person = people.get(personId)!;
        await emailPerson({
          trigger: 'Course assigned',
          template,
          settings,
          person,
          context: { course_title: course.title, due_date: opts.dueDate ? formatLongDay(opts.dueDate) : 'your own pace', course_link: learnLink(settings, `/courses/${course.slug || course.id}`) },
          link: learnLink(settings, `/courses/${course.slug || course.id}`),
          buttonLabel: 'Start the course',
        });
      }
    }
  }

  // Someone who already completed a course in a path should see that reflected.
  // (enrollInPath recomputes once after all its courses, so skip it here for path-sourced calls.)
  if (opts.pathEnrollmentId && opts.source !== 'Path' && (result.created.length || result.skipped)) await recomputePathEnrollment(opts.pathEnrollmentId, { settings, quiet: true });
  return result;
}

export type PathEnrollmentRow = {
  id: string;
  personId: string;
  pathId: string;
  ruleId: string | null;
  source: string;
  assignedById: string | null;
  status: string;
  progress: number;
  dueDate: string | null;
  enrolledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  certificateId: string | null;
  cycle: number;
  withdrawnAt: string | null;
};

export function toPathEnrollment(r: Record<string, unknown>): PathEnrollmentRow {
  return {
    id: String(r.id),
    personId: String(r.personId ?? ''),
    pathId: String(r.pathId ?? ''),
    ruleId: ref(r.ruleId),
    source: str(r.source) || 'Assigned',
    assignedById: ref(r.assignedById),
    status: str(r.status) || 'Not started',
    progress: num(r.progress),
    dueDate: day(r.dueDate),
    enrolledAt: iso(r.enrolledAt),
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
    certificateId: ref(r.certificateId),
    cycle: num(r.cycle, 1) || 1,
    withdrawnAt: iso(r.withdrawnAt),
  };
}

/** Enroll people in a learning path and in each of its courses. */
export async function enrollInPath(opts: {
  pathId: string;
  personIds: string[];
  source: Exclude<EnrollmentSource, 'Path'>;
  assignedById?: string | null;
  dueDate?: string | null;
  ruleId?: string | null;
  notify?: boolean;
  newCycle?: boolean;
  settings?: OrgSettings;
}): Promise<EnrollResult> {
  const result: EnrollResult = { created: [], reactivated: [], skipped: 0, skippedInactive: 0 };
  const personIds = [...new Set(opts.personIds.filter(Boolean))];
  if (!personIds.length) return result;
  const path = await loadPath(opts.pathId);
  if (!path) throw new ZiteError('That learning path no longer exists', 'NOT_FOUND');
  if (path.status !== 'Published') throw new ZiteError(`Publish “${path.title}” before enrolling people in it`, 'BAD_REQUEST');
  const courses = await loadPathCourses(path.id);
  if (!courses.length) throw new ZiteError(`Add courses to “${path.title}” before enrolling people`, 'BAD_REQUEST');

  const settings = opts.settings ?? (await getSettings());
  const people = await loadPeople(personIds);
  const latest = new Map<string, PathEnrollmentRow>();
  for (const slice of slices(personIds)) {
    const { rows } = await zite.sql({ query: `SELECT * FROM "PathEnrollments" WHERE "pathId" = $1 AND "personId" = ANY($2::text[]) ORDER BY COALESCE("cycle", 1) DESC, created_at DESC`, params: [path.id, slice] });
    for (const r of rows) {
      const pe = toPathEnrollment(r);
      if (!latest.has(pe.personId)) latest.set(pe.personId, pe);
    }
  }

  const now = new Date().toISOString();
  const work: Array<{ personId: string; pathEnrollmentId: string; isNew: boolean }> = [];
  for (const personId of personIds) {
    const person = people.get(personId);
    if (!person || person.status === 'Deactivated') {
      result.skippedInactive++;
      continue;
    }
    const existing = latest.get(personId);
    const record = {
      label: `${person.name || person.email} · ${path.title}`.slice(0, 240),
      personId,
      pathId: path.id,
      ruleId: opts.ruleId ?? null,
      source: opts.source,
      assignedById: opts.assignedById ?? null,
      status: 'Not started',
      progress: 0,
      dueDate: opts.dueDate ?? null,
      enrolledAt: now,
    };
    if (!existing) {
      const created = await zite.pathEnrollments.create({ record: { ...record, cycle: 1 } as never });
      result.created.push(created.id);
      work.push({ personId, pathEnrollmentId: created.id, isNew: true });
    } else if (existing.status === 'Withdrawn') {
      await zite.pathEnrollments.update({ id: existing.id, record: { status: 'Not started', withdrawnAt: null, dueDate: opts.dueDate ?? existing.dueDate } });
      result.reactivated.push(existing.id);
      work.push({ personId, pathEnrollmentId: existing.id, isNew: false });
    } else if (existing.status === 'Completed' && opts.newCycle) {
      const created = await zite.pathEnrollments.create({ record: { ...record, cycle: existing.cycle + 1 } as never });
      result.created.push(created.id);
      work.push({ personId, pathEnrollmentId: created.id, isNew: true });
    } else {
      result.skipped++;
    }
  }

  for (const w of work) {
    for (const c of courses) {
      await enrollInCourse({
        courseId: c.courseId,
        personIds: [w.personId],
        source: 'Path',
        assignedById: opts.assignedById,
        dueDate: opts.dueDate,
        ruleId: opts.ruleId,
        pathEnrollmentId: w.pathEnrollmentId,
        notify: false,
        newCycle: opts.newCycle,
        settings,
        allowUnpublished: true,
      }).catch(e => console.error('Path course enrollment failed', c.courseId, e));
    }
    await recomputePathEnrollment(w.pathEnrollmentId, { settings, quiet: true });
  }

  await logActivity(
    work.filter(w => w.isNew).map(w => ({ type: 'enrolled_path' as const, personId: w.personId, actorId: opts.assignedById ?? null, pathId: path.id, data: { source: opts.source, dueDate: opts.dueDate ?? null, pathTitle: path.title } })),
  );

  const createdFor = work.filter(w => w.isNew).map(w => w.personId);
  if ((opts.notify ?? opts.source !== 'Self-enrolled') && createdFor.length) {
    await notify({ recipientIds: createdFor, app: 'Learn', type: 'path_assigned', title: `New learning path: ${path.title}`, body: opts.dueDate ? `Due ${formatLongDay(opts.dueDate)}` : path.summary || null, pathId: path.id, actorId: opts.assignedById ?? null, link: `/paths/${path.slug || path.id}` });
    const template = await findTemplate('Path assigned');
    if (template) {
      for (const personId of createdFor) {
        await emailPerson({
          trigger: 'Path assigned',
          template,
          settings,
          person: people.get(personId)!,
          context: { course_title: path.title, due_date: opts.dueDate ? formatLongDay(opts.dueDate) : 'your own pace', course_link: learnLink(settings, `/paths/${path.slug || path.id}`) },
          link: learnLink(settings, `/paths/${path.slug || path.id}`),
          buttonLabel: 'Open the path',
        });
      }
    }
  }
  return result;
}

export type RecomputeResult = { status: string; progress: number; completedNow: boolean; certificateId: string | null };

/**
 * Derive an enrollment's progress, status, score and time from its lesson
 * rows. Completing the course issues the certificate and moves any path
 * that contains it forward.
 */
export async function recomputeEnrollment(enrollmentId: string, opts: { actorId?: string | null; settings?: OrgSettings; occurredAt?: string; quiet?: boolean } = {}): Promise<RecomputeResult> {
  const e = await loadEnrollment(enrollmentId);
  if (!e) throw new ZiteError('Enrollment not found', 'NOT_FOUND');
  if (e.status === 'Withdrawn') return { status: e.status, progress: e.progress, completedNow: false, certificateId: e.certificateId };

  const [{ lessons }, progressRes] = await Promise.all([
    loadOutline(e.courseId),
    zite.sql({ query: `SELECT "lessonId", "status", "score", "timeSpentSeconds", "startedAt" FROM "LessonProgress" WHERE "enrollmentId" = $1`, params: [e.id] }),
  ]);
  const lessonIds = new Set(lessons.map(l => l.id));
  const rows = progressRes.rows.filter(r => lessonIds.has(String(r.lessonId)));
  const completed = new Set(rows.filter(r => r.status === 'Completed').map(r => String(r.lessonId)));
  const p = courseProgress(lessons, completed);
  const quizIds = new Set(lessons.filter(l => l.type === 'Quiz').map(l => l.id));
  const scores = rows.filter(r => quizIds.has(String(r.lessonId)) && r.score != null && r.score !== '').map(r => num(r.score));
  const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const time = progressRes.rows.reduce((s, r) => s + num(r.timeSpentSeconds), 0);
  const now = opts.occurredAt ?? new Date().toISOString();

  const patch: Record<string, unknown> = { score, timeSpentSeconds: time };
  let completedNow = false;
  let status = e.status;
  if (e.status === 'Completed') {
    // Final — see the file comment.
  } else if (p.complete) {
    status = 'Completed';
    completedNow = true;
    Object.assign(patch, { status, progress: 100, completedAt: now, startedAt: e.startedAt ?? now, lastActivityAt: now });
  } else {
    status = rows.length ? 'In progress' : 'Not started';
    Object.assign(patch, { status, progress: p.percent });
    if (rows.length && !e.startedAt) patch.startedAt = now;
  }
  await zite.enrollments.update({ id: e.id, record: patch as never });

  let certificateId = e.certificateId;
  if (completedNow) {
    const settings = opts.settings ?? (await getSettings());
    const course = await loadCourse(e.courseId);
    const people = await loadPeople([e.personId]);
    const person = people.get(e.personId);
    await logActivity({ type: 'course_completed', personId: e.personId, actorId: opts.actorId ?? e.personId, courseId: e.courseId, enrollmentId: e.id, occurredAt: now, data: { score, courseTitle: course?.title ?? '' } });
    if (course?.certificateEnabled && person && !e.certificateId) {
      certificateId = await issueCertificate({
        settings,
        person,
        courseId: course.id,
        title: course.title,
        enrollmentId: e.id,
        score,
        validityMonths: course.certificateValidityMonths,
        issuedAt: now,
        link: `/courses/${course.slug || course.id}`,
      });
    }
    // Paths that include this course.
    const { rows: pes } = await zite.sql({
      query: `SELECT pe.id FROM "PathEnrollments" pe WHERE pe."personId" = $1 AND COALESCE(pe."status", '') NOT IN ('Withdrawn', 'Completed')
                AND EXISTS (SELECT 1 FROM "PathCourses" pc WHERE pc."pathId" = pe."pathId" AND pc."courseId" = $2)`,
      params: [e.personId, e.courseId],
    });
    for (const pe of pes) await recomputePathEnrollment(String(pe.id), { settings, occurredAt: now, actorId: opts.actorId });
  }
  return { status, progress: completedNow || status === 'Completed' ? 100 : p.percent, completedNow, certificateId };
}

/** Derive a path enrollment from the person's course enrollments. */
export async function recomputePathEnrollment(pathEnrollmentId: string, opts: { actorId?: string | null; settings?: OrgSettings; occurredAt?: string; quiet?: boolean } = {}) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "PathEnrollments" WHERE id::text = $1`, params: [pathEnrollmentId] });
  if (!rows[0]) return null;
  const pe = toPathEnrollment(rows[0]);
  if (pe.status === 'Withdrawn' || pe.status === 'Completed') return pe;
  const path = await loadPath(pe.pathId);
  if (!path) return pe;
  const courses = await loadPathCourses(pe.pathId);
  const { rows: ens } = await zite.sql({
    query: `SELECT "courseId", "status", "pathEnrollmentId", "startedAt" FROM "Enrollments" WHERE "personId" = $1 AND "courseId" = ANY($2::text[]) AND COALESCE("status", '') <> 'Withdrawn'`,
    params: [pe.personId, courses.map(c => c.courseId)],
  });
  const completed = new Set(ens.filter(r => r.status === 'Completed' && (pe.cycle === 1 || r.pathEnrollmentId === pe.id)).map(r => String(r.courseId)));
  const started = ens.some(r => r.status !== 'Not started' || r.startedAt);
  const p = pathProgress(courses, completed);
  const now = opts.occurredAt ?? new Date().toISOString();
  const patch: Record<string, unknown> = { progress: p.percent, status: p.complete ? 'Completed' : started || completed.size ? 'In progress' : 'Not started' };
  if ((started || completed.size) && !pe.startedAt) patch.startedAt = now;
  if (p.complete) patch.completedAt = now;
  await zite.pathEnrollments.update({ id: pe.id, record: patch as never });

  if (p.complete) {
    const settings = opts.settings ?? (await getSettings());
    const person = (await loadPeople([pe.personId])).get(pe.personId);
    await logActivity({ type: 'path_completed', personId: pe.personId, actorId: opts.actorId ?? pe.personId, pathId: pe.pathId, occurredAt: now, data: { pathTitle: path.title } });
    if (path.certificateEnabled && person && !pe.certificateId) {
      await issueCertificate({ settings, person, pathId: path.id, title: path.title, pathEnrollmentId: pe.id, score: null, validityMonths: path.certificateValidityMonths, issuedAt: now, link: `/paths/${path.slug || path.id}` });
    }
  }
  return { ...pe, ...patch } as PathEnrollmentRow;
}

/** Issue a certificate, link it to the enrollment, and tell the learner. */
export async function issueCertificate(input: {
  settings: OrgSettings;
  person: { id: string; name: string; email: string; muteEmails?: boolean };
  courseId?: string | null;
  pathId?: string | null;
  title: string;
  enrollmentId?: string | null;
  pathEnrollmentId?: string | null;
  score: number | null;
  validityMonths: number | null;
  issuedAt?: string;
  issuedById?: string | null;
  link?: string;
}) {
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const expiresAt = input.validityMonths ? addMonthsIso(issuedAt, input.validityMonths) : null;
  const credentialId = newCredentialId();
  const created = await zite.certificates.create({
    record: {
      credentialId,
      personId: input.person.id,
      courseId: input.courseId ?? null,
      pathId: input.pathId ?? null,
      enrollmentId: input.enrollmentId ?? input.pathEnrollmentId ?? null,
      title: input.title.slice(0, 240),
      recipientName: input.person.name || input.person.email,
      issuedAt,
      expiresAt,
      status: 'Active',
      issuedById: input.issuedById ?? null,
      score: input.score,
    },
  });
  if (input.enrollmentId) await zite.enrollments.update({ id: input.enrollmentId, record: { certificateId: created.id } });
  if (input.pathEnrollmentId) await zite.pathEnrollments.update({ id: input.pathEnrollmentId, record: { certificateId: created.id } });
  await logActivity({ type: 'certificate_issued', personId: input.person.id, actorId: input.issuedById ?? null, courseId: input.courseId ?? null, pathId: input.pathId ?? null, occurredAt: issuedAt, data: { credentialId, title: input.title, certificateId: created.id } });
  await notify({ recipientIds: [input.person.id], app: 'Learn', type: 'certificate_issued', title: `You earned a certificate: ${input.title}`, body: expiresAt ? `Valid until ${formatLongDay(expiresAt)}` : null, courseId: input.courseId ?? null, pathId: input.pathId ?? null, link: `/certificates/${created.id}`, occurredAt: issuedAt });
  await emailPerson({
    trigger: 'Certificate issued',
    settings: input.settings,
    person: input.person,
    context: { course_title: input.title, credential_id: credentialId, certificate_link: learnLink(input.settings, `/certificates/${created.id}`), expires_on: expiresAt ? formatLongDay(expiresAt) : 'never' },
    link: learnLink(input.settings, `/certificates/${created.id}`),
    buttonLabel: 'View your certificate',
  });
  return created.id;
}

/** Record time on a lesson and mark the enrollment as started. `seconds` is capped per call so a stuck tab can't inflate time. */
export async function touchLesson(input: { enrollment: EnrollmentRow; lessonId: string; seconds?: number; state?: Record<string, unknown> | null }) {
  const { enrollment: e, lessonId } = input;
  const now = new Date().toISOString();
  const add = Math.max(0, Math.min(300, Math.round(input.seconds ?? 0)));
  const { rows } = await zite.sql({ query: `SELECT id, "status", "timeSpentSeconds" FROM "LessonProgress" WHERE "enrollmentId" = $1 AND "lessonId" = $2 ORDER BY created_at ASC LIMIT 1`, params: [e.id, lessonId] });
  let progressId: string;
  if (rows[0]) {
    progressId = String(rows[0].id);
    const patch: Record<string, unknown> = { timeSpentSeconds: num(rows[0].timeSpentSeconds) + add };
    if (input.state) patch.state = JSON.stringify(input.state);
    if (add || input.state) await zite.lessonProgress.update({ id: progressId, record: patch as never });
  } else {
    const created = await zite.lessonProgress.create({
      record: { enrollmentId: e.id, personId: e.personId, courseId: e.courseId, lessonId, status: 'In progress', startedAt: now, timeSpentSeconds: add, attempts: 0, state: input.state ? JSON.stringify(input.state) : null },
    });
    progressId = created.id;
  }
  const patch: Record<string, unknown> = { currentLessonId: lessonId, lastActivityAt: now, timeSpentSeconds: e.timeSpentSeconds + add };
  if (e.status === 'Not started') {
    patch.status = 'In progress';
    patch.startedAt = now;
    await logActivity({ type: 'started', personId: e.personId, actorId: e.personId, courseId: e.courseId, enrollmentId: e.id, lessonId });
  }
  await zite.enrollments.update({ id: e.id, record: patch as never });
  await zite.people.update({ id: e.personId, record: { lastLearnedAt: now } }).catch(() => undefined);
  return progressId;
}

/** Mark a lesson complete for an enrollment (idempotent), then recompute. */
export async function completeLesson(input: { enrollment: EnrollmentRow; lessonId: string; score?: number | null; state?: Record<string, unknown> | null; actorId?: string | null; settings?: OrgSettings; occurredAt?: string }) {
  const { enrollment: e, lessonId } = input;
  const now = input.occurredAt ?? new Date().toISOString();
  await touchLesson({ enrollment: e, lessonId, state: input.state ?? null });
  const { rows } = await zite.sql({ query: `SELECT id, "status", "score" FROM "LessonProgress" WHERE "enrollmentId" = $1 AND "lessonId" = $2 ORDER BY created_at ASC LIMIT 1`, params: [e.id, lessonId] });
  const row = rows[0];
  if (row) {
    const best = input.score == null ? numOrNull(row.score) : Math.max(input.score, numOrNull(row.score) ?? 0);
    const patch: Record<string, unknown> = { score: best };
    if (row.status !== 'Completed') Object.assign(patch, { status: 'Completed', completedAt: now });
    await zite.lessonProgress.update({ id: String(row.id), record: patch as never });
    if (row.status !== 'Completed') await logActivity({ type: 'lesson_completed', personId: e.personId, actorId: input.actorId ?? e.personId, courseId: e.courseId, lessonId, enrollmentId: e.id, occurredAt: now });
  }
  const fresh = (await loadEnrollment(e.id)) ?? e;
  return recomputeEnrollment(fresh.id, { actorId: input.actorId ?? e.personId, settings: input.settings, occurredAt: now });
}

/** Staff override: count an enrollment as complete without lesson rows (e.g. training done offline). */
export async function markEnrollmentComplete(enrollmentId: string, opts: { actorId: string; settings?: OrgSettings; note?: string }) {
  const e = await loadEnrollment(enrollmentId);
  if (!e) throw new ZiteError('Enrollment not found', 'NOT_FOUND');
  if (e.status === 'Completed') return { status: e.status, progress: 100, completedNow: false, certificateId: e.certificateId };
  const { lessons } = await loadOutline(e.courseId);
  const now = new Date().toISOString();
  const { rows } = await zite.sql({ query: `SELECT "lessonId" FROM "LessonProgress" WHERE "enrollmentId" = $1`, params: [e.id] });
  const have = new Set(rows.map(r => String(r.lessonId)));
  const missing = lessons.filter(l => !have.has(l.id));
  await chunked(missing, async batch => {
    await zite.lessonProgress.bulkCreate({ records: batch.map(l => ({ enrollmentId: e.id, personId: e.personId, courseId: e.courseId, lessonId: l.id, status: 'Completed', startedAt: now, completedAt: now, timeSpentSeconds: 0, attempts: 0, state: JSON.stringify({ markedBy: opts.actorId }) })) as never });
  });
  const { rows: open } = await zite.sql({ query: `SELECT id FROM "LessonProgress" WHERE "enrollmentId" = $1 AND COALESCE("status", '') <> 'Completed'`, params: [e.id] });
  for (const r of open) await zite.lessonProgress.update({ id: String(r.id), record: { status: 'Completed', completedAt: now } });
  await logActivity({ type: 'marked_complete', personId: e.personId, actorId: opts.actorId, courseId: e.courseId, enrollmentId: e.id, data: opts.note ? { note: opts.note } : undefined });
  return recomputeEnrollment(e.id, { actorId: opts.actorId, settings: opts.settings, occurredAt: now });
}

/** Clear lesson progress so the learner starts over. Quiz attempts and submissions stay, for the record. */
export async function resetEnrollment(enrollmentId: string, actorId: string) {
  const e = await loadEnrollment(enrollmentId);
  if (!e) throw new ZiteError('Enrollment not found', 'NOT_FOUND');
  const { rows } = await zite.sql({ query: `SELECT id FROM "LessonProgress" WHERE "enrollmentId" = $1`, params: [e.id] });
  for (const r of rows) await zite.lessonProgress.delete({ id: String(r.id) });
  await zite.enrollments.update({ id: e.id, record: { status: e.status === 'Withdrawn' ? 'Withdrawn' : 'Not started', progress: 0, completedAt: null, startedAt: null, currentLessonId: null, score: null, timeSpentSeconds: 0, certificateId: null } });
  await logActivity({ type: 'progress_reset', personId: e.personId, actorId, courseId: e.courseId, enrollmentId: e.id, data: { previousStatus: e.status, previousProgress: e.progress } });
}

/** In a sequential path, whether this enrollment's course is still locked behind an earlier one. Returns the blocking course title. */
export async function pathLockFor(e: EnrollmentRow): Promise<string | null> {
  if (!e.pathEnrollmentId) return null;
  const { rows } = await zite.sql({ query: `SELECT "pathId", "cycle", "status" FROM "PathEnrollments" WHERE id::text = $1`, params: [e.pathEnrollmentId] });
  const pe = rows[0];
  if (!pe || pe.status === 'Withdrawn') return null;
  const path = await loadPath(String(pe.pathId));
  if (!path?.sequential) return null;
  const courses = await loadPathCourses(path.id);
  const { rows: done } = await zite.sql({ query: `SELECT DISTINCT "courseId" FROM "Enrollments" WHERE "personId" = $1 AND "status" = 'Completed' AND "courseId" = ANY($2::text[])`, params: [e.personId, courses.map(c => c.courseId)] });
  const locked = lockedPathCourseIds(courses, new Set(done.map(d => String(d.courseId))), true);
  if (!locked.has(e.courseId)) return null;
  const blocker = [...courses].sort((a, b) => a.position - b.position).find(c => !c.optional && !done.some(d => String(d.courseId) === c.courseId));
  if (!blocker) return null;
  return (await loadCourse(blocker.courseId))?.title ?? 'the previous course';
}

/** "3 days", "1 day", "today" — for reminder emails. */
export function daysLeftLabel(dueDate: string, today = dayOf(new Date())) {
  const d = daysBetween(today, dueDate);
  if (d <= 0) return 'today';
  return d === 1 ? '1 day' : `${d} days`;
}
