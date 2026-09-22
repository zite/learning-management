import { ArrowDown, ArrowDownWideNarrow, Download, FileUp, MoreHorizontal, Search, UserPlus, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { listPeople } from 'zitejs/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { OptionPicker } from '../components/pickers/OptionPicker';
import { ImportPeopleDialog } from '../components/people/ImportPeopleDialog';
import { usePeopleActions, type PersonTarget } from '../components/people/PeopleActions';
import { btnGhost, btnPrimary, PEOPLE_COL, SelectBox, TRAINING_HINT } from '../components/people/PeopleBits';
import { PeopleBulkBar } from '../components/people/PeopleBulkBar';
import { PeopleFilterChips, PeopleFilterMenu, type PeopleFilterState } from '../components/people/PeopleFilters';
import { PersonListRow, toTarget } from '../components/people/PersonListRow';
import { PEOPLE_ORDERINGS, peopleCount, TABS, toCsv, usePeopleList, type Compliancefilter, type PeopleOrdering, type PeopleQuery, type PeopleTab, type PersonRow } from '../components/people/peopleData';
import { EmptyState, IconButton, Kbd, SkeletonRows, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { downloadText } from '../lib/download';
import { errorMessage } from '../lib/errors';
import { toDayString } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useWorkspace } from '../lib/workspace';

const TAB_VALUES = TABS.map(t => t.value);
const ORDER_VALUES = PEOPLE_ORDERINGS.map(o => o.value);

function exportRows(rows: PersonRow[], ws: ReturnType<typeof useWorkspace>) {
  const csv = toCsv(
    ['Name', 'Email', 'Job title', 'Role', 'Status', 'Manager', 'Groups', 'Hire date', 'Employee ID', 'Active training', 'Overdue', 'Completed', 'Certificates', 'Last active', 'Invited'],
    rows.map(r => [r.name, r.email, r.title ?? '', r.role, r.status, r.managerName ?? '', r.groupIds.map(id => ws.groupById.get(id)?.name).filter(Boolean).join('; '), r.hireDate ?? '', r.externalId ?? '', r.counts.active, r.counts.overdue, r.counts.completed, r.counts.certificates, r.lastActiveAt?.slice(0, 10) ?? '', r.invitedAt?.slice(0, 10) ?? '']),
  );
  downloadText(`people-${toDayString(new Date())}.csv`, csv);
}

/**
 * The directory: everyone in the organization with their training at a
 * glance. Filtered and paged on the server, so it stays fast with thousands of
 * people; the URL holds the tab, search, filters and ordering.
 */
export function PeoplePage() {
  useDocumentTitle('People');
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as PeopleTab | null;
  const tab: PeopleTab = tabParam && TAB_VALUES.includes(tabParam) ? tabParam : 'everyone';
  const q = params.get('q') ?? '';
  const groupIds = useMemo(() => (params.get('groups') ?? '').split(',').filter(Boolean), [params]);
  const managerId = params.get('manager');
  const compliance = params.get('training') as Compliancefilter | null;
  const sortParam = params.get('sort') as PeopleOrdering | null;
  const ordering: PeopleOrdering = sortParam && ORDER_VALUES.includes(sortParam) ? sortParam : 'name';
  const [importOpen, setImportOpen] = useState(false);

  const update = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        prev => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const [text, setText] = useState(q);
  useEffect(() => {
    const t = window.setTimeout(() => text.trim() !== q && update({ q: text.trim() || null }), 220);
    return () => window.clearTimeout(t);
  }, [text]);
  const searchRef = useRef<HTMLInputElement>(null);

  const query = useMemo<PeopleQuery>(
    () => ({ tab, ordering, ...(q ? { q } : {}), ...(groupIds.length ? { groupIds } : {}), ...(managerId ? { managerId } : {}), ...(compliance ? { compliance } : {}) }),
    [tab, ordering, q, groupIds, managerId, compliance],
  );
  const { data, isPending, isError, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = usePeopleList(query);
  const rows = useMemo(() => data?.pages.flatMap(p => p.rows) ?? [], [data]);
  const first = data?.pages[0];
  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);

  // ── Selection and focus ──
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  useEffect(() => {
    setSelection(new Set());
    setFocusedId(null);
  }, [tab, q, groupIds.join(','), managerId, compliance]);
  useEffect(() => {
    setSelection(prev => {
      const next = new Set([...prev].filter(id => byId.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [byId]);

  const { actions, host } = usePeopleActions({ onDone: () => setSelection(new Set()) });
  const selected = useMemo(() => rows.filter(r => selection.has(r.id)), [rows, selection]);
  const getTargets = useCallback((r: PersonRow): PersonTarget[] => {
    const sel = selectionRef.current;
    if (sel.size > 1 && sel.has(r.id)) return [...sel].map(id => byIdRef.current.get(id)).filter(Boolean).map(x => toTarget(x!));
    return [toTarget(byIdRef.current.get(r.id) ?? r)];
  }, []);

  const toggle = useCallback(
    (r: PersonRow, e?: MouseEvent | KeyboardEvent) => {
      setSelection(prev => {
        const next = new Set(prev);
        if (e?.shiftKey && anchor.current) {
          const a = rows.findIndex(x => x.id === anchor.current);
          const b = rows.findIndex(x => x.id === r.id);
          if (a >= 0 && b >= 0) {
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(rows[i].id);
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
    [rows],
  );
  const onRowClick = useCallback(
    (r: PersonRow, e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || selectionRef.current.size > 0) {
        e.preventDefault();
        toggle(r, e);
        return;
      }
      navigate(`/people/${r.id}`);
    },
    [navigate, toggle],
  );
  const onHover = useCallback((r: PersonRow) => setFocusedId(r.id), []);

  const focusIndex = rows.findIndex(r => r.id === focusedId);
  const focusAt = (i: number, extend?: boolean) => {
    const next = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!next) return;
    if (extend) setSelection(prev => new Set(prev).add(next.id).add(focusedId ?? next.id));
    setFocusedId(next.id);
    window.setTimeout(() => scrollRef.current?.querySelector(`[data-row-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
  };
  const focused = focusedId ? byId.get(focusedId) : undefined;

  useHotkeys({
    j: () => focusAt(focusIndex + 1),
    down: () => focusAt(focusIndex + 1),
    k: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
    up: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
    'shift+j': () => focusAt(focusIndex + 1, true),
    'shift+down': () => focusAt(focusIndex + 1, true),
    'shift+k': () => focusAt(focusIndex - 1, true),
    'shift+up': () => focusAt(focusIndex - 1, true),
    x: () => focused && toggle(focused),
    enter: () => focused && navigate(`/people/${focused.id}`),
    'mod+a': () => setSelection(new Set(rows.map(r => r.id))),
    esc: () => (selection.size ? setSelection(new Set()) : setFocusedId(null)),
    '/': () => searchRef.current?.focus(),
  });

  const [exporting, setExporting] = useState(false);
  const exportAll = async () => {
    if (exporting) return;
    setExporting(true);
    const toastId = toast.loading('Preparing the export…');
    try {
      const all: PersonRow[] = [];
      for (let offset = 0; offset < 20_000; ) {
        const page = await listPeople({ ...query, limit: 500, offset });
        all.push(...page.rows);
        if (!page.hasMore) break;
        offset += page.rows.length;
      }
      exportRows(all, ws);
      toast.success(`Exported ${peopleCount(all.length)}`, { id: toastId });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't export people"), { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  const filterState: PeopleFilterState = { groupIds, managerId, compliance };
  const setFilter = (patch: Partial<PeopleFilterState>) =>
    update({
      ...('groupIds' in patch ? { groups: patch.groupIds?.length ? patch.groupIds.join(',') : null } : {}),
      ...('managerId' in patch ? { manager: patch.managerId ?? null } : {}),
      ...('compliance' in patch ? { training: patch.compliance ?? null } : {}),
    });
  const hasFilters = Boolean(q || groupIds.length || managerId || compliance);
  const tabSearch = (value: PeopleTab) => {
    const next = new URLSearchParams(params);
    if (value === 'everyone') next.delete('tab');
    else next.set('tab', value);
    const s = next.toString();
    return `/people${s ? `?${s}` : ''}`;
  };
  const allSelected = rows.length > 0 && selection.size === rows.length;
  const narrow = useMediaQuery('(max-width: 767px)');

  const header = (label: string, opts: { sort?: PeopleOrdering; hint?: string; className?: string } = {}) => {
    const { sort, hint, className } = opts;
    const body = sort ? (
      <button type="button" onClick={() => update({ sort: sort === 'name' ? null : sort })} className={cn('flex items-center gap-1 whitespace-nowrap hover:text-foreground', ordering === sort && 'text-foreground')}>
        {label}
        {ordering === sort && <ArrowDown className="h-3 w-3" />}
      </button>
    ) : (
      <span className="cursor-default whitespace-nowrap">{label}</span>
    );
    return <span className={className}>{hint ? <Tip label={hint}>{body}</Tip> : body}</span>;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<Users />}
        title="People"
        tabs={TABS.map(t => ({ to: tabSearch(t.value), label: narrow ? t.short : t.label, count: first?.tabs[t.value] ?? null, active: tab === t.value }))}
        actions={
          ws.isAdmin ? (
            <>
              <Tip label="Add or update people from a spreadsheet">
                <button type="button" onClick={() => setImportOpen(true)} className={btnGhost} aria-label="Import CSV">
                  <FileUp className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Import CSV</span>
                </button>
              </Tip>
              <button type="button" onClick={() => app.openInvite()} className={btnPrimary} aria-label="Add people">
                <UserPlus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Add people</span>
              </button>
            </>
          ) : undefined
        }
      />

      <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        <div className="flex h-8 w-full items-center gap-1.5 rounded-md border bg-background px-2 focus-within:border-foreground/30 sm:w-60">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setText('');
                e.currentTarget.blur();
              }
              if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
                if (rows[0]) setFocusedId(rows[0].id);
              }
            }}
            placeholder="Search people"
            aria-label="Search people"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
          {text ? (
            <button type="button" aria-label="Clear search" onClick={() => setText('')} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Kbd className="hidden sm:inline-flex">/</Kbd>
          )}
        </div>
        <PeopleFilterMenu value={filterState} onChange={setFilter} />
        <PeopleFilterChips value={filterState} onChange={setFilter} />
        <div className="ml-auto flex items-center gap-1">
          {isFetching && !isPending && !isFetchingNextPage && <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-primary/70" aria-label="Refreshing" />}
          {first && <span className="mr-1 hidden text-sm tabular-nums text-muted-foreground sm:inline">{peopleCount(first.total)}</span>}
          <OptionPicker
            value={ordering}
            onChange={v => update({ sort: v === 'name' ? null : v })}
            options={PEOPLE_ORDERINGS.map((o, i) => ({ value: o.value, label: o.label, shortcut: String(i + 1) }))}
            placeholder="Order by…"
            width={200}
            align="end"
            trigger={
              <button type="button" className="ghost-chip h-8 px-2 text-[13.5px] text-muted-foreground hover:text-foreground">
                <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{PEOPLE_ORDERINGS.find(o => o.value === ordering)?.label}</span>
              </button>
            }
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="More list actions">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem className="gap-2 text-[14px]" disabled={!first?.total || exporting} onSelect={() => void exportAll()}>
                <Download className="h-3.5 w-3.5" /> Export {first ? peopleCount(first.total) : 'list'} to CSV
              </DropdownMenuItem>
              {ws.isAdmin && (
                <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => setImportOpen(true)}>
                  <FileUp className="h-3.5 w-3.5" /> Import CSV…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" role="grid" aria-label="People">
        {isPending ? (
          <SkeletonRows rows={12} className="pt-2" />
        ) : isError ? (
          <EmptyState icon={<Users />} title="Couldn't load people" description="Check your connection and try again." action={<button type="button" onClick={() => refetch()} className="text-[14px] text-primary hover:underline">Try again</button>} />
        ) : rows.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={<Search />}
              title="Nobody matches"
              description="Try part of a name or email, or remove a filter."
              action={<button type="button" onClick={() => { setText(''); update({ q: null, groups: null, manager: null, training: null }); }} className="text-[14px] text-primary hover:underline">Clear filters</button>}
            />
          ) : tab === 'invited' ? (
            <EmptyState icon={<UserPlus />} title="No pending invitations" description="People you invite show here until they sign in for the first time." />
          ) : tab === 'deactivated' ? (
            <EmptyState icon={<Users />} title="Nobody is deactivated" description="Deactivated people can’t sign in and drop out of reports. Their history stays." />
          ) : tab === 'staff' ? (
            <EmptyState icon={<Users />} title="No instructors or admins" description="Change someone’s role to let them build courses and manage training." />
          ) : (
            <EmptyState
              icon={<Users />}
              title="Add your team"
              description="Invite people by email or import a spreadsheet. Assignment rules enroll them in required training automatically."
              action={
                ws.isAdmin ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setImportOpen(true)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">Import CSV</button>
                    <button type="button" onClick={() => app.openInvite()} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">Add people</button>
                  </div>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="pb-24">
            <div role="row" className="sticky top-0 z-10 flex h-9 items-center gap-2.5 border-b bg-subtle/95 pl-2 pr-3 text-sm text-muted-foreground backdrop-blur-sm sm:pr-4">
              <SelectBox checked={allSelected} visible={selection.size > 0} onToggle={() => setSelection(allSelected ? new Set() : new Set(rows.map(r => r.id)))} label={allSelected ? 'Deselect all' : 'Select all loaded'} />
              <span className="w-[22px] shrink-0" />
              {header('Name', { sort: 'name', className: 'flex min-w-0 flex-1' })}
              {header('Groups', { className: PEOPLE_COL.groups })}
              {header('Manager', { className: PEOPLE_COL.manager })}
              {header('Open', { hint: TRAINING_HINT.open, className: PEOPLE_COL.open })}
              {header('Overdue', { sort: 'overdue_desc', hint: `${TRAINING_HINT.overdue} · click to put the most overdue first`, className: PEOPLE_COL.overdue })}
              {header('Completed', { hint: TRAINING_HINT.completed, className: PEOPLE_COL.completed })}
              {header('Last active', { sort: 'recent_activity', hint: 'Last time they used the app · click to order by it', className: PEOPLE_COL.lastActive })}
            </div>
            {rows.map(r => (
              <PersonListRow key={r.id} row={r} selected={selection.has(r.id)} focused={focusedId === r.id} selecting={selection.size > 0} isAdmin={ws.isAdmin} actions={actions} getTargets={getTargets} onClick={onRowClick} onToggle={toggle} onHover={onHover} />
            ))}
            {hasNextPage ? (
              <div className="flex items-center justify-center gap-3 py-4">
                <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent disabled:opacity-60">
                  {isFetchingNextPage ? 'Loading…' : `Load more · ${(first!.total - rows.length).toLocaleString()} left`}
                </button>
              </div>
            ) : (
              rows.length > 12 && <p className="py-4 text-center text-sm text-muted-foreground">That’s everyone — {peopleCount(rows.length)}</p>
            )}
          </div>
        )}
      </div>

      <PeopleBulkBar targets={selected.map(toTarget)} actions={actions} isAdmin={ws.isAdmin} onClear={() => setSelection(new Set())} onExport={() => { exportRows(selected, ws); toast.success(`Exported ${peopleCount(selected.length)}`); }} />
      {host}
      {ws.isAdmin && <ImportPeopleDialog open={importOpen} onOpenChange={setImportOpen} />}
    </div>
  );
}

