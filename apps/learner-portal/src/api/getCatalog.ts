import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { asEnrollmentStatus, type EnrollmentStatus } from '@project/shared/progress';
import { getLearner } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { num, ref, str } from '@project/shared/server/sql';
import { COURSE_CARD_COLUMNS, COURSE_CARD_JOIN, jsonRows, PATH_CARD_COLUMNS, PATH_CARD_JOIN, toCourseCard, toPathCard, validColor, type CourseCard, type PathCard } from '../server/learn';

/**
 * The catalog: published courses and paths anyone in the organization can
 * browse. Private training never appears here — it reaches people through
 * assignment. Category counts ignore the category filter, so the chips always
 * say how many are behind each one.
 */

const Input = z.object({
  q: z.string().max(120).optional(),
  categoryId: z.string().max(64).optional().nullable(),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional().nullable(),
  duration: z.enum(['short', 'medium', 'long']).optional().nullable(),
  kind: z.enum(['course', 'path']).optional().nullable(),
});

export type MyStatus = { status: EnrollmentStatus; progress: number } | null;
export type CatalogCourse = CourseCard & { mine: MyStatus };
/** A path's courses in order, for the card's outline; `done` when the learner has ever completed that course. */
export type CatalogPathCourse = { title: string; optional: boolean; done: boolean };
export type CatalogPath = PathCard & { mine: MyStatus; courses: CatalogPathCourse[] };

export type CatalogOutput = {
  selfEnrollment: boolean;
  categories: Array<{ id: string; name: string; color: string; icon: string; count: number }>;
  courses: CatalogCourse[];
  paths: CatalogPath[];
  total: number;
};

const pathCourses = (v: unknown): CatalogPathCourse[] =>
  jsonRows(v).map(c => ({ title: str(c.title) ?? '', optional: c.optional === true || c.optional === 'true', done: c.done === true || c.done === 'true' }));

/** Under 30 minutes, 30 to 60 minutes, over an hour. */
const DURATION: Record<'short' | 'medium' | 'long', [number, number]> = { short: [0, 29], medium: [30, 60], long: [61, 1_000_000] };

export default createEndpoint({
  description: 'Browse the course catalog',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<CatalogOutput> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Those filters don’t look right. Clear them and try again.', 'BAD_REQUEST');
    const { q, categoryId, level, duration, kind } = parsed.data;
    const settings = await getSettings();
    const actor = await getLearner(context, settings);
    const search = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, m => `\\${m}`)}%` : null;
    const range = duration ? DURATION[duration] : null;

    // One statement: courses and paths as JSON, plus category counts.
    const { rows } = await zite.sql({
      query: `SELECT
        (SELECT json_agg(t)::text FROM (
          SELECT ${COURSE_CARD_COLUMNS}, mine."status" AS "myStatus", mine."progress" AS "myProgress"
          FROM "Courses" c ${COURSE_CARD_JOIN}
          LEFT JOIN LATERAL (
            SELECT e."status", e."progress" FROM "Enrollments" e WHERE e."courseId" = c.id::text AND e."personId" = $1 AND COALESCE(e."status", '') <> 'Withdrawn'
            ORDER BY COALESCE(e."cycle", 1) DESC, e.created_at DESC LIMIT 1
          ) mine ON true
          WHERE c."status" = 'Published' AND c."visibility" = 'Catalog'
            AND ($2::text IS NULL OR c."title" ILIKE $2::text OR c."summary" ILIKE $2::text OR c."skills" ILIKE $2::text OR cat."name" ILIKE $2::text)
            AND ($3::text IS NULL OR c."level" = $3::text)
            AND ($4::int IS NULL OR COALESCE(c."estimatedMinutes", 0) BETWEEN $4::int AND $5::int)
          ORDER BY COALESCE(c."position", 0) ASC, c."title" ASC
        ) t) AS "coursesJson",
        (SELECT json_agg(t)::text FROM (
          SELECT ${PATH_CARD_COLUMNS}, mine."status" AS "myStatus", mine."progress" AS "myProgress",
            (SELECT json_agg(json_build_object(
                'title', pcc."title",
                'optional', COALESCE(pc."optional", false),
                'done', EXISTS (SELECT 1 FROM "Enrollments" x WHERE x."personId" = $1 AND x."courseId" = pc."courseId" AND x."status" = 'Completed')
              ) ORDER BY COALESCE(pc."position", 0) ASC, pc.created_at ASC)
              FROM "PathCourses" pc JOIN "Courses" pcc ON pcc.id::text = pc."courseId"
              WHERE pc."pathId" = p.id::text) AS "courseList"
          FROM "Paths" p ${PATH_CARD_JOIN}
          LEFT JOIN LATERAL (
            SELECT pe."status", pe."progress" FROM "PathEnrollments" pe WHERE pe."pathId" = p.id::text AND pe."personId" = $1 AND COALESCE(pe."status", '') <> 'Withdrawn'
            ORDER BY COALESCE(pe."cycle", 1) DESC, pe.created_at DESC LIMIT 1
          ) mine ON true
          WHERE p."status" = 'Published' AND p."visibility" = 'Catalog'
            AND ($2::text IS NULL OR p."title" ILIKE $2::text OR p."summary" ILIKE $2::text OR cat."name" ILIKE $2::text)
          ORDER BY COALESCE(p."position", 0) ASC, p."title" ASC
        ) t) AS "pathsJson",
        (SELECT json_agg(t)::text FROM (
          SELECT id::text AS id, "name", "color", "icon" FROM "Categories" ORDER BY COALESCE("position", 0) ASC, "name" ASC
        ) t) AS "categoriesJson"`,
      params: [actor.id, search, level ?? null, range ? range[0] : null, range ? range[1] : null],
    });
    const x = rows[0] ?? {};
    const mine = (r: Record<string, unknown>): MyStatus => (r.myStatus ? { status: asEnrollmentStatus(r.myStatus), progress: r.myStatus === 'Completed' ? 100 : num(r.myProgress) } : null);
    const allCourses = jsonRows(x.coursesJson).map(r => ({ ...toCourseCard(r), mine: mine(r) }));
    // Level and duration describe courses; a path has neither, so those filters narrow to courses.
    const allPaths = level || duration ? [] : jsonRows(x.pathsJson).map(r => ({ ...toPathCard(r), mine: mine(r), courses: pathCourses(r.courseList) }));
    const courses = kind === 'path' ? [] : allCourses;
    const paths = kind === 'course' ? [] : allPaths;

    const counts = new Map<string, number>();
    for (const item of [...courses, ...paths]) if (item.category) counts.set(item.category.id, (counts.get(item.category.id) ?? 0) + 1);
    const categories = jsonRows(x.categoriesJson)
      .map(r => ({ id: String(r.id), name: str(r.name) ?? '', color: validColor(r.color), icon: str(r.icon) ?? '', count: counts.get(String(r.id)) ?? 0 }))
      .filter(c => c.count > 0 || c.id === ref(categoryId));

    const inCategory = <T extends { category: { id: string } | null }>(list: T[]) => (categoryId ? list.filter(i => i.category?.id === categoryId) : list);
    const shownCourses = inCategory(courses);
    const shownPaths = inCategory(paths);
    return { selfEnrollment: settings.selfEnrollment, categories, courses: shownCourses, paths: shownPaths, total: shownCourses.length + shownPaths.length };
  },
});
