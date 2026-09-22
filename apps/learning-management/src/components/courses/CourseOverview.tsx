import { ArrowRight, Award, BarChart3, BookOpen, CalendarClock, ClipboardCheck, Clock, GraduationCap, Info, Route, Star, Users, Workflow } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { formatDuration, formatMinutes, plural, shortDate, shortDateTime, timeAgo } from '../../lib/format';
import type { CourseDetail } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { AvatarStack, PersonAvatar } from '../primitives/Avatar';
import { EmptyState, Tip } from '../primitives/bits';
import { CourseGlyph, LessonTypeIcon, Stars } from '../primitives/icons';
import { OTHER, slot, VIZ_STYLE } from '../reports/viz';
import { Panel, StatusPill } from './CourseBits';
import { useCourseOverview, type CourseOverview as Overview, type OverviewRange } from './courseData';
import { useStoredState } from './useListKeys';

const RANGES: Array<{ value: OverviewRange; label: string; long: string }> = [
  { value: 'all', label: 'All time', long: 'everyone ever enrolled' },
  { value: '365d', label: '12 months', long: 'people enrolled in the last 12 months' },
  { value: '90d', label: '90 days', long: 'people enrolled in the last 90 days' },
  { value: '30d', label: '30 days', long: 'people enrolled in the last 30 days' },
];

/** Enrolled and completed, in the chart, the funnel and the lesson table alike. */
const ENROLLED = OTHER;
const COMPLETED = slot(0);

/** One cell of the stat strip: label, number, and a hint line that's always there so numbers share a baseline. */
function Kpi({ label, value, foot, to, tone, tip }: { label: string; value: ReactNode; foot: ReactNode; to?: string; tone?: string; tip?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <span className="truncate">{label}</span>
        {tip && (
          <Tip label={tip}>
            <Info className="h-3 w-3 shrink-0" aria-label={tip} />
          </Tip>
        )}
      </div>
      <div className={cn('mt-1 truncate text-[22px] font-semibold leading-7 tabular-nums tracking-tight', tone)}>{value}</div>
      <div className="mt-0.5 h-4 truncate text-sm leading-4 text-muted-foreground">{foot}</div>
    </>
  );
  return to ? (
    <Link to={to} className="block min-w-0 px-4 py-3.5 transition-colors hover:bg-accent/40">
      {body}
    </Link>
  ) : (
    <div className="min-w-0 px-4 py-3.5">{body}</div>
  );
}

function days(n: number | null) {
  if (n == null) return '—';
  if (n < 1) return 'Same day';
  return `${Math.round(n)} day${Math.round(n) === 1 ? '' : 's'}`;
}

/**
 * The course at a glance: how many people are in it and how they're doing,
 * where learners stall, how quizzes land, what people said, and what feeds
 * learners in.
 */
