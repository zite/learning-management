import { zite } from 'zitejs/db';
import { asLessonType, type LessonType } from '@project/shared/lessons';
import { firstName } from '@project/shared/merge';
import { asEnrollmentStatus, certificateState, courseProgress, dueState, lockedPathCourseIds, pathProgress, POINTS, resumeLessonId, type CertificateState, type DueState, type EnrollmentStatus } from '@project/shared/progress';
import type { OrgSettings } from '@project/shared/server/settings';
import { bool, day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';

/**
 * Reads shared by the learner app's pages: course and path cards, "my"
 * enrollments with everything a row needs (resume lesson, source, locks), and
 * outlines loaded in bulk. Every function takes the actor's id from the caller,
 * which got it from the session — never from request input.
 *
 * Live Zite rate-limits bursts of database requests, so these run their
 * statements one after another and fold related reads into a single query.
 */

// ── Small parsers ─────────────────────────────────────────────────────────

export const validColor = (v: unknown, fallback = '#2f6b55') => (/^#[0-9a-f]{6}$/i.test(String(v ?? '')) ? String(v) : fallback);
export const httpsOrNull = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);

/** A `json_agg(...)::text` column as rows. */
export function jsonRows(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (typeof v !== 'string' || !v.trim()) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const idList = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// ── Course cards ──────────────────────────────────────────────────────────

export type CategoryRef = { id: string; name: string; color: string; icon: string };

export type CourseCard = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  coverImageUrl: string | null;
  icon: string;
  color: string;
  level: string;
  estimatedMinutes: number;
  lessonCount: number;
  visibility: 'Catalog' | 'Private';
  status: string;
  sequential: boolean;
  certificateEnabled: boolean;
  certificateValidityMonths: number | null;
  category: CategoryRef | null;
  rating: { average: number | null; count: number };
  enrolledCount: number;
};

/** Columns for `toCourseCard`; the course is `c`, joined to its category `cat` with `COURSE_CARD_JOIN`. */
export const COURSE_CARD_COLUMNS = `
  c.id::text AS "id", c."slug", c."title", c."summary", c."coverImageUrl", c."icon", c."color", c."level", c."estimatedMinutes", c."visibility",
  c."status", c."certificateEnabled", c."certificateValidityMonths", c."categoryId", c."position", c."sequential",
  cat."name" AS "categoryName", cat."color" AS "categoryColor", cat."icon" AS "categoryIcon",
  (SELECT COUNT(*) FROM "Lessons" l WHERE l."courseId" = c.id::text) AS "lessonTotal",
  (SELECT AVG(r."rating") FROM "Enrollments" r WHERE r."courseId" = c.id::text AND r."rating" > 0) AS "ratingAverage",
  (SELECT COUNT(*) FROM "Enrollments" r WHERE r."courseId" = c.id::text AND r."rating" > 0) AS "ratingTotal",
  (SELECT COUNT(DISTINCT r."personId") FROM "Enrollments" r WHERE r."courseId" = c.id::text AND COALESCE(r."status", '') <> 'Withdrawn') AS "enrolledTotal"`;

export const COURSE_CARD_JOIN = `LEFT JOIN "Categories" cat ON cat.id::text = c."categoryId"`;

function categoryOf(r: Record<string, unknown>): CategoryRef | null {
  return ref(r.categoryId) && r.categoryName ? { id: String(r.categoryId), name: String(r.categoryName), color: validColor(r.categoryColor), icon: str(r.categoryIcon) ?? '' } : null;
}

export function toCourseCard(r: Record<string, unknown>): CourseCard {
  const avg = numOrNull(r.ratingAverage);
  return {
    id: String(r.id),
    slug: str(r.slug) || String(r.id),
    title: str(r.title) ?? '',
    summary: str(r.summary) ?? '',
    coverImageUrl: httpsOrNull(r.coverImageUrl),
    icon: str(r.icon) ?? '',
    color: validColor(r.color),
    level: str(r.level) || 'Beginner',
    estimatedMinutes: num(r.estimatedMinutes),
    lessonCount: num(r.lessonTotal),
    visibility: r.visibility === 'Private' ? 'Private' : 'Catalog',
    status: str(r.status) || 'Draft',
    sequential: bool(r.sequential),
    certificateEnabled: bool(r.certificateEnabled),
    certificateValidityMonths: numOrNull(r.certificateValidityMonths) || null,
    category: categoryOf(r),
    rating: { average: avg == null ? null : Math.round(avg * 10) / 10, count: num(r.ratingTotal) },
    enrolledCount: num(r.enrolledTotal),
  };
}

// ── Path cards ────────────────────────────────────────────────────────────

export type PathCard = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  coverImageUrl: string | null;
  icon: string;
  color: string;
  visibility: 'Catalog' | 'Private';
  status: string;
  sequential: boolean;
  certificateEnabled: boolean;
  certificateValidityMonths: number | null;
  category: CategoryRef | null;
  courseCount: number;
  totalMinutes: number;
};

