import { BookOpen, CalendarClock, CalendarPlus, Check, Clock3, Copy, ExternalLink, Link2, MapPin, MoreHorizontal, Pencil, Trash2, UserRound, Users, Video, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { Markdown } from '@project/shared/ui/Markdown';
import { PersonAvatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, Tip } from '../components/primitives/bits';
import { CourseGlyph, LessonTypeIcon } from '../components/primitives/icons';
import { PhaseBadge } from '../components/sessions/bits';
import { seatsTaken, useSession, useSessionActions, type SessionDetail } from '../components/sessions/data';
import { Registrations } from '../components/sessions/Registrations';
import { SessionDialog } from '../components/sessions/SessionDialog';
import { countdown, differsFromViewer, durationLabel, sessionPhase, timeRange, utcToZoned, viewerTimeZone, zoneAbbr, zoneCity } from '../components/sessions/time';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { appUrl } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useWorkspace } from '../lib/workspace';

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-[14px]">{children}</div>
      </div>
    </div>
  );
}

const shortDay = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
/** "Thu, Sep 24" — short enough that the day and time range fit on one line of the summary card. */
const longDay = (iso: string, timeZone?: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', timeZone }).format(new Date(iso));

/** Ticks once a minute so "Starts in 12m" and "Live now" stay true while the page is open. */
function useNow(ms = 60_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick(n => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

/**
 * One live session: when and where, what it's for, and everyone registered —
 * with attendance taking once it starts.
 */
export function SessionPage() {
  const { sessionId } = useParams();
  const { data, isPending, isError, error, refetch } = useSession(sessionId);
  useDocumentTitle(data?.session.title ?? 'Live session');
  useNow();

  if (isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader icon={<CalendarClock />} breadcrumb={{ to: '/sessions', label: 'Live sessions' }} title={<span className="skeleton inline-block h-3.5 w-40 align-middle" />} />
        <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-3 rounded-xl border p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-4" style={{ width: `${50 + ((i * 17) % 40)}%` }} />
            ))}
          </div>
          <div className="space-y-2 rounded-xl border p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-9" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (isError || !data) {
    const missing = /not found|no longer exists/i.test(String((error as Error)?.message ?? ''));
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader icon={<CalendarClock />} breadcrumb={{ to: '/sessions', label: 'Live sessions' }} title="Session" />
        <EmptyState
          icon={<CalendarClock />}
          title={missing ? 'This session no longer exists' : "Couldn't load this session"}
          description={missing ? 'It may have been deleted.' : 'Check your connection and try again.'}
          action={missing ? <Link to="/sessions" className="text-[14px] text-primary hover:underline">Back to live sessions</Link> : <button type="button" onClick={() => refetch()} className="text-[14px] text-primary hover:underline">Retry</button>}
        />
      </div>
    );
  }
  return <SessionView data={data} />;
}

