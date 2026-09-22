import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelRegistration,
  enrollSelf,
  registerSession,
  getCatalog,
  getCertificate,
  getCourseOverview,
  getHome,
  getLeaderboard,
  getPath,
  getTeam,
  listMyCertificates,
  listMyLearning,
  listMyNotifications,
  listSessions,
  updateMyNotifications,
  verifyCertificate,
  type GetCatalogInputType,
  type GetCatalogOutputType,
  type GetCertificateOutputType,
  type GetCourseOverviewOutputType,
  type GetHomeOutputType,
  type GetLeaderboardOutputType,
  type GetPathOutputType,
  type GetTeamOutputType,
  type ListMyCertificatesOutputType,
  type ListMyLearningOutputType,
  type ListMyNotificationsOutputType,
  type ListSessionsOutputType,
  type VerifyCertificateOutputType,
} from 'zitejs/api';
import { qk, retry } from './queries';

/**
 * Queries for the learner app's pages (everything except the course player).
 * Each area keeps to its reserved root in `qk`, so a write can refresh exactly
 * what it touched.
 */

export type Home = GetHomeOutputType;
export type MyEnrollment = Home['todo'][number];
export type MyPathEnrollment = Home['paths'][number];
export type CourseCardData = Home['recommendations'][number];
export type CertificateSummary = Home['certificates'][number];
export type CertificateOrg = Home['org'];
export type HomeSession = Home['sessions'][number];
export type MyLearning = ListMyLearningOutputType;
export type Catalog = GetCatalogOutputType;
export type CatalogCourse = Catalog['courses'][number];
export type CatalogPath = Catalog['paths'][number];
export type CatalogFilters = GetCatalogInputType;
export type CourseOverview = GetCourseOverviewOutputType;
export type PathDetail = GetPathOutputType;
export type PathStep = PathDetail['steps'][number];
export type MyCertificates = ListMyCertificatesOutputType;
export type CertificateDetail = GetCertificateOutputType;
export type Verification = VerifyCertificateOutputType;
export type Sessions = ListSessionsOutputType;
export type LearnerSession = Sessions['upcoming'][number];
export type Team = GetTeamOutputType;
export type TeamMember = Team['members'][number];
export type TeamEnrollment = TeamMember['open'][number];
export type Leaderboard = GetLeaderboardOutputType;
export type LeaderboardPeriod = Leaderboard['period'];
export type Notifications = ListMyNotificationsOutputType;
export type LearnNotification = Notifications['items'][number];

export const learnKeys = {
  home: qk.homeRoot,
  learning: qk.learningRoot,
  catalog: (filters: CatalogFilters) => [...qk.catalogRoot, filters] as const,
  course: (slug: string) => [...qk.courseRoot, slug] as const,
  path: (slug: string) => [...qk.pathRoot, slug] as const,
  certificates: qk.certificatesRoot,
  certificate: (id: string) => [...qk.certificatesRoot, 'one', id] as const,
  verify: (credentialId: string) => [...qk.certificatesRoot, 'verify', credentialId] as const,
  sessions: qk.sessionsRoot,
  team: qk.teamRoot,
  leaderboard: (period: LeaderboardPeriod) => [...qk.leaderboardRoot, period] as const,
  notifications: (filter: 'all' | 'unread', limit: number) => [...qk.notificationsRoot, filter, limit] as const,
};

export function useHome() {
  return useQuery({ queryKey: learnKeys.home, queryFn: () => getHome({}), retry, staleTime: 20_000 });
}

export function useMyLearning() {
  return useQuery({ queryKey: learnKeys.learning, queryFn: () => listMyLearning({}), retry, staleTime: 20_000 });
}

export function useCatalog(filters: CatalogFilters, opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: learnKeys.catalog(filters), queryFn: () => getCatalog(filters), retry, staleTime: 60_000, placeholderData: keepPreviousData, enabled: opts.enabled ?? true });
}

export function useCourseOverview(slug: string | undefined) {
  return useQuery({ queryKey: learnKeys.course(slug ?? ''), queryFn: () => getCourseOverview({ slug: slug! }), retry, staleTime: 20_000, enabled: Boolean(slug) });
}

export function usePath(slug: string | undefined) {
  return useQuery({ queryKey: learnKeys.path(slug ?? ''), queryFn: () => getPath({ slug: slug! }), retry, staleTime: 20_000, enabled: Boolean(slug) });
}

export function useMyCertificates() {
  return useQuery({ queryKey: learnKeys.certificates, queryFn: () => listMyCertificates({}), retry, staleTime: 60_000 });
}

export function useCertificate(id: string | undefined) {
  return useQuery({ queryKey: learnKeys.certificate(id ?? ''), queryFn: () => getCertificate({ id: id! }), retry, staleTime: 60_000, enabled: Boolean(id) });
}