/** Columns for `toPathCard`; the path is `p`, joined to its category `cat` with `PATH_CARD_JOIN`. */
export const PATH_CARD_COLUMNS = `
  p.id::text AS "id", p."slug", p."title", p."summary", p."coverImageUrl", p."icon", p."color", p."visibility", p."status", p."sequential",
  p."certificateEnabled", p."certificateValidityMonths", p."categoryId", p."position",
  cat."name" AS "categoryName", cat."color" AS "categoryColor", cat."icon" AS "categoryIcon",
  (SELECT COUNT(*) FROM "PathCourses" pc JOIN "Courses" pcc ON pcc.id::text = pc."courseId" WHERE pc."pathId" = p.id::text) AS "courseTotal",
  (SELECT COALESCE(SUM(pcc."estimatedMinutes"), 0) FROM "PathCourses" pc JOIN "Courses" pcc ON pcc.id::text = pc."courseId" WHERE pc."pathId" = p.id::text) AS "minutesTotal"`;

export const PATH_CARD_JOIN = `LEFT JOIN "Categories" cat ON cat.id::text = p."categoryId"`;

export function toPathCard(r: Record<string, unknown>): PathCard {
  return {
    id: String(r.id),
    slug: str(r.slug) || String(r.id),
    title: str(r.title) ?? '',
    summary: str(r.summary) ?? '',
    coverImageUrl: httpsOrNull(r.coverImageUrl),
    icon: str(r.icon) ?? '',
    color: validColor(r.color),
    visibility: r.visibility === 'Private' ? 'Private' : 'Catalog',
    status: str(r.status) || 'Draft',
    sequential: bool(r.sequential),
    certificateEnabled: bool(r.certificateEnabled),
    certificateValidityMonths: numOrNull(r.certificateValidityMonths) || null,
    category: categoryOf(r),
    courseCount: num(r.courseTotal),
    totalMinutes: num(r.minutesTotal),
  };
}

// ── Outlines in bulk ──────────────────────────────────────────────────────

export type LiteLesson = { id: string; courseId: string; title: string; type: LessonType; optional: boolean; sectionId: string | null; position: number; durationMinutes: number };
export type LiteSection = { id: string; title: string; description: string };
export type LiteOutline = { sections: LiteSection[]; lessons: LiteLesson[] };

/**
 * Lessons for many courses in one query, in the same order as `loadOutline`:
 * lessons outside any section first, then sections by position, lessons by
 * position within them. Sections with no lessons are left out.
 */
