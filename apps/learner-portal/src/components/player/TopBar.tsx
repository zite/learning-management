import { ArrowLeft, ListTree, MessageCircleQuestion, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import type { DueState } from '@project/shared/progress';
import { CourseGlyph, DueText } from '../kit';
import { Tip } from '../ui';
import { courseCounts } from './Outline';
import type { Player } from './queries';

const iconButton =
  'inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[14px] font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 [&_svg]:h-[18px] [&_svg]:w-[18px]';

const SHOWN_DUE = new Set(['overdue', 'due_soon', 'on_track']);

export function TopBar({
  player,
  outlineOpen,
  onToggleOutline,
  onOpenMobileOutline,
  onOpenQuestions,
  onOpenTutor,
  questionCount,
}: {
  player: Player;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  onOpenMobileOutline: () => void;
  onOpenQuestions: () => void;
  onOpenTutor: () => void;
  questionCount: number;
}) {
  const counts = courseCounts(player);
  const e = player.enrollment;
  const complete = e?.status === 'Completed';
  // The deadline is context, not a status: tone-coloured text in the subtitle, only while it still matters.
  const showDue = Boolean(e && !complete && e.dueDate && SHOWN_DUE.has(e.dueState));

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-1 border-b bg-background/95 px-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:gap-2 sm:px-3">
      <Tip label="Back to the course page" side="bottom">
        <Link to={`/courses/${player.course.slug}`} className={iconButton} aria-label={`Back to ${player.course.title}`}>
          <ArrowLeft aria-hidden />
        </Link>
      </Tip>
      <Tip label={outlineOpen ? 'Hide outline (O)' : 'Show outline (O)'} side="bottom">
        <button type="button" onClick={onToggleOutline} className={cn(iconButton, 'hidden lg:inline-flex')} aria-label={outlineOpen ? 'Hide course outline' : 'Show course outline'} aria-expanded={outlineOpen} aria-controls="player-outline">
          {outlineOpen ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}
        </button>
      </Tip>

      <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-0.5">
        <CourseGlyph coverImageUrl={player.course.coverImageUrl} color={player.course.color} title={player.course.title} size={32} className="hidden sm:inline-flex" />
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold leading-tight">{player.course.title}</p>
          <p className="truncate text-xs leading-tight text-muted-foreground">
            {complete ? (
              'Completed'
            ) : (
              <>
                <span className="tabular-nums">{counts.percent}%</span>
                <span className={showDue ? 'hidden sm:inline' : undefined}> complete</span>
                <span className="hidden sm:inline">
                  {' '}
                  · {counts.done} of {counts.total} lessons
                </span>
              </>
            )}
            {showDue && e && (
              <>
                <span aria-hidden> · </span>
                <DueText dueDate={e.dueDate} dueState={e.dueState as DueState} />
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        {player.features.discussions && (
          <Tip label="Questions on this lesson (Q)" side="bottom">
            <button type="button" onClick={onOpenQuestions} className={iconButton} aria-label={`Questions${questionCount ? ` (${questionCount})` : ''}`}>
              <MessageCircleQuestion aria-hidden />
              <span className="hidden md:inline">Questions</span>
              {questionCount > 0 && <span className="hidden min-w-5 rounded-full bg-muted px-1.5 text-center text-xs tabular-nums text-muted-foreground sm:inline">{questionCount}</span>}
            </button>
          </Tip>
        )}
        {player.features.ai && (
          <Tip label="Ask the study assistant about this lesson" side="bottom">
            <button type="button" onClick={onOpenTutor} className={iconButton} aria-label="Ask the study assistant about this lesson">
              <Sparkles aria-hidden />
              <span className="hidden md:inline">Ask AI</span>
            </button>
          </Tip>
        )}
        <button type="button" onClick={onOpenMobileOutline} className={cn(iconButton, 'lg:hidden')} aria-label="Course outline">
          <ListTree aria-hidden />
        </button>
      </div>

      <div
        className="absolute inset-x-0 -bottom-px h-[2px]"
        role="progressbar"
        aria-label="Course progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={counts.percent}
      >
        <div className={cn('h-full transition-[width] duration-700 ease-out', complete ? 'bg-tone-success' : 'bg-primary')} style={{ width: `${counts.percent}%` }} />
      </div>
    </header>
  );
}
