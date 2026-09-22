import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { enroll, updateEnrollments, type EnrollInputType } from 'zitejs/api';
import { dueState } from '@project/shared/progress';
import { errorMessage } from './errors';
import { qk } from './queries';
import type { Enrollment, EnrollmentList } from './types';

/**
 * Enrollment writes, optimistic where the outcome is predictable.
 *
 * A due-date change, withdrawal or restore is written into every cached list
 * that holds the row before the request leaves, so bulk edits from a list feel
 * instant; on failure every snapshot is restored. Actions whose result the
 * server decides (complete, reset — certificates, path progress) refetch.
 */

type Snapshot = Array<[readonly unknown[], unknown]>;

export function snapshotEnrollments(qc: QueryClient): Snapshot {
  return [...qc.getQueriesData({ queryKey: qk.enrollmentsRoot })];
}

export function restore(qc: QueryClient, snap: Snapshot) {
  for (const [key, data] of snap) qc.setQueryData(key, data);
}

export function patchEnrollmentCaches(qc: QueryClient, ids: Set<string>, fn: (e: Enrollment) => Enrollment) {
  qc.setQueriesData<EnrollmentList>({ queryKey: qk.enrollmentsRoot }, old => (old ? { ...old, rows: old.rows.map(r => (ids.has(r.id) ? fn(r) : r)) } : old));
}

const timers = new Map<string, number>();
/** Refetch after a quiet period — many quick edits become one round trip. */
export function refreshSoon(qc: QueryClient, keys: Array<readonly unknown[]>, delay = 1200) {
  for (const key of keys) {
    const id = JSON.stringify(key);
    window.clearTimeout(timers.get(id));
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id);
        qc.invalidateQueries({ queryKey: key });
      }, delay),
    );
  }
}

/** After anything that changes counts shown in the sidebar, course headers or reports. */
export function refreshEverythingSoon(qc: QueryClient, delay = 800) {
  refreshSoon(qc, [qk.enrollmentsRoot, qk.enrollmentRoot], delay);
  refreshSoon(qc, [qk.bootstrap, qk.personRoot, qk.peopleRoot, qk.groupRoot, qk.pathRoot, qk.homeRoot, qk.courseStatsRoot, qk.certificatesRoot, qk.reportsRoot], delay + 700);
}

export type EnrollmentAction = 'set_due' | 'remind' | 'withdraw' | 'restore' | 'reset' | 'complete';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function useEnrollmentActions() {
  const qc = useQueryClient();

  const run = useCallback(
    async (targets: Array<Pick<Enrollment, 'id' | 'status' | 'dueDate' | 'progress'> & { personId?: string }>, action: EnrollmentAction, opts: { dueDate?: string | null; note?: string } = {}) => {
      if (!targets.length) return null;
      const ids = new Set(targets.map(t => t.id));
      const snap = snapshotEnrollments(qc);
      const now = new Date().toISOString();
      if (action === 'set_due') patchEnrollmentCaches(qc, ids, e => (e.status === 'Completed' || e.status === 'Withdrawn' ? e : { ...e, dueDate: opts.dueDate ?? null, dueState: dueState({ status: e.status, dueDate: opts.dueDate ?? null }) }));
      if (action === 'withdraw') patchEnrollmentCaches(qc, ids, e => ({ ...e, status: 'Withdrawn', dueState: 'withdrawn' }));
      if (action === 'restore') patchEnrollmentCaches(qc, ids, e => (e.status !== 'Withdrawn' ? e : { ...e, status: e.progress > 0 ? 'In progress' : 'Not started', dueState: dueState({ status: e.progress > 0 ? 'In progress' : 'Not started', dueDate: e.dueDate }) }));
      if (action === 'remind') patchEnrollmentCaches(qc, ids, e => ({ ...e, remindedAt: now }));
      const toastId = action === 'complete' || action === 'reset' ? toast.loading(action === 'complete' ? `Marking ${plural(targets.length, 'enrollment')} complete…` : `Resetting ${plural(targets.length, 'enrollment')}…`) : undefined;
      try {
        const res = await updateEnrollments({ ids: [...ids], action, dueDate: opts.dueDate, note: opts.note });
        const verb = { set_due: 'Updated the due date for', remind: 'Sent a reminder to', withdraw: 'Withdrew', restore: 'Restored', reset: 'Reset progress for', complete: 'Marked complete' }[action];
        const msg =
          action === 'complete'
            ? `${verb}: ${plural(res.updated, 'enrollment')}`
            : action === 'remind'
              ? // One reminder per enrollment; say "learners" only when each is a different person.
                (() => {
                  const people = new Set(targets.map(t => t.personId ?? t.id)).size;
                  return people === res.updated ? `${verb} ${plural(people, 'learner')}` : `Sent ${plural(res.updated, 'reminder')} to ${plural(people, 'learner')}`;
                })()
              : `${verb} ${plural(res.updated, 'enrollment')}`;
        toast.success(res.skipped ? `${msg} · ${res.skipped} skipped` : msg, { id: toastId });
        refreshEverythingSoon(qc, action === 'complete' || action === 'reset' ? 100 : 900);
        return res;
      } catch (e) {
        restore(qc, snap);
        toast.error(errorMessage(e, "Couldn't update those enrollments"), { id: toastId });
        return null;
      }
    },
    [qc],
  );

  const assign = useCallback(
    async (input: EnrollInputType, label: string) => {
      const toastId = toast.loading(`Enrolling in ${label}…`);
      try {
        const res = await enroll(input);
        const parts: string[] = [];
        if (res.created) parts.push(`Enrolled ${plural(res.created, 'person')}`.replace('persons', 'people'));
        if (res.reactivated) parts.push(`restored ${res.reactivated}`);
        if (res.skipped) parts.push(`${res.skipped} already enrolled`);
        if (res.skippedInactive) parts.push(`${res.skippedInactive} deactivated`);
        toast.success(parts.length ? parts.join(' · ') : 'Everyone was already enrolled', { id: toastId, description: label });
        refreshEverythingSoon(qc, 100);
        return res;
      } catch (e) {
        toast.error(errorMessage(e, `Couldn't enroll people in ${label}`), { id: toastId });
        throw e;
      }
    },
    [qc],
  );

  return useMemo(() => ({ run, assign }), [run, assign]);
}
