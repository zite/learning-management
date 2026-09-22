import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getLearner } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { httpsOrNull, jsonRows, validColor } from '../server/learn';

/**
 * Live sessions the learner can attend — for courses they're enrolled in,
 * catalog courses when self-enrollment is on, and org-wide sessions with no
 * course — plus the sessions they've been to.
 */

export type LearnerSession = {
  id: string;
  title: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  location: string;
  meetingUrl: string | null;
  recordingUrl: string | null;
  capacity: number | null;
  spotsLeft: number | null;
  /** People waiting for a seat. */
  waitlistCount: number;
  cancelled: boolean;
  instructorName: string | null;
  course: {
    id: string;
    title: string;
    slug: string;
    icon: string;
    color: string;
  } | null;
  lessonId: string | null;
  lessonTitle: string | null;
  enrolled: boolean;
  registrationStatus: 'Registered' | 'Waitlisted' | 'Attended' | 'Absent' | null;
};

export type SessionsOutput = {
  upcoming: LearnerSession[];
  past: LearnerSession[];
  timezone: string;
};

const SESSION_COLUMNS = `s.id::text AS id, s."title", s."description", s."startsAt", s."endsAt", s."timezone", s."location", s."meetingUrl", s."recordingUrl",
  s."capacity", s."status" AS "sessionStatus", s."lessonId", l."title" AS "lessonTitle", ins."name" AS "instructorName",
  c.id::text AS "courseKey", c."title" AS "courseTitle", c."slug" AS "courseSlug", c."icon" AS "courseIcon", c."color" AS "courseColor",
  (SELECT COUNT(*) FROM "Registrations" x WHERE x."sessionId" = s.id::text AND x."status" IN ('Registered', 'Attended')) AS "takenTotal",
  (SELECT COUNT(*) FROM "Registrations" x WHERE x."sessionId" = s.id::text AND x."status" = 'Waitlisted') AS "waitingTotal",
  mine."status" AS "myRegistration",
  EXISTS (SELECT 1 FROM "Enrollments" e WHERE e."personId" = $1 AND e."courseId" = s."courseId" AND COALESCE(e."status", '') <> 'Withdrawn') AS "isEnrolled"`;

const SESSION_JOINS = `LEFT JOIN "Courses" c ON c.id::text = s."courseId"
  LEFT JOIN "Lessons" l ON l.id::text = s."lessonId"
  LEFT JOIN "People" ins ON ins.id::text = s."instructorId"
  LEFT JOIN LATERAL (SELECT r."status" FROM "Registrations" r WHERE r."sessionId" = s.id::text AND r."personId" = $1 AND r."status" <> 'Cancelled' ORDER BY r.created_at DESC LIMIT 1) mine ON true`;

function toSession(r: Record<string, unknown>): LearnerSession {
  const capacity = numOrNull(r.capacity) || null;
  const reg = ref(r.myRegistration);
  const registrationStatus = reg === 'Registered' || reg === 'Waitlisted' || reg === 'Attended' || reg === 'Absent' ? reg : null;
  const attending = registrationStatus === 'Registered' || registrationStatus === 'Attended';
  return {
    id: String(r.id),
    title: str(r.title) ?? '',
    description: str(r.description) ?? '',
    startsAt: iso(r.startsAt),
    endsAt: iso(r.endsAt),
    timezone: str(r.timezone) ?? '',
    location: str(r.location) ?? '',
    meetingUrl: attending ? httpsOrNull(r.meetingUrl) : null,
    recordingUrl: registrationStatus ? httpsOrNull(r.recordingUrl) : null,
    capacity,
    spotsLeft: capacity == null ? null : Math.max(0, capacity - num(r.takenTotal)),
    waitlistCount: num(r.waitingTotal),
    cancelled: r.sessionStatus === 'Cancelled',
    instructorName: ref(r.instructorName),
    course: ref(r.courseKey)
      ? {
          id: String(r.courseKey),
          title: str(r.courseTitle) ?? '',
          slug: str(r.courseSlug) || String(r.courseKey),
          icon: str(r.courseIcon) ?? '',
          color: validColor(r.courseColor),
        }
      : null,
    lessonId: ref(r.lessonId),
    lessonTitle: ref(r.lessonTitle),
    enrolled: r.isEnrolled === true || r.isEnrolled === 'true',
    registrationStatus,
  };
}

export default createEndpoint({
  description: 'Live sessions for the learner',
  authenticated: true,
  inputSchema: z.object({}),
  execute: async ({ context }): Promise<SessionsOutput> => {
    const settings = await getSettings();
    const actor = await getLearner(context, settings);
    const { rows } = await zite.sql({
      query: `SELECT
        (SELECT json_agg(t)::text FROM (
          SELECT ${SESSION_COLUMNS} FROM "Sessions" s ${SESSION_JOINS}
          WHERE COALESCE(s."endsAt", s."startsAt") > NOW()
            AND (COALESCE(c."status", 'Published') <> 'Draft')
            AND (
              mine."status" IS NOT NULL
              OR (COALESCE(s."status", '') <> 'Cancelled' AND (
                COALESCE(s."courseId", '') = ''
                OR EXISTS (SELECT 1 FROM "Enrollments" e WHERE e."personId" = $1 AND e."courseId" = s."courseId" AND COALESCE(e."status", '') <> 'Withdrawn')
                OR ($2::boolean AND c."status" = 'Published' AND c."visibility" = 'Catalog')
              ))
            )
          ORDER BY s."startsAt" ASC LIMIT 100
        ) t) AS "upcomingJson",
        (SELECT json_agg(t)::text FROM (
          SELECT ${SESSION_COLUMNS} FROM "Sessions" s ${SESSION_JOINS}
          WHERE COALESCE(s."endsAt", s."startsAt") <= NOW() AND COALESCE(s."status", '') <> 'Cancelled' AND mine."status" IS NOT NULL
          ORDER BY s."startsAt" DESC LIMIT 20
        ) t) AS "pastJson"`,
      params: [actor.id, settings.selfEnrollment],
    });
    const x = rows[0] ?? {};
    return {
      upcoming: jsonRows(x.upcomingJson).map(toSession),
      past: jsonRows(x.pastJson).map(toSession),
      timezone: settings.timezone,
    };
  },
});
