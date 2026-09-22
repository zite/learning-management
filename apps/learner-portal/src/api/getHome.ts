import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { firstName } from '@project/shared/merge';
import { getLearner } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { iso, num, ref, str } from '@project/shared/server/sql';
import {
  byUrgency,
  certificateOrg,
  COURSE_CARD_COLUMNS,
  COURSE_CARD_JOIN,
  CERTIFICATE_COLUMNS,
  jsonRows,
  loadMyEnrollments,
  loadMyPathEnrollments,
  pointsSince,
  streakFrom,
  toCertificateSummary,
  toCourseCard,
  todayIn,
  totalPoints,
  type CertificateOrg,
  type CertificateSummary,
  type CourseCard,
  type MyEnrollment,
  type MyPathEnrollment,
} from '../server/learn';

/**
 * The learner's home: what to pick up, what's due, their paths, sessions and
 * certificates, a few honest stats and — when the catalog is open — courses
 * they might like next.
 */

export type HomeSession = { id: string; title: string; startsAt: string | null; endsAt: string | null; location: string; meetingUrl: string | null; registrationStatus: string; lessonId: string | null; course: { id: string; title: string; slug: string } | null };

export type HomeOutput = {
  firstName: string;
  continueLearning: MyEnrollment | null;
  todo: MyEnrollment[];
  counts: { open: number; overdue: number; dueSoon: number; completed: number };
  paths: MyPathEnrollment[];
  sessions: HomeSession[];
  certificates: CertificateSummary[];
  org: CertificateOrg;
  stats: { completedThisYear: number; learningMinutes: number; streakDays: number; points: number; learnedToday: boolean };
  recommendations: CourseCard[];
  selfEnrollment: boolean;
  leaderboard: boolean;
};

