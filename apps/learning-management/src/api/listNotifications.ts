import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { iso, num, ref, str } from '@project/shared/server/sql';

/**
 * The signed-in staff member's admin inbox: work to grade, learner questions,
 * completions, ratings, escalations. Learner-app notifications for the same
 * person live in the learner app and never show here.
 */

/**
 * Older notifications link to a whole screen ("/grading"). When the submission
 * or question they're about can be found — same person, same course, nearest
 * in time — link straight to it instead.
 */
function deepLink(n: Record<string, unknown>) {
  const link = ref(n.link);
  if (link === '/grading' && n.submissionRowId) return `/grading/${n.submissionRowId}`;
  if (link === '/discussions' && n.questionRowId) return `/discussions?thread=${n.questionRowId}`;
  return link;
}

function subjectStatus(n: Record<string, unknown>) {
  if (n.submissionRowId) {
    const status = str(n.submissionStatus);
    return status === 'Submitted' ? 'Waiting to be graded' : status ? `${status}${n.submissionGrade != null && n.submissionGrade !== '' ? ` · ${num(n.submissionGrade)}` : ''}` : null;
  }
  if (n.questionRowId) return n.questionResolvedAt ? 'Resolved' : n.questionAnswered === true || n.questionAnswered === 'true' ? 'Answered' : 'Waiting for an answer';
  return null;
}

const Input = z.object({ tab: z.enum(['unread', 'all', 'archived']).default('all') });

const Output = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      type: z.string(),
      link: z.string().nullable(),
      courseId: z.string().nullable(),
      courseTitle: z.string().nullable(),
      pathId: z.string().nullable(),
      pathTitle: z.string().nullable(),
      actorId: z.string().nullable(),
      actorName: z.string().nullable(),
      actorColor: z.string().nullable(),
      actorAvatarUrl: z.string().nullable(),
      actorRole: z.string().nullable(),
      actorTitle: z.string().nullable(),
      /** Where the thing it's about stands now: "Waiting to be graded", "Passed · 90", "Answered"… */
      subjectStatus: z.string().nullable(),
      occurredAt: z.string().nullable(),
      readAt: z.string().nullable(),
      archivedAt: z.string().nullable(),
    }),
  ),
  counts: z.object({ unread: z.number(), all: z.number(), archived: z.number() }),
});

export default createEndpoint({
  description: "List the signed-in staff member's admin inbox notifications with unread and archived counts",
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Choose Unread, All or Archived', 'BAD_REQUEST');
    const { tab } = parsed.data;
    const where = tab === 'archived' ? `n."archivedAt" IS NOT NULL` : tab === 'unread' ? `n."archivedAt" IS NULL AND n."readAt" IS NULL` : `n."archivedAt" IS NULL`;

    const [listRes, countRes] = await Promise.all([
      zite.sql({
        query: `SELECT n.id, n."title", n."body", n."type", n."link", n."courseId", n."pathId", n."actorId", n."occurredAt", n."readAt", n."archivedAt",
                  c."title" AS "courseTitle", pa."title" AS "pathTitle", a."name" AS "actorName", a."color" AS "actorColor", a."avatarUrl" AS "actorAvatarUrl", a."role" AS "actorRole", a."title" AS "actorTitle",
                  sub.id AS "submissionRowId", sub."status" AS "submissionStatus", sub."grade" AS "submissionGrade",
                  qq.id AS "questionRowId", qq."resolvedAt" AS "questionResolvedAt", qq."staffReplied" AS "questionAnswered"
                FROM "Notifications" n
                LEFT JOIN "Courses" c ON c.id::text = n."courseId"
                LEFT JOIN "Paths" pa ON pa.id::text = n."pathId"
                LEFT JOIN "People" a ON a.id::text = n."actorId"
                LEFT JOIN LATERAL (
                  SELECT s.id, s."status", s."grade" FROM "Submissions" s
                  WHERE (COALESCE(n."link", '') LIKE '/grading/%' AND s.id::text = substring(n."link" from '^/grading/([^/?#]+)'))
                     OR (n."type" = 'submission_received' AND COALESCE(n."link", '') NOT LIKE '/grading/%' AND s."personId" = n."actorId" AND s."courseId" = n."courseId")
                  ORDER BY ABS(EXTRACT(EPOCH FROM (s."submittedAt" - n."occurredAt"))) ASC NULLS LAST LIMIT 1
                ) sub ON true
                LEFT JOIN LATERAL (
                  SELECT q.id, q."resolvedAt",
                    EXISTS (SELECT 1 FROM "Comments" r JOIN "People" rp ON rp.id::text = r."personId" WHERE r."parentId" = q.id::text AND rp."role" IN ('Admin', 'Instructor')) AS "staffReplied"
                  FROM "Comments" q
                  WHERE COALESCE(q."parentId", '') = '' AND (
                    (COALESCE(n."link", '') LIKE '%thread=%' AND q.id::text = substring(n."link" from 'thread=([^&#]+)'))
                    OR (n."type" = 'question_posted' AND COALESCE(n."link", '') NOT LIKE '%thread=%' AND q."personId" = n."actorId" AND q."courseId" = n."courseId"))
                  ORDER BY ABS(EXTRACT(EPOCH FROM (q."postedAt" - n."occurredAt"))) ASC NULLS LAST LIMIT 1
                ) qq ON true
                WHERE n."recipientId" = $1 AND n."app" = 'Admin' AND ${where}
                ORDER BY ${tab === 'archived' ? `n."archivedAt" DESC NULLS LAST,` : ''} n."occurredAt" DESC NULLS LAST, n.created_at DESC
                LIMIT 300`,
        params: [actor.id],
      }),
      zite.sql({
        query: `SELECT COUNT(*) FILTER (WHERE "archivedAt" IS NULL AND "readAt" IS NULL) AS "unreadTotal",
                  COUNT(*) FILTER (WHERE "archivedAt" IS NULL) AS "liveTotal",
                  COUNT(*) FILTER (WHERE "archivedAt" IS NOT NULL) AS "archivedTotal"
                FROM "Notifications" WHERE "recipientId" = $1 AND "app" = 'Admin'`,
        params: [actor.id],
      }),
    ]);
    const c = countRes.rows[0] ?? {};

    return {
      notifications: listRes.rows.map(n => ({
        id: String(n.id),
        title: str(n.title) ?? '',
        body: str(n.body) ?? '',
        type: str(n.type) ?? '',
        link: deepLink(n),
        courseId: ref(n.courseId),
        courseTitle: ref(n.courseTitle),
        pathId: ref(n.pathId),
        pathTitle: ref(n.pathTitle),
        actorId: ref(n.actorId),
        actorName: ref(n.actorName),
        actorColor: ref(n.actorColor),
        actorAvatarUrl: ref(n.actorAvatarUrl),
        actorRole: ref(n.actorRole),
        actorTitle: ref(n.actorTitle),
        subjectStatus: subjectStatus(n),
        occurredAt: iso(n.occurredAt),
        readAt: iso(n.readAt),
        archivedAt: iso(n.archivedAt),
      })),
      counts: { unread: num(c.unreadTotal), all: num(c.liveTotal), archived: num(c.archivedTotal) },
    };
  },
});
