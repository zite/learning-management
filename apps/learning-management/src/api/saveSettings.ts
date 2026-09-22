import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertAdmin, getActor } from '@project/shared/server/people';
import { getSettings, parseDomains } from '@project/shared/server/settings';
import { withRetry } from '@project/shared/server/sql';
import { EMAIL_RE, HEX_RE, httpsUrl, inputError, isValidTimezone, settingsPayload, settingsSchema } from '../server/settings-admin';

/**
 * Change organization settings. Every field is optional — send only what
 * changed — and each is validated on its own terms, with messages written for
 * the person who typed the value. Returns the whole settings object so the
 * client can replace its cached copy.
 */

const text = (label: string, max: number) => z.string().max(max, `${label} can be at most ${max} characters`);
const required = (label: string, max: number) => z.string().trim().min(1, `${label} can't be empty`).max(max, `${label} can be at most ${max} characters`);

const Input = z.object({
  organizationName: required('Your organization’s name', 120).optional(),
  logoUrl: z.string().max(2000).nullable().optional(),
  websiteUrl: z.string().max(2000).nullable().optional(),
  supportEmail: z.string().max(320).nullable().optional(),
  timezone: z.string().max(80).optional(),
  emailSignature: text('The email signature', 1000).optional(),
  defaultStaffRole: z.enum(['Instructor', 'Learner'], { errorMap: () => ({ message: 'New staff join as an Instructor or a Learner' }) }).optional(),

  academyName: required('The academy name', 80).optional(),
  academyHeadline: required('The headline', 160).optional(),
  academyIntro: required('The introduction', 2000).optional(),
  brandColor: z.string().optional(),
  signInPolicy: z.enum(['Invited only', 'Allowed domains', 'Anyone'], { errorMap: () => ({ message: 'Choose who can sign in to the academy' }) }).optional(),
  /** A list, or one string separated by commas, spaces or new lines. */
  allowedDomains: z.union([z.array(z.string().max(253)).max(50, 'Add at most 50 domains'), z.string().max(4000)]).optional(),
  selfEnrollment: z.boolean().optional(),
  leaderboardEnabled: z.boolean().optional(),
  discussionsEnabled: z.boolean().optional(),

  reminderDaysBefore: z.number({ invalid_type_error: 'Reminder days must be a number' }).int('Reminder days must be a whole number').min(0, 'Reminders can be sent 0 to 30 days before the due date').max(30, 'Reminders can be sent 0 to 30 days before the due date').optional(),
  escalateOverdue: z.boolean().optional(),

  certificateTitle: required('The certificate title', 80).optional(),
  certificateSignatory: text('The signatory name', 80).optional(),
  certificateSignatoryTitle: text('The signatory title', 80).optional(),
});

