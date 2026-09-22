import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { renderMerge, sampleMergeContext } from '@project/shared/merge';
import { sendEmail } from '@project/shared/server/email';
import { assertAdmin, getActor } from '@project/shared/server/people';
import { getSettings, learnLink } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { inputError } from '../server/settings-admin';

/**
 * Send a template — saved, or the unsaved draft on screen — to yourself,
 * filled in with the same sample data as the preview but your organization's
 * real name, logo, signature and reply-to address.
 */

const Input = z.object({
  templateId: z.string().optional(),
  subject: z.string().max(200, 'Keep the subject under 200 characters').optional(),
  body: z.string().max(20000, 'That message is too long to send').optional(),
});

const Output = z.object({ to: z.string(), status: z.enum(['Sent', 'Failed', 'Skipped']) });

export default createEndpoint({
  description: 'Send a test of an email template to yourself',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertAdmin(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw inputError(parsed.error);
    const v = parsed.data;

    let subject = v.subject;
    let body = v.body;
    if (subject === undefined || body === undefined) {
      if (!v.templateId) throw new ZiteError('Choose a template to test, or write a subject and message.', 'BAD_REQUEST');
      const { rows } = await zite.sql({ query: `SELECT "subject", "body" FROM "EmailTemplates" WHERE id::text = $1 LIMIT 1`, params: [v.templateId] });
      if (!rows[0]) throw new ZiteError('That template no longer exists.', 'NOT_FOUND');
      subject ??= str(rows[0].subject) ?? '';
      body ??= str(rows[0].body) ?? '';
    }
    if (!subject.trim() || !body.trim()) throw new ZiteError('Add a subject and a message before sending a test.', 'BAD_REQUEST');

    const settings = await getSettings();
    const academyLink = learnLink(settings);
    const ctx = {
      ...sampleMergeContext(),
      organization_name: settings.organizationName,
      academy_name: settings.academyName,
      ...(academyLink ? { academy_link: academyLink } : {}),
    };

    // Demo addresses use reserved example domains, which never receive mail.
    if (/@([a-z0-9-]+\.)*example\.(com|org|net)$/i.test(actor.email)) return { to: actor.email, status: 'Skipped' };

    const status = await sendEmail({
      to: actor.email,
      subject: `[Test] ${renderMerge(subject, ctx)}`,
      text: renderMerge(body, ctx),
      settings,
      button: academyLink ? { label: 'Open in the academy', href: academyLink } : null,
    });
    return { to: actor.email, status };
  },
});