export async function loadOutlines(courseIds: string[]): Promise<Map<string, LiteOutline>> {
  const out = new Map<string, LiteOutline>();
  const ids = [...new Set(courseIds.filter(Boolean))];
  if (!ids.length) return out;
  const { rows } = await zite.sql({
    query: `SELECT l.id::text AS id, l."courseId", l."title", l."type", l."optional", l."position", l."durationMinutes",
              s.id::text AS "sectionKey", s."title" AS "sectionTitle", s."description" AS "sectionDescription"
            FROM "Lessons" l
            LEFT JOIN "Sections" s ON s.id::text = l."sectionId" AND s."courseId" = l."courseId"
            WHERE l."courseId" = ANY($1::text[])
            ORDER BY l."courseId", CASE WHEN s.id IS NULL THEN 0 ELSE 1 END, COALESCE(s."position", 0) ASC, s.created_at ASC, COALESCE(l."position", 0) ASC, l.created_at ASC`,
    params: [ids],
  });
  for (const id of ids) out.set(id, { sections: [], lessons: [] });
  for (const r of rows) {
    const o = out.get(String(r.courseId));
    if (!o) continue;
    const sectionId = ref(r.sectionKey);
    if (sectionId && !o.sections.some(s => s.id === sectionId)) o.sections.push({ id: sectionId, title: str(r.sectionTitle) ?? '', description: str(r.sectionDescription) ?? '' });
    o.lessons.push({ id: String(r.id), courseId: String(r.courseId), title: str(r.title) ?? '', type: asLessonType(r.type), optional: bool(r.optional), sectionId, position: num(r.position), durationMinutes: num(r.durationMinutes) });
  }
  return out;
}

// ── Path courses with the actor's state ───────────────────────────────────

export type PathCourseRow = { pathId: string; courseId: string; position: number; optional: boolean; title: string; slug: string; visibility: string; estimatedMinutes: number; myStatus: EnrollmentStatus | null; myProgress: number; everCompleted: boolean };

/** Each path's courses in order, with the actor's latest status in each and whether they ever completed it. */
export async function loadPathCourseStates(pathIds: string[], personId: string): Promise<Map<string, PathCourseRow[]>> {
  const out = new Map<string, PathCourseRow[]>();
  const ids = [...new Set(pathIds.filter(Boolean))];
  if (!ids.length) return out;
  const { rows } = await zite.sql({
    query: `SELECT pc."pathId", pc."courseId", pc."position", pc."optional", c."title", c."slug", c."visibility", c."estimatedMinutes",
              mine."status" AS "myStatus", mine."progress" AS "myProgress",
              EXISTS (SELECT 1 FROM "Enrollments" x WHERE x."personId" = $2 AND x."courseId" = pc."courseId" AND x."status" = 'Completed') AS "everDone"
            FROM "PathCourses" pc
            JOIN "Courses" c ON c.id::text = pc."courseId"
            LEFT JOIN LATERAL (
              SELECT e."status", e."progress" FROM "Enrollments" e
              WHERE e."personId" = $2 AND e."courseId" = pc."courseId" AND COALESCE(e."status", '') <> 'Withdrawn'
              ORDER BY COALESCE(e."cycle", 1) DESC, e.created_at DESC LIMIT 1
            ) mine ON true
            WHERE pc."pathId" = ANY($1::text[])
            ORDER BY pc."pathId", COALESCE(pc."position", 0) ASC, pc.created_at ASC`,
    params: [ids, personId],
  });
  for (const r of rows) {
    const key = String(r.pathId);
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({
      pathId: key,
      courseId: String(r.courseId),
      position: num(r.position),
      optional: bool(r.optional),
      title: str(r.title) ?? '',
      slug: str(r.slug) || String(r.courseId),
      visibility: str(r.visibility) || 'Private',
      estimatedMinutes: num(r.estimatedMinutes),
      myStatus: r.myStatus ? asEnrollmentStatus(r.myStatus) : null,
      myProgress: r.myStatus === 'Completed' ? 100 : num(r.myProgress),
      everCompleted: bool(r.everDone),
    });
  }
  return out;
}

