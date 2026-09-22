import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@project/components/lib/utils';
import { SOURCE_LABEL } from '../../lib/constants';
import { timeAgo } from '../../lib/format';
import { PersonAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { LeadersPanel, QuietState, isQuiet } from './OverviewTab';
import { periodLabel, type Reports } from './params';
import { AXIS_TICK, countAxis, CountTooltip, DataTable, GRID_STROKE, KpiSkeleton, KpiTile, LegendKey, OTHER, Panel, PanelEmpty, PanelSkeleton, fmt, pct, pctText, slot } from './viz';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOUR_LABEL = (h: number) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`);
const SHORT_HOUR = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

function ActiveDaysPanel({ data, className }: { data: Reports; className?: string }) {
  const rows = data.engagement.activeDays.map(r => ({ label: r.label, count: r.people }));
  const total = rows.reduce((s, r) => s + r.count, 0);
  const active = total - (rows[0]?.count ?? 0);
  const table = <DataTable caption="People by active days" headers={['Active days', 'People', 'Share']} align={['left', 'right', 'right']} rows={rows.map(r => [r.label, fmt(r.count), pctText(pct(r.count, total))])} footer={['Everyone in scope', fmt(total), '100%']} />;
  return (
    <Panel
      id="active-days"
      title="How often people learn"
      description="Everyone in scope, by the number of days they started or finished a lesson."
      className={className}
      table={total ? table : undefined}
      actions={total > 0 && <span className="text-sm text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{pctText(pct(active, total))}</span> learned at least once</span>}
    >
      {!total ? (
        <PanelEmpty className="h-[220px]" title="Nobody in scope yet" />
      ) : (
        <div onMouseDown={e => e.preventDefault()} role="figure" aria-label={`Bar chart of people by active days. ${rows.map(r => `${r.label}: ${r.count}`).join(', ')}.`}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rows} margin={{ top: 18, right: 4, bottom: 0, left: -18 }} barCategoryGap="24%">
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID_STROKE }} tick={AXIS_TICK} tickMargin={8} interval={0} />
              <YAxis {...countAxis(Math.max(0, ...rows.map(r => r.count)))} />
              <Tooltip cursor={{ fill: 'hsl(var(--accent))', opacity: 0.6 }} content={<CountTooltip noun={['person', 'people']} title={l => (l === 'No activity' ? 'No activity in the range' : `Active on ${l}`)} />} isAnimationActive={false} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                {rows.map((r, i) => (
                  <Cell key={r.label} fill={i === 0 ? OTHER : slot(0)} />
                ))}
                <LabelList dataKey="count" position="top" offset={6} className="fill-muted-foreground text-[12px] tabular-nums" formatter={(v: number) => (v ? v.toLocaleString() : '')} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function HeatmapPanel({ data, className }: { data: Reports; className?: string }) {
  const [hover, setHover] = useState<{ dow: number; hour: number } | null>(null);
  const grid = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const c of data.engagement.heatmap) if (c.dow >= 1 && c.dow <= 7 && c.hour >= 0 && c.hour < 24) g[c.dow - 1][c.hour] += c.count;
    return g;
  }, [data.engagement.heatmap]);
  const max = Math.max(0, ...grid.flat());
  const total = grid.flat().reduce((s, n) => s + n, 0);
  const peak = useMemo(() => {
    let best = { dow: 0, hour: 0, count: -1 };
    grid.forEach((row, d) => row.forEach((n, h) => n > best.count && (best = { dow: d, hour: h, count: n })));
    return best;
  }, [grid]);
  // Five steps of one hue; zero stays on the track so "nothing" reads as nothing.
  const step = (n: number) => (n <= 0 || !max ? 0 : Math.min(5, Math.ceil((n / max) * 5)));
  const fill = (s: number) => (s === 0 ? 'hsl(var(--muted))' : `hsl(var(--viz-heat) / ${[0, 0.2, 0.38, 0.56, 0.78, 1][s]})`);
  const byDay = grid.map((row, d) => ({ day: DAYS[d], total: row.reduce((s, n) => s + n, 0) }));
  const table = <DataTable caption="Lesson completions by weekday" headers={['Day', 'Completions', 'Busiest hour']} align={['left', 'right', 'left']} rows={byDay.map((r, d) => [r.day, fmt(r.total), r.total ? HOUR_LABEL(grid[d].indexOf(Math.max(...grid[d]))) : '—'])} />;
  const hovered = hover ? grid[hover.dow][hover.hour] : null;

  return (
    <Panel
      id="heatmap"
      title="When people learn"
      description={`Lesson completions by weekday and hour, in ${data.range.timeZone.replace(/_/g, ' ')} time.`}
      className={className}
      table={total ? table : undefined}
      actions={
        total > 0 && (
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {hover ? (
              <>
                {DAYS[hover.dow]}s, {HOUR_LABEL(hover.hour)}: <span className="font-medium tabular-nums text-foreground">{fmt(hovered)}</span>
              </>
            ) : (
              <>
                Busiest: <span className="font-medium text-foreground">{DAYS[peak.dow]}s around {HOUR_LABEL(peak.hour)}</span>
              </>
            )}
          </span>
        )
      }
    >
      {!total ? (
        <PanelEmpty className="h-[220px]" title="No lessons completed in this range" />
      ) : (
        <>
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <div className="min-w-[560px]" onMouseLeave={() => setHover(null)} role="grid" aria-label="Lesson completions by weekday and hour">
              <div className="grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[2px]" role="row">
                <span />
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} className="text-center text-[11px] leading-4 text-muted-foreground" role="columnheader" aria-label={HOUR_LABEL(h)}>
                    {h % 3 === 0 ? SHORT_HOUR(h) : ''}
                  </span>
                ))}
              </div>
              {grid.map((row, d) => (
                <div key={d} className="mt-[2px] grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[2px]" role="row">
                  <span className="pr-1 text-right text-[12px] leading-6 text-muted-foreground" role="rowheader">
                    {DAYS[d].slice(0, 3)}
                  </span>
                  {row.map((n, h) => (
                    <Tip key={h} label={`${DAYS[d]}s, ${HOUR_LABEL(h)}–${HOUR_LABEL((h + 1) % 24)}: ${fmt(n)} ${n === 1 ? 'lesson' : 'lessons'} completed`} side="top">
                      <span
                        role="gridcell"
                        tabIndex={-1}
                        aria-label={`${DAYS[d]} ${HOUR_LABEL(h)}: ${n}`}
                        onMouseEnter={() => setHover({ dow: d, hour: h })}
                        className={cn('block h-6 rounded-[3px] transition-shadow', hover?.dow === d && hover.hour === h && 'ring-2 ring-foreground/30')}
                        style={{ background: fill(step(n)) }}
                      />
                    </Tip>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-1.5 text-2xs text-muted-foreground" aria-hidden>
            Fewer
            {[0, 1, 2, 3, 4, 5].map(s => (
              <span key={s} className="h-2.5 w-3.5 rounded-[2px]" style={{ background: fill(s) }} />
            ))}
            More
          </div>
        </>
      )}
    </Panel>
  );
}

const SOURCES = ['Assigned', 'Automatic', 'Path', 'Self-enrolled'] as const;

function SourcesPanel({ data, className }: { data: Reports; className?: string }) {
  const counts = new Map(data.engagement.sources.map(s => [s.source, s.count]));
  const rows = SOURCES.map((s, i) => ({ source: s, label: SOURCE_LABEL[s] ?? s, count: counts.get(s) ?? 0, color: slot(i) }));
  const total = rows.reduce((s, r) => s + r.count, 0);
  const self = counts.get('Self-enrolled') ?? 0;
  const table = <DataTable caption="How people were enrolled" headers={['Enrolled via', 'Enrollments', 'Share']} align={['left', 'right', 'right']} rows={rows.map(r => [r.label, fmt(r.count), pctText(pct(r.count, total))])} footer={['Total', fmt(total), '100%']} />;
  return (
    <Panel id="sources" title="Assigned or chosen" description="New enrollments in the range, by how they were created." className={className} table={total ? table : undefined}>
      {!total ? (
        <PanelEmpty className="h-[140px]" title="No new enrollments in this range" />
      ) : (
        <div>
          <p className="text-[14px]">
            <span className="text-[22px] font-semibold tracking-tight">{pctText(pct(self, total))}</span> <span className="text-muted-foreground">chose a course themselves</span>
          </p>
          <div className="mt-3 flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={rows.map(r => `${r.label} ${pctText(pct(r.count, total))}`).join(', ')}>
            {rows
              .filter(r => r.count > 0)
              .map(r => (
                <Tip key={r.source} label={`${r.label}: ${fmt(r.count)} (${pctText(pct(r.count, total))})`}>
                  <span className="h-full min-w-[3px] transition-[width] duration-500" style={{ width: `${(r.count / total) * 100}%`, background: r.color }} />
                </Tip>
              ))}
          </div>
          <ul className="mt-3 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {rows.map(r => (
              <li key={r.source} className="flex items-center justify-between gap-2">
                <LegendKey color={r.color} label={r.label} />
                <span className="text-sm tabular-nums">
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

function InactivePanel({ data, className }: { data: Reports; className?: string }) {
  const [all, setAll] = useState(false);
  const { count, people } = data.engagement.inactive;
  const total = data.engagement.people;
  const shown = all ? people : people.slice(0, 8);
  return (
    <Panel
      id="inactive"
      title="Haven’t learned in 30 days"
      description="As of today, people in scope with no lesson started or finished for 30 days or more. Those with overdue work first."
      className={className}
      bodyClassName="px-2 pb-2 pt-2"
      actions={
        total > 0 && (
          <span className="text-sm text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">{fmt(count)}</span> of {fmt(total)} · {pctText(pct(count, total))}
          </span>
        )
      }
    >
      {!count ? (
        <PanelEmpty className="h-[140px]" title="Everyone has learned in the last 30 days" />
      ) : (
        <>
          <ul className="space-y-px">
            {shown.map(p => (
              <li key={p.id}>
                <Link to={`/people/${p.id}`} className="flex h-9 items-center gap-2.5 rounded-md px-2 text-[14px] hover:bg-accent/60">
                  <PersonAvatar person={p} size={20} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.overdue > 0 ? (
                    <span className="shrink-0 text-sm text-tone-danger">{fmt(p.overdue)} overdue</span>
                  ) : p.open > 0 ? (
                    <span className="shrink-0 text-sm text-muted-foreground">{fmt(p.open)} open</span>
                  ) : null}
                  <span className="w-20 shrink-0 text-right text-sm text-muted-foreground">{p.lastLearnedAt ? timeAgo(p.lastLearnedAt) : 'Never'}</span>
                </Link>
              </li>
            ))}
          </ul>
          {people.length > 8 && (
            <button type="button" onClick={() => setAll(v => !v)} className="mt-1 flex h-9 w-full items-center justify-center gap-1 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
              {all ? 'Show fewer' : `Show all ${fmt(people.length)}`}
              <ChevronDown className={cn('h-3 w-3 transition-transform', all && 'rotate-180')} />
            </button>
          )}
          {count > people.length && <p className="px-2 pt-1 text-2xs text-muted-foreground">Showing the {fmt(people.length)} most urgent. Export learners for everyone.</p>}
        </>
      )}
    </Panel>
  );
}

export function EngagementSkeleton() {
  return (
    <div className="space-y-4">
      <KpiSkeleton count={4} className="grid-cols-2 lg:grid-cols-4" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PanelSkeleton title="How often people learn" height={220} />
        <PanelSkeleton title="When people learn" height={220} />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <div className="grid grid-cols-1 gap-4 xl:col-span-2">
          <PanelSkeleton title="Assigned or chosen" height={120} />
          <PanelSkeleton title="Haven’t learned in 30 days" height={120} />
        </div>
        <PanelSkeleton title="Points leaderboard" height={300} />
      </div>
    </div>
  );
}

export function EngagementTab({ data, onWiden, onClear, filtered }: { data: Reports; onWiden: () => void; onClear: () => void; filtered: boolean }) {
  const e = data.engagement;
  const k = data.kpis;
  const period = periodLabel(data.range);
  const activeDays = e.activeDays.slice(1).reduce((s, r) => s + r.people, 0);
  const regulars = e.activeDays.slice(3).reduce((s, r) => s + r.people, 0);
  const selfEnrolled = e.sources.find(s => s.source === 'Self-enrolled')?.count ?? 0;
  const newEnrollments = e.sources.reduce((s, r) => s + r.count, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4" role="list" aria-label="Engagement numbers">
        <KpiTile label="Active learners" value={fmt(k.activeLearners.value)} hint={e.people ? `${pctText(pct(activeDays, e.people))} of ${fmt(e.people)} ${e.people === 1 ? 'person' : 'people'} in scope` : 'Nobody in scope'} delta={{ now: k.activeLearners.value, prev: k.activeLearners.prev, period }} />
        <KpiTile label="Learned on 4+ days" value={fmt(regulars)} hint={e.people ? `${pctText(pct(regulars, e.people))} of people in scope` : '—'} />
        <KpiTile label="Inactive 30+ days" value={fmt(e.inactive.count)} hint={e.people ? `${pctText(pct(e.inactive.count, e.people))} of people in scope` : '—'} />
        <KpiTile label="Self-enrolled" value={pctText(pct(selfEnrolled, newEnrollments))} hint={newEnrollments ? `${fmt(selfEnrolled)} of ${fmt(newEnrollments)} new enrollments` : 'No new enrollments in this range'} />
      </div>
      {isQuiet(data) ? (
        <QuietState data={data} onWiden={data.range.id !== '12m' ? onWiden : undefined} onClear={onClear} filtered={filtered} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ActiveDaysPanel data={data} />
            <HeatmapPanel data={data} />
          </div>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <div className="grid min-w-0 grid-cols-1 gap-4 xl:col-span-2">
              <SourcesPanel data={data} />
              <InactivePanel data={data} />
            </div>
            <LeadersPanel data={data} title="Points leaderboard" />
          </div>
        </>
      )}
    </div>
  );
}
