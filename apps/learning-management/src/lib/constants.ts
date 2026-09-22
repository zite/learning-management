import { PALETTE } from '@project/shared/palette';
import type { DueState, EnrollmentOrdering, EnrollmentStatus } from './types';

/**
 * Display vocabulary shared by every surface: statuses, due states, orderings
 * and groupings, lesson types, colours. Tone classes come from the semantic
 * tokens in index.css so both themes stay above contrast.
 */

export const STATUS_META: Record<EnrollmentStatus, { label: string; tone: string; dot: string }> = {
  'Not started': { label: 'Not started', tone: 'text-muted-foreground', dot: 'bg-tone-neutral' },
  'In progress': { label: 'In progress', tone: 'text-primary', dot: 'bg-primary' },
  Completed: { label: 'Completed', tone: 'text-tone-success', dot: 'bg-tone-success' },
  Withdrawn: { label: 'Withdrawn', tone: 'text-muted-foreground', dot: 'bg-muted-foreground/40' },
};

export const DUE_META: Record<DueState, { label: string; chip: string; text: string }> = {
  overdue: { label: 'Overdue', chip: 'bg-tone-danger/[0.1] text-tone-danger', text: 'text-tone-danger' },
  due_soon: { label: 'Due soon', chip: 'bg-tone-warning/[0.12] text-tone-warning', text: 'text-tone-warning' },
  on_track: { label: 'On track', chip: 'bg-muted text-muted-foreground', text: 'text-muted-foreground' },
  no_due: { label: 'No due date', chip: 'bg-muted text-muted-foreground', text: 'text-muted-foreground' },
  done: { label: 'Completed', chip: 'bg-tone-success/[0.1] text-tone-success', text: 'text-tone-success' },
  withdrawn: { label: 'Withdrawn', chip: 'bg-muted text-muted-foreground', text: 'text-muted-foreground' },
};

export const ORDERINGS: Array<{ value: EnrollmentOrdering; label: string }> = [
  { value: 'due_asc', label: 'Due date' },
  { value: 'activity_desc', label: 'Last activity' },
  { value: 'progress_asc', label: 'Least progress' },
  { value: 'progress_desc', label: 'Most progress' },
  { value: 'enrolled_desc', label: 'Newest enrollments' },
  { value: 'completed_desc', label: 'Recently completed' },
  { value: 'name_asc', label: 'Learner name' },
  { value: 'course_asc', label: 'Course title' },
  { value: 'score_desc', label: 'Highest score' },
  { value: 'score_asc', label: 'Lowest score' },
];

export type Grouping = 'none' | 'status' | 'due' | 'course' | 'person' | 'manager' | 'source';

export const GROUPINGS: Array<{ value: Grouping; label: string }> = [
  { value: 'none', label: 'No grouping' },
  { value: 'status', label: 'Status' },
  { value: 'due', label: 'Due state' },
  { value: 'course', label: 'Course' },
  { value: 'person', label: 'Learner' },
  { value: 'manager', label: 'Manager' },
  { value: 'source', label: 'How they enrolled' },
];

export const DISPLAY_PROPERTIES = ['course', 'person', 'title', 'due', 'progress', 'score', 'activity', 'source', 'time'] as const;
export type DisplayProperty = (typeof DISPLAY_PROPERTIES)[number];
export const DISPLAY_PROPERTY_LABEL: Record<DisplayProperty, string> = {
  course: 'Course',
  person: 'Learner',
  title: 'Job title',
  due: 'Due date',
  progress: 'Progress',
  score: 'Quiz score',
  activity: 'Last activity',
  source: 'Enrolled via',
  time: 'Time spent',
};

export const SOURCE_LABEL: Record<string, string> = { Assigned: 'Assigned', 'Self-enrolled': 'Self-enrolled', Automatic: 'Assignment rule', Path: 'Learning path' };

export const COURSE_COLORS = PALETTE;
export const COURSE_ICONS = ['📘', '🔐', '📜', '🤝', '🌲', '📦', '🎯', '🛎️', '💬', '🗓️', '🌿', '🧭', '🛡️', '⛑️', '📈', '✨', '🧠', '🧪', '🎓', '🚀', '💡', '🏗️', '🧾', '🗂️'];
export const GROUP_KINDS = ['Department', 'Team', 'Location', 'Cohort', 'Customer', 'Partner'] as const;
export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;
