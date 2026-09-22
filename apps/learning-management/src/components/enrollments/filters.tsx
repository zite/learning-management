import { BookOpen, CalendarCheck, CalendarClock, CalendarPlus, CircleDashed, Clock3, Filter, FolderTree, Gauge, History, Repeat, Route, UsersRound, X } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { DUE_META, SOURCE_LABEL, STATUS_META } from '../../lib/constants';
import { shortDate } from '../../lib/format';
import type { EnrollmentFilters } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { LabelDot } from '../primitives/bits';
import { CourseGlyph, StatusGlyph } from '../primitives/icons';

export type FilterKey = 'statuses' | 'due' | 'dueDate' | 'courseIds' | 'categoryIds' | 'groupIds' | 'sources' | 'enrolled' | 'completed' | 'inactiveDays' | 'score' | 'cycles';

const STATUSES = ['Not started', 'In progress', 'Completed', 'Withdrawn'] as const;
const DUES = ['overdue', 'due_soon', 'on_track', 'no_due', 'done'] as const;
const SOURCES = ['Assigned', 'Automatic', 'Path', 'Self-enrolled'] as const;
const INACTIVE = [7, 14, 30, 60];

function toggle<T>(list: T[] | undefined, v: T) {
  const s = new Set(list ?? []);
  if (s.has(v)) s.delete(v);
  else s.add(v);
  return [...s];
}

const itemCls = 'text-[14px] gap-2';

type WindowKey = 'enrolled' | 'completed' | 'dueDate';

