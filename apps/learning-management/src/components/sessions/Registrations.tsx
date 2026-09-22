import { Check, ClipboardCheck, Copy, Download, MoreHorizontal, Plus, UserRound, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { downloadText } from '../../lib/download';
import { shortDateTime, timeAgo } from '../../lib/format';
import { MOD, useHotkeys } from '../../lib/hotkeys';
import { useKnownPeople } from '../assignments/knownPeople';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, Kbd, Tip } from '../primitives/bits';
import { PersonPicker } from '../pickers/pickers';
import { REGISTRATION_META, seatsTaken, useSessionActions, type Registration, type RegistrationStatus, type SessionDetail } from './data';
import { sessionPhase } from './time';

const TABS: RegistrationStatus[] = ['Registered', 'Waitlisted', 'Attended', 'Absent', 'Cancelled'];

/** What the row's date means: when they took a seat, joined the queue, or signed up before cancelling. */
const joinedVerb = (status: RegistrationStatus) => (status === 'Waitlisted' ? 'Joined the waitlist' : status === 'Cancelled' ? 'Signed up' : 'Registered');

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Whether attendance can be taken: from an hour before the start, for sessions that went ahead. */
export function attendanceOpen(session: SessionDetail['session']) {
  if (session.status === 'Cancelled' || !session.startsAt) return false;
  return Date.parse(session.startsAt) - 60 * 60_000 <= Date.now();
}

/**
 * Everyone registered for a session, by status, and the attendance roster.
 * Taking attendance is built for speed at the door: J/K to move, A for
 * attended, B for absent, and one click for "everyone who's still registered
 * came".
 */
