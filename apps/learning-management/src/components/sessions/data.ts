import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { getSession, listSessions, saveSession, updateRegistrations, type GetSessionOutputType, type ListSessionsInputType, type ListSessionsOutputType, type SaveSessionInputType, type UpdateRegistrationsInputType } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { refreshSoon } from '../../lib/mutations';
import { qk, retryUnlessNotFound } from '../../lib/queries';

export type SessionRow = ListSessionsOutputType['sessions'][number];
export type SessionDetail = GetSessionOutputType;
export type Registration = SessionDetail['registrations'][number];
export type RegistrationStatus = Registration['status'];
export type SessionFields = NonNullable<SaveSessionInputType['session']>;

export const sessionKeys = {
  list: (f: ListSessionsInputType) => [...qk.sessionsRoot, 'list', f] as const,
  detail: (id: string) => [...qk.sessionsRoot, 'detail', id] as const,
};

export function useSessions(filters: ListSessionsInputType, opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: sessionKeys.list(filters), queryFn: () => listSessions(filters), placeholderData: keepPreviousData, staleTime: 20_000, enabled: opts.enabled ?? true });
}

export function useSession(id: string | undefined) {
  return useQuery({ queryKey: sessionKeys.detail(id ?? ''), queryFn: () => getSession({ id: id! }), enabled: Boolean(id), staleTime: 10_000, retry: retryUnlessNotFound });
}

export const REGISTRATION_META: Record<RegistrationStatus, { label: string; tone: string; dot: string }> = {
  Registered: { label: 'Registered', tone: 'text-primary', dot: 'bg-primary' },
  Waitlisted: { label: 'Waitlisted', tone: 'text-tone-warning', dot: 'bg-tone-warning' },
  Attended: { label: 'Attended', tone: 'text-tone-success', dot: 'bg-tone-success' },
  Absent: { label: 'Absent', tone: 'text-tone-danger', dot: 'bg-tone-danger' },
  Cancelled: { label: 'Cancelled', tone: 'text-muted-foreground', dot: 'bg-muted-foreground/50' },
};

/** Sessions feed the sidebar count, Home and course pages — refresh those after a write. */
export function refreshSessions(qc: QueryClient, delay = 300) {
  qc.invalidateQueries({ queryKey: qk.sessionsRoot });
  refreshSoon(qc, [qk.bootstrap, qk.homeRoot, qk.courseRoot], delay);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function useSessionActions() {
  const qc = useQueryClient();

  const save = useCallback(
    async (input: SaveSessionInputType, opts: { success?: string; quiet?: boolean } = {}) => {
      try {
        const res = await saveSession(input);
        refreshSessions(qc);
        if (!opts.quiet) {
          const extra = [
            res.notified ? `${plural(res.notified, 'person', 'people')} notified` : '',
            res.promoted ? `${plural(res.promoted, 'person', 'people')} moved off the waitlist` : '',
            res.registered ? `${plural(res.registered, 'person', 'people')} registered again` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          toast.success(opts.success ?? 'Session saved', { description: extra || undefined });
        }
        return res;
      } catch (e) {
        toast.error(errorMessage(e, "Couldn't save the session"));
        throw e;
      }
    },
    [qc],
  );

  /**
   * Registrations change optimistically for status marks (attendance taking is
   * rapid-fire); adds and cancels wait for the server, which decides seats.
   */
  const registrations = useCallback(
    async (input: UpdateRegistrationsInputType, opts: { quiet?: boolean } = {}) => {
      const key = sessionKeys.detail(input.sessionId);
      const snapshot = qc.getQueryData<SessionDetail>(key);
      if (input.status && snapshot) {
        const ids = new Set(input.status.registrationIds);
        const value = input.status.value;
        const now = new Date().toISOString();
        qc.setQueryData<SessionDetail>(key, {
          ...snapshot,
          registrations: snapshot.registrations.map(r => (ids.has(r.id) && r.status !== 'Cancelled' ? { ...r, status: value, checkedInAt: value === 'Attended' ? now : null } : r)),
        });
      }
      try {
        const res = await updateRegistrations(input);
        refreshSoon(qc, [key], input.status ? 900 : 0);
        refreshSoon(qc, [qk.sessionsRoot, qk.homeRoot], 1200);
        if (res.lessonsCompleted || res.enrolled) refreshSoon(qc, [qk.enrollmentsRoot, qk.enrollmentRoot, qk.courseRoot, qk.bootstrap], 1200);
        if (!opts.quiet) {
          const parts: string[] = [];
          if (res.added) parts.push(`Registered ${plural(res.added, 'person', 'people')}`);
          if (res.waitlisted) parts.push(`${res.waitlisted} waitlisted`);
          if (res.cancelled) parts.push(`Cancelled ${plural(res.cancelled, 'registration')}`);
          if (res.promoted) parts.push(`${plural(res.promoted, 'person', 'people')} moved off the waitlist`);
          if (input.status && res.updated) {
            const before = new Set((snapshot?.registrations ?? []).filter(r => input.status!.registrationIds.includes(r.id)).map(r => r.status));
            const who = plural(res.updated, 'person', 'people');
            if (input.status.value !== 'Registered') parts.push(`Marked ${who} ${input.status.value.toLowerCase()}`);
            else if (before.size === 1 && before.has('Waitlisted')) parts.push(`Gave ${who} a seat`);
            else if (!before.has('Waitlisted')) parts.push(`Cleared attendance for ${who}`);
            else parts.push(`Updated ${who}`);
          }
          const detail = [res.lessonsCompleted ? `${plural(res.lessonsCompleted, 'lesson')} completed` : '', res.enrolled ? `${res.enrolled} enrolled in the course` : '', res.notEnrolled ? `${res.notEnrolled} not enrolled (course unpublished)` : '', res.skipped ? `${res.skipped} skipped` : ''].filter(Boolean).join(' · ');
          if (parts.length) toast.success(parts.join(' · '), { description: detail || undefined });
          else if (res.skipped) toast.message('Nothing changed', { description: 'Those people were already in that state.' });
        }
        return res;
      } catch (e) {
        if (snapshot) qc.setQueryData(key, snapshot);
        toast.error(errorMessage(e, "Couldn't update registrations"));
        throw e;
      }
    },
    [qc],
  );

  return useMemo(() => ({ save, registrations }), [save, registrations]);
}

/** Seats: registered plus anyone already marked, against capacity. */
export const seatsTaken = (c: SessionRow['counts']) => c.registered + c.attended + c.absent;
