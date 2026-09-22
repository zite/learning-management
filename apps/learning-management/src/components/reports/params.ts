import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getComplianceReport, getCourseReport, getQuizReport, getReports, type GetComplianceReportOutputType, type GetCourseReportOutputType, type GetQuizReportOutputType, type GetReportsOutputType } from 'zitejs/api';
import { parseDay } from '../../lib/format';
import { qk } from '../../lib/queries';

export type Reports = GetReportsOutputType;
export type Compliance = GetComplianceReportOutputType;
export type CourseReport = GetCourseReportOutputType;
export type QuizReport = GetQuizReportOutputType;
export type ReportRange = Reports['range'];

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'courses', label: 'Courses' },
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'engagement', label: 'Engagement' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

export const RANGES = [
  { id: '30d', short: '30d', label: 'Last 30 days' },
  { id: '90d', short: '90d', label: 'Last 90 days' },
  { id: '12m', short: '12m', label: 'Last 12 months' },
] as const;
export type RangeId = '30d' | '90d' | '12m' | 'custom';

const isDay = (s: string | null): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const list = (s: string | null) => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : []);

/**
 * Report filters live in the URL, so a link to a report opens exactly what
 * the sender saw: range, groups, categories and each tab's own selection.
 */
export type ReportParams = {
  range: RangeId;
  from: string | null;
  to: string | null;
  groupIds: string[];
  categoryIds: string[];
  courseId: string | null;
  quizId: string | null;
  quizCourseId: string | null;
  managerId: string | null;
  itemIds: string[];
  gapsOnly: boolean;
  page: number;
};

function parse(p: URLSearchParams): ReportParams {
  const from = p.get('from');
  const to = p.get('to');
  const raw = p.get('range');
  const custom = raw === 'custom' && isDay(from) && isDay(to);
  return {
    range: custom ? 'custom' : raw === '30d' || raw === '12m' ? raw : '90d',
    from: custom ? from : null,
    to: custom ? to : null,
    groupIds: list(p.get('groups')),
    categoryIds: list(p.get('categories')),
    courseId: p.get('course') || null,
    quizId: p.get('quiz') || null,
    quizCourseId: p.get('quizCourse') || null,
    managerId: p.get('manager') || null,
    itemIds: list(p.get('items')),
    gapsOnly: p.get('gaps') === '1',
    page: Math.max(0, Number(p.get('page')) || 0),
  };
}

function serialize(v: ReportParams) {
  const out = new URLSearchParams();
  if (v.range !== '90d') out.set('range', v.range);
  if (v.range === 'custom' && v.from && v.to) {
    out.set('from', v.from);
    out.set('to', v.to);
  }
  if (v.groupIds.length) out.set('groups', v.groupIds.join(','));
  if (v.categoryIds.length) out.set('categories', v.categoryIds.join(','));
  if (v.courseId) out.set('course', v.courseId);
  if (v.quizId) out.set('quiz', v.quizId);
  if (v.quizCourseId) out.set('quizCourse', v.quizCourseId);
  if (v.managerId) out.set('manager', v.managerId);
  if (v.itemIds.length) out.set('items', v.itemIds.join(','));
  if (v.gapsOnly) out.set('gaps', '1');
  if (v.page) out.set('page', String(v.page));
  return out;
}

export function useReportParams() {
  const [search, setSearch] = useSearchParams();
  const value = useMemo(() => parse(search), [search]);
  const update = useCallback(
    (patch: Partial<ReportParams>) =>
      setSearch(prev => {
        const next = { ...parse(prev), ...patch };
        // Changing who's in scope starts the compliance matrix from the top.
        if (!('page' in patch) && ('groupIds' in patch || 'managerId' in patch || 'gapsOnly' in patch || 'itemIds' in patch)) next.page = 0;
        return serialize(next);
      }, { replace: true }),
    [setSearch],
  );
  const query = search.toString();
  return { params: value, update, search: query ? `?${query}` : '' };
}

/** What every range-scoped endpoint takes. Empty lists are omitted so query keys stay stable. */
export function scopeInput(p: ReportParams) {
  return {
    range: p.range,
    ...(p.range === 'custom' && p.from && p.to ? { from: p.from, to: p.to } : {}),
    ...(p.groupIds.length ? { groupIds: p.groupIds } : {}),
    ...(p.categoryIds.length ? { categoryIds: p.categoryIds } : {}),
  };
}

export function rangeText(fromDay: string, toDay: string) {
  const a = parseDay(fromDay);
  const b = parseDay(toDay);
  const sameYear = a.getFullYear() === b.getFullYear();
  return `${format(a, sameYear ? 'MMM d' : 'MMM d, yyyy')} – ${format(b, sameYear && b.getFullYear() === new Date().getFullYear() ? 'MMM d' : 'MMM d, yyyy')}`;
}

export function periodLabel(r: ReportRange) {
  if (r.id === '30d') return 'the previous 30 days';
  if (r.id === '90d') return 'the previous 90 days';
  if (r.id === '12m') return 'the 12 months before';
  return `the previous ${r.days} days`;
}

export function bucketLabel(bucket: string, unit: ReportRange['bucket'], long = false) {
  const d = parseDay(bucket);
  // A 12-month axis spans two years: January carries the year so the two Septembers can't be confused.
  if (unit === 'month') return format(d, long ? 'MMMM yyyy' : d.getMonth() === 0 ? "MMM ''yy" : 'MMM');
  if (unit === 'week') return long ? `Week of ${format(d, 'MMM d, yyyy')}` : format(d, 'MMM d');
  return format(d, long ? 'EEE, MMM d' : 'MMM d');
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function useReportsQuery(input: ReturnType<typeof scopeInput>, enabled = true) {
  return useQuery({ queryKey: [...qk.reportsRoot, 'overview', input], queryFn: () => getReports(input), enabled, placeholderData: keepPreviousData, staleTime: 60_000 });
}

export function useComplianceQuery(input: { groupIds?: string[]; managerId?: string; itemIds?: string[]; gapsOnly?: boolean; offset: number; limit: number }) {
  return useQuery({ queryKey: [...qk.reportsRoot, 'compliance', input], queryFn: () => getComplianceReport(input), placeholderData: keepPreviousData, staleTime: 60_000 });
}

export function useCourseReportQuery(courseId: string | null, input: { range: RangeId; from?: string; to?: string; groupIds?: string[] }) {
  return useQuery({
    queryKey: [...qk.reportsRoot, 'course', courseId, input],
    queryFn: () => getCourseReport({ courseId: courseId!, ...input }),
    enabled: Boolean(courseId),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: (count, error) => !/no longer exists/i.test(String((error as Error)?.message)) && count < 2,
  });
}

export function useQuizReportQuery(lessonId: string | null, input: ReturnType<typeof scopeInput> & { courseIds?: string[] }, enabled = true) {
  return useQuery({
    queryKey: [...qk.reportsRoot, 'quiz', lessonId, input],
    queryFn: () => getQuizReport({ ...input, lessonId: lessonId ?? undefined }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: (count, error) => !/no longer exists|isn’t a quiz/i.test(String((error as Error)?.message)) && count < 2,
  });
}
