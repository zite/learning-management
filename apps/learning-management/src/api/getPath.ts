import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseIdList } from '@project/shared/progress';
import { loadPathCourses } from '@project/shared/server/courses';
import { assertStaff, getActor } from '@project/shared/server/people';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { canEditPath, requirePath } from '../server/catalog-admin';

/**
 * One learning path: its details, its courses in order with how this path's
 * learners are doing in each, enrollment counts, certificates issued and the
 * assignment rules that feed it.
 */

const Input = z.object({ id: z.string().min(1) });

const status = z.enum(['Draft', 'Published', 'Archived']);

const Output = z.object({
  path: z.object({
    id: z.string(), title: z.string(), slug: z.string(), summary: z.string(), description: z.string(), coverImageUrl: z.string().nullable(), icon: z.string(), color: z.string(),
    categoryId: z.string().nullable(), status, visibility: z.enum(['Catalog', 'Private']), ownerId: z.string().nullable(), sequential: z.boolean(), dueDays: z.number().nullable(),
    certificateEnabled: z.boolean(), certificateValidityMonths: z.number().nullable(), publishedAt: z.string().nullable(), position: z.number(), createdAt: z.string().nullable(),
  }),
  canEdit: z.boolean(),
  courses: z.array(z.object({
    pathCourseId: z.string(),
    courseId: z.string(),
    optional: z.boolean(),
    position: z.number(),
    title: z.string(),
    slug: z.string(),
    summary: z.string(),
    icon: z.string(),
    color: z.string(),
    coverImageUrl: z.string().nullable(),
    status,
    lessonCount: z.number(),
    estimatedMinutes: z.number(),
    learners: z.object({ enrolled: z.number(), completed: z.number(), inProgress: z.number(), notStarted: z.number(), throughPath: z.number(), openThroughPath: z.number() }),
  })),
  counts: z.object({ enrolled: z.number(), notStarted: z.number(), inProgress: z.number(), completed: z.number(), overdue: z.number(), withdrawn: z.number() }),
  certificates: z.object({ issued: z.number(), active: z.number() }),
  rules: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), audience: z.string(), groupIds: z.array(z.string()), personCount: z.number(), lastRunAt: z.string().nullable() })),
});

