import { createContext, useContext } from 'react';

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
};

export type EnrollIntent = {
  /** Preselected target; the dialog lets the user pick when absent. */
  targetType?: 'Course' | 'Path';
  targetId?: string;
  personIds?: string[];
  groupIds?: string[];
};

/**
 * App-wide actions any screen can trigger. The dialogs themselves live once in
 * the shell, so enrolling from a course, a person, a group, a list selection
 * or the command menu is the same flow.
 */
export type AppActions = {
  openPalette: (initialQuery?: string) => void;
  openShortcuts: () => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** The enrollment side panel — lesson-by-lesson progress, attempts, history. */
  openEnrollment: (enrollmentId: string) => void;
  closeEnrollment: () => void;
  enrollmentId: string | null;
  openEnroll: (intent?: EnrollIntent) => void;
  openCreateCourse: () => void;
  openCreatePath: () => void;
  openInvite: () => void;
  openCreateSession: (courseId?: string) => void;
  /** The course the current screen is about, so create actions default sensibly. */
  setContextCourse: (courseId: string | null) => void;
  contextCourseId: string | null;
};

export const AppActionsContext = createContext<AppActions | null>(null);

export function useAppActions() {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error('useAppActions must be used inside AppShell');
  return ctx;
}