/** The first required, unfinished course that a locked course waits on (sequential paths only). */
export function blockingCourse(courses: PathCourseRow[], courseId: string, sequential: boolean) {
  const done = new Set(courses.filter(c => c.everCompleted).map(c => c.courseId));
  if (done.has(courseId)) return null;
  const locked = lockedPathCourseIds(courses, done, sequential);
  if (!locked.has(courseId)) return null;
  return courses.find(c => !c.optional && !done.has(c.courseId))?.title ?? 'the previous course';
}

// ── My enrollments ────────────────────────────────────────────────────────

export type MyEnrollment = {
  id: string;
  course: CourseCard;
  status: EnrollmentStatus;
  progress: number;
  dueDate: string | null;
  dueState: DueState;
  source: string;
  assignedByName: string | null;
  ruleName: string | null;
  path: { id: string; title: string; slug: string } | null;
  enrolledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
  certificateId: string | null;
  rating: number | null;
  review: string;
  cycle: number;
  score: number | null;
  timeSpentSeconds: number;
  lessonsDone: number;
  lessonsTotal: number;
  resumeLessonId: string | null;
  nextLesson: { id: string; title: string; type: LessonType } | null;
  completedLessonIds: string[];
  /** In a sequential path, the course that must be finished first. */
  lockedBy: string | null;
};

/**
 * The actor's enrollments — the latest non-withdrawn cycle per course, in
 * courses that aren't drafts — with display data, source, resume lesson and
 * path lock. Pass `outlines` when the caller already loaded them.
 */
export async function loadMyEnrollments(personId: string, opts: { courseId?: string; outlines?: Map<string, LiteOutline> } = {}): Promise<MyEnrollment[]> {
  const params: unknown[] = [personId];
  if (opts.courseId) params.push(opts.courseId);
  const { rows } = await zite.sql({
    query: `
      WITH latest_enrollments AS (
        SELECT DISTINCT ON (e."courseId") e.id FROM "Enrollments" e
        WHERE e."personId" = $1 AND COALESCE(e."status", '') <> 'Withdrawn' ${opts.courseId ? 'AND e."courseId" = $2' : ''}
        ORDER BY e."courseId", COALESCE(e."cycle", 1) DESC, e.created_at DESC
      )
      SELECT e.id::text AS "enrollmentId", e."status" AS "enrollmentStatus", e."progress", e."dueDate", e."source", e."enrolledAt", e."startedAt",
        e."completedAt", e."lastActivityAt", e."currentLessonId", e."certificateId", e."rating", e."review", e."cycle", e."score", e."timeSpentSeconds",
        ${COURSE_CARD_COLUMNS},
        ab."name" AS "assignedByName", ru."name" AS "ruleName",
        pa.id::text AS "pathKey", pa."title" AS "pathTitle", pa."slug" AS "pathSlug", pa."sequential" AS "pathSequential", pe."status" AS "pathStatus",
        (SELECT string_agg(lp."lessonId", ',') FROM "LessonProgress" lp WHERE lp."enrollmentId" = e.id::text AND lp."status" = 'Completed') AS "doneLessonIds"
      FROM latest_enrollments le
      JOIN "Enrollments" e ON e.id = le.id
      JOIN "Courses" c ON c.id::text = e."courseId"
      ${COURSE_CARD_JOIN}
      LEFT JOIN "People" ab ON ab.id::text = e."assignedById"
      LEFT JOIN "AssignmentRules" ru ON ru.id::text = e."ruleId"
      LEFT JOIN "PathEnrollments" pe ON pe.id::text = e."pathEnrollmentId"
      LEFT JOIN "Paths" pa ON pa.id::text = pe."pathId"
      WHERE c."status" <> 'Draft'`,
    params,
  });
  if (!rows.length) return [];

  const outlines = opts.outlines ?? (await loadOutlines(rows.map(r => String(r.id))));
  const sequentialPathIds = [...new Set(rows.filter(r => bool(r.pathSequential) && ref(r.pathKey) && r.pathStatus !== 'Withdrawn' && r.enrollmentStatus !== 'Completed').map(r => String(r.pathKey)))];
  const pathCourses = sequentialPathIds.length ? await loadPathCourseStates(sequentialPathIds, personId) : new Map<string, PathCourseRow[]>();

  return rows.map(r => {
    const course = toCourseCard(r);
    const status = asEnrollmentStatus(r.enrollmentStatus);
    const outline = outlines.get(course.id) ?? { sections: [], lessons: [] };
    const done = new Set(idList(r.doneLessonIds));
    const counts = courseProgress(outline.lessons, done);
    const resume = resumeLessonId(outline.lessons, done, ref(r.currentLessonId), course.sequential);
    const next = status === 'Completed' ? null : (outline.lessons.find(l => l.id === resume) ?? null);
    const pathId = ref(r.pathKey);
    const lockedBy = pathId && sequentialPathIds.includes(pathId) && status !== 'Completed' ? blockingCourse(pathCourses.get(pathId) ?? [], course.id, true) : null;
    const dueDate = day(r.dueDate);
    return {
      id: String(r.enrollmentId),
      course,
      status,
      progress: status === 'Completed' ? 100 : num(r.progress),
      dueDate,
      dueState: dueState({ status, dueDate }),
      source: str(r.source) || 'Assigned',
      assignedByName: ref(r.assignedByName),
      ruleName: ref(r.ruleName),
      path: pathId ? { id: pathId, title: str(r.pathTitle) ?? '', slug: str(r.pathSlug) || pathId } : null,
      enrolledAt: iso(r.enrolledAt),
      startedAt: iso(r.startedAt),
      completedAt: iso(r.completedAt),
      lastActivityAt: iso(r.lastActivityAt),
      certificateId: ref(r.certificateId),
      rating: numOrNull(r.rating) || null,
      review: str(r.review) ?? '',
      cycle: num(r.cycle, 1) || 1,
      score: numOrNull(r.score),
      timeSpentSeconds: num(r.timeSpentSeconds),
      lessonsDone: status === 'Completed' ? counts.total : counts.done,
      lessonsTotal: counts.total,
      resumeLessonId: resume,
      nextLesson: next ? { id: next.id, title: next.title, type: next.type } : null,
      completedLessonIds: [...done],
      lockedBy,
    };
  });
}

