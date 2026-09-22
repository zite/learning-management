import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { slugify } from '@project/shared/progress';
import { logActivity, type ActivityType } from '@project/shared/server/activity';
import { loadPathCourses, uniqueSlug } from '@project/shared/server/courses';
import { enrollInCourse } from '@project/shared/server/enroll';
import { assertStaff, getActor } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { chunked, day, eachWrite, num, str } from '@project/shared/server/sql';
import { assertCanEditPath, assertSlugAvailable, cleanUrl, nextPosition, recomputePathLearners, requirePath } from '../server/catalog-admin';

/**
 * Create a learning path, edit its details, set its courses (order and which
 * are optional), or move it through its lifecycle. A path can only be
 * published when every course in it is published, and deleted only while
 * nobody has ever been enrolled in it.
 *
 * Adding a course to a path people are already working through enrolls them
 * in it, so their path stays completable; removing one keeps their course
 * progress and recomputes the path.
 */

const CourseEntry = z.object({ courseId: z.string().min(1), optional: z.boolean().default(false) });

const Input = z.object({
  action: z.enum(['create', 'update', 'set_courses', 'publish', 'unpublish', 'archive', 'unarchive', 'delete']),
  id: z.string().optional(),
  title: z.string().max(160).optional(),
  slug: z.string().max(80).optional(),
  summary: z.string().max(400).optional(),
  description: z.string().max(20000).optional(),
  coverImageUrl: z.string().max(2000).nullable().optional(),
  icon: z.string().max(16).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour from the palette').optional(),
  categoryId: z.string().nullable().optional(),
  visibility: z.enum(['Catalog', 'Private']).optional(),
  sequential: z.boolean().optional(),
  dueDays: z.number().int().min(1, 'Use at least 1 day, or clear the due window').max(3650).nullable().optional(),
  certificateEnabled: z.boolean().optional(),
  certificateValidityMonths: z.number().int().min(1, 'Use at least 1 month, or leave it empty for no expiry').max(240).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  courses: z.array(CourseEntry).max(60).optional(),
});

const Output = z.object({
  id: z.string(),
  slug: z.string(),
  status: z.enum(['Draft', 'Published', 'Archived']),
  publishedAt: z.string().nullable(),
  deleted: z.boolean(),
  added: z.number(),
  removed: z.number(),
  newEnrollments: z.number(),
  pausedRules: z.number(),
});

type CourseRow = { id: string; title: string; status: string };

