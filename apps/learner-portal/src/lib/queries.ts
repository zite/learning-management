import { useQuery } from '@tanstack/react-query';
import { getAcademy, getMe, type GetAcademyOutputType, type GetMeOutputType } from 'zitejs/api';
import { useSession } from './auth';
import { errorStatus } from './errors';

export type Academy = GetAcademyOutputType;
export type Me = GetMeOutputType;
export type MePerson = NonNullable<Me['person']>;

/**
 * Query keys. Feature areas add their own under a distinct first segment and
 * invalidate by it; the reserved roots are listed so two areas never collide.
 * A sign-out clears everything except `academy`.
 */
export const qk = {
  academy: ['academy'] as const,
  me: ['me'] as const,
  // Reserved for feature areas:
  homeRoot: ['home'] as const,
  learningRoot: ['learning'] as const,
  catalogRoot: ['catalog'] as const,
  courseRoot: ['course'] as const,
  playerRoot: ['player'] as const,
  lessonRoot: ['lesson'] as const,
  commentsRoot: ['comments'] as const,
  pathRoot: ['path'] as const,
  certificatesRoot: ['certificates'] as const,
  sessionsRoot: ['sessions'] as const,
  teamRoot: ['team'] as const,
  leaderboardRoot: ['leaderboard'] as const,
  notificationsRoot: ['notifications'] as const,
};

// Don't hammer an endpoint that said "not yours" or "not found".
export const retry = (count: number, e: unknown) => {
  const s = errorStatus(e);
  if (s && s >= 400 && s < 500) return false;
  return count < 2;
};

export function useAcademy() {
  return useQuery({ queryKey: qk.academy, queryFn: () => getAcademy({}), staleTime: 5 * 60_000, retry });
}

export function useMe() {
  const { user } = useSession();
  return useQuery({ queryKey: qk.me, queryFn: () => getMe({}), enabled: Boolean(user), staleTime: 30_000, retry, refetchOnWindowFocus: true });
}
