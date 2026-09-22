import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { getSubmission, listSubmissions, type GetSubmissionOutputType, type ListSubmissionsInputType, type ListSubmissionsOutputType } from 'zitejs/api';
import { qk, retryUnlessNotFound } from '../../lib/queries';
import type { Bootstrap } from '../../lib/types';

/**
 * Grading data on the client: the queue per filter, one submission in detail,
 * unsent drafts, and the optimistic write that takes a graded submission out
 * of the queue before the server has finished completing the lesson.
 */

export type QueueList = ListSubmissionsOutputType;
export type QueueRow = QueueList['rows'][number];
export type QueueCounts = QueueList['counts'];
export type SubmissionDetail = GetSubmissionOutputType;
export type SubmissionStatus = QueueRow['status'];
export type QueueFilters = { status: 'Submitted' | 'Needs revision' | 'Passed' | 'all'; courseId: string | null; scope: 'mine' | 'all'; q: string; ordering: 'oldest' | 'newest' };

export type GradingTab = 'todo' | 'revision' | 'graded';
export const TAB_STATUS: Record<GradingTab, QueueFilters['status']> = { todo: 'Submitted', revision: 'Needs revision', graded: 'Passed' };
export const TAB_LABEL: Record<GradingTab, string> = { todo: 'To grade', revision: 'Needs revision', graded: 'Graded' };
export const asTab = (v: string | null): GradingTab => (v === 'revision' || v === 'graded' ? v : 'todo');
export const tabForStatus = (s: SubmissionStatus): GradingTab => (s === 'Passed' ? 'graded' : s === 'Needs revision' ? 'revision' : 'todo');

const queueRoot = [...qk.gradingRoot, 'queue'] as const;
export const gradingKeys = {
  queueRoot,
  queue: (f: QueueFilters) => [...queueRoot, f] as const,
  submission: (id: string) => [...qk.gradingRoot, 'submission', id] as const,
};

const toInput = (f: QueueFilters): ListSubmissionsInputType => ({ status: f.status, courseId: f.courseId, scope: f.scope, q: f.q.trim() || undefined, ordering: f.ordering });

export function useQueue(f: QueueFilters) {
  return useQuery({ queryKey: gradingKeys.queue(f), queryFn: () => listSubmissions(toInput(f)), placeholderData: keepPreviousData, staleTime: 15_000 });
}

export const fetchSubmission = (id: string, f: QueueFilters) => getSubmission({ id, queue: toInput(f) });

export function useSubmissionDetail(id: string | undefined, f: QueueFilters) {
  return useQuery({ queryKey: gradingKeys.submission(id ?? ''), queryFn: () => fetchSubmission(id!, f), enabled: Boolean(id), staleTime: 15_000, retry: retryUnlessNotFound });
}

// ---------------------------------------------------------------------------
// Drafts — what a grader typed survives moving through the queue and a failed save.
// ---------------------------------------------------------------------------

export type AiSuggestion = { suggestedGrade: number; outcome: 'Passed' | 'Needs revision'; feedback: string; strengths: string[]; improvements: string[]; previous: { grade: string; feedback: string } };
export type Draft = { grade: string; feedback: string; editing: boolean; ai: AiSuggestion | null };

const drafts = new Map<string, Draft>();

export function readDraft(detail: SubmissionDetail): Draft {
  const existing = drafts.get(detail.submission.id);
  if (existing) return existing;
  const s = detail.submission;
  return { grade: s.grade == null ? '' : String(s.grade), feedback: s.feedback, editing: false, ai: null };
}

export function writeDraft(id: string, draft: Draft) {
  drafts.set(id, draft);
}

export function clearDraft(id: string) {
  drafts.delete(id);
}

/** A draft the grader has actually changed from what's saved. */
export function isDirty(detail: SubmissionDetail, draft: Draft) {
  const s = detail.submission;
  return draft.feedback.trim() !== s.feedback.trim() || draft.grade !== (s.grade == null ? '' : String(s.grade));
}

// ---------------------------------------------------------------------------
// Optimistic grading
// ---------------------------------------------------------------------------

type Snapshot = Array<[readonly unknown[], unknown]>;

export function snapshotGrading(qc: QueryClient): Snapshot {
  return [...qc.getQueriesData({ queryKey: qk.gradingRoot }), [qk.bootstrap, qc.getQueryData(qk.bootstrap)]];
}

export function restoreGrading(qc: QueryClient, snap: Snapshot) {
  for (const [key, data] of snap) qc.setQueryData(key, data);
}

const countKey: Record<SubmissionStatus, keyof QueueCounts> = { Submitted: 'submitted', 'Needs revision': 'needsRevision', Passed: 'passed' };

/** Move a submission to its new status in every cached queue and in its detail. */
export function applyGrade(qc: QueryClient, input: { id: string; from: SubmissionStatus; to: 'Passed' | 'Needs revision'; grade: number; feedback: string; me: { id: string; name: string } }) {
  const now = new Date().toISOString();
  for (const [key, data] of qc.getQueriesData<QueueList>({ queryKey: queueRoot })) {
    if (!data) continue;
    const f = key[key.length - 1] as QueueFilters;
    const had = data.rows.find(r => r.id === input.id);
    const counts = { ...data.counts };
    if (had && input.from !== input.to) {
      counts[countKey[input.from]] = Math.max(0, counts[countKey[input.from]] - 1);
      counts[countKey[input.to]] += 1;
      counts.gradedThisWeek += input.from === 'Submitted' ? 1 : 0;
      counts.gradedByMeThisWeek += input.from === 'Submitted' ? 1 : 0;
    }
    const keep = f.status === 'all' || f.status === input.to;
    const rows = keep
      ? data.rows.map(r => (r.id === input.id ? { ...r, status: input.to, grade: input.grade, gradedAt: now, gradedByName: input.me.name, waitingDays: null } : r))
      : data.rows.filter(r => r.id !== input.id);
    qc.setQueryData<QueueList>(key, { ...data, rows, counts });
  }
  qc.setQueryData<SubmissionDetail>(gradingKeys.submission(input.id), old =>
    old
      ? {
          ...old,
          submission: { ...old.submission, status: input.to, grade: input.grade, feedback: input.feedback, gradedAt: now, gradedById: input.me.id, gradedByName: input.me.name },
          attempts: old.attempts.map(a => (a.current ? { ...a, status: input.to, grade: input.grade, feedback: input.feedback, gradedAt: now, gradedByName: input.me.name } : a)),
        }
      : old,
  );
  if (input.from === 'Submitted') {
    qc.setQueryData<Bootstrap>(qk.bootstrap, old => (old ? { ...old, counts: { ...old.counts, toGrade: Math.max(0, old.counts.toGrade - 1) } } : old));
  }
}
