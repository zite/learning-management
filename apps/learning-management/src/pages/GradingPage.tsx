import { useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, RotateCcw } from 'lucide-react';
import { cn } from '@project/components/lib/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useDebounce } from 'use-debounce';
import { gradeSubmission } from 'zitejs/api';
import { GradingBar } from '../components/grading/GradingBar';
import {
  applyGrade, asTab, clearDraft, fetchSubmission, gradingKeys, readDraft, restoreGrading, snapshotGrading, TAB_LABEL, TAB_STATUS, useQueue, useSubmissionDetail, writeDraft,
  type Draft, type GradingTab, type QueueFilters,
} from '../components/grading/gradingData';
import { GradingEmpty } from '../components/grading/GradingEmpty';
import { GradingQueue } from '../components/grading/GradingQueue';
import { SubmissionPane } from '../components/grading/SubmissionPane';
import { EmptyState } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';
import { useHotkeys } from '../lib/hotkeys';
import { refreshEverythingSoon, refreshSoon } from '../lib/mutations';
import { qk } from '../lib/queries';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useWorkspace } from '../lib/workspace';

const SCOPE_KEY = 'lms:grading:scope';
const TABS: GradingTab[] = ['todo', 'revision', 'graded'];

function useScope(fallback: 'mine' | 'all') {
  const [scope, setScope] = useState<'mine' | 'all'>(() => {
    try {
      const v = localStorage.getItem(SCOPE_KEY);
      return v === 'mine' || v === 'all' ? v : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v: 'mine' | 'all') => {
    setScope(v);
    try {
      localStorage.setItem(SCOPE_KEY, v);
    } catch {
      /* ignore */
    }
  };
  return [scope, set] as const;
}

function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <div className="skeleton h-5 w-5 rounded-full" />
        <div className="skeleton h-3.5 w-40" />
      </div>
      <div className="mx-auto w-full max-w-[780px] space-y-3 px-8 py-6">
        <div className="skeleton h-3 w-32" />
        <div className="skeleton h-6 w-2/3" />
        <div className="skeleton h-14 w-full rounded-lg" />
        <div className="skeleton h-9 w-full rounded-lg" />
        <div className="skeleton h-9 w-full rounded-lg" />
        <div className="skeleton h-40 w-full rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Grading: the queue on the left, one submission on the right, and a grading
 * bar that never leaves the screen. Grade with the keyboard, land on the next
 * submission, repeat.
 */
export function GradingPage() {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { submissionId } = useParams();
  const [params, setParams] = useSearchParams();
  const wide = useMediaQuery('(min-width: 1024px)');

  const tab = asTab(params.get('tab'));
  const courseId = params.get('course');
  const [scope, setScope] = useScope(ws.isAdmin ? 'all' : 'mine');
  const [q, setQ] = useState('');
  const [debouncedQ] = useDebounce(q, 200);
  const [searchOpen, setSearchOpen] = useState(false);
  const [orderings, setOrderings] = useState<Record<GradingTab, 'oldest' | 'newest'>>({ todo: 'oldest', revision: 'newest', graded: 'newest' });

  const filters: QueueFilters = useMemo(() => ({ status: TAB_STATUS[tab], courseId, scope, q: debouncedQ, ordering: orderings[tab] }), [tab, courseId, scope, debouncedQ, orderings]);
  const queue = useQueue(filters);
  const rows = useMemo(() => queue.data?.rows ?? [], [queue.data]);
  const counts = queue.data?.counts;
  const detailQuery = useSubmissionDetail(submissionId, filters);
  const detail = detailQuery.data && detailQuery.data.submission.id === submissionId ? detailQuery.data : undefined;

  useDocumentTitle(counts?.submitted ? `Grading (${counts.submitted})` : 'Grading');

  const search = useCallback(
    (nextTab: GradingTab = tab) => {
      const p = new URLSearchParams(params);
      if (nextTab === 'todo') p.delete('tab');
      else p.set('tab', nextTab);
      const s = p.toString();
      return s ? `?${s}` : '';
    },
    [params, tab],
  );
  const queueSearch = search();

  const open = useCallback((id: string, how: 'replace' | 'push' = 'replace') => navigate(`/grading/${id}${queueSearch}`, { replace: how === 'replace' }), [navigate, queueSearch]);

  // A focused workspace: on a wide screen something is always open.
  useEffect(() => {
    if (!wide || submissionId || !queue.data || queue.isPlaceholderData || !rows.length) return;
    open(rows[0].id);
  }, [wide, submissionId, queue.data, queue.isPlaceholderData, rows, open]);

  // After you change a filter, the open submission follows the queue: the first match, or the empty state.
  const refocus = useRef(false);
  const filterKey = `${courseId ?? ''}|${scope}|${debouncedQ.trim()}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;
    refocus.current = true;
  }, [filterKey]);
  useEffect(() => {
    if (!refocus.current || !queue.data || queue.isPlaceholderData || queue.isFetching) return;
    refocus.current = false;
    if (!wide || (submissionId && rows.some(r => r.id === submissionId))) return;
    if (rows.length) open(rows[0].id);
    else if (submissionId) navigate(`/grading${queueSearch}`, { replace: true });
  }, [queue.data, queue.isPlaceholderData, queue.isFetching, wide, submissionId, rows, open, navigate, queueSearch]);

  // Arriving from a link to something already graded shows it among its peers.
  const arrived = useRef(false);
  useEffect(() => {
    if (!detail || arrived.current) return;
    arrived.current = true;
    if (params.get('tab') || detail.submission.status === 'Submitted') return;
    setParams(p => {
      p.set('tab', detail.submission.status === 'Passed' ? 'graded' : 'revision');
      return p;
    }, { replace: true });
  }, [detail, params, setParams]);

  const index = submissionId ? rows.findIndex(r => r.id === submissionId) : -1;
  const prevId = index >= 0 ? rows[index - 1]?.id ?? null : detail?.queue.prevId ?? null;
  const nextId = index >= 0 ? rows[index + 1]?.id ?? null : (rows.find(r => r.id !== submissionId)?.id ?? detail?.queue.nextId ?? null);
  const position = index >= 0 ? `${index + 1} of ${rows.length}` : null;

  // Warm the neighbours so J and K feel instant.
  useEffect(() => {
    for (const id of [prevId, nextId]) {
      if (id) void qc.prefetchQuery({ queryKey: gradingKeys.submission(id), queryFn: () => fetchSubmission(id, filters), staleTime: 15_000 });
    }
  }, [prevId, nextId, qc, filters]);

  // ── Draft ──────────────────────────────────────────────────────────────
  const [draftState, setDraftState] = useState<{ id: string; draft: Draft } | null>(null);
  const [attempted, setAttempted] = useState<'grade' | 'feedback' | null>(null);
  const gradeRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(new Set<string>());
  const draftKey = detail ? `${detail.submission.id}:${detail.submission.status}:${detail.submission.gradedAt ?? ''}` : '';

  useEffect(() => {
    if (!detail) return;
    setDraftState({ id: detail.submission.id, draft: readDraft(detail) });
    setAttempted(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const draft = detail && draftState?.id === detail.submission.id ? draftState.draft : null;
  const updateDraft = useCallback((patch: Partial<Draft>) => {
    setDraftState(s => {
      if (!s) return s;
      const next = { ...s.draft, ...patch };
      writeDraft(s.id, next);
      return { id: s.id, draft: next };
    });
  }, []);

  // ── Grade ──────────────────────────────────────────────────────────────
  const submit = async (outcome: 'Passed' | 'Needs revision') => {
    if (!detail || !draft || !detail.canGrade) return;
    const s = detail.submission;
    if (s.status !== 'Submitted' && !draft.editing) return;
    if (s.supersededById || busy.current.has(s.id)) return;
    const first = detail.learner.name.split(' ')[0];
    const grade = draft.grade.trim() === '' ? NaN : Number(draft.grade);
    if (!Number.isFinite(grade) || grade < 0 || grade > 100) {
      setAttempted('grade');
      gradeRef.current?.focus();
      return;
    }
    if (outcome === 'Needs revision' && s.status === 'Passed') {
      toast.error('A pass can’t be sent back for revision — the lesson is already complete');
      return;
    }
    if (outcome === 'Needs revision' && !draft.feedback.trim()) {
      setAttempted('feedback');
      feedbackRef.current?.focus();
      return;
    }
    if (outcome === 'Passed' && grade < detail.lesson.passingGrade && s.status !== 'Passed') {
      const ok = await app.confirm({
        title: `Pass with ${grade}?`,
        description: `The passing grade for this assignment is ${detail.lesson.passingGrade}. Passing completes the lesson for ${first} and can’t be sent back for revision later.`,
        confirmLabel: 'Pass anyway',
      });
      if (!ok) return;
    }

    const id = s.id;
    const from = s.status;
    const saved = draft;
    const leaves = !(filters.status === 'all' || filters.status === outcome);
    const i = rows.findIndex(r => r.id === id);
    const next = !leaves ? null : i >= 0 ? rows[i + 1]?.id ?? rows[i - 1]?.id ?? null : rows.find(r => r.id !== id)?.id ?? null;

    busy.current.add(id);
    await qc.cancelQueries({ queryKey: qk.gradingRoot });
    const snap = snapshotGrading(qc);
    clearDraft(id);
    applyGrade(qc, { id, from, to: outcome, grade: Math.round(grade), feedback: draft.feedback.trim(), me: { id: ws.me.id, name: ws.me.name } });
    if (leaves) navigate(next ? `/grading/${next}${queueSearch}` : `/grading${queueSearch}`, { replace: true });

    try {
      const res = await gradeSubmission({ id, grade: Math.round(grade), feedback: draft.feedback.trim(), outcome, queue: { status: filters.status, courseId: filters.courseId, scope: filters.scope, q: filters.q || undefined, ordering: filters.ordering } });
      // Confirmed in the header rather than a toast, which would sit on top of the next submission's grading bar.
      const outcomeLabel =
        outcome === 'Passed'
          ? from === 'Passed' ? 'Grade updated' : res.courseCompleted ? 'Passed · course complete' : 'Passed'
          : from === 'Needs revision' ? 'Feedback updated' : 'Sent back for revision';
      setRecent({ id, name: detail.learner.name, label: outcomeLabel, grade: Math.round(grade), tab: outcome === 'Passed' ? 'graded' : 'revision', at: Date.now(), tone: outcome === 'Passed' ? 'success' : 'warning' });
      if (leaves && !next && res.nextId && res.nextId !== id) navigate(`/grading/${res.nextId}${queueSearch}`, { replace: true });
      refreshSoon(qc, [qk.gradingRoot], 400);
      refreshEverythingSoon(qc, 600);
    } catch (e) {
      restoreGrading(qc, snap);
      writeDraft(id, saved);
      toast.error(errorMessage(e, 'Couldn’t save that grade'), leaves ? { action: { label: 'Reopen', onClick: () => navigate(`/grading/${id}${queueSearch}`) } } : undefined);
      if (!leaves) setDraftState({ id, draft: saved });
    } finally {
      busy.current.delete(id);
    }
  };

  const [recent, setRecent] = useState<{ id: string; name: string; label: string; grade: number; tab: GradingTab; at: number; tone: 'success' | 'warning' } | null>(null);
  useEffect(() => {
    if (!recent) return;
    const t = window.setTimeout(() => setRecent(r => (r?.at === recent.at ? null : r)), 9000);
    return () => window.clearTimeout(t);
  }, [recent]);

  // ── Keyboard ───────────────────────────────────────────────────────────
  useHotkeys({
    j: () => nextId && open(nextId),
    k: () => prevId && open(prevId),
    f: () => {
      if (!detail?.canGrade) return;
      if (detail.submission.status !== 'Submitted' && !draft?.editing) {
        if (!detail.submission.supersededById) updateDraft({ editing: true, grade: detail.submission.grade == null ? '' : String(detail.submission.grade), feedback: detail.submission.feedback });
        window.setTimeout(() => feedbackRef.current?.focus(), 30);
        return;
      }
      feedbackRef.current?.focus();
    },
    '/': () => setSearchOpen(true),
    esc: () => {
      if (!wide && submissionId) navigate(`/grading${queueSearch}`);
    },
  });
  useHotkeys({ 'mod+enter': () => void submit('Passed'), 'mod+shift+enter': () => void submit('Needs revision') }, { allowInInputs: ['mod+enter', 'mod+shift+enter'] });

  // ── Filters ────────────────────────────────────────────────────────────
  const setFilters = (patch: Partial<QueueFilters>) => {
    if (patch.q !== undefined) setQ(patch.q);
    if (patch.scope) setScope(patch.scope);
    if (patch.ordering) setOrderings(o => ({ ...o, [tab]: patch.ordering! }));
    if (patch.courseId !== undefined) {
      setParams(p => {
        if (patch.courseId) p.set('course', patch.courseId);
        else p.delete('course');
        return p;
      }, { replace: true });
    }
  };
  const filtered = Boolean(debouncedQ.trim() || courseId);
  const empty = (compact: boolean) => (
    <GradingEmpty
      tab={tab}
      counts={counts}
      elsewhere={queue.data?.elsewhere?.submitted ?? 0}
      filtered={filtered}
      scope={scope}
      compact={compact}
      search={search}
      onShowAll={() => setScope('all')}
      onClearFilters={() => {
        setQ('');
        setSearchOpen(false);
        setFilters({ courseId: null });
      }}
    />
  );

  const tabCount = (t: GradingTab) => (!counts ? null : t === 'todo' ? counts.submitted : t === 'revision' ? counts.needsRevision : counts.passed);

  // Nothing to list on a wide screen: the queue takes the whole width and says so once, instead of an empty column beside an empty pane.
  const wideEmpty = wide && !submissionId && !queue.isPending && !queue.isError && rows.length === 0;

  const queuePane = (
    <GradingQueue
      tab={tab}
      filters={{ ...filters, q }}
      onFilters={setFilters}
      rows={rows}
      isPending={queue.isPending}
      isError={queue.isError}
      onRetry={() => void queue.refetch()}
      activeId={submissionId}
      onOpen={id => open(id, wide ? 'replace' : 'push')}
      searchOpen={searchOpen}
      onSearchOpen={setSearchOpen}
      empty={wideEmpty ? empty(false) : wide ? <p className="px-4 py-6 text-center text-[14px] text-muted-foreground">{filtered ? 'No submissions match.' : tab === 'todo' ? (scope === 'mine' ? 'Nothing waiting in your courses.' : 'No submissions waiting.') : tab === 'revision' ? 'Nothing waiting on a resubmission.' : 'Nothing graded yet.'}</p> : empty(true)}
    />
  );

  const detailPane = !submissionId ? (
    queue.isPending ? <DetailSkeleton /> : empty(false)
  ) : detailQuery.isError && !detail ? (
    <EmptyState
      title="This submission isn’t available"
      description="It may have been deleted, or the link is wrong."
      action={<button type="button" onClick={() => navigate(`/grading${queueSearch}`)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">Back to the queue</button>}
      className="h-full"
    />
  ) : !detail || !draft ? (
    <DetailSkeleton />
  ) : (
    <SubmissionPane
      detail={detail}
      position={position}
      prevId={prevId}
      nextId={nextId}
      onPrev={() => prevId && open(prevId)}
      onNext={() => nextId && open(nextId)}
      onBack={wide ? undefined : () => navigate(`/grading${queueSearch}`)}
      queueSearch={queueSearch}
      inlineBar={!wide}
      bar={
        <GradingBar
          detail={detail}
          draft={draft}
          onDraft={updateDraft}
          onSubmit={o => void submit(o)}
          aiEnabled={ws.features.ai}
          feedbackRef={feedbackRef}
          gradeRef={gradeRef}
          attempted={attempted}
          inline={!wide}
        />
      }
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<ClipboardCheck />}
        title="Grading"
        tabs={TABS.map(t => ({ to: `/grading${search(t)}`, label: TAB_LABEL[t], count: tabCount(t), active: t === tab }))}
        actions={
          recent && recent.id !== submissionId ? (
            <span role="status" className={cn('inline-flex h-8 max-w-[420px] items-center gap-1.5 rounded-md px-2 text-sm animate-fade-in', recent.tone === 'success' ? 'bg-tone-success/[0.1] text-tone-success' : 'bg-tone-warning/[0.12] text-tone-warning')}>
              {recent.tone === 'success' ? <Check className="h-3.5 w-3.5 shrink-0" /> : <RotateCcw className="h-3 w-3 shrink-0" />}
              <span className="hidden truncate sm:inline">
                {recent.label} · {recent.name} · {recent.grade}
              </span>
              <span className="sm:hidden">{recent.label.split(' · ')[0]}</span>
              <button type="button" onClick={() => navigate(`/grading/${recent.id}${search(recent.tab)}`)} className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline">
                View
              </button>
            </span>
          ) : undefined
        }
      />
      <div className="flex min-h-0 flex-1">
        {wide ? (
          <>
            <aside className={cn('flex flex-col', wideEmpty ? 'min-w-0 flex-1' : 'w-[340px] shrink-0 border-r')} aria-label="Grading queue">{queuePane}</aside>
            {!wideEmpty && <section className="flex min-w-0 flex-1 flex-col" aria-label="Submission">{detailPane}</section>}
          </>
        ) : submissionId ? (
          <section className="flex min-w-0 flex-1 flex-col">{detailPane}</section>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">{queuePane}</div>
        )}
      </div>
    </div>
  );
}