export function Registrations({ data }: { data: SessionDetail }) {
  const { session, registrations, canManage } = data;
  const app = useAppActions();
  const navigate = useNavigate();
  const { registrations: mutate } = useSessionActions();
  const phase = sessionPhase(session);
  const canTake = canManage && attendanceOpen(session);
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t, registrations.filter(r => r.status === t).length])) as Record<RegistrationStatus, number>, [registrations]);
  const unmarked = counts.Registered;

  const [tab, setTab] = useState<RegistrationStatus>(() => (counts.Registered || !counts.Attended ? 'Registered' : 'Attended'));
  const [attendance, setAttendance] = useState(() => canTake && (phase === 'live' || (phase === 'ended' && unmarked > 0)));
  const [addOpen, setAddOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canTake) setAttendance(false);
  }, [canTake]);

  const roster = useMemo(() => registrations.filter(r => r.status === 'Registered' || r.status === 'Attended' || r.status === 'Absent').sort((a, b) => a.name.localeCompare(b.name)), [registrations]);
  const visible = attendance ? roster : registrations.filter(r => r.status === tab);
  const focusIndex = visible.findIndex(r => r.id === focusedId);

  const focusAt = (i: number) => {
    const r = visible[Math.max(0, Math.min(visible.length - 1, i))];
    if (!r) return;
    setFocusedId(r.id);
    window.setTimeout(() => listRef.current?.querySelector(`[data-registration-id="${r.id}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
  };

  const mark = (rows: Registration[], value: 'Attended' | 'Absent' | 'Registered', opts: { quiet?: boolean } = {}) => {
    const ids = rows.filter(r => r.status !== value && r.status !== 'Cancelled').map(r => r.id);
    if (!ids.length) return;
    mutate({ sessionId: session.id, status: { registrationIds: ids, value } }, opts).catch(() => undefined);
  };
  const cancel = async (rows: Registration[]) => {
    const list = rows.filter(r => r.status === 'Registered' || r.status === 'Waitlisted');
    if (!list.length) return;
    const ok = await app.confirm({
      title: list.length === 1 ? `Cancel ${list[0].name}'s registration?` : `Cancel ${list.length} registrations?`,
      description: list.some(r => r.status === 'Registered') && session.counts.waitlisted ? 'Their seat goes to the next person on the waitlist, who is told right away.' : 'They can register again from the academy while seats are open.',
      confirmLabel: 'Cancel registration',
      destructive: true,
    });
    if (ok) mutate({ sessionId: session.id, cancel: list.map(r => r.id) }).catch(() => undefined);
  };

  useHotkeys(
    {
      j: () => focusAt(focusIndex + 1),
      down: () => focusAt(focusIndex + 1),
      k: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
      up: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
      a: () => {
        if (!attendance || focusIndex < 0) return;
        mark([visible[focusIndex]], 'Attended', { quiet: true });
        focusAt(focusIndex + 1);
      },
      b: () => {
        if (!attendance || focusIndex < 0) return;
        mark([visible[focusIndex]], 'Absent', { quiet: true });
        focusAt(focusIndex + 1);
      },
      enter: () => focusIndex >= 0 && navigate(`/people/${visible[focusIndex].personId}`),
      esc: () => setFocusedId(null),
    },
    { enabled: canManage },
  );

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Job title', 'Status', 'Registered', 'Checked in'];
    const lines = registrations.map(r => [r.name, r.email, r.title ?? '', r.status, r.registeredAt ?? '', r.checkedInAt ?? ''].map(csvCell).join(','));
    const safe = session.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    downloadText(`attendance-${safe}-${(session.startsAt ?? '').slice(0, 10)}.csv`, [header.join(','), ...lines].join('\n'));
    toast.success(`Exported ${registrations.length} registration${registrations.length === 1 ? '' : 's'}`);
  };

  const marked = counts.Attended + counts.Absent;

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card lg:self-start">
      <header className="flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        {attendance ? (
          <div className="flex min-w-0 items-center gap-2 pl-1">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            <span className="text-[14px] font-medium">Attendance</span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {marked} of {roster.length} marked · <span className="text-tone-success">{counts.Attended} attended</span> · <span className={counts.Absent ? 'text-tone-danger' : undefined}>{counts.Absent} absent</span>
            </span>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none" role="tablist" aria-label="Registration status">
            {TABS.filter(t => t === 'Registered' || t === tab || counts[t] > 0).map(t => {
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => {
                    setTab(t);
                    setFocusedId(null);
                  }}
                  className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13.5px] transition-colors', tab === t ? 'border-border bg-accent font-medium text-foreground shadow-2xs' : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground')}
                >
                  {REGISTRATION_META[t].label}
                  {counts[t] > 0 && <span className="tabular-nums text-muted-foreground">{counts[t]}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {canTake && (
            <button
              type="button"
              onClick={() => {
                setAttendance(a => !a);
                setFocusedId(null);
              }}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13.5px] shadow-2xs transition-colors', attendance ? 'bg-primary font-medium text-primary-foreground hover:bg-primary/90' : 'border bg-background hover:bg-accent')}
            >
              {attendance ? null : <ClipboardCheck className="h-3.5 w-3.5" />}
              {attendance ? 'Done' : 'Take attendance'}
            </button>
          )}
          {canManage && session.status !== 'Cancelled' && !attendance && (
            <button type="button" onClick={() => setAddOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
              <Plus className="h-3.5 w-3.5" /> Add people
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="More registration actions">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem className="gap-2 text-[14px]" disabled={!registrations.length} onSelect={exportCsv}>
                <Download className="h-3.5 w-3.5" /> Export attendance CSV
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-[14px]" disabled={!visible.length} onSelect={() => copyText(visible.map(r => r.email).filter(Boolean).join(', '), `Copied ${visible.length} email${visible.length === 1 ? '' : 's'}`)}>
                <Copy className="h-3.5 w-3.5" /> Copy emails in this list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {attendance && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-subtle/50 px-4 py-2 text-sm text-muted-foreground">
          <span>
            {session.lessonTitle ? (
              <>
                Attended completes <span className="font-medium text-foreground">“{session.lessonTitle}”</span>. Completion is final — switching someone to absent later won’t undo it.
              </>
            ) : (
              'This session isn’t linked to a lesson, so attendance is recorded but completes nothing.'
            )}
          </span>
          <span className="hidden items-center gap-1 md:inline-flex">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> move · <Kbd>A</Kbd> attended · <Kbd>B</Kbd> absent
          </span>
          {unmarked > 0 && (
            <button type="button" onClick={() => mark(roster.filter(r => r.status === 'Registered'), 'Attended')} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
              <Check className="h-3.5 w-3.5" /> Mark all {unmarked} registered as attended
            </button>
          )}
        </div>
      )}

      <div ref={listRef} role="grid" aria-label={attendance ? 'Attendance roster' : `${tab} people`}>
        {visible.length === 0 ? (
          attendance ? (
            <EmptyState icon={<Users />} title="Nobody to mark" description="Add the people who came, then mark them attended." className="py-10" />
          ) : tab === 'Registered' ? (
            <EmptyState
              icon={<Users />}
              title={session.status === 'Cancelled' ? 'This session was cancelled' : 'No one has registered yet'}
              description={session.status === 'Cancelled' ? 'Registrations were cancelled and people were told.' : 'People register from the academy, or you can add them here.'}
              action={canManage && session.status !== 'Cancelled' ? <button type="button" onClick={() => setAddOpen(true)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">Add people</button> : undefined}
              className="py-10"
            />
          ) : (
            <EmptyState icon={<Users />} title={`No one ${tab.toLowerCase()}`} className="py-10" />
          )
        ) : (
          visible.map(r => {
            const queue = r.status === 'Waitlisted' ? registrations.filter(x => x.status === 'Waitlisted').findIndex(x => x.id === r.id) + 1 : 0;
            const focused = focusedId === r.id;
            return (
              <div
                key={r.id}
                role="row"
                data-registration-id={r.id}
                onMouseMove={() => !focused && setFocusedId(r.id)}
                className={cn('group/row relative flex items-center gap-3 border-b border-border/60 px-4 text-[14px] last:border-b-0', attendance ? 'min-h-[52px] py-2' : 'h-11', focused ? 'bg-accent/70' : 'hover:bg-accent/40')}
              >
                {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
                {queue > 0 && <span className="w-5 shrink-0 text-right text-sm tabular-nums text-muted-foreground">#{queue}</span>}
                <PersonAvatar person={{ name: r.name, color: r.color, avatarUrl: r.avatarUrl, status: r.personStatus }} size={attendance ? 26 : 22} />
                <button type="button" onClick={() => navigate(`/people/${r.personId}`)} className="min-w-0 flex-1 text-left">
                  <span className={cn('block truncate font-medium hover:underline', r.personStatus === 'Deactivated' && 'text-muted-foreground')}>{r.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{r.title || r.email}</span>
                </button>
                {!attendance && (
                  <span className="hidden shrink-0 text-sm text-muted-foreground sm:block">
                    <Tip label={r.checkedInAt ? `Checked in ${shortDateTime(r.checkedInAt)}` : r.registeredAt ? `${joinedVerb(r.status)} ${shortDateTime(r.registeredAt)}` : REGISTRATION_META[r.status].label}>
                      <span>{r.checkedInAt ? `Checked in ${timeAgo(r.checkedInAt)}` : r.registeredAt ? `${joinedVerb(r.status)} ${timeAgo(r.registeredAt)}` : ''}</span>
                    </Tip>
                  </span>
                )}
                {attendance ? (
                  <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label={`Attendance for ${r.name}`}>
                    <button
                      type="button"
                      aria-pressed={r.status === 'Attended'}
                      onClick={() => mark([r], r.status === 'Attended' ? 'Registered' : 'Attended', { quiet: true })}
                      title={r.status === 'Attended' ? 'Click again to clear' : undefined}
                      className={cn('inline-flex h-9 min-w-[104px] items-center justify-center gap-1.5 rounded-lg border px-3 text-[14px] font-medium transition-colors', r.status === 'Attended' ? 'border-tone-success/40 bg-tone-success/[0.12] text-tone-success' : 'bg-background hover:border-tone-success/40 hover:bg-tone-success/[0.06]')}
                    >
                      <Check className="h-4 w-4" /> Attended
                    </button>
                    <button
                      type="button"
                      aria-pressed={r.status === 'Absent'}
                      onClick={() => mark([r], r.status === 'Absent' ? 'Registered' : 'Absent', { quiet: true })}
                      className={cn('inline-flex h-9 min-w-[88px] items-center justify-center gap-1.5 rounded-lg border px-3 text-[14px] font-medium transition-colors', r.status === 'Absent' ? 'border-tone-danger/40 bg-tone-danger/[0.1] text-tone-danger' : 'bg-background hover:border-tone-danger/40 hover:bg-tone-danger/[0.05]')}
                    >
                      <X className="h-4 w-4" /> Absent
                    </button>
                  </div>
                ) : null}
                {canManage && !attendance && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton size="sm" aria-label={`Actions for ${r.name}`} className="opacity-60 group-hover/row:opacity-100 data-[state=open]:opacity-100">
                        <MoreHorizontal />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {canTake && r.status !== 'Cancelled' && (
                        <>
                          {r.status !== 'Attended' && (
                            <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => mark([r], 'Attended')}>
                              <Check className="h-3.5 w-3.5" /> Mark attended
                            </DropdownMenuItem>
                          )}
                          {r.status !== 'Absent' && (
                            <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => mark([r], 'Absent')}>
                              <X className="h-3.5 w-3.5" /> Mark absent
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                      {r.status === 'Waitlisted' && (
                        <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => mark([r], 'Registered')}>
                          <Plus className="h-3.5 w-3.5" /> Give them a seat{session.capacity != null && seatsTaken(session.counts) >= session.capacity ? ' (over capacity)' : ''}
                        </DropdownMenuItem>
                      )}
                      {(r.status === 'Attended' || r.status === 'Absent') && (
                        <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => mark([r], 'Registered')}>
                          <UserRound className="h-3.5 w-3.5" /> Clear attendance
                        </DropdownMenuItem>
                      )}
                      {r.status === 'Cancelled' && session.status !== 'Cancelled' && (
                        <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => mutate({ sessionId: session.id, add: [r.personId] }).catch(() => undefined)}>
                          <Plus className="h-3.5 w-3.5" /> Register again
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => navigate(`/people/${r.personId}`)}>
                        <UserRound className="h-3.5 w-3.5" /> Open profile
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => copyText(r.email, 'Copied email')}>
                        <Copy className="h-3.5 w-3.5" /> Copy email
                      </DropdownMenuItem>
                      {(r.status === 'Registered' || r.status === 'Waitlisted') && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="gap-2 text-[14px] text-destructive focus:text-destructive" onSelect={() => cancel([r])}>
                            <X className="h-3.5 w-3.5" /> Cancel registration…
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })
        )}
      </div>

      <AddPeopleDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        data={data}
        onAdded={res => {
          // Show the people just added, wherever the list was.
          setTab(res.added || !res.waitlisted ? 'Registered' : 'Waitlisted');
          setFocusedId(null);
        }}
      />
    </section>
  );
}

function AddPeopleDialog({ open, onOpenChange, data, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; data: SessionDetail; onAdded: (res: { added: number; waitlisted: number }) => void }) {
  const { session, registrations } = data;
  const { registrations: mutate } = useSessionActions();
  const [ids, setIds] = useState<string[]>([]);
  const { known, remember } = useKnownPeople(ids, open);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setIds([]);
      setBusy(false);
      window.setTimeout(() => setPickerOpen(true), 120);
    } else setPickerOpen(false);
  }, [open]);

  const already = useMemo(() => registrations.filter(r => r.status !== 'Cancelled').map(r => r.personId), [registrations]);
  const taken = seatsTaken(session.counts);
  const left = session.capacity == null ? Infinity : Math.max(0, session.capacity - taken);
  const willWaitlist = Number.isFinite(left) ? Math.max(0, ids.length - left) : 0;
  const ended = sessionPhase(session) === 'ended';

  const submit = async () => {
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      const res = await mutate({ sessionId: session.id, add: ids });
      onAdded(res);
      onOpenChange(false);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[500px] gap-0 p-0 sm:rounded-xl"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader className="border-b px-5 pb-3.5 pt-4 text-left">
          <DialogTitle className="text-[16px]">Add people to {session.title}</DialogTitle>
          <DialogDescription className="text-[14px]">
            {session.capacity == null ? 'No seat limit.' : left > 0 ? `${left} of ${session.capacity} seats left.` : `All ${session.capacity} seats are taken — new people join the waitlist.`}
            {ended ? ' The session has ended, so nobody is emailed.' : ' Each person gets the “Session registered” email.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <div className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background p-2">
            {ids.map((id, i) => {
              const p = known.get(id);
              const waitlisted = Number.isFinite(left) && i >= left;
              return (
                <span key={id} className={cn('chip h-8 bg-subtle pl-1 pr-1', waitlisted && 'border-tone-warning/40')}>
                  <PersonAvatar person={p ?? { name: '…' }} size={18} />
                  {p?.name ?? 'Loading…'}
                  {waitlisted && <span className="text-2xs text-tone-warning">waitlist</span>}
                  <button type="button" onClick={() => setIds(list => list.filter(x => x !== id))} aria-label={`Remove ${p?.name ?? 'person'}`} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <PersonPicker
              multiple
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              value={ids}
              onChange={setIds}
              exclude={already}
              onPeopleSeen={remember}
              trigger={
                <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-2 text-[13.5px] text-muted-foreground hover:border-foreground/30 hover:text-foreground">
                  <Plus className="h-3.5 w-3.5" /> {ids.length ? 'More people' : 'Choose people'}
                </button>
              }
            />
          </div>
          {willWaitlist > 0 && (
            <p className="text-sm text-tone-warning">
              {willWaitlist} {willWaitlist === 1 ? 'person' : 'people'} will be waitlisted and move up in order as seats free.
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t bg-subtle/60 px-5 py-3">
          <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Kbd>{MOD}</Kbd>
            <Kbd>↵</Kbd> to add
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
              Cancel
            </button>
            <button type="button" disabled={!ids.length || busy} onClick={submit} className="h-9 rounded-md bg-primary px-3.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
              {busy ? 'Adding…' : ids.length ? `Add ${ids.length} ${ids.length === 1 ? 'person' : 'people'}` : 'Add people'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
