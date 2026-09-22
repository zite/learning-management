import { differenceInCalendarDays, differenceInMinutes, format, isToday, isTomorrow, parseISO } from 'date-fns';
import { CalendarDays, CalendarX2, Check, MapPin, PlayCircle, UserRound, Video } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { formatMinutes } from '@project/shared/lessons';
import { DateBlock } from '../components/cards';
import { Chip, LoadError, PageHeader, Tabs } from '../components/kit';
import { SessionActions } from '../components/sessions';
import { Card, Container, EmptyState, Skeleton, StatusPill } from '../components/ui';
import { useSessions, type LearnerSession } from '../lib/learn';
import { localZone, sessionWhen } from '../lib/learnFormat';
import { useMe } from '../lib/queries';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Tab = 'upcoming' | 'past';

export function SessionsPage() {
  const q = useSessions();
  const me = useMe();
  useDocumentTitle('Live sessions');
  const [tab, setTab] = useState<Tab>('upcoming');
  const [mineOnly, setMineOnly] = useState(false);
  const zone = localZone();

  const upcoming = q.data?.upcoming ?? [];
  const mine = upcoming.filter(s => s.registrationStatus);
  const shown = mineOnly && mine.length ? mine : upcoming;
  // Cancelling your last registration while filtered drops the filter rather than leaving it armed.
  useEffect(() => {
    if (q.data && !mine.length) setMineOnly(false);
  }, [q.data, mine.length]);

  return (
    <div>
      <PageHeader title="Live sessions" description={`Instructor-led sessions for your courses, in person and online. Times are in your time zone${zone ? ` (${zone})` : ''}.`}>
        {q.data && (
          <Tabs
            className="mt-6 border-b-0"
            label="Sessions"
            value={tab}
            onChange={setTab}
            tabs={[
              {
                value: 'upcoming',
                label: 'Upcoming',
                count: upcoming.length || undefined,
              },
              {
                value: 'past',
                label: 'Past',
                count: q.data.past.length || undefined,
              },
            ]}
          />
        )}
      </PageHeader>
      <Container className="py-8 sm:py-10">
        {q.isPending ? (
          <div aria-hidden>
            <Skeleton className="h-6 w-56" />
            <ul className="mt-3 divide-y border-t">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 py-5 md:grid-cols-[72px_minmax(0,1fr)_184px] md:gap-x-6">
                  <Skeleton className="h-9 w-12" />
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-2/3 max-w-sm" />
                    <Skeleton className="h-4 w-1/2 max-w-xs" />
                  </div>
                  <Skeleton className="hidden h-9 md:block" />
                </li>
              ))}
            </ul>
          </div>
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} title="Sessions didn't load" />
        ) : tab === 'upcoming' ? (
          upcoming.length === 0 ? (
            <Card>
              <EmptyState icon={CalendarDays} title="No sessions coming up">
                When an instructor schedules a live session for one of your courses, it will appear here for you to register.
              </EmptyState>
            </Card>
          ) : (
            <>
              {mine.length > 0 && (
                <div role="group" aria-label="Filter sessions" className="mb-8 flex gap-2">
                  <Chip active={!mineOnly} onClick={() => setMineOnly(false)}>
                    All upcoming
                  </Chip>
                  <Chip active={mineOnly} onClick={() => setMineOnly(true)}>
                    Registered <span className={cn('tabular-nums', mineOnly ? 'text-background/70' : 'text-faint')}>{mine.length}</span>
                  </Chip>
                </div>
              )}
              <Grouped sessions={shown} canEnroll={Boolean(me.data?.features.selfEnrollment)} />
            </>
          )
        ) : q.data.past.length === 0 ? (
          <Card>
            <EmptyState icon={CalendarX2} title="No past sessions yet">
              Sessions you register for move here once they’ve happened, with your attendance and any recording.
            </EmptyState>
          </Card>
        ) : (
          <ul className="divide-y border-y" aria-label="Past sessions">
            {q.data.past.map(s => (
              <PastRow key={s.id} s={s} />
            ))}
          </ul>
        )}
      </Container>
    </div>
  );
}

function dayLabel(iso: string | null) {
  if (!iso) return { day: 'Date to be confirmed', hint: '' };
  const d = parseISO(iso);
  const days = differenceInCalendarDays(d, new Date());
  return {
    day: format(d, 'EEEE, MMMM d'),
    hint: isToday(d) ? 'Today' : isTomorrow(d) ? 'Tomorrow' : days < 14 ? `In ${days} days` : '',
  };
}

