import { ArrowDown, ArrowUp, BarChart3, Flame } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, LabelDot, Tip } from '../primitives/bits';
import { CourseGlyph, Stars } from '../primitives/icons';
import { periodLabel, rangeText, type Reports } from './params';
import { TrendsChart } from './TrendsChart';
import { DANGER, DataTable, HBar, KpiSkeleton, KpiTile, LegendKey, Panel, PanelEmpty, PanelSkeleton, fmt, hoursText, pctText, slot } from './viz';

/** A link to another report tab that keeps the current filters. */
export function reportLink(tab: string, search: string, set: Record<string, string | null> = {}) {
  const p = new URLSearchParams(search);
  for (const [k, v] of Object.entries(set)) {
    if (v == null) p.delete(k);
    else p.set(k, v);
  }
  const q = p.toString();
  return `/reports/${tab}${q ? `?${q}` : ''}`;
}

export function OverviewKpis({ data }: { data: Reports }) {
  const k = data.kpis;
  const period = periodLabel(data.range);
  return (
    <div className="space-y-2" aria-label="Key numbers">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1" role="list" aria-label="Activity in the range">
        <KpiTile label="Active learners" value={fmt(k.activeLearners.value)} hint="Started or finished a lesson" delta={{ now: k.activeLearners.value, prev: k.activeLearners.prev, period }} />
        <KpiTile label="New enrollments" value={fmt(k.enrollments.value)} hint="Courses assigned or chosen" delta={{ now: k.enrollments.value, prev: k.enrollments.prev, period, better: 'neutral' }} />
        <KpiTile label="Completions" value={fmt(k.completions.value)} hint="Courses finished in the range" delta={{ now: k.completions.value, prev: k.completions.prev, period }} />
        <KpiTile label="Learning hours" value={hoursText(k.learningHours.value)} hint="Time spent in lessons" delta={{ now: k.learningHours.value, prev: k.learningHours.prev, period, format: n => hoursText(n) }} />
        <KpiTile label="Certificates issued" value={fmt(k.certificates.value)} hint="Courses and paths" delta={{ now: k.certificates.value, prev: k.certificates.prev, period }} />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4" role="list" aria-label="How well it went">
        <KpiTile
          label="Completion rate"
          value={pctText(k.completionRate.value)}
          hint={k.completionRate.whole ? `${fmt(k.completionRate.part)} of ${fmt(k.completionRate.whole)} open enrollments finished` : 'No enrollments open in this range'}
          delta={k.completionRate.value != null && k.completionRate.prev != null ? { now: k.completionRate.value, prev: k.completionRate.prev, unit: 'points', period, format: n => pctText(n) } : null}
          info="Of the enrollments open at any point in the range, the share finished by its end"
        />
        <KpiTile
          label="Finished on time"
          value={pctText(k.onTimeRate.value)}
          hint={k.onTimeRate.whole ? `${fmt(k.onTimeRate.part)} of ${fmt(k.onTimeRate.whole)} completions by the due date` : 'No completions in this range'}
          delta={k.onTimeRate.value != null && k.onTimeRate.prev != null ? { now: k.onTimeRate.value, prev: k.onTimeRate.prev, unit: 'points', period, format: n => pctText(n) } : null}
        />
        <KpiTile
          label={data.range.id === 'custom' ? 'Overdue at range end' : 'Overdue now'}
          value={fmt(k.overdue.value)}
          tone={k.overdue.value ? 'text-tone-danger' : undefined}
          hint="Past due and not finished"
          delta={{ now: k.overdue.value, prev: k.overdue.prev, better: 'down', period: `at the end of ${period}` }}
          to={data.range.id === 'custom' ? undefined : '/enrollments?due=overdue'}
        />
        <KpiTile
          label="Average quiz score"
          value={pctText(k.averageScore.value)}
          hint={k.averageScore.attempts ? `Across ${fmt(k.averageScore.attempts)} quiz attempts` : 'No quiz attempts in this range'}
          delta={k.averageScore.value != null && k.averageScore.prev != null ? { now: k.averageScore.value, prev: k.averageScore.prev, unit: 'points', period, format: n => pctText(n) } : null}
        />
      </div>
    </div>
  );
}

