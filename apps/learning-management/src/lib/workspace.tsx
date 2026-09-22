import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Bootstrap, Category, Course, EmailTemplate, Group, Path, SavedView, StaffMember } from './types';

/**
 * The reference data every screen renders names from, indexed once.
 *
 * Enrollment rows carry a course id; this is where it becomes a course glyph
 * and title. One memoised context is what lets an optimistic edit re-render
 * every surface from a single cache write.
 */
export type Workspace = Bootstrap & {
  isAdmin: boolean;
  isStaff: boolean;
  courseById: Map<string, Course>;
  pathById: Map<string, Path>;
  groupById: Map<string, Group>;
  categoryById: Map<string, Category>;
  staffById: Map<string, StaffMember>;
  templateById: Map<string, EmailTemplate>;
  viewById: Map<string, SavedView>;
  /** Published first, then drafts, archived last; by position within each. */
  orderedCourses: Course[];
  orderedPaths: Path[];
  publishedCourses: Course[];
  publishedPaths: Path[];
  activeStaff: StaffMember[];
  /** Courses the signed-in person can edit. */
  editableCourseIds: Set<string>;
  pathsContaining: (courseId: string) => Path[];
};

const WorkspaceContext = createContext<Workspace | null>(null);

const STATUS_ORDER: Record<string, number> = { Published: 0, Draft: 1, Archived: 2 };

export function buildWorkspace(data: Bootstrap): Workspace {
  const byId = <T extends { id: string }>(items: T[]) => new Map(items.map(i => [i.id, i]));
  const orderedCourses = [...data.courses].sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || a.position - b.position);
  const orderedPaths = [...data.paths].sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || a.position - b.position);
  return {
    ...data,
    isAdmin: data.me.role === 'Admin',
    isStaff: data.me.role === 'Admin' || data.me.role === 'Instructor',
    courseById: byId(data.courses),
    pathById: byId(data.paths),
    groupById: byId(data.groups),
    categoryById: byId(data.categories),
    staffById: byId(data.staff),
    templateById: byId(data.templates),
    viewById: byId(data.views),
    orderedCourses,
    orderedPaths,
    publishedCourses: orderedCourses.filter(c => c.status === 'Published'),
    publishedPaths: orderedPaths.filter(p => p.status === 'Published'),
    activeStaff: data.staff.filter(s => s.status !== 'Deactivated'),
    editableCourseIds: new Set(data.courses.filter(c => c.canEdit).map(c => c.id)),
    pathsContaining: courseId => data.paths.filter(p => p.courseIds.includes(courseId)),
  };
}

export function WorkspaceProvider({ data, children }: { data: Bootstrap; children: ReactNode }) {
  const value = useMemo(() => buildWorkspace(data), [data]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ws;
}
