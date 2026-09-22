import { ArrowDown, ArrowUp, BellRing, CalendarDays, Check, CheckCircle2, Copy, ExternalLink, RotateCcw, Undo2, UserMinus, UserRound } from 'lucide-react';
import { differenceInCalendarDays, format, isThisYear, parseISO } from 'date-fns';
import { memo, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@project/components/ui/context-menu';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { SOURCE_LABEL, STATUS_META, type DisplayProperty } from '../../lib/constants';
import { dateTime, dueLabel, formatDuration, longDate, shortDate, timeAgo } from '../../lib/format';
import { useEnrollmentActions } from '../../lib/mutations';
import type { Enrollment, EnrollmentOrdering } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { CertificateMark, CourseGlyph, StatusGlyph } from '../primitives/icons';

export type RowProps = {
  row: Enrollment;
  /** What the row leads with: the learner (a course's list) or the course (a person's list). */
  primary: 'person' | 'course';
  properties: Set<DisplayProperty>;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  onClick: (r: Enrollment, e: MouseEvent) => void;
  onToggleSelect: (r: Enrollment, e: MouseEvent) => void;
  onHover: (r: Enrollment) => void;
  getTargets: (r: Enrollment) => Enrollment[];
  onDue: (targets: Enrollment[]) => void;
};

type Column = 'source' | 'progress' | 'score' | 'time' | 'due' | 'activity';

/**
 * The value columns, in display order. The header row and every row use the
 * same classes, so a label always sits over its values at every breakpoint.
 */
const COLUMNS: Array<{ key: Column; label: string; hint: string; width: number; cls: string; sort?: [EnrollmentOrdering, EnrollmentOrdering?] }> = [
  { key: 'source', label: 'Enrolled via', hint: 'Who or what enrolled them', width: 104, cls: 'justify-start' },
  { key: 'progress', label: 'Progress', hint: 'Required lessons completed', width: 120, cls: 'justify-start', sort: ['progress_desc', 'progress_asc'] },
  { key: 'score', label: 'Score', hint: 'Best quiz score', width: 48, cls: 'justify-end', sort: ['score_desc', 'score_asc'] },
  { key: 'time', label: 'Time', hint: 'Time spent learning', width: 52, cls: 'justify-end' },
  { key: 'due', label: 'Due', hint: 'Due date, or when it was completed', width: 104, cls: 'justify-end', sort: ['due_asc', 'due_desc'] },
  { key: 'activity', label: 'Activity', hint: 'Last activity', width: 64, cls: 'justify-end', sort: ['activity_desc'] },
];

/** Columns give way in this order when the list is narrow, so the learner or course name keeps its room. */
const DROP_ORDER: Column[] = ['source', 'time', 'activity', 'score', 'progress'];
const GAP = 12;
/** Padding, checkbox, status glyph and the gaps between them. */
const ROW_CHROME = 8 + 16 + 10 + 20 + 10 + 10 + 16;

/**
 * The display properties that fit a list `width` pixels wide: value columns
 * drop (least useful first) until the name column has room to breathe. Pane
 * width, not viewport width, so a list beside a side panel adapts too.
 */
export function fitProperties(properties: Set<DisplayProperty>, width: number, secondary: boolean): Set<DisplayProperty> {
  if (!width) return properties;
  const minLead = width < 768 ? 170 : secondary ? 380 : 300;
  const out = new Set(properties);
  const used = () => COLUMNS.filter(c => out.has(c.key)).reduce((n, c) => n + c.width + GAP, 0);
  for (const key of DROP_ORDER) {
    if (width - ROW_CHROME - used() >= minLead) break;
    out.delete(key);
  }
  return out;
}

function visibleColumns(properties: Set<DisplayProperty>) {
  return COLUMNS.filter(c => properties.has(c.key));
}

const ROW_CLS = 'relative flex items-center gap-2.5 pl-2 pr-4';

/** Column labels for the enrollments list. Click a sortable label to order by it. */
export function EnrollmentHeader({ primary, properties, ordering, onOrder, selectAll, className }: { primary: 'person' | 'course'; properties: Set<DisplayProperty>; ordering: EnrollmentOrdering; onOrder: (o: EnrollmentOrdering) => void; selectAll?: ReactNode; className?: string }) {
  const leadLabel = primary === 'person' ? 'Learner' : 'Course';
  const leadSort: EnrollmentOrdering = primary === 'person' ? 'name_asc' : 'course_asc';
  const label = (text: string, sort: [EnrollmentOrdering, EnrollmentOrdering?] | undefined, hint: string, cls?: string) => {
    if (!sort) {
      return (
        <Tip label={hint}>
          <span className={cn('cursor-default', cls)}>{text}</span>
        </Tip>
      );
    }
    const active = sort.indexOf(ordering);
    const next = active === 0 && sort[1] ? sort[1] : sort[0];
    const descending = String(active >= 0 ? ordering : sort[0]).endsWith('_desc');
    return (
      <Tip label={hint}>
        <button type="button" onClick={() => onOrder(next)} className={cn('flex items-center gap-1 whitespace-nowrap hover:text-foreground', active >= 0 && 'text-foreground', cls)}>
          {text}
          {active >= 0 && (descending ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
        </button>
      </Tip>
    );
  };
  return (
    <div role="row" className={cn(ROW_CLS, 'sticky top-0 z-20 h-9 border-b bg-subtle/95 text-sm text-muted-foreground backdrop-blur-sm', className)}>
      <span className="flex w-4 shrink-0 items-center">{selectAll}</span>
      <span className="w-5 shrink-0" />
      <div className="flex min-w-0 flex-1 items-center">{label(leadLabel, [leadSort], primary === 'person' ? 'Order by learner name' : 'Order by course title')}</div>
      <div className="flex shrink-0 items-center gap-3">
        {visibleColumns(properties).map(c => (
          <span key={c.key} className={cn('flex shrink-0 items-center', c.cls)} style={{ width: c.width }}>
            {label(c.label, c.sort, c.hint)}
          </span>
        ))}
      </div>
    </div>
  );
}

function RowMenu({ row, getTargets, onDue, children }: { row: Enrollment; getTargets: (r: Enrollment) => Enrollment[]; onDue: (t: Enrollment[]) => void; children: React.ReactNode }) {
  const app = useAppActions();
  const { run } = useEnrollmentActions();
  const navigate = useNavigate();
  const ws = useWorkspace();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {(() => {
          const targets = getTargets(row);
          const n = targets.length;
          const open = targets.filter(t => t.status === 'Not started' || t.status === 'In progress');
          const withdrawn = targets.filter(t => t.status === 'Withdrawn');
          const active = targets.filter(t => t.status !== 'Withdrawn');
          const suffix = (k: number) => (n > 1 ? ` (${k})` : '');
          return (
            <>
              {open.length > 0 && (
                <>
                  <ContextMenuItem className="gap-2 text-[14px]" onSelect={() => run(open, 'remind')}>
                    <BellRing className="h-3.5 w-3.5" /> Send reminder{suffix(open.length)}
                  </ContextMenuItem>
                  <ContextMenuItem className="gap-2 text-[14px]" onSelect={() => onDue(open)}>
                    <CalendarDays className="h-3.5 w-3.5" /> Change due date{suffix(open.length)}…
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="gap-2 text-[14px]"
                    onSelect={async () => {
                      if (await app.confirm({ title: n > 1 ? `Mark ${open.length} enrollment${open.length === 1 ? '' : 's'} complete?` : `Mark ${row.personName} complete?`, description: 'For training finished offline. Certificates are issued and learning paths move forward.', confirmLabel: 'Mark complete' })) run(open, 'complete');
                    }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark complete{suffix(open.length)}…
                  </ContextMenuItem>
                </>
              )}
              {active.length > 0 && (
                <ContextMenuItem
                  className="gap-2 text-[14px]"
                  onSelect={async () => {
                    if (await app.confirm({ title: active.length > 1 ? `Reset progress for ${active.length} enrollments?` : 'Reset progress?', description: 'Learners start from the beginning. Quiz attempts and submissions stay on record.', confirmLabel: 'Reset progress', destructive: true })) run(active, 'reset');
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset progress{suffix(active.length)}…
                </ContextMenuItem>
              )}
              {withdrawn.length > 0 && (
                <ContextMenuItem className="gap-2 text-[14px]" onSelect={() => run(withdrawn, 'restore')}>
                  <Undo2 className="h-3.5 w-3.5" /> Restore{suffix(withdrawn.length)}
                </ContextMenuItem>
              )}
              {active.length > 0 && (
                <ContextMenuItem
                  className="gap-2 text-[14px] text-destructive focus:text-destructive"
                  onSelect={async () => {
                    if (await app.confirm({ title: active.length > 1 ? `Withdraw ${active.length} enrollments?` : `Withdraw ${row.personName}?`, description: 'They lose access and it stops counting toward reports. You can restore it later with progress intact.', confirmLabel: 'Withdraw', destructive: true })) run(active, 'withdraw');
                  }}
                >
                  <UserMinus className="h-3.5 w-3.5" /> Withdraw{suffix(active.length)}…
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem className="gap-2 text-[14px]" onSelect={() => navigate(`/people/${row.personId}`)}>
                <UserRound className="h-3.5 w-3.5" /> Open {row.personName}
              </ContextMenuItem>
              <ContextMenuItem className="gap-2 text-[14px]" onSelect={() => navigate(`/courses/${row.courseId}`)}>
                <ExternalLink className="h-3.5 w-3.5" /> <span className="truncate">Open {ws.courseById.get(row.courseId)?.title ?? 'course'}</span>
              </ContextMenuItem>
              <ContextMenuItem className="gap-2 text-[14px]" onSelect={() => copyText([...new Set(targets.map(t => t.personEmail).filter(Boolean))].join(', '), n > 1 ? `Copied ${n} emails` : 'Copied email')}>
                <Copy className="h-3.5 w-3.5" /> Copy email{n > 1 ? 's' : ''}
              </ContextMenuItem>
            </>
          );
        })()}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** "Sep 28" this year, "Sep 2025" before — short enough that a date column never wraps. The tooltip has the full date. */
function compactDay(value: string | null | undefined) {
  if (!value) return '';
  const d = parseISO(value.length === 10 ? `${value}T12:00:00` : value);
  return format(d, isThisYear(d) ? 'MMM d' : 'MMM yyyy');
}

/** "3h", "12d" within the last month, then a compact date. */
function recency(iso: string) {
  return Math.abs(differenceInCalendarDays(new Date(), parseISO(iso))) > 30 ? compactDay(iso) : timeAgo(iso).replace(' ago', '');
}

/** Due for open work, the completion date for finished work. Colour only when it needs attention. */
function DueCell({ row: r }: { row: Enrollment }) {
  if (r.status === 'Completed') {
    return (
      <Tip label={`Completed ${longDate(r.completedAt)}${r.dueDate ? ` · was due ${shortDate(r.dueDate)}` : ''}`}>
        <span className="truncate text-sm tabular-nums text-muted-foreground">Done {compactDay(r.completedAt)}</span>
      </Tip>
    );
  }
  if (r.status === 'Withdrawn') return <span className="text-sm text-muted-foreground">Withdrawn</span>;
  if (!r.dueDate) return <span className="text-sm text-muted-foreground/50">—</span>;
  const d = dueLabel(r.dueDate);
  const overdueDays = d && d.days < 0 ? -d.days : 0;
  return (
    <Tip label={overdueDays ? `Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'} · was due ${longDate(r.dueDate)}` : `Due ${longDate(r.dueDate)}`}>
      <span className={cn('truncate text-sm tabular-nums', r.dueState === 'overdue' ? 'font-medium text-tone-danger' : r.dueState === 'due_soon' ? 'text-tone-warning' : 'text-muted-foreground')}>{d?.label}</span>
    </Tip>
  );
}

function EnrollmentRowInner({ row: r, primary, properties, selected, focused, selecting, onClick, onToggleSelect, onHover, getTargets, onDue }: RowProps) {
  const ws = useWorkspace();
  const course = ws.courseById.get(r.courseId);
  const has = (p: DisplayProperty) => properties.has(p);
  const muted = r.status === 'Withdrawn' || r.personStatus === 'Deactivated';

  const person = (
    <span className="flex min-w-0 items-center gap-2">
      <PersonAvatar person={{ name: r.personName, color: r.personColor, avatarUrl: r.personAvatarUrl, status: r.personStatus }} size={20} />
      <span className={cn('truncate', muted && 'text-muted-foreground')}>{r.personName}</span>
      {has('title') && r.personTitle && <span className="hidden min-w-0 shrink-[100] truncate text-[13.5px] text-muted-foreground lg:inline">{r.personTitle}</span>}
    </span>
  );
  const courseEl = (
    <span className="flex min-w-0 items-center gap-2">
      <CourseGlyph icon={course?.icon} color={course?.color} size={18} />
      <span className={cn('truncate', muted && 'text-muted-foreground')}>{course?.title ?? 'Unknown course'}</span>
    </span>
  );

  const cell = (key: Column) => {
    switch (key) {
      case 'source':
        return <span className="truncate text-sm text-muted-foreground">{r.source === 'Assigned' && r.assignedByName ? r.assignedByName : SOURCE_LABEL[r.source] ?? r.source}</span>;
      case 'progress':
        return (
          <span className="flex w-full items-center gap-2">
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span className={cn('block h-full rounded-full transition-[width] duration-500', r.status === 'Completed' || r.status === 'Withdrawn' ? 'bg-muted-foreground/40' : 'bg-primary')} style={{ width: `${Math.max(0, Math.min(100, r.progress))}%` }} />
            </span>
            <span className="w-9 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{Math.round(r.progress)}%</span>
          </span>
        );
      case 'score':
        return r.score == null ? <span className="text-sm text-muted-foreground/50">—</span> : <span className={cn('text-sm tabular-nums', r.score < 70 ? 'text-tone-warning' : 'text-foreground/80')}>{Math.round(r.score)}%</span>;
      case 'time':
        return <span className={cn('text-sm tabular-nums', r.timeSpentSeconds ? 'text-muted-foreground' : 'text-muted-foreground/50')}>{r.timeSpentSeconds ? formatDuration(r.timeSpentSeconds) : '—'}</span>;
      case 'due':
        return <DueCell row={r} />;
      case 'activity':
        return (
          <Tip label={r.lastActivityAt ? `Last activity ${dateTime(r.lastActivityAt)}` : 'No activity yet'}>
            <span className={cn('text-sm tabular-nums', r.lastActivityAt ? 'text-muted-foreground' : 'text-muted-foreground/50')}>{r.lastActivityAt ? recency(r.lastActivityAt) : '—'}</span>
          </Tip>
        );
    }
  };

  return (
    <RowMenu row={r} getTargets={getTargets} onDue={onDue}>
      <div
        role="row"
        data-row-id={r.id}
        aria-selected={selected}
        onClick={e => onClick(r, e)}
        onMouseMove={() => !focused && onHover(r)}
        className={cn(
          ROW_CLS,
          'group/row h-10 cursor-default select-none border-b border-border/60 text-[14px] transition-colors duration-75',
          focused ? 'bg-accent/80' : 'hover:bg-accent/50',
          selected && 'bg-primary/[0.07] hover:bg-primary/10 dark:bg-primary/[0.1]',
        )}
      >
        {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
        <button
          type="button"
          aria-label={selected ? `Deselect ${r.personName}` : `Select ${r.personName}`}
          aria-pressed={selected}
          onClick={e => {
            e.stopPropagation();
            onToggleSelect(r, e);
          }}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-opacity',
            selected ? 'border-primary bg-primary text-primary-foreground opacity-100' : 'border-input bg-background',
            !selected && (selecting ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'),
          )}
        >
          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>
        <Tip label={`${STATUS_META[r.status].label}${r.status === 'In progress' ? ` · ${r.progress}%` : ''}${r.dueState === 'overdue' ? ' · overdue' : ''}`}>
          <span className="flex h-6 w-5 shrink-0 items-center justify-center">
            <StatusGlyph status={r.status} progress={r.progress} dueState={r.dueState} />
          </span>
        </Tip>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {primary === 'person' ? person : courseEl}
          {primary === 'person' && has('course') && <span className="hidden min-w-0 max-w-[45%] shrink-[2] md:flex">{courseEl}</span>}
          {primary === 'course' && has('person') && <span className="hidden min-w-0 max-w-[45%] shrink-[2] md:flex">{person}</span>}
          {r.cycle > 1 && (
            <Tip label={`Recertification — cycle ${r.cycle}`}>
              <span className="hidden shrink-0 rounded border border-dashed border-foreground/20 px-1.5 py-px text-2xs text-muted-foreground sm:inline">Cycle {r.cycle}</span>
            </Tip>
          )}
          {r.certificateId && (
            <Tip label="Certificate issued">
              <span className="shrink-0">
                <CertificateMark />
              </span>
            </Tip>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {visibleColumns(properties).map(c => (
            <span key={c.key} className={cn('flex shrink-0 items-center overflow-hidden whitespace-nowrap', c.cls)} style={{ width: c.width }}>
              {cell(c.key)}
            </span>
          ))}
        </div>
      </div>
    </RowMenu>
  );
}

export const EnrollmentRow = memo(EnrollmentRowInner);
