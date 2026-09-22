import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { resolveLearner } from '@project/shared/server/people';
import { getSettings, rememberLearnUrl } from '@project/shared/server/settings';
import { bool, num, ref, str } from '@project/shared/server/sql';
import { isConfigured } from '../server/ai';

/**
 * Who is signed in and whether they may use the academy. Access problems are
 * returned, not thrown, so the app can explain them kindly ("you haven't been
 * invited yet") instead of showing an error.
 */

const Output = z.object({
  access: z.enum(['ok', 'not_invited', 'deactivated']),
  email: z.string().nullable(),
  settings: z.object({ organizationName: z.string(), academyName: z.string(), brandColor: z.string(), logoUrl: z.string().nullable(), supportEmail: z.string().nullable(), timezone: z.string(), adminAppUrl: z.string().nullable() }),
  person: z
    .object({ id: z.string(), name: z.string(), email: z.string(), title: z.string().nullable(), bio: z.string(), color: z.string(), avatarUrl: z.string().nullable(), role: z.enum(['Admin', 'Instructor', 'Learner']), managerId: z.string().nullable(), managerName: z.string().nullable(), muteEmails: z.boolean(), created: z.boolean() })
    .nullable(),
  isManager: z.boolean(),
  reportCount: z.number(),
  counts: z.object({ active: z.number(), overdue: z.number(), dueSoon: z.number(), completed: z.number(), certificates: z.number(), unreadNotifications: z.number(), upcomingSessions: z.number() }),
  features: z.object({ selfEnrollment: z.boolean(), leaderboard: z.boolean(), discussions: z.boolean(), ai: z.boolean() }),
});

export default createEndpoint({
  description: 'The signed-in learner, their access and headline counts',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: Output,
  execute: async ({ context }): Promise<z.infer<typeof Output>> => {
    const settings = await rememberLearnUrl(await getSettings());
    const access = await resolveLearner(context, settings);
    const base = {
      settings: { organizationName: settings.organizationName, academyName: settings.academyName, brandColor: settings.brandColor, logoUrl: settings.logoUrl, supportEmail: settings.supportEmail, timezone: settings.timezone, adminAppUrl: null as string | null },
      features: { selfEnrollment: settings.selfEnrollment, leaderboard: settings.leaderboardEnabled, discussions: settings.discussionsEnabled, ai: isConfigured() },
    };
    if (!access.ok) {
      return { ...base, access: access.reason === 'deactivated' ? 'deactivated' : 'not_invited', email: access.email, person: null, isManager: false, reportCount: 0, counts: { active: 0, overdue: 0, dueSoon: 0, completed: 0, certificates: 0, unreadNotifications: 0, upcomingSessions: 0 } };
    }
    const a = access.actor;
    const [personRes, countsRes] = await Promise.all([
      zite.sql({ query: `SELECT p.*, m."name" AS "managerName" FROM "People" p LEFT JOIN "People" m ON m.id::text = p."managerId" WHERE p.id::text = $1`, params: [a.id] }),
      zite.sql({
        query: `SELECT
          (SELECT COUNT(*) FROM "Enrollments" e JOIN "Courses" c ON c.id::text = e."courseId" WHERE e."personId" = $1 AND e."status" IN ('Not started', 'In progress') AND c."status" <> 'Draft') AS "activeTotal",
          (SELECT COUNT(*) FROM "Enrollments" e WHERE e."personId" = $1 AND e."status" IN ('Not started', 'In progress') AND e."dueDate" < (NOW() AT TIME ZONE 'UTC')::date) AS "overdueTotal",
          (SELECT COUNT(*) FROM "Enrollments" e WHERE e."personId" = $1 AND e."status" IN ('Not started', 'In progress') AND e."dueDate" >= (NOW() AT TIME ZONE 'UTC')::date AND e."dueDate" <= (NOW() AT TIME ZONE 'UTC')::date + 7) AS "dueSoonTotal",
          (SELECT COUNT(*) FROM "Enrollments" e WHERE e."personId" = $1 AND e."status" = 'Completed') AS "completedTotal",
          (SELECT COUNT(*) FROM "Certificates" ce WHERE ce."personId" = $1 AND ce."status" = 'Active') AS "certificateTotal",
          (SELECT COUNT(*) FROM "Notifications" n WHERE n."recipientId" = $1 AND n."app" = 'Learn' AND n."readAt" IS NULL AND n."archivedAt" IS NULL) AS "unreadTotal",
          (SELECT COUNT(*) FROM "Registrations" r JOIN "Sessions" s ON s.id::text = r."sessionId" WHERE r."personId" = $1 AND r."status" IN ('Registered', 'Waitlisted') AND s."startsAt" > NOW() AND COALESCE(s."status", '') <> 'Cancelled') AS "sessionTotal",
          (SELECT COUNT(*) FROM "People" r WHERE r."managerId" = $1 AND COALESCE(r."status", '') <> 'Deactivated') AS "reportTotal"`,
        params: [a.id],
      }),
    ]);
    const p = personRes.rows[0] ?? {};
    const c = countsRes.rows[0] ?? {};
    const reportCount = num(c.reportTotal);
    return {
      ...base,
      settings: { ...base.settings, adminAppUrl: a.role !== 'Learner' ? settings.adminAppUrl : null },
      access: 'ok',
      email: a.email,
      person: {
        id: a.id,
        name: a.name,
        email: a.email,
        title: ref(p.title),
        bio: str(p.bio) ?? '',
        color: str(p.color) || '#2f6b55',
        avatarUrl: ref(p.avatarUrl),
        role: a.role,
        managerId: ref(p.managerId),
        managerName: ref(p.managerName),
        muteEmails: bool(p.muteEmails),
        created: a.created,
      },
      isManager: reportCount > 0,
      reportCount,
      counts: {
        active: num(c.activeTotal),
        overdue: num(c.overdueTotal),
        dueSoon: num(c.dueSoonTotal),
        completed: num(c.completedTotal),
        certificates: num(c.certificateTotal),
        unreadNotifications: num(c.unreadTotal),
        upcomingSessions: num(c.sessionTotal),
      },
    };
  },
});
