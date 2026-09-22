import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { enrollInCourse, enrollInPath } from '@project/shared/server/enroll';
import { assertStaff, getActor } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';

/**
 * Assign a course or learning path to people and/or everyone in some groups.
 * Idempotent: people already enrolled are skipped and reported, so it's safe
 * to assign a group again after new people join it.
 */

const Input = z.object({
  targetType: z.enum(['Course', 'Path']),
  targetId: z.string().min(1),
  personIds: z.array(z.string()).max(5000).default([]),
  groupIds: z.array(z.string()).max(200).default([]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31').nullable().default(null),
  sendEmail: z.boolean().default(true),
});

export default createEndpoint({
  description: 'Enroll people or groups in a course or learning path',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ created: z.number(), reactivated: z.number(), skipped: z.number(), skippedInactive: z.number(), audience: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid input', 'BAD_REQUEST');
    const { targetType, targetId, personIds, groupIds, dueDate, sendEmail } = parsed.data;

    const ids = new Set(personIds);
    if (groupIds.length) {
      const { rows } = await zite.sql({ query: `SELECT DISTINCT "personId" FROM "GroupMembers" WHERE "groupId" = ANY($1::text[])`, params: [groupIds] });
      for (const r of rows) ids.add(String(r.personId));
    }
    if (!ids.size) throw new ZiteError('Choose at least one person or a group with people in it', 'BAD_REQUEST');
    if (dueDate && dueDate < new Date().toISOString().slice(0, 10)) throw new ZiteError('The due date is in the past', 'BAD_REQUEST');

    const settings = await getSettings();
    const common = { personIds: [...ids], source: 'Assigned' as const, assignedById: actor.id, dueDate, notify: sendEmail, settings };
    const res = targetType === 'Path' ? await enrollInPath({ ...common, pathId: targetId }) : await enrollInCourse({ ...common, courseId: targetId });
    return { created: res.created.length, reactivated: res.reactivated.length, skipped: res.skipped, skippedInactive: res.skippedInactive, audience: ids.size };
  },
});
