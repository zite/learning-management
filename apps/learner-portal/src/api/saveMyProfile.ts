import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getLearner } from '@project/shared/server/people';

/**
 * The learner edits their own profile. Email comes from sign-in and role,
 * manager and status are managed by admins, so none of those can change here.
 */

const Input = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120, 'Keep your name under 120 characters.'),
  title: z.string().trim().max(120, 'Keep your job title under 120 characters.').default(''),
  bio: z.string().trim().max(1000, 'Keep your bio under 1,000 characters.').default(''),
  avatarUrl: z.string().trim().max(1000).nullable().default(null),
  muteEmails: z.boolean(),
});

export default createEndpoint({
  description: 'Save your profile',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<{ name: string; title: string; bio: string; avatarUrl: string | null; muteEmails: boolean }> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Check your details and try again.', 'BAD_REQUEST');
    const actor = await getLearner(context);
    const { name, title, bio, muteEmails } = parsed.data;
    const avatarUrl = parsed.data.avatarUrl ? parsed.data.avatarUrl : null;
    if (avatarUrl && !/^https:\/\//i.test(avatarUrl)) throw new ZiteError('Upload a photo, or remove the current one.', 'BAD_REQUEST');
    await zite.people.update({ id: actor.id, record: { name, title: title || null, bio: bio || null, avatarUrl, muteEmails } as never });
    return { name, title, bio, avatarUrl, muteEmails };
  },
});
