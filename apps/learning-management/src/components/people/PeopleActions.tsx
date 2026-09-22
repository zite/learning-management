import { UserMinus } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { useWorkspace } from '../../lib/workspace';
import { OptionPicker, type Option } from '../pickers/OptionPicker';
import { PersonPicker } from '../pickers/pickers';
import { LabelDot } from '../primitives/bits';
import { peopleCount, ROLE_INFO, usePeopleWrites, type Role } from './peopleData';

/**
 * The actions people lists and the person page share — enroll, group,
 * manager, role, invitations, access — with the pickers and confirmations
 * they need. The bulk bar, the right-click menu and the person header all call
 * the same functions, so a change behaves identically wherever it starts.
 */

export type PersonTarget = { id: string; name: string; email: string; role: Role; status: string; managerId?: string | null; lastActiveAt?: string | null; groupIds?: string[] };
export type Anchor = { x: number; y: number; side?: 'top' | 'bottom' };

type Pending = { kind: 'group' | 'ungroup' | 'manager' | 'role'; targets: PersonTarget[]; anchor: Anchor } | null;

export function anchorFrom(e: { currentTarget: Element } | { clientX: number; clientY: number } | null | undefined): Anchor {
  if (e && 'currentTarget' in e && e.currentTarget instanceof Element) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 2 };
  }
  if (e && 'clientX' in e) return { x: e.clientX, y: e.clientY };
  return { x: window.innerWidth / 2 - 140, y: window.innerHeight / 3 };
}

const anchorPoint = (anchor: Anchor) => <span aria-hidden className="pointer-events-none fixed h-0 w-0" style={{ left: Math.min(anchor.x, window.innerWidth - 16), top: Math.min(anchor.y, window.innerHeight - 16) }} />;

/**
 * Run once any open menu has finished closing. A menu hands focus back to its
 * trigger as it closes, which would instantly dismiss a picker opened from it.
 */
export function afterMenusClose(fn: () => void) {
  const started = Date.now();
  const tick = () => (document.querySelector('[role="menu"]') && Date.now() - started < 600 ? window.setTimeout(tick, 25) : window.setTimeout(fn, 20));
  window.setTimeout(tick, 10);
}

const label = (targets: PersonTarget[]) => (targets.length === 1 ? targets[0].name : peopleCount(targets.length));

