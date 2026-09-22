import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertStaff, getActor } from '@project/shared/server/people';
import { bool, ref, str, withRetry } from '@project/shared/server/sql';
import { httpsUrl, inputError } from '../server/settings-admin';

/**
 * The signed-in person's own profile: name, job title, bio, photo and whether
 * they get non-essential email. Always acts on the session's person, never an
 * id from the request. Called with nothing to change, it just returns the
 * profile — that's how the Profile screen loads it.
 */

const Input = z.object({
  name: z.string().trim().min(1, "Your name can't be empty").max(120, 'Keep your name under 120 characters').optional(),
  title: z.string().trim().max(120, 'Keep your job title under 120 characters').optional(),
  bio: z.string().trim().max(1000, 'Keep your bio under 1,000 characters').optional(),
  avatarUrl: z.string().max(2000).nullable().optional(),
  muteEmails: z.boolean().optional(),
});

const Output = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['Admin', 'Instructor', 'Learner']),
  title: z.string(),
  bio: z.string(),
  avatarUrl: z.string().nullable(),
  color: z.string(),
  muteEmails: z.boolean(),
});

export default createEndpoint({
  description: 'Read or update your own profile',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw inputError(parsed.error);
    const v = parsed.data;

    const patch: Record<string, unknown> = {};
    if (v.name !== undefined) patch.name = v.name;
    if (v.title !== undefined) patch.title = v.title;
    if (v.bio !== undefined) patch.bio = v.bio;
    if (v.avatarUrl !== undefined) patch.avatarUrl = httpsUrl(v.avatarUrl, 'photo address');
    if (v.muteEmails !== undefined) patch.muteEmails = v.muteEmails;
    if (Object.keys(patch).length) await withRetry(() => zite.people.update({ id: actor.id, record: patch as never }));

    const { rows } = await zite.sql({ query: `SELECT "name", "email", "title", "bio", "avatarUrl", "color", "muteEmails" FROM "People" WHERE id::text = $1`, params: [actor.id] });
    const r = rows[0] ?? {};
    return {
      id: actor.id,
      name: str(r.name) || actor.name,
      email: str(r.email) || actor.email,
      role: actor.role,
      title: str(r.title) ?? '',
      bio: str(r.bio) ?? '',
      avatarUrl: ref(r.avatarUrl),
      color: str(r.color) || '#2f6b55',
      muteEmails: bool(r.muteEmails),
    };
  },
});