export default createEndpoint({
  description: 'Load a learning path with its courses, learner counts and certificates',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which learning path?', 'BAD_REQUEST');
    const path = await requirePath(parsed.data.id);
    const pathCourses = await loadPathCourses(path.id);
    const courseIds = pathCourses.map(c => c.courseId);

    const PEOPLE = `path_people AS (
        SELECT DISTINCT ON (pe."personId") pe.id, pe."personId", pe."status", pe."dueDate"
        FROM "PathEnrollments" pe WHERE pe."pathId" = $1
        ORDER BY pe."personId", COALESCE(pe."cycle", 1) DESC, pe.created_at DESC
      )`;

    const [coursesRes, perCourseRes, countsRes, certRes, rulesRes] = await Promise.all([
      courseIds.length
        ? zite.sql({
            query: `SELECT c.id::text AS id, c."title", c."slug", c."summary", c."icon", c."color", c."coverImageUrl", c."status", c."estimatedMinutes",
                      (SELECT COUNT(*) FROM "Lessons" l WHERE l."courseId" = c.id::text) AS "lessonTotal"
                    FROM "Courses" c WHERE c.id::text = ANY($1::text[])`,
            params: [courseIds],
          })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      courseIds.length
        ? zite.sql({
            query: `WITH ${PEOPLE}, course_latest AS (
                      SELECT DISTINCT ON (e."personId", e."courseId") e."courseId", e."status", e."source", e."pathEnrollmentId", pp.id::text AS "peId"
                      FROM "Enrollments" e JOIN path_people pp ON pp."personId" = e."personId" AND COALESCE(pp."status", '') <> 'Withdrawn'
                      WHERE e."courseId" = ANY($2::text[])
                      ORDER BY e."personId", e."courseId", COALESCE(e."cycle", 1) DESC, e.created_at DESC
                    )
                    SELECT "courseId",
                      COUNT(*) FILTER (WHERE COALESCE("status", '') <> 'Withdrawn') AS "enrolledTotal",
                      COUNT(*) FILTER (WHERE "status" = 'Completed') AS "doneTotal",
                      COUNT(*) FILTER (WHERE "status" = 'In progress') AS "activeTotal",
                      COUNT(*) FILTER (WHERE "status" = 'Not started') AS "idleTotal",
                      COUNT(*) FILTER (WHERE "pathEnrollmentId" = "peId" AND COALESCE("status", '') <> 'Withdrawn') AS "linkedTotal",
                      COUNT(*) FILTER (WHERE "pathEnrollmentId" = "peId" AND "status" IN ('Not started', 'In progress')) AS "openLinkedTotal"
                    FROM course_latest GROUP BY "courseId"`,
            params: [path.id, courseIds],
          })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      zite.sql({
        query: `WITH ${PEOPLE}
                SELECT COUNT(*) FILTER (WHERE COALESCE("status", '') <> 'Withdrawn') AS "enrolledTotal",
                  COUNT(*) FILTER (WHERE "status" = 'Not started') AS "idleTotal",
                  COUNT(*) FILTER (WHERE "status" = 'In progress') AS "activeTotal",
                  COUNT(*) FILTER (WHERE "status" = 'Completed') AS "doneTotal",
                  COUNT(*) FILTER (WHERE "status" IN ('Not started', 'In progress') AND "dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "lateTotal",
                  COUNT(*) FILTER (WHERE "status" = 'Withdrawn') AS "withdrawnTotal"
                FROM path_people`,
        params: [path.id],
      }),
      zite.sql({
        query: `SELECT COUNT(*) AS "issuedTotal", COUNT(*) FILTER (WHERE "status" = 'Active' AND ("expiresAt" IS NULL OR "expiresAt" > NOW())) AS "activeTotal" FROM "Certificates" WHERE "pathId" = $1`,
        params: [path.id],
      }),
      zite.sql({ query: `SELECT * FROM "AssignmentRules" WHERE "targetType" = 'Path' AND "pathId" = $1 AND COALESCE("status", '') <> 'Archived' ORDER BY created_at ASC`, params: [path.id] }),
    ]);

    const info = new Map(coursesRes.rows.map(r => [String(r.id), r]));
    const per = new Map(perCourseRes.rows.map(r => [String(r.courseId), r]));
    const c = countsRes.rows[0] ?? {};
    const cert = certRes.rows[0] ?? {};

    return {
      path: {
        id: path.id,
        title: path.title,
        slug: path.slug,
        summary: path.summary,
        description: path.description,
        coverImageUrl: path.coverImageUrl,
        icon: path.icon,
        color: path.color,
        categoryId: path.categoryId,
        status: path.status,
        visibility: path.visibility,
        ownerId: path.ownerId,
        sequential: path.sequential,
        dueDays: path.dueDays,
        certificateEnabled: path.certificateEnabled,
        certificateValidityMonths: path.certificateValidityMonths,
        publishedAt: path.publishedAt,
        position: path.position,
        createdAt: path.createdAt,
      },
      canEdit: canEditPath(actor, path),
      courses: pathCourses
        .filter(pc => info.has(pc.courseId))
        .map(pc => {
          const r = info.get(pc.courseId)!;
          const s = per.get(pc.courseId);
          const st = str(r.status);
          return {
            pathCourseId: pc.id,
            courseId: pc.courseId,
            optional: pc.optional,
            position: pc.position,
            title: str(r.title) ?? '',
            slug: str(r.slug) ?? '',
            summary: str(r.summary) ?? '',
            icon: str(r.icon) ?? '',
            color: str(r.color) || '#2f6b55',
            coverImageUrl: ref(r.coverImageUrl),
            status: st === 'Published' || st === 'Archived' ? st : 'Draft',
            lessonCount: num(r.lessonTotal),
            estimatedMinutes: num(r.estimatedMinutes),
            learners: { enrolled: num(s?.enrolledTotal), completed: num(s?.doneTotal), inProgress: num(s?.activeTotal), notStarted: num(s?.idleTotal), throughPath: num(s?.linkedTotal), openThroughPath: num(s?.openLinkedTotal) },
          };
        }),
      counts: { enrolled: num(c.enrolledTotal), notStarted: num(c.idleTotal), inProgress: num(c.activeTotal), completed: num(c.doneTotal), overdue: num(c.lateTotal), withdrawn: num(c.withdrawnTotal) },
      certificates: { issued: num(cert.issuedTotal), active: num(cert.activeTotal) },
      rules: rulesRes.rows.map(r => ({
        id: String(r.id),
        name: str(r.name) ?? '',
        status: str(r.status) || 'Active',
        audience: str(r.audience) || 'Everyone',
        groupIds: parseIdList(r.groupIds),
        personCount: parseIdList(r.personIds).length,
        lastRunAt: iso(r.lastRunAt),
      })),
    };
  },
});
