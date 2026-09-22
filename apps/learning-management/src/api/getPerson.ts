import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { certificateState, dueState } from '@project/shared/progress';
import { assertStaff, getActor } from '@project/shared/server/people';
import { day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { asRoleValue, asStatusValue, LATEST_CYCLE, lastActive, statsCtes } from '../server/people-admin';

/**
 * One person, for their page: profile, manager and direct reports, groups,
 * learning paths, certificates, upcoming live sessions and headline numbers.
 * Course enrollments themselves come from listEnrollments, like every list.
 */

const Input = z.object({ id: z.string().min(1) });

const personRef = z.object({ id: z.string(), name: z.string(), title: z.string().nullable(), color: z.string(), avatarUrl: z.string().nullable(), status: z.string() });

const Output = z.object({
  person: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    title: z.string().nullable(),
    role: z.enum(['Admin', 'Instructor', 'Learner']),
    status: z.enum(['Active', 'Invited', 'Deactivated']),
    color: z.string(),
    avatarUrl: z.string().nullable(),
    managerId: z.string().nullable(),
    hireDate: z.string().nullable(),
    externalId: z.string().nullable(),
    bio: z.string(),
    muteEmails: z.boolean(),
    invitedAt: z.string().nullable(),
    lastSeenAt: z.string().nullable(),
    lastLearnedAt: z.string().nullable(),
    deactivatedAt: z.string().nullable(),
    createdAt: z.string().nullable(),
  }),
  manager: personRef.nullable(),
  reports: z.array(personRef.extend({ active: z.number(), overdue: z.number() })),
  groups: z.array(z.object({ id: z.string(), addedAt: z.string().nullable() })),
  paths: z.array(
    z.object({
      id: z.string(),
      pathId: z.string(),
      title: z.string(),
      icon: z.string(),
      color: z.string(),
      status: z.enum(['Not started', 'In progress', 'Completed', 'Withdrawn']),
      dueState: z.enum(['done', 'overdue', 'due_soon', 'on_track', 'no_due', 'withdrawn']),
      progress: z.number(),
      dueDate: z.string().nullable(),
      enrolledAt: z.string().nullable(),
      completedAt: z.string().nullable(),
      certificateId: z.string().nullable(),
      coursesTotal: z.number(),
      coursesDone: z.number(),
      cycle: z.number(),
    }),
  ),
  certificates: z.array(
    z.object({
      id: z.string(),
      credentialId: z.string(),
      title: z.string(),
      courseId: z.string().nullable(),
      pathId: z.string().nullable(),
      enrollmentId: z.string().nullable(),
      issuedAt: z.string().nullable(),
      expiresAt: z.string().nullable(),
      status: z.string(),
      state: z.enum(['active', 'expiring', 'expired', 'revoked']),
      score: z.number().nullable(),
    }),
  ),
  sessions: z.array(
    z.object({
      id: z.string(),
      sessionId: z.string(),
      title: z.string(),
      courseId: z.string().nullable(),
      startsAt: z.string().nullable(),
      endsAt: z.string().nullable(),
      location: z.string().nullable(),
      meetingUrl: z.string().nullable(),
      status: z.string(),
    }),
  ),
  stats: z.object({
    active: z.number(),
    overdue: z.number(),
    completed: z.number(),
    certificates: z.number(),
    learningSeconds: z.number(),
    averageScore: z.number().nullable(),
    lastActiveAt: z.string().nullable(),
  }),
  overdueEnrollmentIds: z.array(z.string()),
  canEdit: z.boolean(),
  canEnroll: z.boolean(),
  isMe: z.boolean(),
});

const asEnrollmentStatus = (v: unknown) => (v === 'In progress' || v === 'Completed' || v === 'Withdrawn' ? v : 'Not started') as 'Not started' | 'In progress' | 'Completed' | 'Withdrawn';

const toRef = (r: Record<string, unknown>) => ({ id: String(r.id), name: str(r.name) || str(r.email) || 'Unnamed', title: ref(r.title), color: str(r.color) || '#8b8d98', avatarUrl: ref(r.avatarUrl), status: str(r.status) || 'Active' });