/** Open work first: overdue, due soon, due later, then no date; ties by due date, then most recent activity. */
export const DUE_ORDER: Record<DueState, number> = { overdue: 0, due_soon: 1, on_track: 2, no_due: 3, done: 4, withdrawn: 5 };

type Sortable = { dueState: DueState; dueDate: string | null; lastActivityAt?: string | null; enrolledAt: string | null };

export function byUrgency(a: Sortable, b: Sortable) {
  const d = DUE_ORDER[a.dueState] - DUE_ORDER[b.dueState];
  if (d) return d;
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return (Date.parse(b.lastActivityAt ?? b.enrolledAt ?? '') || 0) - (Date.parse(a.lastActivityAt ?? a.enrolledAt ?? '') || 0);
}

// ── My path enrollments ───────────────────────────────────────────────────

export type PathCourseState = { courseId: string; title: string; slug: string; optional: boolean; status: EnrollmentStatus | null; progress: number; locked: boolean; lockedBy: string | null };

export type MyPathEnrollment = {
  id: string;
  path: PathCard;
  status: EnrollmentStatus;
  progress: number;
  dueDate: string | null;
  dueState: DueState;
  source: string;
  assignedByName: string | null;
  enrolledAt: string | null;
  completedAt: string | null;
  certificateId: string | null;
  cycle: number;
  done: number;
  total: number;
  courses: PathCourseState[];
  nextCourse: { id: string; title: string; slug: string } | null;
};

