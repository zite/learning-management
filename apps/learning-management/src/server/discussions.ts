import { z } from 'zod';
import { zite } from 'zitejs/db';
import { bool, iso, num, Params, ref, str } from '@project/shared/server/sql';

/**
 * Lesson Q&A as staff see it: questions are top-level comments on a lesson,
 * replies hang off them by `parentId`.
 *
 * "Unanswered" is exactly the rule the sidebar count uses (bootstrap
 * `openQuestions`): a learner's question, not resolved, with no reply from an
 * admin or instructor yet. A question staff asked themselves never needs an
 * answer from staff.
 */

export const DISCUSSION_FILTERS = ['unanswered', 'all', 'resolved', 'pinned'] as const;
export type DiscussionFilter = (typeof DISCUSSION_FILTERS)[number];

const personSchema = z.object({ id: z.string(), name: z.string(), color: z.string(), avatarUrl: z.string().nullable(), role: z.string(), title: z.string().nullable() });

export const replySchema = z.object({ id: z.string(), body: z.string(), author: personSchema, postedAt: z.string().nullable(), editedAt: z.string().nullable() });

export const threadSchema = z.object({
  id: z.string(),
  body: z.string(),
  courseId: z.string(),
  courseTitle: z.string(),
  courseSlug: z.string(),
  courseIcon: z.string(),
  courseColor: z.string(),
  lessonId: z.string(),
  lessonTitle: z.string(),
  lessonType: z.string(),
  author: personSchema,
  postedAt: z.string().nullable(),
  editedAt: z.string().nullable(),
  pinned: z.boolean(),
  resolvedAt: z.string().nullable(),
  replyCount: z.number(),
  lastReplyAt: z.string().nullable(),
  answeredByStaff: z.boolean(),
  unanswered: z.boolean(),
  replies: z.array(replySchema),
});
export type Thread = z.infer<typeof threadSchema>;

export const discussionCountsSchema = z.object({ unanswered: z.number(), all: z.number(), resolved: z.number(), pinned: z.number() });

const STATS = `LEFT JOIN LATERAL (
    SELECT COUNT(*) AS "replyTotal", MAX(r."postedAt") AS "lastReplyAt", BOOL_OR(COALESCE(rp."role", '') IN ('Admin', 'Instructor')) AS "staffReplied"
    FROM "Comments" r LEFT JOIN "People" rp ON rp.id::text = r."personId" WHERE r."parentId" = q.id::text
  ) st ON true`;

const FROM = `FROM "Comments" q
  LEFT JOIN "People" a ON a.id::text = q."personId"
  LEFT JOIN "Courses" c ON c.id::text = q."courseId"
  LEFT JOIN "Lessons" l ON l.id::text = q."lessonId"
  ${STATS}`;

const UNANSWERED = `(q."resolvedAt" IS NULL AND COALESCE(a."role", '') NOT IN ('Admin', 'Instructor') AND NOT COALESCE(st."staffReplied", false))`;
const RESOLVED = `q."resolvedAt" IS NOT NULL`;
const PINNED = `COALESCE(q."pinned", false) = true`;

function baseClauses(f: { courseId?: string | null; q?: string }, params: Params) {
  const clauses = [`COALESCE(q."parentId", '') = ''`];
  if (f.courseId) clauses.push(`q."courseId" = ${params.add(f.courseId)}`);
  const text = (f.q ?? '').trim();
  if (text) {
    const like = params.add(text);
    clauses.push(`(q."body" ILIKE '%' || ${like}::text || '%' OR a."name" ILIKE '%' || ${like}::text || '%' OR l."title" ILIKE '%' || ${like}::text || '%' OR c."title" ILIKE '%' || ${like}::text || '%'
      OR EXISTS (SELECT 1 FROM "Comments" rr WHERE rr."parentId" = q.id::text AND rr."body" ILIKE '%' || ${like}::text || '%'))`);
  }
  return clauses;
}

const SELECT = `SELECT q.id, q."body", q."courseId", q."lessonId", q."personId", q."postedAt", q."editedAt", q."pinned", q."resolvedAt",
    a."name" AS "authorName", a."color" AS "authorColor", a."avatarUrl" AS "authorAvatarUrl", a."role" AS "authorRole", a."title" AS "authorTitle",
    c."title" AS "courseTitle", c."slug" AS "courseSlug", c."icon" AS "courseIcon", c."color" AS "courseColor",
    l."title" AS "lessonTitle", l."type" AS "lessonType",
    st."replyTotal", st."lastReplyAt", COALESCE(st."staffReplied", false) AS "staffReplied"`;