export function usePeopleActions(opts: { onDone?: () => void } = {}) {
  const ws = useWorkspace();
  const app = useAppActions();
  const writes = usePeopleWrites();
  const [pending, setPending] = useState<Pending>(null);
  const [deactivating, setDeactivating] = useState<PersonTarget[] | null>(null);
  const { onDone } = opts;

  // Menus hand focus back to their trigger as they close; open pickers a tick later so that doesn't dismiss them.
  const later = afterMenusClose;

  const enroll = useCallback((targets: PersonTarget[]) => app.openEnroll({ personIds: targets.map(t => t.id) }), [app]);

  const changeRole = useCallback(
    async (targets: PersonTarget[], role: Role) => {
      const changing = targets.filter(t => t.role !== role);
      if (!changing.length) return;
      if (changing.some(t => t.id === ws.me.id) && role !== 'Admin') {
        const ok = await app.confirm({ title: `Change your own role to ${role}?`, description: role === 'Learner' ? 'You’ll lose access to this admin app straight away. Another admin can change it back.' : 'You won’t be able to manage people, roles or settings any more. Another admin can change it back.', confirmLabel: `Make me ${role === 'Learner' ? 'a learner' : 'an instructor'}`, destructive: true });
        if (!ok) return;
      }
      if (changing.length === 1) await writes.save({ action: 'setRole', id: changing[0].id, role }, { success: `${changing[0].name} is now ${role === 'Admin' ? 'an admin' : role === 'Instructor' ? 'an instructor' : 'a learner'}`, error: "Couldn't change the role" });
      else await writes.bulk({ ids: changing.map(t => t.id), action: 'set_role', role }, { verb: `Changed role to ${role}`, error: "Couldn't change those roles" });
      onDone?.();
    },
    [app, writes, ws.me.id, onDone],
  );

  const setManager = useCallback(
    async (targets: PersonTarget[], managerId: string | null, name?: string) => {
      const managerName = name ?? (managerId ? managerNames.get(managerId) : undefined);
      if (targets.length === 1) await writes.save({ action: 'setManager', id: targets[0].id, managerId }, { success: managerId ? `${targets[0].name} now reports to ${managerName ?? 'their new manager'}` : `Removed ${targets[0].name}’s manager`, error: "Couldn't change the manager" });
      else await writes.bulk({ ids: targets.map(t => t.id), action: 'set_manager', managerId }, { verb: managerId ? `Now reporting to ${managerName ?? 'the new manager'}` : 'Removed manager', error: "Couldn't change the manager" });
      onDone?.();
    },
    [writes, onDone],
  );

  const addToGroup = useCallback(
    async (targets: PersonTarget[], groupId: string) => {
      const group = ws.groupById.get(groupId);
      await writes.bulk({ ids: targets.map(t => t.id), action: 'add_to_group', groupId }, { verb: `Added to ${group?.name ?? 'the group'}`, error: "Couldn't add them to the group" });
      onDone?.();
    },
    [writes, ws.groupById, onDone],
  );

  const removeFromGroup = useCallback(
    async (targets: PersonTarget[], groupId: string) => {
      const group = ws.groupById.get(groupId);
      const ok = await app.confirm({ title: `Remove ${label(targets)} from ${group?.name ?? 'the group'}?`, description: 'Training they were already enrolled in stays as it is. They stop receiving this group’s future assignments.', confirmLabel: 'Remove', destructive: true });
      if (!ok) return;
      await writes.bulk({ ids: targets.map(t => t.id), action: 'remove_from_group', groupId }, { verb: `Removed from ${group?.name ?? 'the group'}`, error: "Couldn't remove them from the group" });
      onDone?.();
    },
    [app, writes, ws.groupById, onDone],
  );

  const resendInvites = useCallback(
    async (targets: PersonTarget[]) => {
      const eligible = targets.filter(t => t.status !== 'Deactivated' && !t.lastActiveAt);
      if (!eligible.length) return;
      if (eligible.length === 1) await writes.save({ action: 'resendInvite', id: eligible[0].id }, { success: `Sent a new invitation to ${eligible[0].email}`, error: "Couldn't send the invitation" });
      else await writes.bulk({ ids: eligible.map(t => t.id), action: 'resend_invite' }, { verb: 'Sent invitations', error: "Couldn't send those invitations" });
      onDone?.();
    },
    [writes, onDone],
  );

  const reactivate = useCallback(
    async (targets: PersonTarget[]) => {
      const off = targets.filter(t => t.status === 'Deactivated');
      if (!off.length) return;
      if (off.length === 1) await writes.save({ action: 'reactivate', id: off[0].id }, { success: `Reactivated ${off[0].name}`, error: "Couldn't reactivate them", description: 'They can sign in again.' });
      else await writes.bulk({ ids: off.map(t => t.id), action: 'reactivate' }, { verb: 'Reactivated', error: "Couldn't reactivate them" });
      onDone?.();
    },
    [writes, onDone],
  );

  const actions = useMemo(
    () => ({
      enroll,
      changeRole,
      setManager,
      addToGroup,
      resendInvites,
      reactivate,
      removeFromGroup,
      pickGroup: (targets: PersonTarget[], anchor: Anchor) => later(() => setPending({ kind: 'group', targets, anchor })),
      pickGroupToLeave: (targets: PersonTarget[], anchor: Anchor) => later(() => setPending({ kind: 'ungroup', targets, anchor })),
      pickManager: (targets: PersonTarget[], anchor: Anchor) => later(() => setPending({ kind: 'manager', targets, anchor })),
      pickRole: (targets: PersonTarget[], anchor: Anchor) => later(() => setPending({ kind: 'role', targets, anchor })),
      deactivate: (targets: PersonTarget[]) => later(() => setDeactivating(targets.filter(t => t.status !== 'Deactivated'))),
      copyEmails: (targets: PersonTarget[]) => copyText(targets.map(t => t.email).join(', '), targets.length === 1 ? 'Copied email' : `Copied ${targets.length} emails`),
    }),
    [enroll, changeRole, setManager, addToGroup, removeFromGroup, resendInvites, reactivate],
  );

  const close = (o: boolean) => !o && setPending(null);
  const groupOptions: Option<string>[] = ws.groups.map(g => ({ value: g.id, label: g.name, icon: <LabelDot color={g.color} />, hint: `${g.memberCount}`, group: g.kind, keywords: [g.kind] }));
  const roleOptions: Option<Role>[] = (['Admin', 'Instructor', 'Learner'] as const).map((r, i) => ({ value: r, label: ROLE_INFO[r].label, hint: undefined, shortcut: String(i + 1), keywords: [ROLE_INFO[r].description] }));
  const single = pending?.targets.length === 1 ? pending.targets[0] : null;

  const host: ReactNode = (
    <>
      {pending?.kind === 'group' && (
        <OptionPicker open onOpenChange={close} options={groupOptions} value={null} placeholder={`Add ${label(pending.targets)} to…`} width={280} side={pending.anchor.side} emptyText="No groups yet" onChange={id => { setPending(null); if (id) void addToGroup(pending.targets, id); }} trigger={anchorPoint(pending.anchor)} />
      )}
      {pending?.kind === 'ungroup' && (
        <OptionPicker open onOpenChange={close} options={pending.targets.every(t => t.groupIds) ? groupOptions.filter(o => pending.targets.some(t => t.groupIds!.includes(o.value))) : groupOptions} value={null} placeholder={`Remove ${label(pending.targets)} from…`} emptyText="Not in any groups" width={280} side={pending.anchor.side} onChange={id => { const targets = pending.targets; setPending(null); if (id) void removeFromGroup(targets, id); }} trigger={anchorPoint(pending.anchor)} />
      )}
      {pending?.kind === 'role' && (
        <OptionPicker
          open
          onOpenChange={close}
          options={roleOptions}
          value={single?.role ?? null}
          placeholder={`Role for ${label(pending.targets)}…`}
          width={240}
          side={pending.anchor.side}
          onChange={role => {
            setPending(null);
            if (role) void changeRole(pending.targets, role);
          }}
          trigger={anchorPoint(pending.anchor)}
        />
      )}
      {pending?.kind === 'manager' && (
        <PersonPicker
          open
          onOpenChange={close}
          value={single?.managerId ? [single.managerId] : []}
          exclude={pending.targets.map(t => t.id)}
          placeholder={`Manager for ${label(pending.targets)}…`}
          side={pending.anchor.side}
          onPeopleSeen={rememberPeople}
          onChange={ids => {
            const targets = pending.targets;
            setPending(null);
            const id = ids[ids.length - 1];
            if (id) void setManager(targets, id, managerNames.get(id));
          }}
          trigger={anchorPoint(pending.anchor)}
        />
      )}
      <DeactivateDialog targets={deactivating} onClose={() => setDeactivating(null)} onDone={onDone} />
    </>
  );

  return { actions, host };
}