export function pathCourseStates(list: PathCourseRow[], sequential: boolean): PathCourseState[] {
  const done = new Set(list.filter(c => c.everCompleted).map(c => c.courseId));
  const locked = lockedPathCourseIds(list, done, sequential);
  const blocker = list.find(c => !c.optional && !done.has(c.courseId))?.title ?? null;
  return list.map(c => {
    const isLocked = locked.has(c.courseId) && !done.has(c.courseId);
    return { courseId: c.courseId, title: c.title, slug: c.slug, optional: c.optional, status: c.everCompleted ? 'Completed' : c.myStatus, progress: c.everCompleted ? 100 : c.myProgress, locked: isLocked, lockedBy: isLocked ? blocker : null };
  });
}

export async function loadMyPathEnrollments(personId: string, opts: { pathId?: string } = {}): Promise<MyPathEnrollment[]> {
  const params: unknown[] = [personId];
  if (opts.pathId) params.push(opts.pathId);
  const { rows } = await zite.sql({
    query: `
      WITH latest_paths AS (
        SELECT DISTINCT ON (pe."pathId") pe.id FROM "PathEnrollments" pe
        WHERE pe."personId" = $1 AND COALESCE(pe."status", '') <> 'Withdrawn' ${opts.pathId ? 'AND pe."pathId" = $2' : ''}
        ORDER BY pe."pathId", COALESCE(pe."cycle", 1) DESC, pe.created_at DESC
      )
      SELECT pe.id::text AS "pathEnrollmentId", pe."status" AS "enrollmentStatus", pe."progress", pe."dueDate", pe."source", pe."enrolledAt", pe."completedAt",
        pe."certificateId", pe."cycle", ab."name" AS "assignedByName", ${PATH_CARD_COLUMNS}
      FROM latest_paths lp
      JOIN "PathEnrollments" pe ON pe.id = lp.id
      JOIN "Paths" p ON p.id::text = pe."pathId"
      ${PATH_CARD_JOIN}
      LEFT JOIN "People" ab ON ab.id::text = pe."assignedById"
      WHERE p."status" <> 'Draft'`,
    params,
  });
  if (!rows.length) return [];
  const pathCourses = await loadPathCourseStates(rows.map(r => String(r.id)), personId);

  return rows.map(r => {
    const path = toPathCard(r);
    const status = asEnrollmentStatus(r.enrollmentStatus);
    const list = pathCourses.get(path.id) ?? [];
    const courses = pathCourseStates(list, path.sequential);
    const p = pathProgress(list, new Set(list.filter(c => c.everCompleted).map(c => c.courseId)));
    const next = status === 'Completed' ? null : (courses.find(c => c.status !== 'Completed' && !c.locked && !c.optional) ?? courses.find(c => c.status !== 'Completed' && !c.locked) ?? null);
    const dueDate = day(r.dueDate);
    return {
      id: String(r.pathEnrollmentId),
      path,
      status,
      progress: status === 'Completed' ? 100 : num(r.progress),
      dueDate,
      dueState: dueState({ status, dueDate }),
      source: str(r.source) || 'Assigned',
      assignedByName: ref(r.assignedByName),
      enrolledAt: iso(r.enrolledAt),
      completedAt: iso(r.completedAt),
      certificateId: ref(r.certificateId),
      cycle: num(r.cycle, 1) || 1,
      done: p.done,
      total: p.total,
      courses,
      nextCourse: next ? { id: next.courseId, title: next.title, slug: next.slug } : null,
    };
  });
}

// ── Certificates ──────────────────────────────────────────────────────────

/** What `CertificateArt` needs from the organization. */
export type CertificateOrg = { organizationName: string; academyName: string; logoUrl: string | null; brandColor: string; certificateTitle: string; signatory: string; signatoryTitle: string };

export function certificateOrg(s: OrgSettings): CertificateOrg {
  return {
    organizationName: s.organizationName,
    academyName: s.academyName,
    logoUrl: s.logoUrl && /^https:\/\//i.test(s.logoUrl) ? s.logoUrl : null,
    brandColor: s.brandColor,
    certificateTitle: s.certificateTitle,
    signatory: s.certificateSignatory,
    signatoryTitle: s.certificateSignatoryTitle,
  };
}

