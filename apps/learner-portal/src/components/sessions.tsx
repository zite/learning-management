import { CalendarPlus, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../lib/errors';
import { appUrl, plural } from '../lib/format';
import { useEnrollSelf, useSessionRegistration } from '../lib/learn';
import { downloadIcs } from '../lib/learnFormat';
import { Button, StatusPill } from './ui';

/**
 * What a learner can do with a live session: save a seat (or join the
 * waitlist), cancel, add it to a calendar and join the call. Registering needs
 * an enrollment in the session's course, so a catalog course can be enrolled
 * in and registered for in one step.
 *
 * `inline` (the default) lays the actions out in a row. `stacked` is for a
 * fixed-width action column: one full-width button, and a caption under it
 * (seats left, the secondary actions) so every row's column has the same shape.
 */

export type SessionLike = {
  id: string;
  title: string;
  description?: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string;
  meetingUrl: string | null;
  spotsLeft: number | null;
  capacity?: number | null;
  waitlistCount?: number;
  cancelled?: boolean;
  registrationStatus: string | null;
  course: { id: string; title: string; slug: string } | null;
};

/** "12 of 20 seats left", "3 seats left", "Full · 2 waiting", "No seat limit". */
export function seatsText(s: Pick<SessionLike, 'spotsLeft' | 'capacity' | 'waitlistCount'>) {
  if (s.spotsLeft == null) return { text: 'No seat limit', tone: 'text-muted-foreground' };
  if (s.spotsLeft === 0)
    return {
      text: s.waitlistCount ? `Full · ${s.waitlistCount} waiting` : 'Full · waitlist open',
      tone: 'font-medium text-tone-warning',
    };
  const text = s.capacity ? `${s.spotsLeft} of ${plural(s.capacity, 'seat')} left` : `${plural(s.spotsLeft, 'seat')} left`;
  return {
    text,
    tone: s.spotsLeft <= 3 ? 'font-medium text-tone-warning' : 'text-muted-foreground',
  };
}

/** Phones: the button and its caption side by side under the text. From md: a column. */
const stackClass = 'flex flex-wrap items-center gap-x-3 gap-y-1.5 md:flex-col md:flex-nowrap md:items-stretch';

const quietAction = 'rounded px-0.5 font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-60';

/**
 * `variant` sets the register button's weight when a seat is open (a full
 * session's "Join waitlist" is always secondary) — pass 'secondary' where
 * another primary action already sits nearby.
 */
export function SessionActions({ s, enrolled, canEnroll, size = 'sm', layout = 'inline', variant = 'primary' }: { s: SessionLike; enrolled: boolean; canEnroll: boolean; size?: 'sm' | 'md'; layout?: 'inline' | 'stacked'; variant?: 'primary' | 'secondary' }) {
  const { register, cancel } = useSessionRegistration();
  const enroll = useEnrollSelf();
  const busy = register.isPending || cancel.isPending || enroll.isPending;
  const past = Date.parse(s.endsAt ?? s.startsAt ?? '') < Date.now();
  const stacked = layout === 'stacked';

  if (s.cancelled) return stacked ? <p className="text-sm text-muted-foreground md:text-center">No longer taking place</p> : <StatusPill tone="neutral">Cancelled</StatusPill>;
  if (past) return null;

  const doRegister = async () => {
    try {
      if (!enrolled && s.course) {
        await enroll.mutateAsync({ courseId: s.course.id });
      }
      const res = await register.mutateAsync(s.id);
      if (res.registration.status === 'Waitlisted') toast.success(`You're on the waitlist for ${s.title}. We'll let you know if a seat opens up.`);
      else
        toast.success(enrolled || !s.course ? `You're registered for ${s.title}.` : `You're enrolled in ${s.course.title} and registered for ${s.title}.`, {
          action: s.startsAt ? { label: 'Add to calendar', onClick: () => calendar() } : undefined,
        });
    } catch (e) {
      toast.error(errorMessage(e, "You couldn't be registered. Try again in a moment."));
    }
  };

  const doCancel = () =>
    cancel.mutate(s.id, {
      onSuccess: res => toast.success(s.registrationStatus === 'Waitlisted' ? 'You left the waitlist.' : res.promotedSomeone ? 'Your seat is released and went to the next person on the waitlist.' : 'Your seat is released. Thanks for letting us know.'),
      onError: e => toast.error(errorMessage(e, "Your registration couldn't be cancelled. Try again.")),
    });

  const calendar = () =>
    downloadIcs({
      id: s.id,
      title: s.title,
      description: s.description,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      location: s.location,
      meetingUrl: s.meetingUrl,
      courseTitle: s.course?.title,
      link: s.course ? appUrl(`/courses/${s.course.slug}`) : undefined,
    });

  const joinClass = cn(
    'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
    size === 'md' ? 'h-10' : 'h-9',
  );

  if (s.registrationStatus === 'Registered') {
    if (stacked) {
      return (
        <div className={stackClass}>
          {s.meetingUrl ? (
            <a href={s.meetingUrl} target="_blank" rel="noreferrer" className={joinClass} aria-label={`Join ${s.title} (opens the call)`}>
              Join the call <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          ) : (
            <Button variant="secondary" size={size} onClick={calendar}>
              <CalendarPlus /> Add to calendar
            </Button>
          )}
          <p className="flex flex-wrap items-center gap-x-2 text-sm md:justify-center">
            {s.meetingUrl && (
              <>
                <button type="button" className={quietAction} onClick={calendar}>
                  Add to calendar
                </button>
                <span aria-hidden className="text-faint">
                  ·
                </span>
              </>
            )}
            <button type="button" className={quietAction} onClick={doCancel} disabled={busy} aria-label={`Cancel your registration for ${s.title}`}>
              {cancel.isPending ? 'Cancelling…' : s.meetingUrl ? 'Cancel' : 'Cancel registration'}
            </button>
          </p>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        {s.meetingUrl && (
          <a href={s.meetingUrl} target="_blank" rel="noreferrer" className={joinClass}>
            Join <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        )}
        <Button variant="secondary" size={size} onClick={calendar}>
          <CalendarPlus /> Add to calendar
        </Button>
        <Button variant="ghost" size={size} onClick={doCancel} loading={cancel.isPending} disabled={busy} aria-label={`Cancel your registration for ${s.title}`}>
          Cancel
        </Button>
      </div>
    );
  }

  if (s.registrationStatus === 'Waitlisted') {
    if (stacked) {
      return (
        <div className={stackClass}>
          <Button variant="secondary" size={size} onClick={doCancel} loading={cancel.isPending} disabled={busy} aria-label={`Leave the waitlist for ${s.title}`}>
            Leave waitlist
          </Button>
          <p className="text-sm text-muted-foreground md:text-center">We'll tell you if a seat opens</p>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="warning">On the waitlist</StatusPill>
        <Button variant="ghost" size={size} onClick={doCancel} loading={cancel.isPending} disabled={busy}>
          Leave waitlist
        </Button>
      </div>
    );
  }

  if (!enrolled && s.course && !canEnroll) {
    return <span className={cn('text-sm text-muted-foreground', stacked && 'block md:text-center')}>For people enrolled in {s.course.title}</span>;
  }
  const full = s.spotsLeft === 0;
  const enrolling = !enrolled && Boolean(s.course);
  const label = full ? 'Join waitlist' : 'Register';

  if (stacked) {
    const seats = seatsText(s);
    return (
      <div className={stackClass}>
        <Button variant={full ? 'secondary' : variant} size={size} onClick={doRegister} loading={busy} aria-label={enrolling ? `Enroll in ${s.course!.title} and ${label.toLowerCase()} for ${s.title}` : `${label} for ${s.title}`}>
          {label}
        </Button>
        <p className={cn('text-sm md:text-center', seats.tone)}>{seats.text}</p>
      </div>
    );
  }
  return (
    <Button variant={full ? 'secondary' : variant} size={size} onClick={doRegister} loading={busy} aria-label={`${label} for ${s.title}`}>
      {enrolling ? (full ? 'Enroll and join waitlist' : 'Enroll and register') : label}
    </Button>
  );
}