export default createEndpoint({
  description: 'Create, edit, reorder, publish, archive or delete a learning path',
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

    const loadCourses = async (ids: string[]) => {
      if (!ids.length) return new Map<string, CourseRow>();
      const { rows } = await zite.sql({ query: `SELECT id::text AS id, "title", "status" FROM "Courses" WHERE id::text = ANY($1::text[])`, params: [ids] });
      return new Map(rows.map(r => [String(r.id), { id: String(r.id), title: str(r.title) ?? '', status: str(r.status) || 'Draft' }]));
    };

    /** Write the path's course list: add, remove, reorder, toggle optional. */
    const writeCourses = async (pathId: string, pathStatus: string, entries: Array<z.infer<typeof CourseEntry>>) => {
      const seen = new Set<string>();
      const list = entries.filter(e => (seen.has(e.courseId) ? false : (seen.add(e.courseId), true)));
      const current = await loadPathCourses(pathId);
      const currentIds = new Set(current.map(c => c.courseId));
      const courses = await loadCourses(list.map(e => e.courseId));
      for (const e of list) {
        const c = courses.get(e.courseId);
        if (!c) throw new ZiteError('One of those courses no longer exists — refresh and try again', 'BAD_REQUEST');
        if (!currentIds.has(e.courseId)) {
          if (c.status === 'Archived') throw new ZiteError(`“${c.title}” is archived. Unarchive it before adding it to a path.`, 'BAD_REQUEST');
          if (pathStatus === 'Published' && c.status !== 'Published') throw new ZiteError(`Publish “${c.title}” before adding it to a published path — learners can’t take a draft.`, 'BAD_REQUEST');
        }
      }
      const byCourse = new Map(current.map(c => [c.courseId, c]));
      const toCreate: Array<Record<string, unknown>> = [];
      const toUpdate: Array<{ id: string; position: number; optional: boolean }> = [];
      for (const [i, e] of list.entries()) {
        const existing = byCourse.get(e.courseId);
        if (!existing) toCreate.push({ pathId, courseId: e.courseId, position: i + 1, optional: e.optional });
        else if (existing.position !== i + 1 || existing.optional !== e.optional) toUpdate.push({ id: existing.id, position: i + 1, optional: e.optional });
      }
      await eachWrite(toUpdate, u => zite.pathCourses.update({ id: u.id, record: { position: u.position, optional: u.optional } }));
      await chunked(toCreate, async batch => {
        await zite.pathCourses.bulkCreate({ records: batch as never });
      });
      const keep = new Set(list.map(e => e.courseId));
      const gone = current.filter(c => !keep.has(c.courseId));
      await eachWrite(gone, c => zite.pathCourses.delete({ id: c.id }));
      // Leftover rows pointing at deleted courses are invisible to loadPathCourses; clear them too.
      const { rows: orphans } = await zite.sql({ query: `SELECT pc.id FROM "PathCourses" pc WHERE pc."pathId" = $1 AND NOT EXISTS (SELECT 1 FROM "Courses" c WHERE c.id::text = pc."courseId")`, params: [pathId] });
      await eachWrite(orphans, o => zite.pathCourses.delete({ id: String(o.id) }));
      return { added: toCreate.length, removed: gone.length };
    };

    /** Enroll people already working through the path in any published course of it they aren't in yet. */
    const syncLearners = async (pathId: string) => {
      const { rows } = await zite.sql({
        query: `SELECT pe.id AS "pathEnrollmentId", pe."personId", pe."dueDate", pc."courseId"
                FROM "PathEnrollments" pe
                JOIN "PathCourses" pc ON pc."pathId" = pe."pathId"
                JOIN "Courses" c ON c.id::text = pc."courseId"
                JOIN "People" pp ON pp.id::text = pe."personId"
                WHERE pe."pathId" = $1 AND COALESCE(pe."status", '') NOT IN ('Withdrawn', 'Completed') AND c."status" = 'Published' AND COALESCE(pp."status", '') <> 'Deactivated'
                  -- New to the course: enroll. Already taking it outside the path: link it (enrollInCourse fills the gap).
                  -- Linked already, or withdrawn from it on purpose: leave alone.
                  AND NOT EXISTS (SELECT 1 FROM "Enrollments" e WHERE e."personId" = pe."personId" AND e."courseId" = pc."courseId" AND (COALESCE(e."pathEnrollmentId", '') <> '' OR e."status" = 'Withdrawn'))`,
        params: [pathId],
      });
      let created = 0;
      if (rows.length) {
        const settings = await getSettings();
        for (const r of rows) {
          const res = await enrollInCourse({ courseId: String(r.courseId), personIds: [String(r.personId)], source: 'Path', assignedById: actor.id, dueDate: day(r.dueDate), pathEnrollmentId: String(r.pathEnrollmentId), notify: false, settings });
          created += res.created.length;
        }
      }
      await recomputePathLearners(pathId);
      return created;
    };

    const empty = { deleted: false, added: 0, removed: 0, newEnrollments: 0, pausedRules: 0 };

    if (p.action === 'create') {
      const title = (p.title ?? '').trim();
      if (!title) throw new ZiteError('Give the path a title', 'BAD_REQUEST');
      const slug = await uniqueSlug('Paths', slugify(title) || 'path');
      const created = await zite.paths.create({
        record: {
          title,
          slug,
          summary: (p.summary ?? '').trim() || null,
          description: null,
          coverImageUrl: null,
          icon: p.icon || '🧭',
          color: p.color || '#2f6b55',
          categoryId: p.categoryId || null,
          status: 'Draft',
          visibility: 'Catalog',
          ownerId: actor.id,
          sequential: p.sequential ?? true,
          dueDays: null,
          certificateEnabled: true,
          certificateValidityMonths: null,
          publishedAt: null,
          position: await nextPosition('Paths'),
        },
      });
      const counts = p.courses?.length ? await writeCourses(created.id, 'Draft', p.courses) : { added: 0, removed: 0 };
      return { id: created.id, slug, status: 'Draft', publishedAt: null, ...empty, added: counts.added };
    }

    if (!p.id) throw new ZiteError('Which learning path?', 'BAD_REQUEST');
    const path = await requirePath(p.id);
    assertCanEditPath(actor, path);
    const base = { id: path.id, slug: path.slug, status: path.status, publishedAt: path.publishedAt, ...empty };
    const log = (type: string, data: Record<string, unknown> = {}) => logActivity({ type: type as ActivityType, actorId: actor.id, pathId: path.id, data: { pathTitle: path.title, ...data } });

    switch (p.action) {
      case 'update': {
        const record: Record<string, unknown> = {};
        if (p.title !== undefined) {
          const title = p.title.trim();
          if (!title) throw new ZiteError('A learning path needs a title', 'BAD_REQUEST');
          record.title = title;
        }
        if (p.slug !== undefined) {
          const slug = p.slug.trim().toLowerCase();
          if (slug !== path.slug) {
            await assertSlugAvailable('Paths', slug, path.id);
            record.slug = slug;
          }
        }
        if (p.summary !== undefined) record.summary = p.summary.trim() || null;
        if (p.description !== undefined) record.description = p.description.trim() ? p.description : null;
        if (p.coverImageUrl !== undefined) record.coverImageUrl = cleanUrl(p.coverImageUrl);
        if (p.icon !== undefined) record.icon = p.icon.trim() || '🧭';
        if (p.color !== undefined) record.color = p.color;
        if (p.categoryId !== undefined) {
          if (p.categoryId) {
            const { rows } = await zite.sql({ query: `SELECT 1 FROM "Categories" WHERE id::text = $1`, params: [p.categoryId] });
            if (!rows.length) throw new ZiteError('That category no longer exists', 'BAD_REQUEST');
          }
          record.categoryId = p.categoryId || null;
        }
        if (p.visibility !== undefined) record.visibility = p.visibility;
        if (p.sequential !== undefined) record.sequential = p.sequential;
        if (p.dueDays !== undefined) record.dueDays = p.dueDays;
        if (p.certificateEnabled !== undefined) record.certificateEnabled = p.certificateEnabled;
        if (p.certificateValidityMonths !== undefined) record.certificateValidityMonths = p.certificateValidityMonths;
        if (p.ownerId !== undefined && (p.ownerId || null) !== path.ownerId) {
          if (actor.role !== 'Admin') throw new ZiteError('Only admins can change who owns a learning path', 'FORBIDDEN');
          if (p.ownerId) {
            const { rows } = await zite.sql({ query: `SELECT "role", "status" FROM "People" WHERE id::text = $1`, params: [p.ownerId] });
            if (!rows[0]) throw new ZiteError('That person no longer exists', 'BAD_REQUEST');
            if (rows[0].role !== 'Admin' && rows[0].role !== 'Instructor') throw new ZiteError('Path owners need to be instructors or admins', 'BAD_REQUEST');
          }
          record.ownerId = p.ownerId || null;
        }
        if (Object.keys(record).length) await zite.paths.update({ id: path.id, record: record as never });
        return { ...base, slug: (record.slug as string | undefined) ?? path.slug };
      }

      case 'set_courses': {
        if (!p.courses) throw new ZiteError('Which courses?', 'BAD_REQUEST');
        if (!p.courses.length && path.status === 'Published') throw new ZiteError('A published path needs at least one course. Unpublish it first to empty it.', 'BAD_REQUEST');
        const { added, removed } = await writeCourses(path.id, path.status, p.courses);
        const newEnrollments = added || removed ? await syncLearners(path.id) : 0;
        return { ...base, added, removed, newEnrollments };
      }

      case 'publish': {
        if (path.status === 'Published') return base;
        const courses = await loadPathCourses(path.id);
        if (!courses.length) throw new ZiteError('Add at least one course before publishing the path', 'BAD_REQUEST');
        const info = await loadCourses(courses.map(c => c.courseId));
        const unpublished = courses.map(c => info.get(c.courseId)).filter(c => c && c.status !== 'Published') as CourseRow[];
        if (unpublished.length) {
          const names = unpublished.slice(0, 4).map(c => `“${c.title}”`).join(', ');
          throw new ZiteError(`Publish ${unpublished.length === 1 ? 'this course' : 'these courses'} first: ${names}${unpublished.length > 4 ? ` and ${unpublished.length - 4} more` : ''}. Learners can only take published courses.`, 'BAD_REQUEST');
        }
        await zite.paths.update({ id: path.id, record: { status: 'Published', publishedAt: path.publishedAt ?? now } });
        await log('path_published');
        const newEnrollments = await syncLearners(path.id);
        return { ...base, status: 'Published', publishedAt: path.publishedAt ?? now, newEnrollments };
      }

      case 'unpublish': {
        if (path.status !== 'Published') throw new ZiteError('Only a published path can be unpublished', 'BAD_REQUEST');
        await zite.paths.update({ id: path.id, record: { status: 'Draft' } });
        await log('path_unpublished');
        return { ...base, status: 'Draft' };
      }

      case 'archive': {
        if (path.status === 'Archived') return base;
        await zite.paths.update({ id: path.id, record: { status: 'Archived' } });
        const { rows: rules } = await zite.sql({ query: `SELECT id FROM "AssignmentRules" WHERE "targetType" = 'Path' AND "pathId" = $1 AND "status" = 'Active'`, params: [path.id] });
        await eachWrite(rules, r => zite.assignmentRules.update({ id: String(r.id), record: { status: 'Paused' } }));
        await log('path_archived', { pausedRules: rules.length });
        return { ...base, status: 'Archived', pausedRules: rules.length };
      }

      case 'unarchive': {
        if (path.status !== 'Archived') return base;
        let status: 'Draft' | 'Published' = path.publishedAt ? 'Published' : 'Draft';
        if (status === 'Published') {
          const courses = await loadPathCourses(path.id);
          const info = await loadCourses(courses.map(c => c.courseId));
          if (!courses.length || courses.some(c => info.get(c.courseId)?.status !== 'Published')) status = 'Draft';
        }
        await zite.paths.update({ id: path.id, record: { status } });
        await log('path_unarchived', { status });
        return { ...base, status };
      }

      case 'delete': {
        const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "enrolledTotal" FROM "PathEnrollments" WHERE "pathId" = $1`, params: [path.id] });
        const enrolled = num(rows[0]?.enrolledTotal);
        if (enrolled) {
          throw new ZiteError(`“${path.title}” has ${enrolled} enrollment${enrolled === 1 ? '' : 's'}, so deleting it would erase training records. Archive it instead — it leaves the catalog and lists, and its history is kept.`, 'CONFLICT');
        }
        const { rows: pcs } = await zite.sql({ query: `SELECT id FROM "PathCourses" WHERE "pathId" = $1`, params: [path.id] });
        await eachWrite(pcs, r => zite.pathCourses.delete({ id: String(r.id) }));
        const { rows: rules } = await zite.sql({ query: `SELECT id FROM "AssignmentRules" WHERE "targetType" = 'Path' AND "pathId" = $1`, params: [path.id] });
        await eachWrite(rules, r => zite.assignmentRules.delete({ id: String(r.id) }));
        await zite.paths.delete({ id: path.id });
        await log('path_deleted');
        return { ...base, deleted: true };
      }

      default:
        throw new ZiteError('Unknown action', 'BAD_REQUEST');
    }
  },
});
