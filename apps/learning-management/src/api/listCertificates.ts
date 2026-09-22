import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { num, Params } from '@project/shared/server/sql';
import { CERT_COLUMNS, CERT_FROM, certificateRowSchema, mapCertificateRow, STATE_SQL } from '../server/certificates';

/**
 * Every certificate issued, searchable by recipient or credential id, with
 * counts per state for the tabs (under the same search and filters).
 */

const Input = z.object({
  state: z.enum(['active', 'expiring', 'expired', 'revoked', 'all']).default('all'),
  q: z.string().max(200).default(''),
  courseId: z.string().optional(),
  pathId: z.string().optional(),
  issuedFrom: z.string().optional(),
  issuedTo: z.string().optional(),
  limit: z.number().int().min(1).max(5000).default(200),
  offset: z.number().int().min(0).default(0),
});

const Output = z.object({
  rows: z.array(certificateRowSchema),
  total: z.number(),
  counts: z.object({ active: z.number(), expiring: z.number(), expired: z.number(), revoked: z.number(), all: z.number() }),
});

const isDay = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}/.test(s));

export default createEndpoint({
  description: 'List certificates with search, filters and counts per state',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid filters', 'BAD_REQUEST');
    const f = parsed.data;

    const filters = (p: Params) => {
      const w: string[] = [];
      const q = f.q.trim().toLowerCase();
      if (q) {
        const like = p.add(`%${q}%`);
        const compact = p.add(`%${q.replace(/[^a-z0-9]/g, '')}%`);
        w.push(`(LOWER(COALESCE(p."name", ce."recipientName", '')) LIKE ${like} OR LOWER(COALESCE(p."email", '')) LIKE ${like} OR LOWER(ce."title") LIKE ${like} OR (LENGTH(${compact}) > 3 AND REPLACE(LOWER(ce."credentialId"), '-', '') LIKE ${compact}))`);
      }
      if (f.courseId) w.push(`ce."courseId" = ${p.add(f.courseId)}`);
      if (f.pathId) w.push(`ce."pathId" = ${p.add(f.pathId)}`);
      if (isDay(f.issuedFrom)) w.push(`ce."issuedAt" >= ${p.add(f.issuedFrom!.slice(0, 10))}::date`);
      if (isDay(f.issuedTo)) w.push(`ce."issuedAt" < (${p.add(f.issuedTo!.slice(0, 10))}::date + 1)`);
      return w;
    };

    const p = new Params();
    const where = filters(p);
    if (f.state !== 'all') where.push(STATE_SQL[f.state]);
    const order = f.state === 'expiring' ? `ce."expiresAt" ASC` : f.state === 'expired' ? `ce."expiresAt" DESC` : f.state === 'revoked' ? `ce."revokedAt" DESC NULLS LAST` : `ce."issuedAt" DESC NULLS LAST`;

    const cp = new Params();
    const countWhere = filters(cp);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      zite.sql({ query: `SELECT ${CERT_COLUMNS} ${CERT_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order}, ce.created_at DESC LIMIT ${f.limit} OFFSET ${f.offset}`, params: p.values }),
      zite.sql({
        query: `SELECT COUNT(*) AS "allTotal",
                  COUNT(*) FILTER (WHERE ${STATE_SQL.active}) AS "activeTotal",
                  COUNT(*) FILTER (WHERE ${STATE_SQL.expiring}) AS "expiringTotal",
                  COUNT(*) FILTER (WHERE ${STATE_SQL.expired}) AS "expiredTotal",
                  COUNT(*) FILTER (WHERE ${STATE_SQL.revoked}) AS "revokedTotal"
                ${CERT_FROM} ${countWhere.length ? `WHERE ${countWhere.join(' AND ')}` : ''}`,
        params: cp.values,
      }),
    ]);
    const c = countRows[0] ?? {};
    const counts = { active: num(c.activeTotal), expiring: num(c.expiringTotal), expired: num(c.expiredTotal), revoked: num(c.revokedTotal), all: num(c.allTotal) };
    return { rows: rows.map(mapCertificateRow), total: f.state === 'all' ? counts.all : counts[f.state], counts };
  },
});
