import { ChevronDown, ChevronLeft, ChevronRight, ListFilter, ShieldCheck, UserRound, X } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { longDate } from '../../lib/format';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useWorkspace } from '../../lib/workspace';
import { OptionPicker, type Option } from '../pickers/OptionPicker';
import { PersonPicker } from '../pickers/pickers';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, LabelDot, Tip } from '../primitives/bits';
import { CourseGlyph, StatusGlyph } from '../primitives/icons';
import { chipClass, GroupFilter } from './FilterBar';
import { useComplianceQuery, type Compliance, type ReportParams } from './params';
import { fmt, KpiSkeleton, KpiTile, pctText } from './viz';

export const COMPLIANCE_PAGE = 200;

type Cell = NonNullable<Compliance['rows'][number]['cells'][number]>;
type Status = Cell['status'];
type Item = Compliance['items'][number];
type Row = Compliance['rows'][number];

const STATUS: Record<Status, { label: string; hint: string }> = {
  completed: { label: 'Completed', hint: 'Finished, and still in date' },
  in_progress: { label: 'In progress', hint: 'Started, not finished' },
  not_started: { label: 'Not started', hint: 'Assigned, not started' },
  overdue: { label: 'Overdue', hint: 'Past its due date' },
  expired: { label: 'Expired', hint: 'Finished before, but the certificate has lapsed' },
  not_assigned: { label: 'Not assigned', hint: 'Required by a rule, but not enrolled' },
};
const STATUS_ORDER: Status[] = ['completed', 'in_progress', 'not_started', 'overdue', 'expired', 'not_assigned'];

export function complianceInput(p: ReportParams) {
  return {
    ...(p.groupIds.length ? { groupIds: p.groupIds } : {}),
    ...(p.managerId ? { managerId: p.managerId } : {}),
    ...(p.itemIds.length ? { itemIds: p.itemIds } : {}),
    ...(p.gapsOnly ? { gapsOnly: true } : {}),
    offset: p.page * COMPLIANCE_PAGE,
    limit: COMPLIANCE_PAGE,
  };
}

