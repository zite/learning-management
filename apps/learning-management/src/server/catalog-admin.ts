import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { asLessonType, lessonIssues, parseSettings } from '@project/shared/lessons';
import { loadCourse, loadPath, type CourseRecord, type PathRecord } from '@project/shared/server/courses';
import { recomputePathEnrollment } from '@project/shared/server/enroll';
import { assertStaff, type Actor } from '@project/shared/server/people';
import { eachWrite, num, ref, str } from '@project/shared/server/sql';

/**
 * Server helpers for the admin catalog: courses and learning paths — their
 * lifecycle rules (what publishing needs, what deleting is allowed to remove),
 * slugs, and the permission check for paths.
 */

/** Lowercase words joined by single hyphens: `security-basics-2027`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function requireCourse(id: string): Promise<CourseRecord> {
  const course = await loadCourse(id);
  if (!course) throw new ZiteError('That course no longer exists', 'NOT_FOUND');
  return course;
}

export async function requirePath(id: string): Promise<PathRecord> {
  const path = await loadPath(id);
  if (!path) throw new ZiteError('That learning path no longer exists', 'NOT_FOUND');
  return path;
}

/** Admins edit every path; instructors edit the paths they own (or nobody owns). */
export function canEditPath(actor: Pick<Actor, 'id' | 'role'>, path: { ownerId?: string | null }) {
  if (actor.role === 'Admin') return true;
  if (actor.role !== 'Instructor') return false;
  return !path.ownerId || path.ownerId === actor.id;
}

export function assertCanEditPath(actor: Actor, path: { ownerId?: string | null; title?: string }) {
  assertStaff(actor);
  if (!canEditPath(actor, path)) throw new ZiteError(`Only the path owner or an admin can change ${path.title ? `“${path.title}”` : 'this learning path'}`, 'FORBIDDEN');
}

/** Throws a readable error unless `slug` is well formed and unused by another row of the table. */
export async function assertSlugAvailable(table: 'Courses' | 'Paths', slug: string, excludeId?: string) {
  if (!slug) throw new ZiteError('The web address can’t be empty', 'BAD_REQUEST');
  if (slug.length > 80) throw new ZiteError('Keep the web address under 80 characters', 'BAD_REQUEST');
  if (!SLUG_PATTERN.test(slug)) throw new ZiteError('Use lowercase letters, numbers and single hyphens in the web address, like “security-basics”', 'BAD_REQUEST');
  const { rows } = await zite.sql({ query: `SELECT id, "title" FROM "${table}" WHERE "slug" = $1 AND ($2::text = '' OR id::text <> $2::text) LIMIT 1`, params: [slug, excludeId ?? ''] });
  if (rows[0]) throw new ZiteError(`“${str(rows[0].title) || 'Another item'}” already uses that web address`, 'CONFLICT');
}

export async function nextPosition(table: 'Courses' | 'Paths') {
  const { rows } = await zite.sql({ query: `SELECT COALESCE(MAX("position"), 0) AS "top" FROM "${table}"`, params: [] });
  return num(rows[0]?.top) + 1;
}

export type LessonProblem = { lessonId: string; title: string; issues: string[] };

/** Everything that would stop a learner finishing the course, lesson by lesson, in outline order. */
export async function publishProblems(courseId: string): Promise<{ lessonCount: number; problems: LessonProblem[] }> {
  const [lessonsRes, sectionsRes] = await Promise.all([
    zite.sql({ query: `SELECT id, "title", "type", "body", "mediaUrl", "settings", "sectionId", "position" FROM "Lessons" WHERE "courseId" = $1 ORDER BY COALESCE("position", 0) ASC, created_at ASC`, params: [courseId] }),
    zite.sql({ query: `SELECT id FROM "Sections" WHERE "courseId" = $1 ORDER BY COALESCE("position", 0) ASC, created_at ASC`, params: [courseId] }),
  ]);
  const sectionIndex = new Map(sectionsRes.rows.map((s, i) => [String(s.id), i]));
  const ordered = [...lessonsRes.rows].sort((a, b) => (sectionIndex.get(String(a.sectionId)) ?? -1) - (sectionIndex.get(String(b.sectionId)) ?? -1));
  const problems: LessonProblem[] = [];
  for (const l of ordered) {
    const type = asLessonType(l.type);
    const title = str(l.title) ?? '';
    const issues = lessonIssues({ type, title, body: str(l.body) ?? '', mediaUrl: ref(l.mediaUrl), settings: parseSettings(type, l.settings) });
    if (issues.length) problems.push({ lessonId: String(l.id), title: title.trim() || 'Untitled lesson', issues });
  }
  return { lessonCount: lessonsRes.rows.length, problems };
}

/** "Fix 2 lessons before publishing: “Handling a deletion request” — the article is empty; …" */
export function describeProblems(problems: LessonProblem[]) {
  const shown = problems.slice(0, 4).map(p => `“${p.title}” — ${p.issues.map(i => i.charAt(0).toLowerCase() + i.slice(1)).join(', ')}`);
  const more = problems.length > 4 ? `; and ${problems.length - 4} more` : '';
  return `Fix ${problems.length === 1 ? 'this lesson' : `${problems.length} lessons`} before publishing: ${shown.join('; ')}${more}.`;
}

/** Delete every row of a table matching a text column, one at a time (the data API deletes by id). */
export async function deleteWhere(table: string, accessor: { delete: (a: { id: string }) => Promise<unknown> }, column: string, value: string) {
  const { rows } = await zite.sql({ query: `SELECT id FROM "${table}" WHERE "${column}" = $1`, params: [value] });
  await eachWrite(rows, r => accessor.delete({ id: String(r.id) }));
  return rows.length;
}

/** Recompute every open enrollment in a path after its course list changes. */
export async function recomputePathLearners(pathId: string) {
  const { rows } = await zite.sql({ query: `SELECT id FROM "PathEnrollments" WHERE "pathId" = $1 AND COALESCE("status", '') NOT IN ('Withdrawn', 'Completed')`, params: [pathId] });
  for (const r of rows) await recomputePathEnrollment(String(r.id), { quiet: true });
  return rows.length;
}

/** Paths that include a course, for recomputing after the course goes away. */
export async function pathIdsContaining(courseId: string) {
  const { rows } = await zite.sql({ query: `SELECT DISTINCT "pathId" FROM "PathCourses" WHERE "courseId" = $1`, params: [courseId] });
  return rows.map(r => String(r.pathId));
}

export const cleanList = (items: string[] | undefined, max = 30, len = 200) => (items ?? []).map(s => s.trim().slice(0, len)).filter(Boolean).slice(0, max);

/** A web image address, or null. The column is a URL field, so anything else would be rejected on write. */
export function cleanUrl(v: string | null | undefined) {
  const u = (v ?? '').trim();
  if (!u) return null;
  if (!/^https?:\/\/\S+$/i.test(u)) throw new ZiteError('Use a full image address starting with https://', 'BAD_REQUEST');
  return u.slice(0, 2000);
}

export function firstNameInitial(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A learner';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}
