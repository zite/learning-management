import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getSettings, rememberLearnUrl } from '@project/shared/server/settings';

/**
 * The academy's public face: name, branding and how people get in. Anyone on
 * the internet can call it (the sign-in screen needs it), so it carries no
 * courses, people or counts.
 */
export default createEndpoint({
  description: "The academy's branding and sign-in policy",
  authenticated: false,
  inputSchema: z.object({}),
  execute: async () => {
    const settings = await rememberLearnUrl(await getSettings());
    return {
      organizationName: settings.organizationName,
      academyName: settings.academyName,
      academyHeadline: settings.academyHeadline,
      academyIntro: settings.academyIntro,
      logoUrl: settings.logoUrl && /^https:\/\//i.test(settings.logoUrl) ? settings.logoUrl : null,
      brandColor: settings.brandColor,
      supportEmail: settings.supportEmail,
      websiteUrl: settings.websiteUrl,
      signInPolicy: settings.signInPolicy,
      timezone: settings.timezone,
    };
  },
});
