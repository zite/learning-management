import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, BellRing, CalendarDays, Check, GraduationCap, Search, Undo2, UserMinus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { updatePathEnrollments } from 'zitejs/api';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@project/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { dueState } from '@project/shared/progress';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { plural, shortDate, timeAgo } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { qk } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, Kbd, SkeletonRows, Tip } from '../primitives/bits';
import { CertificateMark, DuePill, StatusGlyph } from '../primitives/icons';
import { DatePicker } from '../pickers/pickers';
import { MiniBar, SearchField } from '../courses/CourseBits';
import { useListKeys } from '../courses/useListKeys';
import { usePathEnrollments, useRefreshPath, type PathDetail, type PathEnrollmentFilters, type PathEnrollmentList, type PathEnrollmentOrdering, type PathEnrollmentRow } from './pathData';

const TABS: Array<{ key: string; label: string; filters: PathEnrollmentFilters }> = [
  { key: 'all', label: 'All', filters: {} },
  { key: 'overdue', label: 'Overdue', filters: { due: ['overdue'] } },
  { key: 'in_progress', label: 'In progress', filters: { statuses: ['In progress'] } },
  { key: 'not_started', label: 'Not started', filters: { statuses: ['Not started'] } },
  { key: 'completed', label: 'Completed', filters: { statuses: ['Completed'] } },
  { key: 'withdrawn', label: 'Withdrawn', filters: { statuses: ['Withdrawn'] } },
];

const ORDERINGS: Array<{ value: PathEnrollmentOrdering; label: string }> = [
  { value: 'due_asc', label: 'Due date' },
  { value: 'progress_asc', label: 'Least progress' },
  { value: 'progress_desc', label: 'Most progress' },
  { value: 'enrolled_desc', label: 'Newest enrollments' },
  { value: 'completed_desc', label: 'Recently completed' },
  { value: 'name_asc', label: 'Learner name' },
];

type Action = 'set_due' | 'remind' | 'withdraw' | 'restore';

const isOpen = (r: PathEnrollmentRow) => r.status === 'Not started' || r.status === 'In progress';

