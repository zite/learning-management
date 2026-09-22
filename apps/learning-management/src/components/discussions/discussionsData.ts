import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { listDiscussions, saveComment, type ListDiscussionsOutputType } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { refreshSoon } from '../../lib/mutations';
import { qk } from '../../lib/queries';
import type { Bootstrap } from '../../lib/types';

/**
 * Lesson Q&A on the client. Writes are optimistic and patch every cached list
 * in place, but don't refetch the list you're looking at: a question you just
 * answered stays under Unanswered (marked answered) until you switch tabs,
 * rather than vanishing while you read your own reply.
 */

export type DiscussionList = ListDiscussionsOutputType;
export type Thread = DiscussionList['threads'][number];
export type Reply = Thread['replies'][number];
export type DiscussionFilter = 'unanswered' | 'all' | 'resolved' | 'pinned';
export type DiscussionQuery = { filter: DiscussionFilter; courseId: string | null; q: string };
type Counts = DiscussionList['counts'];

export const FILTERS: Array<{ value: DiscussionFilter; label: string }> = [
  { value: 'unanswered', label: 'Unanswered' },
  { value: 'all', label: 'All' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'pinned', label: 'Pinned' },
];
export const asFilter = (v: string | null): DiscussionFilter => (v === 'all' || v === 'resolved' || v === 'pinned' ? v : 'unanswered');

const listRoot = [...qk.discussionsRoot, 'list'] as const;
export const discussionKey = (f: DiscussionQuery) => [...listRoot, f] as const;

export const isStaffRole = (role: string) => role === 'Admin' || role === 'Instructor';

/** The list for a filter. A deep-linked thread outside the filter comes back as `focus`. */
export function useDiscussions(f: DiscussionQuery, focusId: string | null) {
  const focusRef = useRef(focusId);
  focusRef.current = focusId;
  return useQuery({
    queryKey: discussionKey(f),
    queryFn: () => listDiscussions({ filter: f.filter, courseId: f.courseId, q: f.q.trim() || undefined, threadId: focusRef.current ?? undefined }),
    placeholderData: keepPreviousData,
    staleTime: 20_000,
  });
}

// ---------------------------------------------------------------------------
// Optimistic patches
// ---------------------------------------------------------------------------

type Flags = { unanswered: boolean; resolved: boolean; pinned: boolean; exists: boolean };
const flagsOf = (t: Thread | null): Flags => ({ unanswered: Boolean(t?.unanswered), resolved: Boolean(t?.resolvedAt), pinned: Boolean(t?.pinned), exists: Boolean(t) });

/** Derived fields, recomputed after a local change the same way the server computes them. */
export function derive(t: Thread): Thread {
  const answeredByStaff = t.replies.some(r => isStaffRole(r.author.role));
  const last = t.replies.reduce<string | null>((m, r) => (r.postedAt && (!m || r.postedAt > m) ? r.postedAt : m), null);
  return { ...t, answeredByStaff, replyCount: t.replies.length, lastReplyAt: last, unanswered: !t.resolvedAt && !isStaffRole(t.author.role) && !answeredByStaff };
}

type Snapshot = Array<[readonly unknown[], unknown]>;
const snapshot = (qc: QueryClient): Snapshot => [...qc.getQueriesData({ queryKey: qk.discussionsRoot }), [qk.bootstrap, qc.getQueryData(qk.bootstrap)]];
const restore = (qc: QueryClient, snap: Snapshot) => snap.forEach(([key, data]) => qc.setQueryData(key, data));

function findThread(qc: QueryClient, id: string): Thread | null {
  for (const [, data] of qc.getQueriesData<DiscussionList>({ queryKey: listRoot })) {
    const t = data?.threads.find(x => x.id === id) ?? (data?.focus?.id === id ? data.focus : null);
    if (t) return t;
  }
  return null;
}

