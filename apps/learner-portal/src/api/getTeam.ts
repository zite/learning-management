import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { dueState, type DueState } from '@project/shared/progress';
import { getLearner } from '@project/shared/server/people';
import { day, iso, num, ref, str } from '@project/shared/server/sql';
import { httpsOrNull, jsonRows, validColor } from '../server/learn';

/**
 * A manager's view of their DIRECT reports' training — what's open, what's
 * late, and certificates about to lapse. Only people whose manager is the
 * signed-in person are ever included.
 */

export type TeamEnrollment = { id: string; status: string; progress: number; dueDate: string | null; dueState: DueState; remindedAt: string | null; source: string; course: { id: string; title: string; slug: string; icon: string; color: string } };

export type TeamMember = {
  id: string;
  name: string;
  title: string | null;
  email: string;
  color: string;
  avatarUrl: string | null;
  lastLearnedAt: string | null;
  counts: { active: number; overdue: number; dueSoon: number; completed: number };
  expiringCertificates: Array<{ id: string; title: string; expiresAt: string | null; expired: boolean }>;
  open: TeamEnrollment[];
};

export type TeamOutput = { members: TeamMember[]; summary: { reports: number; overdue: number; dueThisWeek: number; expiring: number } };

export default createEndpoint({
  description: "A manager's direct reports and their training",
  authenticated: true,
  inputSchema: z.object({}),
  execute: async ({ context }): Promise<TeamOutput> => {
    const actor = await getLearner(context);
    const { rows } = await zite.sql({
      query: `SELECT p.id::text AS id, p."name", p."title", p."email", p."color", p."avatarUrl", p."lastLearnedAt",
        (SELECT json_agg(t)::text FROM (
          SELECT e.id::text AS id, e."status", e."progress", e."dueDate", e."remindedAt", e."source",
            c.id::text AS "courseKey", c."title" AS "courseTitle", c."slug" AS "courseSlug", c."icon" AS "courseIcon", c."color" AS "courseColor"
          FROM "Enrollments" e JOIN "Courses" c ON c.id::text = e."courseId"
          WHERE e."personId" = p.id::text AND e."status" IN ('Not started', 'In progress') AND c."status" <> 'Draft'
          ORDER BY e."dueDate" ASC NULLS LAST, e."enrolledAt" ASC
        ) t) AS "openJson",
        (SELECT COUNT(*) FROM "Enrollments" e WHERE e."personId" = p.id::text AND e."status" = 'Completed') AS "completedTotal",
        (SELECT json_agg(t)::text FROM (
          SELECT ce.id::text AS id, ce."title", ce."expiresAt" FROM "Certificates" ce
          WHERE ce."personId" = p.id::text AND ce."status" = 'Active' AND ce."expiresAt" IS NOT NULL
            AND ce."expiresAt" <= NOW() + INTERVAL '30 days' AND ce."expiresAt" > NOW() - INTERVAL '30 days'
            AND NOT EXISTS (
              SELECT 1 FROM "Certificates" n WHERE n."personId" = ce."personId" AND n."status" = 'Active' AND n."issuedAt" > ce."issuedAt"
                AND COALESCE(n."courseId", '') = COALESCE(ce."courseId", '') AND COALESCE(n."pathId", '') = COALESCE(ce."pathId", '')
            )
          ORDER BY ce."expiresAt" ASC
        ) t) AS "expiringJson"
      FROM "People" p
      WHERE p."managerId" = $1 AND COALESCE(p."status", '') <> 'Deactivated'
      ORDER BY p."name" ASC`,
      params: [actor.id],
    });

    const now = Date.now();
    const members: TeamMember[] = rows.map(r => {
      const open = jsonRows(r.openJson).map(e => {
        const dueDate = day(e.dueDate);
        const status = str(e.status) || 'Not started';
        return {
          id: String(e.id),
          status,
          progress: num(e.progress),
          dueDate,
          dueState: dueState({ status, dueDate }),
          remindedAt: iso(e.remindedAt),
          source: str(e.source) || 'Assigned',
          course: { id: String(e.courseKey), title: str(e.courseTitle) ?? '', slug: str(e.courseSlug) || String(e.courseKey), icon: str(e.courseIcon) ?? '', color: validColor(e.courseColor) },
        };
      });
      const order: Record<DueState, number> = { overdue: 0, due_soon: 1, on_track: 2, no_due: 3, done: 4, withdrawn: 5 };
      open.sort((a, b) => order[a.dueState] - order[b.dueState] || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
      return {
        id: String(r.id),
        name: str(r.name) ?? '',
        title: ref(r.title),
        email: str(r.email) ?? '',
        color: validColor(r.color),
        avatarUrl: httpsOrNull(r.avatarUrl),
        lastLearnedAt: iso(r.lastLearnedAt),
        counts: { active: open.length, overdue: open.filter(e => e.dueState === 'overdue').length, dueSoon: open.filter(e => e.dueState === 'due_soon').length, completed: num(r.completedTotal) },
        expiringCertificates: jsonRows(r.expiringJson).map(c => {
          const expiresAt = iso(c.expiresAt);
          return { id: String(c.id), title: str(c.title) ?? '', expiresAt, expired: expiresAt ? Date.parse(expiresAt) <= now : false };
        }),
        open,
      };
    });

    // Most overdue first, then most due soon, then lapsing certificates, then alphabetical.
    members.sort((a, b) => b.counts.overdue - a.counts.overdue || b.counts.dueSoon - a.counts.dueSoon || b.expiringCertificates.length - a.expiringCertificates.length || a.name.localeCompare(b.name));
    return {
      members,
      summary: {
        reports: members.length,
        overdue: members.reduce((s, m) => s + m.counts.overdue, 0),
        dueThisWeek: members.reduce((s, m) => s + m.counts.dueSoon, 0),
        expiring: members.reduce((s, m) => s + m.expiringCertificates.length, 0),
      },
    };
  },
});
