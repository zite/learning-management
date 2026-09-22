import { CalendarDays, ChevronDown, Lock, Plus, UsersRound, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { longDate, shortDate, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { GroupPicker, PersonPicker, DatePicker } from '../pickers/pickers';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, LabelDot } from '../primitives/bits';
import { rememberPeople, type usePeopleActions } from './PeopleActions';
import { inputCls, PersonStatusPill } from './PeopleBits';
import { peopleCount, pk, ROLE_INFO, usePeopleWrites, type PersonDetail, type Role } from './peopleData';

function Row({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-x-6 gap-y-1.5 px-4 py-3 sm:grid-cols-[160px_minmax(0,1fr)]">
      <label htmlFor={htmlFor} className="pt-1.5 text-[14px] text-muted-foreground">
        {label}
      </label>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** A text field that saves when you leave it (or press Enter), and reverts on Escape. */
function InlineText({ id, value, onSave, placeholder, disabled, multiline, maxLength, required }: { id: string; value: string; onSave: (v: string) => Promise<unknown> | void; placeholder?: string; disabled?: boolean; multiline?: boolean; maxLength: number; required?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() === value.trim()) return;
    if (required && !draft.trim()) {
      setDraft(value);
      return;
    }
    void onSave(draft.trim());
  };
  const common = {
    id,
    value: draft,
    disabled,
    placeholder,
    maxLength,
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        setDraft(value);
        (e.target as HTMLElement).blur();
      }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      }
    },
  };
  return multiline ? (
    <textarea {...common} rows={3} onChange={e => setDraft(e.target.value)} className={cn(inputCls, 'h-auto resize-y py-1.5 leading-5')} />
  ) : (
    <input {...common} onChange={e => setDraft(e.target.value)} className={inputCls} />
  );
}

/**
 * The editable profile. Text saves as you leave each field; pickers save when
 * you choose. Group changes apply that group's assignment rules immediately.
 */