function SessionView({ data }: { data: SessionDetail }) {
  const { session: s, canManage } = data;
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const { save } = useSessionActions();
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const phase = sessionPhase(s);
  const course = s.courseId ? ws.courseById.get(s.courseId) : undefined;
  const hasAttendance = data.registrations.some(r => r.status === 'Attended' || r.status === 'Absent');
  const active = data.registrations.filter(r => r.status === 'Registered' || r.status === 'Waitlisted').length;
  const taken = seatsTaken(s.counts);

  useEffect(() => {
    app.setContextCourse(s.courseId);
    return () => app.setContextCourse(null);
  }, [s.courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async () => {
    const ok = await app.confirm({
      title: `Delete “${s.title}”?`,
      description: active ? `${active} ${active === 1 ? 'person is' : 'people are'} registered and won't be told. To let them know, cancel the session instead.` : 'The session and its registrations are removed. This can’t be undone.',
      confirmLabel: 'Delete session',
      destructive: true,
    });
    if (!ok) return;
    await save({ action: 'delete', id: s.id }, { success: 'Session deleted' }).then(() => navigate('/sessions')).catch(() => undefined);
  };

  useHotkeys({ e: () => canManage && setEditOpen(true) }, { enabled: canManage });

  const startIso = s.startsAt;
  const viewerDiffers = startIso ? differsFromViewer(startIso, s.timezone) : false;
  // When the session's date in its own zone isn't the viewer's date, say which day it is for them.
  const otherDay = Boolean(startIso && viewerDiffers && utcToZoned(startIso, s.timezone).day !== utcToZoned(startIso, viewerTimeZone()).day);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<CalendarClock />}
        breadcrumb={{ to: '/sessions', label: 'Live sessions' }}
        title={s.title}
        actions={
          <>
            <PhaseBadge session={s} className="mr-1 hidden sm:inline-flex" />
            {s.meetingUrl && phase !== 'cancelled' && (
              <Tip label="Copy meeting link">
                <button type="button" onClick={() => copyText(s.meetingUrl!, 'Meeting link copied')} className="hidden h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent sm:inline-flex">
                  <Copy className="h-3.5 w-3.5" /> Meeting link
                </button>
              </Tip>
            )}
            {canManage && s.status === 'Cancelled' && (
              <button type="button" onClick={() => setCopyOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                <CalendarPlus className="h-3.5 w-3.5" /> Reschedule…
              </button>
            )}
            {canManage && (
              <Tip label="Edit session" keys={['E']}>
                <button type="button" onClick={() => setEditOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
                  <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
                </button>
              </Tip>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="More session actions">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => copyText(appUrl(`/sessions/${s.id}`), 'Link copied')}>
                  <Link2 className="h-3.5 w-3.5" /> Copy link to this page
                </DropdownMenuItem>
                {s.meetingUrl && (
                  <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => copyText(s.meetingUrl!, 'Meeting link copied')}>
                    <Copy className="h-3.5 w-3.5" /> Copy meeting link
                  </DropdownMenuItem>
                )}
                {canManage && (
                  <>
                    <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => setCopyOpen(true)}>
                      <CalendarPlus className="h-3.5 w-3.5" /> {s.status === 'Cancelled' ? 'Reschedule…' : 'Duplicate…'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {s.status !== 'Cancelled' && (
                      <DropdownMenuItem className="gap-2 text-[14px] text-destructive focus:text-destructive" onSelect={() => setCancelOpen(true)}>
                        <XCircle className="h-3.5 w-3.5" /> Cancel session…
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="gap-2 text-[14px] text-destructive focus:text-destructive" disabled={hasAttendance} onSelect={remove}>
                      <Trash2 className="h-3.5 w-3.5" /> {hasAttendance ? 'Delete (attendance recorded)' : 'Delete…'}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1200px] gap-5 px-3 py-4 sm:px-6 sm:py-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-4">
            <section className="overflow-hidden rounded-xl border bg-card">
              <div className={cn('border-b px-4 py-3', phase === 'live' && 'bg-tone-danger/[0.05]', phase === 'cancelled' && 'bg-muted/60')}>
                <div className="flex items-center gap-2">
                  <span className={cn('text-[16px] font-semibold tracking-tight', phase === 'live' && 'text-tone-danger', phase === 'cancelled' && 'text-muted-foreground')}>{countdown(s)}</span>
                  <PhaseBadge session={s} hideUpcoming className="sm:hidden" />
                </div>
                {startIso && (
                  <div className={cn('mt-1 text-[14px]', phase === 'cancelled' && 'text-muted-foreground line-through')}>
                    {longDay(startIso, s.timezone)} · {timeRange(startIso, s.endsAt, s.timezone)} {zoneAbbr(startIso, s.timezone)}
                  </div>
                )}
                {startIso && (
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {[
                      durationLabel(startIso, s.endsAt),
                      viewerDiffers
                        ? `${otherDay ? `${shortDay(startIso)}, ` : ''}${timeRange(startIso, s.endsAt)} in your time zone (${zoneAbbr(startIso, viewerTimeZone())})`
                        : `${zoneCity(s.timezone)} time, same as yours`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
              </div>
              <div className="divide-y px-4">
                <Detail icon={s.meetingUrl && !s.location ? <Video /> : <MapPin />} label="Where">
                  {s.location ? <div>{s.location}</div> : !s.meetingUrl && <span className="text-muted-foreground">No location set</span>}
                  {s.meetingUrl && (
                    <div className="mt-0.5 flex min-w-0 items-center gap-1">
                      <a href={s.meetingUrl} target="_blank" rel="noreferrer noopener" className="truncate text-primary hover:underline">
                        {s.meetingUrl.replace(/^https:\/\//, '')}
                      </a>
                      <IconButton size="sm" aria-label="Copy meeting link" onClick={() => copyText(s.meetingUrl!, 'Meeting link copied')}>
                        <Copy />
                      </IconButton>
                    </div>
                  )}
                </Detail>
                <Detail icon={<BookOpen />} label="Course">
                  {s.courseId ? (
                    <div className="space-y-1">
                      <Link to={`/courses/${s.courseId}`} className="flex min-w-0 items-center gap-2 hover:underline">
                        <CourseGlyph icon={course?.icon ?? s.courseIcon} color={course?.color ?? s.courseColor} size={16} />
                        <span className="truncate">{s.courseTitle ?? course?.title ?? 'Course'}</span>
                      </Link>
                      {s.lessonId ? (
                        <Link to={`/courses/${s.courseId}/content/${s.lessonId}`} className="flex min-w-0 items-center gap-2 text-muted-foreground hover:text-foreground hover:underline">
                          <LessonTypeIcon type="Live session" />
                          <span className="truncate">{s.lessonTitle}</span>
                        </Link>
                      ) : (
                        <div className="text-sm text-muted-foreground">Not linked to a lesson — attendance completes nothing.</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Standalone session</span>
                  )}
                </Detail>
                <Detail icon={<UserRound />} label="Instructor">
                  {s.instructorName ? (
                    <Link to={`/people/${s.instructorId}`} className="inline-flex items-center gap-2 hover:underline">
                      <PersonAvatar person={{ name: s.instructorName, color: s.instructorColor, avatarUrl: s.instructorAvatarUrl }} size={18} />
                      {s.instructorName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No instructor</span>
                  )}
                </Detail>
                <Detail icon={<Users />} label="Capacity">
                  {s.capacity ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between tabular-nums">
                        <span>
                          {taken} of {s.capacity} seats taken
                        </span>
                        <span className={cn('text-sm', taken >= s.capacity ? 'text-tone-warning' : 'text-muted-foreground')}>{taken >= s.capacity ? 'Full' : `${s.capacity - taken} left`}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={cn('h-full rounded-full', taken >= s.capacity ? 'bg-tone-warning' : 'bg-primary')} style={{ width: `${Math.min(100, (taken / s.capacity) * 100)}%` }} />
                      </div>
                    </div>
                  ) : (
                    <span className="tabular-nums">{taken} registered · no seat limit</span>
                  )}
                  {s.counts.waitlisted > 0 && <div className="mt-1 text-sm text-tone-warning">{s.counts.waitlisted} on the waitlist</div>}
                </Detail>
                {(phase === 'ended' || s.recordingUrl) && <RecordingField data={data} />}
              </div>
            </section>

            {s.description.trim() && (
              <section className="rounded-xl border bg-card px-4 py-3">
                <div className="mb-1 text-2xs font-medium text-muted-foreground">About this session</div>
                <Markdown className="text-[14px]">{s.description}</Markdown>
              </section>
            )}
          </aside>

          <Registrations key={s.id} data={data} />
        </div>
      </div>

      {editOpen && <SessionDialog open onOpenChange={o => !o && setEditOpen(false)} session={s} />}
      {copyOpen && <SessionDialog open onOpenChange={o => !o && setCopyOpen(false)} template={s} rescheduleOf={s.status === 'Cancelled' ? { id: s.id, count: data.rescheduleCount } : undefined} />}
      <CancelSessionDialog open={cancelOpen} onOpenChange={setCancelOpen} data={data} />
    </div>
  );
}

function RecordingField({ data }: { data: SessionDetail }) {
  const { session: s, canManage } = data;
  const { save } = useSessionActions();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(s.recordingUrl ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(s.recordingUrl ?? ''), [s.recordingUrl]);
  const invalid = value.trim() !== '' && !/^https:\/\/\S+$/i.test(value.trim());

  const commit = async () => {
    if (invalid || busy) return;
    if ((value.trim() || null) === s.recordingUrl) return setEditing(false);
    setBusy(true);
    try {
      await save({ action: 'update', id: s.id, patch: { recordingUrl: value.trim() || null } }, { success: value.trim() ? 'Recording link saved' : 'Recording link removed' });
      setEditing(false);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Detail icon={<ExternalLink />} label="Recording">
      {editing || (!s.recordingUrl && canManage) ? (
        <form
          className="space-y-1"
          onSubmit={e => {
            e.preventDefault();
            commit();
          }}
        >
          <div className="flex items-center gap-1.5">
            <input
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (setValue(s.recordingUrl ?? ''), setEditing(false))}
              placeholder="https://…"
              aria-label="Recording link"
              inputMode="url"
              className={cn('h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-[14px] shadow-2xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring', invalid && 'border-tone-danger')}
            />
            <button type="submit" disabled={invalid || busy || (value.trim() || null) === s.recordingUrl} className="inline-flex h-9 items-center gap-1 rounded-md border bg-background px-2 text-[13.5px] shadow-2xs hover:bg-accent disabled:opacity-50">
              <Check className="h-3.5 w-3.5" /> Save
            </button>
          </div>
          <p className={cn('text-sm', invalid ? 'text-tone-danger' : 'text-muted-foreground')}>{invalid ? 'Use a full https:// link' : 'Registrants can watch it from the academy.'}</p>
        </form>
      ) : s.recordingUrl ? (
        <div className="flex min-w-0 items-center gap-1">
          <a href={s.recordingUrl} target="_blank" rel="noreferrer noopener" className="truncate text-primary hover:underline">
            {s.recordingUrl.replace(/^https:\/\//, '')}
          </a>
          {canManage && (
            <IconButton size="sm" aria-label="Edit recording link" onClick={() => setEditing(true)}>
              <Pencil />
            </IconButton>
          )}
        </div>
      ) : (
        <span className="text-muted-foreground">No recording</span>
      )}
    </Detail>
  );
}

function CancelSessionDialog({ open, onOpenChange, data }: { open: boolean; onOpenChange: (o: boolean) => void; data: SessionDetail }) {
  const { session: s } = data;
  const { save } = useSessionActions();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const affected = data.registrations.filter(r => r.status === 'Registered' || r.status === 'Waitlisted').length;
  useEffect(() => {
    if (open) {
      setMessage('');
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      await save({ action: 'cancel', id: s.id, message: message.trim() || undefined }, { success: 'Session cancelled' });
      onOpenChange(false);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0 sm:rounded-xl">
        <DialogHeader className="px-5 pb-2 pt-4 text-left">
          <DialogTitle className="text-[16px]">Cancel “{s.title}”?</DialogTitle>
          <DialogDescription className="text-[14px]">
            {affected ? `${affected} registered or waitlisted ${affected === 1 ? 'person is' : 'people are'} told in the academy and by email, and their registrations are cancelled.` : 'Nobody is registered, so nobody needs to be told.'} The session stays on record under Cancelled.
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 pb-4 pt-2">
          {affected > 0 && (
            <>
              <label htmlFor="cancel-note" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Clock3 className="h-3 w-3" /> Note for registrants (optional)
              </label>
              <textarea
                id="cancel-note"
                autoFocus
                value={message}
                onChange={e => setMessage(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="e.g. Our trainer is out sick — we'll share a new date next week."
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-[14px] shadow-2xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
              />
            </>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
              Keep session
            </button>
            <button type="button" disabled={busy} onClick={submit} className="h-9 rounded-md bg-destructive px-3 text-[14px] font-medium text-destructive-foreground shadow-xs hover:bg-destructive/90 disabled:opacity-50">
              {busy ? 'Cancelling…' : affected ? `Cancel and notify ${affected}` : 'Cancel session'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