export function useVerification(credentialId: string | undefined) {
  return useQuery({ queryKey: learnKeys.verify(credentialId ?? ''), queryFn: () => verifyCertificate({ credentialId: credentialId! }), retry, staleTime: 60_000, enabled: Boolean(credentialId) });
}

export function useSessions() {
  return useQuery({ queryKey: learnKeys.sessions, queryFn: () => listSessions({}), retry, staleTime: 30_000 });
}

export function useTeam() {
  return useQuery({ queryKey: learnKeys.team, queryFn: () => getTeam({}), retry, staleTime: 30_000 });
}

export function useLeaderboard(period: LeaderboardPeriod) {
  return useQuery({ queryKey: learnKeys.leaderboard(period), queryFn: () => getLeaderboard({ period }), retry, staleTime: 60_000, placeholderData: keepPreviousData });
}

export function useNotifications(filter: 'all' | 'unread', limit = 50, opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: learnKeys.notifications(filter, limit), queryFn: () => listMyNotifications({ filter, limit }), retry, staleTime: 15_000, refetchOnWindowFocus: true, enabled: opts.enabled ?? true });
}

/** Everything enrolling touches: counts, home, lists, the course and path pages, sessions. */
export function refreshAfterEnroll(qc: ReturnType<typeof useQueryClient>) {
  for (const root of [qk.me, qk.homeRoot, qk.learningRoot, qk.catalogRoot, qk.courseRoot, qk.pathRoot, qk.sessionsRoot]) void qc.invalidateQueries({ queryKey: root });
}

/** Enroll yourself in a catalog course or path. Toasts are the caller's, so each page can say the right next step. */
export function useEnrollSelf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { courseId: string } | { pathId: string }) => enrollSelf(v),
    onSuccess: () => refreshAfterEnroll(qc),
  });
}

/** Register for, or cancel, a live session seat. */
export function useSessionRegistration() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const root of [qk.sessionsRoot, qk.homeRoot, qk.courseRoot, qk.me, qk.playerRoot]) void qc.invalidateQueries({ queryKey: root });
  };
  const register = useMutation({ mutationFn: (sessionId: string) => registerSession({ sessionId }), onSettled: refresh });
  const cancel = useMutation({ mutationFn: (sessionId: string) => cancelRegistration({ sessionId }), onSettled: refresh });
  return { register, cancel };
}

type NotificationAction = 'read' | 'unread' | 'archive' | 'read_all';

/**
 * Read, unread, archive and mark-all-read, applied to every cached list at
 * once so the bell, the badge and the page never disagree.
 */
export function useNotificationActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: NotificationAction; ids?: string[] }) => updateMyNotifications({ action: v.action, ids: v.ids ?? [] }),
    onMutate: async ({ action, ids = [] }) => {
      await qc.cancelQueries({ queryKey: qk.notificationsRoot });
      const now = new Date().toISOString();
      const snapshots = qc.getQueriesData<Notifications>({ queryKey: qk.notificationsRoot });
      const touched = (id: string) => action === 'read_all' || ids.includes(id);
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const filter = key[1];
        let items = data.items.map(n => (touched(n.id) ? { ...n, readAt: action === 'unread' ? null : (n.readAt ?? now) } : n));
        if (action === 'archive') items = items.filter(n => !ids.includes(n.id));
        if (filter === 'unread') items = items.filter(n => !n.readAt);
        const unreadCount = action === 'read_all' ? 0 : Math.max(0, data.unreadCount + unreadDelta(data.items, action, ids));
        qc.setQueryData<Notifications>(key, { ...data, items, unreadCount, total: filter === 'unread' ? unreadCount : data.total - (action === 'archive' ? data.items.filter(n => ids.includes(n.id)).length : 0) });
      }
      const me = qc.getQueryData<{ counts: { unreadNotifications: number } }>(qk.me);
      const base = snapshots.find(([, d]) => d)?.[1];
      if (me && base) qc.setQueryData(qk.me, { ...me, counts: { ...me.counts, unreadNotifications: action === 'read_all' ? 0 : Math.max(0, base.unreadCount + unreadDelta(base.items, action, ids)) } });
      return { snapshots, me };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
      if (ctx?.me) qc.setQueryData(qk.me, ctx.me);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.notificationsRoot });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

function unreadDelta(items: LearnNotification[], action: NotificationAction, ids: string[]) {
  if (action === 'read_all') return -items.filter(n => !n.readAt).length;
  const hit = items.filter(n => ids.includes(n.id));
  if (action === 'read' || action === 'archive') return -hit.filter(n => !n.readAt).length;
  return hit.filter(n => n.readAt).length;
}
