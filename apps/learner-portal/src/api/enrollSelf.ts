import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { loadCourse, loadPath } from '@project/shared/server/courses';
import { enrollInCourse, enrollInPath, findActiveEnrollment } from '@project/shared/server/enroll';
import { getLearner } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';

/**
 * A learner enrolls themselves in a catalog course or path. Only published
 * Catalog items qualify, and only while the organization has self-enrollment
 * on. Enrolling twice is harmless: it returns the enrollment they already have.
 */

const Input = z.object({ courseId: z.string().min(1).max(200).optional(), pathId: z.string().min(1).max(200).optional() }).refine(v => Boolean(v.courseId) !== Boolean(v.pathId), 'Choose a course or a path');

export type EnrollSelfOutput = { kind: 'course' | 'path'; enrollmentId: string; slug: string; title: string; alreadyEnrolled: boolean };

export default createEndpoint({
  description: 'Enroll yourself in a catalog course or path',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<EnrollSelfOutput> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Choose a course or a learning path to enroll in.', 'BAD_REQUEST');
    const settings = await getSettings();
    const actor = await getLearner(context, settings);
    // Checked after "already enrolled", so asking twice stays harmless even with self-enrollment off.
    const assertOpen = () => {
      if (!settings.selfEnrollment) throw new ZiteError(`${settings.academyName} assigns training rather than letting people enroll themselves. Ask your manager if you'd like to take this.`, 'FORBIDDEN');
    };

    if (parsed.data.courseId) {
      const course = await loadCourse(parsed.data.courseId);
      if (!course || course.status === 'Draft') throw new ZiteError("We couldn't find that course.", 'NOT_FOUND');
      const slug = course.slug || course.id;
      const existing = await findActiveEnrollment(actor.id, course.id);
      if (existing) return { kind: 'course', enrollmentId: existing.id, slug, title: course.title, alreadyEnrolled: true };
      assertOpen();
      if (course.visibility !== 'Catalog') throw new ZiteError("We couldn't find that course.", 'NOT_FOUND');
      if (course.status !== 'Published') throw new ZiteError(`“${course.title}” is no longer open for enrollment.`, 'BAD_REQUEST');
      const result = await enrollInCourse({ courseId: course.id, personIds: [actor.id], source: 'Self-enrolled', assignedById: null, dueDate: null, notify: false, settings });
      const enrollmentId = result.created[0] ?? result.reactivated[0] ?? (await findActiveEnrollment(actor.id, course.id))?.id;
      if (!enrollmentId) throw new ZiteError("You couldn't be enrolled just now. Try again in a moment.", 'CONFLICT');
      return { kind: 'course', enrollmentId, slug, title: course.title, alreadyEnrolled: false };
    }

    const path = await loadPath(parsed.data.pathId!);
    if (!path || path.status === 'Draft') throw new ZiteError("We couldn't find that learning path.", 'NOT_FOUND');
    const slug = path.slug || path.id;
    const latest = async () => {
      const { rows } = await zite.sql({
        query: `SELECT id::text AS id FROM "PathEnrollments" WHERE "personId" = $1 AND "pathId" = $2 AND COALESCE("status", '') <> 'Withdrawn' ORDER BY COALESCE("cycle", 1) DESC, created_at DESC LIMIT 1`,
        params: [actor.id, path.id],
      });
      return rows[0] ? String(rows[0].id) : null;
    };
    const existing = await latest();
    if (existing) return { kind: 'path', enrollmentId: existing, slug, title: path.title, alreadyEnrolled: true };
    assertOpen();
    if (path.visibility !== 'Catalog') throw new ZiteError("We couldn't find that learning path.", 'NOT_FOUND');
    if (path.status !== 'Published') throw new ZiteError(`“${path.title}” is no longer open for enrollment.`, 'BAD_REQUEST');
    const result = await enrollInPath({ pathId: path.id, personIds: [actor.id], source: 'Self-enrolled', assignedById: null, dueDate: null, notify: false, settings });
    const enrollmentId = result.created[0] ?? result.reactivated[0] ?? (await latest());
    if (!enrollmentId) throw new ZiteError("You couldn't be enrolled just now. Try again in a moment.", 'CONFLICT');
    return { kind: 'path', enrollmentId, slug, title: path.title, alreadyEnrolled: false };
  },
});
