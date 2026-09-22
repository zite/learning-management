import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { DEFAULT_TEMPLATES, TEMPLATE_TRIGGERS, type TemplateTrigger } from '@project/shared/server/email';
import { assertAdmin, getActor } from '@project/shared/server/people';
import { bool, num, str, withRetry } from '@project/shared/server/sql';
import { inputError } from '../server/settings-admin';

/**
 * Edit the automatic emails. There is one template per trigger; saving a
 * trigger that has no row yet (an install from before that trigger existed)
 * creates it from the default, so every trigger in Settings is editable.
 */

const trigger = z.enum(TEMPLATE_TRIGGERS as [TemplateTrigger, ...TemplateTrigger[]], { errorMap: () => ({ message: "That isn't an email this app sends" }) });

const Input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    id: z.string().optional(),
    trigger,
    subject: z.string().trim().min(1, 'Add a subject line').max(200, 'Keep the subject under 200 characters').optional(),
    body: z.string().trim().min(1, 'Write the message').max(20000, 'That message is too long — keep it under 20,000 characters').optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({ action: z.literal('restoreDefault'), id: z.string().optional(), trigger }),
]);

const Output = z.object({ id: z.string(), name: z.string(), subject: z.string(), body: z.string(), trigger: z.string(), enabled: z.boolean(), position: z.number() });

async function findRow(id: string | undefined, t: TemplateTrigger) {
  const { rows } = await zite.sql({
    query: `SELECT * FROM "EmailTemplates" WHERE ${id ? 'id::text = $1 AND ' : ''}"trigger" = $${id ? 2 : 1} ORDER BY COALESCE("position", 0) ASC, created_at ASC LIMIT 1`,
    params: id ? [id, t] : [t],
  });
  return rows[0] as Record<string, unknown> | undefined;
}

const toOutput = (r: Record<string, unknown>): z.infer<typeof Output> => ({
  id: String(r.id),
  name: str(r.name) ?? '',
  subject: str(r.subject) ?? '',
  body: str(r.body) ?? '',
  trigger: str(r.trigger) ?? '',
  enabled: bool(r.enabled),
  position: num(r.position),
});

export default createEndpoint({
  description: 'Edit, switch on or off, or restore an automatic email template',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertAdmin(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw inputError(parsed.error, "That template change couldn't be read");
    const v = parsed.data;
    const fallback = DEFAULT_TEMPLATES.find(t => t.trigger === v.trigger);
    if (!fallback) throw new ZiteError("That isn't an email this app sends", 'BAD_REQUEST');

    // An id that no longer matches (deleted, or a different trigger) falls back to the trigger's own row.
    const existing = (v.id ? await findRow(v.id, v.trigger) : undefined) ?? (await findRow(undefined, v.trigger));

    const patch: Record<string, unknown> =
      v.action === 'restoreDefault'
        ? { name: fallback.name, subject: fallback.subject, body: fallback.body }
        : {
            ...(v.subject !== undefined ? { subject: v.subject } : {}),
            ...(v.body !== undefined ? { body: v.body.replace(/\r\n/g, '\n') } : {}),
            ...(v.enabled !== undefined ? { enabled: v.enabled } : {}),
          };

    if (!existing) {
      const { rows } = await zite.sql({ query: `SELECT COALESCE(MAX("position"), -1) AS "top" FROM "EmailTemplates"`, params: [] });
      const order = TEMPLATE_TRIGGERS.indexOf(v.trigger);
      const created = await withRetry(() =>
        zite.emailTemplates.create({
          record: { name: fallback.name, subject: fallback.subject, body: fallback.body, trigger: v.trigger, enabled: fallback.enabled, position: Math.max(order, num(rows[0]?.top, -1) + 1), ...patch },
        }),
      );
      return toOutput(created as unknown as Record<string, unknown>);
    }

    if (Object.keys(patch).length) await withRetry(() => zite.emailTemplates.update({ id: String(existing.id), record: patch as never }));
    return toOutput({ ...existing, ...patch });
  },
});
