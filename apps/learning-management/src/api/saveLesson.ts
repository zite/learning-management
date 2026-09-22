import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { asLessonType, defaultSettings, LESSON_TYPE_META, parseSettings } from '@project/shared/lessons';
import { refreshCourseMinutes } from '@project/shared/server/courses';
import { assertStaff, getActor } from '@project/shared/server/people';
import { bool, num, ref, str, withRetry } from '@project/shared/server/sql';
import {
  editableCourse, editableLesson, LESSON_TYPE_ENUM, lessonSchema, outlinePositions, placeLesson, positionsSchema, readLesson, syncCourseProgress,
} from '../server/builder';

/**
 * Create, edit or duplicate one lesson. The builder autosaves through the
 * `update` action, sending only the fields that changed. Settings are always
 * re-parsed for the lesson's type, so what's stored is what the player can
 * run; changing the type starts that type's settings fresh.
 */

const Patch = z.object({
  title: z.string().max(200, 'Keep the title under 200 characters').optional(),
  body: z.string().max(100_000, 'That lesson is too long to save. Split it into two lessons.').optional(),
  mediaUrl: z.string().max(2000).nullable().optional(),
  mediaName: z.string().max(300).nullable().optional(),
  settings: z.record(z.string(), z.any()).optional(),
  durationMinutes: z.number().int('Use whole minutes').min(0, 'Duration can’t be negative').max(1440, 'Keep lessons under 24 hours').optional(),
  optional: z.boolean().optional(),
  sectionId: z.string().nullable().optional(),
  type: LESSON_TYPE_ENUM.optional(),
});

const Input = z.object({
  action: z.enum(['create', 'update', 'duplicate']),
  /** The lesson, for update and duplicate. */
  id: z.string().optional(),
  /** For create. */
  courseId: z.string().optional(),
  type: LESSON_TYPE_ENUM.optional(),
  sectionId: z.string().nullable().optional(),
  /** For create — omitted: end of the section; null: first in the section. */
  afterLessonId: z.string().nullable().optional(),
  title: z.string().max(200, 'Keep the title under 200 characters').optional(),
  /** For update. */
  patch: Patch.optional(),
});

const Output = z.object({ lesson: lessonSchema, positions: positionsSchema.nullable(), estimatedMinutes: z.number() });

function cleanUrl(v: string | null | undefined) {
  const t = (v ?? '').trim();
  return t ? t : null;
}

