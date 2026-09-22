import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { getCourseOverview, saveCourse, type GetCourseOverviewOutputType, type SaveCourseInputType } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { refreshSoon } from '../../lib/mutations';
import { qk, retryUnlessNotFound, useEnrollments } from '../../lib/queries';
import type { Bootstrap, CourseDetail } from '../../lib/types';
import { useSaveStatus } from './fields';

export type CourseOverview = GetCourseOverviewOutputType;
export type OverviewRange = CourseOverview['range'];
export type CoursePatch = Omit<SaveCourseInputType, 'action' | 'id'>;

export const courseOverviewKey = (id: string, range: OverviewRange) => [...qk.courseStatsRoot, id, range] as const;

export function useCourseOverview(id: string | undefined, range: OverviewRange) {
  return useQuery({
    queryKey: courseOverviewKey(id ?? '', range),
    queryFn: () => getCourseOverview({ courseId: id!, range }),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: retryUnlessNotFound,
  });
}

/** Learners on the course's list — each person once, latest cycle, not withdrawn — for the tab count. */
export function useCourseLearnerTotal(id: string | undefined) {
  const { data } = useEnrollments({ courseIds: id ? [id] : [] }, 'due_asc', { enabled: Boolean(id), limit: 1 });
  return data?.summary.total ?? null;
}

/** Refetch everything a course change can show up in. */
export function useRefreshCourse() {
  const qc = useQueryClient();
  return useCallback(
    (id?: string | null) => {
      qc.invalidateQueries({ queryKey: qk.bootstrap });
      qc.invalidateQueries({ queryKey: qk.pathRoot });
      if (id) {
        qc.invalidateQueries({ queryKey: qk.course(id) });
        qc.invalidateQueries({ queryKey: [...qk.courseStatsRoot, id] });
      }
    },
    [qc],
  );
}

/**
 * Field-level autosave for a course. The change is written into the course
 * detail and the workspace list before the request leaves, so the header,
 * sidebar and preview update at once; a failure puts the old values back and
 * says why beside the field.
 */
export function useCourseAutosave(courseId: string) {
  const qc = useQueryClient();
  const status = useSaveStatus();

  const save = useCallback(
    async (field: string, patch: CoursePatch) => {
      status.set(field, { state: 'saving' });
      const detailKey = qk.course(courseId);
      const prevDetail = qc.getQueryData<CourseDetail>(detailKey);
      const prevBoot = qc.getQueryData<Bootstrap>(qk.bootstrap);
      if (prevDetail) qc.setQueryData<CourseDetail>(detailKey, { ...prevDetail, course: { ...prevDetail.course, ...(patch as Partial<CourseDetail['course']>) } });
      if (prevBoot) {
        qc.setQueryData<Bootstrap>(qk.bootstrap, {
          ...prevBoot,
          courses: prevBoot.courses.map(c => (c.id === courseId ? { ...c, ...(Object.fromEntries(Object.entries(patch).filter(([k]) => k in c)) as Partial<typeof c>) } : c)),
        });
      }
      try {
        const res = await saveCourse({ action: 'update', id: courseId, ...patch });
        status.set(field, { state: 'saved' });
        if (patch.slug !== undefined && res.slug !== patch.slug) {
          const d = qc.getQueryData<CourseDetail>(detailKey);
          if (d) qc.setQueryData<CourseDetail>(detailKey, { ...d, course: { ...d.course, slug: res.slug } });
        }
        refreshSoon(qc, [qk.bootstrap, detailKey], 1500);
        return true;
      } catch (e) {
        if (prevDetail) qc.setQueryData(detailKey, prevDetail);
        if (prevBoot) qc.setQueryData(qk.bootstrap, prevBoot);
        const message = errorMessage(e, "Couldn't save that change");
        status.set(field, { state: 'error', message });
        toast.error(message);
        return false;
      }
    },
    [qc, courseId, status.set],
  );

  return { save, status: status.get };
}
