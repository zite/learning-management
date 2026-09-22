import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { assertStaff, getActor } from '@project/shared/server/people';
import { editableCourse, outlinePositions, positionsSchema, writeOutline } from '../server/builder';

/**
 * Save a course outline's order after a drag or a keyboard move: sections in
 * order, each with its lessons in order, plus the lessons outside any
 * section. Only rows whose position or section changed are written.
 */

const Input = z.object({
  courseId: z.string().min(1),
  sections: z.array(z.object({ id: z.string().min(1), lessonIds: z.array(z.string()).max(1000) })).max(500),
  unsectionedLessonIds: z.array(z.string()).max(1000),
});

const Output = z.object({ positions: positionsSchema, written: z.number() });

export default createEndpoint({
  description: 'Reorder the sections and lessons of a course',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('That outline order couldn’t be read. Refresh and try again.', 'BAD_REQUEST');
    const course = await editableCourse(actor, parsed.data.courseId);
    const groups = new Map<string | null, string[]>([[null, parsed.data.unsectionedLessonIds]]);
    for (const s of parsed.data.sections) groups.set(s.id, s.lessonIds);
    const res = await writeOutline(course.id, { sectionIds: parsed.data.sections.map(s => s.id), groups });
    return { positions: await outlinePositions(course.id), written: res.sectionsWritten + res.lessonsWritten };
  },
});