function Grouped({ sessions, canEnroll }: { sessions: LearnerSession[]; canEnroll: boolean }) {
  const groups = new Map<string, LearnerSession[]>();
  for (const s of sessions) {
    const key = s.startsAt ? format(parseISO(s.startsAt), 'yyyy-MM-dd') : 'tbc';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return (
    <div className="space-y-10" aria-live="polite">
      {[...groups.entries()].map(([key, list]) => {
        const label = dayLabel(list[0].startsAt);
        return (
          <section key={key} aria-labelledby={`day-${key}`}>
            <h2 id={`day-${key}`} className="flex items-baseline gap-2 border-b pb-2.5 font-serif text-lg font-semibold">
              {label.day}
              {label.hint && <span className="font-sans text-sm font-normal text-faint">{label.hint}</span>}
            </h2>
            <ul className="divide-y">
              {list.map(s => (
                <SessionRow key={s.id} s={s} canEnroll={canEnroll} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const isOnline = (s: Pick<LearnerSession, 'location' | 'meetingUrl'>) => /zoom|meet|teams|webex|online/i.test(s.location) || (!s.location && Boolean(s.meetingUrl));

/** The session's start in the zone it's held in, when that differs from the viewer's — "3:00 PM CDT". */
function venueTime(iso: string | null, timeZone: string) {
  if (!iso || !timeZone) return null;
  try {
    const d = new Date(iso);
    const clock = (tz?: string) =>
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: tz,
      }).format(d);
    if (clock(timeZone) === clock()) return null;
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(d);
  } catch {
    return null;
  }
}

function Meta({ children }: { children: Array<ReactNode | false | null> }) {
  const parts = children.filter(Boolean);
  return (
    // Each part carries its separator in front; the list is pulled left by exactly that much and clipped,
    // so a part that wraps to the start of a line never begins with a stray "·".
    <p className="mt-0.5 overflow-hidden text-sm text-muted-foreground">
      <span className="-ml-[22px] flex flex-wrap items-center gap-y-0.5">
        {parts.map((p, i) => (
          <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="w-4 shrink-0 text-center">
              ·
            </span>
            {p}
          </span>
        ))}
      </span>
    </p>
  );
}

/**
 * An upcoming session. One grid for every row: the start time, what it is and
 * where, and a fixed-width action column — the button, with seats or the
 * secondary actions under it — so the right edge lines up down the page.
 */
function SessionRow({ s, canEnroll }: { s: LearnerSession; canEnroll: boolean }) {
  const start = s.startsAt ? parseISO(s.startsAt) : null;
  const minutes = s.startsAt && s.endsAt ? differenceInMinutes(parseISO(s.endsAt), parseISO(s.startsAt)) : 0;
  const online = isOnline(s);
  const venue = online ? null : venueTime(s.startsAt, s.timezone);
  const enrolled = s.enrolled || !s.course;

  return (
    <li className={cn('grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 py-5 md:grid-cols-[72px_minmax(0,1fr)_184px] md:gap-x-6', s.cancelled && 'text-muted-foreground')}>
      <div className="pt-0.5">
        <p className={cn('font-serif text-lg font-semibold leading-none tabular-nums', s.cancelled && 'line-through decoration-foreground/40')}>{start ? format(start, 'h:mm') : '—'}</p>
        <p className="mt-1 text-xs text-muted-foreground">{start ? format(start, 'a') : ''}</p>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="font-serif text-[17px] font-semibold leading-snug">{s.title}</h3>
          {s.cancelled ? (
            <StatusPill tone="neutral">Cancelled</StatusPill>
          ) : s.registrationStatus === 'Registered' ? (
            <StatusPill tone="success">Registered</StatusPill>
          ) : s.registrationStatus === 'Waitlisted' ? (
            <StatusPill tone="warning">Waitlisted</StatusPill>
          ) : null}
        </div>
        <Meta>
          {minutes > 0 && <span title={`Until ${format(parseISO(s.endsAt!), 'h:mm a')}`}>{formatMinutes(minutes)}</span>}
          {s.location && (
            <>
              {online ? <Video className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              <span className="truncate">{s.location}</span>
            </>
          )}
          {venue && <span>{venue} local time</span>}
          {s.instructorName && (
            <>
              <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{s.instructorName}</span>
            </>
          )}
        </Meta>
        {s.course && (
          <p className="mt-1 text-sm">
            <Link to={`/courses/${s.course.slug}`} className="rounded font-medium text-foreground/85 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
              {s.course.title}
            </Link>
            {!enrolled && canEnroll && !s.cancelled && <span className="text-muted-foreground"> · registering enrolls you in this course</span>}
          </p>
        )}
        {s.description && !s.cancelled && <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-foreground/75">{s.description}</p>}
        {s.cancelled && <p className="mt-2 text-sm">The instructor cancelled this session. You don’t need to do anything.</p>}
      </div>
      <div className="col-start-2 mt-3 md:col-start-3 md:row-start-1 md:mt-0 md:self-center">
        <SessionActions s={s} enrolled={enrolled} canEnroll={canEnroll} layout="stacked" />
      </div>
    </li>
  );
}

function PastRow({ s }: { s: LearnerSession }) {
  const status =
    s.registrationStatus === 'Attended' ? (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-tone-success">
        <Check className="h-4 w-4" aria-hidden /> Attended
      </span>
    ) : s.registrationStatus === 'Absent' ? (
      <span className="text-sm text-muted-foreground">Missed</span>
    ) : s.registrationStatus === 'Waitlisted' ? (
      <span className="text-sm text-muted-foreground">Didn’t get a seat</span>
    ) : (
      <span className="text-sm text-muted-foreground">Attendance not taken yet</span>
    );
  return (
    <li className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 py-5 md:grid-cols-[56px_minmax(0,1fr)_auto] md:items-center">
      <DateBlock iso={s.startsAt} className="self-start" />
      <div className="min-w-0 self-start">
        <h3 className="font-serif text-[17px] font-semibold leading-snug">{s.title}</h3>
        <Meta>
          <span>{sessionWhen(s.startsAt, s.endsAt)}</span>
          {s.location && <span className="truncate">{s.location}</span>}
        </Meta>
        {s.course && (
          <p className="mt-1 text-sm">
            <Link to={`/courses/${s.course.slug}`} className="rounded font-medium text-foreground/85 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
              {s.course.title}
            </Link>
          </p>
        )}
      </div>
      <div className="col-start-2 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 md:col-start-3 md:mt-0 md:justify-end md:pl-4">
        {status}
        {s.recordingUrl && (
          <a
            href={s.recordingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-3 text-sm font-medium shadow-2xs hover:border-foreground/25 hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          >
            <PlayCircle className="h-4 w-4" aria-hidden /> Watch recording
          </a>
        )}
      </div>
    </li>
  );
}