export default createEndpoint({
  description: "The learner's home page",
  authenticated: true,
  inputSchema: z.object({}),
  execute: async ({ context }): Promise<HomeOutput> => {
    const settings = await getSettings();
    const actor = await getLearner(context, settings);

    const enrollments = await loadMyEnrollments(actor.id);
    const paths = await loadMyPathEnrollments(actor.id);

    const { rows } = await zite.sql({
      query: `SELECT
        (SELECT json_agg(t)::text FROM (
          SELECT s.id::text AS id, s."title", s."startsAt", s."endsAt", s."location", s."meetingUrl", s."lessonId", r."status" AS "registrationStatus",
            c.id::text AS "courseKey", c."title" AS "courseTitle", c."slug" AS "courseSlug"
          FROM "Registrations" r
          JOIN "Sessions" s ON s.id::text = r."sessionId"
          LEFT JOIN "Courses" c ON c.id::text = s."courseId"
          WHERE r."personId" = $1 AND r."status" IN ('Registered', 'Waitlisted') AND COALESCE(s."status", '') <> 'Cancelled' AND COALESCE(s."endsAt", s."startsAt") > NOW()
          ORDER BY s."startsAt" ASC LIMIT 3
        ) t) AS "sessionsJson",
        (SELECT json_agg(t)::text FROM (
          SELECT ${CERTIFICATE_COLUMNS} FROM "Certificates" ce WHERE ce."personId" = $1 AND ce."status" = 'Active' AND (ce."expiresAt" IS NULL OR ce."expiresAt" > NOW()) ORDER BY ce."issuedAt" DESC LIMIT 3
        ) t) AS "certificatesJson",
        (SELECT COUNT(*) FROM "Enrollments" e WHERE e."personId" = $1 AND e."status" = 'Completed' AND e."completedAt" >= date_trunc('year', NOW())) AS "completedYearTotal",
        (SELECT COALESCE(SUM(e."timeSpentSeconds"), 0) FROM "Enrollments" e WHERE e."personId" = $1) AS "secondsTotal",
        (SELECT string_agg(DISTINCT h::text, ',') FROM (
          SELECT floor(EXTRACT(EPOCH FROM lp."completedAt") / 3600) AS h FROM "LessonProgress" lp WHERE lp."personId" = $1 AND lp."completedAt" > NOW() - INTERVAL '400 days'
          UNION SELECT floor(EXTRACT(EPOCH FROM lp."startedAt") / 3600) FROM "LessonProgress" lp WHERE lp."personId" = $1 AND lp."startedAt" > NOW() - INTERVAL '400 days'
          UNION SELECT floor(EXTRACT(EPOCH FROM e."lastActivityAt") / 3600) FROM "Enrollments" e WHERE e."personId" = $1 AND e."lastActivityAt" > NOW() - INTERVAL '400 days'
          UNION SELECT floor(EXTRACT(EPOCH FROM qa."submittedAt") / 3600) FROM "QuizAttempts" qa WHERE qa."personId" = $1 AND qa."submittedAt" > NOW() - INTERVAL '400 days'
        ) hours WHERE h IS NOT NULL) AS "activeHours"`,
      params: [actor.id],
    });
    const x = rows[0] ?? {};

    const [points] = await pointsSince(null, actor.id);

    // Recommendations: Catalog courses they aren't in, leaning towards the categories they already learn in.
    let recommendations: CourseCard[] = [];
    if (settings.selfEnrollment) {
      const categoryIds = [...new Set(enrollments.map(e => e.course.category?.id).filter(Boolean) as string[])];
      const rec = await zite.sql({
        query: `SELECT * FROM (
                  SELECT ${COURSE_CARD_COLUMNS}, CASE WHEN c."categoryId" = ANY($2::text[]) THEN 1 ELSE 0 END AS "affinity"
                  FROM "Courses" c ${COURSE_CARD_JOIN}
                  WHERE c."status" = 'Published' AND c."visibility" = 'Catalog'
                    AND NOT EXISTS (SELECT 1 FROM "Enrollments" e WHERE e."courseId" = c.id::text AND e."personId" = $1 AND COALESCE(e."status", '') <> 'Withdrawn')
                ) ranked
                ORDER BY "affinity" DESC, "ratingAverage" DESC NULLS LAST, "enrolledTotal" DESC, "title" ASC LIMIT 4`,
        params: [actor.id, categoryIds],
      });
      recommendations = rec.rows.map(toCourseCard);
    }

    // Lesson ids are only needed on a course's own page.
    const open = enrollments
      .filter(e => e.status === 'Not started' || e.status === 'In progress')
      .map(e => ({ ...e, completedLessonIds: [] }))
      .sort(byUrgency);
    const continueLearning =
      [...open].filter(e => e.status === 'In progress' && !e.lockedBy).sort((a, b) => (Date.parse(b.lastActivityAt ?? b.startedAt ?? '') || 0) - (Date.parse(a.lastActivityAt ?? a.startedAt ?? '') || 0))[0] ?? null;

    const tz = settings.timezone;
    const today = todayIn(tz);
    const days = new Set(
      String(x.activeHours ?? '')
        .split(',')
        .filter(Boolean)
        .map(h => todayIn(tz, new Date(Number(h) * 3_600_000))),
    );

    return {
      firstName: firstName(actor.name) || 'there',
      continueLearning,
      todo: open,
      counts: {
        open: open.length,
        overdue: open.filter(e => e.dueState === 'overdue').length,
        dueSoon: open.filter(e => e.dueState === 'due_soon').length,
        completed: enrollments.filter(e => e.status === 'Completed').length,
      },
      paths: paths.filter(p => p.status !== 'Completed').sort(byUrgency),
      sessions: jsonRows(x.sessionsJson).map(s => ({
        id: String(s.id),
        title: str(s.title) ?? '',
        startsAt: iso(s.startsAt),
        endsAt: iso(s.endsAt),
        location: str(s.location) ?? '',
        meetingUrl: ref(s.meetingUrl),
        registrationStatus: str(s.registrationStatus) ?? 'Registered',
        lessonId: ref(s.lessonId),
        course: ref(s.courseKey) ? { id: String(s.courseKey), title: str(s.courseTitle) ?? '', slug: str(s.courseSlug) || String(s.courseKey) } : null,
      })),
      certificates: jsonRows(x.certificatesJson).map(toCertificateSummary),
      org: certificateOrg(settings),
      stats: {
        completedThisYear: num(x.completedYearTotal),
        learningMinutes: Math.round(num(x.secondsTotal) / 60),
        streakDays: streakFrom(days, today),
        points: points ? totalPoints(points) : 0,
        learnedToday: days.has(today),
      },
      recommendations,
      selfEnrollment: settings.selfEnrollment,
      leaderboard: settings.leaderboardEnabled,
    };
  },
});
