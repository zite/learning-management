import { BellRing, Copy, Download, GraduationCap, MoreHorizontal, ShieldCheck, UserCheck, UserMinus, UserRound, UsersRound, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import type { PersonTarget, usePeopleActions } from './PeopleActions';
import { Kbd } from '../primitives/bits';

const btn = 'ghost-chip h-9 gap-1.5 px-2.5 text-[14px] text-foreground/90 hover:text-foreground [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-muted-foreground';

/** The floating bar for a people selection. Pickers open right above the button that asked for them. */
export function PeopleBulkBar({ targets, actions, isAdmin, onClear, onExport }: { targets: PersonTarget[]; actions: ReturnType<typeof usePeopleActions>['actions']; isAdmin: boolean; onClear: () => void; onExport: () => void }) {
  if (!targets.length) return null;
  const n = targets.length;
  const active = targets.filter(t => t.status !== 'Deactivated');
  const deactivated = targets.filter(t => t.status === 'Deactivated');
  const invitable = active.filter(t => !t.lastActiveAt);
  const above = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left, y: r.top - 6, side: 'top' as const };
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-3">
      <div role="toolbar" aria-label="Bulk actions" className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border bg-popover p-1 shadow-xl animate-fade-up scrollbar-none">
        <div className="flex h-9 shrink-0 items-center gap-2 border-r pl-2.5 pr-2">
          <span className="whitespace-nowrap text-[14px] font-medium tabular-nums">{n} selected</span>
          <button type="button" onClick={onClear} aria-label="Clear selection" className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {active.length > 0 && (
          <button type="button" className={btn} onClick={() => actions.enroll(active)}>
            <GraduationCap /> <span className="hidden sm:inline">Enroll…</span>
          </button>
        )}
        {isAdmin && (
          <>
            <button type="button" className={btn} onClick={e => actions.pickGroup(targets, above(e))}>
              <UsersRound /> <span className="hidden sm:inline">Add to group</span>
            </button>
            <button type="button" className={btn} onClick={e => actions.pickManager(targets, above(e))}>
              <UserRound /> <span className="hidden md:inline">Set manager</span>
            </button>
            <button type="button" className={btn} onClick={e => actions.pickRole(targets, above(e))}>
              <ShieldCheck /> <span className="hidden md:inline">Change role</span>
            </button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={btn} aria-label="More actions">
              <MoreHorizontal className="!h-4 !w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56" onCloseAutoFocus={e => e.preventDefault()}>
            {isAdmin && (
              <DropdownMenuItem
                className="gap-2 text-[14px]"
                onSelect={() => {
                  const r = document.querySelector('[aria-label="Bulk actions"]')?.getBoundingClientRect();
                  actions.pickGroupToLeave(targets, r ? { x: r.left + r.width / 2 - 140, y: r.top - 6, side: 'top' } : { x: window.innerWidth / 2 - 140, y: window.innerHeight - 90, side: 'top' });
                }}
              >
                <UsersRound className="h-3.5 w-3.5" /> Remove from group…
              </DropdownMenuItem>
            )}
            {isAdmin && invitable.length > 0 && (
              <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => actions.resendInvites(invitable)}>
                <BellRing className="h-3.5 w-3.5" /> Resend invitation{invitable.length === 1 ? '' : `s (${invitable.length})`}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="gap-2 text-[14px]" onSelect={onExport}>
              <Download className="h-3.5 w-3.5" /> Export selected to CSV
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => actions.copyEmails(targets)}>
              <Copy className="h-3.5 w-3.5" /> Copy emails
            </DropdownMenuItem>
            {isAdmin && deactivated.length > 0 && (
              <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => actions.reactivate(deactivated)}>
                <UserCheck className="h-3.5 w-3.5" /> Reactivate{deactivated.length > 1 ? ` (${deactivated.length})` : ''}
              </DropdownMenuItem>
            )}
            {isAdmin && active.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 text-[14px] text-destructive focus:text-destructive" onSelect={() => actions.deactivate(active)}>
                  <UserMinus className="h-3.5 w-3.5" /> Deactivate{active.length > 1 ? ` (${active.length})` : ''}…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="hidden shrink-0 items-center gap-1 border-l px-2 text-2xs text-muted-foreground md:flex">
          <Kbd>Esc</Kbd> to clear
        </span>
      </div>
    </div>
  );
}

