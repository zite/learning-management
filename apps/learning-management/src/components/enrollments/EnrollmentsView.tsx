import { BellRing, CalendarDays, Check, CheckCircle2, ChevronRight, Download, GraduationCap, Layers, MoreHorizontal, RotateCcw, Save, Search, SlidersHorizontal, Undo2, UserMinus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { saveView } from 'zitejs/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { DISPLAY_PROPERTIES, DISPLAY_PROPERTY_LABEL, GROUPINGS, ORDERINGS, STATUS_META } from '../../lib/constants';
import { downloadText } from '../../lib/download';
import { errorMessage } from '../../lib/errors';
import { formatDuration } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { useEnrollmentActions } from '../../lib/mutations';
import { qk, useEnrollments, usePeopleSearch } from '../../lib/queries';
import type { Enrollment, EnrollmentFilters } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, Kbd, SkeletonRows, Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { DatePicker } from '../pickers/pickers';
import { EnrollmentHeader, EnrollmentRow, fitProperties } from './EnrollmentRow';
import { describeFilters, FilterChips, FilterMenu, type FilterKey } from './filters';
import { groupEnrollments, useViewState, type ViewOptions } from './view';

export type EnrollmentsViewProps = {
  /** Remembers filters and display per surface ("course:abc", "person:xyz", "enrollments"). */
  surfaceKey: string;
  /** The surface's fixed scope, merged under the user's own filters. */
  baseFilters?: EnrollmentFilters;
  lockedFilters?: FilterKey[];
  defaults?: Partial<ViewOptions>;
  defaultFilters?: EnrollmentFilters;
  primary?: 'person' | 'course';
  savedView?: { id: string; name: string; scope: string } | null;
  hideSaveView?: boolean;
  toolbarStart?: ReactNode;
  emptyState?: ReactNode;
  /** Show the Not started / In progress / Completed / Overdue tabs with counts. */
  statusTabs?: boolean;
};

type Tab = NonNullable<EnrollmentFilters['tab']>;
/** Tabs narrow whatever the filters already show — they never replace a status or due filter. */
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_soon', label: 'Due soon' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'not_started', label: 'Not started' },
  { key: 'completed', label: 'Completed' },
  { key: 'withdrawn', label: 'Withdrawn' },
];
const TAB_EMPTY: Record<string, [string, string]> = {
  overdue: ['Nothing overdue', 'Everyone here is on track.'],
  due_soon: ['Nothing due this week', 'Enrollments due in the next 7 days show here.'],
  in_progress: ['Nobody is in progress', 'Learners show here once they start.'],
  not_started: ['Everyone has started', 'Enrollments nobody has opened yet show here.'],
  completed: ['Nothing completed yet', 'Finished training shows here.'],
  withdrawn: ['No withdrawn enrollments', 'Withdrawn training shows here, ready to restore.'],
};

/** Tabs that only appear while they have something in them. */
const HIDE_WHEN_EMPTY = new Set(['due_soon', 'withdrawn']);

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Every list of enrollments in the app is this component: fetching, filters,
 * status tabs, grouping, selection, keyboard navigation, bulk actions, export
 * and saved views. A new surface only says what it's scoped to.
 */