export function CourseOverview({ detail }: { detail: CourseDetail }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const course = detail.course;
  const [range, setRange] = useStoredState<OverviewRange>('lms:course-overview:range', 'all');
  const { data, isPending, isError, refetch, isFetching } = useCourseOverview(course.id, range);
  const k = data?.kpis;
  const rangeMeta = RANGES.find(r => r.value === range) ?? RANGES[0];
  const hasQuiz = detail.lessons.some(l => l.type === 'Quiz');

  return (
    <>
    <style>{VIZ_STYLE}</style>
    <div className="lms-viz mx-auto max-w-[1180px] space-y-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 basis-[240px] text-sm text-muted-foreground">Learner numbers count each person once, on their latest cycle — {rangeMeta.long}.</p>
        {isFetching && !isPending && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" aria-label="Refreshing" />}
        <div className="flex h-8 items-center rounded-md border bg-background p-0.5" role="radiogroup" aria-label="Time range">
          {RANGES.map(r => (
            <button key={r.value} type="button" role="radio" aria-checked={range === r.value} onClick={() => setRange(r.value)} className={cn('h-full rounded-[4px] px-2 text-[13px] transition-colors', range === r.value ? 'bg-accent font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isError ? (
        <EmptyState icon={<BarChart3 />} title="Couldn't load the overview" description="Check your connection and try again." action={<button type="button" onClick={() => refetch()} className="text-[14px] text-primary hover:underline">Retry</button>} />
      ) : (
        <>
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card md:grid-cols-4 [&>*]:border-b [&>*]:border-r md:[&>*:nth-child(4n)]:border-r-0 max-md:[&>*:nth-child(2n)]:border-r-0 md:[&>*:nth-last-child(-n+4)]:border-b-0 max-md:[&>*:nth-last-child(-n+2)]:border-b-0">
            {isPending || !k ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-2 px-4 py-4">
                  <div className="skeleton h-3 w-20" />
                  <div className="skeleton h-6 w-14" />
                  <div className="skeleton h-3 w-24" />
                </div>
              ))
            ) : (
              <>
                <Kpi label="Enrolled" value={k.enrolled.toLocaleString()} foot={k.enrolled ? `${k.notStarted} not started · ${k.inProgress} in progress` : 'Nobody yet'} to={`/courses/${course.id}/learners`} />
                <Kpi label="Completion rate" value={k.completionRate == null ? '—' : `${k.completionRate}%`} foot={k.completed ? `${plural(k.completed, 'person', 'people')} completed` : k.enrolled ? 'Nobody finished yet' : 'Nobody enrolled yet'} />
                <Kpi label="Finished on time" value={k.onTimeRate == null ? '—' : `${k.onTimeRate}%`} foot={k.completed ? 'of completions, by their due date' : 'Nobody finished yet'} />
                <Kpi label="Overdue" value={k.overdue.toLocaleString()} tone={k.overdue ? 'text-tone-danger' : undefined} foot={k.overdue ? 'See who' : k.enrolled ? 'Everyone is on track' : 'Nobody enrolled yet'} to={k.overdue ? `/courses/${course.id}/learners?due=overdue` : undefined} />
                <Kpi label="Average quiz score" value={k.averageScore == null ? '—' : `${k.averageScore}%`} foot={!hasQuiz ? 'No quizzes in this course' : k.averageScore == null ? 'No attempts yet' : 'best attempts, averaged'} />
                <Kpi label="Time to complete" value={days(k.medianDaysToComplete)} foot={k.medianDaysToComplete == null ? 'Nobody finished yet' : 'median, from enrolling'} tip="The median: half of the people who finished took less time than this, from enrolling to completing." />
                <Kpi label="Time spent" value={k.averageTimeSeconds == null ? '—' : formatDuration(k.averageTimeSeconds)} foot={k.averageTimeSeconds == null ? (course.estimatedMinutes ? `Estimated ${formatMinutes(course.estimatedMinutes)}` : 'Nobody has started yet') : course.estimatedMinutes ? `on average · estimated ${formatMinutes(course.estimatedMinutes)}` : 'on average'} />
                <Kpi
                  label="Rating"
                  value={
                    k.ratingAverage == null ? (
                      '—'
                    ) : (
                      <span className="flex items-center gap-2">
                        {k.ratingAverage.toFixed(1)} <Stars value={k.ratingAverage} size={13} />
                      </span>
                    )
                  }
                  foot={k.ratingCount ? plural(k.ratingCount, 'rating') : 'No ratings yet'}
                />
              </>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <Panel title="Enrollments and completions" icon={<GraduationCap />} action={<Legend />}>
                  <div className="h-[190px] px-3 pb-2 pt-4">
                    {data ? <WeeklyChart weekly={data.weekly} /> : <div className="skeleton h-full w-full" />}
                  </div>
                </Panel>
                <Panel title="Funnel" icon={<BarChart3 />}>
                  {data ? <Funnel data={data} /> : <div className="space-y-3 p-4">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-6 w-full" />)}</div>}
                </Panel>
              </div>

              <Panel title="Lesson drop-off" icon={<BookOpen />} action={<span className="hidden text-sm text-muted-foreground sm:inline">Share of enrolled learners</span>}>
                {!data ? (
                  <div className="space-y-2 p-4">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-8 w-full" />)}</div>
                ) : data.lessons.length === 0 ? (
                  <EmptyState className="py-10" icon={<BookOpen />} title="No lessons yet" description="Add lessons on the Content tab to see how far learners get through each one." action={<Link to={`/courses/${course.id}/content`} className="text-[14px] text-primary hover:underline">Open the builder</Link>} />
                ) : (
                  <LessonTable data={data} detail={detail} />
                )}
              </Panel>

              <Panel title="Ratings and reviews" icon={<Star />}>
                {!data ? <div className="skeleton m-4 h-24" /> : <Ratings data={data} />}
              </Panel>
            </div>

            <div className="min-w-0 space-y-5">
              <DetailsPanel detail={detail} />
              <Panel title="Learning paths" icon={<Route />} action={data?.paths.length ? <span className="text-sm tabular-nums text-muted-foreground">{data.paths.length}</span> : undefined}>
                {!data ? (
                  <div className="skeleton m-4 h-10" />
                ) : data.paths.length === 0 ? (
                  <p className="px-4 py-3.5 text-[14px] text-muted-foreground">Not part of any learning path.</p>
                ) : (
                  <ul className="divide-y">
                    {data.paths.map(p => (
                      <li key={p.id}>
                        <Link to={`/paths/${p.id}`} className="flex items-center gap-2.5 px-4 py-2.5 text-[14px] hover:bg-accent/40">
                          <CourseGlyph icon={p.icon} color={p.color} size={20} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{p.title}</span>
                            <span className="block text-sm text-muted-foreground">
                              Course {p.step} of {p.courseCount}
                              {p.optional ? ' · optional' : ''}
                            </span>
                          </span>
                          {p.status !== 'Published' && <StatusPill status={p.status as 'Draft' | 'Archived'} />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="Assignment rules" icon={<Workflow />} action={ws.isAdmin ? <Link to="/assignments?new=1" className="text-sm text-muted-foreground hover:text-foreground">New rule</Link> : undefined}>
                {!data ? (
                  <div className="skeleton m-4 h-10" />
                ) : data.rules.length === 0 ? (
                  <p className="px-4 py-3.5 text-[14px] text-muted-foreground">No rules assign this course automatically.</p>
                ) : (
                  <ul className="divide-y">
                    {data.rules.map(r => (
                      <li key={r.id}>
                        <Link to={`/assignments/${r.id}`} className="block px-4 py-2.5 text-[14px] hover:bg-accent/40">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                            {r.status !== 'Active' && <span className="shrink-0 text-sm text-muted-foreground">{r.status}</span>}
                          </div>
                          <div className="mt-0.5 truncate text-sm text-muted-foreground">
                            {r.audience === 'Everyone' ? 'Everyone' : r.audience === 'Groups' ? r.groupIds.map(id => ws.groupById.get(id)?.name).filter(Boolean).join(', ') || plural(r.groupIds.length, 'group') : plural(r.personCount, 'person', 'people')}
                            {r.recurrenceMonths ? ` · every ${plural(r.recurrenceMonths, 'month')}` : ''}
                            {r.viaPath ? ` · via ${r.viaPath.title}` : ''}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="Live sessions" icon={<CalendarClock />}>
                {!data ? (
                  <div className="skeleton m-4 h-9" />
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3 text-[14px]">
                    <span className="min-w-0 flex-1">
                      {data.sessions.upcoming ? (
                        <>
                          <span className="font-medium">{plural(data.sessions.upcoming, 'upcoming session')}</span>
                          {data.sessions.nextStartsAt && <span className="block text-sm text-muted-foreground">Next {shortDateTime(data.sessions.nextStartsAt)}</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Nothing scheduled.</span>
                      )}
                    </span>
                    {data.sessions.upcoming ? (
                      <Link to={`/sessions?course=${course.id}`} className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                        View <ArrowRight className="h-3 w-3" />
                      </Link>
                    ) : (
                      detail.canEdit && (
                        <button type="button" onClick={() => app.openCreateSession(course.id)} className="shrink-0 text-sm font-medium text-foreground hover:underline">
                          Schedule one
                        </button>
                      )
                    )}
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
    </>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} aria-hidden />;
}

function Legend() {
  return (
    <span className="flex items-center gap-3 text-sm text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Swatch color={ENROLLED} /> Enrolled
      </span>
      <span className="flex items-center gap-1.5">
        <Swatch color={COMPLETED} /> Completed
      </span>
    </span>
  );
}

function WeeklyChart({ weekly }: { weekly: Overview['weekly'] }) {
  const empty = weekly.every(w => !w.enrollments && !w.completions);
  if (empty) return <div className="flex h-full items-center justify-center px-4 text-center text-[14px] text-muted-foreground">No enrollments or completions in the last 12 weeks.</div>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={weekly} barGap={2} margin={{ top: 0, right: 4, left: -18, bottom: 0 }}>
        <XAxis dataKey="week" tickFormatter={w => shortDate(w)} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval={2} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={40} />
        <Tooltip
          cursor={{ fill: 'hsl(var(--accent))' }}
          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow-md)', color: 'hsl(var(--popover-foreground))' }}
          labelFormatter={w => `Week of ${shortDate(String(w))}`}
        />
        <Bar dataKey="enrollments" name="Enrolled" fill={ENROLLED} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="completions" name="Completed" fill={COMPLETED} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Funnel({ data }: { data: Overview }) {
  const f = data.funnel;
  const steps = [
    { label: 'Enrolled', n: f.enrolled, hint: 'Everyone counted on the course' },
    { label: 'Started', n: f.started, hint: 'Opened at least one lesson' },
    { label: 'Halfway', n: f.halfway, hint: 'At least 50% progress' },
    { label: 'Completed', n: f.completed, hint: 'Finished every required lesson' },
  ];
  if (!f.enrolled) return <p className="px-4 py-6 text-center text-[14px] text-muted-foreground">The funnel fills in once people enroll.</p>;
  return (
    <ul className="space-y-2.5 px-4 py-4">
      {steps.map((s, i) => {
        const pct = Math.round((s.n / f.enrolled) * 100);
        const prev = i > 0 ? steps[i - 1].n : null;
        const lost = prev != null ? prev - s.n : 0;
        return (
          <li key={s.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <Tip label={s.hint} side="top">
                <span className="font-medium text-foreground">{s.label}</span>
              </Tip>
              <span className="tabular-nums text-muted-foreground">
                {s.n.toLocaleString()} · {pct}%{lost > 0 && <span className="ml-1.5">(−{lost})</span>}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(pct, s.n ? 2 : 0)}%`, background: i === steps.length - 1 ? COMPLETED : ENROLLED }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RateBar({ value, color }: { value: number | null; color: string }) {
  if (value == null) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 min-w-[40px] flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </span>
      <span className="w-9 text-right text-sm tabular-nums text-muted-foreground">{value}%</span>
    </span>
  );
}

/** Lesson columns share one template with their header; on a phone each lesson reflows to its title over its numbers. */
const LESSON_GRID = 'sm:grid sm:grid-cols-[minmax(0,1fr)_100px_100px_56px_92px_80px] sm:items-center sm:gap-x-3';

function LessonTable({ data, detail }: { data: Overview; detail: CourseDetail }) {
  const courseId = detail.course.id;
  const passing = new Map(detail.lessons.map(l => [l.id, typeof l.settings.passingScore === 'number' ? (l.settings.passingScore as number) : 70]));
  const biggestDrop = data.lessons.reduce<{ id: string | null; drop: number }>(
    (best, l, i) => {
      if (i === 0 || l.optional) return best;
      const prev = data.lessons.slice(0, i).reverse().find(x => !x.optional);
      const drop = (prev?.completedRate ?? 0) - (l.completedRate ?? 0);
      return drop > best.drop ? { id: l.id, drop } : best;
    },
    { id: null, drop: 9 },
  );
  let lastSection: string | null | undefined;
  return (
    <div>
      <div className={cn('hidden border-b px-4 py-2 text-sm text-muted-foreground', LESSON_GRID)}>
        <span>Lesson</span>
        <span>Reached</span>
        <span>Completed</span>
        <span className="text-right">Avg time</span>
        <Tip label="Average best score · share who passed on their first try">
          <span className="text-right">Quiz</span>
        </Tip>
        <span className="text-right">Grading</span>
      </div>
      {data.lessons.map(l => {
        const header = l.sectionId !== lastSection && l.sectionTitle ? l.sectionTitle : null;
        lastSection = l.sectionId;
        const below = l.quizAverage != null && l.quizAverage < (passing.get(l.id) ?? 70);
        const quiz =
          l.type === 'Quiz' ? (
            <Tip label={l.firstAttempts ? `Average best score ${l.quizAverage ?? '—'}% · ${l.firstAttemptPassRate ?? '—'}% passed on their first try (${plural(l.firstAttempts, 'first attempt')})` : 'No attempts yet'}>
              <span className="tabular-nums">
                <span className={below ? 'text-tone-warning' : 'text-foreground'}>{l.quizAverage == null ? '—' : `${l.quizAverage}%`}</span>
                <span className="text-muted-foreground"> · {l.firstAttemptPassRate == null ? '—' : `${l.firstAttemptPassRate}% 1st`}</span>
              </span>
            </Tip>
          ) : null;
        const grading =
          l.pendingGrading > 0 ? (
            <Link to={`/grading?course=${courseId}`} className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-foreground hover:underline">
              <ClipboardCheck className="h-3 w-3 text-muted-foreground" /> {l.pendingGrading} to grade
            </Link>
          ) : l.type === 'Assignment' ? (
            <span className="text-sm text-muted-foreground">All graded</span>
          ) : null;
        return (
          <Fragment key={l.id}>
            {header && <div className="border-b bg-subtle/60 px-4 py-1.5 text-sm text-muted-foreground">{header}</div>}
            <div className={cn('border-b px-4 py-2.5 text-[14px] last:border-b-0 hover:bg-accent/30 sm:py-2', LESSON_GRID)}>
              <Link to={`/courses/${courseId}/content/${l.id}`} className="flex min-w-0 items-start gap-2 hover:underline sm:items-center">
                <LessonTypeIcon type={l.type} className="mt-0.5 sm:mt-0" />
                <span className="min-w-0 sm:truncate">{l.title || 'Untitled lesson'}</span>
                {l.optional && <span className="mt-px shrink-0 text-sm text-muted-foreground sm:mt-0">Optional</span>}
                {biggestDrop.id === l.id && (
                  <Tip label={`The biggest drop in the course: ${Math.round(biggestDrop.drop)} points fewer people complete this than the lesson before`}>
                    <span className="mt-px shrink-0 rounded-full bg-tone-warning/[0.12] px-1.5 text-2xs font-medium leading-4 text-tone-warning sm:mt-0">Drop-off</span>
                  </Tip>
                )}
              </Link>
              {/* Phone: the two rates side by side, then the rest as one line. */}
              <div className="mt-2 grid grid-cols-2 gap-x-4 pl-[22px] sm:hidden">
                <div className="min-w-0">
                  <div className="mb-0.5 text-2xs text-muted-foreground">Reached</div>
                  <RateBar value={l.reachedRate} color={ENROLLED} />
                </div>
                <div className="min-w-0">
                  <div className="mb-0.5 text-2xs text-muted-foreground">Completed</div>
                  <RateBar value={l.completedRate} color={COMPLETED} />
                </div>
              </div>
              {(l.averageTimeSeconds != null || quiz || grading) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[22px] text-sm text-muted-foreground sm:hidden">
                  {l.averageTimeSeconds != null && <span>{formatDuration(l.averageTimeSeconds)} average</span>}
                  {quiz && <span className="inline-flex items-center gap-1">Quiz {quiz}</span>}
                  {grading}
                </div>
              )}
              <div className="hidden sm:block">
                <RateBar value={l.reachedRate} color={ENROLLED} />
              </div>
              <div className="hidden sm:block">
                <RateBar value={l.completedRate} color={COMPLETED} />
              </div>
              <div className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">{l.averageTimeSeconds == null ? '—' : formatDuration(l.averageTimeSeconds)}</div>
              <div className="hidden text-right text-sm sm:block">{quiz ?? <span className="text-muted-foreground">—</span>}</div>
              <div className="hidden text-right sm:block">{grading ?? <span className="text-sm text-muted-foreground">—</span>}</div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function Ratings({ data }: { data: Overview }) {
  const total = data.ratings.distribution.reduce((s, d) => s + d.count, 0);
  if (!total) return <p className="px-4 py-6 text-center text-[14px] text-muted-foreground">No ratings yet. Learners are asked to rate the course when they finish it.</p>;
  return (
    <div className="grid gap-5 p-4 md:grid-cols-[200px_minmax(0,1fr)]">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] font-semibold tabular-nums tracking-tight">{data.kpis.ratingAverage?.toFixed(1) ?? '—'}</span>
          <Stars value={data.kpis.ratingAverage} size={14} />
        </div>
        <div className="mb-3 text-sm text-muted-foreground">{plural(total, 'rating')}</div>
        <ul className="space-y-1.5">
          {data.ratings.distribution.map(d => (
            <li key={d.stars} className="flex items-center gap-2 text-sm">
              <span className="flex w-6 items-center gap-0.5 tabular-nums text-muted-foreground">
                {d.stars}
                <Star className="h-2.5 w-2.5 fill-current" />
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-muted-foreground/60" style={{ width: `${(d.count / total) * 100}%` }} />
              </span>
              <span className="w-6 text-right tabular-nums text-muted-foreground">{d.count}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">
        {data.ratings.reviews.length === 0 ? (
          <p className="py-2 text-[14px] text-muted-foreground">Nobody has written a review yet.</p>
        ) : (
          <ul className="divide-y">
            {data.ratings.reviews.map(r => (
              <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                <p className="text-[14px] leading-5">{r.review}</p>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Stars value={r.rating} size={10} />
                  <span>{r.author}</span>
                  {r.ratedAt && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{timeAgo(r.ratedAt)}</span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DetailsPanel({ detail }: { detail: CourseDetail }) {
  const ws = useWorkspace();
  const c = detail.course;
  const owner = c.ownerId ? ws.staffById.get(c.ownerId) : undefined;
  const instructors = c.instructorIds.map(id => ws.staffById.get(id)).filter(Boolean);
  const category = c.categoryId ? ws.categoryById.get(c.categoryId) : undefined;
  const rows: Array<[string, ReactNode]> = [
    ['Owner', owner ? <span className="flex min-w-0 items-center gap-1.5"><PersonAvatar person={owner} size={16} /><span className="truncate">{owner.name}</span></span> : <span className="text-muted-foreground">Nobody — admins manage it</span>],
    ['Instructors', instructors.length ? <span className="flex min-w-0 items-center gap-1.5"><AvatarStack people={instructors} size={16} /><span className="truncate">{instructors.length === 1 ? instructors[0]!.name : `${instructors.length} instructors`}</span></span> : <span className="text-muted-foreground">None</span>],
    ['Category', category ? `${category.icon} ${category.name}` : <span className="text-muted-foreground">None</span>],
    ['Level', c.level],
    ['Length', `${plural(detail.lessons.length, 'lesson')}${c.estimatedMinutes ? ` · ${formatMinutes(c.estimatedMinutes)}` : ''}`],
    ['Visibility', c.visibility === 'Catalog' ? 'In the catalog' : 'Private — assigned only'],
    ['Order', c.sequential ? 'Lessons unlock in order' : 'Any order'],
    ['Due', c.dueDays ? `${plural(c.dueDays, 'day')} after enrolling` : <span className="text-muted-foreground">No default</span>],
    ['Certificate', c.certificateEnabled ? <span className="flex items-center gap-1.5"><Award className="h-3.5 w-3.5 shrink-0 text-flame" />{c.certificateValidityMonths ? `Valid ${plural(c.certificateValidityMonths, 'month')}` : 'Never expires'}</span> : <span className="text-muted-foreground">None</span>],
  ];
  return (
    <Panel title="Details" icon={<Users />} action={detail.canEdit ? <Link to={`/courses/${c.id}/settings`} className="text-sm text-muted-foreground hover:text-foreground">Edit</Link> : undefined}>
      <dl className="divide-y">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start gap-3 px-4 py-2 text-[14px] leading-5">
            <dt className="w-[76px] shrink-0 text-sm leading-5 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 flex-1 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {c.publishedAt && (
        <div className="flex items-center gap-1.5 border-t px-4 py-2 text-sm text-muted-foreground">
          <Clock className="h-3 w-3" /> Published {shortDate(c.publishedAt)}
        </div>
      )}
    </Panel>
  );
}
