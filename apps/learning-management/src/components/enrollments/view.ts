import { useCallback, useEffect, useMemo, useState } from 'react';
import { DUE_META, SOURCE_LABEL, STATUS_META, type DisplayProperty, type Grouping } from '../../lib/constants';
import type { Enrollment, EnrollmentFilters, EnrollmentOrdering } from '../../lib/types';
import type { Workspace } from '../../lib/workspace';

export type ViewOptions = { ordering: EnrollmentOrdering; groupBy: Grouping; properties: DisplayProperty[] };

export const DEFAULT_OPTIONS: ViewOptions = { ordering: 'due_asc', groupBy: 'none', properties: ['course', 'person', 'due', 'progress', 'score', 'activity'] };

/** A saved view's config: `{ filters, ordering, groupBy, properties }`. */
export function parseViewConfig(raw: string | null | undefined): { filters: EnrollmentFilters; options: Partial<ViewOptions> } {
  try {
    const v = JSON.parse(raw || '{}') as Record<string, unknown>;
    const { filters, ...rest } = v;
    return { filters: (filters as EnrollmentFilters) ?? {}, options: rest as Partial<ViewOptions> };
  } catch {
    return { filters: {}, options: {} };
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Filters and display options for one surface, remembered for the browser
 * session so leaving and coming back keeps your place. `defaults` come from
 * the surface (or a saved view) and "Reset" returns to them.
 */
export function useViewState(surfaceKey: string, defaults?: Partial<ViewOptions>, defaultFilters?: EnrollmentFilters) {
  const baseOptions = useMemo(() => ({ ...DEFAULT_OPTIONS, ...(defaults ?? {}) }), [JSON.stringify(defaults ?? {})]);
  const baseFilters = useMemo(() => defaultFilters ?? {}, [JSON.stringify(defaultFilters ?? {})]);
  const [options, setOptionsState] = useState<ViewOptions>(() => read(`lms:view:${surfaceKey}:options`, baseOptions));
  const [filters, setFiltersState] = useState<EnrollmentFilters>(() => {
    try {
      const raw = sessionStorage.getItem(`lms:view:${surfaceKey}:filters`);
      return raw ? JSON.parse(raw) : baseFilters;
    } catch {
      return baseFilters;
    }
  });

  useEffect(() => {
    setOptionsState(read(`lms:view:${surfaceKey}:options`, baseOptions));
    try {
      const raw = sessionStorage.getItem(`lms:view:${surfaceKey}:filters`);
      setFiltersState(raw ? JSON.parse(raw) : baseFilters);
    } catch {
      setFiltersState(baseFilters);
    }
  }, [surfaceKey, baseOptions, baseFilters]);

  const setOptions = useCallback(
    (patch: Partial<ViewOptions>) =>
      setOptionsState(prev => {
        const next = { ...prev, ...patch };
        try {
          sessionStorage.setItem(`lms:view:${surfaceKey}:options`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      }),
    [surfaceKey],
  );
  const setFilters = useCallback(
    (next: EnrollmentFilters | ((f: EnrollmentFilters) => EnrollmentFilters)) =>
      setFiltersState(prev => {
        const value = typeof next === 'function' ? next(prev) : next;
        const clean = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))) as EnrollmentFilters;
        try {
          sessionStorage.setItem(`lms:view:${surfaceKey}:filters`, JSON.stringify(clean));
        } catch {
          /* ignore */
        }
        return clean;
      }),
    [surfaceKey],
  );
  const reset = useCallback(() => {
    try {
      sessionStorage.removeItem(`lms:view:${surfaceKey}:options`);
      sessionStorage.removeItem(`lms:view:${surfaceKey}:filters`);
    } catch {
      /* ignore */
    }
    setOptionsState(baseOptions);
    setFiltersState(baseFilters);
  }, [surfaceKey, baseOptions, baseFilters]);
  const isDirty = JSON.stringify(options) !== JSON.stringify(baseOptions) || JSON.stringify(filters) !== JSON.stringify(baseFilters);
  return { options, setOptions, filters, setFilters, reset, isDirty };
}

export type EnrollmentGroup = { key: string; label: string; rows: Enrollment[]; courseId?: string; personId?: string; color?: string; tone?: string };

const DUE_ORDER = ['overdue', 'due_soon', 'on_track', 'no_due', 'done', 'withdrawn'] as const;
const STATUS_ORDER = ['In progress', 'Not started', 'Completed', 'Withdrawn'] as const;

export function groupEnrollments(rows: Enrollment[], groupBy: Grouping, ws: Workspace, managerNames: Map<string, string>): EnrollmentGroup[] {
  if (groupBy === 'none') return [{ key: 'all', label: 'All', rows }];
  const map = new Map<string, EnrollmentGroup>();
  const add = (key: string, make: () => Omit<EnrollmentGroup, 'rows'>, row: Enrollment) => {
    if (!map.has(key)) map.set(key, { ...make(), rows: [] });
    map.get(key)!.rows.push(row);
  };
  for (const r of rows) {
    switch (groupBy) {
      case 'status':
        add(r.status, () => ({ key: r.status, label: STATUS_META[r.status].label, tone: STATUS_META[r.status].tone }), r);
        break;
      case 'due':
        add(r.dueState, () => ({ key: r.dueState, label: DUE_META[r.dueState].label, tone: DUE_META[r.dueState].text }), r);
        break;
      case 'course': {
        const c = ws.courseById.get(r.courseId);
        add(r.courseId, () => ({ key: r.courseId, label: c?.title ?? 'Unknown course', courseId: r.courseId, color: c?.color }), r);
        break;
      }
      case 'person':
        add(r.personId, () => ({ key: r.personId, label: r.personName, personId: r.personId }), r);
        break;
      case 'manager': {
        const key = r.managerId ?? 'none';
        add(key, () => ({ key, label: r.managerId ? managerNames.get(r.managerId) ?? 'Manager' : 'No manager', personId: r.managerId ?? undefined }), r);
        break;
      }
      case 'source':
        add(r.source, () => ({ key: r.source, label: SOURCE_LABEL[r.source] ?? r.source }), r);
        break;
    }
  }
  const groups = [...map.values()];
  if (groupBy === 'due') groups.sort((a, b) => DUE_ORDER.indexOf(a.key as never) - DUE_ORDER.indexOf(b.key as never));
  else if (groupBy === 'status') groups.sort((a, b) => STATUS_ORDER.indexOf(a.key as never) - STATUS_ORDER.indexOf(b.key as never));
  else if (groupBy === 'manager') groups.sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label)));
  else groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}
