import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { refreshCourseMinutes } from '@project/shared/server/courses';
import { assertStaff, getActor } from '@project/shared/server/people';
import { num, str, withRetry } from '@project/shared/server/sql';
import { currentOrder, editableCourse, outlinePositions, positionsSchema, removeLessons, sectionSchema, syncCourseProgress, writeOutline } from '../server/builder';

/**
 * Sections group lessons in a course outline. Deleting one either keeps its
 * lessons (they move out of any section, after the lessons already there) or
 * deletes them too — which recomputes everyone's progress, like deleting a
 * lesson does.
 */

const Input = z.object({
  action: z.enum(['create', 'update', 'delete']),
  /** The section, for update and delete. */
  id: z.string().optional(),
  /** For create. */
  courseId: z.string().optional(),
  /** For create — omitted: last. */
  afterSectionId: z.string().nullable().optional(),
  title: z.string().max(200, 'Keep section titles under 200 characters').optional(),
  description: z.string().max(2000, 'Keep the description under 2,000 characters').optional(),
  mode: z.enum(['move_lessons', 'delete_lessons']).optional(),
});

const Output = z.object({
  section: sectionSchema.nullable(),
  positions: positionsSchema,
  deletedLessonIds: z.array(z.string()),
  estimatedMinutes: z.number(),
});

export default createEndpoint({
  description: 'Create, rename, describe or delete a course section',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'That change couldn’t be saved', 'BAD_REQUEST');
    const data = parsed.data;

    if (data.action === 'create') {
      if (!data.courseId) throw new ZiteError('Which course should the section go in?', 'BAD_REQUEST');
      const course = await editableCourse(actor, data.courseId);
      const created = await withRetry(() => zite.sections.create({ record: { title: (data.title ?? '').trim() || 'New section', courseId: course.id, description: data.description ?? '', position: 9999 } }));
      const order = await currentOrder(course.id);
      const ids = order.sectionIds.filter(id => id !== created.id);
      let at = ids.length;
      if (data.afterSectionId === null) at = 0;
      else if (data.afterSectionId && ids.includes(data.afterSectionId)) at = ids.indexOf(data.afterSectionId) + 1;
      ids.splice(at, 0, created.id);
      await writeOutline(course.id, { sectionIds: ids, groups: order.groups });
      const section = await readSection(created.id);
      return { section, positions: await outlinePositions(course.id), deletedLessonIds: [], estimatedMinutes: await minutes(course.id) };
    }

    const sectionId = data.id;
    if (!sectionId) throw new ZiteError('Which section?', 'BAD_REQUEST');
    const { rows } = await zite.sql({ query: `SELECT * FROM "Sections" WHERE id::text = $1 LIMIT 1`, params: [sectionId] });
    const row = rows[0];
    if (!row) throw new ZiteError('That section no longer exists', 'NOT_FOUND');
    const course = await editableCourse(actor, String(row.courseId ?? ''));

    if (data.action === 'update') {
      const record: Record<string, unknown> = {};
      if (data.title !== undefined) {
        const title = data.title.trim();
        if (!title) throw new ZiteError('Give the section a title', 'BAD_REQUEST');
        record.title = title;
      }
      if (data.description !== undefined) record.description = data.description.trim();
      if (Object.keys(record).length) await withRetry(() => zite.sections.update({ id: sectionId, record }));
      return { section: await readSection(sectionId), positions: await outlinePositions(course.id), deletedLessonIds: [], estimatedMinutes: await minutes(course.id) };
    }

    // delete
    const mode = data.mode ?? 'move_lessons';
    const order = await currentOrder(course.id);
    const lessonIds = order.groups.get(sectionId) ?? [];
    let deletedLessonIds: string[] = [];
    if (mode === 'delete_lessons' && lessonIds.length) {
      await removeLessons(course.id, lessonIds);
      deletedLessonIds = lessonIds;
      order.groups.delete(sectionId);
    } else if (lessonIds.length) {
      // Out of the section, after the lessons that already sit outside any section.
      order.groups.set(null, [...(order.groups.get(null) ?? []), ...lessonIds]);
      order.groups.delete(sectionId);
      await writeOutline(course.id, { sectionIds: order.sectionIds, groups: order.groups });
    }
    await withRetry(() => zite.sections.delete({ id: sectionId }));
    if (deletedLessonIds.length) {
      await refreshCourseMinutes(course.id);
      await syncCourseProgress(course.id, 'full');
    }
    const after = await currentOrder(course.id);
    await writeOutline(course.id, after);
    return { section: null, positions: await outlinePositions(course.id), deletedLessonIds, estimatedMinutes: await minutes(course.id) };
  },
});

async function readSection(id: string) {
  const { rows } = await zite.sql({ query: `SELECT id, "title", "description", "position" FROM "Sections" WHERE id::text = $1`, params: [id] });
  const s = rows[0];
  if (!s) throw new ZiteError('That section no longer exists', 'NOT_FOUND');
  return { id: String(s.id), title: str(s.title) ?? '', description: str(s.description) ?? '', position: num(s.position) };
}

async function minutes(courseId: string) {
  const { rows } = await zite.sql({ query: `SELECT COALESCE(SUM("durationMinutes"), 0) AS "total" FROM "Lessons" WHERE "courseId" = $1`, params: [courseId] });
  return num(rows[0]?.total);
}
