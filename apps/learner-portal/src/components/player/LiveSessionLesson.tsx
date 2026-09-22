import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, MapPin, PlayCircle, Video } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { cancelRegistration, registerSession } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Markdown } from '@project/shared/ui/Markdown';
import { errorMessage } from '../../lib/errors';
import { appUrl } from '../../lib/format';
import { DateBlock } from '../cards';
import { Button, StatusPill, type Tone } from '../ui';
import { ConfirmDialog, downloadIcs, sessionTimes } from './bits';
import type { LessonControls } from './LessonView';
import { playerKeys, type SessionItem } from './queries';

/**
 * A live session lesson: pick a date, save a seat (or join the waitlist),
 * add it to your calendar, and join from here when it starts. Attendance —
 * recorded by the instructor — is what completes the lesson.
 */
export function LiveSessionLesson({ controls }: { controls: LessonControls }) {
  const { data, slug } = controls;
  const live = data.live!;
  const upcoming = live.sessions.filter(s => s.phase !== 'ended');
  const past = live.sessions.filter(s => s.phase === 'ended');
  const attended = live.sessions.some(s => s.myRegistration?.status === 'Attended');
  const completed = data.state === 'completed';
  const registered = upcoming.some(s => !s.cancelled && s.myRegistration?.status === 'Registered');

  let note: string;
  if (attended) note = 'You attended a session, so this lesson is complete.';
  else if (completed) note = 'This lesson is complete.';
  else if (live.canSelfComplete) note = 'No sessions are scheduled for this lesson. If you’ve already attended one, or your instructor told you to skip ahead, mark it complete below.';
  else if (registered) note = 'You’re registered. Your instructor records attendance afterwards, and that completes this lesson.';
  else note = 'Register for a session below. Your instructor records attendance afterwards, and that completes this lesson.';

  return (
    <div className="space-y-8">
      {data.lesson.body.trim() && <Markdown className="prose-lms max-w-[68ch] sm:text-[17px]">{data.lesson.body}</Markdown>}

      <p className={cn('max-w-[68ch] text-[15px]', completed || attended ? 'text-foreground/85' : 'text-muted-foreground')}>{note}</p>

      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-sessions">
          <h2 id="upcoming-sessions" className="mb-2 text-sm font-medium text-muted-foreground">
            Upcoming
          </h2>
          <ul className="space-y-3">
            {upcoming.map(s => (
              <li key={s.id}>
                <SessionCard session={s} slug={slug} lessonId={data.lesson.id} lessonTitle={data.lesson.title} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {!live.canSelfComplete && upcoming.length === 0 && !completed && (
        <div className="rounded-2xl border border-dashed px-5 py-8 text-center">
          <p className="font-medium">No upcoming dates yet</p>
          <p className="mt-1 text-sm text-muted-foreground">New sessions appear here as soon as they’re scheduled.</p>
        </div>
      )}
      {past.length > 0 && (
        <section aria-labelledby="past-sessions">
          <h2 id="past-sessions" className="mb-2 text-sm font-medium text-muted-foreground">
            Past sessions
          </h2>
          <ul className="space-y-3">
            {past.map(s => (
              <li key={s.id}>
                <SessionCard session={s} slug={slug} lessonId={data.lesson.id} lessonTitle={data.lesson.title} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const MY_STATUS: Record<string, { label: string; tone: Tone }> = {
  Registered: { label: 'You’re registered', tone: 'success' },
  Waitlisted: { label: 'On the waitlist', tone: 'warning' },
  Attended: { label: 'Attended', tone: 'success' },
  Absent: { label: 'Marked absent', tone: 'neutral' },
};

function SessionCard({ session: s, slug, lessonId, lessonTitle }: { session: SessionItem; slug: string; lessonId: string; lessonTitle: string }) {
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const t = sessionTimes(s.startsAt, s.endsAt, s.timezone);
  const mine = s.myRegistration && s.myRegistration.status !== 'Cancelled' ? s.myRegistration : null;
  const seatsLeft = s.capacity != null ? Math.max(0, s.capacity - s.registeredCount) : null;
  const full = seatsLeft === 0;
  const ended = s.phase === 'ended';
  const live = s.phase === 'live' && !s.cancelled;
  // One status per card: cancelled beats everything, then where the learner stands.
  const mineMeta = mine ? MY_STATUS[mine.status] : undefined;
  const pill = s.cancelled
    ? { label: 'Cancelled', tone: 'neutral' as Tone }
    : mine && mineMeta
      ? { tone: mineMeta.tone, label: `${mineMeta.label}${mine.status === 'Waitlisted' && mine.waitlistPosition ? ` · #${mine.waitlistPosition}` : ''}` }
      : null;
  // Sessions usually share the lesson's name; only a different one is worth repeating.
  const ownTitle = s.title.trim() && s.title.trim().toLowerCase() !== lessonTitle.trim().toLowerCase() ? s.title : null;
  const link = appUrl(`/learn/${slug}/${lessonId}`);
  const seats = seatsLeft == null ? null : full ? `Full${s.waitlistCount ? ` · ${s.waitlistCount} waiting` : ' · waitlist open'}` : `${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left`;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: playerKeys.lesson(slug, lessonId) });
    for (const root of ['sessions', 'me', 'home']) void qc.invalidateQueries({ queryKey: [root] });
  };

  const register = useMutation({
    mutationFn: () => registerSession({ sessionId: s.id }),
    onSuccess: res => {
      toast.success(res.registration.status === 'Waitlisted' ? 'You’re on the waitlist. We’ll let you know if a seat opens up.' : `You’re registered for ${t.dateLabel}.`, {
        action: res.registration.status === 'Registered' && s.startsAt ? { label: 'Add to calendar', onClick: () => downloadIcs(s, link) } : undefined,
      });
      refresh();
    },
    onError: e => {
      toast.error(errorMessage(e, "Couldn't register you. Try again."));
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () => cancelRegistration({ sessionId: s.id }),
    onSuccess: res => {
      setConfirmCancel(false);
      toast.success(mine?.status === 'Waitlisted' ? 'You’ve left the waitlist.' : res.promotedSomeone ? 'Registration cancelled. Your seat went to the next person on the waitlist.' : 'Registration cancelled.');
      refresh();
    },
    onError: e => {
      setConfirmCancel(false);
      toast.error(errorMessage(e, "Couldn't cancel. Try again."));
      refresh();
    },
  });

  return (
    <article className={cn('flex gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5', live && mine?.status === 'Registered' && 'border-primary/40')}>
      {s.startsAt ? <DateBlock iso={s.startsAt} className={cn('self-start', ended || s.cancelled ? 'opacity-60' : '')} /> : null}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0">
            <h3 className={cn('text-[16px] font-semibold leading-snug', s.cancelled && 'text-muted-foreground')}>{t.dateLabel || 'Date to be confirmed'}</h3>
            <p className="text-[15px] text-foreground/85">
              {t.local}
              {live && <span className="ml-2 font-medium text-tone-danger">Live now</span>}
            </p>
          </div>
          {pill && <StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
        </div>
        {t.original && <p className="text-sm text-muted-foreground">{t.original}</p>}
        {ownTitle && <p className="mt-1.5 text-[15px] font-medium">{ownTitle}</p>}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {(s.location || s.online) && (
            <span className="inline-flex items-center gap-1.5">
              {s.online ? <Video className="h-3.5 w-3.5" aria-hidden /> : <MapPin className="h-3.5 w-3.5" aria-hidden />}
              {s.location || 'Online'}
            </span>
          )}
          {!ended && !s.cancelled && seats && (
            <>
              {(s.location || s.online) && (
                <span aria-hidden className="text-faint">
                  ·
                </span>
              )}
              <span className={cn(!mine && (full || (seatsLeft != null && seatsLeft <= 3)) ? 'font-medium text-tone-warning' : '')}>{seats}</span>
            </>
          )}
          {s.instructorName && (
            <>
              <span aria-hidden className="text-faint">
                ·
              </span>
              <span>with {s.instructorName}</span>
            </>
          )}
        </p>
        {s.description && !ended && !s.cancelled && <p className="mt-2 line-clamp-3 max-w-[60ch] text-sm text-foreground/80">{s.description}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2 empty:hidden">
          {s.cancelled ? (
            <p className="text-sm text-muted-foreground">This date was cancelled{mine ? '. Pick another date, or watch for a new one.' : '.'}</p>
          ) : ended ? (
            s.recordingUrl ? (
              <a href={s.recordingUrl} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center gap-2 rounded-lg border bg-background px-4 text-[15px] font-medium hover:bg-accent">
                <PlayCircle className="h-4 w-4" aria-hidden /> Watch the recording
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">{mine?.status === 'Attended' ? 'Thanks for coming.' : 'This session has ended.'}</p>
            )
          ) : (
            <>
              {s.meetingUrl && (
                <a href={s.meetingUrl} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-[15px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                  <Video className="h-4 w-4" aria-hidden /> Join session
                </a>
              )}
              {!mine && (
                <Button onClick={() => register.mutate()} loading={register.isPending} variant={full ? 'secondary' : 'primary'}>
                  {full ? 'Join the waitlist' : 'Register'}
                </Button>
              )}
              {mine?.status === 'Registered' && s.startsAt && (
                <Button variant="secondary" onClick={() => downloadIcs(s, link)}>
                  <CalendarPlus aria-hidden /> Add to calendar
                </Button>
              )}
              {mine && (mine.status === 'Registered' || mine.status === 'Waitlisted') && (
                <Button variant="ghost" onClick={() => setConfirmCancel(true)} className="text-muted-foreground">
                  {mine.status === 'Waitlisted' ? 'Leave waitlist' : 'Cancel registration'}
                </Button>
              )}
              {mine?.status === 'Registered' && !s.meetingUrl && s.online && <p className="basis-full text-xs text-muted-foreground">The join link appears here an hour before it starts.</p>}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={mine?.status === 'Waitlisted' ? 'Leave the waitlist?' : 'Cancel your registration?'}
        description={mine?.status === 'Waitlisted' ? 'You’ll lose your place in line.' : `Your seat goes to the next person on the waitlist${full ? '' : ', if there is one'}. You can register again while seats are available.`}
        confirmLabel={mine?.status === 'Waitlisted' ? 'Leave waitlist' : 'Cancel registration'}
        cancelLabel={mine?.status === 'Waitlisted' ? 'Stay on the waitlist' : 'Keep my seat'}
        tone="danger"
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </article>
  );
}
