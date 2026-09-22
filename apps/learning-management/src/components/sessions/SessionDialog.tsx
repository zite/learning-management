import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, CalendarDays, CalendarPlus, Clock3, Globe2, Link2, MapPin, UserRound, Users, Video } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCourse } from 'zitejs/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { cn } from '@project/components/lib/utils';
import { Markdown } from '@project/shared/ui/Markdown';
import { shortDate, toDayString } from '../../lib/format';
import { MOD } from '../../lib/hotkeys';
import { qk } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { Kbd } from '../primitives/bits';
import { CourseGlyph, LessonTypeIcon } from '../primitives/icons';
import { OptionPicker, type Option } from '../pickers/OptionPicker';
import { CoursePicker, DatePicker, StaffPicker } from '../pickers/pickers';
import { useSessionActions, type SessionDetail } from './data';
import { allTimeZones, differsFromViewer, timeRange, utcToZoned, viewerTimeZone, zoneAbbr, zoneLabel, zonedToUtc } from './time';

const DURATIONS = [30, 45, 60, 90, 120, 180, 240];
const durationText = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60} hour${m === 60 ? '' : 's'}`);

const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-2.5 text-[14px] shadow-2xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring';
const triggerCls = 'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-[14px] shadow-2xs hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50';

function Row({ icon, label, children, hint }: { icon: ReactNode; label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-start sm:gap-3">
      <div className="flex h-9 items-center gap-2 text-[14px] text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
        {icon}
        {label}
      </div>
      <div className="min-w-0">
        {children}
        {hint && <div className="mt-1 text-sm text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

function addMinutesToTime(time: string, minutes: number) {
  const [h, m] = time.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function nextHalfHour() {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

/**
 * Schedule a live session, or edit one. Opened from the shell (⌘K, a course,
 * Home) with an optional course, and from a session's page with the session.
 * Times are entered in the session's own time zone and previewed in yours.
 */
/**
 * Schedule, edit, duplicate or reschedule a session. `template` prefills a new
 * session from an existing one; with `rescheduleOf` (a cancelled session) the
 * people whose seats were cancelled can be registered for the new one.
 */
export function SessionDialog({
  open,
  onOpenChange,
  courseId,
  session,
  template,
  rescheduleOf,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  courseId?: string;
  session?: SessionDetail['session'];
  template?: SessionDetail['session'];
  rescheduleOf?: { id: string; count: number };
}) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { save } = useSessionActions();
  const editing = Boolean(session);

  const [title, setTitle] = useState('');
  const [course, setCourse] = useState<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [day, setDay] = useState<string>(toDayString(nextHalfHour()));
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('11:00');
  const [timezone, setTimezone] = useState(ws.settings.timezone || viewerTimeZone());
  const [location, setLocation] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [recordingUrl, setRecordingUrl] = useState('');
  const [capacity, setCapacity] = useState('');
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [preview, setPreview] = useState(false);
  const [inviteBack, setInviteBack] = useState(true);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setPreview(false);
    setInviteBack(true);
    if (session) {
      const tz = session.timezone || ws.settings.timezone;
      const s = session.startsAt ? utcToZoned(session.startsAt, tz) : { day: toDayString(new Date()), time: '10:00' };
      const e = session.endsAt ? utcToZoned(session.endsAt, tz) : { day: s.day, time: addMinutesToTime(s.time, 60) };
      setTitle(session.title);
      setCourse(session.courseId);
      setLessonId(session.lessonId);
      setDay(s.day);
      setStart(s.time);
      setEnd(e.time);
      setTimezone(tz);
      setLocation(session.location);
      setMeetingUrl(session.meetingUrl ?? '');
      setRecordingUrl(session.recordingUrl ?? '');
      setCapacity(session.capacity == null ? '' : String(session.capacity));
      setInstructorId(session.instructorId);
      setDescription(session.description);
    } else if (template) {
      // Same shape, a new date: the time of day carries over in the session's own zone.
      const tz = template.timezone || ws.settings.timezone || viewerTimeZone();
      const s = template.startsAt ? utcToZoned(template.startsAt, tz) : { day: '', time: '10:00' };
      const e = template.endsAt ? utcToZoned(template.endsAt, tz) : { day: s.day, time: addMinutesToTime(s.time, 60) };
      const weekOn = template.startsAt ? new Date(Math.max(Date.parse(template.startsAt), Date.now()) + 7 * 86_400_000) : nextHalfHour();
      setTitle(template.title);
      setCourse(template.courseId);
      setLessonId(template.lessonId);
      setDay(toDayString(weekOn));
      setStart(s.time);
      setEnd(e.time);
      setTimezone(tz);
      setLocation(template.location);
      setMeetingUrl(template.meetingUrl ?? '');
      setRecordingUrl('');
      setCapacity(template.capacity == null ? '' : String(template.capacity));
      setInstructorId(template.instructorId);
      setDescription(template.description);
    } else {
      const next = nextHalfHour();
      const c = courseId ? ws.courseById.get(courseId) : undefined;
      setTitle('');
      setCourse(c?.id ?? null);
      setLessonId(null);
      setDay(toDayString(next));
      setStart('10:00');
      setEnd('11:00');
      setTimezone(ws.settings.timezone || viewerTimeZone());
      setLocation('');
      setMeetingUrl('');
      setRecordingUrl('');
      setCapacity('');
      setInstructorId(ws.isStaff ? ws.me.id : null);
      setDescription('');
    }
    window.setTimeout(() => titleRef.current?.focus(), 30);
    // Only when the dialog opens: a background refetch of the workspace must not wipe what's being typed.
  }, [open, session?.id, template?.id, courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const courseDetail = useQuery({ queryKey: qk.course(course ?? ''), queryFn: () => getCourse({ id: course! }), enabled: open && Boolean(course), staleTime: 30_000 });
  const liveLessons = useMemo(() => (courseDetail.data?.lessons ?? []).filter(l => l.type === 'Live session'), [courseDetail.data]);
  const selectedCourse = course ? ws.courseById.get(course) : undefined;

  // Picking a course with exactly one live lesson links it, and names an untitled session after it.
  useEffect(() => {
    if (!open || !courseDetail.data || editing) return;
    if (lessonId && !liveLessons.some(l => l.id === lessonId)) setLessonId(null);
    if (!lessonId && liveLessons.length === 1) {
      setLessonId(liveLessons[0].id);
      setTitle(t => t || liveLessons[0].title);
    }
  }, [courseDetail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const duration = useMemo(() => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let mins = eh * 60 + em - (sh * 60 + sm);
    if (mins <= 0) mins += 1440;
    return mins;
  }, [start, end]);

  const startsAt = useMemo(() => (day && start ? zonedToUtc(day, start, timezone) : null), [day, start, timezone]);
  const endsAt = useMemo(() => (startsAt ? new Date(startsAt.getTime() + duration * 60000) : null), [startsAt, duration]);
  const inPast = Boolean(startsAt && startsAt.getTime() < Date.now());
  const viewerDiffers = startsAt ? differsFromViewer(startsAt.toISOString(), timezone) : false;
  const cap = capacity.trim() === '' ? null : Number(capacity);
  const capInvalid = cap != null && (!Number.isInteger(cap) || cap < 1);
  const urlInvalid = (u: string) => u.trim() !== '' && !/^https:\/\/\S+$/i.test(u.trim());
  const canSubmit = title.trim().length > 0 && Boolean(startsAt) && !capInvalid && !urlInvalid(meetingUrl) && !urlInvalid(recordingUrl) && !busy;

  const zoneOptions = useMemo<Option<string>[]>(() => {
    const at = startsAt?.toISOString();
    const zones = allTimeZones();
    const pinned = [...new Set([ws.settings.timezone, viewerTimeZone()].filter(Boolean))];
    return [...pinned, ...zones.filter(z => !pinned.includes(z))].map(z => {
      const l = zoneLabel(z, at);
      return { value: z, label: `${l.city}${l.region ? ` · ${l.region}` : ''}`, hint: l.gmt, keywords: [z, l.gmt, zoneAbbr(at ?? new Date().toISOString(), z)], group: pinned.includes(z) ? 'Suggested' : 'All time zones' };
    });
  }, [startsAt, ws.settings.timezone]);

  const lessonOptions: Option<string | null>[] = [{ value: null, label: 'No linked lesson' }, ...liveLessons.map(l => ({ value: l.id, label: l.title, icon: <LessonTypeIcon type={l.type} /> }))];

  const submit = async () => {
    if (!canSubmit || !startsAt || !endsAt) return;
    setBusy(true);
    const fields = {
      title: title.trim(),
      courseId: course,
      lessonId: course ? lessonId : null,
      description,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      timezone,
      location: location.trim(),
      meetingUrl: meetingUrl.trim() || null,
      recordingUrl: recordingUrl.trim() || null,
      capacity: cap,
      instructorId,
    };
    try {
      if (session) {
        await save({ action: 'update', id: session.id, session: fields }, { success: 'Session updated' });
        onOpenChange(false);
      } else {
        const reschedule = rescheduleOf && rescheduleOf.count > 0 && inviteBack ? rescheduleOf.id : undefined;
        const res = await save({ action: 'create', session: fields, rescheduleOf: reschedule }, { success: rescheduleOf ? 'Session rescheduled' : 'Session scheduled' });
        onOpenChange(false);
        navigate(`/sessions/${res.id}`);
      }
    } catch {
      // The toast already explains what went wrong; keep the form as typed.
      setBusy(false);
    }
  };

  const instructor = instructorId ? ws.staffById.get(instructorId) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92dvh] max-w-[640px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader className="border-b px-5 pb-3.5 pt-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <CalendarPlus className="h-4 w-4 text-muted-foreground" /> {editing ? 'Edit session' : rescheduleOf ? 'Reschedule session' : template ? 'Duplicate session' : 'Schedule a session'}
          </DialogTitle>
          <DialogDescription className="text-[14px]">
            {editing
              ? 'Registrants are told in the app if the time or place changes.'
              : rescheduleOf
                ? 'Pick a new date. The cancelled session stays on record.'
                : template
                  ? 'Everything carries over except the date and registrations.'
                  : 'People register from the academy. Link a live-session lesson and attendance completes it for them.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Session title"
            aria-label="Session title"
            className="h-10 w-full rounded-md bg-transparent text-[18px] font-medium outline-none placeholder:text-muted-foreground/70"
          />

          <Row icon={<BookOpen />} label="Course">
            <CoursePicker
              allowNone
              noneLabel="No course"
              value={course}
              onChange={v => {
                setCourse(v);
                setLessonId(null);
              }}
              trigger={
                <button type="button" className={triggerCls}>
                  {selectedCourse ? <CourseGlyph icon={selectedCourse.icon} color={selectedCourse.color} size={16} /> : <span className="h-4 w-4 rounded-[4px] border border-dashed border-input" />}
                  <span className={cn('min-w-0 flex-1 truncate', !selectedCourse && 'text-muted-foreground')}>{selectedCourse?.title ?? 'No course — a standalone session'}</span>
                  {selectedCourse && selectedCourse.status !== 'Published' && <span className="text-sm text-tone-warning">{selectedCourse.status}</span>}
                </button>
              }
            />
          </Row>

          {course && (
            <Row
              icon={<LessonTypeIcon type="Live session" colored={false} />}
              label="Lesson"
              hint={courseDetail.isPending ? 'Loading lessons…' : liveLessons.length === 0 ? 'This course has no “Live session” lessons. Add one in the course builder to complete it with attendance.' : lessonId ? 'Marking someone attended completes this lesson for them.' : undefined}
            >
              <OptionPicker
                value={lessonId}
                onChange={v => setLessonId(v)}
                options={lessonOptions}
                placeholder="Choose a live-session lesson…"
                width={320}
                disabled={!liveLessons.length}
                trigger={
                  <button type="button" disabled={!liveLessons.length} className={triggerCls}>
                    <span className={cn('min-w-0 flex-1 truncate', !lessonId && 'text-muted-foreground')}>{liveLessons.find(l => l.id === lessonId)?.title ?? 'No linked lesson'}</span>
                  </button>
                }
              />
            </Row>
          )}

          <Row
            icon={<CalendarDays />}
            label="When"
            hint={
              startsAt ? (
                <span className="flex flex-wrap items-center gap-x-2">
                  {viewerDiffers && endsAt && (
                    <span>
                      {toDayString(startsAt) !== day ? `${shortDate(toDayString(startsAt))}, ` : ''}
                      {timeRange(startsAt.toISOString(), endsAt.toISOString())} in your time zone ({zoneAbbr(startsAt.toISOString(), viewerTimeZone())})
                    </span>
                  )}
                  {inPast && (
                    <span className="inline-flex items-center gap-1 text-tone-warning">
                      <AlertTriangle className="h-3 w-3" /> In the past — fine for recording attendance afterwards
                    </span>
                  )}
                </span>
              ) : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <DatePicker
                value={day}
                onChange={d => d && setDay(d)}
                allowPast
                presets={false}
                trigger={
                  <button type="button" className={cn(triggerCls, 'w-auto min-w-[112px]')}>
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    {shortDate(day)}
                  </button>
                }
              />
              <span className="flex items-center gap-1.5">
                <input
                  type="time"
                  value={start}
                  step={300}
                  aria-label="Start time"
                  onChange={e => {
                    const next = e.target.value;
                    if (!next) return;
                    setEnd(addMinutesToTime(next, duration));
                    setStart(next);
                  }}
                  className={cn(inputCls, 'w-[124px] px-2 tabular-nums')}
                />
                <span className="-mx-0.5 text-muted-foreground">–</span>
                <input type="time" value={end} step={300} aria-label="End time" onChange={e => e.target.value && setEnd(e.target.value)} className={cn(inputCls, 'w-[124px] px-2 tabular-nums')} />
              </span>
              <OptionPicker
                value={DURATIONS.includes(duration) ? duration : null}
                onChange={v => v && setEnd(addMinutesToTime(start, Number(v)))}
                options={DURATIONS.map(m => ({ value: m, label: durationText(m) }))}
                placeholder="Duration…"
                width={180}
                trigger={
                  <button type="button" className="ghost-chip h-9 gap-1 text-sm text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    {durationText(duration)}
                  </button>
                }
              />
            </div>
          </Row>

          <Row icon={<Globe2 />} label="Time zone">
            <OptionPicker
              value={timezone}
              onChange={v => v && setTimezone(v)}
              options={zoneOptions}
              placeholder="Search cities or GMT offsets…"
              width={320}
              trigger={
                <button type="button" className={triggerCls}>
                  <span className="min-w-0 flex-1 truncate">{zoneLabel(timezone, startsAt?.toISOString()).city}</span>
                  <span className="text-sm text-muted-foreground">
                    {zoneAbbr(startsAt?.toISOString() ?? new Date().toISOString(), timezone)} · {zoneLabel(timezone, startsAt?.toISOString()).gmt}
                  </span>
                </button>
              }
            />
          </Row>

          <Row icon={<MapPin />} label="Location">
            <input value={location} onChange={e => setLocation(e.target.value)} maxLength={240} placeholder="Room, address, or “Zoom”" className={inputCls} />
          </Row>
          <Row icon={<Video />} label="Meeting link" hint={urlInvalid(meetingUrl) ? <span className="text-tone-danger">Use a full https:// link</span> : undefined}>
            <input value={meetingUrl} onChange={e => setMeetingUrl(e.target.value)} placeholder="https://zoom.us/j/…" inputMode="url" className={cn(inputCls, urlInvalid(meetingUrl) && 'border-tone-danger')} />
          </Row>
          {editing && (
            <Row icon={<Link2 />} label="Recording" hint={urlInvalid(recordingUrl) ? <span className="text-tone-danger">Use a full https:// link</span> : 'Shared with registrants after the session.'}>
              <input value={recordingUrl} onChange={e => setRecordingUrl(e.target.value)} placeholder="https://…" inputMode="url" className={cn(inputCls, urlInvalid(recordingUrl) && 'border-tone-danger')} />
            </Row>
          )}
          <Row icon={<Users />} label="Capacity" hint={capInvalid ? <span className="text-tone-danger">Enter a whole number of seats, or leave blank</span> : cap ? 'People past capacity join a waitlist and move up automatically.' : undefined}>
            <input value={capacity} onChange={e => setCapacity(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Unlimited" inputMode="numeric" className={cn(inputCls, 'w-32 tabular-nums', capInvalid && 'border-tone-danger')} />
          </Row>
          <Row icon={<UserRound />} label="Instructor">
            <StaffPicker
              allowNone
              noneLabel="No instructor"
              value={instructorId}
              onChange={setInstructorId}
              trigger={
                <button type="button" className={triggerCls}>
                  {instructor ? <PersonAvatar person={instructor} size={16} /> : <span className="h-4 w-4 rounded-full border border-dashed border-input" />}
                  <span className={cn('min-w-0 flex-1 truncate', !instructor && 'text-muted-foreground')}>{instructor ? (instructor.id === ws.me.id ? `${instructor.name} (you)` : instructor.name) : 'No instructor'}</span>
                </button>
              }
            />
          </Row>

          <div className="pt-1">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[14px] text-muted-foreground">Description</span>
              <div className="flex rounded-md border p-0.5 text-sm">
                {(['Write', 'Preview'] as const).map(m => (
                  <button key={m} type="button" onClick={() => setPreview(m === 'Preview')} className={cn('h-5 rounded px-2', (m === 'Preview') === preview ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {preview ? (
              <div className="min-h-[96px] rounded-md border bg-subtle/40 px-3 py-2">{description.trim() ? <Markdown className="text-[14px]">{description}</Markdown> : <p className="text-[14px] text-muted-foreground">Nothing to preview.</p>}</div>
            ) : (
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={4}
                placeholder="What to expect, what to bring, how to prepare. Markdown works."
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-[14px] shadow-2xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
              />
            )}
          </div>
        </div>

        {rescheduleOf && rescheduleOf.count > 0 && (
          <label className="flex cursor-pointer items-start gap-2.5 border-t px-5 py-3 text-[14px]">
            <input type="checkbox" checked={inviteBack} onChange={e => setInviteBack(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
            <span>
              Register the {rescheduleOf.count === 1 ? 'person' : `${rescheduleOf.count} people`} whose {rescheduleOf.count === 1 ? 'seat was' : 'seats were'} cancelled
              <span className="block text-sm text-muted-foreground">They get a confirmation with the new time. Past capacity, they join the waitlist.</span>
            </span>
          </label>
        )}

        <div className="flex items-center justify-between gap-2 border-t bg-subtle/60 px-5 py-3">
          <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Kbd>{MOD}</Kbd>
            <Kbd>↵</Kbd> to {editing ? 'save' : 'schedule'}
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
              Cancel
            </button>
            <button type="button" disabled={!canSubmit} onClick={submit} className="h-9 rounded-md bg-primary px-3.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
              {busy ? 'Saving…' : editing ? 'Save changes' : rescheduleOf ? 'Reschedule' : 'Schedule session'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
