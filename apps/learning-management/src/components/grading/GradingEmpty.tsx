import { CheckCircle2, ClipboardCheck, RotateCcw, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { plural } from '../../lib/format';
import type { GradingTab, QueueCounts } from './gradingData';

/** The end of the queue — or a filter that matches nothing — with the one useful next step. */
export function GradingEmpty({ tab, counts, elsewhere = 0, filtered, scope, onClearFilters, onShowAll, search, compact }: {
  tab: GradingTab;
  counts: QueueCounts | undefined;
  /** Submissions waiting outside "My courses". */
  elsewhere?: number;
  filtered: boolean;
  scope: 'mine' | 'all';
  onClearFilters: () => void;
  onShowAll: () => void;
  search: (tab: GradingTab) => string;
  compact?: boolean;
}) {
  const link = 'inline-flex h-9 items-center rounded-md border bg-background px-3 text-[14px] font-medium shadow-2xs hover:bg-accent';
  let icon = <CheckCircle2 />;
  let title = 'All caught up';
  let description: string;
  let actions: ReactNode = null;

  if (filtered) {
    icon = <SearchX />;
    title = 'No submissions match';
    description = 'Try another search or course.';
    actions = <button type="button" onClick={onClearFilters} className={link}>Clear filters</button>;
  } else if (tab === 'todo' && scope === 'mine' && elsewhere > 0) {
    icon = <ClipboardCheck />;
    title = 'Nothing waiting in your courses';
    description = `${plural(elsewhere, 'submission')} ${elsewhere === 1 ? 'is' : 'are'} waiting in courses you don’t own or teach.`;
    actions = <button type="button" onClick={onShowAll} className={link}>Show all courses</button>;
  } else if (tab === 'todo') {
    const mine = counts?.gradedByMeThisWeek ?? 0;
    const week = counts?.gradedThisWeek ?? 0;
    description = mine
      ? `You graded ${plural(mine, 'submission')} this week. New work will show up here as learners submit it.`
      : week
        ? `${plural(week, 'submission')} graded this week${scope === 'mine' ? ' in your courses' : ''}. New work will show up here as learners submit it.`
        : 'Nothing is waiting for a grade. New work will show up here as learners submit it.';
    actions = (
      <>
        {scope === 'mine' && <button type="button" onClick={onShowAll} className={link}>Show all courses</button>}
        {(counts?.passed ?? 0) > 0 && <Link to={`/grading${search('graded')}`} className={link}>See graded work</Link>}
      </>
    );
  } else if (tab === 'revision') {
    icon = <RotateCcw />;
    title = 'Nothing waiting on a resubmission';
    description = 'Work you send back for revision waits here until the learner tries again.';
  } else {
    icon = <ClipboardCheck />;
    title = 'Nothing graded yet';
    description = 'Passed submissions collect here, so you can revisit a grade or its feedback.';
  }

  return (
    <div className={cn('flex h-full flex-col items-center justify-center px-6 text-center animate-fade-up', compact ? 'py-12' : 'py-16')}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border bg-subtle text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">{icon}</div>
      <h2 className={cn('font-medium', compact ? 'text-[15px]' : 'text-[16px]')}>{title}</h2>
      <p className="mt-1 max-w-sm text-[14px] text-muted-foreground">{description}</p>
      {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
