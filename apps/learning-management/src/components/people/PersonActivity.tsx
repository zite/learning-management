import { Award, BellRing, BookOpenCheck, CalendarCheck2, CalendarClock, CalendarDays, CalendarX2, CheckCircle2, ClipboardList, GraduationCap, History, ListChecks, Mail, Pencil, RotateCcw, ShieldCheck, Star, Undo2, UserCheck, UserMinus, UserPlus, UserRound, UsersRound, UserX, Zap } from 'lucide-react';
import { format, isThisYear, isToday, isYesterday, parseISO } from 'date-fns';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { dateTime } from '../../lib/format';
import { activityText } from '../enrollments/activityText';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { useWorkspace } from '../../lib/workspace';
import { usePersonActivity, type PersonActivityItem } from './peopleData';

/** Timeline markers are neutral; colour marks only outcomes (completions, certificates) and losses of access. */
const ICONS: Record<string, { icon: ReactNode; tone?: string }> = {
  enrolled: { icon: <GraduationCap /> },
  enrolled_path: { icon: <GraduationCap /> },
  self_enrolled: { icon: <GraduationCap /> },
  started: { icon: <Zap /> },
  lesson_completed: { icon: <BookOpenCheck /> },
  quiz_attempted: { icon: <ListChecks /> },
  assignment_submitted: { icon: <ClipboardList /> },
  assignment_graded: { icon: <ClipboardList /> },
  course_completed: { icon: <CheckCircle2 />, tone: 'text-tone-success' },
  path_completed: { icon: <CheckCircle2 />, tone: 'text-tone-success' },
  marked_complete: { icon: <CheckCircle2 />, tone: 'text-tone-success' },
  certificate_issued: { icon: <Award />, tone: 'text-flame' },
  certificate_revoked: { icon: <Award />, tone: 'text-tone-danger' },
  due_date_changed: { icon: <CalendarDays /> },
  withdrawn: { icon: <UserMinus /> },
  restored: { icon: <Undo2 /> },
  progress_reset: { icon: <RotateCcw /> },
  course_rated: { icon: <Star /> },
  nudge: { icon: <BellRing /> },
  session_registered: { icon: <CalendarClock /> },
  session_cancelled: { icon: <CalendarX2 /> },
  attendance_marked: { icon: <CalendarCheck2 /> },
  person_invited: { icon: <Mail /> },
  person_created: { icon: <UserPlus /> },
  role_changed: { icon: <ShieldCheck /> },
  manager_changed: { icon: <UserRound /> },
  profile_updated: { icon: <Pencil /> },
  person_deactivated: { icon: <UserX />, tone: 'text-tone-danger' },
  person_reactivated: { icon: <UserCheck /> },
  group_joined: { icon: <UsersRound /> },
  group_left: { icon: <UsersRound /> },
};

function dayLabel(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, isThisYear(d) ? 'EEEE, MMMM d' : 'MMMM d, yyyy');
}

/**
 * The person's audit trail as a timeline: what happened to them and what they
 * did, one sentence each, grouped by day, newest first.
 */
