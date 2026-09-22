import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { refreshCourseMinutes } from '@project/shared/server/courses';
import { assertStaff, getActor } from '@project/shared/server/people';
import { num } from '@project/shared/server/sql';
import { currentOrder, editableCourse, lessonImpact, outlinePositions, positionsSchema, removeLessons, syncCourseProgress, writeOutline } from '../server/builder';

/**
 * Delete lessons for good. Call with `dryRun` first to learn how many learners
 * it affects (the builder asks before deleting anything people have worked
 * on). Because the set of required lessons changes, every active enrollment in
 * the course is recomputed afterwards — some people may finish the course as
 * a result.
 */

const Input = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Choose a lesson to delete').max(200),
  dryRun: z.boolean().optional(),
});

const impactSchema = z.object({ learners: z.number(), completed: z.number(), inProgress: z.number(), attempts: z.number(), submissions: z.number(), ungraded: z.number(), sessions: z.number() });

const Output = z.object({
  impact: impactSchema,
  deletedIds: z.array(z.string()),
  positions: positionsSchema.nullable(),
  estimatedMinutes: z.number(),
  recomputed: z.number(),
});

export default createEndpoint({
  description: 'Delete lessons from a course, or preview how many learners that affects',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Which lesson?', 'BAD_REQUEST');
    const ids = [...new Set(parsed.data.ids)];

    const { rows } = await zite.sql({ query: `SELECT id::text AS id, "courseId" FROM "Lessons" WHERE id::text = ANY($1::text[])`, params: [ids] });
    if (!rows.length) throw new ZiteError('That lesson no longer exists. It may already have been deleted.', 'NOT_FOUND');
    const courseIds = [...new Set(rows.map(r => String(r.courseId ?? '')))];
    if (courseIds.length > 1) throw new ZiteError('Delete lessons from one course at a time', 'BAD_REQUEST');
    const course = await editableCourse(actor, courseIds[0]);
    const found = rows.map(r => String(r.id));

    const impact = await lessonImpact(found);
    if (parsed.data.dryRun) {
      return { impact, deletedIds: [], positions: null, estimatedMinutes: course.estimatedMinutes, recomputed: 0 };
    }

    await removeLessons(course.id, found);
    // Close the gaps the deleted lessons left.
    await writeOutline(course.id, await currentOrder(course.id));
    await refreshCourseMinutes(course.id);
    const sync = await syncCourseProgress(course.id, 'full');
    const { rows: total } = await zite.sql({ query: `SELECT COALESCE(SUM("durationMinutes"), 0) AS "total" FROM "Lessons" WHERE "courseId" = $1`, params: [course.id] });
    return { impact, deletedIds: found, positions: await outlinePositions(course.id), estimatedMinutes: num(total[0]?.total), recomputed: sync.recomputed };
  },
});
