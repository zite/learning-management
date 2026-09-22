import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { LessonType } from '@project/shared/lessons';
import { asEnrollmentStatus, lockedLessonIds, parseIdList, parseStringList, type EnrollmentStatus } from '@project/shared/progress';
import { getLearner } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { bool, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { COURSE_CARD_COLUMNS, COURSE_CARD_JOIN, httpsOrNull, jsonRows, loadMyEnrollments, loadOutlines, publicName, toCourseCard, validColor, type CourseCard, type MyEnrollment } from '../server/learn';

/**
 * A course's overview page: what it covers, how long it takes, what people
 * thought of it, and where the learner stands. Lesson content isn't included —
 * that's the player's job, behind enrollment.
 *
 * Drafts are never visible. Private (assigned-only) and archived courses are
 * visible only to people enrolled in them; everyone else gets "not found", so
 * the page doesn't confirm the course exists.
 */

const Input = z.object({ slug: z.string().min(1).max(200) });

export type OverviewLesson = { id: string; title: string; type: LessonType; durationMinutes: number; optional: boolean; done: boolean; locked: boolean };
export type OverviewSection = { id: string | null; title: string; description: string; lessons: OverviewLesson[] };
export type OverviewSession = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string;
  meetingUrl: string | null;
  capacity: number | null;
  spotsLeft: number | null;
  lessonId: string | null;
  lessonTitle: string | null;
  registrationStatus: string | null;
};

export type CourseOverviewOutput = {
  course: CourseCard & { description: string; objectives: string[]; skills: string[]; publishedAt: string | null };
  instructors: Array<{ id: string; name: string; title: string | null; color: string; avatarUrl: string | null; bio: string; owner: boolean }>;
  sections: OverviewSection[];
  rating: { average: number | null; count: number; distribution: number[] };
  reviews: Array<{ id: string; name: string; color: string; rating: number; review: string; ratedAt: string | null }>;
  mine: MyEnrollment | null;
  canSelfEnroll: boolean;
  selfEnrollment: boolean;
  paths: Array<{ id: string; slug: string; title: string; icon: string; color: string; coverImageUrl: string | null; sequential: boolean; courseCount: number; myStatus: EnrollmentStatus | null }>;
  sessions: OverviewSession[];
};

