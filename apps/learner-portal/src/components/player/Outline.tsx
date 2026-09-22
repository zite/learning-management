import { Award, Check, ChevronRight, Lock, Star } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@project/components/lib/utils';
import { formatMinutes } from '@project/shared/lessons';
import { shortDate } from '../../lib/format';
import { ProgressBar, Tip } from '../ui';
import { LessonTypeIcon, revealInScroller } from './bits';
import type { Player, PlayerLesson } from './queries';

/**
 * The course at a glance: sections with how much of each is done, every lesson
 * with its state, and — at the foot — overall progress and what finishing earns.
 */

const footerRow =
  'flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm font-medium text-foreground/85 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35';

export function blockingLesson(player: Player, lessonId: string): PlayerLesson | null {
  for (const l of player.lessons) {
    if (l.id === lessonId) return null;
    if (!l.optional && l.state !== 'completed') return l;
  }
  return null;
}

/** What finishing a lesson takes, as a verb: quizzes and assignments are passed, live sessions attended. */
export function finishVerb(type: string) {
  return type === 'Quiz' || type === 'Assignment' ? 'Pass' : type === 'Live session' ? 'Attend' : 'Finish';
}

export function lockReason(player: Player, lessonId: string) {
  if (player.pathLock) return `Finish “${player.pathLock}” first`;
  const blocker = blockingLesson(player, lessonId);
  return blocker ? `${finishVerb(blocker.type)} “${blocker.title}” first` : 'Locked for now';
}

export function courseCounts(player: Player) {
  const counted = player.lessons.some(l => !l.optional) ? player.lessons.filter(l => !l.optional) : player.lessons;
  const done = counted.filter(l => l.state === 'completed').length;
  return { done, total: counted.length, percent: player.enrollment?.status === 'Completed' ? 100 : counted.length ? Math.round((done / counted.length) * 100) : 0 };
}

