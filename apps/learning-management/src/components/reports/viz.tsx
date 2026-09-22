import { ArrowDownRight, ArrowUpRight, BarChart3, Minus, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { IconButton, Tip } from '../primitives/bits';

/**
 * Chart colour, validated with the dataviz palette checks (lightness band,
 * chroma, adjacent CVD separation, normal-vision floor, contrast) against the
 * card surface in each theme — warm paper, and warm charcoal in dark — and
 * re-stepped for dark rather than flipped. Light matches the app's --chart-*
 * tokens.
 *
 *   --viz-1…5  categorical, fixed order (slot 1 is a slate blue; the app's ink is too dark to chart)
 *   --viz-other  "everything else" / de-emphasised marks
 *
 * Slots 3–5 are under 3:1 on white, so every chart that uses them also has
 * visible labels or a table view. Status meaning (overdue, expired) uses the
 * app's tone tokens, never a series slot.
 */
export const VIZ_STYLE = `
.lms-viz {
  --viz-1: #3d6fa8; --viz-2: #eb6733; --viz-3: #1cb07c; --viz-4: #eba000; --viz-5: #e87da6;
  --viz-other: #a8a29e;
  --viz-heat: 212 47% 45%;
}
html.dark .lms-viz {
  --viz-1: #6f9bd1; --viz-2: #d95926; --viz-3: #199f70; --viz-4: #c78500; --viz-5: #d55382;
  --viz-other: #625d57;
  --viz-heat: 213 52% 63%;
}`;

export const slot = (i: number) => (i >= 0 && i < 5 ? `var(--viz-${i + 1})` : 'var(--viz-other)');
export const OTHER = 'var(--viz-other)';
export const DANGER = 'rgb(var(--tone-danger))';

export const AXIS_TICK = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 };
export const GRID_STROKE = 'hsl(var(--border))';

export const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
export const pctText = (n: number | null | undefined, digits = 0) => (n == null ? '—' : `${digits ? (Math.round(n * 10 ** digits) / 10 ** digits).toLocaleString() : Math.round(n).toLocaleString()}%`);
export const hoursText = (h: number | null | undefined) => (h == null ? '—' : `${(Math.round(h * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`);
export const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

/** Round axis ticks from zero: 0 / 10 / 20 / 30, never 0 / 9 / 18 / 27 / 36. */
export function niceTicks(max: number, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/** Props for a count axis with round ticks — spread onto recharts' YAxis, which must stay a direct chart child. */
export function countAxis(max: number, count = 4) {
  const ticks = niceTicks(max, count);
  return { allowDecimals: false, tickLine: false, axisLine: false, tick: AXIS_TICK, width: 40, ticks, domain: [0, ticks[ticks.length - 1]] as [number, number], tickFormatter: (n: number) => n.toLocaleString() };
}

export function daysText(d: number | null | undefined) {
  if (d == null) return '—';
  if (d < 1) return `${Math.max(1, Math.round(d * 24))} h`;
  return `${(Math.round(d * 10) / 10).toLocaleString()} ${Math.round(d * 10) / 10 === 1 ? 'day' : 'days'}`;
}

// ── Panels ────────────────────────────────────────────────────────────────

/**
 * A report card: title, a one-line explanation, short actions (a legend, a
 * median) beside the title, an optional toolbar row under it for controls too
 * wide to sit there, and (optionally) a table twin of the chart. The table
 * toggle always sits top-right, so it's in the same place on every panel.
 */
export function Panel({ title, description, actions, toolbar, table, children, className, bodyClassName, id }: { id?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; toolbar?: ReactNode; table?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  const [asTable, setAsTable] = useState(false);
  const label = typeof title === 'string' ? title : 'this panel';
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className={cn('flex min-w-0 flex-col rounded-lg border bg-card', className)}>
      <header className="flex items-start gap-x-4 px-4 pt-3.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
          <div className="min-w-[min(100%,14rem)] flex-1">
            <h2 id={id ? `${id}-title` : undefined} className="text-[14px] font-medium leading-5">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{actions}</div>}
        </div>
        {table && (
          <Tip label={asTable ? 'Show as chart' : 'Show as table'}>
            <IconButton size="sm" className="-mr-1.5 -mt-0.5 shrink-0" aria-pressed={asTable} aria-label={asTable ? `Show ${label} as a chart` : `Show ${label} as a table`} onClick={() => setAsTable(v => !v)}>
              {asTable ? <BarChart3 /> : <Table2 />}
            </IconButton>
          </Tip>
        )}
      </header>
      {toolbar && !asTable && <div className="flex min-w-0 flex-wrap items-center gap-1 px-4 pt-2.5">{toolbar}</div>}
      <div className={cn('min-w-0 flex-1 px-4 pb-4 pt-3', bodyClassName)}>{asTable && table ? <div className="animate-fade-in">{table}</div> : children}</div>
    </section>
  );
}