export default createEndpoint({
  description: 'A course overview for the learner',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<CourseOverviewOutput> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('That link is missing the course.', 'BAD_REQUEST');
    const settings = await getSettings();
    const actor = await getLearner(context, settings);

    const { rows } = await zite.sql({
      query: `SELECT ${COURSE_CARD_COLUMNS}, c."description", c."objectives", c."skills", c."ownerId", c."instructorIds", c."publishedAt",
                (SELECT string_agg(COALESCE(r."rating", 0)::int::text, ',') FROM "Enrollments" r WHERE r."courseId" = c.id::text AND r."rating" > 0) AS "ratingList"
              FROM "Courses" c ${COURSE_CARD_JOIN}
              WHERE c.id::text = $1 OR (COALESCE(c."slug", '') <> '' AND c."slug" = $1)
              ORDER BY CASE WHEN c.id::text = $1 THEN 0 ELSE 1 END LIMIT 1`,
      params: [parsed.data.slug],
    });
    const row = rows[0];
    const notFound = new ZiteError("We couldn't find that course. It may have been unpublished, or the link may be mistyped.", 'NOT_FOUND');
    if (!row || row.status === 'Draft') throw notFound;
    const card = toCourseCard(row);

    const outlines = await loadOutlines([card.id]);
    const [mine] = await loadMyEnrollments(actor.id, { courseId: card.id, outlines });
    if (!mine && (card.visibility !== 'Catalog' || card.status !== 'Published')) throw notFound;

    const ownerId = ref(row.ownerId);
    const staffIds = [...new Set([ownerId, ...parseIdList(row.instructorIds)].filter(Boolean) as string[])];
    const { rows: extraRows } = await zite.sql({
      query: `SELECT
        (SELECT json_agg(t)::text FROM (
          SELECT p.id::text AS id, p."name", p."title", p."color", p."avatarUrl", p."bio" FROM "People" p
          WHERE p.id::text = ANY($2::text[]) AND COALESCE(p."status", '') <> 'Deactivated'
        ) t) AS "instructorsJson",
        (SELECT json_agg(t)::text FROM (
          SELECT e.id::text AS id, p."name", p."color", e."rating", e."review", e."ratedAt" FROM "Enrollments" e
          JOIN "People" p ON p.id::text = e."personId"
          WHERE e."courseId" = $1 AND e."rating" > 0 AND COALESCE(TRIM(e."review"), '') <> ''
          ORDER BY e."ratedAt" DESC NULLS LAST, e.updated_at DESC LIMIT 6
        ) t) AS "reviewsJson",
        (SELECT json_agg(t)::text FROM (
          SELECT pa.id::text AS id, pa."slug", pa."title", pa."icon", pa."color", pa."coverImageUrl", pa."sequential",
            (SELECT COUNT(*) FROM "PathCourses" x WHERE x."pathId" = pa.id::text) AS "courseTotal",
            mine."status" AS "myStatus"
          FROM "Paths" pa
          LEFT JOIN LATERAL (
            SELECT pe."status" FROM "PathEnrollments" pe WHERE pe."pathId" = pa.id::text AND pe."personId" = $3 AND COALESCE(pe."status", '') <> 'Withdrawn'
            ORDER BY COALESCE(pe."cycle", 1) DESC, pe.created_at DESC LIMIT 1
          ) mine ON true
          WHERE pa."status" = 'Published' AND EXISTS (SELECT 1 FROM "PathCourses" pc WHERE pc."pathId" = pa.id::text AND pc."courseId" = $1)
            AND (pa."visibility" = 'Catalog' OR mine."status" IS NOT NULL)
          ORDER BY COALESCE(pa."position", 0) ASC, pa."title" ASC
        ) t) AS "pathsJson",
        (SELECT json_agg(t)::text FROM (
          SELECT s.id::text AS id, s."title", s."startsAt", s."endsAt", s."location", s."meetingUrl", s."capacity", s."lessonId", l."title" AS "lessonTitle",
            (SELECT COUNT(*) FROM "Registrations" r WHERE r."sessionId" = s.id::text AND r."status" IN ('Registered', 'Attended')) AS "takenTotal",
            (SELECT r."status" FROM "Registrations" r WHERE r."sessionId" = s.id::text AND r."personId" = $3 ORDER BY r.created_at DESC LIMIT 1) AS "myRegistration"
          FROM "Sessions" s
          LEFT JOIN "Lessons" l ON l.id::text = s."lessonId"
          WHERE s."courseId" = $1 AND COALESCE(s."status", '') <> 'Cancelled' AND COALESCE(s."endsAt", s."startsAt") > NOW()
          ORDER BY s."startsAt" ASC LIMIT 6
        ) t) AS "sessionsJson"`,
      params: [card.id, staffIds, actor.id],
    });
    const x = extraRows[0] ?? {};

    const outline = outlines.get(card.id) ?? { sections: [], lessons: [] };
    const done = new Set(mine?.completedLessonIds ?? []);
    const locked = mine ? lockedLessonIds(outline.lessons, done, card.sequential) : new Set<string>();
    const toLesson = (l: (typeof outline.lessons)[number]): OverviewLesson => ({ id: l.id, title: l.title, type: l.type, durationMinutes: l.durationMinutes, optional: l.optional, done: done.has(l.id), locked: locked.has(l.id) });
    const loose = outline.lessons.filter(l => !l.sectionId);
    const sections: OverviewSection[] = [
      ...(loose.length ? [{ id: null, title: '', description: '', lessons: loose.map(toLesson) }] : []),
      ...outline.sections.map(s => ({ id: s.id, title: s.title, description: s.description, lessons: outline.lessons.filter(l => l.sectionId === s.id).map(toLesson) })),
    ];

    const ratings = String(row.ratingList ?? '')
      .split(',')
      .map(Number)
      .filter(n => n >= 1 && n <= 5);
    const distribution = [5, 4, 3, 2, 1].map(star => ratings.filter(r => Math.round(r) === star).length);

    const canSelfEnroll = settings.selfEnrollment && card.status === 'Published' && card.visibility === 'Catalog' && !mine;

    return {
      course: { ...card, description: str(row.description) ?? '', objectives: parseStringList(row.objectives), skills: parseStringList(row.skills, 20), publishedAt: iso(row.publishedAt) },
      instructors: jsonRows(x.instructorsJson)
        .map(p => ({ id: String(p.id), name: str(p.name) ?? '', title: ref(p.title), color: validColor(p.color), avatarUrl: httpsOrNull(p.avatarUrl), bio: str(p.bio) ?? '', owner: String(p.id) === ownerId }))
        .sort((a, b) => Number(b.owner) - Number(a.owner)),
      sections,
      rating: { average: card.rating.average, count: card.rating.count, distribution },
      reviews: jsonRows(x.reviewsJson).map(r => ({ id: String(r.id), name: publicName(str(r.name)), color: validColor(r.color), rating: num(r.rating), review: str(r.review) ?? '', ratedAt: iso(r.ratedAt) })),
      mine: mine ?? null,
      canSelfEnroll,
      selfEnrollment: settings.selfEnrollment,
      paths: jsonRows(x.pathsJson).map(p => ({ id: String(p.id), slug: str(p.slug) || String(p.id), title: str(p.title) ?? '', icon: str(p.icon) ?? '', color: validColor(p.color), coverImageUrl: httpsOrNull(p.coverImageUrl), sequential: bool(p.sequential), courseCount: num(p.courseTotal), myStatus: p.myStatus ? asEnrollmentStatus(p.myStatus) : null })),
      sessions: jsonRows(x.sessionsJson).map(s => {
        const capacity = numOrNull(s.capacity) || null;
        const registration = ref(s.myRegistration);
        const attending = registration === 'Registered' || registration === 'Attended';
        return {
          id: String(s.id),
          title: str(s.title) ?? '',
          startsAt: iso(s.startsAt),
          endsAt: iso(s.endsAt),
          location: str(s.location) ?? '',
          // The meeting link is for people who are coming.
          meetingUrl: attending ? httpsOrNull(s.meetingUrl) : null,
          capacity,
          spotsLeft: capacity == null ? null : Math.max(0, capacity - num(s.takenTotal)),
          lessonId: ref(s.lessonId),
          lessonTitle: ref(s.lessonTitle),
          registrationStatus: registration === 'Cancelled' ? null : registration,
        };
      }),
    };
  },
});
