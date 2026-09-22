import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { assertAdmin, getActor } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { runDailyReminders } from '../server/reminders';

/**
 * The daily reminder run, every day at 14:00 UTC: due-soon and overdue
 * nudges, the weekly manager digest, recertification, expiring certificates
 * and tomorrow's sessions. Idempotent — see server/reminders.ts. Admins can
 * also run it by hand; a scheduled run has no signed-in user.
 */

const Output = z.object({
  dueSoon: z.number(),
  overdue: z.number(),
  managerDigests: z.number(),
  recertified: z.number(),
  expiringCertificates: z.number(),
  sessionReminders: z.number(),
});

export default createEndpoint({
  description: 'Send daily due-date, overdue, manager, recertification, certificate and session reminders',
  // Like merit's scheduled job: no `authenticated` flag, so the cron fire (which has no session) is never refused.
  schedule: {
    scheduleType: 'recurring',
    schedule: { frequency: 'daily', interval: 1, times: ['14:00'] },
    timezone: 'UTC',
    overlapPolicy: 'skip',
  },
  inputSchema: z.object({}),
  outputSchema: Output,
  execute: async ({ context }): Promise<z.infer<typeof Output>> => {
    // Scheduled runs have no user; a manual run must come from an admin.
    if (context?.user) assertAdmin(await getActor(context as never));
    const settings = await getSettings();
    return runDailyReminders(settings);
  },
});
