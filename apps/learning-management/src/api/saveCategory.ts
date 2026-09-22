import { z } from 'zod';
import { PALETTE } from '@project/shared/palette';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertAdmin, getActor } from '@project/shared/server/people';
import { eachWrite, num, withRetry } from '@project/shared/server/sql';
import { HEX_RE, inputError } from '../server/settings-admin';

/**
 * Catalog categories: create, edit, delete and reorder. Deleting one leaves
 * its courses and paths uncategorised rather than pointing at nothing.
 */

const name = z.string().trim().min(1, 'Name the category').max(60, 'Category names can be at most 60 characters');
const description = z.string().trim().max(300, 'Keep the description under 300 characters');
const color = z.string().regex(HEX_RE, 'Use a six-digit hex colour, like #10b981');
const icon = z.string().trim().max(16, 'Use a single emoji for the icon');

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name, description: description.optional(), color: color.optional(), icon: icon.optional() }),
  z.object({ action: z.literal('update'), id: z.string().min(1), name: name.optional(), description: description.optional(), color: color.optional(), icon: icon.optional() }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
  z.object({ action: z.literal('reorder'), order: z.array(z.string().min(1)).max(500) }),
]);

const Output = z.object({
  id: z.string().nullable(),
  /** For a delete: how many courses and paths are now uncategorised. */
  uncategorised: z.object({ courses: z.number(), paths: z.number() }),
});

export default createEndpoint({
  description: 'Create, update, delete or reorder catalog categories',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertAdmin(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw inputError(parsed.error, "That category change couldn't be read");
    const v = parsed.data;
    const none = { courses: 0, paths: 0 };

    const clash = async (candidate: string, exceptId: string | null) => {
      const { rows } = await zite.sql({
        query: `SELECT "name" FROM "Categories" WHERE LOWER(TRIM("name")) = LOWER($1::text) AND id::text <> $2::text LIMIT 1`,
        params: [candidate, exceptId ?? ''],
      });
      if (rows[0]) throw new ZiteError(`There’s already a category called “${rows[0].name}”.`, 'CONFLICT');
    };

    if (v.action === 'reorder') {
      const { rows } = await zite.sql({ query: `SELECT id::text AS id, "position" FROM "Categories"`, params: [] });
      const current = new Map(rows.map(r => [String(r.id), num(r.position, -1)]));
      const order = [...new Set(v.order)].filter(id => current.has(id));
      // Anything the client didn't know about (created elsewhere meanwhile) keeps its place after the rest.
      const rest = [...current.keys()].filter(id => !order.includes(id)).sort((a, b) => current.get(a)! - current.get(b)!);
      const changes = [...order, ...rest].map((id, position) => ({ id, position })).filter(c => current.get(c.id) !== c.position);
      await eachWrite(changes, c => zite.categories.update({ id: c.id, record: { position: c.position } }));
      return { id: null, uncategorised: none };
    }

    if (v.action === 'create') {
      await clash(v.name, null);
      const { rows } = await zite.sql({ query: `SELECT COALESCE(MAX("position"), -1) AS "top", COUNT(*) AS "total" FROM "Categories"`, params: [] });
      const created = await withRetry(() => zite.categories.create({
        record: {
          name: v.name,
          description: v.description ?? '',
          color: v.color ?? PALETTE[num(rows[0]?.total) % PALETTE.length],
          icon: v.icon ?? '',
          position: num(rows[0]?.top, -1) + 1,
        },
      }));
      return { id: created.id, uncategorised: none };
    }

    // Looked up by text, so a malformed id reads as "not found" rather than a database error.
    const { rows: found } = await zite.sql({ query: `SELECT id::text AS id, "name" FROM "Categories" WHERE id::text = $1 LIMIT 1`, params: [v.id] });
    const existing = found[0] as { id: string; name: string } | undefined;
    if (!existing) throw new ZiteError('That category no longer exists. Someone may have deleted it.', 'NOT_FOUND');

    if (v.action === 'update') {
      const patch: Record<string, unknown> = {};
      if (v.name !== undefined && v.name !== existing.name) {
        await clash(v.name, v.id);
        patch.name = v.name;
      }
      if (v.description !== undefined) patch.description = v.description;
      if (v.color !== undefined) patch.color = v.color;
      if (v.icon !== undefined) patch.icon = v.icon;
      if (Object.keys(patch).length) await withRetry(() => zite.categories.update({ id: v.id, record: patch as never }));
      return { id: v.id, uncategorised: none };
    }

    // Delete: unlink first, so an interrupted delete never leaves courses in a category that's gone.
    const [{ rows: courseRows }, { rows: pathRows }] = await Promise.all([
      zite.sql({ query: `SELECT id::text AS id FROM "Courses" WHERE "categoryId" = $1`, params: [v.id] }),
      zite.sql({ query: `SELECT id::text AS id FROM "Paths" WHERE "categoryId" = $1`, params: [v.id] }),
    ]);
    await eachWrite(courseRows, r => zite.courses.update({ id: String(r.id), record: { categoryId: null } }));
    await eachWrite(pathRows, r => zite.paths.update({ id: String(r.id), record: { categoryId: null } }));
    await withRetry(() => zite.categories.delete({ id: v.id }));
    return { id: v.id, uncategorised: { courses: courseRows.length, paths: pathRows.length } };
  },
});