/** The status mark for a matrix cell: the enrollment ring vocabulary, plus lapsed and unassigned. */
export function ComplianceGlyph({ status, progress = 0, size = 14 }: { status: Status | 'none'; progress?: number; size?: number }) {
  if (status === 'none') return <span className="block h-[3px] w-[3px] rounded-full bg-muted-foreground/30" aria-hidden />;
  if (status === 'completed') return <StatusGlyph status="Completed" size={size} />;
  if (status === 'in_progress') return <StatusGlyph status="In progress" progress={Math.max(progress, 10)} size={size} />;
  if (status === 'not_started') return <StatusGlyph status="Not started" size={size} />;
  // Always a filled ring in danger, so overdue never reads like the dashed "not assigned" mark.
  if (status === 'overdue') return <StatusGlyph status="In progress" progress={Math.max(progress, 15)} dueState="overdue" size={size} />;
  if (status === 'expired') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 text-tone-danger" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill="none" stroke="currentColor" strokeWidth={1.5} />
        <path d={`M${size * 0.5} ${size * 0.28} V${size * 0.56}`} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
        <circle cx={size / 2} cy={size * 0.72} r={0.95} fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 text-tone-warning" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="1.8 1.8" />
      <path d={`M${size * 0.32} ${size * 0.5} H${size * 0.68}`} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/** The one colour on aggregate numbers: a dot beside a share that includes overdue or expired training. */
function LateDot({ className }: { className?: string }) {
  return <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-tone-danger', className)} aria-hidden />;
}

const lateText = (n: number) => `${fmt(n)} overdue or expired`;

// ── Filter bar controls ─────────────────────────────────────────────────────

export function ComplianceControls({ params, update }: { params: ReportParams; update: (p: Partial<ReportParams>) => void }) {
  const { data } = useComplianceQuery(complianceInput(params));
  const [managerName, setManagerName] = useState<string | null>(null);
  const managerId = params.managerId;
  const onPeopleSeen = useCallback(
    (people: Array<{ id: string; name: string }>) => {
      const hit = people.find(p => p.id === managerId);
      if (hit) setManagerName(hit.name);
    },
    [managerId],
  );
  const manager = params.managerId ? data?.manager?.name ?? managerName : null;
  const items = data?.availableItems ?? [];
  const itemOptions: Option<string>[] = items.map(i => ({ value: i.id, label: i.title, icon: <CourseGlyph icon={i.icon} color={i.color} size={16} />, hint: i.kind === 'path' ? 'Path' : undefined }));
  const pickedItems = params.itemIds.filter(id => items.some(i => i.id === id));
  return (
    <>
      <GroupFilter value={params.groupIds} onChange={ids => update({ groupIds: ids })} />
      <span className="inline-flex shrink-0 items-center">
        <PersonPicker
          value={params.managerId ? [params.managerId] : []}
          onChange={ids => update({ managerId: ids[0] ?? null })}
          onPeopleSeen={onPeopleSeen}
          placeholder="Whose team?"
          trigger={
            <button type="button" className={chipClass(Boolean(params.managerId))} aria-label={manager ? `Manager: ${manager}` : 'Filter by manager'}>
              <UserRound className="h-3.5 w-3.5" />
              <span className="max-w-[160px] truncate">{params.managerId ? `Reports to ${manager ?? '…'}` : 'Manager'}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          }
        />
        {params.managerId && (
          <button type="button" aria-label="Clear manager filter" onClick={() => update({ managerId: null })} className="-ml-1 flex h-8 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
      {items.length > 1 && (
        <span className="inline-flex shrink-0 items-center">
          <OptionPicker
            multiple
            options={itemOptions}
            value={pickedItems}
            onChange={ids => update({ itemIds: ids })}
            placeholder="Choose required training…"
            width={300}
            trigger={
              <button type="button" className={chipClass(pickedItems.length > 0)} aria-label="Filter required training">
                <ListFilter className="h-3.5 w-3.5" />
                <span className="max-w-[180px] truncate">{!pickedItems.length ? 'Required training' : pickedItems.length === 1 ? items.find(i => i.id === pickedItems[0])?.title : `${pickedItems.length} items`}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            }
          />
          {pickedItems.length > 0 && (
            <button type="button" aria-label="Show all required training" onClick={() => update({ itemIds: [] })} className="-ml-1 flex h-8 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      )}
      <label className="flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[13.5px] text-muted-foreground hover:text-foreground">
        <Switch checked={params.gapsOnly} onCheckedChange={v => update({ gapsOnly: v })} className="scale-[0.8]" aria-label="Only show people with gaps" />
        Only people with gaps
      </label>
    </>
  );
}

// ── Matrix ──────────────────────────────────────────────────────────────────

type Hover = { rect: DOMRect; row: Row; item: Item; cell: Cell | undefined } | null;

function CellTooltip({ hover }: { hover: NonNullable<Hover> }) {
  const { rect, row, item, cell } = hover;
  const below = rect.top < 150;
  const style = { left: Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2)), top: below ? rect.bottom + 6 : rect.top - 6 };
  const now = Date.now();
  const lines: ReactNode[] = [];
  if (cell) {
    if (cell.dueDate && cell.status !== 'completed') lines.push(<span key="due" className={cn(cell.status === 'overdue' && 'text-tone-danger')}>{cell.status === 'overdue' ? 'Was due' : 'Due'} {longDate(cell.dueDate)}</span>);
    if (cell.completedAt) lines.push(<span key="done">Completed {longDate(cell.completedAt)}</span>);
    if (cell.revoked) lines.push(<span key="rev" className="text-tone-danger">Certificate revoked</span>);
    else if (cell.certificateExpiresAt) {
      const lapsed = Date.parse(cell.certificateExpiresAt) <= now;
      lines.push(
        <span key="exp" className={cn(lapsed && 'text-tone-danger')}>
          {lapsed ? 'Expired' : cell.compliant && cell.status !== 'completed' ? 'Still certified until' : 'Expires'} {longDate(cell.certificateExpiresAt)}
        </span>,
      );
    }
  }
  return createPortal(
    <div className="pointer-events-none fixed z-[60] animate-fade-in" style={{ ...style, transform: `translate(-50%, ${below ? '0' : '-100%'})` }} role="tooltip">
      <div className="w-[260px] max-w-[calc(100vw-24px)] rounded-md border bg-popover px-2.5 py-2 text-sm text-popover-foreground shadow-md">
        <div className="truncate font-medium">{row.name}</div>
        <div className="truncate text-2xs text-muted-foreground">{item.title}</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <ComplianceGlyph status={cell?.status ?? 'none'} progress={cell?.progress} size={13} />
          <span className="font-medium">{cell ? STATUS[cell.status].label : 'Not required of them'}</span>
          {cell && cell.status !== 'completed' && cell.compliant && <span className="text-muted-foreground">· still certified</span>}
        </div>
        {lines.length > 0 && <div className="mt-1 flex flex-col gap-0.5 text-muted-foreground">{lines}</div>}
        {cell && <div className="mt-1.5 border-t pt-1.5 text-2xs text-muted-foreground">{cell.enrollmentId ? (item.kind === 'path' ? 'Click to open their current course in this path' : 'Click to open the enrollment') : 'Click to assign it now'}</div>}
      </div>
    </div>,
    document.body,
  );
}

const MOVES: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };

function Matrix({ data, onCell }: { data: Compliance; onCell: (row: Row, item: Item, cell: Cell) => void }) {
  const narrow = !useMediaQuery('(min-width: 640px)');
  const ROW = 40;
  const GROUP_ROW = 34;
  const HEAD = 86;
  const SECTION = 30;
  const COL = narrow ? 80 : 96;
  const FIRST = narrow ? 164 : 256;
  const items = data.items;
  const rows = data.rows;
  const groups = data.groups;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 900 });
  // On a phone the group summaries would crowd out the people, so they start folded.
  const [groupsOpen, setGroupsOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches);
  const toggleGroups = useCallback(() => setGroupsOpen(v => !v), []);
  const [hover, setHover] = useState<Hover>(null);
  // One cell is in the tab order at a time; arrow keys move it (a roving tab stop, like a spreadsheet).
  const [active, setActive] = useState({ r: 0, c: 0 });
  const pending = useRef<{ r: number; c: number } | null>(null);
  const activeR = Math.min(active.r, Math.max(0, rows.length - 1));
  const activeC = Math.min(active.c, Math.max(0, items.length - 1));

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) setView(v => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight }));
    if (hover) setHover(null);
  };

  const groupBlock = groups.length ? SECTION + (groupsOpen ? groups.length * GROUP_ROW : 0) : 0;
  const peopleTop = HEAD + groupBlock + SECTION;
  const buffer = 10;
  const first = Math.max(0, Math.floor((view.top - peopleTop) / ROW) - buffer);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height - peopleTop) / ROW) + buffer);
  const visible = rows.slice(first, Math.max(first, last));

  const locate = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest?.('[data-r]') as HTMLElement | null;
    if (!el) return null;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    const row = rows[r];
    const item = items[c];
    return row && item ? { el, r, c, row, item, cell: row.cells[c] ?? undefined } : null;
  };

  const show = (target: EventTarget | null) => {
    const hit = locate(target);
    if (!hit) return;
    setHover({ rect: hit.el.getBoundingClientRect(), row: hit.row, item: hit.item, cell: hit.cell });
  };

  /** Scroll just enough that a cell clears the sticky header and name column. */
  const reveal = (el: HTMLElement) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const cell = el.getBoundingClientRect();
    const top = box.top + HEAD;
    const bottom = box.top + scroller.clientHeight;
    const left = box.left + FIRST;
    const right = box.left + scroller.clientWidth;
    if (cell.top < top) scroller.scrollTop -= top - cell.top;
    else if (cell.bottom > bottom) scroller.scrollTop += cell.bottom - bottom;
    if (cell.left < left) scroller.scrollLeft -= left - cell.left;
    else if (cell.right > right) scroller.scrollLeft += cell.right - right;
  };

  const cellAt = (r: number, c: number) => scrollRef.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`) ?? null;

  const focusCell = (r: number, c: number) => {
    setActive({ r, c });
    const next = cellAt(r, c);
    if (next) {
      next.focus({ preventScroll: true });
      reveal(next);
      return;
    }
    // Not rendered yet (virtualised): scroll it into the window, then focus once it renders.
    const scroller = scrollRef.current;
    if (!scroller) return;
    pending.current = { r, c };
    scroller.scrollTop = Math.max(0, peopleTop + r * ROW - scroller.clientHeight / 2);
    setView({ top: scroller.scrollTop, height: scroller.clientHeight });
  };

  useEffect(() => {
    const want = pending.current;
    if (!want) return;
    const el = cellAt(want.r, want.c);
    if (!el) return;
    pending.current = null;
    el.focus({ preventScroll: true });
    reveal(el);
  });

  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const hit = locate(e.target);
    if (!hit) return;
    let r = hit.r;
    let c = hit.c;
    const move = MOVES[e.key];
    if (move) {
      r += move[0];
      c += move[1];
    } else if (e.key === 'Home') {
      c = 0;
      if (e.metaKey || e.ctrlKey) r = 0;
    } else if (e.key === 'End') {
      c = items.length - 1;
      if (e.metaKey || e.ctrlKey) r = rows.length - 1;
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      r += (e.key === 'PageDown' ? 1 : -1) * Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? 400) - HEAD) / ROW) - 1);
    } else return;
    e.preventDefault();
    focusCell(Math.max(0, Math.min(rows.length - 1, r)), Math.max(0, Math.min(items.length - 1, c)));
  };

  const width = FIRST + items.length * COL;

  const onClick = (e: MouseEvent<HTMLTableSectionElement>) => {
    const hit = locate(e.target);
    if (!hit) return;
    setActive({ r: hit.r, c: hit.c });
    if (hit.cell) onCell(hit.row, hit.item, hit.cell);
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} onMouseLeave={() => setHover(null)} className="relative min-h-[320px] flex-1 overflow-auto overscroll-contain rounded-lg border bg-card" data-compliance-matrix>
      <table className="border-separate border-spacing-0 text-[14px]" style={{ width, minWidth: '100%', tableLayout: 'fixed' }}>
        <caption className="sr-only">Compliance matrix: people by required training. Arrow keys move between cells; Enter opens one.</caption>
        <colgroup>
          <col style={{ width: FIRST }} />
          {items.map(i => (
            <col key={i.id} style={{ width: COL }} />
          ))}
        </colgroup>
        <MatrixHead items={items} total={data.page.total} height={HEAD} />
        {groups.length > 0 && <GroupSection groups={groups} items={items} open={groupsOpen} onToggle={toggleGroups} rowHeight={GROUP_ROW} sectionHeight={SECTION} />}
        <tbody onMouseOver={e => show(e.target)} onFocus={e => show(e.target)} onBlur={() => setHover(null)} onKeyDown={onKeyDown} onClick={onClick}>
          <tr style={{ height: SECTION }}>
            <td className="sticky left-0 z-10 border-b border-r bg-subtle px-3 text-2xs font-medium text-muted-foreground">People</td>
            <td colSpan={items.length} className="border-b bg-subtle" />
          </tr>
          {first > 0 && (
            <tr aria-hidden style={{ height: first * ROW }}>
              <td colSpan={items.length + 1} />
            </tr>
          )}
          {visible.map((row, n) => (
            <PersonRow key={row.personId} row={row} index={first + n} items={items} height={ROW} activeCol={first + n === activeR ? activeC : -1} />
          ))}
          {last < rows.length && (
            <tr aria-hidden style={{ height: (rows.length - last) * ROW }}>
              <td colSpan={items.length + 1} />
            </tr>
          )}
        </tbody>
      </table>
      {hover && <CellTooltip hover={hover} />}
    </div>
  );
}

/** Item columns: glyph, title and % compliant. Memoised so scrolling the matrix never re-renders them. */
const MatrixHead = memo(function MatrixHead({ items, total, height }: { items: Item[]; total: number; height: number }) {
  return (
    <thead>
      <tr style={{ height }}>
        <th scope="col" className="sticky left-0 top-0 z-30 border-b border-r bg-card px-3 pb-2 text-left align-bottom">
          <span className="block text-sm font-medium text-muted-foreground">Person</span>
          <span className="block text-2xs font-normal text-muted-foreground/80">
            {fmt(total)} {total === 1 ? 'person' : 'people'}
          </span>
        </th>
        {items.map(i => {
          const late = i.counts.overdue + i.counts.expired;
          return (
            <th key={i.id} scope="col" className="sticky top-0 z-20 border-b bg-card p-0 text-left align-bottom font-normal">
              <Tip
                side="bottom"
                label={
                  <span className="block max-w-[260px] space-y-0.5 py-0.5">
                    <span className="block font-medium">{i.title}</span>
                    <span className="block text-muted-foreground">
                      {i.kind === 'path' ? 'Learning path' : 'Course'} · required for {i.audience}
                      {i.recurrenceMonths ? ` · every ${i.recurrenceMonths} months` : ''}
                    </span>
                    <span className="block text-muted-foreground">
                      {fmt(i.compliant)} of {fmt(i.required)} compliant{late ? ` · ${[i.counts.overdue ? `${fmt(i.counts.overdue)} overdue` : '', i.counts.expired ? `${fmt(i.counts.expired)} expired` : ''].filter(Boolean).join(', ')}` : ''}
                    </span>
                    <span className="block text-muted-foreground">Rule: {i.rules.map(r => r.name).join(', ')}</span>
                  </span>
                }
              >
                <div className="flex h-full flex-col justify-end gap-1 px-2 pb-2" style={{ height }}>
                  <CourseGlyph icon={i.icon} color={i.color} size={16} />
                  <Link to={i.kind === 'path' ? `/paths/${i.targetId}` : `/courses/${i.targetId}`} className="line-clamp-2 text-2xs font-medium leading-[16px] text-foreground hover:underline">
                    {i.title}
                  </Link>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-foreground/45" style={{ width: `${i.compliantRate ?? 0}%` }} />
                    </span>
                    <span className="text-2xs font-medium tabular-nums text-foreground/85">{pctText(i.compliantRate)}</span>
                    {late > 0 ? <LateDot /> : <span className="w-1.5 shrink-0" aria-hidden />}
                  </span>
                </div>
              </Tip>
            </th>
          );
        })}
      </tr>
    </thead>
  );
});

/** One summary row per group: % compliant for each required item. */
const GroupSection = memo(function GroupSection({ groups, items, open, onToggle, rowHeight, sectionHeight }: { groups: Compliance['groups']; items: Item[]; open: boolean; onToggle: () => void; rowHeight: number; sectionHeight: number }) {
  const ws = useWorkspace();
  return (
    <tbody>
      <tr style={{ height: sectionHeight }}>
        <td className="sticky left-0 z-10 border-b border-r bg-subtle px-3">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-1 text-2xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')} />
            By group
            <span className="font-normal text-muted-foreground/80">· {fmt(groups.length)}</span>
          </button>
        </td>
        <td colSpan={items.length} className="border-b bg-subtle" />
      </tr>
      {open &&
        groups.map(g => {
          const group = ws.groupById.get(g.groupId);
          const name = group?.name ?? 'Group';
          return (
            <tr key={g.groupId} style={{ height: rowHeight }} className="group">
              <td className="sticky left-0 z-10 border-b border-r bg-card px-3 group-hover:bg-subtle">
                <div className="flex min-w-0 items-center gap-2">
                  <LabelDot color={group?.color} />
                  <Link to={`/groups/${g.groupId}`} className="min-w-0 flex-1 truncate text-[13.5px] hover:underline">
                    {name}
                  </Link>
                  <Tip label={`${name}: ${fmt(g.compliant)} of ${fmt(g.required)} required items compliant${g.late ? ` · ${lateText(g.late)}` : ''}`}>
                    <span tabIndex={0} className="flex shrink-0 items-center gap-1 rounded text-2xs font-medium tabular-nums text-foreground/85 outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      {pctText(g.compliantRate)}
                      {g.late > 0 ? <LateDot /> : <span className="w-1.5" aria-hidden />}
                    </span>
                  </Tip>
                </div>
              </td>
              {items.map(i => {
                const s = g.items[i.id];
                return (
                  <td key={i.id} className="border-b text-center group-hover:bg-subtle">
                    {s ? (
                      <Tip label={`${name} · ${i.title}: ${fmt(s.compliant)} of ${fmt(s.required)} compliant${s.late ? ` · ${lateText(s.late)}` : ''}`}>
                        <span tabIndex={0} className="relative inline-flex items-center rounded px-1 text-sm tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring">
                          {pctText(s.compliantRate)}
                          {s.late > 0 && <LateDot className="absolute -right-2 top-1/2 -translate-y-1/2" />}
                        </span>
                      </Tip>
                    ) : (
                      <span className="text-2xs text-muted-foreground/40" aria-label="Not required">
                        –
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
    </tbody>
  );
});

/** A person's row. Clicks, hovers and keys are handled once on the table body, so a row is pure markup. */
const PersonRow = memo(function PersonRow({ row, index, items, height, activeCol }: { row: Row; index: number; items: Item[]; height: number; activeCol: number }) {
  const ws = useWorkspace();
  const groups = row.groupIds.map(id => ws.groupById.get(id)?.name).filter(Boolean).join(', ');
  const late = row.cells.filter(c => c && (c.status === 'overdue' || c.status === 'expired')).length;
  const cellClass = 'flex w-full items-center justify-center outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
  return (
    <tr style={{ height }} className="group">
      <td className="sticky left-0 z-10 border-b border-r bg-card px-3 group-hover:bg-subtle">
        <div className="flex min-w-0 items-center gap-2">
          <PersonAvatar person={row} size={20} />
          <div className="min-w-0 flex-1">
            <Link to={`/people/${row.personId}`} className="block truncate text-[13.5px] leading-4 hover:underline">
              {row.name}
            </Link>
            <span className="block truncate text-2xs leading-4 text-muted-foreground">{groups || row.title || row.email}</span>
          </div>
          {row.gaps > 0 && (
            <span
              className={cn('hidden shrink-0 rounded px-1 text-2xs font-medium tabular-nums sm:inline-block', late ? 'bg-tone-danger/[0.08] text-tone-danger' : 'bg-muted text-muted-foreground')}
              title={`${row.gaps} of ${row.required} required ${row.required === 1 ? 'item' : 'items'} not compliant${late ? ` · ${late} overdue or expired` : ''}`}
            >
              {row.gaps}
            </span>
          )}
        </div>
      </td>
      {items.map((i, c) => {
        const cell = row.cells[c];
        const tabIndex = c === activeCol ? 0 : -1;
        return (
          <td key={i.id} className="border-b p-0 group-hover:bg-subtle">
            {cell ? (
              <button type="button" data-r={index} data-c={c} tabIndex={tabIndex} aria-label={`${row.name}, ${i.title}: ${STATUS[cell.status].label}`} className={cn(cellClass, 'hover:bg-accent')} style={{ height: height - 1 }}>
                <ComplianceGlyph status={cell.status} progress={cell.progress} />
              </button>
            ) : (
              <div data-r={index} data-c={c} tabIndex={tabIndex} role="gridcell" aria-label={`${row.name}, ${i.title}: not required`} className={cellClass} style={{ height: height - 1 }}>
                <ComplianceGlyph status="none" />
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
});

/** The headline numbers as a stat strip, then the key to the matrix. Colour only where something is late. */
function Summary({ data }: { data: Compliance }) {
  const o = data.overall;
  const c = o.counts;
  return (
    <div className="shrink-0 space-y-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4" role="list" aria-label="Compliance numbers">
        <KpiTile label="Compliant" value={pctText(o.compliantRate)} hint={`${fmt(o.compliant)} of ${fmt(o.required)} required items`} info="Finished, with a certificate still in date" />
        <KpiTile label="People with gaps" value={fmt(o.peopleWithGaps)} hint={`Of ${fmt(o.people)} ${o.people === 1 ? 'person' : 'people'} in scope`} />
        <KpiTile label="Overdue" value={fmt(c.overdue)} tone={c.overdue ? 'text-tone-danger' : undefined} hint="Past due, not finished" />
        <KpiTile label="Expired" value={fmt(c.expired)} tone={c.expired ? 'text-tone-danger' : undefined} hint="Certificate lapsed" />
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground" aria-label="Key">
        {STATUS_ORDER.map(s => (
          <li key={s}>
            <Tip label={STATUS[s].hint}>
              <span tabIndex={0} className="flex items-center gap-1.5 rounded outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <ComplianceGlyph status={s} progress={50} size={13} />
                {STATUS[s].label}
                <span className="tabular-nums text-foreground">{fmt(c[s])}</span>
              </span>
            </Tip>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="flex w-[13px] justify-center"><ComplianceGlyph status="none" /></span> Not required
        </li>
        <li className="flex items-center gap-1.5 sm:ml-auto">
          <LateDot /> Includes overdue or expired
        </li>
      </ul>
    </div>
  );
}

export function ComplianceSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <KpiSkeleton count={4} className="grid-cols-2 lg:grid-cols-4" />
      <div className="flex-1 space-y-px overflow-hidden rounded-lg border bg-card p-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex h-10 items-center gap-3">
            <div className="skeleton h-5 w-5 rounded-full" />
            <div className="skeleton h-3 w-32" />
            {Array.from({ length: 6 }).map((__, j) => (
              <div key={j} className="skeleton ml-8 h-3.5 w-3.5 rounded-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ComplianceTab({ params, update }: { params: ReportParams; update: (p: Partial<ReportParams>) => void }) {
  const app = useAppActions();
  const input = complianceInput(params);
  const { data, isPending, isError, refetch, isFetching, isPlaceholderData } = useComplianceQuery(input);

  const onCell = useCallback(
    (row: Row, item: Item, cell: Cell) => {
      if (cell.enrollmentId) app.openEnrollment(cell.enrollmentId);
      else app.openEnroll({ targetType: item.kind === 'path' ? 'Path' : 'Course', targetId: item.targetId, personIds: [row.personId] });
    },
    [app],
  );

  // A page past the end (after a filter shrank the list) goes back to the first.
  useEffect(() => {
    if (data && !isPlaceholderData && params.page > 0 && data.rows.length === 0 && data.page.total > 0) update({ page: 0 });
  }, [data, isPlaceholderData, params.page, update]);

  if (isError && !data) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Compliance couldn't load"
        description="The report didn't come back. It's usually temporary."
        action={
          <button type="button" onClick={() => refetch()} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
            Try again
          </button>
        }
      />
    );
  }
  if (isPending || !data) return <ComplianceSkeleton />;

  if (!data.availableItems.length) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Nothing is required yet"
        description="Compliance tracks the courses and paths that active assignment rules require. Create a rule — like security training for everyone, every year — to start tracking it here."
        action={
          <Link to="/assignments" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
            Set up assignment rules
          </Link>
        }
      />
    );
  }

  const filtered = params.groupIds.length > 0 || Boolean(params.managerId) || params.itemIds.length > 0;
  const total = data.page.total;
  const from = data.page.offset + 1;
  const to = data.page.offset + data.rows.length;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-4 transition-opacity', isPlaceholderData && isFetching && 'opacity-60')}>
      <Summary data={data} />
      {!data.rows.length ? (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={<ShieldCheck />}
            title={params.gapsOnly ? 'No gaps — everyone in scope is compliant' : 'Nobody in scope has required training'}
            description={params.gapsOnly ? 'Turn off “Only people with gaps” to see everyone.' : filtered ? 'No one matching these filters is in the audience of an active assignment rule.' : 'Active assignment rules don’t cover anyone yet.'}
            action={
              filtered || params.gapsOnly ? (
                <button type="button" onClick={() => update({ groupIds: [], managerId: null, itemIds: [], gapsOnly: false })} className="text-[14px] font-medium text-primary hover:underline">
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* Keyed by page, so moving to another page starts at the top-left again. */}
          <Matrix key={data.page.offset} data={data} onCell={onCell} />
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="hidden sm:inline">Cells show each person’s latest cycle. Click one to open the enrollment, or to assign training that’s missing. Arrow keys move between cells.</span>
            {total > COMPLIANCE_PAGE && (
              <span className="flex items-center gap-1">
                <span className="tabular-nums">
                  {fmt(from)}–{fmt(to)} of {fmt(total)}
                </span>
                <button type="button" aria-label="Previous page" disabled={params.page === 0} onClick={() => update({ page: params.page - 1 })} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent disabled:opacity-40">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Next page" disabled={to >= total} onClick={() => update({ page: params.page + 1 })} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent disabled:opacity-40">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