/** Everyone on a learning path, with where they are in each of its courses. */
export function PathLearners({ detail }: { detail: PathDetail }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refresh = useRefreshPath();
  const pathId = detail.path.id;
  const [params, setParams] = useSearchParams();
  // `?status=overdue` (from the Overdue number on the Courses tab) opens on that tab.
  const [tab, setTabState] = useState(() => (TABS.some(t => t.key === params.get('status')) ? params.get('status')! : 'all'));
  const setTab = (key: string) => {
    setTabState(key);
    if (params.has('status')) {
      const next = new URLSearchParams(params);
      next.delete('status');
      setParams(next, { replace: true });
    }
  };
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [ordering, setOrdering] = useState<PathEnrollmentOrdering>('due_asc');
  const [dueTargets, setDueTargets] = useState<PathEnrollmentRow[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 220);
    return () => window.clearTimeout(t);
  }, [q]);

  const filters = useMemo<PathEnrollmentFilters>(() => ({ ...(TABS.find(t => t.key === tab)?.filters ?? {}), ...(debounced ? { q: debounced } : {}) }), [tab, debounced]);
  const { data, isPending, isError, refetch, isFetching } = usePathEnrollments(pathId, filters, ordering);
  const rows = data?.rows ?? [];
  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
  const ids = useMemo(() => rows.map(r => r.id), [rows]);
  const list = useListKeys({ ids, scrollRef, onOpen: id => { const r = byId.get(id); if (r) navigate(`/people/${r.personId}`); } });
  useEffect(() => list.clear(), [tab]);
  useHotkeys({ '/': () => window.setTimeout(() => searchRef.current?.focus(), 0) });

  const selected = rows.filter(r => list.selection.has(r.id));
  const courseById = useMemo(() => new Map(detail.courses.map(c => [c.courseId, c])), [detail.courses]);

  const run = async (targets: PathEnrollmentRow[], action: Action, dueDate?: string | null) => {
    if (!targets.length) return;
    const ids = new Set(targets.map(t => t.id));
    const snap = qc.getQueriesData<PathEnrollmentList>({ queryKey: [...qk.pathRoot, pathId, 'enrollments'] });
    const now = new Date().toISOString();
    qc.setQueriesData<PathEnrollmentList>({ queryKey: [...qk.pathRoot, pathId, 'enrollments'] }, old =>
      old
        ? {
            ...old,
            rows: old.rows.map(r => {
              if (!ids.has(r.id)) return r;
              if (action === 'set_due' && isOpen(r)) return { ...r, dueDate: dueDate ?? null, dueState: dueState({ status: r.status, dueDate: dueDate ?? null }) };
              if (action === 'withdraw' && r.status !== 'Withdrawn') return { ...r, status: 'Withdrawn' as const, dueState: 'withdrawn' as const };
              if (action === 'restore' && r.status === 'Withdrawn') return { ...r, status: r.progress > 0 ? ('In progress' as const) : ('Not started' as const), dueState: dueState({ status: r.progress > 0 ? 'In progress' : 'Not started', dueDate: r.dueDate }) };
              if (action === 'remind' && isOpen(r)) return { ...r, remindedAt: now };
              return r;
            }),
          }
        : old,
    );
    try {
      const res = await updatePathEnrollments({ ids: [...ids], action, dueDate });
      const verb = { set_due: 'Updated the due date for', remind: 'Sent a reminder to', withdraw: 'Withdrew', restore: 'Restored' }[action];
      const extra = action === 'withdraw' && res.courseEnrollments ? `Also withdrew ${plural(res.courseEnrollments, 'unfinished course enrollment')} the path had created.` : action === 'restore' && res.courseEnrollments ? `${plural(res.courseEnrollments, 'course enrollment')} restored with it.` : action === 'set_due' && res.courseEnrollments ? `${plural(res.courseEnrollments, 'unfinished course')} moved to the same date.` : undefined;
      toast.success(`${verb} ${plural(res.updated, 'learner')}${res.skipped ? ` · ${res.skipped} skipped` : ''}`, { description: extra });
      list.clear();
      refresh({ enrollments: action !== 'remind' });
    } catch (e) {
      for (const [key, value] of snap) qc.setQueryData(key, value);
      toast.error(errorMessage(e, "Couldn't update those learners"));
    }
  };

  const withdraw = async (targets: PathEnrollmentRow[]) => {
    const t = targets.filter(r => r.status !== 'Withdrawn');
    if (!t.length) return;
    const ok = await app.confirm({
      title: `Withdraw ${t.length === 1 ? t[0].personName : plural(t.length, 'learner')} from the path?`,
      description: 'They lose access to the path, and their unfinished courses from it are withdrawn too. Completed courses and certificates stay on their record. You can restore them later with progress intact.',
      confirmLabel: 'Withdraw',
      destructive: true,
    });
    if (ok) run(t, 'withdraw');
  };

  const focused = list.focusedId ? byId.get(list.focusedId) : undefined;
  const targets = () => (selected.length ? selected : focused ? [focused] : []);
  useHotkeys({
    r: () => run(targets().filter(isOpen), 'remind'),
    d: () => {
      const t = targets().filter(isOpen);
      if (t.length) setDueTargets(t);
    },
    'shift+w': () => withdraw(targets()),
  });

  const s = data?.summary;
  const count = (key: string) => (!s ? null : key === 'all' ? s.total : key === 'overdue' ? s.overdue : key === 'in_progress' ? s.inProgress : key === 'not_started' ? s.notStarted : key === 'completed' ? s.completed : s.withdrawn);
  const published = detail.path.status === 'Published';

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none" role="tablist" aria-label="Status">
          {TABS.map(t => {
            const n = count(t.key);
            if (t.key === 'withdrawn' && !n) return null;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13.5px] transition-colors', tab === t.key ? 'border-border bg-accent font-medium text-foreground shadow-2xs' : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>
                {t.label}
                {n != null && n > 0 && <span className={cn('tabular-nums', t.key === 'overdue' ? 'text-tone-danger' : 'text-muted-foreground')}>{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {isFetching && !isPending && <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-primary/70" aria-label="Refreshing" />}
          <SearchField ref={searchRef} value={q} onChange={setQ} placeholder="Search learners…" className="w-40 sm:w-52" />
          <DropdownMenu>
            <Tip label="Ordering">
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="Ordering" active={ordering !== 'due_asc'}>
                  <ArrowUpDown />
                </IconButton>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-2xs font-medium text-muted-foreground">Order by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={ordering} onValueChange={v => setOrdering(v as PathEnrollmentOrdering)}>
                {ORDERINGS.map(o => (
                  <DropdownMenuRadioItem key={o.value} value={o.value} className="text-[14px]">
                    {o.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" role="grid" aria-label="Path learners">
        {isPending ? (
          <SkeletonRows rows={8} className="pt-2" />
        ) : isError ? (
          <EmptyState icon={<Search />} title="Couldn't load learners" description="Check your connection and try again." action={<button type="button" onClick={() => refetch()} className="text-[14px] text-primary hover:underline">Retry</button>} />
        ) : rows.length === 0 ? (
          debounced || tab !== 'all' ? (
            <EmptyState icon={<Search />} title={tab === 'overdue' && !debounced ? 'Nothing overdue' : 'Nobody matches'} description={tab === 'overdue' && !debounced ? 'Everyone on the path is on track.' : 'Try another tab or search.'} action={debounced ? <button type="button" onClick={() => setQ('')} className="text-[14px] text-primary hover:underline">Clear search</button> : undefined} />
          ) : (
            <EmptyState
              icon={<GraduationCap />}
              title="Nobody is on this path yet"
              description={published ? 'Enroll people or groups — they’re enrolled in each course of the path, with one due date.' : 'Publish the path, then enroll people or groups.'}
              action={published ? <button type="button" onClick={() => app.openEnroll({ targetType: 'Path', targetId: pathId })} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">Enroll people</button> : undefined}
            />
          )
        ) : (
          <>
            <div className="sticky top-0 z-[1] hidden h-9 items-center gap-3 border-b bg-subtle/95 px-4 text-sm text-muted-foreground backdrop-blur sm:flex">
              <span className="w-[78px] shrink-0" aria-hidden />
              <span className="w-[220px] shrink-0 lg:w-[260px]">Learner</span>
              <Tip label="One dot per course, in path order: filled is completed, half-filled in progress, hollow not started. Smaller dots are optional courses.">
                <span className="min-w-0 flex-1">Courses</span>
              </Tip>
              <span className="hidden w-[120px] shrink-0 md:block">Progress</span>
              <span className="hidden w-[118px] shrink-0 text-right lg:block">Due</span>
              <span className="hidden w-[72px] shrink-0 text-right xl:block">Enrolled</span>
            </div>
            {rows.map(r => (
              <LearnerRow
                key={r.id}
                row={r}
                courses={detail.courses}
                courseTitle={id => courseById.get(id)?.title ?? ws.courseById.get(id)?.title ?? 'Course'}
                focused={list.focusedId === r.id}
                selected={list.selection.has(r.id)}
                selecting={list.selection.size > 0}
                onToggle={e => list.toggle(r.id, e)}
                onClick={e => list.onRowClick(r.id, e)}
                onHover={() => list.setFocusedId(r.id)}
                onAction={(action, row) => {
                  const t = list.selection.size > 1 && list.selection.has(row.id) ? selected : [row];
                  if (action === 'withdraw') withdraw(t);
                  else if (action === 'set_due') setDueTargets(t.filter(isOpen));
                  else run(action === 'remind' ? t.filter(isOpen) : t.filter(x => x.status === 'Withdrawn'), action);
                }}
              />
            ))}
            {data?.truncated && <p className="px-5 py-3 text-sm text-muted-foreground">Showing the first {rows.length.toLocaleString()} — search to narrow it down.</p>}
            <div className="hidden items-center gap-3 px-4 py-3 text-2xs text-muted-foreground md:flex">
              <span className="flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> move</span>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> open person</span>
              <span className="flex items-center gap-1"><Kbd>X</Kbd> select</span>
              <span className="flex items-center gap-1"><Kbd>R</Kbd> remind</span>
              <span className="flex items-center gap-1"><Kbd>D</Kbd> due date</span>
            </div>
          </>
        )}
      </div>

      {selected.length > 0 && <BulkBar rows={selected} onClear={list.clear} onRemind={() => run(selected.filter(isOpen), 'remind')} onDue={() => setDueTargets(selected.filter(isOpen))} onWithdraw={() => withdraw(selected)} onRestore={() => run(selected.filter(r => r.status === 'Withdrawn'), 'restore')} />}
      {dueTargets && dueTargets.length > 0 && (
        <DatePicker
          open
          onOpenChange={o => !o && setDueTargets(null)}
          value={dueTargets.length === 1 ? dueTargets[0].dueDate : null}
          clearLabel="Remove due date"
          onChange={d => {
            const t = dueTargets;
            setDueTargets(null);
            run(t, 'set_due', d);
          }}
          align="center"
          trigger={<span className="pointer-events-none fixed bottom-24 left-1/2 h-0 w-0" aria-hidden />}
        />
      )}
    </div>
  );
}

function CourseDots({ row, courses, courseTitle }: { row: PathEnrollmentRow; courses: PathDetail['courses']; courseTitle: (id: string) => string }) {
  const optional = new Map(courses.map(c => [c.courseId, c.optional]));
  return (
    <span className="flex items-center gap-1" aria-label={`${row.done} of ${row.total} required courses complete`}>
      {row.courses.map((c, i) => {
        const tone = c.status === 'Completed' ? 'border-foreground/70 bg-foreground/70' : c.status === 'In progress' ? 'border-foreground/70 bg-[linear-gradient(90deg,hsl(var(--foreground)/0.7)_50%,transparent_50%)]' : c.status === 'Withdrawn' ? 'border-muted-foreground/40 bg-transparent' : c.status === 'Not started' ? 'border-muted-foreground/60 bg-transparent' : 'border-dashed border-muted-foreground/40 bg-transparent';
        const label = c.status === 'Completed' ? 'completed' : c.status === 'In progress' ? `in progress · ${c.progress}%` : c.status === 'Not started' ? 'not started' : c.status === 'Withdrawn' ? 'withdrawn' : 'not enrolled';
        return (
          <Tip key={c.courseId} label={`${i + 1}. ${courseTitle(c.courseId)} — ${label}${optional.get(c.courseId) ? ' (optional)' : ''}`}>
            <span className={cn('block h-2.5 w-2.5 shrink-0 rounded-full border', tone, optional.get(c.courseId) && 'h-2 w-2')} />
          </Tip>
        );
      })}
    </span>
  );
}

function LearnerRow({ row: r, courses, courseTitle, focused, selected, selecting, onToggle, onClick, onHover, onAction }: {
  row: PathEnrollmentRow;
  courses: PathDetail['courses'];
  courseTitle: (id: string) => string;
  focused: boolean;
  selected: boolean;
  selecting: boolean;
  onToggle: (e: MouseEvent) => void;
  onClick: (e: MouseEvent) => void;
  onHover: () => void;
  onAction: (action: Action, row: PathEnrollmentRow) => void;
}) {
  const navigate = useNavigate();
  const open = isOpen(r);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-row-id={r.id}
          role="row"
          aria-selected={selected}
          onClick={onClick}
          onMouseEnter={onHover}
          className={cn('group relative flex h-11 cursor-default items-center gap-3 border-b px-4 text-[14px] transition-colors', selected ? 'bg-primary/[0.06]' : focused ? 'bg-accent/60' : 'hover:bg-accent/40', r.status === 'Withdrawn' && 'text-muted-foreground')}
        >
          {focused && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />}
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`Select ${r.personName}`}
            onClick={e => {
              e.stopPropagation();
              onToggle(e);
            }}
            className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-opacity', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background', selected || selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          >
            {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
          </button>
          <StatusGlyph status={r.status} progress={r.progress} dueState={r.dueState} />
          <PersonAvatar person={{ name: r.personName, color: r.personColor, avatarUrl: r.personAvatarUrl, status: r.personStatus }} size={22} />
          <div className="min-w-0 flex-1 sm:w-[220px] sm:flex-none lg:w-[260px]">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium">{r.personName}</span>
              {r.certificateId && <CertificateMark />}
              {r.cycle > 1 && <span className="shrink-0 text-2xs text-muted-foreground">Cycle {r.cycle}</span>}
            </div>
            <div className="truncate text-sm text-muted-foreground">{r.personTitle || r.personEmail}</div>
          </div>
          <div className="hidden min-w-0 flex-1 items-center gap-3 sm:flex">
            <CourseDots row={r} courses={courses} courseTitle={courseTitle} />
            <span className="text-sm tabular-nums text-muted-foreground">
              {r.done}/{r.total}
            </span>
          </div>
          <MiniBar value={r.progress} className="hidden w-[120px] shrink-0 md:flex" />
          <span className="hidden w-[118px] shrink-0 justify-end lg:flex">
            {r.status === 'Completed' ? <span className="text-sm text-muted-foreground">Completed {shortDate(r.completedAt)}</span> : r.status === 'Withdrawn' ? <span className="text-sm">Withdrawn</span> : <DuePill dueDate={r.dueDate} dueState={r.dueState} />}
          </span>
          <span className="hidden w-[72px] shrink-0 items-center justify-end gap-1 text-sm text-muted-foreground xl:flex">
            {r.remindedAt && (
              <Tip label={`Reminded ${timeAgo(r.remindedAt)}`}>
                <BellRing className="h-3 w-3 shrink-0" aria-label={`Reminded ${timeAgo(r.remindedAt)}`} />
              </Tip>
            )}
            {r.enrolledAt ? timeAgo(r.enrolledAt) : ''}
          </span>
          <span className="shrink-0 sm:hidden">
            <DuePill dueDate={r.dueDate} dueState={r.dueState} compact />
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem className="gap-2 text-[14px]" onSelect={() => navigate(`/people/${r.personId}`)}>
          Open {r.personName.split(' ')[0]}’s profile
        </ContextMenuItem>
        <ContextMenuSeparator />
        {open && (
          <>
            <ContextMenuItem className="gap-2 text-[14px]" onSelect={() => onAction('remind', r)}>
              <BellRing className="h-3.5 w-3.5" /> Send reminder
            </ContextMenuItem>
            <ContextMenuItem className="gap-2 text-[14px]" onSelect={() => onAction('set_due', r)}>
              <CalendarDays className="h-3.5 w-3.5" /> Change due date…
            </ContextMenuItem>
          </>
        )}
        {r.status === 'Withdrawn' ? (
          <ContextMenuItem className="gap-2 text-[14px]" onSelect={() => onAction('restore', r)}>
            <Undo2 className="h-3.5 w-3.5" /> Restore
          </ContextMenuItem>
        ) : (
          <ContextMenuItem className="gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => onAction('withdraw', r)}>
            <UserMinus className="h-3.5 w-3.5" /> Withdraw…
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function BulkBar({ rows, onClear, onRemind, onDue, onWithdraw, onRestore }: { rows: PathEnrollmentRow[]; onClear: () => void; onRemind: () => void; onDue: () => void; onWithdraw: () => void; onRestore: () => void }) {
  const open = rows.filter(isOpen).length;
  const withdrawn = rows.filter(r => r.status === 'Withdrawn').length;
  const btn = 'ghost-chip h-9 gap-1.5 px-2.5 text-[14px] text-foreground/90 hover:text-foreground';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div role="toolbar" aria-label="Bulk actions" className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border bg-popover p-1 shadow-xl animate-fade-up">
        <div className="flex h-9 items-center gap-2 border-r pl-2.5 pr-2">
          <span className="whitespace-nowrap text-[14px] font-medium tabular-nums">{rows.length} selected</span>
          <button type="button" onClick={onClear} aria-label="Clear selection" className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {open > 0 && (
          <>
            <button type="button" className={btn} onClick={onRemind}>
              <BellRing className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Remind{open !== rows.length ? ` ${open}` : ''}</span>
            </button>
            <button type="button" className={btn} onClick={onDue}>
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Due date</span>
            </button>
          </>
        )}
        {withdrawn > 0 && (
          <button type="button" className={btn} onClick={onRestore}>
            <Undo2 className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Restore{withdrawn !== rows.length ? ` ${withdrawn}` : ''}</span>
          </button>
        )}
        {rows.length > withdrawn && (
          <button type="button" className={cn(btn, 'text-tone-danger hover:text-tone-danger')} onClick={onWithdraw}>
            <UserMinus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Withdraw</span>
          </button>
        )}
        <span className="hidden items-center gap-1 border-l px-2 text-2xs text-muted-foreground md:flex">
          <Kbd>Esc</Kbd> to clear
        </span>
      </div>
    </div>
  );
}
