import { BellRing, Copy, ExternalLink, GraduationCap, ShieldCheck, UserCheck, UserMinus, UserRound, UserX, UsersRound } from 'lucide-react';
import { memo, useRef, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@project/components/ui/context-menu';
import { cn } from '@project/components/lib/utils';
import { shortDate } from '../../lib/format';
import { PersonAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import type { PersonTarget, usePeopleActions } from './PeopleActions';
import { GroupChips, LastActive, PEOPLE_COL, PersonStatusPill, RoleBadge, SelectBox, TrainingCells } from './PeopleBits';
import type { PersonRow } from './peopleData';

export const toTarget = (r: PersonRow): PersonTarget => ({ id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, managerId: r.managerId, lastActiveAt: r.lastActiveAt, groupIds: r.groupIds });

type Actions = ReturnType<typeof usePeopleActions>['actions'];

/** The people-row menu: the bulk actions, for the row or the selection it belongs to. */
export function PeopleMenuItems({ targets, actions, isAdmin, anchor, openLabel, onOpen }: { targets: PersonTarget[]; actions: Actions; isAdmin: boolean; anchor: () => { x: number; y: number }; openLabel?: string; onOpen?: () => void }) {
  const n = targets.length;
  const suffix = n > 1 ? ` (${n})` : '';
  const invitable = targets.filter(t => t.status !== 'Deactivated' && !t.lastActiveAt);
  const deactivated = targets.filter(t => t.status === 'Deactivated');
  const active = targets.filter(t => t.status !== 'Deactivated');
  const withManager = targets.filter(t => t.managerId);
  const item = (key: string, icon: ReactNode, children: ReactNode, onSelect: () => void, danger?: boolean) => (
    <ContextMenuItem key={key} className={cn('gap-2 text-[14px] [&_svg]:h-3.5 [&_svg]:w-3.5', danger && 'text-destructive focus:text-destructive')} onSelect={onSelect}>
      {icon} {children}
    </ContextMenuItem>
  );
  return (
    <>
      {onOpen && n === 1 && (
        <>
          {item('i1', <ExternalLink />, <>{openLabel ?? 'Open'}</>, onOpen)}
          <ContextMenuSeparator />
        </>
      )}
      {active.length > 0 && item('i2', <GraduationCap />, <>Enroll{suffix}…</>, () => actions.enroll(active))}
      {isAdmin && (
        <>
          {item('i3', <UsersRound />, <>Add to group…</>, () => actions.pickGroup(targets, anchor()))}
          {item('i3b', <UsersRound />, <>Remove from group…</>, () => actions.pickGroupToLeave(targets, anchor()))}
          {item('i4', <UserRound />, <>Set manager…</>, () => actions.pickManager(targets, anchor()))}
          {withManager.length > 0 && item('i5', <UserX />, <>Remove manager{withManager.length > 1 ? ` (${withManager.length})` : ''}</>, () => actions.setManager(withManager, null))}
          {item('i6', <ShieldCheck />, <>Change role…</>, () => actions.pickRole(targets, anchor()))}
          {invitable.length > 0 && item('i7', <BellRing />, <>Resend invitation{invitable.length > 1 ? `s (${invitable.length})` : ''}</>, () => actions.resendInvites(invitable))}
        </>
      )}
      {item('i8', <Copy />, <>Copy email{n > 1 ? 's' : ''}</>, () => actions.copyEmails(targets))}
      {isAdmin && (active.length > 0 || deactivated.length > 0) && <ContextMenuSeparator />}
      {isAdmin && deactivated.length > 0 && item('i9', <UserCheck />, <>Reactivate{deactivated.length > 1 ? ` (${deactivated.length})` : ''}</>, () => actions.reactivate(deactivated))}
      {isAdmin && active.length > 0 && item('i10', <UserMinus />, <>Deactivate{active.length > 1 ? ` (${active.length})` : ''}…</>, () => actions.deactivate(active), true)}
    </>
  );
}

type RowProps = {
  row: PersonRow;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  isAdmin: boolean;
  actions: Actions;
  getTargets: (r: PersonRow) => PersonTarget[];
  onClick: (r: PersonRow, e: MouseEvent) => void;
  onToggle: (r: PersonRow, e: MouseEvent) => void;
  onHover: (r: PersonRow) => void;
};

function Row({ row: r, selected, focused, selecting, isAdmin, actions, getTargets, onClick, onToggle, onHover }: RowProps) {
  const navigate = useNavigate();
  const muted = r.status === 'Deactivated';
  const lastPointer = useRef({ x: 0, y: 0 });
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="row"
          data-row-id={r.id}
          aria-selected={selected}
          onClick={e => onClick(r, e)}
          onContextMenu={e => (lastPointer.current = { x: e.clientX, y: e.clientY })}
          onMouseMove={() => !focused && onHover(r)}
          className={cn(
            'group/row relative flex h-10 cursor-default select-none items-center gap-2.5 border-b border-border/60 pl-2 pr-3 text-[14px] transition-colors duration-75 sm:pr-4',
            focused ? 'bg-accent/80' : 'hover:bg-accent/50',
            selected && 'bg-primary/[0.07] hover:bg-primary/10 dark:bg-primary/[0.1]',
          )}
        >
          {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
          <SelectBox checked={selected} visible={selecting} onToggle={e => onToggle(r, e)} label={selected ? `Deselect ${r.name}` : `Select ${r.name}`} />
          <PersonAvatar person={r} size={22} />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className={cn('min-w-0 truncate', muted && 'text-muted-foreground')}>{r.name}</span>
            {r.title && <span className="hidden min-w-0 shrink-[100] truncate text-[13.5px] text-muted-foreground md:inline">{r.title}</span>}
            <RoleBadge role={r.role} />
            <PersonStatusPill status={r.status} />
            {r.counts.overdue > 0 && <span className="shrink-0 text-2xs font-medium tabular-nums text-tone-danger sm:hidden">{r.counts.overdue} overdue</span>}
          </div>
          <span className={PEOPLE_COL.groups}>
            <GroupChips ids={r.groupIds} />
          </span>
          <span className={PEOPLE_COL.manager}>
            {r.managerId && r.managerName ? (
              <button type="button" onClick={e => { e.stopPropagation(); navigate(`/people/${r.managerId}`); }} className="flex min-w-0 items-center gap-1.5 rounded text-[13.5px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open ${r.managerName}`}>
                <PersonAvatar person={{ name: r.managerName, color: r.managerColor, avatarUrl: r.managerAvatarUrl }} size={16} />
                <span className="truncate">{r.managerName}</span>
              </button>
            ) : (
              <span className="text-sm text-muted-foreground/40">—</span>
            )}
          </span>
          <TrainingCells active={r.counts.active} overdue={r.counts.overdue} completed={r.counts.completed} name={r.name} />
          <span className={PEOPLE_COL.lastActive}>
            {r.status === 'Invited' && !r.lastActiveAt ? (
              <Tip label={r.invitedAt ? `Invited ${shortDate(r.invitedAt)} · hasn’t signed in yet` : 'Hasn’t signed in yet'}>
                <span className="text-sm text-muted-foreground/50">—</span>
              </Tip>
            ) : (
              <LastActive iso={r.lastActiveAt} />
            )}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={e => e.preventDefault()}>
        <PeopleMenuItems targets={getTargets(r)} actions={actions} isAdmin={isAdmin} anchor={() => lastPointer.current} openLabel="Open profile" onOpen={() => navigate(`/people/${r.id}`)} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const PersonListRow = memo(Row);

