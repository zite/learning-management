import { ArrowLeft, ArrowRight, Award, Check, ChevronLeft, ChevronRight, Flag, Lock, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { shortDate } from '../../lib/format';
import { MOD } from '../../lib/hotkeys';
import { Button, LinkButton } from '../ui';
import { Kbd } from './bits';
import { lockReason } from './Outline';
import type { Player, PlayerLesson } from './queries';

/**
 * Under every lesson: what finishing it takes (or that it's done) with the one
 * action that moves the learner on, then the lessons either side. On the last
 * lesson the right-hand card becomes the finish line, and once the course is
 * complete the bar becomes its ending — certificate, rating, what's next.
 */

export type Gate = { ready: boolean; hint: string | null };

/** The first unfinished required lesson the learner can open, other than this one. */
export function firstUnfinished(player: Player, exceptId: string): PlayerLesson | null {
  return player.lessons.find(l => l.id !== exceptId && !l.optional && l.state !== 'completed' && l.state !== 'locked') ?? null;
}

type Props = {
  player: Player;
  slug: string;
  lessonId: string;
  lessonType: string;
  gate: Gate;
  /** The lesson's own block is showing the next step (a quiz result), so the bar above the lesson links stays out of the way. */
  quiet: boolean;
  completed: boolean;
  justCompleted: boolean;
  selfCompletable: boolean;
  canMarkComplete: boolean;
  completing: boolean;
  onComplete: () => void;
  onNext: () => void;
  onRate: () => void;
  prevLesson: PlayerLesson | null;
  nextLesson: PlayerLesson | null;
  nextLocked: boolean;
};

const card =
  'group flex min-h-[4.25rem] items-center gap-3 rounded-xl border bg-background px-4 py-3 transition-colors hover:border-foreground/20 hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35';

export function LessonFooter(props: Props) {
  const { player, slug, lessonId, lessonType, gate, quiet, completed, justCompleted, selfCompletable, canMarkComplete, completing, onComplete, onNext, onRate, prevLesson, nextLesson, nextLocked } = props;
  const courseDone = player.enrollment?.status === 'Completed';
  const isLast = !nextLesson;
  const remaining = firstUnfinished(player, lessonId);
  const remainingCount = player.lessons.filter(l => l.id !== lessonId && !l.optional && l.state !== 'completed').length;
  const finishesCourse = !courseDone && !completed && remainingCount === 0 && !player.lessons.find(l => l.id === lessonId)?.optional;
  const certificate = player.certificate;
  const pathNext = player.path?.nextCourse ?? null;

  // The action that moves things on — the same one in the desktop bar and the phone's bottom bar.
  let status: ReactNode = null;
  let action: ReactNode = null;
  let phoneHint: string | null = null;
  const ending = completed && courseDone && isLast;

  if (ending) {
    action = certificate ? (
      <LinkButton size="lg" to={`/certificates/${certificate.id}`} className="w-full sm:w-auto">
        <Award aria-hidden /> View certificate
      </LinkButton>
    ) : (
      <LinkButton size="lg" to={pathNext ? `/courses/${pathNext.slug}` : '/learning'} className="w-full sm:w-auto">
        {pathNext ? 'Next course' : 'My learning'} <ArrowRight aria-hidden />
      </LinkButton>
    );
  } else if (completed) {
    status = (
      <span className="inline-flex items-center gap-2.5 font-medium">
        <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full bg-tone-success text-white dark:text-[hsl(30_8%_7%)]', justCompleted && 'animate-pop')} aria-hidden>
          <Check className="h-3 w-3" strokeWidth={3.2} />
        </span>
        <span>
          {justCompleted ? 'Lesson complete' : 'You’ve completed this lesson'}
          {isLast && remaining && (
            <span className="font-normal text-muted-foreground">
              {' '}
              · {remainingCount === 1 ? 'one more lesson to finish the course' : `${remainingCount} more lessons to finish the course`}
            </span>
          )}
        </span>
      </span>
    );
    if (nextLesson && nextLocked) phoneHint = lockReason(player, nextLesson.id);
    else
      action = (
        <Button size="lg" onClick={onNext} className="w-full sm:w-auto">
          {nextLesson ? 'Next lesson' : remaining ? 'Continue' : 'Course overview'} <ArrowRight aria-hidden />
        </Button>
      );
  } else if (selfCompletable) {
    status = <span className={gate.ready ? 'text-muted-foreground' : 'text-foreground/85'}>{gate.ready ? (finishesCourse ? 'Mark it complete to finish the course.' : 'Done with this lesson?') : gate.hint}</span>;
    action = (
      <Button size="lg" onClick={onComplete} disabled={!canMarkComplete} loading={completing} className="w-full sm:w-auto" aria-describedby="lesson-gate">
        <Check aria-hidden /> Mark complete
        <Kbd className="ml-1 hidden border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground sm:inline-flex">{MOD}↵</Kbd>
      </Button>
    );
    if (!canMarkComplete) phoneHint = gate.hint;
  } else {
    // Quizzes, assignments and live sessions say what completes them in their own block above.
    phoneHint = gate.hint;
  }

  return (
    <footer className="mt-14">
      {ending ? (
        <CourseEnding player={player} onRate={onRate} />
      ) : status && !quiet ? (
        <div className={cn('hidden gap-3 rounded-2xl border bg-card px-5 py-3.5 shadow-xs md:flex md:items-center md:justify-between', completed && 'border-tone-success/25')}>
          <p id="lesson-gate" className="min-w-0 text-[15px]" aria-live="polite">
            {status}
          </p>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      ) : (
        <p id="lesson-gate" className="sr-only" aria-live="polite">
          {gate.hint}
        </p>
      )}

      <nav aria-label="Lessons" className={cn('grid gap-3 sm:grid-cols-2', ending ? 'mt-3 md:mt-4' : status && !quiet && 'md:mt-4')}>
        {prevLesson ? (
          <Link to={`/learn/${slug}/${prevLesson.id}`} className={card}>
            <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">Previous</span>
              <span className="block truncate text-[15px] font-medium">{prevLesson.title}</span>
            </span>
          </Link>
        ) : (
          <span className="hidden sm:block" />
        )}
        {nextLesson ? (
          nextLocked ? (
            <div aria-disabled="true" className="flex min-h-[4.25rem] items-center justify-end gap-3 rounded-xl border border-dashed px-4 py-3 text-right">
              <span className="min-w-0">
                <span className="block truncate text-xs text-muted-foreground">{lockReason(player, nextLesson.id)}</span>
                <span className="block truncate text-[15px] font-medium text-muted-foreground">{nextLesson.title}</span>
              </span>
              <Lock className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            </div>
          ) : (
            <Link to={`/learn/${slug}/${nextLesson.id}`} className={cn(card, 'justify-end text-right')}>
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">Next</span>
                <span className="block truncate text-[15px] font-medium">{nextLesson.title}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )
        ) : courseDone ? (
          <Link to={pathNext ? `/courses/${pathNext.slug}` : '/learning'} className={cn(card, 'justify-end text-right')}>
            <span className="min-w-0">
              <span className="block truncate text-xs text-muted-foreground">{pathNext ? `Next in ${player.path?.title}` : 'You’ve reached the end'}</span>
              <span className="block truncate text-[15px] font-medium">{pathNext ? pathNext.title : 'Back to my learning'}</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ) : remaining ? (
          <Link to={`/learn/${slug}/${remaining.id}`} className={cn(card, 'justify-end text-right')}>
            <span className="min-w-0">
              <span className="block truncate text-xs text-muted-foreground">
                {remainingCount === 1 ? 'One other lesson to finish' : `${remainingCount} other lessons to finish`}
              </span>
              <span className="block truncate text-[15px] font-medium">{remaining.title}</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ) : (
          <div className="flex min-h-[4.25rem] items-center justify-end gap-3 rounded-xl border border-dashed px-4 py-3 text-right">
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">Last lesson</span>
              <span className="block truncate text-[15px] font-medium text-foreground/85">{finishLine(lessonType, player.course.certificateEnabled)}</span>
            </span>
            <Flag className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </div>
        )}
      </nav>

      {/* Phones: the next step within thumb reach. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t bg-background/95 px-3 pt-2 backdrop-blur md:hidden" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        {prevLesson ? (
          <Link to={`/learn/${slug}/${prevLesson.id}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border bg-background" aria-label={`Previous: ${prevLesson.title}`}>
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
        ) : (
          <span className="h-11 w-11 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {action ? action : <p className="line-clamp-2 text-center text-sm leading-snug text-muted-foreground">{phoneHint ?? (completed ? 'Lesson complete' : '')}</p>}
        </div>
        {nextLesson && !nextLocked ? (
          <Link to={`/learn/${slug}/${nextLesson.id}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border bg-background" aria-label={`Next: ${nextLesson.title}`}>
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center text-faint" aria-hidden>
            {nextLesson ? <Lock className="h-4 w-4" /> : null}
          </span>
        )}
      </div>
    </footer>
  );
}

function finishLine(type: string, certificate: boolean) {
  const reward = certificate ? ' and earn your certificate' : '';
  if (type === 'Quiz') return `Pass it to finish the course${reward}`;
  if (type === 'Assignment') return `Pass it to finish the course${reward}`;
  if (type === 'Live session') return `Attend to finish the course${reward}`;
  return `Complete it to finish the course${reward}`;
}

/** The last lesson of a finished course: an ending, not a dead end. */
function CourseEnding({ player, onRate }: { player: Player; onRate: () => void }) {
  const e = player.enrollment;
  const certificate = player.certificate;
  const pathNext = player.path?.nextCourse ?? null;
  const rating = e?.rating ?? null;
  return (
    <section aria-labelledby="course-ending" className="rounded-2xl border bg-card shadow-xs">
      <div className="flex items-start gap-3.5 px-5 pb-4 pt-5 sm:px-6">
        <span className="mt-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-tone-success text-white dark:text-[hsl(30_8%_7%)]" aria-hidden>
          <Check className="h-3 w-3" strokeWidth={3.2} />
        </span>
        <div className="min-w-0">
          <h2 id="course-ending" className="font-serif text-xl font-semibold leading-snug">
            You finished {player.course.title}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {e?.completedAt ? `Completed ${shortDate(e.completedAt)}` : 'Course complete'}
            {certificate ? ' · Certificate issued' : ''}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t px-5 py-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:px-6">
        {certificate && (
          <LinkButton to={`/certificates/${certificate.id}`} className="hidden md:inline-flex">
            <Award aria-hidden /> View certificate
          </LinkButton>
        )}
        {pathNext && (
          <LinkButton to={`/courses/${pathNext.slug}`} variant={certificate ? 'secondary' : 'primary'} className="hidden md:inline-flex">
            Next: {pathNext.title} <ArrowRight aria-hidden />
          </LinkButton>
        )}
        <Button variant="secondary" onClick={onRate}>
          <Star className={cn(rating ? 'fill-tone-warning text-tone-warning' : 'text-muted-foreground')} aria-hidden />
          {rating ? `You rated it ${rating} of 5 · Change` : 'Rate this course'}
        </Button>
      </div>
    </section>
  );
}