/** Replace (or remove, with null) a thread everywhere it's cached, moving each list's counts to match. */
function writeThread(qc: QueryClient, before: Thread, after: Thread | null) {
  const a = flagsOf(before);
  const b = flagsOf(after);
  const delta = (k: keyof Omit<Flags, 'exists'>) => (b[k] ? 1 : 0) - (a[k] ? 1 : 0);
  for (const [key, data] of qc.getQueriesData<DiscussionList>({ queryKey: listRoot })) {
    if (!data) continue;
    const f = key[key.length - 1] as DiscussionQuery;
    const inScope = !f.courseId || f.courseId === before.courseId;
    const counts: Counts = inScope
      ? {
          unanswered: Math.max(0, data.counts.unanswered + delta('unanswered')),
          resolved: Math.max(0, data.counts.resolved + delta('resolved')),
          pinned: Math.max(0, data.counts.pinned + delta('pinned')),
          all: Math.max(0, data.counts.all + (b.exists ? 0 : -1)),
        }
      : data.counts;
    const threads = after ? data.threads.map(t => (t.id === before.id ? after : t)) : data.threads.filter(t => t.id !== before.id);
    const focus = data.focus?.id === before.id ? after : data.focus;
    qc.setQueryData<DiscussionList>(key, { ...data, threads, counts, focus });
  }
  const openDelta = delta('unanswered');
  if (openDelta) qc.setQueryData<Bootstrap>(qk.bootstrap, old => (old ? { ...old, counts: { ...old.counts, openQuestions: Math.max(0, old.counts.openQuestions + openDelta) } } : old));
}

export function useDiscussionActions(me: { id: string; name: string; color: string; avatarUrl: string | null; role: string }) {
  const qc = useQueryClient();

  const run = useCallback(
    async (threadId: string, change: (t: Thread) => Thread | null, request: () => Promise<{ thread: Thread | null; deletedId: string | null }>, failure: string) => {
      await qc.cancelQueries({ queryKey: qk.discussionsRoot });
      const before = findThread(qc, threadId);
      const snap = snapshot(qc);
      if (before) writeThread(qc, before, change(before));
      try {
        const res = await request();
        const current = findThread(qc, threadId);
        if (current && res.thread) writeThread(qc, current, res.thread);
        // Other lists and the sidebar catch up; the list on screen keeps its shape until you leave it.
        void qc.invalidateQueries({ queryKey: qk.discussionsRoot, refetchType: 'none' });
        refreshSoon(qc, [qk.bootstrap, qk.homeRoot], 1500);
        return res;
      } catch (e) {
        restore(qc, snap);
        toast.error(errorMessage(e, failure));
        return null;
      }
    },
    [qc],
  );

  const reply = useCallback(
    (thread: Thread, body: string) => {
      const now = new Date().toISOString();
      const temp: Reply = { id: `temp-${now}`, body, author: { id: me.id, name: me.name, color: me.color, avatarUrl: me.avatarUrl, role: me.role, title: null }, postedAt: now, editedAt: null };
      return run(thread.id, t => derive({ ...t, replies: [...t.replies, temp] }), () => saveComment({ action: 'reply', threadId: thread.id, body }), 'Couldn’t post your reply');
    },
    [me, run],
  );

  const edit = useCallback(
    (thread: Thread, commentId: string, body: string) => {
      const now = new Date().toISOString();
      return run(
        thread.id,
        t => (t.id === commentId ? { ...t, body, editedAt: now } : { ...t, replies: t.replies.map(r => (r.id === commentId ? { ...r, body, editedAt: now } : r)) }),
        () => saveComment({ action: 'edit', id: commentId, body }),
        'Couldn’t save that edit',
      );
    },
    [run],
  );

  const remove = useCallback(
    (thread: Thread, commentId: string) =>
      run(
        thread.id,
        t => (t.id === commentId ? null : derive({ ...t, replies: t.replies.filter(r => r.id !== commentId) })),
        () => saveComment({ action: 'delete', id: commentId }),
        'Couldn’t delete that',
      ),
    [run],
  );

  const setPinned = useCallback(
    (thread: Thread, pinned: boolean) => run(thread.id, t => ({ ...t, pinned }), () => saveComment({ action: pinned ? 'pin' : 'unpin', id: thread.id }), pinned ? 'Couldn’t pin that' : 'Couldn’t unpin that'),
    [run],
  );

  const setResolved = useCallback(
    (thread: Thread, resolved: boolean) =>
      run(thread.id, t => derive({ ...t, resolvedAt: resolved ? t.resolvedAt ?? new Date().toISOString() : null }), () => saveComment({ action: resolved ? 'resolve' : 'reopen', id: thread.id }), resolved ? 'Couldn’t resolve that' : 'Couldn’t reopen that'),
    [run],
  );

  return useMemo(() => ({ reply, edit, remove, setPinned, setResolved }), [reply, edit, remove, setPinned, setResolved]);
}
