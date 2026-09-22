import { zite } from 'zitejs/db';
import { asLessonType, type LessonType } from '../lessons';
import { parseIdList, type LessonRef, type PathCourseRef } from '../progress';
import { bool, iso, num, numOrNull, ref, str } from './sql';

/**
 * Loading courses, outlines and paths in the one order every surface uses:
 * sections by position, lessons by position within them (lessons outside any
 * section first). Endpoints in both apps read through these, so the builder,
 * the player and progress maths can never disagree about what "next" means.
 */

export type CourseRecord = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  objectives: string[];
  coverImageUrl: string | null;
  icon: string;
  color: string;
  categoryId: string | null;
  level: string;
  status: 'Draft' | 'Published' | 'Archived';
  visibility: 'Catalog' | 'Private';
  ownerId: string | null;
  instructorIds: string[];
  sequential: boolean;
  estimatedMinutes: number;
  dueDays: number | null;
  certificateEnabled: boolean;
  certificateValidityMonths: number | null;
  skills: string[];
  publishedAt: string | null;
  position: number;
  createdAt: string | null;
  updatedAt: string | null;
};

const asStatus = (v: unknown): CourseRecord['status'] => (v === 'Published' || v === 'Archived' ? v : 'Draft');

export function toCourse(r: Record<string, unknown>): CourseRecord {
  return {
    id: String(r.id),
    title: str(r.title) ?? '',
    slug: str(r.slug) ?? '',
    summary: str(r.summary) ?? '',
    description: str(r.description) ?? '',
    objectives: parseIdList(r.objectives),
    coverImageUrl: ref(r.coverImageUrl),
    icon: str(r.icon) ?? '',
    color: str(r.color) || '#2f6b55',
    categoryId: ref(r.categoryId),
    level: str(r.level) || 'Beginner',
    status: asStatus(r.status),
    visibility: r.visibility === 'Private' ? 'Private' : 'Catalog',
    ownerId: ref(r.ownerId),
    instructorIds: parseIdList(r.instructorIds),
    sequential: bool(r.sequential),
    estimatedMinutes: num(r.estimatedMinutes),
    dueDays: numOrNull(r.dueDays),
    certificateEnabled: bool(r.certificateEnabled),
    certificateValidityMonths: numOrNull(r.certificateValidityMonths) || null,
    skills: parseIdList(r.skills),
    publishedAt: iso(r.publishedAt),
    position: num(r.position),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function loadCourse(idOrSlug: string): Promise<CourseRecord | null> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Courses" WHERE id::text = $1 OR (COALESCE("slug", '') <> '' AND "slug" = $1) ORDER BY CASE WHEN id::text = $1 THEN 0 ELSE 1 END LIMIT 1`, params: [idOrSlug] });
  return rows[0] ? toCourse(rows[0]) : null;
}

export type OutlineLesson = LessonRef & { type: LessonType; title: string; durationMinutes: number; sectionId: string | null; position: number };
export type OutlineSection = { id: string; title: string; description: string; position: number };

/** Sections and lessons in outline order. */
export async function loadOutline(courseId: string): Promise<{ sections: OutlineSection[]; lessons: OutlineLesson[] }> {
  const [sectionsRes, lessonsRes] = await Promise.all([
    zite.sql({ query: `SELECT id, "title", "description", "position" FROM "Sections" WHERE "courseId" = $1 ORDER BY COALESCE("position", 0) ASC, created_at ASC`, params: [courseId] }),
    zite.sql({
      query: `SELECT id, "title", "type", "optional", "sectionId", "position", "durationMinutes" FROM "Lessons" WHERE "courseId" = $1 ORDER BY COALESCE("position", 0) ASC, created_at ASC`,
      params: [courseId],
    }),
  ]);
  const sections = sectionsRes.rows.map(s => ({ id: String(s.id), title: str(s.title) ?? '', description: str(s.description) ?? '', position: num(s.position) }));
  const sectionIndex = new Map(sections.map((s, i) => [s.id, i]));
  const lessons = lessonsRes.rows
    .map(l => ({
      id: String(l.id),
      title: str(l.title) ?? '',
      type: asLessonType(l.type),
      optional: bool(l.optional),
      sectionId: ref(l.sectionId) && sectionIndex.has(String(l.sectionId)) ? String(l.sectionId) : null,
      position: num(l.position),
      durationMinutes: num(l.durationMinutes),
    }))
    // Stable: SQL already ordered by position within each group.
    .sort((a, b) => (a.sectionId === null ? -1 : sectionIndex.get(a.sectionId)!) - (b.sectionId === null ? -1 : sectionIndex.get(b.sectionId)!));
  return { sections, lessons };
}

/** Keep the course's cached duration in step with its lessons. */
export async function refreshCourseMinutes(courseId: string) {
  const { rows } = await zite.sql({ query: `SELECT COALESCE(SUM("durationMinutes"), 0) AS "total" FROM "Lessons" WHERE "courseId" = $1`, params: [courseId] });
  await zite.courses.update({ id: courseId, record: { estimatedMinutes: num(rows[0]?.total) } });
}

export type PathRecord = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  coverImageUrl: string | null;
  icon: string;
  color: string;
  categoryId: string | null;
  status: 'Draft' | 'Published' | 'Archived';
  visibility: 'Catalog' | 'Private';
  ownerId: string | null;
  sequential: boolean;
  dueDays: number | null;
  certificateEnabled: boolean;
  certificateValidityMonths: number | null;
  publishedAt: string | null;
  position: number;
  createdAt: string | null;
};

