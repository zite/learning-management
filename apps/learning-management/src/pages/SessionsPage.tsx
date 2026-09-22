import { addMonths, format, isSameMonth, parse, startOfMonth } from 'date-fns';
import { BookOpen, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Globe2, List, Plus, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { PersonAvatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { CourseGlyph } from '../components/primitives/icons';
import { CoursePicker, StaffPicker } from '../components/pickers/pickers';
import { useSessions, type SessionRow } from '../components/sessions/data';
import { AgendaView, MonthView, monthRange } from '../components/sessions/SessionViews';
import { viewerTimeZone, zoneAbbr } from '../components/sessions/time';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { useHotkeys } from '../lib/hotkeys';
import { useWorkspace } from '../lib/workspace';

type Scope = 'upcoming' | 'past' | 'cancelled';
const SCOPES: Array<{ key: Scope; label: string }> = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
];

const chip = 'inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-md border px-2 text-[13.5px] shadow-2xs transition-colors';

/**
 * Live sessions: an agenda by day (upcoming, past or cancelled) or a month
 * calendar, filterable by course and instructor. Filters, view and month live
 * in the URL so a link reopens the same view.
 */
export function SessionsPage() {
  useDocumentTitle('Live sessions');
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope = (SCOPES.some(s => s.key === params.get('tab')) ? params.get('tab') : 'upcoming') as Scope;
  const view = params.get('view') === 'month' ? 'month' : 'agenda';
  const courseId = params.get('course');
  const instructorId = params.get('instructor');
  const monthParam = params.get('month');
  const month = useMemo(() => {
    const parsed = monthParam ? parse(monthParam, 'yyyy-MM', new Date()) : new Date();
    return startOfMonth(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
  }, [monthParam]);
  const [selectedDay, setSelectedDay] = useState<Date | null>(() => new Date());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const update = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        prev => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const { from, to } = monthRange(month);
  const base = { courseId: courseId ?? undefined, instructorId: instructorId ?? undefined };
  const agenda = useSessions({ scope, ...base }, { enabled: view === 'agenda' });
  const calendar = useSessions({ scope: 'all', ...base, from: from.toISOString(), to: to.toISOString() }, { enabled: view === 'month' });
  // Tab counts come from whichever query ran; both honour the same filters.
  const counts = (view === 'agenda' ? agenda.data : calendar.data)?.counts ?? agenda.data?.counts;
  const sessions = agenda.data?.sessions ?? [];

  useEffect(() => setFocusedId(null), [scope, courseId, instructorId, view]);
  useEffect(() => {
    if (view === 'month') setSelectedDay(d => (d && isSameMonth(d, month) ? d : isSameMonth(new Date(), month) ? new Date() : null));
  }, [month, view]);

  const open = useCallback((s: SessionRow) => navigate(`/sessions/${s.id}`), [navigate]);
  const focusIndex = sessions.findIndex(s => s.id === focusedId);
  const focusAt = (i: number) => {
    const s = sessions[Math.max(0, Math.min(sessions.length - 1, i))];
    if (!s) return;
    setFocusedId(s.id);
    window.setTimeout(() => scrollRef.current?.querySelector(`[data-session-id="${s.id}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
  };
  useHotkeys({
    j: () => view === 'agenda' && focusAt(focusIndex + 1),
    down: () => view === 'agenda' && focusAt(focusIndex + 1),
    k: () => view === 'agenda' && focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
    up: () => view === 'agenda' && focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
    enter: () => focusIndex >= 0 && open(sessions[focusIndex]),
    esc: () => setFocusedId(null),
    n: () => app.openCreateSession(courseId ?? undefined),
    m: () => update({ view: view === 'month' ? null : 'month' }),
    ...(view === 'month' ? { left: () => update({ month: format(addMonths(month, -1), 'yyyy-MM') }), right: () => update({ month: format(addMonths(month, 1), 'yyyy-MM') }), t: () => update({ month: null }) } : {}),
  });

  const viewerZone = viewerTimeZone();
  const viewerAbbr = zoneAbbr(new Date().toISOString(), viewerZone);
  const course = courseId ? ws.courseById.get(courseId) : undefined;
  const instructor = instructorId ? ws.staffById.get(instructorId) : undefined;
  const filtered = Boolean(courseId || instructorId);
  const query = view === 'agenda' ? agenda : calendar;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<CalendarClock />}
        title="Live sessions"
        tabs={view === 'agenda' ? SCOPES.map(s => ({ to: `/sessions?${new URLSearchParams({ ...Object.fromEntries(params), tab: s.key }).toString()}`, label: s.label, count: counts?.[s.key] ?? null, active: scope === s.key })) : undefined}
        actions={
          <>
            <div className="mr-1 hidden rounded-md border p-0.5 sm:flex" role="radiogroup" aria-label="View">
              {(['agenda', 'month'] as const).map(v => (
                <Tip key={v} label={v === 'agenda' ? 'Agenda' : 'Month'} keys={['M']}>
                  <button type="button" role="radio" aria-checked={view === v} onClick={() => update({ view: v === 'month' ? 'month' : null })} className={cn('flex h-6 items-center gap-1.5 rounded px-2 text-sm', view === v ? 'bg-accent font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}>
                    {v === 'agenda' ? <List className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
                    {v === 'agenda' ? 'Agenda' : 'Month'}
                  </button>
                </Tip>
              ))}
            </div>
            {ws.isStaff && (
              <Tip label="Schedule a session" keys={['N']}>
                <button type="button" onClick={() => app.openCreateSession(courseId ?? undefined)} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                  <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Schedule session</span>
                </button>
              </Tip>
            )}
          </>
        }
      />

      <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        {view === 'month' && (
          <div className="mr-2 flex items-center gap-1">
            <IconButton aria-label="Previous month" onClick={() => update({ month: format(addMonths(month, -1), 'yyyy-MM') })}>
              <ChevronLeft />
            </IconButton>
            <span className="min-w-[120px] text-center text-[14px] font-medium tabular-nums">{format(month, 'MMMM yyyy')}</span>
            <IconButton aria-label="Next month" onClick={() => update({ month: format(addMonths(month, 1), 'yyyy-MM') })}>
              <ChevronRight />
            </IconButton>
            {!isSameMonth(month, new Date()) && (
              <button type="button" onClick={() => update({ month: null })} className="ml-1 h-8 rounded-md border px-2 text-sm shadow-2xs hover:bg-accent">
                Today
              </button>
            )}
          </div>
        )}
        <CoursePicker
          allowNone
          value={courseId}
          onChange={v => update({ course: v })}
          trigger={
            <button type="button" className={cn(chip, course ? 'bg-accent/60' : 'border-dashed text-muted-foreground hover:text-foreground')}>
              {course ? <CourseGlyph icon={course.icon} color={course.color} size={14} /> : <BookOpen className="h-3.5 w-3.5" />}
              <span className="truncate">{course ? course.title : 'Course'}</span>
            </button>
          }
        />
        <StaffPicker
          allowNone
          noneLabel="Any instructor"
          value={instructorId}
          onChange={v => update({ instructor: v })}
          trigger={
            <button type="button" className={cn(chip, instructor ? 'bg-accent/60' : 'border-dashed text-muted-foreground hover:text-foreground')}>
              {instructor ? <PersonAvatar person={instructor} size={14} /> : <UserRound className="h-3.5 w-3.5" />}
              <span className="truncate">{instructor ? instructor.name : 'Instructor'}</span>
            </button>
          }
        />
        {filtered && (
          <button type="button" onClick={() => update({ course: null, instructor: null })} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          {query.isFetching && !query.isPending && <span className="hidden h-1.5 w-1.5 animate-pulse rounded-full bg-primary/70 sm:block" aria-label="Refreshing" />}
          <Tip label={`Times are in your time zone (${viewerZone.replace(/_/g, ' ')}). A session scheduled in another zone also shows its own local time.`}>
            <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:inline-flex">
              <Globe2 className="h-3.5 w-3.5" /> Your time · {viewerAbbr}
            </span>
          </Tip>
          <button type="button" onClick={() => update({ view: view === 'month' ? null : 'month' })} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm shadow-2xs sm:hidden">
            {view === 'month' ? <List className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
            {view === 'month' ? 'Agenda' : 'Month'}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <SkeletonRows rows={8} className="pt-2" />
        ) : query.isError ? (
          <EmptyState icon={<CalendarClock />} title="Couldn't load sessions" description="Check your connection and try again." action={<button type="button" onClick={() => query.refetch()} className="text-[14px] text-primary hover:underline">Retry</button>} />
        ) : view === 'month' ? (
          <MonthView month={month} sessions={calendar.data?.sessions ?? []} selectedDay={selectedDay} onSelectDay={setSelectedDay} onOpen={open} />
        ) : sessions.length === 0 ? (
          filtered ? (
            <EmptyState icon={<CalendarClock />} title={`No ${scope} sessions match`} description="Try another course or instructor." action={<button type="button" onClick={() => update({ course: null, instructor: null })} className="text-[14px] text-primary hover:underline">Clear filters</button>} />
          ) : scope === 'upcoming' ? (
            <EmptyState
              icon={<CalendarClock />}
              title="Nothing scheduled"
              description="Schedule workshops, Q&As and practical assessments. People register from the academy, and attendance can complete a course’s live-session lesson."
              action={ws.isStaff ? <button type="button" onClick={() => app.openCreateSession()} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">Schedule a session</button> : undefined}
            />
          ) : (
            <EmptyState icon={<CalendarClock />} title={scope === 'past' ? 'No past sessions yet' : 'No cancelled sessions'} description={scope === 'past' ? 'Sessions show up here once they end, with their attendance.' : 'Sessions you cancel stay here for the record.'} />
          )
        ) : (
          <AgendaView sessions={sessions} focusedId={focusedId} onOpen={open} onFocus={setFocusedId} cancelledList={scope === 'cancelled'} />
        )}
      </div>
    </div>
  );
}
