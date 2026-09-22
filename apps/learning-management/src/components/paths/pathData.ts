import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { getPath, listPathEnrollments, savePath, type GetPathOutputType, type ListPathEnrollmentsInputType, type ListPathEnrollmentsOutputType, type SavePathInputType } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { refreshSoon } from '../../lib/mutations';
import { qk, retryUnlessNotFound } from '../../lib/queries';
import type { Bootstrap, Path } from '../../lib/types';
import type { Workspace } from '../../lib/workspace';
import { useSaveStatus } from '../courses/fields';

export type PathDetail = GetPathOutputType;
export type PathCourse = PathDetail['courses'][number];
export type PathEnrollmentList = ListPathEnrollmentsOutputType;
export type PathEnrollmentRow = PathEnrollmentList['rows'][number];
export type PathEnrollmentFilters = NonNullable<ListPathEnrollmentsInputType['filters']>;
export type PathEnrollmentOrdering = NonNullable<ListPathEnrollmentsInputType['ordering']>;
export type PathPatch = Omit<SavePathInputType, 'action' | 'id' | 'courses'>;

export const pathKey = (id: string) => [...qk.pathRoot, id] as const;
export const pathEnrollmentsKey = (id: string, filters: PathEnrollmentFilters, ordering: PathEnrollmentOrdering) => [...qk.pathRoot, id, 'enrollments', { filters, ordering }] as const;

export function usePath(id: string | undefined) {
  return useQuery({ queryKey: pathKey(id ?? ''), queryFn: () => getPath({ id: id! }), enabled: Boolean(id), staleTime: 15_000, retry: retryUnlessNotFound });
}

export function usePathEnrollments(id: string, filters: PathEnrollmentFilters, ordering: PathEnrollmentOrdering) {
  return useQuery({ queryKey: pathEnrollmentsKey(id, filters, ordering), queryFn: () => listPathEnrollments({ pathId: id, filters, ordering }), placeholderData: keepPreviousData, staleTime: 15_000 });
}

/** Admins edit every path; instructors the ones they own, or nobody owns. Mirrors the server rule. */
export function canEditPath(ws: Pick<Workspace, 'isAdmin' | 'me'>, path: Pick<Path, 'ownerId'>) {
  if (ws.isAdmin) return true;
  return ws.me.role === 'Instructor' && (!path.ownerId || path.ownerId === ws.me.id);
}

export function useRefreshPath() {
  const qc = useQueryClient();
  return useCallback(
    (opts: { enrollments?: boolean } = {}) => {
      qc.invalidateQueries({ queryKey: qk.bootstrap });
      qc.invalidateQueries({ queryKey: qk.pathRoot });
      qc.invalidateQueries({ queryKey: qk.courseStatsRoot });
      if (opts.enrollments) {
        qc.invalidateQueries({ queryKey: qk.enrollmentsRoot });
        qc.invalidateQueries({ queryKey: qk.personRoot });
      }
    },
    [qc],
  );
}

/** Field-level optimistic autosave for a path, like the course one. */
export function usePathAutosave(pathId: string) {
  const qc = useQueryClient();
  const status = useSaveStatus();
  const save = useCallback(
    async (field: string, patch: PathPatch) => {
      status.set(field, { state: 'saving' });
      const key = pathKey(pathId);
      const prev = qc.getQueryData<PathDetail>(key);
      const prevBoot = qc.getQueryData<Bootstrap>(qk.bootstrap);
      if (prev) qc.setQueryData<PathDetail>(key, { ...prev, path: { ...prev.path, ...(patch as Partial<PathDetail['path']>) } });
      if (prevBoot) qc.setQueryData<Bootstrap>(qk.bootstrap, { ...prevBoot, paths: prevBoot.paths.map(p => (p.id === pathId ? { ...p, ...(Object.fromEntries(Object.entries(patch).filter(([k]) => k in p)) as Partial<typeof p>) } : p)) });
      try {
        await savePath({ action: 'update', id: pathId, ...patch });
        status.set(field, { state: 'saved' });
        refreshSoon(qc, [qk.bootstrap, key], 1500);
        return true;
      } catch (e) {
        if (prev) qc.setQueryData(key, prev);
        if (prevBoot) qc.setQueryData(qk.bootstrap, prevBoot);
        const message = errorMessage(e, "Couldn't save that change");
        status.set(field, { state: 'error', message });
        toast.error(message);
        return false;
      }
    },
    [qc, pathId, status.set],
  );
  return { save, status: status.get };
}
