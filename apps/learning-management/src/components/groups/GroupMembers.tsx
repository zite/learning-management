import { ArrowUpRight, GraduationCap, Search, UserMinus, UserPlus, UsersRound, Workflow, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { shortDate } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { useWorkspace } from '../../lib/workspace';
import { PersonPicker } from '../pickers/pickers';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, Kbd, SkeletonRows, Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { PEOPLE_COL, PersonStatusPill, RoleBadge, SelectBox, TRAINING_HINT, TrainingCells } from '../people/PeopleBits';
import { peopleCount, usePeopleWrites, type GroupDetail, type GroupMember } from '../people/peopleData';

/** Add people to a group: pick several, and they're added when the picker closes. */
export function AddMembersButton({ group, existingIds, className, label = 'Add people' }: { group: GroupDetail['group']; existingIds: string[]; className?: string; label?: string }) {
  const writes = usePeopleWrites();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <PersonPicker
      multiple
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (!o && picked.length) {
          void writes.members(group.id, group.name, { add: picked });
          setPicked([]);
        }
      }}
      value={picked}
      onChange={setPicked}
      exclude={existingIds}
      placeholder={`Add people to ${group.name}…`}
      trigger={
        <button type="button" className={className}>
          <UserPlus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{picked.length ? `Add ${picked.length}` : label}</span>
        </button>
      }
    />
  );
}

export function GroupRules({ rules, groupId }: { rules: GroupDetail['rules']; groupId: string }) {
  const ws = useWorkspace();
  const own = rules.filter(r => r.audience === 'Groups');
  const everyone = rules.filter(r => r.audience === 'Everyone');
  const item = (r: GroupDetail['rules'][number]) => {
    const target = r.targetType === 'Course' ? ws.courseById.get(r.courseId ?? '') : ws.pathById.get(r.pathId ?? '');
    return (
      <li key={r.id}>
        <Link to={`/assignments/${r.id}`} className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60">
          <CourseGlyph icon={target?.icon} color={target?.color} size={18} className="mt-px" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[14px]">{r.name}</span>
              {r.status !== 'Active' && <span className="shrink-0 rounded-full bg-muted px-1.5 text-2xs text-muted-foreground">{r.status}</span>}
            </span>
            <span className="block truncate text-2xs text-muted-foreground">
              {target?.title ?? 'Unknown'} · {r.dueLabel}
              {r.recurrenceMonths ? ` · every ${r.recurrenceMonths} months` : ''}
              {r.audience === 'Groups' && r.groupIds.length > 1 ? ` · +${r.groupIds.filter(id => id !== groupId).length} other group${r.groupIds.length > 2 ? 's' : ''}` : ''}
            </span>
          </span>
          <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </Link>
      </li>
    );
  };
  return (
    <div className="space-y-3">
      {own.length ? (
        <ul className="-mx-2 space-y-0.5">{own.map(item)}</ul>
      ) : (
        <div className="text-[14px] text-muted-foreground">
          <p>No rules target this group yet.</p>
          <Link to="/assignments" className="mt-1 inline-flex items-center gap-1 text-[14px] text-foreground hover:underline">
            Create an assignment rule <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      )}
      {everyone.length > 0 && (
        <div>
          <div className="mb-1 text-sm text-muted-foreground">Also required of everyone</div>
          <ul className="-mx-2 space-y-0.5">{everyone.map(item)}</ul>
        </div>
      )}
    </div>
  );
}

type Props = {
  detail: GroupDetail;
  members: GroupMember[];
  total: number;
  q: string;
  onSearch: (q: string) => void;
  loading: boolean;
  fetchingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
};

