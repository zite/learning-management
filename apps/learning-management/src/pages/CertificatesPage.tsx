import { Award, CalendarDays, Copy, Download, MoreHorizontal, Route, Search, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { listCertificates } from 'zitejs/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { CertificateSheet } from '../components/certificates/CertificateSheet';
import { certDate, expiryLabel, useCertificates, type CertificateRow, type CertificateState } from '../components/certificates/data';
import { PersonAvatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { CourseGlyph } from '../components/primitives/icons';
import { OptionPicker, type Option } from '../components/pickers/OptionPicker';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { copyText } from '../lib/clipboard';
import { downloadText } from '../lib/download';
import { errorMessage } from '../lib/errors';
import { useHotkeys } from '../lib/hotkeys';
import { useWorkspace } from '../lib/workspace';

type Tab = CertificateState | 'all';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'expiring', label: 'Expiring soon' },
  { key: 'expired', label: 'Expired' },
  { key: 'revoked', label: 'Revoked' },
  { key: 'all', label: 'All' },
];

type IssuedPreset = '30d' | '90d' | 'year' | 'lastyear';
const ISSUED: Array<{ value: IssuedPreset; label: string }> = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'lastyear', label: 'Last year' },
];

function issuedRange(p: IssuedPreset | null): { issuedFrom?: string; issuedTo?: string } {
  if (!p) return {};
  const now = new Date();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (p === '30d') return { issuedFrom: day(new Date(Date.now() - 30 * 86_400_000)) };
  if (p === '90d') return { issuedFrom: day(new Date(Date.now() - 90 * 86_400_000)) };
  if (p === 'year') return { issuedFrom: `${now.getFullYear()}-01-01` };
  return { issuedFrom: `${now.getFullYear() - 1}-01-01`, issuedTo: `${now.getFullYear() - 1}-12-31` };
}

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Every certificate issued: who holds what, what's about to lapse, what was
 * revoked and why. `?state=expiring` and `?q=` deep-link from Home and emails.
 */
