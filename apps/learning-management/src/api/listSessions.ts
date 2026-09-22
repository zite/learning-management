import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { num, Params } from '@project/shared/server/sql';
import { mapSessionRow, SESSION_COLUMNS, SESSION_FROM, sessionRowSchema } from '../server/sessions';

/**
 * Live sessions for the agenda and the month calendar. "Upcoming" includes a
 * session that is live right now; "past" means it has ended. Counts per scope
 * follow the course and instructor filters, so the tabs always agree with the
 * list under them.
 */

const Input = z.object({
  scope: z.enum(['upcoming', 'past', 'cancelled', 'all']).default('upcoming'),
  courseId: z.string().optional(),
  instructorId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(1000).default(500),
});

const Output = z.object({
  sessions: z.array(sessionRowSchema),
  counts: z.object({ upcoming: z.number(), past: z.number(), cancelled: z.number() }),
});

const END = `COALESCE(s."endsAt", s."startsAt")`;

export default createEndpoint({
  description: 'List live sessions with registration counts',
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
      if (f.courseId) w.push(`s."courseId" = ${p.add(f.courseId)}`);
      if (f.instructorId) w.push(`s."instructorId" = ${p.add(f.instructorId)}`);
      if (f.from && !Number.isNaN(Date.parse(f.from))) w.push(`s."startsAt" >= ${p.add(new Date(f.from).toISOString())}::timestamptz`);
      if (f.to && !Number.isNaN(Date.parse(f.to))) w.push(`s."startsAt" < ${p.add(new Date(f.to).toISOString())}::timestamptz`);
      return w;
    };

    const p = new Params();
    const where = filters(p);
    if (f.scope === 'upcoming') where.push(`COALESCE(s."status", '') <> 'Cancelled' AND ${END} >= NOW()`);
    if (f.scope === 'past') where.push(`COALESCE(s."status", '') <> 'Cancelled' AND ${END} < NOW()`);
    if (f.scope === 'cancelled') where.push(`s."status" = 'Cancelled'`);
    const order = f.scope === 'upcoming' ? `s."startsAt" ASC NULLS LAST` : f.scope === 'all' ? `s."startsAt" ASC NULLS LAST` : `s."startsAt" DESC NULLS LAST`;

    const cp = new Params();
    const countWhere = filters(cp);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      zite.sql({ query: `SELECT ${SESSION_COLUMNS} ${SESSION_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ${f.limit}`, params: p.values }),
      zite.sql({
        query: `SELECT
                  COUNT(*) FILTER (WHERE COALESCE(s."status", '') <> 'Cancelled' AND ${END} >= NOW()) AS "upcomingTotal",
                  COUNT(*) FILTER (WHERE COALESCE(s."status", '') <> 'Cancelled' AND ${END} < NOW()) AS "pastTotal",
                  COUNT(*) FILTER (WHERE s."status" = 'Cancelled') AS "cancelledTotal"
                FROM "Sessions" s ${countWhere.length ? `WHERE ${countWhere.join(' AND ')}` : ''}`,
        params: cp.values,
      }),
    ]);
    const c = countRows[0] ?? {};
    return { sessions: rows.map(mapSessionRow), counts: { upcoming: num(c.upcomingTotal), past: num(c.pastTotal), cancelled: num(c.cancelledTotal) } };
  },
});
