import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { slugify } from '@project/shared/progress';
import { logActivity, type ActivityType } from '@project/shared/server/activity';
import { uniqueSlug } from '@project/shared/server/courses';
import { assertCanEditCourse, assertStaff, getActor } from '@project/shared/server/people';
import { eachWrite, num, withRetry } from '@project/shared/server/sql';
import { assertSlugAvailable, cleanList, cleanUrl, deleteWhere, describeProblems, nextPosition, pathIdsContaining, publishProblems, recomputePathLearners, requireCourse } from '../server/catalog-admin';

/**
 * Create a course, change any of its details, or move it through its
 * lifecycle: publish (only when every lesson can be finished), unpublish,
 * archive, unarchive, and delete (only while nobody has ever enrolled).
 */

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;

const Input = z.object({
  action: z.enum(['create', 'update', 'publish', 'unpublish', 'archive', 'unarchive', 'delete']),
  id: z.string().optional(),
  title: z.string().max(160).optional(),
  slug: z.string().max(80).optional(),
  summary: z.string().max(400).optional(),
  description: z.string().max(20000).optional(),
  objectives: z.array(z.string().max(300)).max(30).optional(),
  skills: z.array(z.string().max(60)).max(30).optional(),
  coverImageUrl: z.string().max(2000).nullable().optional(),
  icon: z.string().max(16).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour from the palette').optional(),
  categoryId: z.string().nullable().optional(),
  level: z.enum(LEVELS).optional(),
  visibility: z.enum(['Catalog', 'Private']).optional(),
  sequential: z.boolean().optional(),
  dueDays: z.number().int().min(1, 'Use at least 1 day, or clear the due window').max(3650).nullable().optional(),
  certificateEnabled: z.boolean().optional(),
  certificateValidityMonths: z.number().int().min(1, 'Use at least 1 month, or leave it empty for no expiry').max(240).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  instructorIds: z.array(z.string()).max(50).optional(),
});

const Output = z.object({
  id: z.string(),
  slug: z.string(),
  status: z.enum(['Draft', 'Published', 'Archived']),
  publishedAt: z.string().nullable(),
  deleted: z.boolean(),
  pausedRules: z.number(),
});

