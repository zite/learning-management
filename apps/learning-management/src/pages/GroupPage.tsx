import { GraduationCap, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { EnrollmentsView } from '../components/enrollments/EnrollmentsView';
import { ComplianceMatrix } from '../components/groups/ComplianceMatrix';
import { AddMembersButton, GroupMembers } from '../components/groups/GroupMembers';
import { GroupSettings } from '../components/groups/GroupSettings';
import { btnPrimary, btnSecondary } from '../components/people/PeopleBits';
import { useGroupMembers } from '../components/people/peopleData';
import { EmptyState, LabelDot, SkeletonRows, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';

const TABS = ['members', 'progress', 'compliance', 'settings'] as const;
type Tab = (typeof TABS)[number];

export function GroupPage() {
  const { groupId = '', tab: tabParam } = useParams();
  const tab = (TABS.includes(tabParam as Tab) ? tabParam : 'members') as Tab;
  const app = useAppActions();
  const [q, setQ] = useState('');
  const members = useGroupMembers(groupId, q);
  const first = members.data?.pages[0];
  const detail = first && first.group.id === groupId ? first : undefined;
  const list = useMemo(() => (detail ? members.data!.pages.flatMap(p => p.members) : []), [detail, members.data]);
  const baseFilters = useMemo(() => ({ groupIds: [groupId] }), [groupId]);
  useDocumentTitle(detail?.group.name ?? 'Group');

  if (tabParam && !TABS.includes(tabParam as Tab)) return <Navigate to={`/groups/${groupId}`} replace />;
  const breadcrumb = { to: '/groups', label: 'Groups' };

  if (!detail) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader icon={<UsersRound />} title="Group" breadcrumb={breadcrumb} />
        {members.isError ? (
          <EmptyState icon={<UsersRound />} title="This group isn’t here" description="It may have been deleted, or the link is wrong." action={<Link to="/groups" className="text-[14px] text-primary hover:underline">Back to Groups</Link>} />
        ) : (
          <SkeletonRows rows={8} className="pt-4" />
        )}
      </div>
    );
  }

  const g = detail.group;
  // Settings are admin-only; a group's owner manages members from the Members tab.
  if (tab === 'settings' && !detail.canEdit) return <Navigate to={`/groups/${g.id}`} replace />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<UsersRound />}
        breadcrumb={breadcrumb}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <LabelDot color={g.color} className="h-2.5 w-2.5" />
            <span className="truncate">{g.name}</span>
            <span className="hidden shrink-0 rounded-md border px-1.5 text-2xs font-normal text-muted-foreground sm:inline">{g.kind}</span>
            <span className="hidden shrink-0 text-sm font-normal tabular-nums text-muted-foreground md:inline">{detail.memberCount} {detail.memberCount === 1 ? 'member' : 'members'}</span>
          </span>
        }
        tabs={[
          { to: `/groups/${g.id}`, label: 'Members', end: true, active: tab === 'members' },
          { to: `/groups/${g.id}/progress`, label: 'Progress', active: tab === 'progress' },
          { to: `/groups/${g.id}/compliance`, label: 'Compliance', active: tab === 'compliance' },
          ...(detail.canEdit ? [{ to: `/groups/${g.id}/settings`, label: 'Settings', active: tab === 'settings' }] : []),
        ]}
        actions={
          <>
            {detail.canManageMembers && <AddMembersButton group={g} existingIds={list.map(m => m.id)} className={btnSecondary} />}
            {detail.memberCount ? (
              <button type="button" onClick={() => app.openEnroll({ groupIds: [g.id] })} className={btnPrimary}>
                <GraduationCap className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Enroll group…</span>
              </button>
            ) : (
              <Tip label="Add members before enrolling the group">
                <span tabIndex={0} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <button type="button" disabled aria-label="Enroll group (add members first)" className={btnPrimary}>
                    <GraduationCap className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Enroll group…</span>
                  </button>
                </span>
              </Tip>
            )}
          </>
        }
      />
      {tab === 'members' && (
        <GroupMembers
          detail={detail}
          members={list}
          total={detail.membersTotal}
          q={q}
          onSearch={setQ}
          loading={members.isPending}
          fetchingMore={members.isFetchingNextPage}
          hasMore={Boolean(members.hasNextPage)}
          onLoadMore={() => members.fetchNextPage()}
        />
      )}
      {tab === 'progress' && <EnrollmentsView surfaceKey={`group:${g.id}`} baseFilters={baseFilters} lockedFilters={['groupIds']} emptyState={<EmptyState icon={<GraduationCap />} title="No training for this group yet" description="Enroll the group in a course or path, or create an assignment rule so new members are enrolled automatically." action={<button type="button" onClick={() => app.openEnroll({ groupIds: [g.id] })} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">Enroll group…</button>} />} />}
      {tab === 'compliance' && <ComplianceMatrix groupId={g.id} groupName={g.name} />}
      {tab === 'settings' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <GroupSettings detail={detail} />
        </div>
      )}
    </div>
  );
}
