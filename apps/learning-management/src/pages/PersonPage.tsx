import { BellRing, Copy, GraduationCap, Link2, MoreHorizontal, Pencil, ShieldCheck, UserCheck, UserMinus, UserRound, Users } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@project/components/ui/dropdown-menu';
import { EnrollmentsView } from '../components/enrollments/EnrollmentsView';
import { anchorFrom, usePeopleActions, type PersonTarget } from '../components/people/PeopleActions';
import { btnGhost, btnPrimary } from '../components/people/PeopleBits';
import { PersonActivity } from '../components/people/PersonActivity';
import { PersonHero } from '../components/people/PersonHero';
import { PersonLearningAside } from '../components/people/PersonLearningAside';
import { PersonNotFound, PersonProfile } from '../components/people/PersonProfile';
import { ROLE_INFO, usePerson, type PersonDetail, type Role } from '../components/people/peopleData';
import { EmptyState, IconButton, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { appUrl } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useEnrollmentActions } from '../lib/mutations';

const TABS = ['learning', 'activity', 'profile'] as const;
type Tab = (typeof TABS)[number];

export function PersonPage() {
  const { personId = '', tab: tabParam } = useParams();
  const tab = (TABS.includes(tabParam as Tab) ? tabParam : 'learning') as Tab;
  const { data, isPending, isError } = usePerson(personId);
  useDocumentTitle(data?.person.name ?? 'Person');
  const breadcrumb = { to: '/people', label: 'People' };

  if (tabParam && !TABS.includes(tabParam as Tab)) return <Navigate to={`/people/${personId}`} replace />;

  if (isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader icon={<Users />} title="Person" breadcrumb={breadcrumb} />
        <div className="space-y-4 px-6 py-6">
          <div className="flex items-center gap-4">
            <div className="skeleton h-[52px] w-[52px] rounded-full" />
            <div className="space-y-2">
              <div className="skeleton h-5 w-48" />
              <div className="skeleton h-3.5 w-72" />
            </div>
          </div>
          <div className="skeleton h-14 w-full rounded-lg" />
          <div className="skeleton h-64 w-full rounded-lg" />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader icon={<Users />} title="Person" breadcrumb={breadcrumb} />
        <PersonNotFound />
      </div>
    );
  }
  return <PersonScreen key={data.person.id} data={data} tab={tab} />;
}