function toPerson(r: Record<string, unknown>, prefix: string, idKey: string) {
  return {
    id: String(r[idKey] ?? ''),
    name: str(r[`${prefix}Name`]) || 'Former member',
    color: str(r[`${prefix}Color`]) || '#8b8d98',
    avatarUrl: ref(r[`${prefix}AvatarUrl`]),
    role: str(r[`${prefix}Role`]) || 'Learner',
    title: ref(r[`${prefix}Title`]),
  };
}

async function attachReplies(rows: Record<string, unknown>[]): Promise<Thread[]> {
  const ids = rows.map(r => String(r.id));
  const replies = new Map<string, Thread['replies']>();
  if (ids.length) {
    const { rows: rs } = await zite.sql({
      query: `SELECT r.id, r."body", r."parentId", r."personId", r."postedAt", r."editedAt", p."name" AS "authorName", p."color" AS "authorColor", p."avatarUrl" AS "authorAvatarUrl", p."role" AS "authorRole", p."title" AS "authorTitle"
              FROM "Comments" r LEFT JOIN "People" p ON p.id::text = r."personId"
              WHERE r."parentId" = ANY($1::text[]) ORDER BY r."postedAt" ASC NULLS LAST, r.created_at ASC`,
      params: [ids],
    });
    for (const r of rs) {
      const list = replies.get(String(r.parentId)) ?? [];
      list.push({ id: String(r.id), body: str(r.body) ?? '', author: toPerson(r, 'author', 'personId'), postedAt: iso(r.postedAt), editedAt: iso(r.editedAt) });
      replies.set(String(r.parentId), list);
    }
  }
  return rows.map(r => {
    const author = toPerson(r, 'author', 'personId');
    const answeredByStaff = bool(r.staffReplied);
    const resolvedAt = iso(r.resolvedAt);
    return {
      id: String(r.id),
      body: str(r.body) ?? '',
      courseId: String(r.courseId ?? ''),
      courseTitle: str(r.courseTitle) || 'Deleted course',
      courseSlug: str(r.courseSlug) ?? '',
      courseIcon: str(r.courseIcon) ?? '',
      courseColor: str(r.courseColor) || '#2f6b55',
      lessonId: String(r.lessonId ?? ''),
      lessonTitle: str(r.lessonTitle) || 'Deleted lesson',
      lessonType: str(r.lessonType) || 'Article',
      author,
      postedAt: iso(r.postedAt),
      editedAt: iso(r.editedAt),
      pinned: bool(r.pinned),
      resolvedAt,
      replyCount: num(r.replyTotal),
      lastReplyAt: iso(r.lastReplyAt),
      answeredByStaff,
      unanswered: !resolvedAt && author.role !== 'Admin' && author.role !== 'Instructor' && !answeredByStaff,
      replies: replies.get(String(r.id)) ?? [],
    };
  });
}

export async function selectThreads(f: { filter: DiscussionFilter; courseId?: string | null; q?: string }, limit = 300) {
  const params = new Params();
  const clauses = baseClauses(f, params);
  if (f.filter === 'unanswered') clauses.push(UNANSWERED);
  if (f.filter === 'resolved') clauses.push(RESOLVED);
  if (f.filter === 'pinned') clauses.push(PINNED);
  const { rows } = await zite.sql({
    query: `${SELECT} ${FROM} WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(st."lastReplyAt", q."postedAt") DESC NULLS LAST, q.created_at DESC LIMIT ${limit}`,
    params: params.values,
  });
  return attachReplies(rows);
}

/** One thread by its id — or by a reply's id, which resolves to the question it belongs to. */
export async function loadThread(id: string): Promise<Thread | null> {
  const { rows: found } = await zite.sql({ query: `SELECT id, "parentId" FROM "Comments" WHERE id::text = $1`, params: [id] });
  if (!found[0]) return null;
  const threadId = ref(found[0].parentId) ?? String(found[0].id);
  const { rows } = await zite.sql({ query: `${SELECT} ${FROM} WHERE q.id::text = $1 AND COALESCE(q."parentId", '') = ''`, params: [threadId] });
  if (!rows[0]) return null;
  return (await attachReplies(rows))[0] ?? null;
}

export async function discussionCounts(f: { courseId?: string | null; q?: string }) {
  const params = new Params();
  const clauses = baseClauses(f, params);
  const { rows } = await zite.sql({
    query: `SELECT COUNT(*) FILTER (WHERE ${UNANSWERED}) AS "unansweredTotal", COUNT(*) AS "everyTotal", COUNT(*) FILTER (WHERE ${RESOLVED}) AS "resolvedTotal", COUNT(*) FILTER (WHERE ${PINNED}) AS "pinnedTotal"
            ${FROM} WHERE ${clauses.join(' AND ')}`,
    params: params.values,
  });
  const r = rows[0] ?? {};
  return { unanswered: num(r.unansweredTotal), all: num(r.everyTotal), resolved: num(r.resolvedTotal), pinned: num(r.pinnedTotal) };
}