function CategoryPanel({ data, className }: { data: Reports; className?: string }) {
  const ws = useWorkspace();
  const rows = data.categories.map(c => ({ ...c, category: c.categoryId ? ws.categoryById.get(c.categoryId) : undefined, rate: c.enrolled ? (c.completed / c.enrolled) * 100 : 0 }));
  const table = <DataTable caption="Completion by category" headers={['Category', 'Open', 'Completed', 'Rate', 'Overdue']} align={['left', 'right', 'right', 'right', 'right']} rows={rows.map(r => [r.category?.name ?? 'No category', fmt(r.enrolled), fmt(r.completed), pctText(r.rate), fmt(r.overdue)])} />;
  return (
    <Panel id="categories" title="Completion by category" description="Enrollments open during the range, and the share finished." className={className} table={rows.length ? table : undefined}>
      {!rows.length ? (
        <PanelEmpty className="h-[200px]" title="No enrollments open in this range" />
      ) : (
        <ul className="-mt-1" aria-label="Completion by category">
          {rows.map(r => (
            <li key={r.categoryId ?? 'none'}>
              <Tip label={`${r.category?.name ?? 'No category'}: ${fmt(r.completed)} of ${fmt(r.enrolled)} finished${r.overdue ? ` · ${fmt(r.overdue)} overdue` : ''}`} side="top">
                <div tabIndex={0} className="grid h-11 grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-3 rounded outline-none focus-visible:bg-accent/60 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-center text-[14px] leading-none" aria-hidden>
                      {r.category?.icon || '•'}
                    </span>
                    <span className="min-w-0">
                      <span className={cn('block truncate text-[13.5px] leading-4', !r.category && 'text-muted-foreground')}>{r.category?.name ?? 'No category'}</span>
                      <span className="flex gap-1.5 whitespace-nowrap text-2xs leading-4 tabular-nums text-muted-foreground">
                        {fmt(r.completed)} of {fmt(r.enrolled)}
                        {r.overdue > 0 && <span className="text-tone-danger">· {fmt(r.overdue)} overdue</span>}
                      </span>
                    </span>
                  </span>
                  <HBar value={r.rate} max={100} color={slot(0)} track label={pctText(r.rate)} />
                </div>
              </Tip>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

type CourseSort = 'enrolled' | 'completionRate' | 'overdueRate' | 'averageScore' | 'averageRating' | 'title';

function SortHeader({ label, k, sort, dir, onSort, align = 'right', className }: { label: string; k: CourseSort; sort: CourseSort; dir: 'asc' | 'desc'; onSort: (k: CourseSort) => void; align?: 'left' | 'right'; className?: string }) {
  const active = sort === k;
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('h-9 whitespace-nowrap border-b px-3 text-sm font-medium text-muted-foreground', align === 'right' ? 'text-right' : 'text-left', className)}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 rounded hover:text-foreground', align === 'right' && 'flex-row-reverse', active && 'text-foreground')}>
        {label}
        {active ? dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <span className="w-3" />}
      </button>
    </th>
  );
}

export function TopCoursesPanel({ data, search, className }: { data: Reports; search: string; className?: string }) {
  const ws = useWorkspace();
  const [sort, setSort] = useState<CourseSort>('enrolled');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const rows = useMemo(() => {
    const list = data.courses.map(c => ({ ...c, course: ws.courseById.get(c.courseId), title: ws.courseById.get(c.courseId)?.title ?? 'Deleted course' }));
    const val = (r: (typeof list)[number]) => (sort === 'title' ? r.title.toLowerCase() : r[sort] ?? -1);
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : (x as number) - (y as number);
      return dir === 'asc' ? c : -c;
    });
  }, [data.courses, ws.courseById, sort, dir]);
  const onSort = (k: CourseSort) => {
    if (k === sort) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      setDir(k === 'title' || k === 'overdueRate' ? 'asc' : 'desc');
    }
  };
  const td = 'h-10 whitespace-nowrap border-b px-3 tabular-nums';
  return (
    <Panel id="courses" title="Top courses" description="The ten courses with the most enrollments open in the range. Select one for its full report." className={className} bodyClassName="px-0 pb-1 pt-2">
      {!rows.length ? (
        <PanelEmpty className="h-[160px]" title="No enrollments open in this range" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[14px] [&>tbody>tr:last-child>td]:border-b-0">
            <caption className="sr-only">Top courses</caption>
            <thead>
              <tr>
                <SortHeader label="Course" k="title" sort={sort} dir={dir} onSort={onSort} align="left" className="pl-4" />
                <SortHeader label="Open" k="enrolled" sort={sort} dir={dir} onSort={onSort} />
                <SortHeader label="Completion" k="completionRate" sort={sort} dir={dir} onSort={onSort} align="left" className="w-[210px] pl-5" />
                <SortHeader label="Overdue" k="overdueRate" sort={sort} dir={dir} onSort={onSort} />
                <SortHeader label="Avg score" k="averageScore" sort={sort} dir={dir} onSort={onSort} />
                <SortHeader label="Rating" k="averageRating" sort={sort} dir={dir} onSort={onSort} className="pr-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.courseId} className="group hover:bg-accent/40">
                  <td className={cn(td, 'max-w-[300px] pl-4')}>
                    <Link to={reportLink('courses', search, { course: r.courseId })} className="flex min-w-0 items-center gap-2 hover:underline">
                      <CourseGlyph icon={r.course?.icon} color={r.course?.color} size={18} />
                      <span className="truncate">{r.title}</span>
                    </Link>
                  </td>
                  <td className={cn(td, 'text-right')}>{fmt(r.enrolled)}</td>
                  <td className={td}>
                    <Tip label={`${fmt(r.completed)} of ${fmt(r.enrolled)} finished`}>
                      <div className="w-[176px] pl-2">
                        <HBar value={r.completionRate ?? 0} max={100} color={slot(0)} track label={pctText(r.completionRate)} />
                      </div>
                    </Tip>
                  </td>
                  <td className={cn(td, 'text-right')}>{r.overdue ? <span className="text-tone-danger">{fmt(r.overdue)} · {pctText(r.overdueRate)}</span> : <span className="text-muted-foreground/60">0</span>}</td>
                  <td className={cn(td, 'text-right')}>{pctText(r.averageScore)}</td>
                  <td className={cn(td, 'pr-4 text-right')}>
                    {r.averageRating != null ? (
                      <Tip label={`${r.averageRating} out of 5 from ${fmt(r.ratings)} ${r.ratings === 1 ? 'rating' : 'ratings'}`}>
                        <span className="inline-flex items-center gap-1.5">
                          <Stars value={r.averageRating} size={11} />
                          <span className="text-sm text-muted-foreground">{r.averageRating.toFixed(1)}</span>
                        </span>
                      </Tip>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function GroupsPanel({ data, className }: { data: Reports; className?: string }) {
  const ws = useWorkspace();
  const order = new Map(ws.groups.map((g, i) => [g.id, i]));
  const rows = data.groups
    .map(g => ({ ...g, group: ws.groupById.get(g.groupId) }))
    .filter(g => g.group)
    .sort((a, b) => (order.get(a.groupId) ?? 0) - (order.get(b.groupId) ?? 0));
  const table = (
    <DataTable
      caption="Groups compared"
      headers={['Group', 'Members', 'Completion', 'Overdue', 'Active', 'Avg score']}
      align={['left', 'right', 'right', 'right', 'right', 'right']}
      rows={rows.map(r => [r.group!.name, fmt(r.members), pctText(r.completionRate), pctText(r.overdueRate), pctText(r.activeRate), pctText(r.averageScore)])}
    />
  );
  return (
    <Panel
      id="groups"
      title="Groups compared"
      description="People in several groups count in each."
      className={className}
      table={rows.length ? table : undefined}
      actions={
        rows.length > 0 && (
          <div className="flex items-center gap-3">
            <LegendKey color={slot(0)} label="Completed" />
            <LegendKey color={DANGER} label="Overdue" />
          </div>
        )
      }
      bodyClassName="px-0 pb-2 pt-2"
    >
      {!rows.length ? (
        <PanelEmpty
          className="h-[180px]"
          title="No groups to compare"
          description="Groups show up here once they have members."
          action={
            <Link to="/groups" className="text-[14px] font-medium text-primary hover:underline">
              Go to groups
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[14px] [&>tbody>tr:last-child>td]:border-b-0">
            <caption className="sr-only">Groups compared</caption>
            <thead>
              <tr className="text-left text-sm text-muted-foreground">
                <th scope="col" className="h-9 border-b px-3 pl-4 font-medium">Group</th>
                <th scope="col" className="h-9 w-[28%] border-b px-3 font-medium">Completion</th>
                <th scope="col" className="h-9 w-[22%] border-b px-3 font-medium">Overdue</th>
                <th scope="col" className="h-9 border-b px-3 text-right font-medium">Active</th>
                <th scope="col" className="h-9 border-b px-3 pr-4 text-right font-medium">Avg score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.groupId} className="hover:bg-accent/40">
                  <td className="h-11 max-w-[220px] border-b px-3 pl-4">
                    <Link to={`/groups/${r.groupId}`} className="flex min-w-0 items-center gap-2 hover:underline">
                      <LabelDot color={r.group!.color} />
                      <span className="truncate">{r.group!.name}</span>
                    </Link>
                    <span className="ml-4 block text-2xs text-muted-foreground">{fmt(r.members)} {r.members === 1 ? 'member' : 'members'}</span>
                  </td>
                  <td className="h-11 border-b px-3">
                    <Tip label={`${fmt(r.completed)} of ${fmt(r.enrolled)} open enrollments finished`}>
                      <div>
                        <HBar value={r.completionRate ?? 0} max={100} color={slot(0)} track label={pctText(r.completionRate)} />
                      </div>
                    </Tip>
                  </td>
                  <td className="h-11 border-b px-3">
                    <Tip label={`${fmt(r.overdue)} of ${fmt(r.enrolled)} open enrollments overdue`}>
                      <div>
                        <HBar value={r.overdueRate ?? 0} max={100} color={DANGER} track label={pctText(r.overdueRate)} />
                      </div>
                    </Tip>
                  </td>
                  <td className="h-11 border-b px-3 text-right tabular-nums">
                    <Tip label={`${fmt(r.active)} of ${fmt(r.members)} members learned in this range`}>
                      <span>{pctText(r.activeRate)}</span>
                    </Tip>
                  </td>
                  <td className="h-11 border-b px-3 pr-4 text-right tabular-nums">{pctText(r.averageScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function LeadersPanel({ data, className, title = 'Top learners' }: { data: Reports; className?: string; title?: string }) {
  const leaders = data.leaders;
  const max = Math.max(1, ...leaders.map(l => l.points));
  return (
    <Panel id="leaders" title={title} description="Points earned in the range: 10 a lesson, 50 a course, 150 a path, 20 a quiz pass, 10 more for a perfect score." className={className} bodyClassName="px-2 pb-2 pt-2">
      {!leaders.length ? (
        <PanelEmpty className="h-[200px]" title="No points earned in this range" />
      ) : (
        <ol className="space-y-px" aria-label={title}>
          {leaders.map((l, i) => (
            <li key={l.personId}>
              <Tip
                side="left"
                label={
                  <span className="block">
                    {[`${fmt(l.lessons)} ${l.lessons === 1 ? 'lesson' : 'lessons'}`, `${fmt(l.courses)} ${l.courses === 1 ? 'course' : 'courses'}`, l.paths ? `${fmt(l.paths)} ${l.paths === 1 ? 'path' : 'paths'}` : null, `${fmt(l.quizPasses)} ${l.quizPasses === 1 ? 'quiz' : 'quizzes'} passed`, l.perfectQuizzes ? `${fmt(l.perfectQuizzes)} perfect` : null].filter(Boolean).join(' · ')}
                  </span>
                }
              >
                <Link to={`/people/${l.personId}`} className="grid h-9 grid-cols-[1.25rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-md px-2 hover:bg-accent/60">
                  <span className={cn('text-right text-sm tabular-nums', i < 3 ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{i + 1}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <PersonAvatar person={{ name: l.name, color: l.color, avatarUrl: l.avatarUrl }} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] leading-4">{l.name}</span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-flame/80" style={{ width: `${(l.points / max) * 100}%` }} />
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center justify-end gap-1 text-[13.5px] font-medium tabular-nums">
                    <Flame className="h-3 w-3 text-flame" aria-hidden />
                    {fmt(l.points)}
                  </span>
                </Link>
              </Tip>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** A range where nothing at all happened reads better as one message than a wall of empty panels. */
export function isQuiet(d: Reports) {
  const k = d.kpis;
  return k.activeLearners.value + k.enrollments.value + k.completions.value + k.certificates.value + k.completionRate.whole + k.overdue.value === 0;
}

export function QuietState({ data, onWiden, onClear, filtered, what }: { data: Reports; onWiden?: () => void; onClear?: () => void; filtered: boolean; what?: ReactNode }) {
  const ws = useWorkspace();
  const app = useAppActions();
  // A workspace with no courses at all has nothing to widen to: point at the first step instead.
  if (!ws.courses.length && !filtered) {
    return (
      <div className="rounded-lg border bg-card">
        <EmptyState
          icon={<BarChart3 />}
          title="No training to report on yet"
          description="Reports fill in once you’ve published a course and people start learning."
          action={
            ws.isStaff ? (
              <button type="button" onClick={() => app.openCreateCourse()} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                Create a course
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-card">
      <EmptyState
        icon={<BarChart3 />}
        title={`No learning activity ${data.range.id === 'custom' ? `in ${rangeText(data.range.fromDay, data.range.toDay)}` : 'in this range'}`}
        description={what ?? (filtered ? 'Nobody in these groups or categories enrolled, learned or finished anything in the range.' : 'No one enrolled, learned or finished anything in the range. Reports fill in as people learn.')}
        action={
          <div className="flex items-center gap-4">
            {onWiden && (
              <button type="button" onClick={onWiden} className="text-[14px] font-medium text-primary hover:underline">
                Show the last 12 months
              </button>
            )}
            {filtered && onClear && (
              <button type="button" onClick={onClear} className="text-[14px] text-muted-foreground hover:text-foreground">
                Clear filters
              </button>
            )}
          </div>
        }
      />
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <KpiSkeleton count={5} className="grid-cols-2 lg:grid-cols-5" />
        <KpiSkeleton count={4} className="grid-cols-2 lg:grid-cols-4" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <PanelSkeleton title="Learning activity" className="xl:col-span-2" height={236} />
        <PanelSkeleton title="Completion by category" height={236} />
      </div>
      <PanelSkeleton title="Top courses" height={200} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <PanelSkeleton title="Groups compared" className="xl:col-span-2" height={220} />
        <PanelSkeleton title="Top learners" height={220} />
      </div>
    </div>
  );
}

export function OverviewTab({ data, search, onWiden, onClear, filtered }: { data: Reports; search: string; onWiden: () => void; onClear: () => void; filtered: boolean }) {
  return (
    <div className="space-y-4">
      <OverviewKpis data={data} />
      {isQuiet(data) ? (
        <QuietState data={data} onWiden={data.range.id !== '12m' ? onWiden : undefined} onClear={onClear} filtered={filtered} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <TrendsChart data={data} className="xl:col-span-2" />
            <CategoryPanel data={data} />
          </div>
          <TopCoursesPanel data={data} search={search} />
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <GroupsPanel data={data} className="xl:col-span-2" />
            <LeadersPanel data={data} />
          </div>
        </>
      )}
    </div>
  );
}
