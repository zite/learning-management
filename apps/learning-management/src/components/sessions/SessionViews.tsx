import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { memo, useMemo } from 'react';
import { cn } from '@project/components/lib/utils';
import { PersonAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { CapacityMeter, PhaseBadge, WhereText } from './bits';
import type { SessionRow } from './data';
import { clock, dayHeading, differsFromViewer, localDayKey, sessionPhase, timeRange, zoneAbbr, zoneCity } from './time';

export function groupByDay(sessions: SessionRow[]) {
  const groups: Array<{ key: string; label: string; sessions: SessionRow[] }> = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const s of sessions) {
    if (!s.startsAt) continue;
    const key = localDayKey(s.startsAt);
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: dayHeading(s.startsAt), sessions: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.sessions.push(s);
  }
  return groups;
}

/**
 * One session. Times are the viewer's; when the session was scheduled in
 * another zone its own clock follows, named by city ("3:00 PM Chicago"), so
 * nobody has to guess which of two times is theirs.
 */
const SessionRowItem = memo(function SessionRowItem({ s, focused, onOpen, onFocus, inCancelledList = false }: { s: SessionRow; focused: boolean; onOpen: (s: SessionRow) => void; onFocus: (id: string) => void; inCancelledList?: boolean }) {
  const phase = sessionPhase(s);
  // In the Cancelled tab every row is cancelled; the struck-through time says so without a badge on each.
  const badge = <PhaseBadge session={s} hideUpcoming className={phase === 'ended' || (inCancelledList && phase === 'cancelled') ? 'hidden' : undefined} />;
  const zoned = Boolean(s.startsAt && differsFromViewer(s.startsAt, s.timezone));
  const muted = phase === 'cancelled';
  const localTip = s.startsAt ? `Scheduled for ${timeRange(s.startsAt, s.endsAt, s.timezone)} ${zoneAbbr(s.startsAt, s.timezone)} in ${zoneCity(s.timezone)}` : '';
  const yours = <span className={cn('whitespace-nowrap', muted && 'text-muted-foreground line-through decoration-muted-foreground/50')}>{timeRange(s.startsAt, s.endsAt)}</span>;
  const theirs =
    zoned && s.startsAt ? (
      <Tip label={localTip}>
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {clock(s.startsAt, s.timezone)} {zoneCity(s.timezone)}
        </span>
      </Tip>
    ) : null;
  const glyph = s.courseId ? <CourseGlyph icon={s.courseIcon} color={s.courseColor} size={18} /> : <span className="h-[18px] w-[18px] shrink-0 rounded-[5px] border border-dashed border-input" aria-hidden />;
  return (
    <div
      role="row"
      tabIndex={-1}
      data-session-id={s.id}
      onClick={() => onOpen(s)}
      onMouseMove={() => !focused && onFocus(s.id)}
      className={cn('group/row relative cursor-default select-none border-b border-border/60 text-[14px] transition-colors duration-75', focused ? 'bg-accent/80' : 'hover:bg-accent/50')}
    >
      {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
      {/* Phones: title and seats, then when and where. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 py-2.5 pl-4 pr-4 sm:hidden">
        {glyph}
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate font-medium', muted && 'text-muted-foreground')}>{s.title}</span>
          {badge}
        </span>
        <CapacityMeter session={s} compact />
        <span />
        <span className="col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm tabular-nums text-muted-foreground">
          {yours}
          {theirs}
          <WhereText session={s} className="min-w-[140px] max-w-full" />
        </span>
      </div>
      <div className="hidden h-11 items-center gap-x-3 pl-5 pr-4 sm:flex">
        <span className="flex w-[236px] shrink-0 items-baseline gap-2 tabular-nums">
          {yours}
          {theirs}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {glyph}
          <span className={cn('truncate font-medium', muted && 'text-muted-foreground')}>{s.title}</span>
          {s.courseTitle && s.courseTitle !== s.title && <span className="hidden min-w-0 truncate text-muted-foreground lg:inline">{s.courseTitle}</span>}
          {badge}
        </span>
        <WhereText session={s} className="hidden w-[180px] shrink-0 text-muted-foreground md:inline-flex" />
        <span className="flex w-6 shrink-0 justify-center">
          {s.instructorName ? (
            <Tip label={`Instructor: ${s.instructorName}`}>
              <span>
                <PersonAvatar person={{ name: s.instructorName, color: s.instructorColor, avatarUrl: s.instructorAvatarUrl }} size={20} />
              </span>
            </Tip>
          ) : (
            <Tip label="No instructor">
              <span>
                <UnassignedAvatar size={20} />
              </span>
            </Tip>
          )}
        </span>
        <span className="flex w-[150px] shrink-0 justify-end">
          <CapacityMeter session={s} />
        </span>
      </div>
    </div>
  );
});

/** Sessions by day, in the viewer's time zone. */
export function AgendaView({ sessions, focusedId, onOpen, onFocus, cancelledList = false }: { sessions: SessionRow[]; focusedId: string | null; onOpen: (s: SessionRow) => void; onFocus: (id: string) => void; cancelledList?: boolean }) {
  const groups = useMemo(() => groupByDay(sessions), [sessions]);
  return (
    <div role="grid" aria-label="Sessions">
      {groups.map(g => (
        <div key={g.key} role="rowgroup">
          <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b bg-subtle/95 px-4 text-sm backdrop-blur sm:pl-5">
            <span className={cn('font-medium', g.label === 'Today' && 'text-primary')}>{g.label}</span>
            {g.label !== 'Today' && g.label !== 'Tomorrow' && g.label !== 'Yesterday' ? null : <span className="text-muted-foreground">{format(new Date(g.sessions[0].startsAt!), 'EEE, MMM d')}</span>}
            <span className="tabular-nums text-muted-foreground">{g.sessions.length}</span>
          </div>
          {g.sessions.map(s => (
            <SessionRowItem key={s.id} s={s} focused={focusedId === s.id} onOpen={onOpen} onFocus={onFocus} inCancelledList={cancelledList} />
          ))}
        </div>
      ))}
    </div>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthRange(month: Date) {
  const from = startOfWeek(startOfMonth(month));
  const to = startOfDay(addDays(endOfWeek(endOfMonth(month)), 1));
  return { from, to };
}

/** A month grid. Chips on wide screens; dots on phones, with the chosen day listed below. */
export function MonthView({ month, sessions, selectedDay, onSelectDay, onOpen }: { month: Date; sessions: SessionRow[]; selectedDay: Date | null; onSelectDay: (d: Date) => void; onOpen: (s: SessionRow) => void }) {
  const { from, to } = monthRange(month);
  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
    return out;
  }, [from.getTime(), to.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = useMemo(() => {
    const m = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      if (!s.startsAt) continue;
      const k = localDayKey(s.startsAt);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [sessions]);
  const selected = selectedDay ? byDay.get(format(selectedDay, 'yyyy-MM-dd')) ?? [] : [];

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-7 border-b bg-subtle/60 text-sm text-muted-foreground">
        {WEEKDAYS.map(d => (
          <div key={d} className="px-2 py-1.5 text-center sm:text-left">
            <span className="sm:hidden">{d[0]}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const list = byDay.get(format(d, 'yyyy-MM-dd')) ?? [];
          const inMonth = isSameMonth(d, month);
          const isSel = selectedDay ? isSameDay(d, selectedDay) : false;
          return (
            <div
              key={d.toISOString()}
              role="button"
              tabIndex={0}
              aria-label={`${format(d, 'EEEE, MMMM d')}: ${list.length} session${list.length === 1 ? '' : 's'}`}
              aria-pressed={isSel}
              onClick={() => onSelectDay(d)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelectDay(d))}
              className={cn(
                'group relative min-h-[52px] cursor-default border-b border-r p-1 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-[112px] sm:p-1.5',
                (i + 1) % 7 === 0 && 'border-r-0',
                !inMonth && 'bg-subtle/50',
                isSel ? 'bg-primary/[0.05]' : 'hover:bg-accent/40',
              )}
            >
              <div className="flex items-center justify-center sm:justify-between">
                <span className={cn('flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm tabular-nums', !inMonth && 'text-muted-foreground/60', isToday(d) && 'bg-primary font-semibold text-primary-foreground', isSel && !isToday(d) && 'ring-1 ring-primary/50')}>{format(d, 'd')}</span>
              </div>
              {/* Phones: dots */}
              {list.length > 0 && (
                <div className="mt-1 flex justify-center gap-0.5 sm:hidden">
                  {list.slice(0, 3).map(s => (
                    <span key={s.id} className={cn('h-1.5 w-1.5 rounded-full', s.status === 'Cancelled' && 'opacity-40')} style={{ background: s.courseColor }} />
                  ))}
                </div>
              )}
              {/* Wider: chips */}
              <div className="mt-1 hidden space-y-0.5 sm:block">
                {list.slice(0, 3).map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      onOpen(s);
                    }}
                    title={`${timeRange(s.startsAt, s.endsAt)} · ${s.title}`}
                    className={cn('flex w-full items-center gap-1 overflow-hidden rounded-[4px] border-l-2 bg-background px-1.5 py-0.5 text-left text-[12.5px] leading-4 shadow-2xs hover:bg-accent', s.status === 'Cancelled' && 'text-muted-foreground line-through opacity-70')}
                    style={{ borderLeftColor: s.courseColor }}
                  >
                    <span className="shrink-0 tabular-nums text-muted-foreground">{s.startsAt ? clock(s.startsAt).replace(':00', '').replace(' ', '').toLowerCase() : ''}</span>
                    <span className="truncate">{s.title}</span>
                  </button>
                ))}
                {list.length > 3 && <div className="px-1.5 text-2xs text-muted-foreground group-hover:text-foreground">+{list.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
      {selectedDay && (
        <div className="border-b">
          <div className="flex h-9 items-center gap-2 border-b bg-subtle/60 px-4 text-sm sm:pl-5">
            <span className="font-medium">{format(selectedDay, 'EEEE, MMMM d')}</span>
            <span className="text-muted-foreground">{selected.length ? `${selected.length} session${selected.length === 1 ? '' : 's'}` : 'Nothing scheduled'}</span>
          </div>
          {selected.map(s => (
            <SessionRowItem key={s.id} s={s} focused={false} onOpen={onOpen} onFocus={() => undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