export default createEndpoint({
  description: 'Create, update or duplicate a lesson in the course builder',
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
      if (!data.courseId) throw new ZiteError('Which course should the lesson go in?', 'BAD_REQUEST');
      if (!data.type) throw new ZiteError('Choose what kind of lesson to add', 'BAD_REQUEST');
      const course = await editableCourse(actor, data.courseId);
      const type = data.type;
      let sectionId = data.sectionId ?? null;
      if (sectionId) {
        const { rows } = await zite.sql({ query: `SELECT 1 FROM "Sections" WHERE id::text = $1 AND "courseId" = $2`, params: [sectionId, course.id] });
        if (!rows.length) sectionId = null;
      }
      const created = await withRetry(() => zite.lessons.create({
        record: {
          title: (data.title ?? '').slice(0, 200),
          courseId: course.id,
          sectionId,
          type,
          body: '',
          mediaUrl: null,
          mediaName: null,
          settings: JSON.stringify(defaultSettings(type)),
          durationMinutes: LESSON_TYPE_META[type].defaultMinutes,
          optional: false,
          position: 9999,
        },
      }));
      await placeLesson(course.id, created.id, sectionId, data.afterLessonId);
      await refreshCourseMinutes(course.id);
      // A new required lesson lowers everyone's percentage mid-course.
      await syncCourseProgress(course.id, 'progress', { maxWrites: 40 });
      const [lesson, positions] = await Promise.all([readLesson(created.id), outlinePositions(course.id)]);
      return { lesson, positions, estimatedMinutes: await courseMinutes(course.id) };
    }

    if (!data.id) throw new ZiteError('Which lesson?', 'BAD_REQUEST');

    if (data.action === 'duplicate') {
      const { row, course } = await editableLesson(actor, data.id);
      const type = asLessonType(row.type);
      const title = str(row.title) ?? '';
      const created = await withRetry(() => zite.lessons.create({
        record: {
          title: `${title || 'Untitled lesson'} (copy)`.slice(0, 200),
          courseId: course.id,
          sectionId: ref(row.sectionId),
          type,
          body: str(row.body) ?? '',
          mediaUrl: ref(row.mediaUrl),
          mediaName: ref(row.mediaName),
          settings: JSON.stringify(parseSettings(type, row.settings)),
          durationMinutes: num(row.durationMinutes),
          optional: bool(row.optional),
          position: 9999,
        },
      }));
      await placeLesson(course.id, created.id, ref(row.sectionId), String(row.id));
      await refreshCourseMinutes(course.id);
      if (!bool(row.optional)) await syncCourseProgress(course.id, 'progress', { maxWrites: 40 });
      const [lesson, positions] = await Promise.all([readLesson(created.id), outlinePositions(course.id)]);
      return { lesson, positions, estimatedMinutes: await courseMinutes(course.id) };
    }

    // update
    const { row, course } = await editableLesson(actor, data.id);
    const p = data.patch ?? {};
    const currentType = asLessonType(row.type);
    const record: Record<string, unknown> = {};
    const nextType = p.type ?? currentType;

    if (p.title !== undefined) record.title = p.title;
    if (p.body !== undefined) record.body = p.body;
    if (p.mediaUrl !== undefined) {
      const url = cleanUrl(p.mediaUrl);
      if (url && !/^https?:\/\//i.test(url)) throw new ZiteError('Links need to start with https://', 'BAD_REQUEST');
      if (url && nextType === 'Embed' && !/^https:\/\//i.test(url)) throw new ZiteError('Embedded pages must use a secure https:// address', 'BAD_REQUEST');
      record.mediaUrl = url;
    }
    if (p.mediaName !== undefined) record.mediaName = cleanUrl(p.mediaName);
    if (p.durationMinutes !== undefined) record.durationMinutes = p.durationMinutes;
    if (p.optional !== undefined) record.optional = p.optional;
    if (p.type !== undefined && p.type !== currentType) {
      record.type = p.type;
      record.settings = JSON.stringify(defaultSettings(p.type));
    } else if (p.settings !== undefined) {
      record.settings = JSON.stringify(parseSettings(currentType, p.settings));
    }

    let moved = false;
    if (p.sectionId !== undefined) {
      const target = p.sectionId || null;
      if (target) {
        const { rows } = await zite.sql({ query: `SELECT 1 FROM "Sections" WHERE id::text = $1 AND "courseId" = $2`, params: [target, course.id] });
        if (!rows.length) throw new ZiteError('That section no longer exists', 'NOT_FOUND');
      }
      if (ref(row.sectionId) !== target) {
        moved = true;
        await placeLesson(course.id, String(row.id), target);
      }
    }

    if (Object.keys(record).length) await withRetry(() => zite.lessons.update({ id: String(row.id), record }));
    if (p.durationMinutes !== undefined && p.durationMinutes !== num(row.durationMinutes)) await refreshCourseMinutes(course.id);
    if (p.optional !== undefined && p.optional !== bool(row.optional)) await syncCourseProgress(course.id, 'progress');

    const [lesson, positions] = await Promise.all([readLesson(String(row.id)), moved ? outlinePositions(course.id) : Promise.resolve(null)]);
    return { lesson, positions, estimatedMinutes: await courseMinutes(course.id) };
  },
});

async function courseMinutes(courseId: string) {
  const { rows } = await zite.sql({ query: `SELECT COALESCE(SUM("durationMinutes"), 0) AS "total" FROM "Lessons" WHERE "courseId" = $1`, params: [courseId] });
  return num(rows[0]?.total);
}