export function PersonProfile({ data, actions }: { data: PersonDetail; actions: ReturnType<typeof usePeopleActions>['actions'] }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const writes = usePeopleWrites();
  const p = data.person;
  const canEdit = data.canEdit;

  const patchCache = (patch: Partial<PersonDetail['person']>, extra: Partial<PersonDetail> = {}) =>
    qc.setQueryData<PersonDetail>(pk.person(p.id), old => (old ? { ...old, ...extra, person: { ...old.person, ...patch } } : old));

  const saveField = async (patch: { name?: string; title?: string; externalId?: string; bio?: string; hireDate?: string | null; muteEmails?: boolean }) => {
    const before = qc.getQueryData<PersonDetail>(pk.person(p.id));
    patchCache({ ...patch, title: patch.title === undefined ? p.title : patch.title || null, externalId: patch.externalId === undefined ? p.externalId : patch.externalId || null } as Partial<PersonDetail['person']>);
    const res = await writes.save({ action: 'update', id: p.id, ...patch }, { error: "Couldn't save that change" });
    if (!res && before) qc.setQueryData(pk.person(p.id), before);
  };

  const target = { id: p.id, name: p.name, email: p.email, role: p.role, status: p.status, managerId: p.managerId, lastActiveAt: data.stats.lastActiveAt };
  const groupIds = data.groups.map(g => g.id);

  return (
    <div className="grid w-full max-w-[1120px] gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="min-w-0">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-medium">Profile</h2>
          {!canEdit && (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Lock className="h-3 w-3" /> Only admins can edit profiles
            </span>
          )}
        </div>
        <div className="divide-y rounded-xl border bg-card">
          <Row label="Name" htmlFor="profile-name">
            <InlineText id="profile-name" value={p.name} maxLength={120} required disabled={!canEdit} onSave={v => saveField({ name: v })} />
          </Row>
          <Row label="Job title" htmlFor="profile-title">
            <InlineText id="profile-title" value={p.title ?? ''} maxLength={160} placeholder="e.g. Store Manager" disabled={!canEdit} onSave={v => saveField({ title: v })} />
          </Row>
          <Row label="Email" htmlFor="profile-email" hint="Email is how they sign in, so it can’t be changed here. For a new address, add them again with it and deactivate this profile.">
            <input id="profile-email" value={p.email} readOnly disabled className={inputCls} />
          </Row>
          <Row label="Role" hint={ROLE_INFO[p.role].description}>
            <div className="flex max-w-[360px] rounded-lg border p-0.5" role="radiogroup" aria-label="Role">
              {(['Learner', 'Instructor', 'Admin'] as Role[]).map(r => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={p.role === r}
                  disabled={!canEdit}
                  onClick={() => actions.changeRole([target], r)}
                  className={cn('flex h-8 flex-1 items-center justify-center rounded-md text-[13.5px] transition-colors disabled:cursor-not-allowed', p.role === r ? 'bg-accent font-medium text-foreground shadow-2xs' : 'text-muted-foreground enabled:hover:text-foreground')}
                >
                  {r}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Manager">
            <div className="flex max-w-[360px] items-center gap-1.5">
              <PersonPicker
                value={p.managerId ? [p.managerId] : []}
                exclude={[p.id]}
                onPeopleSeen={rememberPeople}
                placeholder={`Who does ${p.name.split(' ')[0]} report to?`}
                onChange={ids => {
                  const id = ids[ids.length - 1];
                  if (id && id !== p.managerId) void actions.setManager([target], id);
                }}
                trigger={
                  <button type="button" disabled={!canEdit} className={cn(inputCls, 'flex items-center gap-2 text-left')}>
                    {data.manager && <PersonAvatar person={data.manager} size={18} />}
                    <span className={cn('flex-1 truncate', !data.manager && 'text-muted-foreground')}>{data.manager?.name ?? 'No manager'}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                }
              />
              {canEdit && data.manager && (
                <button type="button" onClick={() => actions.setManager([target], null)} aria-label="Remove manager" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </Row>
          <Row label="Groups" hint={canEdit ? 'Joining a group applies its assignment rules straight away.' : undefined}>
            <div className="flex min-h-9 flex-wrap items-center gap-1.5">
              {groupIds.map(id => {
                const g = ws.groupById.get(id);
                if (!g) return null;
                return (
                  <span key={id} className="chip h-8 bg-background pr-1">
                    <LabelDot color={g.color} />
                    <Link to={`/groups/${g.id}`} className="hover:underline">
                      {g.name}
                    </Link>
                    {canEdit && (
                      <button type="button" onClick={() => void writes.save({ action: 'update', id: p.id, groupIds: groupIds.filter(x => x !== id) }, { success: `Removed from ${g.name}`, error: "Couldn't change groups" })} aria-label={`Remove from ${g.name}`} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                );
              })}
              {canEdit ? (
                <GroupPicker
                  value={groupIds}
                  onChange={next => {
                    const added = next.filter(id => !groupIds.includes(id));
                    const removed = groupIds.filter(id => !next.includes(id));
                    const name = (id: string) => ws.groupById.get(id)?.name ?? 'group';
                    const msg = added.length && !removed.length ? `Added to ${added.map(name).join(', ')}` : removed.length && !added.length ? `Removed from ${removed.map(name).join(', ')}` : 'Groups updated';
                    void writes.save({ action: 'update', id: p.id, groupIds: next }, { success: msg, error: "Couldn't change groups" });
                  }}
                  trigger={
                    <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-2 text-[13.5px] text-muted-foreground hover:border-foreground/30 hover:text-foreground">
                      {groupIds.length ? <Plus className="h-3.5 w-3.5" /> : <UsersRound className="h-3.5 w-3.5" />} {groupIds.length ? 'Add' : 'Add to a group'}
                    </button>
                  }
                />
              ) : (
                !groupIds.length && <span className="text-[14px] text-muted-foreground">Not in any groups</span>
              )}
            </div>
          </Row>
          <Row label="Hire date">
            <DatePicker
              allowPast
              presets={false}
              value={p.hireDate}
              clearLabel="Remove hire date"
              onChange={d => void saveField({ hireDate: d })}
              trigger={
                <button type="button" disabled={!canEdit} className={cn(inputCls, 'flex max-w-[360px] items-center gap-2 text-left')}>
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className={cn(!p.hireDate && 'text-muted-foreground')}>{p.hireDate ? longDate(p.hireDate) : 'Not set'}</span>
                </button>
              }
            />
          </Row>
          <Row label="Employee ID" htmlFor="profile-external" hint="The ID from your HR system, used to match imports and exports.">
            <InlineText id="profile-external" value={p.externalId ?? ''} maxLength={120} placeholder="e.g. E-1044" disabled={!canEdit} onSave={v => saveField({ externalId: v })} />
          </Row>
          <Row label="About" htmlFor="profile-bio">
            <InlineText id="profile-bio" value={p.bio} maxLength={2000} multiline placeholder={canEdit ? 'A short bio, shown to learners when they teach' : 'No bio'} disabled={!canEdit} onSave={v => saveField({ bio: v })} />
          </Row>
          <Row label="Email notifications" hint={p.muteEmails ? 'Muted: reminders and updates arrive in the academy only. Invitations still send.' : 'Assignment, reminder, grade and certificate emails are on.'}>
            <Switch checked={!p.muteEmails} disabled={!canEdit} onCheckedChange={on => void saveField({ muteEmails: !on })} aria-label="Email notifications" className="mt-1" />
          </Row>
        </div>
      </section>

      <aside className="min-w-0 space-y-6">
        <section>
          <h2 className="mb-2 text-[14px] font-medium">
            Direct reports {data.reports.length > 0 && <span className="font-normal tabular-nums text-muted-foreground">{data.reports.length}</span>}
          </h2>
          {data.reports.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-5 text-center text-[14px] text-muted-foreground">Nobody reports to {p.name.split(' ')[0]}.</div>
          ) : (
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {data.reports.map(r => (
                <li key={r.id}>
                  <Link to={`/people/${r.id}`} className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent/50">
                    <PersonAvatar person={r} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[14px]', r.status === 'Deactivated' && 'text-muted-foreground')}>{r.name}</span>
                      <span className="block truncate text-2xs text-muted-foreground">{r.title ?? '—'}</span>
                    </span>
                    {r.overdue > 0 ? <span className="shrink-0 rounded-full bg-tone-danger/[0.1] px-1.5 text-2xs font-medium tabular-nums text-tone-danger">{r.overdue} overdue</span> : r.status !== 'Active' ? <PersonStatusPill status={r.status} /> : <span className="shrink-0 text-2xs text-muted-foreground">{r.active ? `${r.active} active` : 'All done'}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data.reports.length > 0 && (
            <Link to={`/people?manager=${p.id}`} className="mt-1.5 inline-block px-1 text-sm text-muted-foreground hover:text-foreground">
              See {peopleCount(data.reports.length)} in People →
            </Link>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-[14px] font-medium">Access</h2>
          <dl className="space-y-2 rounded-xl border bg-card px-4 py-3 text-[14px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{p.status === 'Active' ? 'Active' : <PersonStatusPill status={p.status} />}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Added</dt>
              <dd>{p.createdAt ? shortDate(p.createdAt) : '—'}</dd>
            </div>
            {p.invitedAt && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Invited</dt>
                <dd>{shortDate(p.invitedAt)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Last in {ws.settings.academyName}</dt>
              <dd className="shrink-0">{p.lastLearnedAt ? timeAgo(p.lastLearnedAt) : 'Never'}</dd>
            </div>
            {(p.role !== 'Learner' || p.lastSeenAt) && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Last in this app</dt>
                <dd>{p.lastSeenAt ? timeAgo(p.lastSeenAt) : 'Never'}</dd>
              </div>
            )}
            {canEdit && !data.isMe && (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {p.status !== 'Deactivated' && !data.stats.lastActiveAt && (
                  <button type="button" onClick={() => actions.resendInvites([target])} className="h-8 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
                    Resend invitation
                  </button>
                )}
                {p.status === 'Deactivated' ? (
                  <button type="button" onClick={() => actions.reactivate([target])} className="h-8 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
                    Reactivate
                  </button>
                ) : (
                  <button type="button" onClick={() => actions.deactivate([target])} className="h-8 rounded-md border border-destructive/30 bg-background px-2.5 text-[13.5px] text-destructive shadow-2xs hover:bg-destructive/[0.06]">
                    Deactivate…
                  </button>
                )}
              </div>
            )}
          </dl>
        </section>
      </aside>
    </div>
  );
}

export function PersonNotFound() {
  return <EmptyState title="This person isn’t here" description="They may have been removed, or the link is wrong." action={<Link to="/people" className="text-[14px] text-primary hover:underline">Back to People</Link>} />;
}