export type CertificateSummary = {
  id: string;
  credentialId: string;
  title: string;
  kind: 'course' | 'path';
  recipientName: string;
  issuedAt: string | null;
  expiresAt: string | null;
  status: 'Active' | 'Revoked';
  state: CertificateState;
  score: number | null;
  slug: string | null;
};

/** Columns for `toCertificateSummary`; the certificate is `ce`. */
export const CERTIFICATE_COLUMNS = `ce.id::text AS id, ce."credentialId", ce."title", ce."recipientName", ce."issuedAt", ce."expiresAt", ce."status", ce."score", ce."courseId", ce."pathId",
  (SELECT COALESCE(NULLIF(cc."slug", ''), cc.id::text) FROM "Courses" cc WHERE cc.id::text = ce."courseId") AS "courseSlug",
  (SELECT COALESCE(NULLIF(pp."slug", ''), pp.id::text) FROM "Paths" pp WHERE pp.id::text = ce."pathId") AS "pathSlug"`;

export function toCertificateSummary(r: Record<string, unknown>): CertificateSummary {
  const status = r.status === 'Revoked' ? 'Revoked' : 'Active';
  const expiresAt = iso(r.expiresAt);
  const kind = ref(r.pathId) && !ref(r.courseId) ? 'path' : 'course';
  return {
    id: String(r.id),
    credentialId: str(r.credentialId) ?? '',
    title: str(r.title) ?? '',
    kind,
    recipientName: str(r.recipientName) ?? '',
    issuedAt: iso(r.issuedAt),
    expiresAt,
    status,
    state: certificateState({ status, expiresAt }),
    score: numOrNull(r.score),
    slug: kind === 'path' ? ref(r.pathSlug) : ref(r.courseSlug),
  };
}

/**
 * A certificate the actor may see: their own, or a direct report's. Anything
 * else reads as not found, so ids can't be probed.
 */
export async function loadVisibleCertificate(actorId: string, id: string) {
  const { rows } = await zite.sql({
    query: `SELECT ${CERTIFICATE_COLUMNS}, ce."personId", ce."revokedAt", ce."revokedReason", p."managerId" AS "ownerManagerId"
            FROM "Certificates" ce LEFT JOIN "People" p ON p.id::text = ce."personId"
            WHERE ce.id::text = $1 OR ce."credentialId" = $1 LIMIT 1`,
    params: [id],
  });
  const r = rows[0];
  if (!r) return null;
  const personId = String(r.personId ?? '');
  const mine = personId === actorId;
  if (!mine && ref(r.ownerManagerId) !== actorId) return null;
  return { ...toCertificateSummary(r), isMine: mine, revokedAt: iso(r.revokedAt), revokedReason: mine ? (str(r.revokedReason) ?? '') : '' };
}

// ── People ────────────────────────────────────────────────────────────────

