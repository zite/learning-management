import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { POINTS } from '@project/shared/progress';
import { getLearner } from '@project/shared/server/people';
import { getSettings } from '@project/shared/server/settings';
import { pointsSince, publicName, totalPoints, type PointsRow } from '../server/learn';

/**
 * The academy leaderboard. Points come from finishing things — never from
 * time spent — so they're easy to explain and hard to game. Other people
 * appear by first name and last initial; nobody's email or id is exposed.
 */

const Input = z.object({
  period: z.enum(['month', 'quarter', 'all']).default('month'),
});

export type LeaderboardEntry = {
  rank: number;
  name: string;
  title: string | null;
  color: string;
  avatarUrl: string | null;
  points: number;
  isMe: boolean;
};

export type LeaderboardOutput = {
  period: 'month' | 'quarter' | 'all';
  since: string | null;
  entries: LeaderboardEntry[];
  me:
    | (LeaderboardEntry & {
        breakdown: {
          lessons: number;
          courses: number;
          paths: number;
          quizPasses: number;
          perfectQuizzes: number;
        };
        /** Points to reach the next score above yours; null at the top or with no points. */
        pointsToNext: number | null;
        /** How many other people share your score (and so your rank). */
        tiedWith: number;
      })
    | null;
  participants: number;
  rules: typeof POINTS;
};

function periodStart(period: 'month' | 'quarter' | 'all', now = new Date()) {
  if (period === 'all') return null;
  const month = period === 'month' ? now.getUTCMonth() : Math.floor(now.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(now.getUTCFullYear(), month, 1)).toISOString();
}

export default createEndpoint({
  description: 'The academy leaderboard',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<LeaderboardOutput> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Choose this month, this quarter or all time.', 'BAD_REQUEST');
    const settings = await getSettings();
    const actor = await getLearner(context, settings);
    if (!settings.leaderboardEnabled) throw new ZiteError(`The leaderboard is turned off in ${settings.academyName}.`, 'FORBIDDEN');

    const { period } = parsed.data;
    const since = periodStart(period);
    const rows = await pointsSince(since);
    const scored = rows.map((r: PointsRow) => ({ row: r, points: totalPoints(r) })).sort((a, b) => b.points - a.points || a.row.name.localeCompare(b.row.name));

    // Standard competition ranking: 1, 2, 2, 4.
    let rank = 0;
    let previous = -1;
    const ranked = scored.map((s, i) => {
      if (s.points !== previous) {
        rank = i + 1;
        previous = s.points;
      }
      return { ...s, rank };
    });
    const toEntry = (s: (typeof ranked)[number]): LeaderboardEntry => ({
      rank: s.rank,
      name: s.row.id === actor.id ? s.row.name : publicName(s.row.name),
      title: s.row.title,
      color: s.row.color,
      avatarUrl: s.row.avatarUrl,
      points: s.points,
      isMe: s.row.id === actor.id,
    });

    const withPoints = ranked.filter(s => s.points > 0);
    const mine = ranked.find(s => s.row.id === actor.id);
    const above = mine && mine.points > 0 ? withPoints.filter(s => s.points > mine.points).pop() : undefined;
    return {
      period,
      since,
      // The top 20, plus anyone tied with 20th so a shared rank is never cut in half.
      entries: withPoints.filter((s, i) => i < 20 || (withPoints.length > 20 && s.rank === withPoints[19].rank)).map(toEntry),
      me: mine
        ? {
            ...toEntry(mine),
            rank: mine.points > 0 ? mine.rank : 0,
            breakdown: {
              lessons: mine.row.lessons,
              courses: mine.row.courses,
              paths: mine.row.paths,
              quizPasses: mine.row.quizPasses,
              perfectQuizzes: mine.row.perfectQuizzes,
            },
            pointsToNext: above ? above.points - mine.points : null,
            tiedWith: mine.points > 0 ? withPoints.filter(s => s.points === mine.points).length - 1 : 0,
          }
        : null,
      participants: withPoints.length,
      rules: POINTS,
    };
  },
});