export function Outline({ player, currentLessonId, onNavigate, onRate, className }: { player: Player; currentLessonId?: string; onNavigate?: () => void; onRate: () => void; className?: string }) {
  const slug = player.course.slug;
  const groups = useMemo(() => {
    const out: Array<{ id: string; title: string | null; lessons: PlayerLesson[] }> = [];
    const loose = player.lessons.filter(l => !l.sectionId);
    if (loose.length) out.push({ id: 'loose', title: null, lessons: loose });
    for (const s of player.sections) {
      const lessons = player.lessons.filter(l => l.sectionId === s.id);
      if (lessons.length) out.push({ id: s.id, title: s.title, lessons });
    }
    return out;
  }, [player]);
  const counts = courseCounts(player);
  const complete = player.enrollment?.status === 'Completed';
  const currentRef = useRef<HTMLAnchorElement | null>(null);

  // Keep the current lesson in view when the outline opens or the lesson changes.
  useEffect(() => {
    revealInScroller(currentRef.current, { block: 'nearest', smooth: false, offset: 8 });
  }, [currentLessonId]);

  return (
    <nav aria-label="Course outline" className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4 pt-2">
        {groups.map(g => {
          const done = g.lessons.filter(l => l.state === 'completed').length;
          return (
            <section key={g.id} aria-label={g.title ?? 'Lessons'} className="mt-2 first:mt-0">
              {g.title && (
                <div className="flex items-baseline justify-between gap-3 px-3 pb-1.5 pt-3">
                  <h3 className="min-w-0 truncate text-[13px] font-medium text-muted-foreground">{g.title}</h3>
                  <span className="shrink-0 text-xs tabular-nums text-faint" aria-label={`${done} of ${g.lessons.length} done`}>
                    {done}/{g.lessons.length}
                  </span>
                </div>
              )}
              <ol className="space-y-0.5">
                {g.lessons.map(l => (
                  <li key={l.id}>
                    <OutlineRow player={player} lesson={l} slug={slug} current={l.id === currentLessonId} onNavigate={onNavigate} linkRef={l.id === currentLessonId ? currentRef : undefined} />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>

      <footer className="shrink-0 border-t bg-subtle px-4 py-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">{complete ? 'Course complete' : 'Your progress'}</span>
          <span className="tabular-nums text-muted-foreground">{counts.percent}%</span>
        </div>
        <ProgressBar value={counts.percent / 100} className="mt-2 h-1.5" label="Course progress" tone={complete ? 'success' : 'primary'} />
        <p className="mt-2 text-xs text-muted-foreground">
          {complete && player.enrollment?.completedAt
            ? `Completed ${shortDate(player.enrollment.completedAt)}`
            : `${counts.done} of ${counts.total} required lesson${counts.total === 1 ? '' : 's'} done`}
        </p>
        {(player.certificate || complete || player.course.certificateEnabled) && (
          <div className="-mx-1 mt-3 space-y-0.5">
            {player.certificate ? (
              <Link to={`/certificates/${player.certificate.id}`} className={footerRow}>
                <Award className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1">View your certificate</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              </Link>
            ) : player.course.certificateEnabled && !complete ? (
              <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
                <Award className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                Finish every required lesson to earn your certificate.
              </p>
            ) : null}
            {complete && (
              <button type="button" onClick={onRate} className={footerRow}>
                <Star className={cn('h-4 w-4 shrink-0', player.enrollment?.rating ? 'fill-tone-warning text-tone-warning' : 'text-muted-foreground')} aria-hidden />
                <span className="flex-1">{player.enrollment?.rating ? `You rated it ${player.enrollment.rating} of 5` : 'Rate this course'}</span>
                <span className="text-xs text-muted-foreground">{player.enrollment?.rating ? 'Change' : ''}</span>
              </button>
            )}
          </div>
        )}
      </footer>
    </nav>
  );
}

function OutlineRow({ player, lesson, slug, current, onNavigate, linkRef }: { player: Player; lesson: PlayerLesson; slug: string; current: boolean; onNavigate?: () => void; linkRef?: React.Ref<HTMLAnchorElement> }) {
  const locked = lesson.state === 'locked';
  const body = (
    <>
      <StateMark state={lesson.state} current={current} />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[14.5px] leading-snug', current ? 'font-semibold text-foreground' : lesson.state === 'completed' ? 'text-foreground/80' : locked ? 'text-muted-foreground' : 'text-foreground')}>{lesson.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <LessonTypeIcon type={lesson.type} className="h-3.5 w-3.5" />
          <span>{lesson.type}</span>
          {lesson.durationMinutes > 0 && <span aria-hidden>·</span>}
          {lesson.durationMinutes > 0 && <span>{formatMinutes(lesson.durationMinutes)}</span>}
          {lesson.optional && <span className="rounded bg-muted px-1.5 py-px text-2xs font-medium">Optional</span>}
        </span>
      </span>
    </>
  );
  const rowClass = cn(
    'relative flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
    current ? 'bg-primary/[0.08]' : 'hover:bg-accent',
    locked && 'cursor-not-allowed hover:bg-transparent',
  );
  if (locked) {
    const reason = lockReason(player, lesson.id);
    return (
      <Tip label={reason} side="right">
        <button type="button" aria-disabled="true" aria-label={`${lesson.title} — locked. ${reason}.`} className={rowClass} onClick={() => toast(reason, { description: player.pathLock ? 'Courses in this path are taken in order.' : 'This course is taken in order.' })}>
          {body}
        </button>
      </Tip>
    );
  }
  return (
    <Link
      ref={linkRef}
      to={`/learn/${slug}/${lesson.id}`}
      onClick={onNavigate}
      aria-current={current ? 'page' : undefined}
      aria-label={`${lesson.title}${lesson.state === 'completed' ? ' — completed' : ''}${lesson.optional ? ' (optional)' : ''}`}
      className={rowClass}
    >
      {current && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" aria-hidden />}
      {body}
    </Link>
  );
}

function StateMark({ state, current }: { state: PlayerLesson['state']; current: boolean }) {
  if (state === 'completed') {
    return (
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-tone-success text-white dark:text-[hsl(30_8%_7%)]" aria-hidden>
        <Check className="h-3 w-3" strokeWidth={3.2} />
      </span>
    );
  }
  if (state === 'locked') {
    return (
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-faint" aria-hidden>
        <Lock className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px]', current ? 'border-primary' : state === 'in_progress' ? 'border-primary/60' : 'border-input/70')} aria-hidden>
      {current ? <span className="h-2 w-2 rounded-full bg-primary" /> : state === 'in_progress' ? <span className="h-2 w-1 translate-x-[2px] rounded-r-full bg-primary/60" /> : null}
    </span>
  );
}