/** Date filters: rolling presets (which stay correct inside a saved view) or a fixed custom range. */
const WINDOWS: Record<WindowKey, { days: 'enrolledWithinDays' | 'completedWithinDays' | 'dueWithinDays'; from: 'enrolledFrom' | 'completedFrom' | 'dueFrom'; to: 'enrolledTo' | 'completedTo' | 'dueTo'; presets: Array<[number, string]>; past: boolean }> = {
  enrolled: { days: 'enrolledWithinDays', from: 'enrolledFrom', to: 'enrolledTo', presets: [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']], past: true },
  completed: { days: 'completedWithinDays', from: 'completedFrom', to: 'completedTo', presets: [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']], past: true },
  dueDate: { days: 'dueWithinDays', from: 'dueFrom', to: 'dueTo', presets: [[7, 'Next 7 days'], [14, 'Next 14 days'], [30, 'Next 30 days'], [90, 'Next 90 days']], past: false },
};

const isWindow = (k: FilterKey): k is WindowKey => k in WINDOWS;
const clearWindow = (k: WindowKey, f: EnrollmentFilters): EnrollmentFilters => ({ ...f, [WINDOWS[k].days]: undefined, [WINDOWS[k].from]: undefined, [WINDOWS[k].to]: undefined });

function WindowOptions({ k, filters, onChange }: { k: WindowKey; filters: EnrollmentFilters; onChange: (f: EnrollmentFilters) => void }) {
  const w = WINDOWS[k];
  const from = filters[w.from] ?? '';
  const to = filters[w.to] ?? '';
  const dateCls = 'h-8 w-full rounded-md border bg-background px-2 text-[13.5px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
  return (
    <>
      {w.presets.map(([days, label]) => {
        const on = filters[w.days] === days;
        return (
          <DropdownMenuCheckboxItem key={days} className={itemCls} checked={on} onCheckedChange={() => onChange({ ...clearWindow(k, filters), [w.days]: on ? undefined : days })}>
            {label}
          </DropdownMenuCheckboxItem>
        );
      })}
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-2xs font-medium text-muted-foreground">Custom range</DropdownMenuLabel>
      {/* Typing into a date field must not trigger the menu's typeahead or close it. */}
      <div className="grid grid-cols-2 gap-1.5 px-2 pb-2" onKeyDown={e => e.stopPropagation()}>
        <label className="space-y-0.5">
          <span className="text-2xs text-muted-foreground">From</span>
          <input type="date" className={dateCls} value={from} max={to || undefined} onChange={e => onChange({ ...filters, [w.days]: undefined, [w.from]: e.target.value || undefined })} />
        </label>
        <label className="space-y-0.5">
          <span className="text-2xs text-muted-foreground">To</span>
          <input type="date" className={dateCls} value={to} min={from || undefined} onChange={e => onChange({ ...filters, [w.days]: undefined, [w.to]: e.target.value || undefined })} />
        </label>
      </div>
    </>
  );
}

function Options({ k, filters, onChange }: { k: FilterKey; filters: EnrollmentFilters; onChange: (f: EnrollmentFilters) => void }) {
  const ws = useWorkspace();
  if (isWindow(k)) return <WindowOptions k={k} filters={filters} onChange={onChange} />;
  switch (k) {
    case 'cycles':
      return (
        <>
          <DropdownMenuCheckboxItem className={itemCls} checked={!filters.allCycles} onCheckedChange={() => onChange({ ...filters, allCycles: undefined })}>
            Latest cycle only
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem className={itemCls} checked={Boolean(filters.allCycles)} onCheckedChange={() => onChange({ ...filters, allCycles: filters.allCycles ? undefined : true })}>
            Include earlier cycles
          </DropdownMenuCheckboxItem>
        </>
      );
    case 'statuses':
      return (
        <>
          {STATUSES.map(s => (
            <DropdownMenuCheckboxItem key={s} className={itemCls} checked={filters.statuses?.includes(s) ?? false} onSelect={e => e.preventDefault()} onCheckedChange={() => onChange({ ...filters, statuses: toggle(filters.statuses, s) })}>
              <StatusGlyph status={s} progress={50} size={14} /> {STATUS_META[s].label}
            </DropdownMenuCheckboxItem>
          ))}
        </>
      );
    case 'due':
      return (
        <>
          {DUES.map(d => (
            <DropdownMenuCheckboxItem key={d} className={itemCls} checked={filters.due?.includes(d) ?? false} onSelect={e => e.preventDefault()} onCheckedChange={() => onChange({ ...filters, due: toggle(filters.due, d) })}>
              <span className={cn('h-2 w-2 rounded-full', d === 'overdue' ? 'bg-tone-danger' : d === 'due_soon' ? 'bg-tone-warning' : d === 'done' ? 'bg-tone-success' : 'bg-tone-neutral')} /> {DUE_META[d].label}
            </DropdownMenuCheckboxItem>
          ))}
        </>
      );
    case 'courseIds':
      return (
        <div className="max-h-[320px] overflow-y-auto">
          {ws.orderedCourses.filter(c => c.status !== 'Archived' || filters.courseIds?.includes(c.id)).map(c => (
            <DropdownMenuCheckboxItem key={c.id} className={itemCls} checked={filters.courseIds?.includes(c.id) ?? false} onSelect={e => e.preventDefault()} onCheckedChange={() => onChange({ ...filters, courseIds: toggle(filters.courseIds, c.id) })}>
              <CourseGlyph icon={c.icon} color={c.color} size={16} /> <span className="max-w-[220px] truncate">{c.title}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </div>
      );
    case 'categoryIds':
      return (
        <>
          {ws.categories.map(c => (
            <DropdownMenuCheckboxItem key={c.id} className={itemCls} checked={filters.categoryIds?.includes(c.id) ?? false} onSelect={e => e.preventDefault()} onCheckedChange={() => onChange({ ...filters, categoryIds: toggle(filters.categoryIds, c.id) })}>
              <span className="w-4 text-center">{c.icon || '•'}</span> {c.name}
            </DropdownMenuCheckboxItem>
          ))}
        </>
      );
    case 'groupIds':
      return (
        <div className="max-h-[320px] overflow-y-auto">
          {ws.groups.map(g => (
            <DropdownMenuCheckboxItem key={g.id} className={itemCls} checked={filters.groupIds?.includes(g.id) ?? false} onSelect={e => e.preventDefault()} onCheckedChange={() => onChange({ ...filters, groupIds: toggle(filters.groupIds, g.id) })}>
              <LabelDot color={g.color} /> {g.name} <span className="ml-auto text-sm text-muted-foreground">{g.memberCount}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </div>
      );
    case 'sources':
      return (
        <>
          {SOURCES.map(s => (
            <DropdownMenuCheckboxItem key={s} className={itemCls} checked={filters.sources?.includes(s) ?? false} onSelect={e => e.preventDefault()} onCheckedChange={() => onChange({ ...filters, sources: toggle(filters.sources, s) })}>
              {SOURCE_LABEL[s]}
            </DropdownMenuCheckboxItem>
          ))}
        </>
      );
    case 'inactiveDays':
      return (
        <>
          {INACTIVE.map(d => (
            <DropdownMenuCheckboxItem key={d} className={itemCls} checked={filters.inactiveDays === d} onCheckedChange={() => onChange({ ...filters, inactiveDays: filters.inactiveDays === d ? undefined : d })}>
              No activity for {d} days
            </DropdownMenuCheckboxItem>
          ))}
        </>
      );
    case 'score':
      return (
        <>
          {[
            ['Below 70%', { scoreMax: 69 }],
            ['70–89%', { scoreMin: 70, scoreMax: 89 }],
            ['90% and above', { scoreMin: 90 }],
          ].map(([label, range]) => {
            const r = range as { scoreMin?: number; scoreMax?: number };
            const on = filters.scoreMin === r.scoreMin && filters.scoreMax === r.scoreMax;
            return (
              <DropdownMenuCheckboxItem key={label as string} className={itemCls} checked={on} onCheckedChange={() => onChange({ ...filters, scoreMin: on ? undefined : r.scoreMin, scoreMax: on ? undefined : r.scoreMax })}>
                {label as string}
              </DropdownMenuCheckboxItem>
            );
          })}
        </>
      );
  }
}

const META: Record<FilterKey, { label: string; icon: ReactNode }> = {
  statuses: { label: 'Status', icon: <CircleDashed className="h-3.5 w-3.5" /> },
  due: { label: 'Due', icon: <Clock3 className="h-3.5 w-3.5" /> },
  dueDate: { label: 'Due date', icon: <CalendarClock className="h-3.5 w-3.5" /> },
  courseIds: { label: 'Course', icon: <BookOpen className="h-3.5 w-3.5" /> },
  categoryIds: { label: 'Category', icon: <FolderTree className="h-3.5 w-3.5" /> },
  groupIds: { label: 'Group', icon: <UsersRound className="h-3.5 w-3.5" /> },
  sources: { label: 'Enrolled via', icon: <Route className="h-3.5 w-3.5" /> },
  enrolled: { label: 'Enrolled', icon: <CalendarPlus className="h-3.5 w-3.5" /> },
  completed: { label: 'Completed', icon: <CalendarCheck className="h-3.5 w-3.5" /> },
  inactiveDays: { label: 'Inactive', icon: <History className="h-3.5 w-3.5" /> },
  score: { label: 'Quiz score', icon: <Gauge className="h-3.5 w-3.5" /> },
  cycles: { label: 'Recertification', icon: <Repeat className="h-3.5 w-3.5" /> },
};

const isSet = (k: FilterKey, f: EnrollmentFilters) => {
  if (isWindow(k)) return Boolean(f[WINDOWS[k].days] || f[WINDOWS[k].from] || f[WINDOWS[k].to]);
  if (k === 'score') return f.scoreMin != null || f.scoreMax != null;
  if (k === 'inactiveDays') return Boolean(f.inactiveDays);
  if (k === 'cycles') return Boolean(f.allCycles);
  return Boolean((f[k] as unknown[] | undefined)?.length);
};

/** Filter state with one filter removed. */
const without = (k: FilterKey, f: EnrollmentFilters): EnrollmentFilters =>
  isWindow(k) ? clearWindow(k, f) : k === 'score' ? { ...f, scoreMin: undefined, scoreMax: undefined } : k === 'cycles' ? { ...f, allCycles: undefined } : { ...f, [k]: undefined };

export function FilterMenu({ filters, onChange, locked = [] }: { filters: EnrollmentFilters; onChange: (f: EnrollmentFilters) => void; locked?: FilterKey[] }) {
  const keys = (Object.keys(META) as FilterKey[]).filter(k => !locked.includes(k));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="ghost-chip h-8 gap-1.5 px-2 text-[13.5px] text-muted-foreground hover:text-foreground">
          <Filter className="h-3.5 w-3.5" /> Filter
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-2xs font-medium text-muted-foreground">Filter by</DropdownMenuLabel>
        {keys.map(k => (
          <DropdownMenuSub key={k}>
            <DropdownMenuSubTrigger className="gap-2 text-[14px] [&_svg]:text-muted-foreground">
              {META[k].icon} {META[k].label}
              {isSet(k, filters) && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[220px]">
              <Options k={k} filters={filters} onChange={onChange} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        {keys.some(k => isSet(k, filters)) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem className="text-[14px] text-muted-foreground" checked={false} onCheckedChange={() => onChange(Object.fromEntries(Object.entries(filters).filter(([key]) => key === 'q')) as EnrollmentFilters)}>
              Clear all filters
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function summary(k: FilterKey, f: EnrollmentFilters, ws: ReturnType<typeof useWorkspace>) {
  const list = (names: string[]) => (names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', '));
  if (isWindow(k)) {
    const w = WINDOWS[k];
    const days = f[w.days];
    if (days) return w.presets.find(([d]) => d === days)?.[1].toLowerCase() ?? `${w.past ? 'last' : 'next'} ${days} days`;
    const from = f[w.from];
    const to = f[w.to];
    return from && to ? `${shortDate(from)} – ${shortDate(to)}` : from ? `from ${shortDate(from)}` : `until ${shortDate(to)}`;
  }
  switch (k) {
    case 'cycles':
      return 'all cycles';
    case 'statuses':
      return list((f.statuses ?? []).map(s => STATUS_META[s].label));
    case 'due':
      return list((f.due ?? []).map(d => DUE_META[d].label));
    case 'courseIds':
      return list((f.courseIds ?? []).map(id => ws.courseById.get(id)?.title ?? 'Course'));
    case 'categoryIds':
      return list((f.categoryIds ?? []).map(id => ws.categoryById.get(id)?.name ?? 'Category'));
    case 'groupIds':
      return list((f.groupIds ?? []).map(id => ws.groupById.get(id)?.name ?? 'Group'));
    case 'sources':
      return list((f.sources ?? []).map(s => SOURCE_LABEL[s] ?? s));
    case 'inactiveDays':
      return `${f.inactiveDays}+ days`;
    case 'score':
      return f.scoreMin != null && f.scoreMax != null ? `${f.scoreMin}–${f.scoreMax}%` : f.scoreMin != null ? `≥ ${f.scoreMin}%` : `≤ ${f.scoreMax}%`;
  }
}

/** "Due: Overdue", "Enrolled: last 30 days" — one phrase per active filter, for summaries like the save-view dialog. */
export function describeFilters(f: EnrollmentFilters, ws: ReturnType<typeof useWorkspace>) {
  return (Object.keys(META) as FilterKey[]).filter(k => isSet(k, f)).map(k => `${META[k].label}: ${summary(k, f, ws)}`);
}

export function FilterChips({ filters, onChange, locked = [] }: { filters: EnrollmentFilters; onChange: (f: EnrollmentFilters) => void; locked?: FilterKey[] }) {
  const ws = useWorkspace();
  const active = (Object.keys(META) as FilterKey[]).filter(k => !locked.includes(k) && isSet(k, filters));
  if (!active.length) return null;
  return (
    <>
      {active.map(k => (
        <span key={k} className="flex h-8 items-center overflow-hidden rounded-md border bg-background text-[13.5px] shadow-2xs animate-fade-in">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex h-full items-center gap-1.5 px-2 hover:bg-accent [&_svg]:text-muted-foreground">
                {META[k].icon}
                <span className="text-muted-foreground">{META[k].label}</span>
                <span className="max-w-[220px] truncate font-medium">{summary(k, filters, ws)}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[220px]">
              <Options k={k} filters={filters} onChange={onChange} />
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-label={`Remove ${META[k].label} filter`}
            onClick={() => onChange(without(k, filters))}
            className="flex h-full items-center border-l px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </>
  );
}
