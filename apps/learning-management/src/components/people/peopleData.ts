import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  bulkUpdatePeople,
  getGroup,
  getPerson,
  listGroups,
  listPeople,
  listPersonActivity,
  savePerson,
  setGroupMembers,
  type BulkUpdatePeopleInputType,
  type GetGroupOutputType,
  type GetPersonOutputType,
  type ListGroupsOutputType,
  type ListPeopleInputType,
  type ListPeopleOutputType,
  type ListPersonActivityOutputType,
  type SavePersonInputType,
} from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { refreshEverythingSoon } from '../../lib/mutations';
import { qk, retryUnlessNotFound } from '../../lib/queries';

/**
 * People and groups on the client: query keys under the area's reserved roots,
 * the hooks every people/group screen reads through, and the write helpers
 * that refresh exactly what a change can affect (lists, the person, groups,
 * enrollments created by rules, bootstrap counts).
 */

export type PeopleList = ListPeopleOutputType;
export type PersonRow = PeopleList['rows'][number];
export type PeopleTabCounts = PeopleList['tabs'];
export type PeopleQuery = Omit<ListPeopleInputType, 'limit' | 'offset'>;
export type PersonDetail = GetPersonOutputType;
export type PersonActivityItem = ListPersonActivityOutputType['items'][number];
export type GroupSummary = ListGroupsOutputType['groups'][number];
export type GroupDetail = GetGroupOutputType;
export type GroupMember = GroupDetail['members'][number];
export type GroupRule = GroupDetail['rules'][number];
export type Compliance = NonNullable<GroupDetail['compliance']>;
export type ComplianceCell = NonNullable<Compliance['rows'][number]['cells'][string]>;
export type Role = PersonRow['role'];
export type PeopleTab = NonNullable<ListPeopleInputType['tab']>;
export type PeopleOrdering = NonNullable<ListPeopleInputType['ordering']>;
export type Compliancefilter = NonNullable<ListPeopleInputType['compliance']>;

export const PAGE_SIZE = 100;

export const pk = {
  list: (query: PeopleQuery) => [...qk.peopleRoot, 'list', query] as const,
  person: (id: string) => [...qk.personRoot, id] as const,
  activity: (id: string, scope: string) => [...qk.personRoot, id, 'activity', scope] as const,
  groups: () => [...qk.groupRoot, 'list'] as const,
  group: (id: string, opts: { q: string; limit: number; compliance: boolean }) => [...qk.groupRoot, id, opts] as const,
  groupAll: (id: string) => [...qk.groupRoot, id] as const,
};

export const TABS: Array<{ value: PeopleTab; label: string; short: string }> = [
  { value: 'everyone', label: 'Everyone', short: 'Everyone' },
  { value: 'learners', label: 'Learners', short: 'Learners' },
  { value: 'staff', label: 'Instructors & admins', short: 'Staff' },
  { value: 'invited', label: 'Invited', short: 'Invited' },
  { value: 'deactivated', label: 'Deactivated', short: 'Deactivated' },
];

export const PEOPLE_ORDERINGS: Array<{ value: PeopleOrdering; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'recent_activity', label: 'Recently active' },
  { value: 'overdue_desc', label: 'Most overdue' },
  { value: 'hired_desc', label: 'Newest hires' },
];

export const COMPLIANCE_OPTIONS: Array<{ value: Compliancefilter; label: string; hint: string; dot: string }> = [
  { value: 'overdue', label: 'Overdue', hint: 'At least one assignment past due', dot: 'bg-tone-danger' },
  { value: 'not_started', label: 'Not started', hint: 'Has training, hasn’t started any', dot: 'bg-tone-warning' },
  { value: 'on_track', label: 'On track', hint: 'Started or finished, nothing overdue', dot: 'bg-tone-success' },
  { value: 'no_training', label: 'No training', hint: 'Nothing assigned', dot: 'bg-tone-neutral' },
];

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  Admin: { label: 'Admin', description: 'Everything, including people, roles, rules and settings' },
  Instructor: { label: 'Instructor', description: 'Builds and teaches courses, grades, enrolls people, sees reports' },
  Learner: { label: 'Learner', description: 'Takes training in the academy only' },
};