export default createEndpoint({
  description: 'Create, edit, publish, unpublish, archive or delete a course',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const p = parsed.data;
    const now = new Date().toISOString();

    const personExists = async (id: string) => {
      const { rows } = await zite.sql({ query: `SELECT "role", "status" FROM "People" WHERE id::text = $1`, params: [id] });
      return rows[0] as { role?: string; status?: string } | undefined;
    };
    const categoryOk = async (id: string | null | undefined) => {
      if (!id) return true;
      const { rows } = await zite.sql({ query: `SELECT 1 FROM "Categories" WHERE id::text = $1`, params: [id] });
      return rows.length > 0;
    };

    if (p.action === 'create') {
      const title = (p.title ?? '').trim();
      if (!title) throw new ZiteError('Give the course a title', 'BAD_REQUEST');
      if (!(await categoryOk(p.categoryId))) throw new ZiteError('That category no longer exists', 'BAD_REQUEST');
      const slug = await uniqueSlug('Courses', slugify(title) || 'course');
      const created = await zite.courses.create({
        record: {
          title,
          slug,
          summary: (p.summary ?? '').trim() || null,
          description: null,
          objectives: JSON.stringify([]),
          skills: JSON.stringify([]),
          icon: p.icon || '📘',
          color: p.color || '#2f6b55',
          categoryId: p.categoryId || null,
          level: p.level ?? 'Beginner',
          status: 'Draft',
          visibility: 'Catalog',
          ownerId: actor.id,
          instructorIds: JSON.stringify([]),
          sequential: false,
          estimatedMinutes: 0,
          dueDays: null,
          certificateEnabled: true,
          certificateValidityMonths: null,
          publishedAt: null,
          position: await nextPosition('Courses'),
        },
      });
      await logActivity({ type: 'course_created', actorId: actor.id, courseId: created.id, data: { courseTitle: title } });
      return { id: created.id, slug, status: 'Draft', publishedAt: null, deleted: false, pausedRules: 0 };
    }

    if (!p.id) throw new ZiteError('Which course?', 'BAD_REQUEST');
    const course = await requireCourse(p.id);
    assertCanEditCourse(actor, course);
    const result = (patch: Partial<z.infer<typeof Output>> = {}) => ({ id: course.id, slug: course.slug, status: course.status, publishedAt: course.publishedAt, deleted: false, pausedRules: 0, ...patch });
    const log = (type: string, data: Record<string, unknown> = {}) => logActivity({ type: type as ActivityType, actorId: actor.id, courseId: course.id, data: { courseTitle: course.title, ...data } });

    switch (p.action) {
      case 'update': {
        const record: Record<string, unknown> = {};
        if (p.title !== undefined) {
          const title = p.title.trim();
          if (!title) throw new ZiteError('A course needs a title', 'BAD_REQUEST');
          record.title = title;
        }
        if (p.slug !== undefined) {
          const slug = p.slug.trim().toLowerCase();
          if (slug !== course.slug) {
            await assertSlugAvailable('Courses', slug, course.id);
            record.slug = slug;
          }
        }
        if (p.summary !== undefined) record.summary = p.summary.trim() || null;
        if (p.description !== undefined) record.description = p.description.trim() ? p.description : null;
        if (p.objectives !== undefined) record.objectives = JSON.stringify(cleanList(p.objectives, 30, 300));
        if (p.skills !== undefined) record.skills = JSON.stringify([...new Set(cleanList(p.skills, 30, 60))]);
        if (p.coverImageUrl !== undefined) record.coverImageUrl = cleanUrl(p.coverImageUrl);
        if (p.icon !== undefined) record.icon = p.icon.trim() || '📘';
        if (p.color !== undefined) record.color = p.color;
        if (p.categoryId !== undefined) {
          if (!(await categoryOk(p.categoryId))) throw new ZiteError('That category no longer exists', 'BAD_REQUEST');
          record.categoryId = p.categoryId || null;
        }
        if (p.level !== undefined) record.level = p.level;
        if (p.visibility !== undefined) record.visibility = p.visibility;
        if (p.sequential !== undefined) record.sequential = p.sequential;
        if (p.dueDays !== undefined) record.dueDays = p.dueDays;
        if (p.certificateEnabled !== undefined) record.certificateEnabled = p.certificateEnabled;
        if (p.certificateValidityMonths !== undefined) record.certificateValidityMonths = p.certificateValidityMonths;
        if (p.ownerId !== undefined && (p.ownerId || null) !== course.ownerId) {
          if (actor.role !== 'Admin') throw new ZiteError('Only admins can change who owns a course', 'FORBIDDEN');
          if (p.ownerId) {
            const owner = await personExists(p.ownerId);
            if (!owner) throw new ZiteError('That person no longer exists', 'BAD_REQUEST');
            if (owner.role !== 'Admin' && owner.role !== 'Instructor') throw new ZiteError('Course owners need to be instructors or admins', 'BAD_REQUEST');
            if (owner.status === 'Deactivated') throw new ZiteError('That person has been deactivated', 'BAD_REQUEST');
          }
          record.ownerId = p.ownerId || null;
        }
        if (p.instructorIds !== undefined) {
          const ids = [...new Set(p.instructorIds.filter(Boolean))];
          if (ids.length) {
            const { rows } = await zite.sql({ query: `SELECT id::text AS id FROM "People" WHERE id::text = ANY($1::text[]) AND "role" IN ('Admin', 'Instructor')`, params: [ids] });
            const valid = new Set(rows.map(r => String(r.id)));
            const bad = ids.filter(id => !valid.has(id));
            if (bad.length) throw new ZiteError('Instructors need to be staff — make them an instructor in People first', 'BAD_REQUEST');
          }
          record.instructorIds = JSON.stringify(ids);
        }
        if (!Object.keys(record).length) return result();
        await zite.courses.update({ id: course.id, record: record as never });
        return result({ slug: (record.slug as string | undefined) ?? course.slug });
      }

      case 'publish': {
        if (course.status === 'Published') return result();
        const { lessonCount, problems } = await publishProblems(course.id);
        if (!lessonCount) throw new ZiteError('Add at least one lesson before publishing', 'BAD_REQUEST');
        if (problems.length) throw new ZiteError(describeProblems(problems), 'BAD_REQUEST');
        await zite.courses.update({ id: course.id, record: { status: 'Published', publishedAt: course.publishedAt ?? now } });
        await log('course_published');
        return result({ status: 'Published', publishedAt: course.publishedAt ?? now });
      }

      case 'unpublish': {
        if (course.status !== 'Published') throw new ZiteError('Only a published course can be unpublished', 'BAD_REQUEST');
        await zite.courses.update({ id: course.id, record: { status: 'Draft' } });
        await log('course_unpublished');
        return result({ status: 'Draft' });
      }

      case 'archive': {
        if (course.status === 'Archived') return result();
        await zite.courses.update({ id: course.id, record: { status: 'Archived' } });
        // Rules can't enroll anyone into an archived course; pause them so a scheduled run doesn't fail.
        const { rows: rules } = await zite.sql({ query: `SELECT id FROM "AssignmentRules" WHERE "targetType" = 'Course' AND "courseId" = $1 AND "status" = 'Active'`, params: [course.id] });
        await eachWrite(rules, r => zite.assignmentRules.update({ id: String(r.id), record: { status: 'Paused' } }));
        await log('course_archived', { pausedRules: rules.length });
        return result({ status: 'Archived', pausedRules: rules.length });
      }

      case 'unarchive': {
        if (course.status !== 'Archived') return result();
        // A course that was live before comes back live; one that never was comes back as a draft.
        const status = course.publishedAt ? 'Published' : 'Draft';
        if (status === 'Published') {
          const { lessonCount, problems } = await publishProblems(course.id);
          if (!lessonCount || problems.length) {
            await zite.courses.update({ id: course.id, record: { status: 'Draft' } });
            await log('course_unarchived', { status: 'Draft' });
            return result({ status: 'Draft' });
          }
        }
        await zite.courses.update({ id: course.id, record: { status } });
        await log('course_unarchived', { status });
        return result({ status });
      }

      case 'delete': {
        const { rows } = await zite.sql({
          query: `SELECT (SELECT COUNT(*) FROM "Enrollments" WHERE "courseId" = $1) AS "enrollmentTotal", (SELECT COUNT(*) FROM "Certificates" WHERE "courseId" = $1) AS "certificateTotal"`,
          params: [course.id],
        });
        const enrollments = num(rows[0]?.enrollmentTotal);
        const certificates = num(rows[0]?.certificateTotal);
        if (enrollments || certificates) {
          throw new ZiteError(
            `“${course.title}” has ${enrollments ? `${enrollments} enrollment${enrollments === 1 ? '' : 's'}` : `${certificates} certificate${certificates === 1 ? '' : 's'}`}, so deleting it would erase training records. Archive it instead — it disappears from the catalog and lists, and its history is kept.`,
            'CONFLICT',
          );
        }
        const paths = await pathIdsContaining(course.id);
        const { rows: sessions } = await zite.sql({ query: `SELECT id FROM "Sessions" WHERE "courseId" = $1`, params: [course.id] });
        for (const s of sessions) await deleteWhere('Registrations', zite.registrations, 'sessionId', String(s.id));
        await deleteWhere('Sessions', zite.sessions, 'courseId', course.id);
        await deleteWhere('Comments', zite.comments, 'courseId', course.id);
        await deleteWhere('Lessons', zite.lessons, 'courseId', course.id);
        await deleteWhere('Sections', zite.sections, 'courseId', course.id);
        await deleteWhere('PathCourses', zite.pathCourses, 'courseId', course.id);
        const { rows: rules } = await zite.sql({ query: `SELECT id FROM "AssignmentRules" WHERE "targetType" = 'Course' AND "courseId" = $1`, params: [course.id] });
        await eachWrite(rules, r => zite.assignmentRules.delete({ id: String(r.id) }));
        await withRetry(() => zite.courses.delete({ id: course.id }));
        for (const pathId of paths) await recomputePathLearners(pathId);
        await log('course_deleted');
        return result({ deleted: true });
      }

      default:
        throw new ZiteError('Unknown action', 'BAD_REQUEST');
    }
  },
});
