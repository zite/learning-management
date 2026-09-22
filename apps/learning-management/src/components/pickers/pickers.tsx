import { Check, X } from 'lucide-react';
import { addDays, endOfMonth, endOfWeek, nextMonday } from 'date-fns';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Calendar } from '@project/components/ui/calendar';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@project/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { cn } from '@project/components/lib/utils';
import { parseDay, shortDate, toDayString } from '../../lib/format';
import { usePeopleSearch } from '../../lib/queries';
import type { PersonLite } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { LabelDot } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { OptionPicker, type Option } from './OptionPicker';

type PickerBase<V> = {
  value: V;
  onChange: (value: V) => void;
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
};

/**
 * People, searched on the server as you type — an organization can have
 * thousands, so the directory is never loaded whole. Remembers the people it
 * has shown so chips for picked ids keep their names.
 */
export function PersonPicker({
  value,
  onChange,
  trigger,
  open,
  onOpenChange,
  align = 'start',
  side = 'bottom',
  multiple,
  roles,
  exclude = [],
  placeholder = 'Search people…',
  onPeopleSeen,
  width = 300,
}: PickerBase<string[]> & { multiple?: boolean; roles?: Array<'Admin' | 'Instructor' | 'Learner'>; exclude?: string[]; placeholder?: string; onPeopleSeen?: (people: PersonLite[]) => void; width?: number }) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = (o: boolean) => {
    (onOpenChange ?? setInnerOpen)(o);
    if (!o) setQ('');
  };
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q), 160);
    return () => window.clearTimeout(t);
  }, [q]);
  const { data, isFetching } = usePeopleSearch(debounced, { roles, enabled: isOpen, limit: 40 });
  // Kept in a ref: callers often pass an inline callback, and depending on it would re-run this effect every render.
  const onSeen = useRef(onPeopleSeen);
  onSeen.current = onPeopleSeen;
  useEffect(() => {
    if (data) onSeen.current?.(data.people);
  }, [data]);
  const selected = new Set(value);
  const people = (data?.people ?? []).filter(p => !exclude.includes(p.id));
  // Server-filtered results: keep the first match highlighted so Enter picks it straight away.
  const [active, setActive] = useState('');
  const firstId = people[0]?.id ?? '';
  useEffect(() => {
    setActive(firstId);
  }, [firstId, debounced]);

  const pick = (p: PersonLite) => {
    if (multiple) onChange(selected.has(p.id) ? value.filter(v => v !== p.id) : [...value, p.id]);
    else {
      onChange([p.id]);
      setOpen(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} side={side} className="overflow-hidden p-0 shadow-lg" style={{ width }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <Command shouldFilter={false} loop value={active} onValueChange={setActive}>
          <CommandInput value={q} onValueChange={setQ} placeholder={placeholder} className="h-9 text-[14px]" />
          <CommandList className="max-h-[320px] p-1">
            <CommandEmpty className="py-5 text-center text-sm text-muted-foreground">{isFetching ? 'Searching…' : q ? 'Nobody matches' : 'No people yet'}</CommandEmpty>
            <CommandGroup className="p-0">
              {people.map(p => {
                const on = selected.has(p.id);
                return (
                  <CommandItem key={p.id} value={p.id} onSelect={() => pick(p)} className="h-9 gap-2 rounded-[5px] px-2 text-[14px]">
                    {multiple && (
                      <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                        {on && <Check className="!h-2.5 !w-2.5" strokeWidth={3} />}
                      </span>
                    )}
                    <PersonAvatar person={p} size={18} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate leading-4">{p.name}</span>
                      <span className="block truncate text-2xs leading-4 text-muted-foreground">{p.title || p.email}</span>
                    </span>
                    {p.status !== 'Active' && <span className="shrink-0 text-2xs text-muted-foreground">{p.status}</span>}
                    {!multiple && on && <Check className="!h-3.5 !w-3.5 shrink-0 text-muted-foreground" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Staff (admins and instructors) from bootstrap — owners, instructors, graders. */
export function StaffPicker({ allowNone, multiple, noneLabel = 'Nobody', ...p }: PickerBase<string | null> & { allowNone?: boolean; multiple?: false; noneLabel?: string }) {
  const ws = useWorkspace();
  const options: Option<string | null>[] = [
    ...(allowNone ? [{ value: null, label: noneLabel }] : []),
    ...ws.activeStaff.map(s => ({ value: s.id, label: s.id === ws.me.id ? `${s.name} (you)` : s.name, icon: <PersonAvatar person={s} size={16} />, keywords: [s.email, s.title ?? ''], hint: s.role })),
  ];
  return <OptionPicker {...p} options={options} placeholder="Choose a person…" width={280} />;
}

export function StaffMultiPicker(p: PickerBase<string[]> & { exclude?: string[] }) {
  const ws = useWorkspace();
  const options: Option<string>[] = ws.activeStaff.filter(s => !(p.exclude ?? []).includes(s.id)).map(s => ({ value: s.id, label: s.id === ws.me.id ? `${s.name} (you)` : s.name, icon: <PersonAvatar person={s} size={16} />, keywords: [s.email], hint: s.role }));
  return <OptionPicker multiple {...p} options={options} placeholder="Choose instructors…" width={280} />;
}

export function GroupPicker(p: PickerBase<string[]>) {
  const ws = useWorkspace();
  const options: Option<string>[] = ws.groups.map(g => ({ value: g.id, label: g.name, icon: <LabelDot color={g.color} />, keywords: [g.kind], hint: `${g.memberCount}`, group: g.kind }));
  return <OptionPicker multiple {...p} options={options} placeholder="Choose groups…" width={280} emptyText="No groups yet" />;
}

export function CoursePicker({ publishedOnly, allowNone, noneLabel = 'All courses', ...p }: PickerBase<string | null> & { publishedOnly?: boolean; allowNone?: boolean; noneLabel?: string }) {
  const ws = useWorkspace();
  const courses = publishedOnly ? ws.publishedCourses : ws.orderedCourses;
  const options: Option<string | null>[] = [
    ...(allowNone ? [{ value: null, label: noneLabel }] : []),
    ...courses.map(c => ({ value: c.id, label: c.title, icon: <CourseGlyph icon={c.icon} color={c.color} size={16} />, keywords: [ws.categoryById.get(c.categoryId ?? '')?.name ?? '', c.status], hint: c.status !== 'Published' ? c.status : undefined, group: publishedOnly ? undefined : c.status === 'Published' ? 'Published' : c.status === 'Draft' ? 'Drafts' : 'Archived' })),
  ];
  return <OptionPicker {...p} options={options} placeholder="Choose a course…" width={320} emptyText="No courses" />;
}

export function CourseMultiPicker(p: PickerBase<string[]>) {
  const ws = useWorkspace();
  const options: Option<string>[] = ws.orderedCourses.filter(c => c.status !== 'Archived').map(c => ({ value: c.id, label: c.title, icon: <CourseGlyph icon={c.icon} color={c.color} size={16} />, keywords: [ws.categoryById.get(c.categoryId ?? '')?.name ?? ''], hint: c.status === 'Draft' ? 'Draft' : undefined }));
  return <OptionPicker multiple {...p} options={options} placeholder="Choose courses…" width={320} />;
}

export function PathPicker({ publishedOnly, ...p }: PickerBase<string | null> & { publishedOnly?: boolean }) {
  const ws = useWorkspace();
  const paths = publishedOnly ? ws.publishedPaths : ws.orderedPaths;
  const options: Option<string | null>[] = paths.map(x => ({ value: x.id, label: x.title, icon: <CourseGlyph icon={x.icon} color={x.color} size={16} />, hint: `${x.courseIds.length} courses` }));
  return <OptionPicker {...p} options={options} placeholder="Choose a learning path…" width={320} emptyText="No learning paths" />;
}

export function CategoryPicker({ allowNone = true, ...p }: PickerBase<string | null> & { allowNone?: boolean }) {
  const ws = useWorkspace();
  const options: Option<string | null>[] = [...(allowNone ? [{ value: null, label: 'No category' }] : []), ...ws.categories.map(c => ({ value: c.id, label: c.name, icon: <span className="text-[14px] leading-none">{c.icon || '•'}</span> }))];
  return <OptionPicker {...p} options={options} placeholder="Choose a category…" width={240} />;
}

export function DatePicker({ value, onChange, trigger, open, onOpenChange, align = 'start', presets = true, clearLabel = 'Clear date', allowPast = false }: PickerBase<string | null> & { presets?: boolean; clearLabel?: string; allowPast?: boolean }) {
  const [inner, setInner] = useState(false);
  const isOpen = open ?? inner;
  const setOpen = onOpenChange ?? setInner;
  const today = new Date();
  const pick = (d: Date | null) => {
    onChange(d ? toDayString(d) : null);
    setOpen(false);
  };
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0 shadow-lg" onClick={e => e.stopPropagation()}>
        {presets && (
          <div className="grid grid-cols-2 gap-1 border-b p-2">
            {[
              ['In a week', addDays(today, 7)],
              ['In two weeks', addDays(today, 14)],
              ['In 30 days', addDays(today, 30)],
              ['End of month', endOfMonth(today)],
              ['Next Monday', nextMonday(today)],
              ['End of week', endOfWeek(today, { weekStartsOn: 1 })],
            ].map(([label, d]) => (
              <button key={label as string} type="button" onClick={() => pick(d as Date)} className="flex h-8 items-center justify-between gap-3 rounded-md px-2 text-[13.5px] hover:bg-accent">
                {label as string}
                <span className="text-muted-foreground">{shortDate(toDayString(d as Date))}</span>
              </button>
            ))}
          </div>
        )}
        <Calendar mode="single" selected={value ? parseDay(value) : undefined} onSelect={d => pick(d ?? null)} disabled={allowPast ? undefined : { before: today }} initialFocus />
        {value && (
          <div className="border-t p-1.5">
            <button type="button" onClick={() => pick(null)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-3.5 w-3.5" /> {clearLabel}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