export default createEndpoint({
  description: 'Load a person with their groups, paths, certificates, sessions and stats',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Choose a person', 'BAD_REQUEST');
    const { id } = parsed.data;

    const { rows: personRows } = await zite.sql({ query: `SELECT p.*, p.created_at AS "createdAt" FROM "People" p WHERE p.id::text = $1`, params: [id] });
    const r = personRows[0];
    if (!r) throw new ZiteError('That person no longer exists', 'NOT_FOUND');
    const managerId = ref(r.managerId);

    const [managerRes, reportsRes, groupsRes, pathsRes, certsRes, sessionsRes, statsRes, overdueRes] = await Promise.all([
      managerId ? zite.sql({ query: `SELECT id, "name", "email", "title", "color", "avatarUrl", "status" FROM "People" WHERE id::text = $1`, params: [managerId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      zite.sql({
        query: `WITH ${statsCtes(col => `${col} IN (SELECT r.id::text FROM "People" r WHERE r."managerId" = $1)`)}
                SELECT p.id, p."name", p."email", p."title", p."color", p."avatarUrl", p."status", COALESCE(es."openTotal", 0) AS "openTotal", COALESCE(es."overdueTotal", 0) AS "overdueTotal"
                FROM "People" p LEFT JOIN enrollment_stats es ON es."pid" = p.id::text
                WHERE p."managerId" = $1
                ORDER BY CASE WHEN COALESCE(p."status", '') = 'Deactivated' THEN 1 ELSE 0 END, COALESCE(es."overdueTotal", 0) DESC, LOWER(p."name") ASC
                LIMIT 200`,
        params: [id],
      }),
      zite.sql({ query: `SELECT gm."groupId", MIN(gm."addedAt") AS "addedAt" FROM "GroupMembers" gm JOIN "Groups" g ON g.id::text = gm."groupId" WHERE gm."personId" = $1 GROUP BY gm."groupId"`, params: [id] }),
      zite.sql({
        query: `SELECT pe.*, pa."title" AS "pathTitle", pa."icon" AS "pathIcon", pa."color" AS "pathColor",
                  (SELECT COUNT(*) FROM "PathCourses" pc WHERE pc."pathId" = pe."pathId" AND COALESCE(pc."optional", false) = false) AS "requiredTotal",
                  (SELECT COUNT(DISTINCT pc."courseId") FROM "PathCourses" pc JOIN "Enrollments" e ON e."courseId" = pc."courseId" AND e."personId" = pe."personId" AND e."status" = 'Completed'
                     WHERE pc."pathId" = pe."pathId" AND COALESCE(pc."optional", false) = false) AS "requiredDone"
                FROM "PathEnrollments" pe JOIN "Paths" pa ON pa.id::text = pe."pathId"
                WHERE pe."personId" = $1
                  AND NOT EXISTS (SELECT 1 FROM "PathEnrollments" later WHERE later."personId" = pe."personId" AND later."pathId" = pe."pathId" AND COALESCE(later."cycle", 1) > COALESCE(pe."cycle", 1))
                ORDER BY CASE WHEN pe."status" IN ('Not started', 'In progress') THEN 0 WHEN pe."status" = 'Completed' THEN 1 ELSE 2 END, pe."dueDate" ASC NULLS LAST, pe."enrolledAt" DESC NULLS LAST`,
        params: [id],
      }),
      zite.sql({ query: `SELECT * FROM "Certificates" WHERE "personId" = $1 ORDER BY "issuedAt" DESC NULLS LAST, created_at DESC LIMIT 200`, params: [id] }),
      zite.sql({
        query: `SELECT r.id, r."status", r."sessionId", s."title", s."courseId", s."startsAt", s."endsAt", s."location", s."meetingUrl"
                FROM "Registrations" r JOIN "Sessions" s ON s.id::text = r."sessionId"
                WHERE r."personId" = $1 AND r."status" IN ('Registered', 'Waitlisted') AND COALESCE(s."status", '') <> 'Cancelled' AND COALESCE(s."endsAt", s."startsAt") > NOW()
                ORDER BY s."startsAt" ASC LIMIT 20`,
        params: [id],
      }),
      zite.sql({
        query: `WITH ${statsCtes(col => `${col} = ANY($1::text[])`)}
                SELECT
                  (SELECT "openTotal" FROM enrollment_stats) AS "openTotal",
                  (SELECT "overdueTotal" FROM enrollment_stats) AS "overdueTotal",
                  (SELECT "doneTotal" FROM enrollment_stats) AS "doneTotal",
                  (SELECT "lastActivity" FROM enrollment_stats) AS "lastActivity",
                  (SELECT "certTotal" FROM certificate_stats) AS "certTotal",
                  (SELECT COALESCE(SUM(e."timeSpentSeconds"), 0) FROM "Enrollments" e WHERE e."personId" = $2) AS "secondsTotal",
                  (SELECT AVG(e."score") FROM "Enrollments" e WHERE e."personId" = $2 AND e."score" IS NOT NULL AND COALESCE(e."status", '') <> 'Withdrawn') AS "scoreAverage"`,
        params: [[id], id],
      }),
      zite.sql({ query: `SELECT e.id::text AS id FROM "Enrollments" e WHERE e."personId" = $1 AND e."status" IN ('Not started', 'In progress') AND e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date AND ${LATEST_CYCLE()}`, params: [id] }),
    ]);

    const s = statsRes.rows[0] ?? {};
    const role = asRoleValue(r.role);
    return {
      person: {
        id: String(r.id),
        name: str(r.name) || str(r.email) || 'Unnamed',
        email: str(r.email) ?? '',
        title: ref(r.title),
        role,
        status: asStatusValue(r.status),
        color: str(r.color) || '#8b8d98',
        avatarUrl: ref(r.avatarUrl),
        managerId,
        hireDate: day(r.hireDate),
        externalId: ref(r.externalId),
        bio: str(r.bio) ?? '',
        muteEmails: r.muteEmails === true,
        invitedAt: iso(r.invitedAt),
        lastSeenAt: iso(r.lastSeenAt),
        lastLearnedAt: iso(r.lastLearnedAt),
        deactivatedAt: iso(r.deactivatedAt),
        createdAt: iso(r.createdAt),
      },
      manager: managerRes.rows[0] ? toRef(managerRes.rows[0]) : null,
      reports: reportsRes.rows.map(x => ({ ...toRef(x), active: num(x.openTotal), overdue: num(x.overdueTotal) })),
      groups: groupsRes.rows.map(g => ({ id: String(g.groupId), addedAt: iso(g.addedAt) })),
      paths: pathsRes.rows.map(pe => {
        const status = asEnrollmentStatus(pe.status);
        const dueDate = day(pe.dueDate);
        return {
          id: String(pe.id),
          pathId: String(pe.pathId),
          title: str(pe.pathTitle) ?? 'Learning path',
          icon: str(pe.pathIcon) ?? '',
          color: str(pe.pathColor) || '#2f6b55',
          status,
          dueState: dueState({ status, dueDate }),
          progress: status === 'Completed' ? 100 : num(pe.progress),
          dueDate,
          enrolledAt: iso(pe.enrolledAt),
          completedAt: iso(pe.completedAt),
          certificateId: ref(pe.certificateId),
          coursesTotal: num(pe.requiredTotal),
          coursesDone: Math.min(num(pe.requiredDone), num(pe.requiredTotal)),
          cycle: num(pe.cycle, 1) || 1,
        };
      }),
      certificates: certsRes.rows.map(c => {
        const expiresAt = iso(c.expiresAt);
        return {
          id: String(c.id),
          credentialId: str(c.credentialId) ?? '',
          title: str(c.title) || 'Certificate',
          courseId: ref(c.courseId),
          pathId: ref(c.pathId),
          enrollmentId: ref(c.enrollmentId),
          issuedAt: iso(c.issuedAt),
          expiresAt,
          status: str(c.status) || 'Active',
          state: certificateState({ status: str(c.status) || 'Active', expiresAt }),
          score: numOrNull(c.score),
        };
      }),
      sessions: sessionsRes.rows.map(x => ({
        id: String(x.id),
        sessionId: String(x.sessionId),
        title: str(x.title) || 'Live session',
        courseId: ref(x.courseId),
        startsAt: iso(x.startsAt),
        endsAt: iso(x.endsAt),
        location: ref(x.location),
        meetingUrl: ref(x.meetingUrl),
        status: str(x.status) || 'Registered',
      })),
      stats: {
        active: num(s.openTotal),
        overdue: num(s.overdueTotal),
        completed: num(s.doneTotal),
        certificates: num(s.certTotal),
        learningSeconds: num(s.secondsTotal),
        averageScore: s.scoreAverage != null ? Math.round(num(s.scoreAverage)) : null,
        lastActiveAt: lastActive({ lastLearnedAt: r.lastLearnedAt, lastSeenAt: r.lastSeenAt, lastActivity: s.lastActivity }),
      },
      overdueEnrollmentIds: overdueRes.rows.map(x => String(x.id)),
      canEdit: actor.role === 'Admin',
      canEnroll: true,
      isMe: actor.id === String(r.id),
    };
  },
});