export function CertificatesPage() {
  useDocumentTitle('Certificates');
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  // A credential-ID link (from an enrollment or an email) lands on All, so an expired or revoked certificate is still found.
  const [landedWithSearch] = useState(() => Boolean(params.get('q')) && !params.get('state'));
  const tab = (TABS.some(t => t.key === params.get('state')) ? params.get('state') : landedWithSearch ? 'all' : 'active') as Tab;
  const target = params.get('target'); // "course:<id>" | "path:<id>"
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [q, setQ] = useState(search);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // The open certificate is kept too, so revoking one on the Active tab doesn't close its sheet when it leaves the list.
  const [openRow, setOpenRow] = useState<CertificateRow | null>(null);

  const update = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        prev => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      update({ q: search.trim() || null });
    }, 250);
    return () => window.clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const [kind, targetId] = target?.split(':') ?? [];
  const issued = (ISSUED.some(i => i.value === params.get('issued')) ? params.get('issued') : null) as IssuedPreset | null;
  const filters = useMemo(() => ({ state: tab, q, courseId: kind === 'course' ? targetId : undefined, pathId: kind === 'path' ? targetId : undefined, ...issuedRange(issued) }), [tab, q, kind, targetId, issued]);
  const query = useCertificates(filters);
  const rows = useMemo(() => query.data?.pages.flatMap(p => p.rows) ?? [], [query.data]);
  const first = query.data?.pages[0];
  const counts = first?.counts;
  const total = first?.total ?? 0;
  const opened = openRow ? rows.find(r => r.id === openRow.id) ?? openRow : null;
  const openById = useCallback((id: string) => setOpenRow(rows.find(r => r.id === id) ?? null), [rows]);

  useEffect(() => setFocusedId(null), [tab, q, target]);

  const focusIndex = rows.findIndex(r => r.id === focusedId);
  const focusAt = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    setFocusedId(r.id);
    window.setTimeout(() => scrollRef.current?.querySelector(`[data-certificate-id="${r.id}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
    if (i >= rows.length - 5 && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  };
  useHotkeys({
    j: () => focusAt(focusIndex + 1),
    down: () => focusAt(focusIndex + 1),
    k: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
    up: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
    enter: () => focusIndex >= 0 && setOpenRow(rows[focusIndex]),
    space: () => focusIndex >= 0 && setOpenRow(rows[focusIndex]),
    esc: () => setFocusedId(null),
    '/': () => searchRef.current?.focus(),
  });

  const targetOptions = useMemo<Option<string | null>[]>(
    () => [
      { value: null, label: 'All courses and paths' },
      ...ws.orderedCourses.filter(c => c.certificateEnabled || c.status !== 'Draft').map(c => ({ value: `course:${c.id}`, label: c.title, icon: <CourseGlyph icon={c.icon} color={c.color} size={16} />, group: 'Courses', hint: c.certificateEnabled ? undefined : 'No certificate' })),
      ...ws.orderedPaths.map(p => ({ value: `path:${p.id}`, label: p.title, icon: <CourseGlyph icon={p.icon} color={p.color} size={16} />, group: 'Learning paths', hint: p.certificateEnabled ? undefined : 'No certificate' })),
    ],
    [ws],
  );
  const targetItem = kind === 'path' ? ws.pathById.get(targetId) : kind === 'course' ? ws.courseById.get(targetId) : undefined;

  const exportCsv = async () => {
    const toastId = toast.loading('Preparing the export…');
    try {
      const all = total > rows.length ? (await listCertificates({ ...filters, limit: 5000, offset: 0 })).rows : rows;
      const header = ['Recipient', 'Email', 'Certificate', 'Type', 'Credential ID', 'Issued', 'Expires', 'State', 'Score', 'Revoked reason'];
      const lines = all.map(r => [r.personName, r.personEmail, r.title, r.kind === 'path' ? 'Learning path' : 'Course', r.credentialId, r.issuedAt?.slice(0, 10) ?? '', r.expiresAt?.slice(0, 10) ?? '', r.state, r.score ?? '', r.revokedReason ?? ''].map(csvCell).join(','));
      downloadText(`certificates-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, [header.join(','), ...lines].join('\n'));
      toast.success(`Exported ${all.length.toLocaleString()} certificate${all.length === 1 ? '' : 's'}`, { id: toastId });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't export certificates"), { id: toastId });
    }
  };

  const filtered = Boolean(q || target || issued);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<Award />}
        title="Certificates"
        tabs={TABS.map(t => ({ to: `/certificates?${new URLSearchParams({ ...Object.fromEntries(params), state: t.key }).toString()}`, label: t.label, count: counts ? counts[t.key] : null, active: tab === t.key }))}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="More actions">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem className="gap-2 text-[14px]" disabled={!rows.length} onSelect={exportCsv}>
                <Download className="h-3.5 w-3.5" /> Export this list to CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        <div className="flex h-8 min-w-0 flex-1 basis-full items-center gap-1.5 rounded-md border bg-background px-2 shadow-2xs focus-within:ring-1 focus-within:ring-ring sm:max-w-[300px] sm:basis-auto">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setSearch('');
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Search name, email or credential ID"
            aria-label="Search certificates"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
          {search ? (
            <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="kbd hidden sm:inline-flex">/</kbd>
          )}
        </div>
        <OptionPicker
          value={target}
          onChange={v => update({ target: v })}
          options={targetOptions}
          placeholder="Filter by course or path…"
          width={320}
          trigger={
            <button type="button" className={cn('inline-flex h-8 max-w-[240px] items-center gap-1.5 rounded-md border px-2 text-[13.5px] shadow-2xs transition-colors', targetItem ? 'bg-accent/60' : 'border-dashed text-muted-foreground hover:text-foreground')}>
              {targetItem ? <CourseGlyph icon={targetItem.icon} color={targetItem.color} size={14} /> : null}
              <span className="truncate">{targetItem ? targetItem.title : 'Course or path'}</span>
              {targetItem && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Clear course filter"
                  onClick={e => {
                    e.stopPropagation();
                    update({ target: null });
                  }}
                  className="-mr-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          }
        />
        <OptionPicker
          value={issued}
          onChange={v => update({ issued: v })}
          options={[{ value: null, label: 'Any time' }, ...ISSUED.map(i => ({ value: i.value, label: i.label }))]}
          placeholder="Issued…"
          width={200}
          trigger={
            <button type="button" className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[13.5px] shadow-2xs transition-colors', issued ? 'bg-accent/60' : 'border-dashed text-muted-foreground hover:text-foreground')}>
              <CalendarDays className="h-3.5 w-3.5" />
              {issued ? `Issued ${ISSUED.find(i => i.value === issued)?.label.toLowerCase()}` : 'Issued'}
            </button>
          }
        />
        <span className="ml-auto text-sm tabular-nums text-muted-foreground">
          {query.isFetching && !query.isPending ? <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary/70 align-middle" aria-label="Refreshing" /> : null}
          {first ? `${total.toLocaleString()} ${total === 1 ? 'certificate' : 'certificates'}` : ''}
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <SkeletonRows rows={10} className="pt-2" />
        ) : query.isError ? (
          <EmptyState icon={<Award />} title="Couldn't load certificates" description="Check your connection and try again." action={<button type="button" onClick={() => query.refetch()} className="text-[14px] text-primary hover:underline">Retry</button>} />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Search />}
              title="No certificates match"
              description={tab !== 'all' && counts?.all ? `None ${tab === 'expiring' ? 'expiring soon' : tab} — ${counts.all.toLocaleString()} in other states.` : q ? `Nothing for “${q}”.` : 'Try another course, date or tab.'}
              action={
                <div className="flex flex-col items-center gap-2">
                  {tab !== 'all' && counts?.all ? (
                    <button type="button" onClick={() => update({ state: 'all' })} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
                      Show all {counts.all.toLocaleString()}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      update({ target: null, issued: null });
                    }}
                    className="text-[14px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Clear filters
                  </button>
                </div>
              }
            />
          ) : counts?.all === 0 ? (
            <EmptyState icon={<Award />} title="No certificates yet" description="Turn on certificates for a course or learning path, and they’re issued automatically when people finish." />
          ) : (
            <EmptyState
              icon={<Award />}
              title={{ active: 'No active certificates', expiring: 'Nothing expiring in the next 30 days', expired: 'No expired certificates', revoked: 'No revoked certificates', all: 'No certificates' }[tab]}
              description={{ active: 'Certificates that are valid and not close to expiring show up here.', expiring: 'People are reminded automatically before a certificate lapses.', expired: 'Certificates past their validity date show up here.', revoked: 'Certificates you revoke stay here with the reason.', all: '' }[tab] || undefined}
            />
          )
        ) : (
          <div role="grid" aria-label="Certificates">
            <div role="row" className={cn(COLS, 'sticky top-0 z-10 hidden h-9 border-b bg-subtle/95 text-sm text-muted-foreground backdrop-blur md:grid')}>
              <span role="columnheader">Recipient</span>
              <span role="columnheader">Certificate</span>
              <span role="columnheader" className="hidden lg:block">
                Credential ID
              </span>
              <span role="columnheader">Issued</span>
              <span role="columnheader">Expiry</span>
              <span role="columnheader" className="hidden text-right xl:block">
                Score
              </span>
            </div>
            {rows.map(r => (
              <CertificateListRow key={r.id} row={r} focused={focusedId === r.id} onFocus={setFocusedId} onOpen={openById} />
            ))}
            {query.hasNextPage && (
              <div className="flex justify-center py-4">
                <button type="button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent disabled:opacity-60">
                  {query.isFetchingNextPage ? 'Loading…' : `Show more · ${(total - rows.length).toLocaleString()} left`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <CertificateSheet certificate={opened} onClose={() => setOpenRow(null)} onChange={setOpenRow} />
    </div>
  );
}

/** One template for the header and every row, so each header sits exactly over its column. */
const COLS = 'items-center gap-x-4 pl-5 pr-4 md:grid-cols-[200px_minmax(0,1fr)_76px_150px] lg:grid-cols-[210px_minmax(0,1fr)_150px_76px_150px] xl:grid-cols-[220px_minmax(0,1fr)_150px_76px_160px_48px]';

const CertificateListRow = memo(function CertificateListRow({ row: r, focused, onFocus, onOpen }: { row: CertificateRow; focused: boolean; onFocus: (id: string) => void; onOpen: (id: string) => void }) {
  const e = expiryLabel(r);
  const muted = r.state === 'revoked' || r.personStatus === 'Deactivated';
  const tip = r.state === 'revoked' ? (r.revokedReason ? `Revoked: ${r.revokedReason}` : 'Revoked') : r.expiresAt ? `${r.state === 'expired' ? 'Expired' : 'Expires'} ${certDate(r.expiresAt, 'long')}` : 'Never expires';
  const avatar = <PersonAvatar person={{ name: r.personName, color: r.personColor, avatarUrl: r.personAvatarUrl, status: r.personStatus }} size={22} />;
  const title = (
    <>
      <CourseGlyph icon={r.targetIcon} color={r.targetColor} size={18} />
      <span className={cn('truncate', muted && 'text-muted-foreground')}>{r.title}</span>
      {r.kind === 'path' && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 text-2xs font-medium text-muted-foreground">
          <Route className="h-2.5 w-2.5" /> Path
        </span>
      )}
    </>
  );
  return (
    <div
      role="row"
      data-certificate-id={r.id}
      onClick={() => onOpen(r.id)}
      onMouseMove={() => !focused && onFocus(r.id)}
      className={cn('group/row relative cursor-default select-none border-b border-border/60 text-[14px] transition-colors duration-75', focused ? 'bg-accent/80' : 'hover:bg-accent/50')}
    >
      {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
      {/* Phones: who and what on the left, the state on the right. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 py-2.5 pl-4 pr-4 md:hidden">
        <span className="mt-px">{avatar}</span>
        <span className="min-w-0">
          <span className={cn('block truncate font-medium', muted && 'text-muted-foreground')}>{r.personName}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground">{title}</span>
        </span>
        <span className={cn('whitespace-nowrap pt-px text-sm tabular-nums', e.tone)}>{e.text}</span>
      </div>
      <div className={cn(COLS, 'hidden h-11 md:grid')}>
        <span role="gridcell" className="flex min-w-0 items-center gap-2">
          {avatar}
          <span className={cn('truncate font-medium', muted && 'text-muted-foreground')}>{r.personName}</span>
        </span>
        <span role="gridcell" className="flex min-w-0 items-center gap-2">
          {title}
        </span>
        <span role="gridcell" className="hidden min-w-0 lg:block">
          <Tip label="Copy credential ID">
            <button
              type="button"
              onClick={ev => {
                ev.stopPropagation();
                copyText(r.credentialId, 'Credential ID copied');
              }}
              className="group/cid -ml-1 inline-flex max-w-full items-center gap-1 rounded px-1 font-mono text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span className="truncate">{r.credentialId}</span>
              <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover/cid:opacity-100" />
            </button>
          </Tip>
        </span>
        <span role="gridcell" className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
          {r.issuedAt ? certDate(r.issuedAt) : '—'}
        </span>
        <span role="gridcell" className="min-w-0">
          <Tip label={tip}>
            <span className={cn('truncate whitespace-nowrap text-sm tabular-nums', e.tone)}>{e.text}</span>
          </Tip>
        </span>
        <span role="gridcell" className="hidden text-right text-sm tabular-nums text-muted-foreground xl:block">
          {r.score == null ? <span className="text-muted-foreground/50">—</span> : `${Math.round(r.score)}%`}
        </span>
      </div>
    </div>
  );
});
