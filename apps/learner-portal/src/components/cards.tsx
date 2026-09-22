import { ArrowRight, Award, Lock, MapPin, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { parseISO, format } from 'date-fns';
import type { MyEnrollment, MyPathEnrollment } from '../lib/learn';
import { plural } from '../lib/format';
import { sessionWhen, sourceText } from '../lib/learnFormat';
import { CourseGlyph, DueText, LessonIcon } from './kit';
import { LinkButton, ProgressBar, StatusPill } from './ui';

/** Cards and rows for courses, paths, enrollments and sessions — shared by Home, My learning and the Catalog. */

/** The one course card, shared with the catalog so a course looks the same everywhere. */
export { CatalogCourseCard as CourseCard } from './catalog/CatalogCards';

/** The one action an enrollment calls for. */
export function EnrollmentAction({ e, size = 'sm', className }: { e: MyEnrollment; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  if (e.lockedBy) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-sm text-muted-foreground', className)}>
        <Lock className="h-4 w-4" aria-hidden /> Finish {e.lockedBy} first
      </span>
    );
  }
  if (e.status === 'Completed') {
    return (
      <div className={cn('flex flex-wrap gap-2', className)}>
        {e.certificateId && (
          <LinkButton to={`/certificates/${e.certificateId}`} variant="soft" size={size}>
            <Award /> Certificate
          </LinkButton>
        )}
        <LinkButton to={`/learn/${e.course.slug}`} variant="secondary" size={size} aria-label={`Review ${e.course.title}`}>
          Review
        </LinkButton>
      </div>
    );
  }
  const started = e.status === 'In progress';
  return (
    <LinkButton to={`/learn/${e.course.slug}`} variant={started ? 'primary' : 'secondary'} size={size} className={className} aria-label={`${started ? 'Resume' : 'Start'} ${e.course.title}`}>
      {started ? 'Resume' : 'Start'} <ArrowRight aria-hidden />
    </LinkButton>
  );
}

/**
 * One enrollment as a row. The same grid everywhere: a thumbnail top-aligned
 * with the title, a meta line (where it came from · due), progress with its
 * percentage beside the bar and the next lesson, and the one action centred
 * on the row. On phones the action drops under the text.
 */
export function EnrollmentRow({ e, showNext = true }: { e: MyEnrollment; showNext?: boolean }) {
  const done = e.status === 'Completed';
  const next = !done && showNext && e.nextLesson && !e.lockedBy ? e.nextLesson : null;
  return (
    <li className="grid grid-cols-[48px_minmax(0,1fr)] gap-x-4 py-5 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-center">
      <CourseGlyph coverImageUrl={e.course.coverImageUrl} title={e.course.title} color={e.course.color} size={56} className="!h-12 !w-12 self-start sm:!h-14 sm:!w-14" />
      <div className="min-w-0 self-start">
        <h3 className="font-serif text-[17px] font-semibold leading-snug">
          <Link to={`/courses/${e.course.slug}`} className="rounded decoration-foreground/25 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
            {e.course.title}
          </Link>
        </h3>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
          <span className="truncate">{sourceText(e)}</span>
          {done && e.completedAt ? (
            <>
              <span aria-hidden className="hidden sm:inline">·</span>
              <span className="w-full whitespace-nowrap sm:w-auto">Completed {format(parseISO(e.completedAt), 'MMM d, yyyy')}</span>
            </>
          ) : e.dueDate && e.dueState !== 'no_due' ? (
            <>
              <span aria-hidden className="hidden sm:inline">·</span>
              <DueText dueDate={e.dueDate} dueState={e.dueState} className="w-full whitespace-nowrap sm:w-auto" />
            </>
          ) : null}
        </p>
        {!done && (e.progress > 0 || next) && (
          <div className="mt-2.5 flex min-w-0 items-center gap-3 text-sm">
            {e.progress > 0 && (
              <span className="flex shrink-0 items-center gap-2">
                <ProgressBar value={e.progress / 100} className="h-1.5 w-24 sm:w-32" label={`${e.course.title} progress`} />
                <span className="w-9 text-xs tabular-nums text-muted-foreground">{e.progress}%</span>
              </span>
            )}
            {next && (
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <LessonIcon type={next.type} className="h-3.5 w-3.5" />
                <span className="truncate">
                  {e.progress > 0 ? 'Next' : 'Starts with'}: <span className="text-foreground/85">{next.title}</span>
                </span>
              </span>
            )}
          </div>
        )}
      </div>
      <div className="col-start-2 mt-3 flex sm:col-start-3 sm:mt-0 sm:justify-end sm:pl-4">
        <EnrollmentAction e={e} />
      </div>
    </li>
  );
}

