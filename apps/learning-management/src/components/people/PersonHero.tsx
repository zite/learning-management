import { CalendarDays, Clock3, Copy, Mail, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { copyText } from '../../lib/clipboard';
import { dateTime, formatDuration, longDate, shortDate, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { IconButton, LabelDot, Tip } from '../primitives/bits';
import { PersonStatusPill, RoleBadge, Stat, TRAINING_HINT } from './PeopleBits';
import type { PersonDetail } from './peopleData';

/** Who this is at a glance: identity, reporting line, groups, and their training in numbers. */
export function PersonHero({ data, onReactivate, onResendInvite, compact }: { data: PersonDetail; onReactivate?: () => void; onResendInvite?: () => void; compact?: boolean }) {
  const ws = useWorkspace();
  const p = data.person;
  const s = data.stats;
  const groups = data.groups.map(g => ws.groupById.get(g.id)).filter(Boolean) as Array<NonNullable<ReturnType<typeof ws.groupById.get>>>;
  const neverSignedIn = !p.lastSeenAt && !p.lastLearnedAt;

  return (
    <div className="shrink-0 border-b bg-background">
      {p.status === 'Deactivated' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/60 px-4 py-2 text-[14px] sm:px-6">
          <span className="font-medium">Deactivated{p.deactivatedAt ? ` ${shortDate(p.deactivatedAt)}` : ''}</span>
          <span className="text-muted-foreground">They can’t sign in and don’t count toward reports. Their history stays.</span>
          {onReactivate && (
            <button type="button" onClick={onReactivate} className="ml-auto h-8 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
              Reactivate
            </button>
          )}
        </div>
      )}
      {p.status !== 'Deactivated' && neverSignedIn && p.invitedAt && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-tone-warning/[0.06] px-4 py-2 text-[14px] sm:px-6">
          <span className="font-medium text-tone-warning">Invited {timeAgo(p.invitedAt)}</span>
          <span className="text-muted-foreground">They haven’t signed in yet. Training assigned now waits for them.</span>
          {onResendInvite && (
            <button type="button" onClick={onResendInvite} className="ml-auto h-8 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
              Resend invitation
            </button>
          )}
        </div>
      )}

      <div className={cn('px-4 sm:px-6', compact ? 'pb-3 pt-3.5' : 'pb-4 pt-5')}>
        <div className="flex items-start gap-3.5">
          <PersonAvatar person={p} size={compact ? 44 : 52} className="text-[18px]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="truncate text-[19px] font-semibold tracking-[-0.015em]">{p.name}</h1>
              <RoleBadge role={p.role} always />
              <PersonStatusPill status={p.status} />
              {data.isMe && <span className="text-sm text-muted-foreground">You</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted-foreground">
              {p.title && <span className="text-foreground/80">{p.title}</span>}
              {data.manager ? (
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="h-3.5 w-3.5" /> Reports to
                  <Link to={`/people/${data.manager.id}`} className="inline-flex items-center gap-1 rounded px-0.5 text-foreground/90 hover:bg-accent hover:text-foreground">
                    <PersonAvatar person={data.manager} size={16} /> {data.manager.name}
                  </Link>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground/80">
                  <UserRound className="h-3.5 w-3.5" /> No manager
                </span>
              )}
              <span className="inline-flex min-w-0 items-center gap-1">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <a href={`mailto:${p.email}`} className="truncate hover:text-foreground hover:underline">
                  {p.email}
                </a>
                <Tip label="Copy email">
                  <IconButton size="sm" aria-label="Copy email" onClick={() => copyText(p.email, 'Copied email')}>
                    <Copy />
                  </IconButton>
                </Tip>
              </span>
              {p.hireDate && (
                <Tip label={`Hired ${longDate(p.hireDate)}`}>
                  <span className="hidden items-center gap-1.5 sm:inline-flex">
                    <CalendarDays className="h-3.5 w-3.5" /> Joined {shortDate(p.hireDate)}
                  </span>
                </Tip>
              )}
              <Tip label={s.lastActiveAt ? `Last active ${dateTime(s.lastActiveAt)}` : 'No activity yet'}>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" /> {s.lastActiveAt ? `Active ${timeAgo(s.lastActiveAt)}` : 'Never active'}
                </span>
              </Tip>
            </div>
            {groups.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {groups.map(g => (
                  <Link key={g.id} to={`/groups/${g.id}`} className="chip h-[22px] bg-background px-1.5 hover:bg-accent">
                    <LabelDot color={g.color} /> {g.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Open" value={s.active} hint={TRAINING_HINT.open} />
          <Stat label="Overdue" value={s.overdue} tone={s.overdue ? 'text-tone-danger' : undefined} hint={TRAINING_HINT.overdue} />
          <Stat label="Completed" value={s.completed} hint={TRAINING_HINT.completed} />
          <Stat label="Valid certificates" value={s.certificates} hint="Active and not expired" />
          <Stat label="Learning time" value={s.learningSeconds ? formatDuration(s.learningSeconds) : '—'} hint="Time spent in lessons, all courses" />
          <Stat label="Avg. quiz score" value={s.averageScore == null ? '—' : `${s.averageScore}%`} hint="Best quiz score per course, averaged" />
        </div>
      </div>
    </div>
  );
}