export function toPath(r: Record<string, unknown>): PathRecord {
  return {
    id: String(r.id),
    title: str(r.title) ?? '',
    slug: str(r.slug) ?? '',
    summary: str(r.summary) ?? '',
    description: str(r.description) ?? '',
    coverImageUrl: ref(r.coverImageUrl),
    icon: str(r.icon) ?? '',
    color: str(r.color) || '#2f6b55',
    categoryId: ref(r.categoryId),
    status: asStatus(r.status),
    visibility: r.visibility === 'Private' ? 'Private' : 'Catalog',
    ownerId: ref(r.ownerId),
    sequential: bool(r.sequential),
    dueDays: numOrNull(r.dueDays),
    certificateEnabled: bool(r.certificateEnabled),
    certificateValidityMonths: numOrNull(r.certificateValidityMonths) || null,
    publishedAt: iso(r.publishedAt),
    position: num(r.position),
    createdAt: iso(r.created_at),
  };
}

export async function loadPath(idOrSlug: string): Promise<PathRecord | null> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Paths" WHERE id::text = $1 OR (COALESCE("slug", '') <> '' AND "slug" = $1) ORDER BY CASE WHEN id::text = $1 THEN 0 ELSE 1 END LIMIT 1`, params: [idOrSlug] });
  return rows[0] ? toPath(rows[0]) : null;
}

/** A path's courses in order. Courses that were deleted are dropped. */
export async function loadPathCourses(pathId: string): Promise<Array<PathCourseRef & { id: string }>> {
  const { rows } = await zite.sql({
    query: `SELECT pc.id, pc."courseId", pc."position", pc."optional" FROM "PathCourses" pc JOIN "Courses" c ON c.id::text = pc."courseId" WHERE pc."pathId" = $1 ORDER BY COALESCE(pc."position", 0) ASC, pc.created_at ASC`,
    params: [pathId],
  });
  return rows.map(r => ({ id: String(r.id), courseId: String(r.courseId), position: num(r.position), optional: bool(r.optional) }));
}

/** Unique slug for a table, derived from a title. */
export async function uniqueSlug(table: 'Courses' | 'Paths', base: string, excludeId?: string) {
  const root = base || 'untitled';
  const { rows } = await zite.sql({ query: `SELECT id, "slug" FROM "${table}" WHERE "slug" = $1 OR "slug" LIKE $2`, params: [root, `${root}-%`] });
  const taken = new Set(rows.filter(r => !excludeId || String(r.id) !== excludeId).map(r => String(r.slug)));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 500; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
  return `${root}-${Date.now().toString(36)}`;
}