export function PersonActivity({ personId, personName }: { personId: string; personName: string }) {
  const [scope, setScope] = useState<'all' | 'about' | 'by'>('all');
  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage, refetch } = usePersonActivity(personId, scope);
  const items = useMemo(() => data?.pages.flatMap(p => p.items) ?? [], [data]);
  const days = useMemo(() => {
    const out: Array<{ label: string; items: PersonActivityItem[] }> = [];
    for (const item of items) {
      const label = item.occurredAt ? dayLabel(item.occurredAt) : 'Undated';
      if (out.at(-1)?.label !== label) out.push({ label, items: [] });
      out.at(-1)!.items.push(item);
    }
    return out;
  }, [items]);

  return (
    <div className="w-full max-w-[820px] px-4 py-5 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-medium">Activity</h2>
        <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label="Show">
          {([
            ['all', 'All'],
            ['about', `About ${personName.split(' ')[0]}`],
            ['by', `By ${personName.split(' ')[0]}`],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={scope === value} onClick={() => setScope(value)} className={cn('h-6 rounded px-2 text-sm transition-colors', scope === value ? 'bg-accent font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <SkeletonRows rows={8} />
      ) : isError ? (
        <EmptyState icon={<History />} title="Couldn't load activity" description="Check your connection and try again." action={<button type="button" onClick={() => refetch()} className="text-[14px] text-primary hover:underline">Try again</button>} />
      ) : items.length === 0 ? (
        <EmptyState icon={<History />} title={scope === 'by' ? `${personName.split(' ')[0]} hasn’t changed anything for others` : 'No activity yet'} description={scope === 'by' ? 'Enrolling, grading and managing people shows up here.' : 'Enrollments, progress, certificates and changes to their profile show up here.'} />
      ) : (
        <div className="space-y-6">
          {days.map(day => (
            <section key={day.label}>
              <h3 className="sticky top-0 z-[1] -mx-1 mb-1 bg-background/95 px-1 py-1 text-sm font-medium text-muted-foreground backdrop-blur">{day.label}</h3>
              <ol className="relative ml-[11px] border-l border-border/80">
                {day.items.map(item => (
                  <ActivityItem key={item.id} item={item} personId={personId} personName={personName} />
                ))}
              </ol>
            </section>
          ))}
          {hasNextPage && (
            <div className="flex justify-center">
              <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent disabled:opacity-60">
                {isFetchingNextPage ? 'Loading…' : 'Show older activity'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityItem({ item, personId, personName }: { item: PersonActivityItem; personId: string; personName: string }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const meta = ICONS[item.type] ?? { icon: <History /> };
  const subject = item.personId === personId ? personName : item.personName;
  const actor = item.actorId === personId ? personName : item.actorName;
  const title = item.courseTitle ?? item.pathTitle ?? null;
  const text = activityText(item.type, { ...item.data, courseTitle: item.data.courseTitle ?? item.courseTitle ?? undefined, pathTitle: item.pathTitle ?? undefined }, { actor, subject, lessonTitle: item.lessonTitle });
  const course = item.courseId ? ws.courseById.get(item.courseId) : undefined;
  const path = item.pathId ? ws.pathById.get(item.pathId) : undefined;
  const showTarget = title && !text.includes(title);
  const aboutOther = item.personId && item.personId !== personId;
  return (
    <li className="relative pb-3 pl-6 last:pb-1">
      <span className={cn('absolute -left-[11px] top-0 flex h-[22px] w-[22px] items-center justify-center rounded-full border bg-background [&_svg]:h-3 [&_svg]:w-3', meta.tone ?? 'text-muted-foreground')}>{meta.icon}</span>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 pt-0.5 text-[14px] leading-5">
          <span>{text}</span>
          {aboutOther && item.personName && (
            <Link to={`/people/${item.personId}`} className="ml-1.5 inline-flex -translate-y-px items-center gap-1 rounded px-1 align-middle text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
              <PersonAvatar person={{ name: item.personName, color: item.personColor }} size={14} /> {item.personName}
            </Link>
          )}
          {showTarget && (
            <span className="ml-1.5 inline-flex -translate-y-px items-center gap-1 align-middle text-sm text-muted-foreground">
              <CourseGlyph icon={course?.icon ?? path?.icon} color={course?.color ?? path?.color} size={14} />
              {item.courseId ? (
                <Link to={`/courses/${item.courseId}`} className="hover:text-foreground hover:underline">
                  {title}
                </Link>
              ) : (
                <Link to={`/paths/${item.pathId}`} className="hover:text-foreground hover:underline">
                  {title}
                </Link>
              )}
            </span>
          )}
          {item.enrollmentId && (
            <button type="button" onClick={() => app.openEnrollment(item.enrollmentId!)} className="ml-1.5 -translate-y-px align-middle text-sm text-primary/80 hover:text-primary hover:underline">
              View
            </button>
          )}
        </div>
        <Tip label={item.occurredAt ? dateTime(item.occurredAt) : 'Unknown time'}>
          <span className="shrink-0 pt-0.5 text-sm tabular-nums text-muted-foreground">{item.occurredAt ? format(parseISO(item.occurredAt), 'h:mm a') : ''}</span>
        </Tip>
      </div>
    </li>
  );
}
