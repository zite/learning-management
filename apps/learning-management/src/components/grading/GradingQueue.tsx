import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Search, X } from 'lucide-react';
import { memo, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { shortDate, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { CoursePicker } from '../pickers/pickers';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import type { GradingTab, QueueFilters, QueueRow } from './gradingData';

/** A grade as a small number: neutral for a pass, amber when the work went back for revision. */
export function GradePill({ grade, status, className }: { grade: number | null; status: QueueRow['status']; className?: string }) {
  if (grade == null) return null;
  return (
    <span className={cn('inline-flex h-5 min-w-[26px] items-center justify-center rounded-md px-1.5 text-sm font-medium tabular-nums', status === 'Needs revision' ? 'bg-tone-warning/[0.12] text-tone-warning' : 'bg-muted text-foreground/80', className)}>
      {Math.round(grade)}
    </span>
  );
}

function waitingLabel(days: number | null, submittedAt: string | null) {
  if (days == null) return timeAgo(submittedAt).replace(' ago', '');
  if (days < 1) return timeAgo(submittedAt).replace(' ago', '');
  return `${days}d`;
}

function QueueRowInner({ row, active, onOpen }: { row: QueueRow; active: boolean; onOpen: (id: string) => void }) {
  const waiting = row.status === 'Submitted';
  const tone = waiting && (row.waitingDays ?? 0) >= 14 ? 'text-tone-danger' : waiting && (row.waitingDays ?? 0) >= 7 ? 'text-tone-warning' : 'text-muted-foreground';
  return (
    <button
      type="button"
      data-row-id={row.id}
      aria-current={active ? 'true' : undefined}
      onClick={() => onOpen(row.id)}
      className={cn('group relative flex w-full items-start gap-2.5 border-b border-border/50 py-2.5 pl-4 pr-3 text-left outline-none transition-colors duration-75 focus-visible:bg-accent/60', active ? 'bg-accent' : 'hover:bg-accent/50')}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary" aria-hidden />}
      <PersonAvatar person={{ name: row.personName, color: row.personColor, avatarUrl: row.personAvatarUrl }} size={24} className="mt-px" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-[14px]', waiting ? 'font-medium text-foreground' : 'text-foreground/90')}>{row.personName}</span>
          {row.attempt > 1 && <span className="shrink-0 rounded bg-muted px-1 text-2xs font-medium tabular-nums text-muted-foreground">#{row.attempt}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
            {row.status !== 'Submitted' && <GradePill grade={row.grade} status={row.status} />}
            <Tip label={waiting ? `Submitted ${shortDate(row.submittedAt)}` : `Graded ${shortDate(row.gradedAt)}${row.gradedByName ? ` by ${row.gradedByName}` : ''}`}>
              <span className={cn('text-sm tabular-nums', tone)}>{waiting ? waitingLabel(row.waitingDays, row.submittedAt) : timeAgo(row.gradedAt).replace(' ago', '')}</span>
            </Tip>
          </span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13.5px] text-muted-foreground">
          <CourseGlyph icon={row.courseIcon} color={row.courseColor} size={14} />
          <span className="truncate">{row.lessonTitle}</span>
          {!row.canGrade && <span className="ml-auto shrink-0 text-2xs text-faint">View only</span>}
        </span>
      </span>
    </button>
  );
}

const QueueRowView = memo(QueueRowInner);

export function GradingQueue({
  tab,
  filters,
  onFilters,
  rows,
  isPending,
  isError,
  onRetry,
  activeId,
  onOpen,
  searchOpen,
  onSearchOpen,
  empty,
}: {
  tab: GradingTab;
  filters: QueueFilters;
  onFilters: (patch: Partial<QueueFilters>) => void;
  rows: QueueRow[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  activeId: string | undefined;
  onOpen: (id: string) => void;
  searchOpen: boolean;
  onSearchOpen: (open: boolean) => void;
  empty: ReactNode;
}) {
  const ws = useWorkspace();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const course = filters.courseId ? ws.courseById.get(filters.courseId) : undefined;

  useEffect(() => {
    if (!activeId) return;
    const el = listRef.current?.querySelector(`[data-row-id="${activeId}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeId, rows.length]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        {searchOpen ? (
          <div className="flex h-8 max-w-[324px] flex-1 items-center gap-1.5 rounded-md border bg-background px-2 animate-fade-in">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={filters.q}
              onChange={e => onFilters({ q: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  onFilters({ q: '' });
                  onSearchOpen(false);
                } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                  if (rows[0] && !rows.some(r => r.id === activeId)) onOpen(rows[0].id);
                }
              }}
              placeholder="Search learners, lessons, courses…"
              aria-label="Search submissions"
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
            />
            <button type="button" aria-label="Clear search" onClick={() => { onFilters({ q: '' }); onSearchOpen(false); }} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex h-8 shrink-0 items-center rounded-md border bg-subtle p-0.5" role="radiogroup" aria-label="Whose courses">
              {(['mine', 'all'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={filters.scope === s}
                  onClick={() => onFilters({ scope: s })}
                  className={cn('h-[22px] rounded-[5px] px-2 text-sm transition-colors', filters.scope === s ? 'bg-background font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}
                >
                  {s === 'mine' ? 'My courses' : 'All'}
                </button>
              ))}
            </div>
            <CoursePicker
              value={filters.courseId}
              onChange={v => onFilters({ courseId: v })}
              allowNone
              trigger={
                <button type="button" className={cn('ghost-chip h-8 min-w-0 gap-1.5 px-2 text-[13.5px]', course ? 'text-foreground' : 'text-muted-foreground')}>
                  {course ? <CourseGlyph icon={course.icon} color={course.color} size={14} /> : null}
                  <span className="truncate">{course?.title ?? 'All courses'}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                </button>
              }
            />
            <div className="ml-auto flex shrink-0 items-center">
              <Tip label={filters.ordering === 'oldest' ? (tab === 'todo' ? 'Oldest first — longest waiting at the top' : 'Oldest first') : 'Newest first'}>
                <IconButton aria-label={filters.ordering === 'oldest' ? 'Sorted oldest first' : 'Sorted newest first'} onClick={() => onFilters({ ordering: filters.ordering === 'oldest' ? 'newest' : 'oldest' })}>
                  {filters.ordering === 'oldest' ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
                </IconButton>
              </Tip>
              <Tip label="Search" keys={['/']}>
                <IconButton aria-label="Search submissions" onClick={() => onSearchOpen(true)}>
                  <Search />
                </IconButton>
              </Tip>
            </div>
          </>
        )}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" aria-label="Submissions">
        {isPending ? (
          <div className="space-y-px pt-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex gap-2.5 px-4 py-3">
                <div className="skeleton h-6 w-6 rounded-full" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <div className="skeleton h-3" style={{ width: `${40 + ((i * 17) % 30)}%` }} />
                  <div className="skeleton h-2.5" style={{ width: `${55 + ((i * 29) % 35)}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <EmptyState title="The queue didn’t load" description="Check your connection and try again." action={<button type="button" onClick={onRetry} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">Try again</button>} />
        ) : rows.length === 0 ? (
          empty
        ) : (
          rows.map(r => <QueueRowView key={r.id} row={r} active={r.id === activeId} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}
