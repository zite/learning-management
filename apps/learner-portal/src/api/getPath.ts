import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getLearner } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { ref, str } from '@project/shared/server/sql';
import { COURSE_CARD_COLUMNS, COURSE_CARD_JOIN, loadMyPathEnrollments, loadPathCourseStates, PATH_CARD_COLUMNS, PATH_CARD_JOIN, pathCourseStates, toCourseCard, toPathCard, type CourseCard, type MyPathEnrollment, type PathCard, type PathCourseState } from '../server/learn';

/**
 * A learning path: its courses in order, where the learner is in each, and
 * which are still locked behind an earlier course. Drafts are never visible;
 * private and archived paths only to people enrolled in them.
 */

const Input = z.object({ slug: z.string().min(1).max(200) });

export type PathStep = PathCourseState & { course: CourseCard; linkable: boolean };

export type PathOutput = {
  path: PathCard & { description: string };
  steps: PathStep[];
  mine: (Omit<MyPathEnrollment, 'path' | 'courses'> & { ruleName: string | null }) | null;
  canSelfEnroll: boolean;
  selfEnrollment: boolean;
};

function withoutPath(m: MyPathEnrollment): Omit<MyPathEnrollment, 'path' | 'courses'> {
  const copy: Partial<MyPathEnrollment> = { ...m };
  delete copy.path;
  delete copy.courses;
  return copy as Omit<MyPathEnrollment, 'path' | 'courses'>;
}

async function loadRuleName(pathEnrollmentId: string) {
  const { rows } = await zite.sql({
    query: `SELECT ru."name" FROM "PathEnrollments" pe JOIN "AssignmentRules" ru ON ru.id::text = pe."ruleId" WHERE pe.id::text = $1 LIMIT 1`,
    params: [pathEnrollmentId],
  });
  return ref(rows[0]?.name);
}

export default createEndpoint({
  description: 'A learning path for the learner',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<PathOutput> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('That link is missing the learning path.', 'BAD_REQUEST');
    const settings = await getSettings();
    const actor = await getLearner(context, settings);
    const notFound = new ZiteError("We couldn't find that learning path. It may have been unpublished, or the link may be mistyped.", 'NOT_FOUND');

    const { rows } = await zite.sql({
      query: `SELECT ${PATH_CARD_COLUMNS}, p."description" FROM "Paths" p ${PATH_CARD_JOIN}
              WHERE p.id::text = $1 OR (COALESCE(p."slug", '') <> '' AND p."slug" = $1)
              ORDER BY CASE WHEN p.id::text = $1 THEN 0 ELSE 1 END LIMIT 1`,
      params: [parsed.data.slug],
    });
    const row = rows[0];
    if (!row || row.status === 'Draft') throw notFound;
    const path = toPathCard(row);

    const [mine] = await loadMyPathEnrollments(actor.id, { pathId: path.id });
    if (!mine && (path.visibility !== 'Catalog' || path.status !== 'Published')) throw notFound;

    // The rule that assigned it, so the page can say why it's required.
    const ruleName = mine?.source === 'Automatic' ? await loadRuleName(mine.id) : null;

    const list = mine ? null : (await loadPathCourseStates([path.id], actor.id)).get(path.id) ?? [];
    const states = mine ? mine.courses : pathCourseStates(list ?? [], path.sequential);

    const { rows: courseRows } = states.length
      ? await zite.sql({ query: `SELECT ${COURSE_CARD_COLUMNS} FROM "Courses" c ${COURSE_CARD_JOIN} WHERE c.id::text = ANY($1::text[])`, params: [states.map(s => s.courseId)] })
      : { rows: [] as Array<Record<string, unknown>> };
    const cards = new Map(courseRows.map(r => [String(r.id), toCourseCard(r)]));

    const steps: PathStep[] = states
      .filter(s => cards.has(s.courseId))
      .map(s => {
        const course = cards.get(s.courseId)!;
        // A private course opens only for people already enrolled in it.
        const linkable = course.status !== 'Draft' && (s.status != null || (course.visibility === 'Catalog' && course.status === 'Published'));
        return { ...s, course, linkable };
      });

    return {
      path: { ...path, description: str(row.description) ?? '' },
      steps,
      mine: mine ? { ...withoutPath(mine), ruleName } : null,
      canSelfEnroll: settings.selfEnrollment && path.status === 'Published' && path.visibility === 'Catalog' && !mine && steps.length > 0,
      selfEnrollment: settings.selfEnrollment,
    };
  },
});
