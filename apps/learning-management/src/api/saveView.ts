import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';

/** Create, rename, reshare or delete a saved view. Anyone can use a shared view; only its owner or an admin can change it. */

const Input = z.object({
  id: z.string().optional(),
  delete: z.boolean().optional(),
  name: z.string().trim().min(1, 'Name the view').max(80).optional(),
  scope: z.enum(['Personal', 'Shared']).optional(),
  page: z.string().max(40).optional(),
  config: z.string().max(20000).optional(),
});

export default createEndpoint({
  description: 'Create, update or delete a saved view',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Invalid view', 'BAD_REQUEST');
    const v = parsed.data;
    if (v.config) {
      try {
        JSON.parse(v.config);
      } catch {
        throw new ZiteError("That view's filters couldn't be read", 'BAD_REQUEST');
      }
    }
    if (v.id) {
      const existing = await zite.views.findOne({ id: v.id });
      if (!existing) throw new ZiteError('That view no longer exists', 'NOT_FOUND');
      if (existing.ownerId !== actor.id && actor.role !== 'Admin') throw new ZiteError('Only the person who made this view can change it', 'FORBIDDEN');
      if (v.delete) {
        await zite.views.delete({ id: v.id });
        return { id: v.id };
      }
      const patch: Record<string, unknown> = {};
      if (v.name !== undefined) patch.name = v.name;
      if (v.scope !== undefined) patch.scope = v.scope;
      if (v.config !== undefined) patch.config = v.config;
      await zite.views.update({ id: v.id, record: patch as never });
      return { id: v.id };
    }
    if (!v.name) throw new ZiteError('Name the view', 'BAD_REQUEST');
    const { rows } = await zite.sql({ query: `SELECT COALESCE(MAX("position"), 0) AS "top" FROM "Views"`, params: [] });
    const created = await zite.views.create({ record: { name: v.name, ownerId: actor.id, scope: v.scope ?? 'Personal', page: v.page ?? 'enrollments', config: v.config ?? '{}', position: Number(rows[0]?.top ?? 0) + 1 } });
    return { id: created.id };
  },
});