/** A learning path as a row: one segment per course, what's next, and a way in. */
export function PathRow({ p }: { p: MyPathEnrollment }) {
  const done = p.status === 'Completed';
  return (
    <li className="grid grid-cols-[48px_minmax(0,1fr)] gap-x-4 py-5 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-center">
      <CourseGlyph coverImageUrl={p.path.coverImageUrl} title={p.path.title} color={p.path.color} size={56} className="!h-12 !w-12 self-start sm:!h-14 sm:!w-14" />
      <div className="min-w-0 self-start">
        <h3 className="font-serif text-[17px] font-semibold leading-snug">
          <Link to={`/paths/${p.path.slug}`} className="rounded decoration-foreground/25 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
            {p.path.title}
          </Link>
        </h3>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
          <span>Learning path</span>
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">
            {p.done} of {plural(p.total, 'course')} done
          </span>
          {!done && p.dueDate && (
            <>
              <span aria-hidden className="hidden sm:inline">·</span>
              <DueText dueDate={p.dueDate} dueState={p.dueState} className="w-full whitespace-nowrap sm:w-auto" />
            </>
          )}
        </p>
        <div className="mt-2.5 flex min-w-0 items-center gap-3 text-sm">
          <ol className="flex w-24 shrink-0 items-center gap-1 sm:w-32" aria-label={`${p.done} of ${p.total} courses complete`}>
            {[...p.courses].sort((x, y) => Number(y.status === 'Completed') - Number(x.status === 'Completed') || Number(y.courseId === p.nextCourse?.id) - Number(x.courseId === p.nextCourse?.id)).map(c => (
              <li key={c.courseId} className="flex-1" title={`${c.title}${c.status === 'Completed' ? ' — done' : c.locked ? ' — locked' : ''}`}>
                <span className={cn('block h-1.5 rounded-full', c.status === 'Completed' ? 'bg-primary' : p.nextCourse?.id === c.courseId ? 'bg-primary/35' : 'bg-muted', c.optional && 'opacity-60')} />
              </li>
            ))}
          </ol>
          {p.nextCourse && !done && (
            <span className="min-w-0 truncate text-muted-foreground">
              Next: <span className="text-foreground/85">{p.nextCourse.title}</span>
            </span>
          )}
        </div>
      </div>
      <div className="col-start-2 mt-3 flex sm:col-start-3 sm:mt-0 sm:justify-end sm:pl-4">
        <LinkButton to={`/paths/${p.path.slug}`} variant="secondary" size="sm" aria-label={`${done ? 'View' : 'Open'} ${p.path.title}`}>
          {done ? 'View path' : 'Open path'}
        </LinkButton>
      </div>
    </li>
  );
}

/** A calendar-page date block. */
export function DateBlock({ iso, className }: { iso: string | null; className?: string }) {
  if (!iso) return null;
  const d = parseISO(iso);
  return (
    <span className={cn('flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-lg border bg-background text-center shadow-2xs', className)} aria-hidden>
      <span className="w-full border-b bg-muted/60 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{format(d, 'MMM')}</span>
      <span className="py-1 font-serif text-xl font-semibold leading-none tabular-nums">{format(d, 'd')}</span>
    </span>
  );
}

export function SessionLine({ startsAt, endsAt, location, meetingUrl, children }: { startsAt: string | null; endsAt: string | null; location: string; meetingUrl?: string | null; children?: ReactNode }) {
  const online = /zoom|meet|teams|webex|online/i.test(location) || Boolean(meetingUrl);
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>{sessionWhen(startsAt, endsAt)}</span>
      {location && (
        <span className="inline-flex min-w-0 items-center gap-1">
          {online ? <Video className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{location}</span>
        </span>
      )}
      {children}
    </div>
  );
}

export function WaitlistPill({ status }: { status: string | null }) {
  if (status === 'Waitlisted') return <StatusPill tone="warning">Waitlisted</StatusPill>;
  if (status === 'Registered') return <StatusPill tone="success">You're registered</StatusPill>;
  if (status === 'Attended') return <StatusPill tone="success">Attended</StatusPill>;
  if (status === 'Absent') return <StatusPill tone="neutral">Missed</StatusPill>;
  return null;
}
