import { MapPin, Radio, Video } from 'lucide-react';
import { cn } from '@project/components/lib/utils';
import { Tip } from '../primitives/bits';
import { seatsTaken, type SessionRow } from './data';
import { sessionPhase, type SessionPhase } from './time';

export const isOnline = (s: Pick<SessionRow, 'location' | 'meetingUrl'>) => Boolean(s.meetingUrl) && (!s.location.trim() || /zoom|meet|teams|online|webex|virtual/i.test(s.location));

/** Where: a pin for a place, a camera for online. */
export function WhereText({ session, className }: { session: Pick<SessionRow, 'location' | 'meetingUrl'>; className?: string }) {
  const online = isOnline(session);
  const Icon = online ? Video : MapPin;
  const text = session.location.trim() || (session.meetingUrl ? 'Online' : 'No location');
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', !session.location.trim() && !session.meetingUrl && 'text-muted-foreground/70', className)}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** Seats taken against capacity, with the waitlist beside it as plain text. `compact` drops the bar (phones). */
export function CapacityMeter({ session, className, showWaitlist = true, compact = false }: { session: Pick<SessionRow, 'capacity' | 'counts'> & { status?: string }; className?: string; showWaitlist?: boolean; compact?: boolean }) {
  // A cancelled session has no seats to fill; say how many registrations went with it.
  if (session.status === 'Cancelled') {
    const n = session.counts.cancelled;
    return <span className={cn('whitespace-nowrap text-sm tabular-nums text-muted-foreground', className)}>{!n ? 'Nobody registered' : compact ? `${n} cancelled` : `${n} ${n === 1 ? 'registration' : 'registrations'} cancelled`}</span>;
  }
  const taken = seatsTaken(session.counts);
  const cap = session.capacity;
  const ratio = cap ? Math.min(1, taken / cap) : 0;
  const full = cap != null && taken >= cap;
  const waiting = session.counts.waitlisted;
  return (
    <Tip label={cap ? `${taken} of ${cap} seats taken${waiting ? ` · ${waiting} on the waitlist` : ''}` : `${taken} registered · no seat limit${waiting ? ` · ${waiting} on the waitlist` : ''}`}>
      <span className={cn('inline-flex items-center gap-2 whitespace-nowrap text-sm tabular-nums', className)}>
        {showWaitlist && waiting > 0 && <span className="text-tone-warning">+{waiting} waiting</span>}
        {cap && !compact ? (
          <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className={cn('block h-full rounded-full', full ? 'bg-tone-warning' : 'bg-foreground/70')} style={{ width: `${Math.max(ratio * 100, taken ? 6 : 0)}%` }} />
          </span>
        ) : null}
        <span className="text-muted-foreground">
          <span className="text-foreground">{taken}</span>
          {cap ? `/${cap}` : ' registered'}
        </span>
      </span>
    </Tip>
  );
}

export const PHASE_META: Record<SessionPhase, { label: string; cls: string }> = {
  upcoming: { label: 'Scheduled', cls: 'bg-muted text-muted-foreground' },
  live: { label: 'Live now', cls: 'bg-tone-danger/[0.1] text-tone-danger' },
  ended: { label: 'Ended', cls: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', cls: 'bg-muted text-muted-foreground line-through decoration-muted-foreground/60' },
};

export function PhaseBadge({ session, className, hideUpcoming }: { session: Pick<SessionRow, 'startsAt' | 'endsAt' | 'status'>; className?: string; hideUpcoming?: boolean }) {
  const phase = sessionPhase(session);
  if (hideUpcoming && phase === 'upcoming') return null;
  const meta = PHASE_META[phase];
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs font-medium', meta.cls, className)}>
      {phase === 'live' && <Radio className="h-3 w-3 animate-pulse" aria-hidden />}
      {meta.label}
    </span>
  );
}