export default createEndpoint({
  description: 'Update organization, academy, notification and certificate settings',
  authenticated: true,
  inputSchema: Input,
  outputSchema: settingsSchema,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertAdmin(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw inputError(parsed.error);
    const v = parsed.data;
    const settings = await getSettings();
    const patch: Record<string, unknown> = {};

    if (v.organizationName !== undefined) patch.organizationName = v.organizationName;
    if (v.logoUrl !== undefined) patch.logoUrl = httpsUrl(v.logoUrl, 'logo address');
    if (v.websiteUrl !== undefined) patch.websiteUrl = httpsUrl(v.websiteUrl, 'website');
    if (v.supportEmail !== undefined) {
      const email = (v.supportEmail ?? '').trim().toLowerCase();
      if (email && !EMAIL_RE.test(email)) throw new ZiteError(`“${email}” isn't an email address. Replies go here, so use one your team reads.`, 'BAD_REQUEST');
      patch.supportEmail = email || null;
    }
    if (v.timezone !== undefined) {
      if (!isValidTimezone(v.timezone)) throw new ZiteError(`“${v.timezone}” isn't a time zone we recognise. Pick one from the list, like America/New_York.`, 'BAD_REQUEST');
      patch.timezone = v.timezone;
    }
    if (v.emailSignature !== undefined) patch.emailSignature = v.emailSignature.replace(/\r\n/g, '\n').trim();
    if (v.defaultStaffRole !== undefined) patch.defaultStaffRole = v.defaultStaffRole;

    if (v.academyName !== undefined) patch.academyName = v.academyName;
    if (v.academyHeadline !== undefined) patch.academyHeadline = v.academyHeadline;
    if (v.academyIntro !== undefined) patch.academyIntro = v.academyIntro.replace(/\r\n/g, '\n');
    if (v.brandColor !== undefined) {
      const hex = v.brandColor.trim().toLowerCase();
      const full = /^#?[0-9a-f]{3}$/.test(hex) ? `#${hex.replace('#', '').split('').map(c => c + c).join('')}` : hex.startsWith('#') ? hex : `#${hex}`;
      if (!HEX_RE.test(full)) throw new ZiteError('Use a six-digit hex colour, like #2f7a55.', 'BAD_REQUEST');
      patch.brandColor = full;
    }

    // Domains: normalise, and say exactly which entries couldn't be used instead of silently dropping them.
    let domains = settings.allowedDomains;
    if (v.allowedDomains !== undefined) {
      const entries = (Array.isArray(v.allowedDomains) ? v.allowedDomains : v.allowedDomains.split(/[\s,;]+/)).map(d => d.trim()).filter(Boolean);
      const bad = entries.filter(d => parseDomains(d).length === 0);
      if (bad.length) {
        throw new ZiteError(
          bad.length === 1
            ? `“${bad[0]}” isn't a domain. Use the part after the @, like fernwood.com.`
            : `${bad.slice(0, 3).map(d => `“${d}”`).join(', ')}${bad.length > 3 ? ` and ${bad.length - 3} more` : ''} aren't domains. Use the part after the @, like fernwood.com.`,
          'BAD_REQUEST',
        );
      }
      if (entries.some(d => /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|aol|proton|protonmail)\.[a-z.]+$/i.test(d.replace(/^@/, '')))) {
        throw new ZiteError('Public email providers like gmail.com would let anyone in. Choose “Anyone with the link” if that’s what you want.', 'BAD_REQUEST');
      }
      domains = [...new Set(parseDomains(entries.join(',')))];
      patch.allowedDomains = domains.join(', ');
    }
    const policy = v.signInPolicy ?? settings.signInPolicy;
    if (v.signInPolicy !== undefined) patch.signInPolicy = v.signInPolicy;
    if (policy === 'Allowed domains' && domains.length === 0 && (v.signInPolicy !== undefined || v.allowedDomains !== undefined)) {
      throw new ZiteError('Add at least one email domain, or choose a different sign-in option.', 'BAD_REQUEST');
    }
    if (v.selfEnrollment !== undefined) patch.selfEnrollment = v.selfEnrollment;
    if (v.leaderboardEnabled !== undefined) patch.leaderboardEnabled = v.leaderboardEnabled;
    if (v.discussionsEnabled !== undefined) patch.discussionsEnabled = v.discussionsEnabled;

    if (v.reminderDaysBefore !== undefined) patch.reminderDaysBefore = v.reminderDaysBefore;
    if (v.escalateOverdue !== undefined) patch.escalateOverdue = v.escalateOverdue;

    if (v.certificateTitle !== undefined) patch.certificateTitle = v.certificateTitle;
    if (v.certificateSignatory !== undefined) patch.certificateSignatory = v.certificateSignatory.trim();
    if (v.certificateSignatoryTitle !== undefined) patch.certificateSignatoryTitle = v.certificateSignatoryTitle.trim();

    if (Object.keys(patch).length) await withRetry(() => zite.settings.update({ id: settings.id, record: patch as never }));
    return settingsPayload(await getSettings());
  },
});
