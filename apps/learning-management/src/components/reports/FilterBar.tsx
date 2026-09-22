import { format } from 'date-fns';
import { CalendarRange, ChevronDown, FolderTree, UsersRound, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@project/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { cn } from '@project/components/lib/utils';
import { parseDay, toDayString } from '../../lib/format';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useWorkspace } from '../../lib/workspace';
import { OptionPicker, type Option } from '../pickers/OptionPicker';
import { GroupPicker } from '../pickers/pickers';
import { LabelDot, Tip } from '../primitives/bits';
import { RANGES, rangeText, type ReportParams } from './params';

export const chipClass = (active: boolean) =>
  cn(
    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[13.5px] shadow-2xs transition-colors hover:bg-accent data-[state=open]:bg-accent',
    active ? 'border-border bg-background text-foreground' : 'border-dashed bg-transparent text-muted-foreground hover:text-foreground',
  );

/** Last 30 / 90 days / 12 months, or a custom span of whole days. */
export function RangeControl({ params, update }: { params: ReportParams; update: (p: Partial<ReportParams>) => void }) {
  const [open, setOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 640px)');
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const custom = params.range === 'custom' && params.from && params.to;
  const ids = [...RANGES.map(r => r.id), 'custom'] as const;
  const group = useRef<HTMLDivElement>(null);
  /** Arrow keys move the selection and the focus together, as a radio group should. */
  const focusRadio = (id: string) => group.current?.querySelector<HTMLButtonElement>(`[data-range="${id}"]`)?.focus();

  const openCustom = (next: boolean) => {
    setOpen(next);
    if (next) setDraft(custom ? { from: parseDay(params.from!), to: parseDay(params.to!) } : undefined);
  };

  return (
    <div ref={group} role="radiogroup" aria-label="Date range" className="flex h-8 shrink-0 items-center rounded-md border bg-background p-0.5 shadow-2xs">
      {RANGES.map(r => {
        const on = params.range === r.id;
        return (
          <Tip key={r.id} label={r.label}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={r.label}
              data-range={r.id}
              tabIndex={on || (!custom && !RANGES.some(x => x.id === params.range) && r.id === '90d') ? 0 : -1}
              onClick={() => update({ range: r.id, from: null, to: null })}
              onKeyDown={e => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const i = ids.indexOf(r.id);
                const next = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
                if (next === 'custom') {
                  focusRadio('custom');
                  openCustom(true);
                } else {
                  update({ range: next, from: null, to: null });
                  focusRadio(next);
                }
              }}
              className={cn('h-[22px] rounded-[4px] px-2 text-sm tabular-nums transition-colors', on ? 'bg-accent font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}
            >
              {r.short}
            </button>
          </Tip>
        );
      })}
      <Popover open={open} onOpenChange={openCustom}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="radio"
            data-range="custom"
            tabIndex={custom ? 0 : -1}
            onKeyDown={e => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const next = e.key === 'ArrowRight' ? RANGES[0].id : RANGES[RANGES.length - 1].id;
              update({ range: next, from: null, to: null });
              focusRadio(next);
            }}
            aria-checked={Boolean(custom)}
            aria-label={custom ? `Custom range, ${rangeText(params.from!, params.to!)}` : 'Custom range'}
            className={cn('flex h-[22px] items-center gap-1 rounded-[4px] px-2 text-sm transition-colors', custom ? 'bg-accent font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}
          >
            <CalendarRange className="h-3 w-3" aria-hidden />
            {custom ? rangeText(params.from!, params.to!) : 'Custom'}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0 shadow-lg">
          <Calendar mode="range" numberOfMonths={wide ? 2 : 1} selected={draft} onSelect={setDraft} defaultMonth={draft?.from ?? new Date(Date.now() - 45 * 86_400_000)} disabled={{ after: new Date() }} initialFocus />
          <div className="flex items-center gap-2 border-t px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{draft?.from ? (draft.to ? rangeText(toDayString(draft.from), toDayString(draft.to)) : `From ${format(draft.from, 'MMM d')} — pick an end date`) : 'Pick a start date'}</span>
            <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-md px-2.5 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft?.from}
              onClick={() => {
                if (!draft?.from) return;
                update({ range: 'custom', from: toDayString(draft.from), to: toDayString(draft.to ?? draft.from) });
                setOpen(false);
              }}
              className="h-8 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ClearButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="-ml-1 flex h-8 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

export function GroupFilter({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const ws = useWorkspace();
  const picked = value.map(id => ws.groupById.get(id)).filter(Boolean);
  const label = !picked.length ? 'Groups' : picked.length === 1 ? picked[0]!.name : `${picked.length} groups`;
  return (
    <span className="inline-flex shrink-0 items-center">
      <GroupPicker
        value={value}
        onChange={onChange}
        trigger={
          <button type="button" className={chipClass(picked.length > 0)} aria-label={picked.length ? `Groups: ${picked.map(g => g!.name).join(', ')}` : 'Filter by group'}>
            {picked.length === 1 ? <LabelDot color={picked[0]!.color} /> : <UsersRound className="h-3.5 w-3.5" />}
            <span className="max-w-[160px] truncate">{label}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        }
      />
      {picked.length > 0 && <ClearButton label="Clear group filter" onClick={() => onChange([])} />}
    </span>
  );
}

export function CategoryFilter({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const ws = useWorkspace();
  const options: Option<string>[] = ws.categories.map(c => ({ value: c.id, label: c.name, icon: <span className="text-[14px] leading-none">{c.icon || '•'}</span> }));
  const picked = value.map(id => ws.categoryById.get(id)).filter(Boolean);
  const label = !picked.length ? 'Categories' : picked.length === 1 ? picked[0]!.name : `${picked.length} categories`;
  if (!ws.categories.length) return null;
  return (
    <span className="inline-flex shrink-0 items-center">
      <OptionPicker
        multiple
        options={options}
        value={value}
        onChange={onChange}
        placeholder="Choose categories…"
        width={240}
        trigger={
          <button type="button" className={chipClass(picked.length > 0)} aria-label={picked.length ? `Categories: ${picked.map(c => c!.name).join(', ')}` : 'Filter by category'}>
            {picked.length === 1 && picked[0]!.icon ? <span className="text-[13px] leading-none">{picked[0]!.icon}</span> : <FolderTree className="h-3.5 w-3.5" />}
            <span className="max-w-[160px] truncate">{label}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        }
      />
      {picked.length > 0 && <ClearButton label="Clear category filter" onClick={() => onChange([])} />}
    </span>
  );
}

/** One row of filters under the header; everything below answers to it. */
export function FilterBar({ children, trailing, className }: { children: ReactNode; trailing?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b bg-background px-3 scrollbar-none', className)}>
      {children}
      {trailing && <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">{trailing}</div>}
    </div>
  );
}