export function GroupMembers({ detail, members, total, q, onSearch, loading, fetchingMore, hasMore, onLoadMore }: Props) {
  const app = useAppActions();
  const navigate = useNavigate();
  const writes = usePeopleWrites();
  const { group } = detail;
  const canManage = detail.canManageMembers;
  const [text, setText] = useState(q);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => text.trim() !== q && onSearch(text.trim()), 220);
    return () => window.clearTimeout(t);
  }, [text]);
  const byId = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  useEffect(() => setSelection(prev => new Set([...prev].filter(id => byId.has(id)))), [byId]);
  const selected = members.filter(m => selection.has(m.id));

  const remove = async (list: GroupMember[]) => {
    if (!list.length) return;
    const ok = await app.confirm({
      title: list.length === 1 ? `Remove ${list[0].name} from ${group.name}?` : `Remove ${peopleCount(list.length)} from ${group.name}?`,
      description: 'Training they were already enrolled in stays as it is. They stop receiving this group’s future assignments.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await writes.members(group.id, group.name, { remove: list.map(m => m.id) });
    setSelection(new Set());
  };

  const toggle = (m: GroupMember, e?: MouseEvent) => {
    e?.stopPropagation();
    setSelection(prev => {
      const next = new Set(prev);
      if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      return next;
    });
  };
  const idx = members.findIndex(m => m.id === focused);
  const move = (d: number) => {
    const next = members[Math.max(0, Math.min(members.length - 1, idx < 0 ? 0 : idx + d))];
    if (!next) return;
    setFocused(next.id);
    scrollRef.current?.querySelector(`[data-member-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const focusedMember = focused ? byId.get(focused) : undefined;
  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    down: () => move(1),
    up: () => move(-1),
    enter: () => focusedMember && navigate(`/people/${focusedMember.id}`),
    x: () => focusedMember && toggle(focusedMember),
    'mod+a': () => setSelection(new Set(members.map(m => m.id))),
    esc: () => (selection.size ? setSelection(new Set()) : setFocused(null)),
    '/': () => searchRef.current?.focus(),
    backspace: () => canManage && (selection.size ? remove(selected) : focusedMember && remove([focusedMember])),
  });

  const done = detail.stats.enrolled ? Math.round((detail.stats.completed / detail.stats.enrolled) * 100) : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto lg:flex lg:flex-row lg:overflow-hidden">
      <div className="relative flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
        <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
          <div className="flex h-8 w-full items-center gap-1.5 rounded-md border bg-background px-2 focus-within:border-foreground/30 sm:w-56">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input ref={searchRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Escape' && (setText(''), e.currentTarget.blur())} placeholder="Search members" aria-label="Search members" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
            {text ? (
              <button type="button" aria-label="Clear search" onClick={() => setText('')} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <Kbd className="hidden sm:inline-flex">/</Kbd>
            )}
          </div>
          <span className="ml-auto text-sm tabular-nums text-muted-foreground">
            {peopleCount(total)}
            {detail.deactivatedCount > 0 && !q && ` · ${detail.deactivatedCount} deactivated`}
          </span>
        </div>

        <div ref={scrollRef} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto" role="grid" aria-label="Members">
          {loading ? (
            <SkeletonRows rows={8} className="pt-2" />
          ) : !members.length ? (
            q ? (
              <EmptyState icon={<Search />} title="No members match" description="Try part of a name, email or job title." />
            ) : (
              <EmptyState icon={<UsersRound />} title={`No one is in ${group.name} yet`} description="Add people here, from their profile, or with a CSV import. Assignment rules for this group enroll them automatically." action={canManage ? <AddMembersButton group={group} existingIds={[]} label="Add people" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 [&>span]:inline" /> : undefined} />
            )
          ) : (
            <div className="pb-4 lg:pb-24">
              <div role="row" className="sticky top-0 z-10 flex h-9 items-center gap-2.5 border-b bg-subtle/95 pl-2 pr-3 text-sm text-muted-foreground backdrop-blur-sm">
                {canManage ? <SelectBox checked={members.length > 0 && selection.size === members.length} visible={selection.size > 0} onToggle={() => setSelection(selection.size === members.length ? new Set() : new Set(members.map(m => m.id)))} label={selection.size === members.length ? 'Deselect all' : 'Select all loaded'} /> : <span className="w-4 shrink-0" />}
                <span className="w-[22px] shrink-0" />
                <span className="min-w-0 flex-1">Name</span>
                {([['Open', TRAINING_HINT.open, PEOPLE_COL.open], ['Overdue', TRAINING_HINT.overdue, PEOPLE_COL.overdue], ['Completed', TRAINING_HINT.completed, PEOPLE_COL.completed], ['Joined', `When they joined ${group.name}`, PEOPLE_COL.added]] as const).map(([label, hint, cls]) => (
                  <span key={label} className={cls}>
                    <Tip label={hint}>
                      <span className="cursor-default">{label}</span>
                    </Tip>
                  </span>
                ))}
                {canManage && <span className="w-6 shrink-0" />}
              </div>
              {members.map(m => {
                const isSelected = selection.has(m.id);
                return (
                  <div
                    key={m.id}
                    role="row"
                    data-member-id={m.id}
                    aria-selected={isSelected}
                    onMouseMove={() => focused !== m.id && setFocused(m.id)}
                    onClick={e => (selection.size || e.metaKey || e.ctrlKey ? toggle(m) : navigate(`/people/${m.id}`))}
                    className={cn('group/row relative flex h-10 cursor-default items-center gap-2.5 border-b border-border/60 pl-2 pr-3 text-[14px] transition-colors', focused === m.id ? 'bg-accent/80' : 'hover:bg-accent/50', isSelected && 'bg-primary/[0.07]')}
                  >
                    {focused === m.id && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
                    {canManage ? <SelectBox checked={isSelected} visible={selection.size > 0} onToggle={e => toggle(m, e)} label={`Select ${m.name}`} /> : <span className="w-4" />}
                    <PersonAvatar person={m} size={22} />
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className={cn('truncate', m.status === 'Deactivated' && 'text-muted-foreground')}>{m.name}</span>
                      {m.title && <span className="hidden truncate text-[13.5px] text-muted-foreground md:inline">{m.title}</span>}
                      <RoleBadge role={m.role} />
                      <PersonStatusPill status={m.status} />
                    </span>
                    <TrainingCells active={m.counts.active} overdue={m.counts.overdue} completed={m.counts.completed} name={m.name} />
                    <span className={PEOPLE_COL.added}>
                      <Tip label={m.addedAt ? `Joined ${group.name} ${shortDate(m.addedAt)}` : 'Joined date unknown'}>
                        <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{m.addedAt ? shortDate(m.addedAt) : '—'}</span>
                      </Tip>
                    </span>
                    {canManage && (
                      <span className="flex w-6 shrink-0 justify-end">
                        <Tip label={`Remove from ${group.name}`}>
                          <IconButton
                            size="sm"
                            aria-label={`Remove ${m.name} from ${group.name}`}
                            onClick={e => {
                              e.stopPropagation();
                              void remove([m]);
                            }}
                            className="opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
                          >
                            <X />
                          </IconButton>
                        </Tip>
                      </span>
                    )}
                  </div>
                );
              })}
              {hasMore && (
                <div className="flex justify-center py-4">
                  <button type="button" onClick={onLoadMore} disabled={fetchingMore} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent disabled:opacity-60">
                    {fetchingMore ? 'Loading…' : `Load more · ${(total - members.length).toLocaleString()} left`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {selected.length > 0 && (
          <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 lg:absolute flex justify-center px-3">
            <div role="toolbar" aria-label="Member actions" className="pointer-events-auto flex items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-xl animate-fade-up">
              <div className="flex h-9 items-center gap-2 border-r pl-2.5 pr-2">
                <span className="whitespace-nowrap text-[14px] font-medium tabular-nums">{selected.length} selected</span>
                <button type="button" onClick={() => setSelection(new Set())} aria-label="Clear selection" className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <button type="button" className="ghost-chip h-9 gap-1.5 px-2.5 text-[14px]" onClick={() => app.openEnroll({ personIds: selected.filter(m => m.status !== 'Deactivated').map(m => m.id) })}>
                <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" /> Enroll…
              </button>
              <button type="button" className="ghost-chip h-9 gap-1.5 px-2.5 text-[14px] text-destructive" onClick={() => void remove(selected)}>
                <UserMinus className="h-3.5 w-3.5" /> Remove from group
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="shrink-0 border-t lg:w-[320px] lg:overflow-y-auto lg:border-l lg:border-t-0" aria-label="About this group">
        <section className="border-b px-4 py-4">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
            <div className="bg-card px-3 py-2">
              <div className="text-2xs text-muted-foreground">Members</div>
              <div className="text-[17px] font-semibold tabular-nums">{detail.memberCount}</div>
            </div>
            <div className="bg-card px-3 py-2">
              <div className="text-2xs text-muted-foreground">Complete</div>
              <div className="text-[17px] font-semibold tabular-nums">{done == null ? '—' : `${done}%`}</div>
            </div>
            <div className="bg-card px-3 py-2">
              <div className="text-2xs text-muted-foreground">Overdue</div>
              <div className={cn('text-[17px] font-semibold tabular-nums', detail.stats.overdue && 'text-tone-danger')}>{detail.stats.overdue}</div>
            </div>
          </div>
          {detail.stats.overduePeople > 0 && (
            <Link to={`/people?groups=${group.id}&training=overdue`} className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground">
              {peopleCount(detail.stats.overduePeople)} with overdue training →
            </Link>
          )}
          {group.description && <p className="mt-3 text-[14px] text-muted-foreground">{group.description}</p>}
          <div className="mt-3 flex items-center gap-2 text-[14px]">
            <span className="text-muted-foreground">Owner</span>
            {detail.owner ? (
              <Link to={`/people/${detail.owner.id}`} className="ml-auto flex min-w-0 items-center gap-1.5 hover:underline">
                <PersonAvatar person={detail.owner} size={18} /> <span className="truncate">{detail.owner.name}</span>
              </Link>
            ) : (
              <span className="ml-auto text-muted-foreground/80">No owner</span>
            )}
          </div>
        </section>
        <section className="px-4 py-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Workflow className="h-3.5 w-3.5" /> Assignment rules for this group
          </h3>
          <GroupRules rules={detail.rules} groupId={group.id} />
        </section>
      </aside>
    </div>
  );
}