/** A regular tick interval for a category axis: every label, every other, every third… so gaps never look random. */
export function tickInterval(count: number, maxLabels: number) {
  return Math.max(0, Math.ceil(count / Math.max(1, maxLabels)) - 1);
}

export function PanelSkeleton({ title, description, className, height = 200 }: { title: string; description?: string; className?: string; height?: number }) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-lg border bg-card', className)} aria-busy>
      <header className="px-4 pt-3.5">
        <h2 className="text-[14px] font-medium leading-5">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </header>
      <div className="px-4 pb-4 pt-3">
        <div className="flex flex-col justify-between" style={{ height }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton h-2.5 w-20" />
              <div className="skeleton h-2.5" style={{ width: `${25 + ((i * 29) % 55)}%` }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** A quiet in-card empty message; a full EmptyState would outweigh the card it sits in. */
export function PanelEmpty({ title, description, className, action }: { title: string; description?: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-4 py-8 text-center', className)}>
      <p className="text-[14px] font-medium">{title}</p>
      {description && <p className="mt-0.5 max-w-xs text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** A legend entry: squares key filled marks, lines key lines. */
export function LegendKey({ color, label, kind = 'square', className }: { color: string; label: ReactNode; kind?: 'square' | 'line'; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-muted-foreground', className)}>
      {kind === 'line' ? <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden /> : <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden />}
      {label}
    </span>
  );
}

export function TooltipShell({ title, subtitle, children }: { title?: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-[168px] max-w-[280px] rounded-md border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-md">
      {title && <div className="font-medium">{title}</div>}
      {subtitle && <div className="text-2xs text-muted-foreground">{subtitle}</div>}
      {children && <div className={cn('space-y-0.5', (title || subtitle) && 'mt-1.5')}>{children}</div>}
    </div>
  );
}

/** Values lead in a tooltip; the series name is secondary and keyed with a short stroke. */
export function TooltipRow({ color, label, value, strong }: { color?: string; label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {color ? <span className="h-0.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden /> : <span className="w-2.5 shrink-0" aria-hidden />}
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('ml-auto pl-4 tabular-nums', strong ? 'font-semibold' : 'font-medium')}>{value}</span>
    </div>
  );
}

/** A plain data table, the accessible twin of a chart. */
export function DataTable({ headers, rows, align, caption, footer }: { headers: string[]; rows: ReactNode[][]; align?: Array<'left' | 'right'>; caption?: string; footer?: ReactNode[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[320px] border-separate border-spacing-0 text-[13.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="text-left text-sm text-muted-foreground">
            {headers.map((h, i) => (
              <th key={h} scope="col" className={cn('h-9 whitespace-nowrap border-b px-2 font-medium first:pl-0 last:pr-0', align?.[i] === 'right' && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="hover:bg-accent/40">
              {r.map((c, ci) => (
                <td key={ci} className={cn('h-9 whitespace-nowrap border-b px-2 tabular-nums first:pl-0 last:pr-0', align?.[ci] === 'right' && 'text-right')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="font-medium">
              {footer.map((c, ci) => (
                <td key={ci} className={cn('h-9 whitespace-nowrap px-2 tabular-nums first:pl-0 last:pr-0', align?.[ci] === 'right' && 'text-right')}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** A horizontal bar on a shared scale: rounded data end, square at the baseline, a direct label beside it. */
export function HBar({ value, max, color, label, className, track = false, labelClassName }: { value: number; max: number; color: string; label?: ReactNode; className?: string; track?: boolean; labelClassName?: string }) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div className={cn('relative h-2.5 min-w-0 flex-1', track && 'rounded-r-[4px] bg-muted')}>
        <div className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500" style={{ width: `${w * 100}%`, minWidth: value > 0 ? 2 : 0, background: color }} />
      </div>
      {label != null && <span className={cn('w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground', labelClassName)}>{label}</span>}
    </div>
  );
}

// ── KPI tiles ─────────────────────────────────────────────────────────────

export type DeltaSpec = { now: number | null; prev: number | null; unit?: 'percent' | 'points'; better?: 'up' | 'down' | 'neutral'; period: string; format?: (n: number) => string };

/** A change against the equal period before: green and red only where "up" has a clear meaning. */
export function DeltaBadge({ now, prev, unit = 'percent', better = 'up', period, format }: DeltaSpec) {
  // Nothing now and nothing before isn't a change worth a badge.
  if (now == null || prev == null || (now === 0 && prev === 0)) return null;
  const diff = now - prev;
  const flat = unit === 'points' ? Math.abs(diff) < 0.5 : prev !== 0 && Math.abs(diff / prev) < 0.005;
  if (flat) {
    return (
      <Tip label={`Same as ${period} (${format ? format(prev) : prev.toLocaleString()})`}>
        <span tabIndex={0} className="inline-flex items-center gap-0.5 rounded text-2xs font-medium text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <Minus className="h-3 w-3" aria-hidden /> No change
        </span>
      </Tip>
    );
  }
  const up = diff > 0;
  const good = better === 'neutral' ? null : up === (better === 'up');
  // Past +500%, a multiple reads better than a wall of digits ("12×", not "1,100%").
  const ratio = prev > 0 ? now / prev : 0;
  const text = unit === 'points' ? `${Math.abs(Math.round(diff * 10) / 10).toLocaleString()} pts` : prev === 0 ? 'New' : ratio >= 6 ? `${ratio < 10 ? Math.round(ratio * 10) / 10 : Math.round(ratio).toLocaleString()}×` : `${Math.abs(Math.round((diff / prev) * 100)).toLocaleString()}%`;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <Tip label={`${up ? 'Up' : 'Down'} from ${format ? format(prev) : prev.toLocaleString()} in ${period}`}>
      <span tabIndex={0} className={cn('inline-flex items-center gap-0.5 rounded text-2xs font-medium tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring', good === true ? 'text-tone-success' : good === false ? 'text-tone-danger' : 'text-muted-foreground')}>
        <Icon className="h-3 w-3" aria-hidden />
        {text}
        <span className="sr-only"> compared with {period}</span>
      </span>
    </Tip>
  );
}

export function KpiTile({ label, value, hint, delta, to, tone, info }: { label: string; value: ReactNode; hint?: ReactNode; delta?: DeltaSpec | null; to?: string; tone?: string; info?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1 truncate text-sm text-muted-foreground" title={info}>
        {label}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className={cn('text-[22px] font-semibold leading-7 tracking-tight', tone)}>{value}</span>
        {delta && <DeltaBadge {...delta} />}
      </div>
      <div className="mt-0.5 min-h-4 truncate text-2xs text-muted-foreground">{hint}</div>
    </>
  );
  return to ? (
    <Link to={to} className="block min-w-0 bg-card px-4 py-3 transition-colors hover:bg-accent/40">
      {body}
    </Link>
  ) : (
    <div className="min-w-0 bg-card px-4 py-3">{body}</div>
  );
}

export function KpiSkeleton({ count, className }: { count: number; className?: string }) {
  return (
    <div className={cn('grid gap-px overflow-hidden rounded-lg border bg-border', className)} aria-busy>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card px-4 py-3">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton mt-2.5 h-5 w-14" />
          <div className="skeleton mt-2 h-2.5 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Vertical bar tooltip body used by the small distribution charts. */
export function CountTooltip({ active, payload, title, noun }: { active?: boolean; payload?: Array<{ payload: { label: string; count: number } }>; title?: (label: string) => string; noun: [string, string] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TooltipShell title={title ? title(row.label) : row.label}>
      <TooltipRow label={row.count === 1 ? noun[0] : noun[1]} value={fmt(row.count)} strong />
    </TooltipShell>
  );
}