export function usePeopleList(query: PeopleQuery) {
  return useInfiniteQuery({
    queryKey: pk.list(query),
    queryFn: ({ pageParam }) => listPeople({ ...query, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: last => (last.hasMore ? last.offset + last.rows.length : undefined),
    placeholderData: keepPreviousData,
    staleTime: 20_000,
  });
}

export function usePerson(id: string | undefined) {
  return useQuery({ queryKey: pk.person(id ?? ''), queryFn: () => getPerson({ id: id! }), enabled: Boolean(id), staleTime: 15_000, retry: retryUnlessNotFound });
}

export function usePersonActivity(id: string, scope: 'all' | 'about' | 'by') {
  return useInfiniteQuery({
    queryKey: pk.activity(id, scope),
    queryFn: ({ pageParam }) => listPersonActivity({ personId: id, scope, limit: 50, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((n, p) => n + p.items.length, 0) : undefined),
    staleTime: 15_000,
  });
}

export function useGroupsList() {
  return useQuery({ queryKey: pk.groups(), queryFn: () => listGroups({}), staleTime: 20_000 });
}

export function useGroup(id: string | undefined, opts: { q?: string; limit?: number; compliance?: boolean } = {}) {
  const o = { q: opts.q ?? '', limit: opts.limit ?? PAGE_SIZE, compliance: opts.compliance ?? false };
  return useQuery({
    queryKey: pk.group(id ?? '', o),
    queryFn: () => getGroup({ id: id!, q: o.q, limit: o.limit, offset: 0, compliance: o.compliance }),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryUnlessNotFound,
  });
}

/** A group with its members paged in, for the group header and Members tab. */
export function useGroupMembers(id: string | undefined, q: string) {
  return useInfiniteQuery({
    queryKey: [...qk.groupRoot, id ?? '', 'members', q] as const,
    queryFn: ({ pageParam }) => getGroup({ id: id!, q, limit: PAGE_SIZE, offset: pageParam, compliance: false }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.members.length, 0);
      return loaded < last.membersTotal && last.members.length ? loaded : undefined;
    },
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryUnlessNotFound,
  });
}

/** Everything a people or membership change can touch. */
export function refreshPeople(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: qk.peopleRoot });
  qc.invalidateQueries({ queryKey: qk.personRoot });
  qc.invalidateQueries({ queryKey: qk.groupRoot });
  qc.invalidateQueries({ queryKey: qk.peopleSearchRoot });
  qc.invalidateQueries({ queryKey: qk.bootstrap });
  refreshEverythingSoon(qc, 400);
}

/** Why a bulk change passed someone over, in a few words that follow a count. */
const SKIP_REASON: Partial<Record<BulkUpdatePeopleInputType['action'], string>> = {
  add_to_group: 'already in the group',
  remove_from_group: 'not in the group',
  set_manager: 'already set that way',
  set_role: 'already in that role',
  reactivate: 'already active',
  deactivate: 'skipped',
  resend_invite: 'already signed in',
};

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
export const peopleCount = (count: number) => n(count, 'person', 'people');

export function usePeopleWrites() {
  const qc = useQueryClient();

  const save = useCallback(
    async (input: SavePersonInputType, opts: { success?: string | ((res: Awaited<ReturnType<typeof savePerson>>) => string | null); error: string; description?: string }) => {
      try {
        const res = await savePerson(input);
        const message = typeof opts.success === 'function' ? opts.success(res) : opts.success;
        if (message) toast.success(message, { description: res.enrolled ? `Assignment rules added or restored ${n(res.enrolled, 'enrollment')}.` : opts.description });
        refreshPeople(qc);
        return res;
      } catch (e) {
        toast.error(errorMessage(e, opts.error));
        refreshPeople(qc);
        return null;
      }
    },
    [qc],
  );

  const bulk = useCallback(
    async (input: BulkUpdatePeopleInputType, label: { verb: string; error: string }) => {
      const toastId = toast.loading(`${label.verb}…`);
      try {
        const res = await bulkUpdatePeople(input);
        const extra = [res.enrolled ? `Assignment rules enrolled ${n(res.enrolled, 'new enrollment')}.` : '', res.withdrawn ? `Withdrew ${n(res.withdrawn, 'unfinished enrollment')}.` : '', res.message ?? ''].filter(Boolean).join(' ');
        if (!res.updated) {
          // Nothing to do is not an error, but it isn't a success either.
          toast.info('Nothing to change', { id: toastId, description: res.message ?? `${res.skipped === 1 ? 'That person was' : `All ${res.skipped} were`} ${SKIP_REASON[input.action] ?? 'skipped'}.` });
        } else {
          const parts = [`${label.verb}: ${peopleCount(res.updated)}`];
          if (res.skipped) parts.push(`${res.skipped} ${SKIP_REASON[input.action] ?? 'skipped'}`);
          toast.success(parts.join(' · '), { id: toastId, description: extra || undefined });
        }
        refreshPeople(qc);
        return res;
      } catch (e) {
        toast.error(errorMessage(e, label.error), { id: toastId });
        return null;
      }
    },
    [qc],
  );

  const members = useCallback(
    async (groupId: string, groupName: string, change: { add?: string[]; remove?: string[] }) => {
      try {
        const res = await setGroupMembers({ groupId, add: change.add ?? [], remove: change.remove ?? [] });
        const parts: string[] = [];
        if (res.added) parts.push(`Added ${peopleCount(res.added)} to ${groupName}`);
        if (res.removed) parts.push(`Removed ${peopleCount(res.removed)} from ${groupName}`);
        if (!parts.length) parts.push(change.add?.length ? 'Already in the group' : 'Nothing changed');
        toast.success(parts.join(' · '), { description: res.enrolled ? `The group’s assignment rules enrolled ${n(res.enrolled, 'new enrollment')}.` : undefined });
        refreshPeople(qc);
        return res;
      } catch (e) {
        toast.error(errorMessage(e, `Couldn't update ${groupName}`));
        return null;
      }
    },
    [qc],
  );

  return useMemo(() => ({ save, bulk, members }), [save, bulk, members]);
}

export function csvCell(v: unknown) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]) {
  return [header.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n');
}
