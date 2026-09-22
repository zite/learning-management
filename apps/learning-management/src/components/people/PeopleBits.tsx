import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { plural, shortDate, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { LabelDot, Tip } from '../primitives/bits';

/** Only staff roles get a badge — "Learner" is the default and would be noise on every row. */
export function RoleBadge({ role, className, always }: { role: string; className?: string; always?: boolean }) {
  if (role !== 'Admin' && role !== 'Instructor' && !always) return null;
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-2xs font-medium', role === 'Admin' ? 'border-primary/25 bg-primary/[0.07] text-primary' : role === 'Instructor' ? 'border-tone-accent/25 bg-tone-accent/[0.08] text-tone-accent' : 'text-muted-foreground', className)}>
      {role}
    </span>
  );
}

export function PersonStatusPill({ status, className }: { status: string; className?: string }) {
  if (status !== 'Invited' && status !== 'Deactivated') return null;
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-2xs font-medium', status === 'Invited' ? 'bg-tone-warning/[0.12] text-tone-warning' : 'bg-muted text-muted-foreground', className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', status === 'Invited' ? 'bg-tone-warning' : 'bg-muted-foreground/60')} />
      {status}
    </span>
  );
}

/**
 * The column layout people lists share (People, a group's members). Headers
 * and rows use the same classes so every label sits over its values.
 */
export const PEOPLE_COL = {
  groups: 'hidden w-[236px] shrink-0 items-center xl:flex',
  manager: 'hidden w-[148px] shrink-0 items-center lg:flex',
  open: 'hidden w-[44px] shrink-0 items-center justify-end sm:flex',
  overdue: 'hidden w-[60px] shrink-0 items-center justify-end sm:flex',
  completed: 'hidden w-[72px] shrink-0 items-center justify-end sm:flex',
  added: 'hidden w-[84px] shrink-0 items-center justify-end md:flex',
  lastActive: 'flex w-[68px] shrink-0 items-center justify-end',
} as const;

export const TRAINING_HINT = {
  open: 'Assigned and not finished yet',
  overdue: 'Past the due date and not finished',
  completed: 'Courses completed',
} as const;

/** Open · overdue · completed as three aligned numbers. Zero is faint; only overdue gets colour. */
export function TrainingCells({ active, overdue, completed, name }: { active: number; overdue: number; completed: number; name?: string }) {
  const who = name ? `${name.split(' ')[0]}: ` : '';
  const cell = (value: number, cls: string, tip: string, colCls: string) => (
    <span className={colCls}>
      <Tip label={`${who}${tip}`}>
        <span className={cn('text-sm tabular-nums', value ? cls : 'text-muted-foreground/40')}>{value}</span>
      </Tip>
    </span>
  );
  return (
    <>
      {cell(active, 'text-foreground/80', `${plural(active, 'enrollment')} open`, PEOPLE_COL.open)}
      {cell(overdue, 'font-medium text-tone-danger', overdue ? `${overdue} overdue` : 'Nothing overdue', PEOPLE_COL.overdue)}
      {cell(completed, 'text-foreground/80', `${plural(completed, 'course')} completed`, PEOPLE_COL.completed)}
    </>
  );
}

/** Rough width of a group chip in characters: the name plus its dot and padding. */
const chipChars = (name: string) => name.length + 4;

/**
 * As many whole group chips as fit the column (by a character budget, so it
 * doesn't need to measure), then "+N" with the rest in a tooltip. The first
 * chip always shows, truncated if it must be.
 */
export function GroupChips({ ids, budget = 36, className }: { ids: string[]; budget?: number; className?: string }) {
  const ws = useWorkspace();
  const groups = ids.map(id => ws.groupById.get(id)).filter(Boolean) as Array<NonNullable<ReturnType<typeof ws.groupById.get>>>;
  if (!groups.length) return <span className={cn('text-sm text-muted-foreground/40', className)}>—</span>;
  const shown = [groups[0]];
  let used = chipChars(groups[0].name);
  for (const g of groups.slice(1)) {
    const reserve = groups.length - shown.length - 1 > 0 ? 4 : 0;
    if (used + chipChars(g.name) + reserve > budget) break;
    shown.push(g);
    used += chipChars(g.name);
  }
  const rest = groups.slice(shown.length);
  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      {shown.map(g => (
        <span key={g.id} className="chip h-[22px] min-w-0 shrink bg-background px-1.5" title={g.name}>
          <LabelDot color={g.color} />
          <span className="truncate">{g.name}</span>
        </span>
      ))}
      {rest.length > 0 && (
        <Tip label={rest.map(g => g.name).join(', ')}>
          <span className="chip h-[22px] shrink-0 bg-background px-1.5 tabular-nums text-muted-foreground">+{rest.length}</span>
        </Tip>
      )}
    </span>
  );
}

export function LastActive({ iso, className }: { iso: string | null; className?: string }) {
  if (!iso) return <span className={cn('text-sm text-muted-foreground/50', className)}>Never</span>;
  return (
    <Tip label={`Last active ${shortDate(iso)}`}>
      <span className={cn('whitespace-nowrap text-sm tabular-nums text-muted-foreground', className)}>{timeAgo(iso).replace(' ago', '').replace('just now', 'now')}</span>
    </Tip>
  );
}

export function SelectBox({ checked, onToggle, visible, label }: { checked: boolean; onToggle: (e: React.MouseEvent) => void; visible: boolean; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={e => {
        e.stopPropagation();
        onToggle(e);
      }}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-opacity',
        checked ? 'border-primary bg-primary text-primary-foreground opacity-100' : 'border-input bg-background',
        !checked && (visible ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100'),
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  );
}

/** One cell of a stat strip: label over number, the same structure in every cell. */
export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: string; hint?: string }) {
  const body = (
    <div className="min-w-0 bg-card px-3.5 py-2.5">
      <div className="truncate text-sm text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 truncate text-[18px] font-semibold leading-6 tabular-nums tracking-[-0.01em]', tone)}>{value}</div>
    </div>
  );
  return hint ? <Tip label={hint}>{body}</Tip> : body;
}

export const btnPrimary = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50';
export const btnSecondary = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50';
export const btnGhost = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50';
export const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-2.5 text-[14px] outline-none transition-shadow placeholder:text-muted-foreground focus:border-ring/60 focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground';
