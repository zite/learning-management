import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { resumeLessonId } from '@project/shared/progress';
import { loadPathCourses } from '@project/shared/server/courses';
import { num, ref, str } from '@project/shared/server/sql';
import { isConfigured } from '../server/ai';
import { certificateSummary, enrollmentSummary, lessonStateOf, loadPlayer } from '../server/player';

/**
 * Everything the course player's frame needs: the course, its outline with a
 * state per lesson, the learner's enrollment and where to resume. Access
 * problems come back as `enrollment: null` with a reason, so the page can
 * send people to the right place instead of showing an error.
 */

const Input = z.object({ slug: z.string().min(1).max(200) });

const Certificate = z.object({ id: z.string(), credentialId: z.string(), issuedAt: z.string().nullable(), expiresAt: z.string().nullable(), status: z.string(), title: z.string(), recipientName: z.string() });

const Output = z.object({
  course: z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    summary: z.string(),
    objectives: z.array(z.string()),
    status: z.string(),
    sequential: z.boolean(),
    certificateEnabled: z.boolean(),
    estimatedMinutes: z.number(),
    color: z.string(),
    icon: z.string(),
    coverImageUrl: z.string().nullable(),
  }),
  sections: z.array(z.object({ id: z.string(), title: z.string() })),
  lessons: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), durationMinutes: z.number(), optional: z.boolean(), sectionId: z.string().nullable(), state: z.enum(['completed', 'in_progress', 'locked', 'available']) })),
  enrollment: z
    .object({ id: z.string(), status: z.string(), progress: z.number(), dueDate: z.string().nullable(), dueState: z.string(), currentLessonId: z.string().nullable(), certificateId: z.string().nullable(), rating: z.number().nullable(), review: z.string(), completedAt: z.string().nullable() })
    .nullable(),
  reason: z.enum(['not_enrolled', 'withdrawn', 'unpublished']).nullable(),
  resumeLessonId: z.string().nullable(),
  pathLock: z.string().nullable(),
  /** The course a sequential path is waiting on, so a locked course can link straight to it. */
  pathLockCourse: z.object({ title: z.string(), slug: z.string() }).nullable(),
  path: z.object({ id: z.string(), title: z.string(), slug: z.string(), nextCourse: z.object({ title: z.string(), slug: z.string() }).nullable() }).nullable(),
  certificate: Certificate.nullable(),
  learner: z.object({ name: z.string() }),
  academy: z.object({ organizationName: z.string(), academyName: z.string(), certificateTitle: z.string(), certificateSignatory: z.string(), certificateSignatoryTitle: z.string(), logoUrl: z.string().nullable(), brandColor: z.string() }),
  features: z.object({ discussions: z.boolean(), ai: z.boolean() }),
});

export default createEndpoint({
  description: 'The course player: outline, lesson states, enrollment and resume point for the signed-in learner',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which course?', 'BAD_REQUEST');
    const ctx = await loadPlayer(context, parsed.data.slug);
    const { course, settings, enrollment } = ctx;

    const base = {
      course: {
        id: course.id,
        title: course.title,
        slug: course.slug || course.id,
        summary: course.summary,
        objectives: course.objectives,
        status: course.status,
        sequential: course.sequential,
        certificateEnabled: course.certificateEnabled,
        estimatedMinutes: course.estimatedMinutes,
        color: course.color,
        icon: course.icon,
        coverImageUrl: course.coverImageUrl,
      },
      learner: { name: ctx.actor.name },
      academy: {
        organizationName: settings.organizationName,
        academyName: settings.academyName,
        certificateTitle: settings.certificateTitle,
        certificateSignatory: settings.certificateSignatory,
        certificateSignatoryTitle: settings.certificateSignatoryTitle,
        logoUrl: settings.logoUrl && /^https:\/\//i.test(settings.logoUrl) ? settings.logoUrl : null,
        brandColor: settings.brandColor,
      },
      features: { discussions: settings.discussionsEnabled, ai: isConfigured() },
    };

    if (ctx.reason || !enrollment) {
      return { ...base, sections: [], lessons: [], enrollment: null, reason: ctx.reason ?? 'not_enrolled', resumeLessonId: null, pathLock: null, pathLockCourse: null, path: null, certificate: null };
    }

    let path: z.infer<typeof Output>['path'] = null;
    let pathLockCourse: z.infer<typeof Output>['pathLockCourse'] = null;
    if (enrollment.pathEnrollmentId) {
      const { rows } = await zite.sql({
        query: `SELECT p.id, p."title", p."slug", p."status" FROM "PathEnrollments" pe JOIN "Paths" p ON p.id::text = pe."pathId" WHERE pe.id::text = $1 AND pe."personId" = $2 AND COALESCE(pe."status", '') <> 'Withdrawn'`,
        params: [enrollment.pathEnrollmentId, ctx.actor.id],
      });
      const p = rows[0];
      if (p && p.status !== 'Draft') {
        const courses = await loadPathCourses(String(p.id));
        const { rows: done } = await zite.sql({
          query: `SELECT c.id, c."title", c."slug", c."status", EXISTS (SELECT 1 FROM "Enrollments" e WHERE e."courseId" = c.id::text AND e."personId" = $2 AND e."status" = 'Completed') AS "isDone"
                  FROM "Courses" c WHERE c.id::text = ANY($1::text[])`,
          params: [courses.map(c => c.courseId), ctx.actor.id],
        });
        const byId = new Map(done.map(r => [String(r.id), r]));
        const next = courses.map(c => byId.get(c.courseId)).find(r => r && String(r.id) !== course.id && r.isDone !== true && r.status === 'Published');
        path = { id: String(p.id), title: str(p.title) ?? '', slug: ref(p.slug) ?? String(p.id), nextCourse: next ? { title: str(next.title) ?? '', slug: ref(next.slug) ?? String(next.id) } : null };
        if (ctx.pathLock) {
          const blocking = courses.map(c => byId.get(c.courseId)).find(r => r && str(r.title) === ctx.pathLock);
          if (blocking) pathLockCourse = { title: str(blocking.title) ?? '', slug: ref(blocking.slug) ?? String(blocking.id) };
        }
      }
    }

    const certificate = await certificateSummary(enrollment.certificateId, ctx.actor.id);

    return {
      ...base,
      sections: ctx.sections.map(s => ({ id: s.id, title: s.title })),
      lessons: ctx.lessons.map(l => ({ id: l.id, title: l.title, type: l.type, durationMinutes: num(l.durationMinutes), optional: l.optional, sectionId: l.sectionId, state: lessonStateOf(ctx, l.id) })),
      enrollment: enrollmentSummary(enrollment),
      reason: null,
      // Someone reviewing a finished course goes back to where they last were.
      resumeLessonId:
        enrollment.status === 'Completed' && enrollment.currentLessonId && ctx.lessons.some(l => l.id === enrollment.currentLessonId)
          ? enrollment.currentLessonId
          : resumeLessonId(ctx.lessons, ctx.completed, enrollment.currentLessonId, course.sequential && enrollment.status !== 'Completed'),
      pathLock: ctx.pathLock,
      pathLockCourse,
      path,
      certificate,
    };
  },
});