function PersonScreen({ data, tab }: { data: PersonDetail; tab: Tab }) {
  const app = useAppActions();
  const navigate = useNavigate();
  const { run } = useEnrollmentActions();
  const { actions, host } = usePeopleActions();
  const menuRef = useRef<HTMLButtonElement>(null);
  const p = data.person;
  const target: PersonTarget = { id: p.id, name: p.name, email: p.email, role: p.role, status: p.status, managerId: p.managerId, lastActiveAt: data.stats.lastActiveAt };
  const baseFilters = useMemo(() => ({ personIds: [p.id] }), [p.id]);
  const deactivated = p.status === 'Deactivated';
  const canInvite = data.canEdit && !deactivated && !data.stats.lastActiveAt;

  const remindOverdue = () => {
    const ids = data.overdueEnrollmentIds;
    if (ids.length) void run(ids.map(id => ({ id, status: 'In progress' as const, dueDate: null, progress: 0 })), 'remind');
  };

  useHotkeys({
    '1': () => navigate(`/people/${p.id}`),
    '2': () => navigate(`/people/${p.id}/activity`),
    '3': () => navigate(`/people/${p.id}/profile`),
  });

  const menuAnchor = () => anchorFrom(menuRef.current ? { currentTarget: menuRef.current } : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<Users />}
        title={p.name}
        breadcrumb={{ to: '/people', label: 'People' }}
        tabs={[
          { to: `/people/${p.id}`, label: 'Learning', end: true, active: tab === 'learning' },
          { to: `/people/${p.id}/activity`, label: 'Activity', active: tab === 'activity' },
          { to: `/people/${p.id}/profile`, label: 'Profile', active: tab === 'profile' },
        ]}
        actions={
          <>
            {data.stats.overdue > 0 && !deactivated && (
              <Tip label={`Email and notify ${p.name.split(' ')[0]} about ${data.stats.overdue} overdue enrollment${data.stats.overdue === 1 ? '' : 's'}`}>
                <button type="button" onClick={remindOverdue} className={btnGhost}>
                  <BellRing className="h-3.5 w-3.5 text-tone-danger" /> <span className="hidden md:inline">Remind about overdue</span>
                </button>
              </Tip>
            )}
            {!deactivated && (
              <Tip label="Enroll in a course or path">
                <button type="button" onClick={() => app.openEnroll({ personIds: [p.id] })} className={btnPrimary}>
                  <GraduationCap className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Enroll…</span>
                </button>
              </Tip>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton ref={menuRef} aria-label="More actions for this person">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={e => e.preventDefault()}>
                {data.canEdit && (
                  <>
                    <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => navigate(`/people/${p.id}/profile`)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit profile
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="gap-2 text-[14px]">
                        <ShieldCheck className="h-3.5 w-3.5" /> Change role
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        <DropdownMenuRadioGroup value={p.role} onValueChange={v => void actions.changeRole([target], v as Role)}>
                          {(['Admin', 'Instructor', 'Learner'] as Role[]).map(r => (
                            <DropdownMenuRadioItem key={r} value={r} className="items-start py-1.5 text-[14px]">
                              <span>
                                <span className="block">{r}</span>
                                <span className="block text-2xs text-muted-foreground">{ROLE_INFO[r].description}</span>
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => actions.pickManager([target], menuAnchor())}>
                      <UserRound className="h-3.5 w-3.5" /> Set manager…
                    </DropdownMenuItem>
                    {canInvite && (
                      <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => actions.resendInvites([target])}>
                        <BellRing className="h-3.5 w-3.5" /> Resend invitation
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => copyText(p.email, 'Copied email')}>
                  <Copy className="h-3.5 w-3.5" /> Copy email
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => copyText(appUrl(`/people/${p.id}`), 'Copied link')}>
                  <Link2 className="h-3.5 w-3.5" /> Copy link
                </DropdownMenuItem>
                {data.canEdit && !data.isMe && (
                  <>
                    <DropdownMenuSeparator />
                    {deactivated ? (
                      <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => actions.reactivate([target])}>
                        <UserCheck className="h-3.5 w-3.5" /> Reactivate
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem className="gap-2 text-[14px] text-destructive focus:text-destructive" onSelect={() => actions.deactivate([target])}>
                        <UserMinus className="h-3.5 w-3.5" /> Deactivate…
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {tab === 'learning' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:overflow-hidden">
          <PersonHero data={data} compact onReactivate={data.canEdit ? () => actions.reactivate([target]) : undefined} onResendInvite={canInvite ? () => actions.resendInvites([target]) : undefined} />
          <div className="flex flex-col xl:min-h-0 xl:flex-1 xl:flex-row">
            <div className="flex h-[78dvh] min-h-[440px] min-w-0 flex-col xl:h-auto xl:min-h-0 xl:flex-1">
              <EnrollmentsView
                surfaceKey={`person:${p.id}`}
                baseFilters={baseFilters}
                lockedFilters={[]}
                primary="course"
                hideSaveView
                defaults={{ properties: ['due', 'progress', 'score', 'activity', 'source'] }}
                emptyState={
                  <EmptyState
                    icon={<GraduationCap />}
                    title={`${p.name.split(' ')[0]} has no training yet`}
                    description={deactivated ? 'Reactivate them to assign training.' : 'Enroll them in a course or learning path, or add them to a group with assignment rules.'}
                    action={!deactivated ? <button type="button" onClick={() => app.openEnroll({ personIds: [p.id] })} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">Enroll…</button> : undefined}
                  />
                }
              />
            </div>
            <aside className="border-t bg-background xl:w-[340px] xl:shrink-0 xl:overflow-y-auto xl:border-l xl:border-t-0" aria-label="Paths, certificates and sessions">
              <PersonLearningAside data={data} />
            </aside>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PersonHero data={data} compact onReactivate={data.canEdit ? () => actions.reactivate([target]) : undefined} onResendInvite={canInvite ? () => actions.resendInvites([target]) : undefined} />
          {tab === 'activity' ? <PersonActivity personId={p.id} personName={p.name} /> : <PersonProfile data={data} actions={actions} />}
        </div>
      )}
      {host}
    </div>
  );
}
