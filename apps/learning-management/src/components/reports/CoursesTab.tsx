import { ArrowDownRight, ArrowRight, BookOpen, ExternalLink, Hourglass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { formatDuration } from '../../lib/format';
import { EmptyState, Tip } from '../primitives/bits';
import { CourseGlyph, LessonTypeIcon, Stars } from '../primitives/icons';
import { bucketLabel, type CourseReport } from './params';
import { AXIS_TICK, countAxis, CountTooltip, DataTable, GRID_STROKE, KpiSkeleton, KpiTile, LegendKey, OTHER, Panel, PanelEmpty, PanelSkeleton, TooltipRow, TooltipShell, daysText, fmt, pct, pctText, slot, tickInterval } from './viz';

function FunnelPanel({ data }: { data: CourseReport }) {
  const cohort = data.kpis.enrolled;
  const steps = data.funnel;
  const required = steps.filter(s => !s.optional);
  const last = required[required.length - 1];
  const worst = required.reduce<(typeof steps)[number] | null>((w, s) => (s.dropOff != null && s.dropOff > 0 && (!w || (s.dropOff ?? 0) > (w.dropOff ?? 0)) ? s : w), null);
  const table = (
    <DataTable
      caption="Lesson funnel"
      headers={['#', 'Lesson', 'Reached', 'Completed', 'Of enrolled', 'Avg time', 'Drop-off']}
      align={['right', 'left', 'right', 'right', 'right', 'right', 'right']}
      rows={steps.map((s, i) => [i + 1, `${s.title}${s.optional ? ' (optional)' : ''}`, fmt(s.reached), fmt(s.completed), pctText(pct(s.completed, cohort)), s.averageSeconds ? formatDuration(s.averageSeconds) : '—', s.dropOff == null ? '—' : pctText(s.dropOff, 1)])}
    />
  );
  return (
    <Panel
      id="funnel"
      title="Lesson funnel"
      description="Of the enrollments open in the range, how many reached and finished each lesson, in outline order. Drop-off compares each required lesson with the step before it."
      table={steps.length && cohort ? table : undefined}
      actions={
        steps.length > 0 &&
        cohort > 0 && (
          <div className="flex items-center gap-3">
            <LegendKey color={slot(0)} label="Completed" />
            <LegendKey color="hsl(var(--viz-heat) / 0.25)" label="Reached, not finished" />
          </div>
        )
      }
      bodyClassName="px-2 pb-2 pt-2"
    >
      {!steps.length ? (
        <PanelEmpty className="h-[160px]" title="This course has no lessons yet" />
      ) : !cohort ? (
        <PanelEmpty className="h-[160px]" title="No enrollments open in this range" description="Try a longer range." />
      ) : (
        <>
          <div className="grid h-8 grid-cols-[1.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 border-b px-2 text-sm text-muted-foreground sm:grid-cols-[1.5rem_minmax(0,14rem)_minmax(0,1fr)_4.5rem_4rem_4.5rem]" aria-hidden>
            <span className="text-right">#</span>
            <span>Lesson</span>
            <span className="hidden sm:block">Share of enrolled</span>
            <span className="text-right">Completed</span>
            <span className="hidden text-right sm:block">Avg time</span>
            <span className="hidden text-right sm:block">Drop-off</span>
          </div>
          <ol className="mt-1 space-y-px" aria-label="Lesson funnel">
            <li className="grid h-9 grid-cols-[1.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 px-2 sm:grid-cols-[1.5rem_minmax(0,14rem)_minmax(0,1fr)_4.5rem_4rem_4.5rem]">
              <span />
              <span className="truncate text-[13.5px] font-medium">Enrolled</span>
              <span className="hidden h-4 rounded-r-[4px] sm:block" style={{ background: slot(0) }} />
              <span className="text-right text-[13.5px] font-medium tabular-nums">{fmt(cohort)}</span>
              <span className="hidden sm:block" />
              <span className="hidden sm:block" />
            </li>
            {steps.map((s, i) => {
              const reached = pct(s.reached, cohort) ?? 0;
              const done = pct(s.completed, cohort) ?? 0;
              const heavy = s.dropOff != null && s.dropOff >= 15;
              return (
                <li key={s.lessonId}>
                  <Tip side="top" label={`${s.title}: ${fmt(s.reached)} reached, ${fmt(s.completed)} completed (${pctText(done)} of enrolled)${s.averageSeconds ? ` · ${formatDuration(s.averageSeconds)} on average` : ''}${s.dropOff ? ` · ${pctText(s.dropOff, 1)} fewer than the lesson before` : ''}`}>
                    <div tabIndex={0} className={cn('grid min-h-9 grid-cols-[1.5rem_minmax(0,1fr)_3.5rem] items-center gap-x-2 gap-y-1 rounded-md px-2 py-1 outline-none hover:bg-accent/40 focus-visible:bg-accent/60 sm:grid-cols-[1.5rem_minmax(0,14rem)_minmax(0,1fr)_4.5rem_4rem_4.5rem] sm:py-0', s.optional && 'opacity-70')}>
                      <span className="text-right text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
                        <LessonTypeIcon type={s.type} />
                        <span className="truncate">{s.title}</span>
                        {s.optional && <span className="shrink-0 text-2xs text-muted-foreground">Optional</span>}
                      </span>
                      <span className="relative order-last col-span-3 h-4 sm:order-none sm:col-span-1">
                        <span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${reached}%`, background: 'hsl(var(--viz-heat) / 0.25)' }} />
                        <span className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500" style={{ width: `${done}%`, minWidth: s.completed ? 2 : 0, background: slot(0) }} />
                      </span>
                      <span className="text-right text-[13.5px] tabular-nums">
                        {fmt(s.completed)} <span className="text-2xs text-muted-foreground">{pctText(done)}</span>
                      </span>
                      <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">{s.averageSeconds ? formatDuration(s.averageSeconds) : '—'}</span>
                      <span className={cn('hidden items-center justify-end gap-0.5 text-sm tabular-nums sm:flex', heavy ? 'font-medium text-tone-danger' : 'text-muted-foreground')}>
                        {s.dropOff == null ? '' : s.dropOff === 0 ? '0%' : (
                          <>
                            <ArrowDownRight className="h-3 w-3" aria-hidden />
                            {pctText(s.dropOff, 1)}
                          </>
                        )}
                      </span>
                    </div>
                  </Tip>
                </li>
              );
            })}
          </ol>
          <p className="px-2 pt-2 text-2xs text-muted-foreground">
            {last ? `${pctText(pct(last.completed, cohort))} of enrollments finished the last required lesson.` : ''}
            {worst && worst.dropOff && worst.dropOff >= 5 ? ` The biggest drop is at “${worst.title}” (${pctText(worst.dropOff, 1)}).` : ''}
          </p>
        </>
      )}
    </Panel>
  );
}

/** "1–2 weeks" → "1–2 wk": the axis stays legible in a third of the page; the tooltip and table keep the words. */
const shortDuration = (label: string) => label.replace(/(\d\+?) days?$/, '$1d').replace(/(\d\+?) weeks?$/, '$1 wk').replace(/(\d\+?) months?$/, '$1 mo');

function DurationPanel({ data, className }: { data: CourseReport; className?: string }) {
  const rows = data.durations;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const table = <DataTable caption="Time to complete" headers={['Time from enrollment', 'Completions']} align={['left', 'right']} rows={rows.map(r => [r.label, fmt(r.count)])} footer={['Total', fmt(total)]} />;
  return (
    <Panel id="durations" title="Time to complete" description="Completions in the range, by time from enrollment to finishing." className={className} table={total ? table : undefined} actions={data.kpis.medianDays != null && <span className="text-sm text-muted-foreground">Median <span className="font-medium text-foreground">{daysText(data.kpis.medianDays)}</span></span>}>
      {!total ? (
        <PanelEmpty className="h-[200px]" title="No completions in this range" />
      ) : (
        <div onMouseDown={e => e.preventDefault()} role="figure" aria-label={`Histogram of time to complete: ${rows.map(r => `${r.label} ${r.count}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows} margin={{ top: 18, right: 4, bottom: 0, left: -18 }} barCategoryGap="18%">
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID_STROKE }} tick={AXIS_TICK} tickMargin={8} interval={0} height={28} tickFormatter={shortDuration} />
              <YAxis {...countAxis(Math.max(0, ...rows.map(r => r.count)))} />
              <Tooltip cursor={{ fill: 'hsl(var(--accent))', opacity: 0.6 }} content={<CountTooltip noun={['completion', 'completions']} title={l => `Finished in ${l.toLowerCase()}`} />} isAnimationActive={false} />
              <Bar dataKey="count" fill={slot(0)} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
                <LabelList dataKey="count" position="top" offset={6} className="fill-muted-foreground text-[12px] tabular-nums" formatter={(v: number) => (v ? v.toLocaleString() : '')} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function TrendPanel({ data, className }: { data: CourseReport; className?: string }) {
  const unit = data.range.bucket;
  const total = data.trend.reduce((s, r) => s + r.completions + r.enrollments, 0);
  const table = <DataTable caption="Enrollments and completions" headers={[unit === 'month' ? 'Month' : unit === 'week' ? 'Week of' : 'Day', 'Enrollments', 'Completions']} align={['left', 'right', 'right']} rows={data.trend.map(r => [bucketLabel(r.bucket, unit, unit !== 'week'), fmt(r.enrollments), fmt(r.completions)])} />;
  return (
    <Panel
      id="course-trend"
      title="Enrollments and completions"
      description={`Per ${unit} across the range.`}
      className={className}
      table={total ? table : undefined}
      actions={
        total > 0 && (
          <div className="flex items-center gap-3">
            <LegendKey color={OTHER} label="Enrollments" />
            <LegendKey color={slot(0)} label="Completions" />
          </div>
        )
      }
    >
      {!total ? (
        <PanelEmpty className="h-[200px]" title="No enrollments or completions in this range" />
      ) : (
        <div onMouseDown={e => e.preventDefault()} role="figure" aria-label="Bar chart of enrollments and completions per period. Use the table view for every value.">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.trend} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barGap={2} barCategoryGap="24%">
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="bucket" tickLine={false} axisLine={{ stroke: GRID_STROKE }} tick={AXIS_TICK} tickMargin={8} interval={tickInterval(data.trend.length, unit === 'month' ? 6 : 5)} tickFormatter={(b: string) => bucketLabel(b, unit)} />
              <YAxis {...countAxis(Math.max(0, ...data.trend.map(r => Math.max(r.enrollments, r.completions))))} />
              <Tooltip
                cursor={{ fill: 'hsl(var(--accent))', opacity: 0.6 }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as CourseReport['trend'][number] | undefined;
                  if (!active || !row) return null;
                  return (
                    <TooltipShell title={bucketLabel(row.bucket, unit, true)} subtitle={row.partial ? `Partial ${unit}` : undefined}>
                      <TooltipRow color={OTHER} label="Enrollments" value={fmt(row.enrollments)} />
                      <TooltipRow color={slot(0)} label="Completions" value={fmt(row.completions)} />
                    </TooltipShell>
                  );
                }}
              />
              <Bar dataKey="enrollments" fill={OTHER} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="completions" fill={slot(0)} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function GradesPanel({ data, className }: { data: CourseReport; className?: string }) {
  const g = data.grades;
  const passing = g.passingGrade;
  const color = (min: number) => (passing == null || min >= passing ? slot(0) : OTHER);
  const table = <DataTable caption="Assignment grades" headers={['Grade', 'Submissions']} align={['left', 'right']} rows={g.buckets.map(b => [b.label, fmt(b.count)])} footer={['Graded', fmt(g.graded)]} />;
  return (
    <Panel
      id="grades"
      title="Assignment grades"
      description={passing != null ? `Graded in the range. Passing grade ${passing}.` : 'Graded in the range.'}
      className={className}
      table={g.graded ? table : undefined}
      actions={g.graded > 0 && <span className="text-sm text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{pctText(g.passRate)}</span> passed · avg {fmt(g.average)}</span>}
    >
      {!g.hasAssignments ? (
        <PanelEmpty className="h-[200px]" title="This course has no assignments" />
      ) : !g.graded ? (
        <PanelEmpty className="h-[200px]" title="Nothing graded in this range" description={g.waiting ? `${fmt(g.waiting)} ${g.waiting === 1 ? 'submission is' : 'submissions are'} waiting to be graded.` : undefined} action={g.waiting ? <Link to="/grading" className="text-[14px] font-medium text-primary hover:underline">Open grading</Link> : undefined} />
      ) : (
        <>
          <div onMouseDown={e => e.preventDefault()} role="figure" aria-label={`Grade distribution: ${g.buckets.map(b => `${b.label} ${b.count}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height={176}>
              <BarChart data={g.buckets} margin={{ top: 18, right: 4, bottom: 0, left: -18 }} barCategoryGap="20%">
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID_STROKE }} tick={AXIS_TICK} tickMargin={8} interval={0} />
                <YAxis {...countAxis(Math.max(0, ...g.buckets.map(r => r.count)))} />
                <Tooltip cursor={{ fill: 'hsl(var(--accent))', opacity: 0.6 }} content={<CountTooltip noun={['submission', 'submissions']} title={l => `Graded ${l}`} />} isAnimationActive={false} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
                  {g.buckets.map(b => (
                    <Cell key={b.label} fill={color(b.min)} />
                  ))}
                  <LabelList dataKey="count" position="top" offset={6} className="fill-muted-foreground text-[12px] tabular-nums" formatter={(v: number) => (v ? v.toLocaleString() : '')} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {passing != null && <LegendKey color={slot(0)} label={`${passing} and above`} />}
            {passing != null && <LegendKey color={OTHER} label="Below passing" />}
            {g.waiting > 0 && (
              <Link to="/grading" className="ml-auto text-sm text-muted-foreground hover:text-foreground">
                {fmt(g.waiting)} waiting to be graded →
              </Link>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function RatingsPanel({ data, className }: { data: CourseReport; className?: string }) {
  const total = data.ratings.reduce((s, r) => s + r.count, 0);
  const max = Math.max(1, ...data.ratings.map(r => r.count));
  const table = <DataTable caption="Ratings" headers={['Stars', 'Ratings', 'Share']} align={['left', 'right', 'right']} rows={data.ratings.map(r => [`${r.stars} ${r.stars === 1 ? 'star' : 'stars'}`, fmt(r.count), pctText(pct(r.count, total))])} footer={['Total', fmt(total), '100%']} />;
  return (
    <Panel id="ratings" title="Ratings" description="How learners rated the course, from enrollments open in the range." className={className} table={total ? table : undefined}>
      {!total ? (
        <PanelEmpty className="h-[200px]" title="No ratings yet in this range" />
      ) : (
        <div>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-[22px] font-semibold tracking-tight">{data.kpis.averageRating?.toFixed(1) ?? '—'}</span>
            <Stars value={data.kpis.averageRating} size={13} />
            <span className="text-sm text-muted-foreground">
              from {fmt(total)} {total === 1 ? 'rating' : 'ratings'}
            </span>
          </div>
          <ul className="space-y-1.5" aria-label="Ratings by stars">
            {data.ratings.map(r => (
              <li key={r.stars} className="grid grid-cols-[3rem_minmax(0,1fr)_4.5rem] items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {r.stars} {r.stars === 1 ? 'star' : 'stars'}
                </span>
                <span className="relative h-2.5 rounded-r-[4px] bg-muted">
                  <span className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500" style={{ width: `${(r.count / max) * 100}%`, minWidth: r.count ? 2 : 0, background: slot(0) }} />
                </span>
                <span className="text-right text-sm tabular-nums">
                  {fmt(r.count)} <span className="text-muted-foreground">· {pctText(pct(r.count, total))}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function CourseReportSkeleton() {
  return (
    <div className="space-y-4">
      <KpiSkeleton count={6} className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-6" />
      <PanelSkeleton title="Lesson funnel" height={220} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PanelSkeleton title="Time to complete" height={200} />
        <PanelSkeleton title="Enrollments and completions" height={200} />
      </div>
    </div>
  );
}

export function CoursesTab({ data, stale, onWiden }: { data: CourseReport; stale: boolean; onWiden?: () => void }) {
  const app = useAppActions();
  const k = data.kpis;
  const c = data.course;
  const learners = `/courses/${c.id}/learners`;
  return (
    <div className={cn('space-y-4 transition-opacity', stale && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CourseGlyph icon={c.icon} color={c.color} size={28} />
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-[16px] font-semibold tracking-tight sm:truncate">{c.title}</h2>
          <p className="text-sm text-muted-foreground">
            {c.status !== 'Published' ? `${c.status} · ` : ''}
            {fmt(k.newEnrollments)} new {k.newEnrollments === 1 ? 'enrollment' : 'enrollments'} and {fmt(k.completionsInRange)} {k.completionsInRange === 1 ? 'completion' : 'completions'} in the range
          </p>
        </div>
        <Link to={`/courses/${c.id}`} className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
          <ExternalLink className="h-3.5 w-3.5" /> Open course
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 xl:grid-cols-6" role="list" aria-label="Course numbers">
        <KpiTile label="Open enrollments" value={fmt(k.enrolled)} hint="Open during the range" />
        <KpiTile label="Completion rate" value={pctText(k.completionRate)} hint={k.enrolled ? `${fmt(k.completed)} of ${fmt(k.enrolled)} finished` : 'Nothing open in this range'} />
        <KpiTile label="Overdue" value={fmt(k.overdue)} tone={k.overdue ? 'text-tone-danger' : undefined} hint={data.range.id === 'custom' ? 'At the end of the range' : 'Right now'} to={k.overdue && data.range.id !== 'custom' ? `${learners}?due=overdue` : undefined} />
        <KpiTile label="Median time to finish" value={daysText(k.medianDays)} hint="Enrollment to completion" />
        <KpiTile label="Average quiz score" value={pctText(k.averageScore)} hint="Across open enrollments" />
        <KpiTile label="Average rating" value={k.averageRating != null ? k.averageRating.toFixed(1) : '—'} hint={k.ratings ? `${fmt(k.ratings)} ${k.ratings === 1 ? 'rating' : 'ratings'}` : 'No ratings yet'} />
      </div>

      {k.stuck > 0 && (
        <Link to={`${learners}?stalled=1`} className="group flex items-center gap-2.5 rounded-lg border bg-card px-4 py-2.5 text-[14px] hover:bg-accent/40">
          <Hourglass className="h-3.5 w-3.5 text-tone-warning" />
          <span>
            <span className="font-medium">
              {fmt(k.stuck)} {k.stuck === 1 ? 'learner is' : 'learners are'} stuck
            </span>{' '}
            <span className="text-muted-foreground">— in progress with no activity for 14 days or more</span>
          </span>
          <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      {k.enrolled + k.newEnrollments + k.completionsInRange + data.grades.graded + k.ratings === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={<BookOpen />}
            title={c.status === 'Draft' ? `${c.title} is still a draft` : 'Nobody was learning this course in the range'}
            description={c.status === 'Draft' ? 'Publish it to start enrolling people — its funnel, grades and ratings will show up here.' : 'No enrollments were open, started or finished. Try a longer range, or enroll people.'}
            action={
              <div className="flex items-center gap-4">
                {data.range.id !== '12m' && onWiden && (
                  <button type="button" onClick={onWiden} className="text-[14px] font-medium text-primary hover:underline">
                    Show the last 12 months
                  </button>
                )}
                {c.status === 'Published' && (
                  <button type="button" onClick={() => app.openEnroll({ targetType: 'Course', targetId: c.id })} className="text-[14px] text-muted-foreground hover:text-foreground">
                    Enroll people
                  </button>
                )}
                {c.status === 'Draft' && (
                  <Link to={`/courses/${c.id}/settings`} className="text-[14px] font-medium text-primary hover:underline">
                    Open course settings
                  </Link>
                )}
              </div>
            }
          />
        </div>
      ) : (
        <>
          <FunnelPanel data={data} />
          {data.grades.hasAssignments ? (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <DurationPanel data={data} />
                <TrendPanel data={data} />
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <GradesPanel data={data} />
                <RatingsPanel data={data} />
              </div>
            </>
          ) : (
            // No assignments means no grades panel, so the rest share one row instead of leaving a hole.
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              <DurationPanel data={data} />
              <TrendPanel data={data} />
              <RatingsPanel data={data} className="lg:col-span-2 xl:col-span-1" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function NoCourses() {
  return <EmptyState icon={<BookOpen />} title="No courses to report on yet" description="Course reports appear once you've created a course and enrolled people." action={<Link to="/courses" className="text-[14px] font-medium text-primary hover:underline">Go to courses</Link>} />;
}
