import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { asLessonType, parseSettings } from '@project/shared/lessons';
import { loadCourse } from '@project/shared/server/courses';
import { assertStaff, canEditCourse, getActor } from '@project/shared/server/people';
import { bool, iso, num, ref, str } from '@project/shared/server/sql';

/**
 * One course with its full outline and lesson content — what the builder
 * edits and the course pages show. Lesson settings arrive parsed and
 * normalised (see `parseSettings`), including quiz answers: this is the
 * staff app.
 */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Load a course with its sections, lessons and live sessions',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    course: z.object({
      id: z.string(), title: z.string(), slug: z.string(), summary: z.string(), description: z.string(), objectives: z.array(z.string()),
      coverImageUrl: z.string().nullable(), icon: z.string(), color: z.string(), categoryId: z.string().nullable(), level: z.string(),
      status: z.enum(['Draft', 'Published', 'Archived']), visibility: z.enum(['Catalog', 'Private']), ownerId: z.string().nullable(), instructorIds: z.array(z.string()),
      sequential: z.boolean(), estimatedMinutes: z.number(), dueDays: z.number().nullable(), certificateEnabled: z.boolean(), certificateValidityMonths: z.number().nullable(),
      skills: z.array(z.string()), publishedAt: z.string().nullable(), position: z.number(), createdAt: z.string().nullable(), updatedAt: z.string().nullable(),
    }),
    canEdit: z.boolean(),
    sections: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), position: z.number() })),
    lessons: z.array(z.object({
      id: z.string(), title: z.string(), type: z.enum(['Article', 'Video', 'Quiz', 'Assignment', 'File', 'Embed', 'Live session', 'Checklist']),
      sectionId: z.string().nullable(), position: z.number(), body: z.string(), mediaUrl: z.string().nullable(), mediaName: z.string().nullable(),
      settings: z.record(z.string(), z.any()), durationMinutes: z.number(), optional: z.boolean(), updatedAt: z.string().nullable(),
      completedCount: z.number(),
    })),
    sessions: z.array(z.object({ id: z.string(), title: z.string(), lessonId: z.string().nullable(), startsAt: z.string().nullable(), endsAt: z.string().nullable(), status: z.string(), capacity: z.number().nullable(), registered: z.number(), location: z.string(), meetingUrl: z.string().nullable() })),
  }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which course?', 'BAD_REQUEST');
    const course = await loadCourse(parsed.data.id);
    if (!course) throw new ZiteError('That course no longer exists', 'NOT_FOUND');

    const [sectionsRes, lessonsRes, completionRes, sessionsRes] = await Promise.all([
      zite.sql({ query: `SELECT id, "title", "description", "position" FROM "Sections" WHERE "courseId" = $1 ORDER BY COALESCE("position", 0) ASC, created_at ASC`, params: [course.id] }),
      zite.sql({ query: `SELECT * FROM "Lessons" WHERE "courseId" = $1 ORDER BY COALESCE("position", 0) ASC, created_at ASC`, params: [course.id] }),
      zite.sql({ query: `SELECT "lessonId", COUNT(DISTINCT "personId") AS "doneTotal" FROM "LessonProgress" WHERE "courseId" = $1 AND "status" = 'Completed' GROUP BY "lessonId"`, params: [course.id] }),
      zite.sql({
        query: `SELECT s.*, (SELECT COUNT(*) FROM "Registrations" r WHERE r."sessionId" = s.id::text AND r."status" IN ('Registered', 'Attended')) AS "registeredTotal" FROM "Sessions" s WHERE s."courseId" = $1 ORDER BY s."startsAt" ASC NULLS LAST`,
        params: [course.id],
      }),
    ]);
    const done = new Map(completionRes.rows.map(r => [String(r.lessonId), num(r.doneTotal)]));
    const sectionIds = new Set(sectionsRes.rows.map(s => String(s.id)));

    return {
      course,
      canEdit: canEditCourse(actor, course),
      sections: sectionsRes.rows.map(s => ({ id: String(s.id), title: str(s.title) ?? '', description: str(s.description) ?? '', position: num(s.position) })),
      lessons: lessonsRes.rows.map(l => {
        const type = asLessonType(l.type);
        return {
          id: String(l.id),
          title: str(l.title) ?? '',
          type,
          sectionId: ref(l.sectionId) && sectionIds.has(String(l.sectionId)) ? String(l.sectionId) : null,
          position: num(l.position),
          body: str(l.body) ?? '',
          mediaUrl: ref(l.mediaUrl),
          mediaName: ref(l.mediaName),
          settings: parseSettings(type, l.settings) as Record<string, unknown>,
          durationMinutes: num(l.durationMinutes),
          optional: bool(l.optional),
          updatedAt: iso(l.updated_at),
          completedCount: done.get(String(l.id)) ?? 0,
        };
      }),
      sessions: sessionsRes.rows.map(s => ({
        id: String(s.id),
        title: str(s.title) ?? '',
        lessonId: ref(s.lessonId),
        startsAt: iso(s.startsAt),
        endsAt: iso(s.endsAt),
        status: str(s.status) || 'Scheduled',
        capacity: s.capacity == null || s.capacity === '' ? null : num(s.capacity),
        registered: num(s.registeredTotal),
        location: str(s.location) ?? '',
        meetingUrl: ref(s.meetingUrl),
      })),
    };
  },
});
