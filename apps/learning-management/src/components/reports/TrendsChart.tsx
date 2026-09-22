import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@project/components/lib/utils';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { bucketLabel, type Reports } from './params';
import { AXIS_TICK, DataTable, GRID_STROKE, Panel, PanelEmpty, TooltipRow, TooltipShell, fmt, hoursText, niceTicks, slot, tickInterval } from './viz';

type SeriesKey = 'completions' | 'enrollments' | 'activeLearners' | 'hours';
type Row = Reports['trends'][number];

/** Colour follows the series, never its position in the current selection. */
const SERIES: Array<{ key: SeriesKey; label: string; color: string; unit: 'count' | 'hours' }> = [
  { key: 'completions', label: 'Completions', color: slot(0), unit: 'count' },
  { key: 'enrollments', label: 'Enrollments', color: slot(1), unit: 'count' },
  { key: 'activeLearners', label: 'Active learners', color: slot(2), unit: 'count' },
  { key: 'hours', label: 'Learning hours', color: slot(3), unit: 'hours' },
];

function TrendTooltip({ active, payload, keys, unit }: { active?: boolean; payload?: Array<{ payload: Row }>; keys: SeriesKey[]; unit: Reports['range']['bucket'] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TooltipShell title={bucketLabel(row.bucket, unit, true)} subtitle={row.partial ? `Partial ${unit} — only the days inside the range count` : undefined}>
      {SERIES.filter(s => keys.includes(s.key)).map(s => (
        <TooltipRow key={s.key} color={s.color} label={s.label} value={s.unit === 'hours' ? hoursText(row.hours) : fmt(row[s.key])} />
      ))}
    </TooltipShell>
  );
}

/**
 * Learning activity over the range. Counts share one axis; hours have their
 * own scale, so when both are on they're drawn as two charts on a shared
 * timeline rather than a dual-axis chart.
 */
export function TrendsChart({ data, className }: { data: Reports; className?: string }) {
  const [on, setOn] = useState<SeriesKey[]>(['completions', 'enrollments']);
  const unit = data.range.bucket;
  const rows = data.trends;
  const totals: Record<SeriesKey, string> = {
    completions: fmt(data.kpis.completions.value),
    enrollments: fmt(data.kpis.enrollments.value),
    activeLearners: fmt(data.kpis.activeLearners.value),
    hours: hoursText(data.kpis.learningHours.value),
  };
  const countKeys: SeriesKey[] = on.filter(k => k !== 'hours');
  const showHours = on.includes('hours');
  const empty = useMemo(() => rows.every(r => on.every(k => !r[k])), [rows, on]);
  const onlyLabel = on.length === 1 ? SERIES.find(s => s.key === on[0])!.label.toLowerCase() : null;
  const wide = useMediaQuery('(min-width: 768px)');
  const ticks = { dataKey: 'bucket', tickLine: false, axisLine: { stroke: GRID_STROKE }, tick: AXIS_TICK, tickMargin: 8, interval: tickInterval(rows.length, unit === 'month' ? (wide ? 13 : 6) : wide ? 9 : 4), tickFormatter: (b: string) => bucketLabel(b, unit) };
  const dots = rows.length <= 8;
  const countTicks = niceTicks(Math.max(0, ...rows.flatMap(r => countKeys.map(k => Number(r[k]) || 0))), showHours ? 3 : 4);
  const hourTicks = niceTicks(Math.max(0, ...rows.map(r => r.hours)), countKeys.length ? 2 : 4);

  const toggle = (k: SeriesKey) => setOn(prev => (prev.includes(k) ? (prev.length > 1 ? prev.filter(x => x !== k) : prev) : [...prev, k]));

  const table = (
    <DataTable
      caption="Learning activity by period"
      headers={[unit === 'month' ? 'Month' : unit === 'week' ? 'Week of' : 'Day', 'Completions', 'Enrollments', 'Active learners', 'Learning hours']}
      align={['left', 'right', 'right', 'right', 'right']}
      rows={rows.map(r => [`${bucketLabel(r.bucket, unit, unit !== 'week')}${r.partial ? ' (partial)' : ''}`, fmt(r.completions), fmt(r.enrollments), fmt(r.activeLearners), hoursText(r.hours)])}
    />
  );

  return (
    <Panel
      id="trends"
      title="Learning activity"
      description={`Per ${unit} across the range. Toggle a measure to compare.`}
      className={className}
      table={table}
      toolbar={
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Measures">
          {SERIES.map(s => {
            const active = on.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(s.key)}
                className={cn('flex h-6 items-center gap-1.5 rounded-md border px-1.5 text-sm transition-colors', active ? 'border-border bg-background text-foreground shadow-2xs' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground')}
              >
                <span className={cn('h-0.5 w-2.5 rounded-full transition-opacity', !active && 'opacity-40')} style={{ background: s.color }} aria-hidden />
                {s.label}
                <span className="tabular-nums text-muted-foreground">{totals[s.key]}</span>
              </button>
            );
          })}
        </div>
      }
    >
      {empty ? (
        <PanelEmpty className="h-[236px]" title={onlyLabel ? `No ${onlyLabel} in this range` : 'No learning activity in this range'} description="Try a longer range, or clear the filters." />
      ) : (
        <div onMouseDown={e => e.preventDefault()} role="figure" aria-label={`Line chart of ${on.map(k => SERIES.find(s => s.key === k)!.label.toLowerCase()).join(', ')} per ${unit}. Use the table view for every value.`}>
          {countKeys.length > 0 && (
            <ResponsiveContainer width="100%" height={showHours ? 180 : 272}>
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} syncId="report-trends">
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis {...ticks} hide={showHours} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} width={40} ticks={countTicks} domain={[0, countTicks[countTicks.length - 1]]} tickFormatter={(n: number) => n.toLocaleString()} />
                <Tooltip cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.35 }} content={<TrendTooltip keys={on} unit={unit} />} isAnimationActive={false} />
                {SERIES.filter(s => countKeys.includes(s.key)).map(s => (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dot={dots ? { r: 3, strokeWidth: 0, fill: s.color } : false} activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'hsl(var(--card))', fill: s.color }} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
          {showHours && (
            <div className={cn(countKeys.length > 0 && 'mt-2 border-t pt-2')}>
              {countKeys.length > 0 && <div className="mb-1 text-2xs font-medium text-muted-foreground">Learning hours</div>}
              <ResponsiveContainer width="100%" height={countKeys.length ? 120 : 272}>
                <AreaChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -8 }} syncId="report-trends">
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                  <XAxis {...ticks} />
                  <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={40} ticks={hourTicks} domain={[0, hourTicks[hourTicks.length - 1]]} tickFormatter={(h: number) => `${h.toLocaleString()}h`} />
                  <Tooltip cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.35 }} content={<TrendTooltip keys={on} unit={unit} />} isAnimationActive={false} />
                  <Area type="monotone" dataKey="hours" name="Learning hours" stroke={slot(3)} strokeWidth={2} fill={slot(3)} fillOpacity={0.1} dot={false} activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'hsl(var(--card))', fill: slot(3) }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
