import { CalendarDays, Check, ChevronDown, Mail, Plus, Repeat, Route, UserPlus, Workflow, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@project/components/ui/sheet';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { longDate, shortDate, toDayString } from '../../lib/format';
import { MOD } from '../../lib/hotkeys';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { IconButton, Kbd, LabelDot } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { OptionPicker, type Option } from '../pickers/OptionPicker';
import { DatePicker, GroupPicker, PersonPicker } from '../pickers/pickers';
import { configFromRule, previewInput, recurrenceText, useRuleActions, useRulePreview, type RuleConfig, type RuleRow } from './data';
import { useKnownPeople } from './knownPeople';

const EMPTY: RuleConfig = {
  name: '',
  targetType: 'Course',
  courseId: null,
  pathId: null,
  audience: 'Everyone',
  groupIds: [],
  personIds: [],
  dueMode: 'Relative',
  dueDays: 30,
  dueDate: null,
  recurrenceMonths: null,
  includeFutureMembers: true,
  sendEmail: true,
};

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const token = (filled: boolean) =>
  cn(
    'inline-flex h-9 max-w-full items-center gap-1.5 rounded-md border px-2.5 align-middle text-[15px] font-medium transition-colors',
    filled ? 'border-border bg-background shadow-2xs hover:bg-accent' : 'border-dashed border-primary/50 bg-primary/[0.04] text-primary hover:bg-primary/[0.08]',
  );

const numberCls = 'h-9 w-16 rounded-md border border-input bg-background px-2 text-center align-middle text-[15px] font-medium tabular-nums shadow-2xs outline-none focus-visible:ring-1 focus-visible:ring-ring';

function Word({ children }: { children: ReactNode }) {
  return <span className="align-middle text-[15px] text-muted-foreground">{children}</span>;
}

/**
 * The rule editor: one sentence that reads like the rule ("Assign Security
 * Awareness to Everyone, due 30 days after assignment, every year"), with a
 * live dry run beside it so an admin sees exactly who will be enrolled before
 * saving.
 */
export function RuleEditor({ open, onOpenChange, rule, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; rule?: RuleRow | null; onSaved?: (id: string) => void }) {
  const ws = useWorkspace();
  const { save } = useRuleActions();
  const [c, setC] = useState<RuleConfig>(EMPTY);
  const [busy, setBusy] = useState<null | 'active' | 'paused' | 'update' | 'apply'>(null);
  const [customRepeat, setCustomRepeat] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [personPickerOpen, setPersonPickerOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const initial = useRef<string>('');
  const pendingPicker = useRef<null | 'groups' | 'people'>(null);

  useEffect(() => {
    if (!open) return;
    const next = rule ? configFromRule(rule) : EMPTY;
    // A name the rule was given automatically keeps following the rule, so changing its audience doesn't leave "… for everyone" behind.
    if (rule && rule.name === autoNameFor(next)) next.name = '';
    setC(next);
    initial.current = JSON.stringify(next);
    setBusy(null);
    setCustomRepeat(Boolean(next.recurrenceMonths && ![6, 12, 24].includes(next.recurrenceMonths)));
    if (!rule) window.setTimeout(() => setTargetOpen(true), 250);
  }, [open, rule?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<RuleConfig>) => setC(prev => ({ ...prev, ...patch }));
  /** The name the server gives a rule saved without one (see ruleRecord). */
  function autoNameFor(x: RuleConfig) {
    const t = x.targetType === 'Path' ? (x.pathId ? ws.pathById.get(x.pathId) : undefined) : x.courseId ? ws.courseById.get(x.courseId) : undefined;
    if (!t) return '';
    const who = x.audience === 'Everyone' ? 'everyone' : x.audience === 'Groups' ? x.groupIds.map(id => ws.groupById.get(id)?.name).filter(Boolean).join(', ') || 'groups' : `${x.personIds.length} ${x.personIds.length === 1 ? 'person' : 'people'}`;
    return `${t.title} for ${who}`;
  }
  const { known, remember } = useKnownPeople(c.personIds, open);

  const target = c.targetType === 'Path' ? (c.pathId ? ws.pathById.get(c.pathId) : undefined) : c.courseId ? ws.courseById.get(c.courseId) : undefined;
  const targetValue = c.targetType === 'Path' ? (c.pathId ? `path:${c.pathId}` : null) : c.courseId ? `course:${c.courseId}` : null;
  const targetOptions = useMemo<Option<string>[]>(
    () => [
      ...ws.orderedCourses.filter(x => x.status !== 'Archived').map(x => ({ value: `course:${x.id}`, label: x.title, icon: <CourseGlyph icon={x.icon} color={x.color} size={16} />, hint: x.status === 'Draft' ? 'Draft' : undefined, group: 'Courses', keywords: [ws.categoryById.get(x.categoryId ?? '')?.name ?? ''] })),
      ...ws.orderedPaths.filter(x => x.status !== 'Archived').map(x => ({ value: `path:${x.id}`, label: x.title, icon: <CourseGlyph icon={x.icon} color={x.color} size={16} />, hint: x.status === 'Draft' ? 'Draft' : `${x.courseIds.length} courses`, group: 'Learning paths' })),
    ],
    [ws],
  );

  const today = toDayString(new Date());
  const issues: string[] = [];
  if (!target) issues.push('Choose a course or learning path to assign');
  if (c.audience === 'Groups' && !c.groupIds.length) issues.push('Choose at least one group');
  if (c.audience === 'People' && !c.personIds.length) issues.push('Choose at least one person');
  if (c.dueMode === 'Relative' && (!c.dueDays || c.dueDays < 1 || c.dueDays > 365)) issues.push('Give people between 1 and 365 days');
  if (c.dueMode === 'Fixed' && (!c.dueDate || (c.dueDate <= today && !(rule && rule.status !== 'Active' && c.dueDate === rule.dueDate)))) issues.push('Choose a due date in the future');
  if (c.recurrenceMonths != null && (c.recurrenceMonths < 1 || c.recurrenceMonths > 60)) issues.push('Repeat every 1 to 60 months');
  const unpublished = target && target.status !== 'Published';
  const canSave = issues.length === 0;
  const canActivate = canSave && !unpublished;

  const input = useMemo(() => (target && (c.audience === 'Everyone' || (c.audience === 'Groups' ? c.groupIds.length : c.personIds.length)) ? previewInput(c) : null), [c, target]);
  const debounced = useDebounced(input, 350);
  const preview = useRulePreview(open ? debounced : null);
  const p = debounced ? preview.data : undefined;
  const stale = JSON.stringify(input) !== JSON.stringify(debounced) || preview.isFetching;
  const dirty = JSON.stringify(c) !== initial.current;

  const autoName = target ? autoNameFor(c) : 'Name this rule';

  const submit = async (mode: 'active' | 'paused' | 'update' | 'apply') => {
    if (busy || !canSave || ((mode === 'active' || mode === 'apply') && !canActivate)) return;
    setBusy(mode);
    const payload = previewInput(c);
    try {
      if (rule) {
        const res = await save({ action: 'update', id: rule.id, rule: payload, apply: mode === 'apply' }, mode === 'apply' ? 'Saving and assigning…' : 'Saving…');
        onOpenChange(false);
        onSaved?.(res.id);
      } else {
        const res = await save({ action: 'create', rule: payload, status: mode === 'paused' ? 'Paused' : 'Active' }, mode === 'paused' ? 'Saving…' : 'Creating the rule and enrolling people…');
        onOpenChange(false);
        onSaved?.(res.id);
      }
    } catch {
      setBusy(null);
    }
  };

  // A new rule for a draft can only be saved paused, so that becomes the main action (and ⌘↵).
  const primaryMode: 'active' | 'update' | 'apply' | 'paused' = rule ? (rule.status === 'Active' && (p?.newEnrollments ?? 0) > 0 ? 'apply' : 'update') : unpublished ? 'paused' : 'active';
  const n = p?.newEnrollments ?? 0;
  const primaryLabel = primaryMode === 'update' ? 'Save changes' : primaryMode === 'paused' ? 'Save paused' : n > 0 ? `Save and assign ${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}` : primaryMode === 'apply' ? 'Save and assign' : 'Save and turn on';

  const total = p ? p.newEnrollments + p.alreadyEnrolled + p.completedAlready : 0;
  const pct = (v: number) => (total ? `${(v / total) * 100}%` : '0%');
  const due = p?.dueDate ?? null;
  const dueMenuLabel = c.dueMode === 'None' ? 'no date' : c.dueMode === 'Relative' ? `day${c.dueDays === 1 ? '' : 's'} after assignment` : 'on';
  const repeatLabel = c.recurrenceMonths ? (customRepeat ? 'every' : recurrenceText(c.recurrenceMonths)) : 'never';

  return (
    <Sheet open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <SheetContent
        side="right"
        className="flex w-[min(940px,100vw)] flex-col gap-0 p-0 outline-none sm:max-w-none [&>button:first-child]:hidden"
        // Don't open with a focus ring on ✕; a new rule opens its target picker instead.
        onOpenAutoFocus={e => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit(primaryMode);
          }
        }}
      >
        <SheetTitle className="sr-only">{rule ? 'Edit assignment rule' : 'New assignment rule'}</SheetTitle>
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <Workflow className="h-4 w-4 text-muted-foreground" />
          <span className="text-[14.5px] font-medium">{rule ? 'Edit rule' : 'New assignment rule'}</span>
          {rule && <span className="truncate text-[14px] text-muted-foreground">· {rule.name}</span>}
          <IconButton className="ml-auto" aria-label="Close" onClick={() => onOpenChange(false)}>
            <X />
          </IconButton>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_310px] lg:overflow-hidden">
          {/* Builder */}
          <div className="min-w-0 space-y-6 px-5 py-5 sm:px-7 lg:overflow-y-auto">
            <input
              value={c.name}
              onChange={e => set({ name: e.target.value })}
              maxLength={200}
              placeholder={autoName}
              aria-label="Rule name"
              className="h-9 w-full bg-transparent text-[18px] font-semibold tracking-tight outline-none placeholder:font-medium placeholder:text-muted-foreground/60"
            />

            <div className="space-y-3 leading-9" aria-label="Rule">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <Word>Assign</Word>
                <OptionPicker
                  open={targetOpen}
                  onOpenChange={setTargetOpen}
                  value={targetValue}
                  onChange={v => {
                    if (!v) return;
                    const [kind, id] = v.split(':');
                    const t = kind === 'path' ? ws.pathById.get(id) : ws.courseById.get(id);
                    set(kind === 'path' ? { targetType: 'Path', pathId: id, courseId: null } : { targetType: 'Course', courseId: id, pathId: null });
                    // Adopt the course's own due window the first time a target is picked.
                    if (t?.dueDays && !target && c.dueMode === 'Relative') set({ dueDays: t.dueDays });
                  }}
                  options={targetOptions}
                  placeholder="Search courses and paths…"
                  width={340}
                  trigger={
                    <button type="button" className={token(Boolean(target))}>
                      {target ? <CourseGlyph icon={target.icon} color={target.color} size={18} /> : <Plus className="h-3.5 w-3.5" />}
                      <span className="truncate">{target?.title ?? 'a course or path'}</span>
                      {c.targetType === 'Path' && target && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-2xs font-medium text-muted-foreground">
                          <Route className="h-2.5 w-2.5" /> Path
                        </span>
                      )}
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  }
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <Word>to</Word>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={token(true)}>
                      {c.audience === 'Everyone' ? 'everyone' : c.audience === 'Groups' ? 'people in' : 'specific people'}
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-64"
                    // Hand focus to the group/people picker instead of back to the trigger, so it can open straight away.
                    onCloseAutoFocus={e => {
                      if (!pendingPicker.current) return;
                      e.preventDefault();
                      const which = pendingPicker.current;
                      pendingPicker.current = null;
                      if (which === 'groups') setGroupPickerOpen(true);
                      else setPersonPickerOpen(true);
                    }}
                  >
                    {(
                      [
                        ['Everyone', 'Everyone', `All ${ws.peopleCount.active} active people`],
                        ['Groups', 'People in groups', 'Departments, locations, teams or cohorts'],
                        ['People', 'Specific people', 'Hand-picked, by name'],
                      ] as const
                    ).map(([value, label, hint]) => (
                      <DropdownMenuItem
                        key={value}
                        className="items-start gap-2 py-2 text-[14px]"
                        onSelect={() => {
                          set({ audience: value, includeFutureMembers: value === 'People' ? false : c.audience === 'People' ? true : c.includeFutureMembers });
                          if (value === 'Groups' && !c.groupIds.length) pendingPicker.current = 'groups';
                          if (value === 'People' && !c.personIds.length) pendingPicker.current = 'people';
                        }}
                      >
                        <span className="mt-0.5 flex h-4 w-4 items-center justify-center">{c.audience === value && <Check className="h-3.5 w-3.5" />}</span>
                        <span>
                          <span className="block font-medium">{label}</span>
                          <span className="block text-sm text-muted-foreground">{hint}</span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {c.audience === 'Groups' && (
                  <>
                    {c.groupIds.map(id => {
                      const g = ws.groupById.get(id);
                      return (
                        <span key={id} className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background pl-2.5 pr-1 align-middle text-[15px] font-medium shadow-2xs">
                          <LabelDot color={g?.color} />
                          {g?.name ?? 'Deleted group'}
                          <span className="text-sm font-normal tabular-nums text-muted-foreground">{g?.memberCount ?? 0}</span>
                          <button type="button" aria-label={`Remove ${g?.name ?? 'group'}`} onClick={() => set({ groupIds: c.groupIds.filter(x => x !== id) })} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                    <GroupPicker
                      open={groupPickerOpen}
                      onOpenChange={setGroupPickerOpen}
                      value={c.groupIds}
                      onChange={ids => set({ groupIds: ids })}
                      trigger={
                        <button type="button" className={token(false)}>
                          <Plus className="h-3.5 w-3.5" /> {c.groupIds.length ? 'group' : 'choose groups'}
                        </button>
                      }
                    />
                  </>
                )}
                {c.audience === 'People' && (
                  <>
                    {c.personIds.slice(0, 12).map(id => {
                      const person = known.get(id);
                      return (
                        <span key={id} className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background pl-1.5 pr-1 align-middle text-[15px] font-medium shadow-2xs">
                          <PersonAvatar person={person ?? { name: '…' }} size={18} />
                          {person?.name ?? 'Loading…'}
                          <button type="button" aria-label={`Remove ${person?.name ?? 'person'}`} onClick={() => set({ personIds: c.personIds.filter(x => x !== id) })} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                    {c.personIds.length > 12 && <span className="align-middle text-[14px] text-muted-foreground">+{c.personIds.length - 12} more</span>}
                    <PersonPicker
                      multiple
                      open={personPickerOpen}
                      onOpenChange={setPersonPickerOpen}
                      value={c.personIds}
                      onChange={ids => set({ personIds: ids })}
                      onPeopleSeen={remember}
                      trigger={
                        <button type="button" className={token(false)}>
                          <Plus className="h-3.5 w-3.5" /> {c.personIds.length ? 'person' : 'choose people'}
                        </button>
                      }
                    />
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <Word>due</Word>
                {c.dueMode === 'Relative' && (
                  <input
                    aria-label="Days to finish"
                    inputMode="numeric"
                    value={c.dueDays ?? ''}
                    onChange={e => set({ dueDays: e.target.value === '' ? null : Math.min(999, Number(e.target.value.replace(/\D/g, '')) || 0) })}
                    className={cn(numberCls, (!c.dueDays || c.dueDays > 365) && 'border-tone-danger')}
                  />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={token(true)}>
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                      {dueMenuLabel}
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => set({ dueMode: 'None' })}>
                      <span className="flex w-4 justify-center">{c.dueMode === 'None' && <Check className="h-3.5 w-3.5" />}</span> No due date
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => set({ dueMode: 'Relative', dueDays: c.dueDays || target?.dueDays || 30 })}>
                      <span className="flex w-4 justify-center">{c.dueMode === 'Relative' && <Check className="h-3.5 w-3.5" />}</span> A number of days after assignment
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => set({ dueMode: 'Fixed' })}>
                      <span className="flex w-4 justify-center">{c.dueMode === 'Fixed' && <Check className="h-3.5 w-3.5" />}</span> On a specific date
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {c.dueMode === 'Fixed' && (
                  <DatePicker
                    value={c.dueDate}
                    onChange={d => set({ dueDate: d })}
                    clearLabel="Clear date"
                    trigger={
                      <button type="button" className={token(Boolean(c.dueDate))}>
                        {c.dueDate ? longDate(c.dueDate) : 'pick a date'}
                      </button>
                    }
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <Word>repeat</Word>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={token(true)}>
                      <Repeat className="h-3.5 w-3.5 text-muted-foreground" />
                      {repeatLabel}
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {([null, 6, 12, 24] as const).map(m => (
                      <DropdownMenuItem
                        key={m ?? 0}
                        className="gap-2 text-[14px]"
                        onSelect={() => {
                          setCustomRepeat(false);
                          set({ recurrenceMonths: m });
                        }}
                      >
                        <span className="flex w-4 justify-center">{!customRepeat && c.recurrenceMonths === m && <Check className="h-3.5 w-3.5" />}</span>
                        {m ? recurrenceText(m)!.replace(/^./, ch => ch.toUpperCase()) : 'Never — assign once'}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 text-[14px]"
                      onSelect={() => {
                        setCustomRepeat(true);
                        set({ recurrenceMonths: c.recurrenceMonths || 18 });
                      }}
                    >
                      <span className="flex w-4 justify-center">{customRepeat && <Check className="h-3.5 w-3.5" />}</span> Custom…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {customRepeat && c.recurrenceMonths != null && (
                  <>
                    <input
                      aria-label="Months between cycles"
                      inputMode="numeric"
                      value={c.recurrenceMonths || ''}
                      onChange={e => set({ recurrenceMonths: Math.min(99, Number(e.target.value.replace(/\D/g, '')) || 0) })}
                      className={cn(numberCls, (c.recurrenceMonths < 1 || c.recurrenceMonths > 60) && 'border-tone-danger')}
                    />
                    <Word>months</Word>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors hover:bg-accent/30', c.audience === 'People' && 'cursor-not-allowed opacity-60')}>
                <Switch checked={c.audience !== 'People' && c.includeFutureMembers} disabled={c.audience === 'People'} onCheckedChange={v => set({ includeFutureMembers: v })} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[14px] font-medium">
                    <UserPlus className="h-3.5 w-3.5 text-muted-foreground" /> Include people who join later
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {c.audience === 'People'
                      ? 'Only for Everyone and group rules.'
                      : c.audience === 'Everyone'
                        ? 'Anyone added to the academy later is enrolled automatically.'
                        : `Anyone added to ${c.groupIds.map(id => ws.groupById.get(id)?.name).filter(Boolean).join(' or ') || 'these groups'} later is enrolled automatically.`}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors hover:bg-accent/30">
                <Switch checked={c.sendEmail} onCheckedChange={v => set({ sendEmail: v })} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[14px] font-medium">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email people when they’re assigned
                  </span>
                  <span className="block text-sm text-muted-foreground">Sends the “{c.targetType === 'Path' ? 'Path assigned' : 'Course assigned'}” template. They’re always notified in the academy.</span>
                </span>
              </label>
            </div>

            {(unpublished || (dirty && issues.length > 0 && target)) && (
              <ul className="space-y-1 text-[14px]">
                {unpublished && (
                  <li className="text-tone-warning">
                    “{target!.title}” is a draft. Publish it before this rule can run — you can save the rule paused for now.
                  </li>
                )}
                {issues.map(i => (
                  <li key={i} className="text-muted-foreground">
                    · {i}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Preview */}
          <aside className="min-w-0 border-t bg-subtle/50 px-5 py-5 lg:overflow-y-auto lg:border-l lg:border-t-0" aria-live="polite">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Preview</span>
              {stale && debounced && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/70" aria-label="Updating" />}
              <span className="ml-auto text-2xs text-muted-foreground">if saved now</span>
            </div>
            {!input ? (
              <p className="text-[14px] text-muted-foreground">{!target ? 'Choose what to assign to see who this rule reaches.' : 'Choose who to assign it to.'}</p>
            ) : !p ? (
              <div className="space-y-3">
                <div className="skeleton h-9 w-20" />
                <div className="skeleton h-2 w-full" />
                <div className="skeleton h-3 w-3/4" />
                <div className="skeleton h-3 w-2/3" />
              </div>
            ) : (
              <div className={cn('space-y-4 transition-opacity', stale && 'opacity-60')}>
                <div>
                  <div className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">{p.newEnrollments.toLocaleString()}</div>
                  <div className="mt-1 text-[14px] text-muted-foreground">
                    {p.newEnrollments === 1 ? 'person' : 'people'} {rule ? 'would be newly enrolled' : unpublished ? 'would be enrolled once it’s published and the rule is on' : 'enrolled when you save'} · of {p.audience.toLocaleString()} in the audience
                  </div>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="bg-primary" style={{ width: pct(p.newEnrollments) }} />
                  <span className="bg-muted-foreground/40" style={{ width: pct(p.alreadyEnrolled) }} />
                  <span className="bg-tone-success" style={{ width: pct(p.completedAlready) }} />
                </div>
                <dl className="space-y-1.5 text-[14px]">
                  {[
                    ['bg-primary', 'Enrolled now', p.newEnrollments],
                    ['bg-muted-foreground/40', 'Already enrolled — skipped', p.alreadyEnrolled],
                    ['bg-tone-success', c.recurrenceMonths ? `Completed — recertified ${recurrenceText(c.recurrenceMonths)}` : 'Already completed — skipped', p.completedAlready],
                    ['border border-muted-foreground/50', 'Deactivated — skipped', p.deactivatedSkipped],
                  ].map(([dot, label, value]) =>
                    Number(value) > 0 || label === 'Enrolled now' ? (
                      <div key={String(label)} className="flex items-start gap-2">
                        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dot as string)} aria-hidden />
                        <dt className="min-w-0 flex-1 text-muted-foreground">{label}</dt>
                        <dd className="tabular-nums">{Number(value).toLocaleString()}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
                <div className="space-y-1 border-t pt-3 text-[14px]">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {due ? (
                      <span>
                        Due <span className="text-foreground">{shortDate(due)}</span>
                        {c.dueMode === 'Relative' ? ' for people assigned today' : ''}
                      </span>
                    ) : (
                      'No due date'
                    )}
                  </div>
                  {c.recurrenceMonths ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Repeat className="h-3.5 w-3.5" /> New cycle {recurrenceText(c.recurrenceMonths)} after each completion
                    </div>
                  ) : null}
                  {c.includeFutureMembers && c.audience !== 'People' && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <UserPlus className="h-3.5 w-3.5" /> Newcomers enrolled automatically
                    </div>
                  )}
                </div>
                {p.sample.length > 0 && (
                  <div className="border-t pt-3">
                    <div className="mb-1.5 text-sm font-medium text-muted-foreground">Who gets enrolled</div>
                    <ul className="space-y-1">
                      {p.sample.map((s, i) => (
                        <li key={`${s.name}-${i}`} className="flex min-w-0 items-center gap-2 text-[14px]">
                          <PersonAvatar person={{ name: s.name }} size={18} />
                          <span className="max-w-[70%] shrink-0 truncate">{s.name}</span>
                          {s.title && <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{s.title}</span>}
                        </li>
                      ))}
                    </ul>
                    {p.newEnrollments > p.sample.length && <div className="mt-1.5 text-sm text-muted-foreground">and {(p.newEnrollments - p.sample.length).toLocaleString()} more</div>}
                  </div>
                )}
                {p.newEnrollments === 0 && p.audience > 0 && <p className="text-sm text-muted-foreground">Everyone in the audience is already enrolled or finished, so saving enrolls nobody new today.</p>}
              </div>
            )}
          </aside>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-background px-4 py-3">
          <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Kbd>{MOD}</Kbd>
            <Kbd>↵</Kbd> {primaryLabel.toLowerCase()}
          </span>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} disabled={Boolean(busy)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent disabled:opacity-50">
              Cancel
            </button>
            {rule
              ? primaryMode === 'apply' && (
                  <button type="button" onClick={() => submit('update')} disabled={!canSave || Boolean(busy) || !dirty} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent disabled:opacity-50">
                    {busy === 'update' ? 'Saving…' : 'Save without assigning'}
                  </button>
                )
              : primaryMode === 'active' && (
                  <button type="button" onClick={() => submit('paused')} disabled={!canSave || Boolean(busy)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent disabled:opacity-50">
                    {busy === 'paused' ? 'Saving…' : 'Save paused'}
                  </button>
                )}
            <button
              type="button"
              onClick={() => submit(primaryMode)}
              disabled={(primaryMode === 'update' ? !canSave || !dirty : primaryMode === 'paused' ? !canSave : !canActivate) || Boolean(busy)}
              className="h-9 rounded-md bg-primary px-3.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50"
            >
              {busy === primaryMode ? 'Saving…' : primaryLabel}
            </button>
          </div>
        </footer>
      </SheetContent>
    </Sheet>
  );
}
