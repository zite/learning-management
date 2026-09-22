import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseData } from '@project/shared/server/activity';
import { assertStaff, getActor } from '@project/shared/server/people';
import { iso, ref, str } from '@project/shared/server/sql';

/**
 * A person's audit trail, newest first: what happened to them (enrolled,
 * completed, certified, role changed) and what they did to others (graded,
 * enrolled, invited). Names and titles are joined so the client renders
 * sentences without extra lookups.
 */

const Input = z.object({
  personId: z.string().min(1),
  scope: z.enum(['all', 'about', 'by']).default('all'),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(100_000).default(0),
});

const Output = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      occurredAt: z.string().nullable(),
      personId: z.string().nullable(),
      personName: z.string().nullable(),
      personColor: z.string().nullable(),
      actorId: z.string().nullable(),
      actorName: z.string().nullable(),
      actorColor: z.string().nullable(),
      actorAvatarUrl: z.string().nullable(),
      courseId: z.string().nullable(),
      courseTitle: z.string().nullable(),
      pathId: z.string().nullable(),
      pathTitle: z.string().nullable(),
      lessonTitle: z.string().nullable(),
      enrollmentId: z.string().nullable(),
      data: z.record(z.unknown()),
    }),
  ),
  hasMore: z.boolean(),
});

export default createEndpoint({
  description: "List a person's activity as learner and as actor",
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const { personId, scope, limit, offset } = parsed.data;
    const where = scope === 'about' ? `a."personId" = $1` : scope === 'by' ? `a."actorId" = $1 AND COALESCE(a."personId", '') <> $1` : `(a."personId" = $1 OR a."actorId" = $1)`;
    const { rows } = await zite.sql({
      query: `SELECT a.id, a."type", a."occurredAt", a."personId", a."actorId", a."courseId", a."pathId", a."lessonId", a."enrollmentId", a."data", a.created_at,
                sub."name" AS "personName", sub."color" AS "personColor",
                act."name" AS "actorName", act."color" AS "actorColor", act."avatarUrl" AS "actorAvatarUrl",
                c."title" AS "courseTitle", pa."title" AS "pathTitle", l."title" AS "lessonTitle"
              FROM "Activity" a
              LEFT JOIN "People" sub ON sub.id::text = a."personId"
              LEFT JOIN "People" act ON act.id::text = a."actorId"
              LEFT JOIN "Courses" c ON c.id::text = a."courseId"
              LEFT JOIN "Paths" pa ON pa.id::text = a."pathId"
              LEFT JOIN "Lessons" l ON l.id::text = a."lessonId"
              WHERE ${where}
              ORDER BY COALESCE(a."occurredAt", a.created_at) DESC, a.created_at DESC
              LIMIT ${limit + 1} OFFSET ${offset}`,
      params: [personId],
    });
    return {
      items: rows.slice(0, limit).map(r => ({
        id: String(r.id),
        type: str(r.type) ?? '',
        occurredAt: iso(r.occurredAt) ?? iso(r.created_at),
        personId: ref(r.personId),
        personName: ref(r.personName),
        personColor: ref(r.personColor),
        actorId: ref(r.actorId),
        actorName: ref(r.actorName),
        actorColor: ref(r.actorColor),
        actorAvatarUrl: ref(r.actorAvatarUrl),
        courseId: ref(r.courseId),
        courseTitle: ref(r.courseTitle),
        pathId: ref(r.pathId),
        pathTitle: ref(r.pathTitle),
        lessonTitle: ref(r.lessonTitle),
        enrollmentId: ref(r.enrollmentId),
        data: parseData(r.data),
      })),
      hasMore: rows.length > limit,
    };
  },
});
