import { Plus, Workflow, UsersRound } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { GroupDialog } from '../components/groups/GroupDialog';
import { btnPrimary } from '../components/people/PeopleBits';
import { useGroupsList, type GroupSummary } from '../components/people/peopleData';
import { PersonAvatar } from '../components/primitives/Avatar';
import { EmptyState, LabelDot, SkeletonRows, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { GROUP_KINDS } from '../lib/constants';
import { useHotkeys } from '../lib/hotkeys';
import { useWorkspace } from '../lib/workspace';

const KIND_PLURAL: Record<string, string> = { Department: 'Departments', Team: 'Teams', Location: 'Locations', Cohort: 'Cohorts', Customer: 'Customers', Partner: 'Partners' };

/** Groups by kind, with how their members are doing on the training assigned to them. */
export function GroupsPage() {
  useDocumentTitle('Groups');
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useGroupsList();
  const [creating, setCreating] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    const groups = data?.groups ?? [];
    const kinds = [...GROUP_KINDS, ...new Set(groups.map(g => g.kind).filter(k => !(GROUP_KINDS as readonly string[]).includes(k)))];
    return kinds.map(kind => ({ kind, groups: groups.filter(g => g.kind === kind) })).filter(s => s.groups.length);
  }, [data]);
  const flat = sections.flatMap(s => s.groups);

  const move = (delta: number) => {
    if (!flat.length) return;
    const i = flat.findIndex(g => g.id === focused);
    const next = flat[i < 0 ? 0 : Math.max(0, Math.min(flat.length - 1, i + delta))];
    setFocused(next.id);
    listRef.current?.querySelector(`[data-group-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  useHotkeys({ j: () => move(1), down: () => move(1), k: () => move(-1), up: () => move(-1), enter: () => focused && navigate(`/groups/${focused}`) });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<UsersRound />}
        title="Groups"
        actions={
          ws.isAdmin ? (
            <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New group</span>
            </button>
          ) : undefined
        }
      />
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" role="grid" aria-label="Groups">
        {isPending ? (
          <SkeletonRows rows={8} className="pt-2" />
        ) : isError ? (
          <EmptyState icon={<UsersRound />} title="Couldn't load groups" description="Check your connection and try again." action={<button type="button" onClick={() => refetch()} className="text-[14px] text-primary hover:underline">Try again</button>} />
        ) : !flat.length ? (
          <EmptyState
            icon={<UsersRound />}
            title="No groups yet"
            description="Groups mirror how your organization works — departments, locations, teams, cohorts. Assign training to a whole group and new members get it automatically."
            action={ws.isAdmin ? <button type="button" onClick={() => setCreating(true)} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">New group</button> : undefined}
          />
        ) : (
          <div className="pb-16">
            <div role="row" className={cn(ROW, 'sticky top-0 z-20 h-9 border-b bg-subtle/95 text-sm text-muted-foreground backdrop-blur-sm')}>
              <span className="min-w-0 flex-1 pl-5">Name</span>
              <span className={COL.members}>Members</span>
              <span className={COL.owner}>Owner</span>
              <span className={COL.complete}>
                <Tip label="Share of current enrollments completed, for active members">
                  <span className="cursor-default">Complete</span>
                </Tip>
              </span>
              <span className={COL.overdue}>
                <Tip label="Unfinished enrollments past their due date">
                  <span className="cursor-default">Overdue</span>
                </Tip>
              </span>
            </div>
            {sections.map(section => (
              <section key={section.kind} aria-label={KIND_PLURAL[section.kind] ?? section.kind}>
                <div className="sticky top-8 z-10 flex h-9 items-center gap-2 border-b bg-background/95 px-4 text-sm font-medium text-muted-foreground backdrop-blur-sm">
                  {KIND_PLURAL[section.kind] ?? section.kind}
                  <span className="font-normal tabular-nums text-muted-foreground/70">{section.groups.length}</span>
                </div>
                {section.groups.map(g => (
                  <GroupListRow key={g.id} group={g} focused={focused === g.id} onHover={() => setFocused(g.id)} />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
      {creating && <GroupDialog open onOpenChange={setCreating} />}
    </div>
  );
}

const ROW = 'flex items-center gap-4 pl-4 pr-4 sm:pr-5';
const COL = {
  members: 'shrink-0 whitespace-nowrap text-right tabular-nums sm:w-[64px]',
  owner: 'hidden w-[168px] shrink-0 lg:flex',
  complete: 'hidden w-[148px] shrink-0 md:flex',
  overdue: 'hidden w-[64px] shrink-0 justify-end sm:flex',
};

function GroupListRow({ group: g, focused, onHover }: { group: GroupSummary; focused: boolean; onHover: () => void }) {
  return (
    <Link
      to={`/groups/${g.id}`}
      role="row"
      data-group-id={g.id}
      onMouseMove={focused ? undefined : onHover}
      className={cn(ROW, 'relative h-10 border-b border-border/60 text-[14px] transition-colors duration-75', focused ? 'bg-accent/80' : 'hover:bg-accent/50')}
    >
      {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <LabelDot color={g.color} className="h-2.5 w-2.5" />
        <span className="min-w-0 truncate font-medium">{g.name}</span>
        {g.ruleCount > 0 && (
          <Tip label={`${g.ruleCount} active assignment rule${g.ruleCount === 1 ? '' : 's'} enroll new members automatically`}>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-sm tabular-nums text-muted-foreground">
              <Workflow className="h-3 w-3" /> {g.ruleCount}
            </span>
          </Tip>
        )}
        {g.description && <span className="hidden min-w-0 shrink-[100] truncate text-muted-foreground md:inline">{g.description}</span>}
        {g.overdue > 0 && <span className="shrink-0 text-2xs font-medium tabular-nums text-tone-danger sm:hidden">{g.overdue} overdue</span>}
      </div>
      <span className={COL.members}>
        {g.memberCount}
        <span className="text-sm text-muted-foreground sm:hidden"> {g.memberCount === 1 ? 'member' : 'members'}</span>
      </span>
      <span className={cn(COL.owner, 'min-w-0 items-center gap-2')}>
        {g.owner ? (
          <>
            <PersonAvatar person={g.owner} size={18} />
            <span className="truncate text-muted-foreground">{g.owner.name}</span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground/50">No owner</span>
        )}
      </span>
      <span className={cn(COL.complete, 'items-center gap-2')}>
        {g.completionRate == null ? (
          <span className="text-sm text-muted-foreground/50">No training yet</span>
        ) : (
          <Tip label={`${g.completed} of ${g.enrolled} current enrollments completed`}>
            <span className="flex w-full items-center gap-2">
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${g.completionRate}%` }} />
              </span>
              <span className="w-9 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{g.completionRate}%</span>
            </span>
          </Tip>
        )}
      </span>
      <span className={COL.overdue}>
        {g.overdue > 0 ? (
          <Tip label={`${g.overdue} overdue enrollment${g.overdue === 1 ? '' : 's'} across ${g.overduePeople} ${g.overduePeople === 1 ? 'person' : 'people'}`}>
            <span className="text-sm font-medium tabular-nums text-tone-danger">{g.overdue}</span>
          </Tip>
        ) : (
          <span className="text-sm tabular-nums text-muted-foreground/40">0</span>
        )}
      </span>
    </Link>
  );
}