export function EnrollmentsView({ surfaceKey, baseFilters = {}, lockedFilters = [], defaults, defaultFilters, primary = 'person', savedView, hideSaveView, toolbarStart, emptyState, statusTabs = true }: EnrollmentsViewProps) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { run } = useEnrollmentActions();
  const navigate = useNavigate();
  const view = useViewState(surfaceKey, defaults, defaultFilters);
  const { options, setOptions, filters, setFilters } = view;

  const [searchOpen, setSearchOpen] = useState(Boolean(filters.q));
  const [searchText, setSearchText] = useState(filters.q ?? '');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setFilters(f => ({ ...f, q: searchText.trim() || undefined })), 220);
    return () => window.clearTimeout(t);
  }, [searchText, setFilters]);

  const [tab, setTab] = useState<Tab>('all');
  const query = useMemo<EnrollmentFilters>(() => ({ ...baseFilters, ...filters, ...(statusTabs && tab !== 'all' ? { tab } : {}) }), [baseFilters, filters, tab, statusTabs]);
  const { data, isPending, isFetching, isError, refetch } = useEnrollments(query, options.ordering);
  const rows = data?.rows ?? [];

  const managerIds = useMemo(() => (options.groupBy === 'manager' ? [...new Set(rows.map(r => r.managerId).filter(Boolean) as string[])] : []), [rows, options.groupBy]);
  const { data: managers } = usePeopleSearch('', { ids: managerIds, enabled: managerIds.length > 0 });
  const managerNames = useMemo(() => new Map((managers?.people ?? []).map(p => [p.id, p.name])), [managers]);

  const groups = useMemo(() => groupEnrollments(rows, options.groupBy, ws, managerNames), [rows, options.groupBy, ws, managerNames]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const visible = useMemo(() => groups.flatMap(g => (collapsed.has(g.key) ? [] : g.rows)), [groups, collapsed]);
  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dueTargets, setDueTargets] = useState<Enrollment[] | null>(null);
  const [saveMode, setSaveMode] = useState<'update' | 'new' | null>(null);
  const anchor = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelection(prev => {
      const next = new Set([...prev].filter(id => byId.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [byId]);
  useEffect(() => {
    setSelection(new Set());
    setFocusedId(null);
  }, [surfaceKey, tab]);

  const selected = useMemo(() => rows.filter(r => selection.has(r.id)), [rows, selection]);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  const getTargets = useCallback((r: Enrollment) => {
    const sel = selectionRef.current;
    if (sel.size > 1 && sel.has(r.id)) return [...sel].map(id => byIdRef.current.get(id)).filter(Boolean) as Enrollment[];
    return [byIdRef.current.get(r.id) ?? r];
  }, []);

  const toggleSelect = useCallback(
    (r: Enrollment, e?: MouseEvent | KeyboardEvent) => {
      setSelection(prev => {
        const next = new Set(prev);
        if (e?.shiftKey && anchor.current) {
          const a = visible.findIndex(v => v.id === anchor.current);
          const b = visible.findIndex(v => v.id === r.id);
          if (a >= 0 && b >= 0) {
            for (let n = Math.min(a, b); n <= Math.max(a, b); n++) next.add(visible[n].id);
            return next;
          }
        }
        if (next.has(r.id)) next.delete(r.id);
        else next.add(r.id);
        anchor.current = r.id;
        return next;
      });
      setFocusedId(r.id);
    },
    [visible],
  );

  const onRowClick = useCallback(
    (r: Enrollment, e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || selectionRef.current.size > 0) {
        e.preventDefault();
        toggleSelect(r, e);
        return;
      }
      setFocusedId(r.id);
      app.openEnrollment(r.id);
    },
    [toggleSelect, app],
  );
  const onHover = useCallback((r: Enrollment) => setFocusedId(r.id), []);
  const onDue = useCallback((t: Enrollment[]) => setDueTargets(t), []);

  const focusIndex = visible.findIndex(r => r.id === focusedId);
  const focusAt = (idx: number, extend?: boolean) => {
    const next = visible[Math.max(0, Math.min(visible.length - 1, idx))];
    if (!next) return;
    setFocusedId(next.id);
    if (extend) setSelection(prev => new Set(prev).add(next.id).add(focusedId ?? next.id));
    window.setTimeout(() => scrollRef.current?.querySelector(`[data-row-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
  };
  const focused = focusedId ? byId.get(focusedId) : undefined;
  const targets = () => (selection.size ? selected : focused ? [focused] : []);
  const openTargets = () => targets().filter(t => t.status === 'Not started' || t.status === 'In progress');

  const exportCsv = (list: Enrollment[]) => {
    const header = ['Learner', 'Email', 'Job title', 'Course', 'Status', 'Due state', 'Progress %', 'Due date', 'Enrolled', 'Started', 'Completed', 'Last activity', 'Quiz score', 'Time spent', 'Enrolled via', 'Assigned by', 'Cycle'];
    const lines = list.map(r => [r.personName, r.personEmail, r.personTitle ?? '', ws.courseById.get(r.courseId)?.title ?? '', r.status, r.dueState, r.progress, r.dueDate ?? '', r.enrolledAt?.slice(0, 10) ?? '', r.startedAt?.slice(0, 10) ?? '', r.completedAt?.slice(0, 10) ?? '', r.lastActivityAt?.slice(0, 10) ?? '', r.score ?? '', formatDuration(r.timeSpentSeconds), r.source, r.assignedByName ?? '', r.cycle].map(csvCell).join(','));
    downloadText(`enrollments-${new Date().toISOString().slice(0, 10)}.csv`, [header.join(','), ...lines].join('\n'));
    toast.success(`Exported ${list.length} enrollment${list.length === 1 ? '' : 's'}`);
  };

  useHotkeys({
    j: () => focusAt(focusIndex + 1),
    down: () => focusAt(focusIndex + 1),
    k: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
    up: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
    'shift+j': () => focusAt(focusIndex + 1, true),
    'shift+down': () => focusAt(focusIndex + 1, true),
    'shift+k': () => focusAt(focusIndex - 1, true),
    'shift+up': () => focusAt(focusIndex - 1, true),
    x: () => focused && toggleSelect(focused),
    'mod+a': () => setSelection(new Set(visible.map(r => r.id))),
    esc: () => (selection.size ? setSelection(new Set()) : setFocusedId(null)),
    enter: () => focused && app.openEnrollment(focused.id),
    space: () => focused && app.openEnrollment(focused.id),
    d: () => openTargets().length && setDueTargets(openTargets()),
    r: () => openTargets().length && run(openTargets(), 'remind'),
    p: () => focused && navigate(`/people/${focused.personId}`),
    o: () => focused && navigate(`/courses/${focused.courseId}`),
    'shift+c': async () => {
      const t = openTargets();
      if (t.length && (await app.confirm({ title: `Mark ${t.length} enrollment${t.length === 1 ? '' : 's'} complete?`, description: 'For training finished offline. Certificates are issued and learning paths move forward.', confirmLabel: 'Mark complete' }))) run(t, 'complete');
    },
    'shift+w': async () => {
      const t = targets().filter(x => x.status !== 'Withdrawn');
      if (t.length && (await app.confirm({ title: `Withdraw ${t.length} enrollment${t.length === 1 ? '' : 's'}?`, description: 'They lose access and stop counting toward reports. You can restore them later.', confirmLabel: 'Withdraw', destructive: true }))) run(t, 'withdraw');
    },
    '/': () => {
      setSearchOpen(true);
      window.setTimeout(() => searchRef.current?.focus(), 0);
    },
  });

  const properties = useMemo(() => new Set(options.properties), [options.properties]);
  const hasUserFilters = Object.keys(filters).length > 0;
  const summary = data?.summary;
  const tabCount = (key: string) => (!summary ? null : key === 'all' ? summary.total : key === 'overdue' ? summary.overdue : key === 'due_soon' ? summary.dueSoon : key === 'in_progress' ? summary.inProgress : key === 'not_started' ? summary.notStarted : key === 'withdrawn' ? summary.withdrawn : summary.completed);
  const showGroupHeaders = options.groupBy !== 'none';
  // Grouping by course or learner puts that in the group header, so rows lead with the other one.
  const rowPrimary = options.groupBy === 'person' ? 'course' : options.groupBy === 'course' ? 'person' : primary;
  const [listWidth, setListWidth] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => setListWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rowProperties = useMemo(() => {
    const base = options.groupBy === 'course' ? new Set([...properties].filter(p => p !== 'course')) : options.groupBy === 'person' ? new Set([...properties].filter(p => p !== 'person')) : properties;
    return fitProperties(base, listWidth, rowPrimary === 'person' ? base.has('course') : base.has('person'));
  }, [properties, options.groupBy, listWidth, rowPrimary]);
  const allVisibleSelected = visible.length > 0 && visible.every(r => selection.has(r.id));
  const shownTotal = tabCount(statusTabs ? tab : 'all');

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        {toolbarStart}
        {statusTabs && (
          <div className="mr-1 flex items-center gap-0.5 overflow-x-auto scrollbar-none" role="tablist" aria-label="Status">
            {TABS.map(t => {
              const n = tabCount(t.key);
              if (HIDE_WHEN_EMPTY.has(t.key) && !n && tab !== t.key) return null;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13.5px] transition-colors', tab === t.key ? 'border-border bg-accent font-medium text-foreground shadow-2xs' : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground')}
                >
                  {t.label}
                  {n != null && n > 0 && <span className={cn('tabular-nums', t.key === 'overdue' ? 'text-tone-danger' : 'text-muted-foreground')}>{n}</span>}
                </button>
              );
            })}
          </div>
        )}
        <FilterMenu filters={filters} onChange={setFilters} locked={lockedFilters} />
        <FilterChips filters={filters} onChange={setFilters} locked={lockedFilters} />
        <div className="ml-auto flex items-center gap-1">
          {isFetching && !isPending && <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-primary/70" aria-label="Refreshing" />}
          {searchOpen ? (
            <div className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-2 animate-fade-in">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={searchRef}
                autoFocus
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setSearchText('');
                    setSearchOpen(false);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Search learners or courses…"
                className="w-44 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
              />
              <button type="button" aria-label="Clear search" onClick={() => { setSearchText(''); setSearchOpen(false); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Tip label="Search in view" keys={['/']}>
              <IconButton onClick={() => setSearchOpen(true)} aria-label="Search in view">
                <Search />
              </IconButton>
            </Tip>
          )}
          <DisplayMenu options={options} onChange={setOptions} onReset={view.reset} isDirty={view.isDirty} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="More view actions">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {!hideSaveView && (
                <>
                  {savedView && (
                    <DropdownMenuItem className="text-[14px]" onSelect={() => setSaveMode('update')}>
                      <Save className="h-3.5 w-3.5" /> Save changes to view…
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem className="text-[14px]" onSelect={() => setSaveMode('new')}>
                    <Save className="h-3.5 w-3.5" /> {savedView ? 'Save as new view…' : 'Save as view…'}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem className="text-[14px]" disabled={!rows.length} onSelect={() => exportCsv(rows)}>
                <Download className="h-3.5 w-3.5" /> Export to CSV
              </DropdownMenuItem>
              {view.isDirty && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-[14px]" onSelect={view.reset}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset view
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" role="grid" aria-label="Enrollments">
        {isPending ? (
          <SkeletonRows rows={10} className="pt-2" />
        ) : isError ? (
          <EmptyState icon={<Layers />} title="Couldn't load enrollments" description="Check your connection and try again." action={<button type="button" onClick={() => refetch()} className="text-[14px] text-primary hover:underline">Retry</button>} />
        ) : rows.length === 0 ? (
          hasUserFilters || tab !== 'all' ? (
            <EmptyState
              icon={hasUserFilters ? <Search /> : <Layers />}
              title={hasUserFilters ? 'Nothing matches' : TAB_EMPTY[tab]?.[0] ?? 'Nothing here'}
              description={hasUserFilters ? (tab !== 'all' ? 'Try removing a filter, or look in another tab.' : 'Try removing a filter.') : TAB_EMPTY[tab]?.[1]}
              action={hasUserFilters ? <button type="button" onClick={() => { setFilters({}); setSearchText(''); }} className="text-[14px] text-primary hover:underline">Clear filters</button> : undefined}
            />
          ) : summary?.withdrawn ? (
            <EmptyState
              icon={<Layers />}
              title="No active training"
              description={`${summary.withdrawn} withdrawn enrollment${summary.withdrawn === 1 ? ' is' : 's are'} kept on record and can be restored.`}
              action={<button type="button" onClick={() => setTab('withdrawn')} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">Show withdrawn</button>}
            />
          ) : (
            emptyState ?? <EmptyState icon={<GraduationCap />} title="No enrollments yet" description="Enroll people in a course or learning path and their progress shows up here." action={<button type="button" onClick={() => app.openEnroll()} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">Enroll people</button>} />
          )
        ) : (
          <div className={cn(selection.size > 0 && 'pb-20')}>
            <EnrollmentHeader
              primary={rowPrimary}
              properties={rowProperties}
              ordering={options.ordering}
              onOrder={ordering => setOptions({ ordering })}
              selectAll={
                <button
                  type="button"
                  aria-label={allVisibleSelected ? 'Deselect all' : 'Select all'}
                  aria-pressed={allVisibleSelected}
                  onClick={() => setSelection(allVisibleSelected ? new Set() : new Set(visible.map(r => r.id)))}
                  className={cn('flex h-4 w-4 items-center justify-center rounded-[4px] border transition-opacity focus-visible:opacity-100', allVisibleSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background', !allVisibleSelected && selection.size === 0 && 'opacity-0 hover:opacity-100')}
                >
                  {allVisibleSelected ? <Check className="h-3 w-3" strokeWidth={3} /> : selection.size > 0 ? <span className="h-[1.5px] w-2 rounded bg-foreground/60" /> : null}
                </button>
              }
            />
            {groups.map(g => {
              const isCollapsed = collapsed.has(g.key);
              const done = g.rows.filter(r => r.status === 'Completed').length;
              const groupSelected = g.rows.length > 0 && g.rows.every(r => selection.has(r.id));
              const groupPartly = !groupSelected && g.rows.some(r => selection.has(r.id));
              return (
                <div key={g.key}>
                  {showGroupHeaders && (
                    <div className="group/gh sticky top-8 z-10 flex h-9 items-center gap-2.5 border-b bg-subtle/95 pl-2 pr-4 text-[14px] backdrop-blur">
                      <button
                        type="button"
                        aria-label={groupSelected ? `Deselect ${g.label}` : `Select everyone in ${g.label}`}
                        aria-pressed={groupSelected}
                        onClick={() =>
                          setSelection(prev => {
                            const next = new Set(prev);
                            for (const r of g.rows) {
                              if (groupSelected) next.delete(r.id);
                              else next.add(r.id);
                            }
                            return next;
                          })
                        }
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-opacity focus-visible:opacity-100',
                          groupSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                          !groupSelected && selection.size === 0 && 'opacity-0 group-hover/gh:opacity-100',
                        )}
                      >
                        {groupSelected ? <Check className="h-3 w-3" strokeWidth={3} /> : groupPartly ? <span className="h-[1.5px] w-2 rounded bg-foreground/60" /> : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCollapsed(prev => { const next = new Set(prev); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; })}
                        className="-ml-1 flex min-w-0 items-center gap-2 rounded px-1 py-0.5 hover:bg-accent"
                        aria-expanded={!isCollapsed}
                      >
                        <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', !isCollapsed && 'rotate-90')} />
                        {g.courseId && <CourseGlyph icon={ws.courseById.get(g.courseId)?.icon} color={g.color} size={16} />}
                        {g.personId && options.groupBy === 'person' && <PersonAvatar person={{ name: g.label, color: g.rows[0]?.personColor, avatarUrl: g.rows[0]?.personAvatarUrl }} size={18} />}
                        <span className={cn('truncate font-medium', g.tone)}>{g.label}</span>
                        <span className="text-sm tabular-nums text-muted-foreground">{g.rows.length}</span>
                      </button>
                      <span className="ml-auto shrink-0 text-sm tabular-nums text-muted-foreground">{done}/{g.rows.length} complete</span>
                    </div>
                  )}
                  {!isCollapsed &&
                    g.rows.map(r => (
                      <EnrollmentRow
                        key={r.id}
                        row={r}
                        primary={rowPrimary}
                        properties={rowProperties}
                        selected={selection.has(r.id)}
                        focused={focusedId === r.id}
                        selecting={selection.size > 0}
                        onClick={onRowClick}
                        onToggleSelect={toggleSelect}
                        onHover={onHover}
                        getTargets={getTargets}
                        onDue={onDue}
                      />
                    ))}
                </div>
              );
            })}
            {data?.truncated && (
              <p className="border-b border-border/60 px-4 py-3 text-sm text-muted-foreground">
                Showing the first {rows.length.toLocaleString()}
                {shownTotal != null && shownTotal > rows.length ? ` of ${shownTotal.toLocaleString()}` : ''} enrollments. Narrow the filters or search to find the rest.
              </p>
            )}
          </div>
        )}
      </div>

      <BulkBar rows={selected} onClear={() => setSelection(new Set())} onDue={setDueTargets} onExport={() => exportCsv(selected)} />
      <DueDateDialog targets={dueTargets} onClose={() => setDueTargets(null)} />
      <SaveViewDialog open={saveMode !== null} onOpenChange={o => !o && setSaveMode(null)} filters={{ ...baseFilters, ...filters, q: undefined }} options={options} existing={saveMode === 'update' ? savedView : null} />
    </div>
  );
}

function DisplayMenu({ options, onChange, onReset, isDirty }: { options: ViewOptions; onChange: (p: Partial<ViewOptions>) => void; onReset: () => void; isDirty: boolean }) {
  return (
    <Popover>
      <Tip label="Display options">
        <PopoverTrigger asChild>
          <IconButton aria-label="Display options" active={isDirty}>
            <SlidersHorizontal />
          </IconButton>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-72 p-0 shadow-lg">
        <div className="space-y-3 p-3">
          <label className="flex items-center justify-between gap-3 text-[14px]">
            <span className="text-muted-foreground">Grouping</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="h-8 min-w-[130px] rounded-md border bg-background px-2 text-left text-[14px] shadow-2xs hover:bg-accent">{GROUPINGS.find(g => g.value === options.groupBy)?.label}</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={options.groupBy} onValueChange={v => onChange({ groupBy: v as ViewOptions['groupBy'] })}>
                  {GROUPINGS.map(g => (
                    <DropdownMenuRadioItem key={g.value} value={g.value} className="text-[14px]">
                      {g.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </label>
          <label className="flex items-center justify-between gap-3 text-[14px]">
            <span className="text-muted-foreground">Ordering</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="h-8 min-w-[130px] rounded-md border bg-background px-2 text-left text-[14px] shadow-2xs hover:bg-accent">{ORDERINGS.find(o => o.value === options.ordering)?.label}</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={options.ordering} onValueChange={v => onChange({ ordering: v as ViewOptions['ordering'] })}>
                  {ORDERINGS.map(o => (
                    <DropdownMenuRadioItem key={o.value} value={o.value} className="text-[14px]">
                      {o.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </label>
        </div>
        <div className="border-t p-3">
          <div className="mb-2 text-sm text-muted-foreground">Properties</div>
          <div className="flex flex-wrap gap-1.5">
            {DISPLAY_PROPERTIES.map(p => {
              const on = options.properties.includes(p);
              return (
                <button key={p} type="button" aria-pressed={on} onClick={() => onChange({ properties: on ? options.properties.filter(x => x !== p) : [...options.properties, p] })} className={cn('h-6 rounded-md border px-2 text-sm transition-colors', on ? 'border-foreground/20 bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {DISPLAY_PROPERTY_LABEL[p]}
                </button>
              );
            })}
          </div>
        </div>
        {isDirty && (
          <div className="border-t p-1.5">
            <button type="button" onClick={onReset} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" /> Reset to default
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

const btn = 'ghost-chip h-9 gap-1.5 px-2.5 text-[14px] text-foreground/90 hover:text-foreground';

function BulkBar({ rows, onClear, onDue, onExport }: { rows: Enrollment[]; onClear: () => void; onDue: (t: Enrollment[]) => void; onExport: () => void }) {
  const app = useAppActions();
  const { run } = useEnrollmentActions();
  if (!rows.length) return null;
  const open = rows.filter(r => r.status === 'Not started' || r.status === 'In progress');
  const withdrawn = rows.filter(r => r.status === 'Withdrawn');
  const n = rows.length;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div role="toolbar" aria-label="Bulk actions" className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border bg-popover p-1 shadow-xl animate-fade-up">
        <div className="flex h-9 items-center gap-2 border-r pl-2.5 pr-2">
          <span className="whitespace-nowrap text-[14px] font-medium tabular-nums">{n} selected</span>
          <button type="button" onClick={onClear} aria-label="Clear selection" className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {withdrawn.length > 0 && (
          <button type="button" className={btn} aria-label="Restore" onClick={() => run(withdrawn, 'restore')}>
            <Undo2 className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Restore{withdrawn.length < n ? ` ${withdrawn.length}` : ''}</span>
          </button>
        )}
        {open.length > 0 && (
          <>
            <button type="button" className={btn} aria-label="Send reminder" onClick={() => run(open, 'remind')}>
              <BellRing className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Remind</span>
            </button>
            <button type="button" className={btn} aria-label="Change due date" onClick={() => onDue(open)}>
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Due date</span>
            </button>
            <button
              type="button"
              className={btn}
              aria-label="Mark complete"
              onClick={async () => {
                if (await app.confirm({ title: `Mark ${open.length} enrollment${open.length === 1 ? '' : 's'} complete?`, description: 'For training finished offline. Certificates are issued and learning paths move forward.', confirmLabel: 'Mark complete' })) run(open, 'complete');
              }}
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Complete</span>
            </button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={btn} aria-label="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-52">
            <DropdownMenuItem className="text-[14px]" onSelect={onExport}>
              <Download className="h-3.5 w-3.5" /> Export selected to CSV
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-[14px]"
              onSelect={async () => {
                const t = rows.filter(r => r.status !== 'Withdrawn');
                if (await app.confirm({ title: `Reset progress for ${t.length} enrollment${t.length === 1 ? '' : 's'}?`, description: 'Learners start from the beginning. Quiz attempts and submissions stay on record.', confirmLabel: 'Reset progress', destructive: true })) run(t, 'reset');
              }}
              disabled={rows.length === withdrawn.length}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset progress…
            </DropdownMenuItem>
            {rows.length > withdrawn.length && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-[14px] text-destructive focus:text-destructive"
                  onSelect={async () => {
                    const t = rows.filter(r => r.status !== 'Withdrawn');
                    if (await app.confirm({ title: `Withdraw ${t.length} enrollment${t.length === 1 ? '' : 's'}?`, description: 'They lose access and stop counting toward reports. You can restore them later with progress intact.', confirmLabel: 'Withdraw', destructive: true })) run(t, 'withdraw');
                  }}
                >
                  <UserMinus className="h-3.5 w-3.5" /> Withdraw…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="hidden items-center gap-1 border-l px-2 text-2xs text-muted-foreground md:flex">
          <Kbd>Esc</Kbd> to clear
        </span>
      </div>
    </div>
  );
}

function DueDateDialog({ targets, onClose }: { targets: Enrollment[] | null; onClose: () => void }) {
  const { run } = useEnrollmentActions();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(Boolean(targets?.length)), [targets]);
  if (!targets?.length) return null;
  return (
    <DatePicker
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (!o) onClose();
      }}
      value={targets.length === 1 ? targets[0].dueDate : null}
      clearLabel="Remove due date"
      onChange={d => {
        run(targets, 'set_due', { dueDate: d });
        onClose();
      }}
      align="center"
      trigger={<span className="pointer-events-none fixed bottom-24 left-1/2 h-0 w-0" aria-hidden />}
    />
  );
}

function SaveViewDialog({ open, onOpenChange, filters, options, existing }: { open: boolean; onOpenChange: (o: boolean) => void; filters: EnrollmentFilters; options: ViewOptions; existing?: { id: string; name: string; scope: string } | null }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'Personal' | 'Shared'>('Personal');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(existing?.name ?? '');
      setScope((existing?.scope as 'Personal' | 'Shared') ?? 'Personal');
    }
  }, [open, existing]);
  const cleanFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const config = JSON.stringify({ filters: cleanFilters, ...options });
      const res = await saveView(existing ? { id: existing.id, name: name.trim(), scope, config } : { name: name.trim(), scope, page: 'enrollments', config });
      await qc.invalidateQueries({ queryKey: qk.bootstrap });
      toast.success(existing ? 'View updated' : `Saved “${name.trim()}”`, { description: scope === 'Shared' ? 'Everyone on the team can see it in the sidebar.' : undefined });
      onOpenChange(false);
      if (!existing) navigate(`/view/${res.id}`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save the view"));
    } finally {
      setBusy(false);
    }
  };
  const summaryParts = describeFilters(cleanFilters as EnrollmentFilters, ws);
  const grouping = options.groupBy !== 'none' ? `grouped by ${GROUPINGS.find(g => g.value === options.groupBy)?.label.toLowerCase()}` : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0 sm:rounded-xl">
        <DialogHeader className="px-5 pb-2 pt-4">
          <DialogTitle className="text-[16px]">{existing ? 'Update view' : 'Save as view'}</DialogTitle>
          <DialogDescription className="text-[14px]">{summaryParts.length || grouping ? [...summaryParts, grouping].filter(Boolean).join(' · ') : 'Saves the current filters, grouping, ordering and columns.'}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3 px-5 pb-4 pt-2"
          onSubmit={e => {
            e.preventDefault();
            save();
          }}
        >
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Overdue compliance — stores" maxLength={80} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[14px] outline-none focus:ring-1 focus:ring-ring" />
          <div className="flex gap-2">
            {(['Personal', 'Shared'] as const).map(s => (
              <button key={s} type="button" onClick={() => setScope(s)} className={cn('flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[14px]', scope === s ? 'border-primary/60 bg-primary/[0.05]' : 'hover:bg-accent')}>
                <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-full border', scope === s && 'border-primary bg-primary text-primary-foreground')}>{scope === s && <Check className="h-2.5 w-2.5" strokeWidth={3} />}</span>
                <span>
                  <span className="block font-medium">{s}</span>
                  <span className="block text-sm text-muted-foreground">{s === 'Personal' ? 'Only you' : `Everyone at ${ws.settings.organizationName}`}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-md border bg-background px-3 text-[14px] hover:bg-accent">
              Cancel
            </button>
            <button type="submit" disabled={!name.trim() || busy} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {busy ? 'Saving…' : existing ? 'Update view' : 'Save view'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
