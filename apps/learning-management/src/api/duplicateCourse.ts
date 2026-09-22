import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { slugify } from '@project/shared/progress';
import { logActivity } from '@project/shared/server/activity';
import { refreshCourseMinutes, uniqueSlug } from '@project/shared/server/courses';
import { assertStaff, getActor } from '@project/shared/server/people';
import { bool, chunked, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { nextPosition, requireCourse } from '../server/catalog-admin';

/**
 * Copy a course as a new draft: its details, sections and lessons with all
 * their settings (quiz questions, checklists, rubrics). Learners, progress,
 * discussions and live sessions stay with the original.
 */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Duplicate a course with its sections and lessons as a new draft',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string(), slug: z.string(), title: z.string(), lessons: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which course?', 'BAD_REQUEST');
    const source = await requireCourse(parsed.data.id);

    const title = `Copy of ${source.title}`.slice(0, 160);
    const slug = await uniqueSlug('Courses', slugify(title) || 'course');
    const created = await zite.courses.create({
      record: {
        title,
        slug,
        summary: source.summary || null,
        description: source.description || null,
        objectives: JSON.stringify(source.objectives),
        skills: JSON.stringify(source.skills),
        coverImageUrl: source.coverImageUrl,
        icon: source.icon || '📘',
        color: source.color,
        categoryId: source.categoryId,
        level: source.level,
        status: 'Draft',
        visibility: source.visibility,
        // Whoever makes the copy owns it, so an instructor can always edit what they just created.
        ownerId: actor.id,
        instructorIds: JSON.stringify(source.instructorIds.filter(id => id !== actor.id)),
        sequential: source.sequential,
        estimatedMinutes: source.estimatedMinutes,
        dueDays: source.dueDays,
        certificateEnabled: source.certificateEnabled,
        certificateValidityMonths: source.certificateValidityMonths,
        publishedAt: null,
        position: await nextPosition('Courses'),
      },
    });

    const [sectionsRes, lessonsRes] = await Promise.all([
      zite.sql({ query: `SELECT * FROM "Sections" WHERE "courseId" = $1 ORDER BY COALESCE("position", 0) ASC, created_at ASC`, params: [source.id] }),
      zite.sql({ query: `SELECT * FROM "Lessons" WHERE "courseId" = $1 ORDER BY COALESCE("position", 0) ASC, created_at ASC`, params: [source.id] }),
    ]);

    const sectionMap = new Map<string, string>();
    const sectionRows = sectionsRes.rows;
    await chunked(sectionRows, async batch => {
      const res = await zite.sections.bulkCreate({
        records: batch.map(s => ({ title: str(s.title) ?? '', courseId: created.id, description: str(s.description) || null, position: num(s.position) })),
      });
      res.records.forEach((r, i) => sectionMap.set(String(batch[i].id), r.id));
    });

    await chunked(lessonsRes.rows, async batch => {
      await zite.lessons.bulkCreate({
        records: batch.map(l => ({
          title: str(l.title) ?? '',
          courseId: created.id,
          sectionId: ref(l.sectionId) ? sectionMap.get(String(l.sectionId)) ?? null : null,
          type: str(l.type) || 'Article',
          body: str(l.body) || null,
          mediaUrl: ref(l.mediaUrl),
          mediaName: ref(l.mediaName),
          settings: str(l.settings) || null,
          durationMinutes: numOrNull(l.durationMinutes),
          optional: bool(l.optional),
          position: num(l.position),
        })),
      });
    });
    await refreshCourseMinutes(created.id);
    await logActivity({ type: 'course_created', actorId: actor.id, courseId: created.id, data: { courseTitle: title, duplicatedFrom: source.id } });

    return { id: created.id, slug, title, lessons: lessonsRes.rows.length };
  },
});
