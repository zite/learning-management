import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isToday, isYesterday, parseISO, startOfMonth, startOfWeek, subWeeks } from 'date-fns';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { listNotifications, updateNotifications, type ListNotificationsOutputType } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { refreshSoon } from '../../lib/mutations';
import { qk } from '../../lib/queries';
import type { Bootstrap } from '../../lib/types';

/**
 * The admin inbox on the client. Unread and All read the same list — Unread
 * filters it here — so an item you just read stays put until you leave the
 * tab instead of vanishing under the cursor. Every triage action is optimistic
 * and moves the tab counts and the sidebar badge with it.
 */

export type InboxList = ListNotificationsOutputType;
export type InboxItem = InboxList['notifications'][number];
export type InboxTab = 'unread' | 'all' | 'archived';
type Source = 'live' | 'archived';

export const inboxKey = (source: Source) => [...qk.notificationsRoot, source] as const;
export const sourceFor = (tab: InboxTab): Source => (tab === 'archived' ? 'archived' : 'live');
export const asInboxTab = (v: string | null): InboxTab => (v === 'all' || v === 'archived' ? v : 'unread');

export function useNotifications(source: Source) {
  return useQuery({
    queryKey: inboxKey(source),
    queryFn: () => listNotifications({ tab: source === 'archived' ? 'archived' : 'all' }),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

export type InboxGroup = { label: string; items: InboxItem[] };

function dayLabel(iso: string | null, now: Date) {
  if (!iso) return 'Older';
  const d = parseISO(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  if (d >= weekStart) return 'Earlier this week';
  if (d >= subWeeks(weekStart, 1)) return 'Last week';
  if (d >= startOfMonth(now)) return 'Earlier this month';
  return 'Older';
}

export function groupItems(items: InboxItem[], tab: InboxTab): InboxGroup[] {
  const now = new Date();
  const groups: InboxGroup[] = [];
  for (const n of items) {
    const label = dayLabel(tab === 'archived' ? n.archivedAt : n.occurredAt, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }
  return groups;
}

type Snapshot = Array<[readonly unknown[], unknown]>;

const snapshot = (qc: QueryClient): Snapshot => [...qc.getQueriesData({ queryKey: qk.notificationsRoot }), [qk.bootstrap, qc.getQueryData(qk.bootstrap)]];
const restore = (qc: QueryClient, snap: Snapshot) => snap.forEach(([key, data]) => qc.setQueryData(key, data));
const byTimeDesc = (a: InboxItem, b: InboxItem) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? '');

function patchList(qc: QueryClient, source: Source, fn: (items: InboxItem[]) => InboxItem[]) {
  qc.setQueryData<InboxList>(inboxKey(source), old => (old ? { ...old, notifications: fn(old.notifications) } : old));
}

function shiftCounts(qc: QueryClient, delta: { unread?: number; all?: number; archived?: number }) {
  const clamp = (n: number) => Math.max(0, n);
  qc.setQueriesData<InboxList>({ queryKey: qk.notificationsRoot }, old =>
    old ? { ...old, counts: { unread: clamp(old.counts.unread + (delta.unread ?? 0)), all: clamp(old.counts.all + (delta.all ?? 0)), archived: clamp(old.counts.archived + (delta.archived ?? 0)) } } : old,
  );
  if (delta.unread) qc.setQueryData<Bootstrap>(qk.bootstrap, old => (old ? { ...old, counts: { ...old.counts, inboxUnread: clamp(old.counts.inboxUnread + delta.unread!) } } : old));
}

/** Keep the sidebar badge honest when a poll finds new notifications. */
export function syncUnreadBadge(qc: QueryClient, unread: number) {
  const boot = qc.getQueryData<Bootstrap>(qk.bootstrap);
  if (boot && boot.counts.inboxUnread !== unread) qc.setQueryData<Bootstrap>(qk.bootstrap, { ...boot, counts: { ...boot.counts, inboxUnread: unread } });
}

export function useInboxActions() {
  const qc = useQueryClient();

  const run = useCallback(
    async (apply: () => void, request: () => Promise<unknown>, failure: string) => {
      await qc.cancelQueries({ queryKey: qk.notificationsRoot });
      const snap = snapshot(qc);
      apply();
      try {
        await request();
        refreshSoon(qc, [qk.notificationsRoot], 2500);
        return true;
      } catch (e) {
        restore(qc, snap);
        toast.error(errorMessage(e, failure));
        return false;
      }
    },
    [qc],
  );

  const setRead = useCallback(
    (items: InboxItem[], read: boolean) => {
      const targets = items.filter(n => Boolean(n.readAt) !== read);
      if (!targets.length) return Promise.resolve(true);
      const ids = new Set(targets.map(n => n.id));
      const at = read ? new Date().toISOString() : null;
      const live = targets.filter(n => !n.archivedAt).length;
      return run(
        () => {
          for (const source of ['live', 'archived'] as const) patchList(qc, source, list => list.map(n => (ids.has(n.id) ? { ...n, readAt: at } : n)));
          shiftCounts(qc, { unread: read ? -live : live });
        },
        () => updateNotifications({ action: read ? 'read' : 'unread', ids: [...ids] }),
        read ? 'Couldn’t mark that as read' : 'Couldn’t mark that as unread',
      );
    },
    [qc, run],
  );

  const unarchive = useCallback(
    (items: InboxItem[], opts: { quiet?: boolean } = {}) => {
      if (!items.length) return Promise.resolve(true);
      const ids = new Set(items.map(n => n.id));
      const back = items.map(n => ({ ...n, archivedAt: null }));
      return run(
        () => {
          patchList(qc, 'archived', list => list.filter(n => !ids.has(n.id)));
          patchList(qc, 'live', list => [...list.filter(n => !ids.has(n.id)), ...back].sort(byTimeDesc));
          shiftCounts(qc, { all: back.length, archived: -back.length, unread: back.filter(n => !n.readAt).length });
        },
        () => updateNotifications({ action: 'unarchive', ids: [...ids] }),
        'Couldn’t move that back to your inbox',
      ).then(ok => {
        if (ok && !opts.quiet) toast.success(items.length === 1 ? 'Moved back to your inbox' : `Moved ${items.length} back to your inbox`);
        return ok;
      });
    },
    [qc, run],
  );

  const archive = useCallback(
    (items: InboxItem[]) => {
      const targets = items.filter(n => !n.archivedAt);
      if (!targets.length) return Promise.resolve(true);
      const ids = new Set(targets.map(n => n.id));
      const archivedAt = new Date().toISOString();
      return run(
        () => {
          patchList(qc, 'live', list => list.filter(n => !ids.has(n.id)));
          qc.setQueryData<InboxList>(inboxKey('archived'), old => (old ? { ...old, notifications: [...targets.map(n => ({ ...n, archivedAt })), ...old.notifications.filter(n => !ids.has(n.id))] } : old));
          shiftCounts(qc, { all: -targets.length, archived: targets.length, unread: -targets.filter(n => !n.readAt).length });
        },
        () => updateNotifications({ action: 'archive', ids: [...ids] }),
        'Couldn’t archive that',
      ).then(ok => {
        if (ok) toast.success(targets.length === 1 ? 'Archived' : `Archived ${targets.length} notifications`, { action: { label: 'Undo', onClick: () => void unarchive(targets, { quiet: true }) } });
        return ok;
      });
    },
    [qc, run, unarchive],
  );

  const markAllRead = useCallback(() => {
    const unread = qc.getQueryData<InboxList>(inboxKey('live'))?.counts.unread ?? 0;
    if (!unread) return Promise.resolve(true);
    const at = new Date().toISOString();
    return run(
      () => {
        patchList(qc, 'live', items => items.map(n => (n.readAt ? n : { ...n, readAt: at })));
        shiftCounts(qc, { unread: -unread });
      },
      () => updateNotifications({ action: 'read', all: true }),
      'Couldn’t mark everything as read',
    ).then(ok => {
      if (ok) toast.success(unread === 1 ? 'Marked 1 notification as read' : `Marked ${unread} notifications as read`);
      return ok;
    });
  }, [qc, run]);

  const archiveAllRead = useCallback(() => {
    const read = (qc.getQueryData<InboxList>(inboxKey('live'))?.notifications ?? []).filter(n => n.readAt);
    if (!read.length) {
      toast('Nothing read to archive', { description: 'Notifications you’ve read get swept into Archived.' });
      return Promise.resolve(false);
    }
    const ids = new Set(read.map(n => n.id));
    const archivedAt = new Date().toISOString();
    return run(
      () => {
        patchList(qc, 'live', items => items.filter(n => !ids.has(n.id)));
        qc.setQueryData<InboxList>(inboxKey('archived'), old => (old ? { ...old, notifications: [...read.map(n => ({ ...n, archivedAt })), ...old.notifications] } : old));
        shiftCounts(qc, { all: -read.length, archived: read.length });
      },
      () => updateNotifications({ action: 'archive', all: true }),
      'Couldn’t archive what you’ve read',
    ).then(ok => {
      if (ok) toast.success(`Archived ${read.length} read notification${read.length === 1 ? '' : 's'}`, { action: { label: 'Undo', onClick: () => void unarchive(read, { quiet: true }) } });
      return ok;
    });
  }, [qc, run, unarchive]);

  return useMemo(() => ({ setRead, archive, unarchive, markAllRead, archiveAllRead }), [setRead, archive, unarchive, markAllRead, archiveAllRead]);
}
