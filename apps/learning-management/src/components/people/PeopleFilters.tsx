import { Filter, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { usePeopleSearch } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { GroupPicker, PersonPicker } from '../pickers/pickers';
import { PersonAvatar } from '../primitives/Avatar';
import { LabelDot } from '../primitives/bits';
import { afterMenusClose } from './PeopleActions';
import { COMPLIANCE_OPTIONS, type Compliancefilter } from './peopleData';

export type PeopleFilterState = { groupIds: string[]; managerId: string | null; compliance: Compliancefilter | null };

const itemCls = 'gap-2 text-[14px]';

/** The Filter menu for people lists: group, manager and training status. */
export function PeopleFilterMenu({ value, onChange, hideGroups }: { value: PeopleFilterState; onChange: (patch: Partial<PeopleFilterState>) => void; hideGroups?: boolean }) {
  const ws = useWorkspace();
  const [managerOpen, setManagerOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const active = value.groupIds.length + (value.managerId ? 1 : 0) + (value.compliance ? 1 : 0);
  return (
    <span ref={anchorRef} className="relative inline-flex">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="ghost-chip h-8 gap-1.5 px-2 text-[13.5px] text-muted-foreground hover:text-foreground">
            <Filter className="h-3.5 w-3.5" /> Filter
            {active > 0 && <span className="rounded bg-primary/10 px-1 text-2xs font-medium tabular-nums text-primary">{active}</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56" onCloseAutoFocus={e => e.preventDefault()}>
          <DropdownMenuLabel className="text-2xs font-medium text-muted-foreground">Filter by</DropdownMenuLabel>
          {!hideGroups && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={cn(itemCls, '[&_svg]:text-muted-foreground')}>
                <UsersRound className="h-3.5 w-3.5" /> Group
                {value.groupIds.length > 0 && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[340px] min-w-[230px] overflow-y-auto">
                {ws.groups.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">No groups yet</div>}
                {ws.groups.map(g => (
                  <DropdownMenuCheckboxItem
                    key={g.id}
                    className={itemCls}
                    checked={value.groupIds.includes(g.id)}
                    onSelect={e => e.preventDefault()}
                    onCheckedChange={on => onChange({ groupIds: on ? [...value.groupIds, g.id] : value.groupIds.filter(id => id !== g.id) })}
                  >
                    <LabelDot color={g.color} /> <span className="truncate">{g.name}</span>
                    <span className="ml-auto text-sm tabular-nums text-muted-foreground">{g.memberCount}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={cn(itemCls, '[&_svg]:text-muted-foreground')}>
              <UserRound className="h-3.5 w-3.5" /> Manager
              {value.managerId && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[210px]">
              <DropdownMenuItem className={itemCls} onSelect={() => afterMenusClose(() => setManagerOpen(true))}>
                Choose a manager…
              </DropdownMenuItem>
              <DropdownMenuItem className={itemCls} onSelect={() => onChange({ managerId: ws.me.id })}>
                <PersonAvatar person={ws.me} size={16} /> My direct reports
              </DropdownMenuItem>
              <DropdownMenuItem className={itemCls} onSelect={() => onChange({ managerId: 'none' })}>
                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-dashed border-muted-foreground/60" /> No manager
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={cn(itemCls, '[&_svg]:text-muted-foreground')}>
              <ShieldCheck className="h-3.5 w-3.5" /> Training status
              {value.compliance && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[250px]">
              <DropdownMenuRadioGroup value={value.compliance ?? ''} onValueChange={v => onChange({ compliance: (v || null) as Compliancefilter | null })}>
                {COMPLIANCE_OPTIONS.map(o => (
                  <DropdownMenuRadioItem key={o.value} value={o.value} className="items-start gap-2 py-1.5 text-[14px]">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 rounded-full', o.dot)} /> {o.label}
                      </span>
                      <span className="block pl-4 text-2xs text-muted-foreground">{o.hint}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {active > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[14px] text-muted-foreground" onSelect={() => onChange({ groupIds: [], managerId: null, compliance: null })}>
                Clear all filters
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <PersonPicker
        open={managerOpen}
        onOpenChange={setManagerOpen}
        value={value.managerId && value.managerId !== 'none' ? [value.managerId] : []}
        onChange={ids => {
          onChange({ managerId: ids[ids.length - 1] ?? null });
          setManagerOpen(false);
        }}
        placeholder="People who report to…"
        trigger={<span aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-0 w-0" />}
      />
    </span>
  );
}

function Chip({ icon, label, value, onRemove, children }: { icon: ReactNode; label: string; value: ReactNode; onRemove: () => void; children?: (trigger: ReactNode) => ReactNode }) {
  const trigger = (
    <button type="button" className="flex h-full min-w-0 items-center gap-1.5 px-2 hover:bg-accent [&_svg]:text-muted-foreground">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 max-w-[200px] items-center gap-1 truncate font-medium">{value}</span>
    </button>
  );
  return (
    <span className="flex h-8 items-center overflow-hidden rounded-md border bg-background text-[13.5px] shadow-2xs animate-fade-in">
      {children ? children(trigger) : trigger}
      <button type="button" aria-label={`Remove ${label} filter`} onClick={onRemove} className="flex h-full items-center border-l px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export function PeopleFilterChips({ value, onChange, hideGroups }: { value: PeopleFilterState; onChange: (patch: Partial<PeopleFilterState>) => void; hideGroups?: boolean }) {
  const ws = useWorkspace();
  const managerId = value.managerId && value.managerId !== 'none' ? value.managerId : null;
  const { data } = usePeopleSearch('', { ids: managerId ? [managerId] : [], enabled: Boolean(managerId) });
  const manager = data?.people.find(p => p.id === managerId);
  const groups = value.groupIds.map(id => ws.groupById.get(id)).filter(Boolean);
  const compliance = COMPLIANCE_OPTIONS.find(o => o.value === value.compliance);
  return (
    <>
      {!hideGroups && groups.length > 0 && (
        <Chip icon={<UsersRound className="h-3.5 w-3.5" />} label="Group" value={groups.length > 2 ? `${groups.slice(0, 2).map(g => g!.name).join(', ')} +${groups.length - 2}` : groups.map(g => g!.name).join(', ')} onRemove={() => onChange({ groupIds: [] })}>
          {trigger => <GroupPicker value={value.groupIds} onChange={groupIds => onChange({ groupIds })} trigger={trigger} />}
        </Chip>
      )}
      {value.managerId && (
        <Chip
          icon={<UserRound className="h-3.5 w-3.5" />}
          label="Reports to"
          value={value.managerId === 'none' ? 'Nobody' : manager ? <><PersonAvatar person={manager} size={14} /> <span className="truncate">{manager.id === ws.me.id ? 'You' : manager.name}</span></> : '…'}
          onRemove={() => onChange({ managerId: null })}
        >
          {trigger => <PersonPicker value={managerId ? [managerId] : []} onChange={ids => onChange({ managerId: ids[ids.length - 1] ?? null })} placeholder="People who report to…" trigger={trigger} />}
        </Chip>
      )}
      {compliance && (
        <Chip icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Training" value={<><span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', compliance.dot)} /> {compliance.label}</>} onRemove={() => onChange({ compliance: null })}>
          {trigger => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[200px]">
                <DropdownMenuRadioGroup value={value.compliance ?? ''} onValueChange={v => onChange({ compliance: v as Compliancefilter })}>
                  {COMPLIANCE_OPTIONS.map(o => (
                    <DropdownMenuRadioItem key={o.value} value={o.value} className="gap-2 text-[14px]">
                      <span className={cn('h-2 w-2 rounded-full', o.dot)} /> {o.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </Chip>
      )}
    </>
  );
}