/** "Maya O." — how learners appear to other learners. */
export function publicName(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Someone';
  if (parts.length === 1) return parts[0];
  return `${firstName(name)} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// ── Points ────────────────────────────────────────────────────────────────

export type PointsRow = { id: string; name: string; title: string | null; color: string; avatarUrl: string | null; lessons: number; courses: number; paths: number; quizPasses: number; perfectQuizzes: number };

/**
 * Points per active person since `since` (ISO), from the same events the
 * leaderboard explains: lessons, courses and paths completed, and quizzes
 * passed or aced — each quiz counts once, however often it's retaken.
 */
export async function pointsSince(since: string | null, personId?: string): Promise<PointsRow[]> {
  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const sinceRef = since ? bind(since) : null;
  const personRef = personId ? bind(personId) : null;
  const after = (col: string) => (sinceRef ? `AND ${col} >= ${sinceRef}::timestamptz` : '');
  const only = personRef ? `AND x."personId" = ${personRef}` : '';
  const { rows } = await zite.sql({
    query: `
      WITH lesson_points AS (
        SELECT x."personId" AS pid, COUNT(*) AS "lessonTotal" FROM "LessonProgress" x
        WHERE x."status" = 'Completed' ${after('x."completedAt"')} ${only} GROUP BY x."personId"
      ), course_points AS (
        SELECT x."personId" AS pid, COUNT(*) AS "courseTotal" FROM "Enrollments" x
        WHERE x."status" = 'Completed' ${after('x."completedAt"')} ${only} GROUP BY x."personId"
      ), path_points AS (
        SELECT x."personId" AS pid, COUNT(*) AS "pathTotal" FROM "PathEnrollments" x
        WHERE x."status" = 'Completed' ${after('x."completedAt"')} ${only} GROUP BY x."personId"
      ), quiz_firsts AS (
        SELECT x."personId" AS pid, x."enrollmentId", x."lessonId",
          MIN(x."submittedAt") FILTER (WHERE COALESCE(x."passed", false) = true) AS "firstPass",
          MIN(x."submittedAt") FILTER (WHERE x."score" >= 100) AS "firstPerfect"
        FROM "QuizAttempts" x WHERE x."submittedAt" IS NOT NULL ${only} GROUP BY x."personId", x."enrollmentId", x."lessonId"
      ), quiz_points AS (
        SELECT pid, COUNT("firstPass") FILTER (WHERE TRUE ${after('"firstPass"')}) AS "passTotal", COUNT("firstPerfect") FILTER (WHERE TRUE ${after('"firstPerfect"')}) AS "perfectTotal"
        FROM quiz_firsts GROUP BY pid
      )
      SELECT p.id::text AS id, p."name", p."title", p."color", p."avatarUrl",
        COALESCE(lp."lessonTotal", 0) AS "lessonTotal", COALESCE(cp."courseTotal", 0) AS "courseTotal", COALESCE(pp."pathTotal", 0) AS "pathTotal",
        COALESCE(qp."passTotal", 0) AS "passTotal", COALESCE(qp."perfectTotal", 0) AS "perfectTotal"
      FROM "People" p
      LEFT JOIN lesson_points lp ON lp.pid = p.id::text
      LEFT JOIN course_points cp ON cp.pid = p.id::text
      LEFT JOIN path_points pp ON pp.pid = p.id::text
      LEFT JOIN quiz_points qp ON qp.pid = p.id::text
      WHERE COALESCE(p."status", '') <> 'Deactivated' ${personRef ? `AND p.id::text = ${personRef}` : ''}`,
    params,
  });
  return rows.map(r => ({
    id: String(r.id),
    name: str(r.name) ?? '',
    title: ref(r.title),
    color: validColor(r.color),
    avatarUrl: httpsOrNull(r.avatarUrl),
    lessons: num(r.lessonTotal),
    courses: num(r.courseTotal),
    paths: num(r.pathTotal),
    quizPasses: num(r.passTotal),
    perfectQuizzes: num(r.perfectTotal),
  }));
}

export const totalPoints = (p: Pick<PointsRow, 'lessons' | 'courses' | 'paths' | 'quizPasses' | 'perfectQuizzes'>) =>
  p.lessons * POINTS.lesson + p.courses * POINTS.course + p.paths * POINTS.path + p.quizPasses * POINTS.quizPass + p.perfectQuizzes * POINTS.perfectQuiz;

// ── Dates ─────────────────────────────────────────────────────────────────

/** Today's calendar day in a time zone, `YYYY-MM-DD`. */
export function todayIn(timeZone: string, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Consecutive days with learning, ending today or yesterday. `days` holds `YYYY-MM-DD` strings. */
export function streakFrom(days: Set<string>, today: string) {
  const step = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  let cursor = days.has(today) ? today : step(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = step(cursor, -1);
  }
  return streak;
}

/** Keep a timezone name safe to bind (the settings value is admin-entered). */
export function safeTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}