// PersonPicker reports the people it has shown; remember names for the toast.
const managerNames = new Map<string, string>();

function DeactivateDialog({ targets, onClose, onDone }: { targets: PersonTarget[] | null; onClose: () => void; onDone?: () => void }) {
  const ws = useWorkspace();
  const writes = usePeopleWrites();
  const [withdraw, setWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = Boolean(targets?.length);
  const n = targets?.length ?? 0;
  const includesMe = targets?.some(t => t.id === ws.me.id);

  const submit = async () => {
    if (!targets?.length || busy) return;
    setBusy(true);
    if (n === 1) await writes.save({ action: 'deactivate', id: targets[0].id, withdrawOpen: withdraw }, { success: res => `Deactivated ${targets[0].name}${res.withdrawn ? ` · withdrew ${res.withdrawn} enrollment${res.withdrawn === 1 ? '' : 's'}` : ''}`, error: "Couldn't deactivate them" });
    else await writes.bulk({ ids: targets.map(t => t.id), action: 'deactivate', withdrawOpen: withdraw }, { verb: 'Deactivated', error: "Couldn't deactivate them" });
    setBusy(false);
    setWithdraw(false);
    onClose();
    onDone?.();
  };

  const choice = (value: boolean, title: string, body: string) => (
    <button type="button" role="radio" aria-checked={withdraw === value} onClick={() => setWithdraw(value)} className={cn('flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors', withdraw === value ? 'border-primary/50 bg-primary/[0.04]' : 'hover:bg-accent/50')}>
      <span className={cn('mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', withdraw === value ? 'border-primary' : 'border-input')}>{withdraw === value && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}</span>
      <span>
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{body}</span>
      </span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={o => !o && !busy && onClose()}>
      <DialogContent
        className="max-w-[460px] gap-0 p-0 sm:rounded-xl"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader className="px-5 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <UserMinus className="h-4 w-4 text-muted-foreground" /> Deactivate {n === 1 ? targets![0].name : peopleCount(n)}?
          </DialogTitle>
          <DialogDescription className="text-[14px]">
            They can’t sign in to {ws.settings.academyName} or this app, stop receiving emails and drop out of reports. Their history and certificates stay, and you can reactivate them any time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 px-5 pb-4" role="radiogroup" aria-label="Unfinished training">
          <div className="text-sm font-medium text-muted-foreground">Withdraw open training?</div>
          {choice(false, 'Keep unfinished training as it is', 'Enrollments stay open in case they come back.')}
          {choice(true, 'Withdraw unfinished training', 'Not-started and in-progress enrollments are withdrawn. Completed training stays on record.')}
          {includesMe && <p className="text-sm text-tone-warning">You’re in this selection — you’ll be skipped. Another admin has to deactivate you.</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t bg-subtle/60 px-5 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => void submit()} className="h-9 rounded-md bg-destructive px-3.5 text-[14px] font-medium text-destructive-foreground shadow-xs hover:bg-destructive/90 disabled:opacity-50">
            {busy ? 'Deactivating…' : 'Deactivate'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Remember names PersonPicker has shown, so a manager toast can name them. */
export function rememberPeople(people: Array<{ id: string; name: string }>) {
  for (const p of people) managerNames.set(p.id, p.name);
}
