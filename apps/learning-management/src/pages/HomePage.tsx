import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Award, CalendarClock, ClipboardCheck, GraduationCap, Home, Hourglass, MessagesSquare, Plus, TriangleAlert, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { getHome } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { PersonAvatar } from '../components/primitives/Avatar';
import { EmptyState, Tip } from '../components/primitives/bits';
import { CourseGlyph } from '../components/primitives/icons';
import { AXIS_TICK, LegendKey, slot, TooltipRow, TooltipShell, VIZ_STYLE } from '../components/reports/viz';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { shortDate, timeAgo } from '../lib/format';
import { qk } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';

/** Same series colours as Reports → Learning activity, so a completion is the same blue everywhere. */
const COMPLETIONS = slot(0);
const ENROLLMENTS = slot(1);

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Change against the 30 days before. Kept to one line: the period is already in the tile's label. */
function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev && !now) return <span>No activity yet</span>;
  const period = <span className="hidden sm:inline"> in the prior 30 days</span>;
  if (!prev) return <span>Up from 0{period}</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return <span>No change{period}</span>;
  const up = pct > 0;
  return (
    <Tip label={`${up ? 'Up' : 'Down'} from ${prev.toLocaleString()} in the 30 days before`}>
      <span className="inline-flex items-center gap-1">
        <span className={cn('inline-flex items-center gap-0.5 font-medium tabular-nums', up ? 'text-tone-success' : 'text-tone-warning')}>
          {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {Math.abs(pct).toLocaleString()}%
        </span>
        <span>
          vs prior<span className="hidden sm:inline"> 30 days</span>
        </span>
      </span>
    </Tip>
  );
}

/** One cell of the stat strip: label (with its period), number, one line of context. Every cell has all three rows. */
function Kpi({ label, period, value, foot, to, tone }: { label: string; period?: string; value: ReactNode; foot: ReactNode; to: string; tone?: string }) {
  return (
    <Link to={to} className="group block min-w-0 bg-card px-4 py-3.5 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40">
      <div className="flex items-baseline gap-2 text-sm text-muted-foreground">
        <span className="truncate">{label}</span>
        {period && <span className="ml-auto shrink-0 text-2xs text-faint">{period}</span>}
      </div>
      <div className={cn('mt-1 text-[26px] font-semibold leading-8 tabular-nums tracking-tight', tone)}>{value}</div>
      <div className="mt-0.5 h-4 truncate text-sm leading-4 text-muted-foreground">{foot}</div>
    </Link>
  );
}

function Panel({ title, icon, action, children, className }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-xl border bg-card', className)}>
      <header className="flex h-10 items-center gap-2 border-b px-4">
        {icon && <span className="flex w-[18px] justify-center text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>}
        <h2 className="truncate text-[14px] font-medium">{title}</h2>
        {action && <div className="ml-auto flex shrink-0 items-center gap-3">{action}</div>}
      </header>
      {children}
    </section>
  );
}

function PanelLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-4" style={{ width: `${70 - ((i * 13) % 25)}%` }} />
      ))}
    </div>
  );
}

type WeekRow = { week: string; completions: number; enrollments: number };

function WeekTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: WeekRow }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TooltipShell title={`Week of ${shortDate(row.week)}`}>
      <TooltipRow color={COMPLETIONS} label="Completions" value={row.completions.toLocaleString()} />
      <TooltipRow color={ENROLLMENTS} label="Enrollments" value={row.enrollments.toLocaleString()} />
    </TooltipShell>
  );
}

export function HomePage() {
  const ws = useWorkspace();
  const app = useAppActions();
  useDocumentTitle('Home');
  const { data, isPending, isError, refetch } = useQuery({ queryKey: [...qk.homeRoot], queryFn: () => getHome({}), staleTime: 30_000 });
  const k = data?.kpis;
  const recent = data ? data.recent.filter(a => a.type !== 'certificate_issued').slice(0, 7) : [];
  const quietChart = data ? data.weekly.every(w => !w.completions && !w.enrollments) : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <style>{VIZ_STYLE}</style>
      <PageHeader
        icon={<Home />}
        title="Home"
        actions={
          <button type="button" onClick={() => app.openEnroll()} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
            <GraduationCap className="h-3.5 w-3.5" /> Enroll people
          </button>
        }
      />
      <div className="lms-viz min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] space-y-5 px-4 py-6 sm:px-6">
          <div className="animate-fade-up">
            <h1 className="text-[22px] font-semibold tracking-tight">
              {greeting()}, {ws.me.name.split(' ')[0]}
            </h1>
            <p className="mt-0.5 text-[14px] text-muted-foreground">Here’s how training is going at {ws.settings.organizationName.replace(/\.$/, '')}.</p>
          </div>

          {isError ? (
            <div className="rounded-xl border bg-card">
              <EmptyState
                title="The overview didn’t load"
                description="Check your connection and try again."
                action={<button type="button" onClick={() => void refetch()} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">Try again</button>}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
                {isPending || !k ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-card px-4 py-3.5">
                      <div className="skeleton h-3 w-24" />
                      <div className="skeleton mt-2.5 h-6 w-14" />
                      <div className="skeleton mt-2 h-3 w-28" />
                    </div>
                  ))
                ) : (
                  <>
                    <Kpi label="Active learners" period="30 days" value={k.activeLearners30d.toLocaleString()} foot={<Delta now={k.activeLearners30d} prev={k.activeLearnersPrev30d} />} to="/reports" />
                    <Kpi label="Completions" period="30 days" value={k.completions30d.toLocaleString()} foot={<Delta now={k.completions30d} prev={k.completionsPrev30d} />} to="/reports" />
                    <Kpi
                      label="Finished on time"
                      period="90 days"
                      value={k.onTimeRate == null ? '—' : `${k.onTimeRate}%`}
                      foot={k.completions90d ? `of ${k.completions90d.toLocaleString()} ${k.completions90d === 1 ? 'completion' : 'completions'}` : 'No completions yet'}
                      to="/reports"
                    />
                    <Kpi
                      label="Overdue enrollments"
                      value={k.overdue.toLocaleString()}
                      tone={k.overdue ? 'text-tone-danger' : undefined}
                      foot={k.overdue ? `${k.overduePeople} ${k.overduePeople === 1 ? 'person' : 'people'}` : 'Everyone’s on track'}
                      to="/enrollments?due=overdue"
                    />
                  </>
                )}
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0 space-y-5">
                  <Panel title="Needs attention" icon={<TriangleAlert />}>
                    {isPending || !data || !k ? (
                      <PanelLines />
                    ) : (
                      <div className="divide-y">
                        <AttentionRow
                          to="/grading"
                          icon={<ClipboardCheck />}
                          title={data.toGrade.length ? `${ws.counts.toGrade} ${ws.counts.toGrade === 1 ? 'submission' : 'submissions'} waiting to be graded` : 'No submissions waiting to be graded'}
                          muted={!data.toGrade.length}
                        >
                          {data.toGrade.length > 0 && (
                            <div className="-mx-1.5 mt-1.5">
                              {data.toGrade.slice(0, 3).map(s => (
                                <Link key={s.id} to={`/grading/${s.id}`} className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1 text-[14px] hover:bg-accent">
                                  <PersonAvatar person={{ name: s.personName, color: s.personColor }} size={18} />
                                  <span className="flex min-w-0 items-baseline gap-2">
                                    <span className="max-w-[65%] shrink-0 truncate">{s.personName}</span>
                                    <span className="min-w-0 truncate text-muted-foreground">{s.lessonTitle}</span>
                                  </span>
                                  <span className="text-sm tabular-nums text-muted-foreground">{timeAgo(s.submittedAt).replace(' ago', '')}</span>
                                </Link>
                              ))}
                            </div>
                          )}
                        </AttentionRow>
                        <AttentionRow
                          to="/discussions"
                          icon={<MessagesSquare />}
                          title={data.openQuestions.length ? `${ws.counts.openQuestions} learner ${ws.counts.openQuestions === 1 ? 'question' : 'questions'} without an answer` : 'Every learner question has an answer'}
                          muted={!data.openQuestions.length}
                        >
                          {data.openQuestions.length > 0 && (
                            <div className="-mx-1.5 mt-1.5">
                              {data.openQuestions.slice(0, 2).map(q => (
                                <Link key={q.id} to={`/discussions?thread=${q.id}`} className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-1.5 py-1 text-[14px] hover:bg-accent">
                                  <PersonAvatar person={{ name: q.personName, color: q.personColor }} size={18} className="mt-px" />
                                  <span className="min-w-0">
                                    <span className="block truncate">{q.body}</span>
                                    <span className="block truncate text-sm text-muted-foreground">
                                      {q.personName} · {q.lessonTitle}
                                    </span>
                                  </span>
                                  <span className="text-sm tabular-nums text-muted-foreground">{timeAgo(q.postedAt).replace(' ago', '')}</span>
                                </Link>
                              ))}
                            </div>
                          )}
                        </AttentionRow>
                        {data.overdueByCourse.length > 0 && (
                          <AttentionRow to="/enrollments?due=overdue" icon={<Hourglass />} title="Overdue by course">
                            <div className="-mx-1.5 mt-1.5">
                              {data.overdueByCourse.map(o => {
                                const c = ws.courseById.get(o.courseId);
                                return (
                                  <Tip key={o.courseId} label={`${o.overdue} of ${o.enrolled} enrolled ${o.overdue === 1 ? 'is' : 'are'} overdue`} side="top">
                                    <Link
                                      to={`/courses/${o.courseId}/learners?due=overdue`}
                                      className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1 text-[14px] hover:bg-accent sm:grid-cols-[18px_minmax(0,15rem)_minmax(0,1fr)_4.5rem]"
                                    >
                                      <CourseGlyph icon={c?.icon} color={c?.color} size={18} />
                                      <span className="truncate">{c?.title ?? 'Deleted course'}</span>
                                      <span className="hidden h-1.5 overflow-hidden rounded-full bg-muted sm:block">
                                        <span className="block h-full rounded-full bg-tone-danger/70" style={{ width: `${Math.max(3, (o.overdue / Math.max(1, o.enrolled)) * 100)}%` }} />
                                      </span>
                                      <span className="text-right text-sm tabular-nums text-tone-danger">{o.overdue} overdue</span>
                                    </Link>
                                  </Tip>
                                );
                              })}
                            </div>
                          </AttentionRow>
                        )}
                        <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                          <AttentionRow
                            to="/enrollments?stalled=1"
                            icon={<Hourglass />}
                            title={k.stalled ? `${k.stalled} ${k.stalled === 1 ? 'enrollment' : 'enrollments'} stalled for 2+ weeks` : 'Nothing stalled for 2+ weeks'}
                            muted={!k.stalled}
                          />
                          <AttentionRow
                            to="/certificates?state=expiring"
                            icon={<Award />}
                            title={k.expiringCertificates ? `${k.expiringCertificates} ${k.expiringCertificates === 1 ? 'certificate' : 'certificates'} expiring in 30 days` : 'No certificates expiring in 30 days'}
                            muted={!k.expiringCertificates}
                          />
                        </div>
                      </div>
                    )}
                  </Panel>

                  <Panel
                    title="Completions and enrollments"
                    icon={<GraduationCap />}
                    action={
                      <>
                        <span className="hidden items-center gap-3 sm:flex">
                          <LegendKey color={COMPLETIONS} label="Completions" />
                          <LegendKey color={ENROLLMENTS} label="Enrollments" />
                        </span>
                        <span className="text-sm text-muted-foreground">12 weeks</span>
                      </>
                    }
                  >
                    <div className="flex items-center gap-3 px-4 pt-3 sm:hidden">
                      <LegendKey color={COMPLETIONS} label="Completions" />
                      <LegendKey color={ENROLLMENTS} label="Enrollments" />
                    </div>
                    <div className="relative h-[180px] px-3 pb-2 pt-4">
                      {data ? (
                        <>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.weekly} barGap={2} margin={{ top: 0, right: 4, left: 4, bottom: 0 }}>
                              <XAxis dataKey="week" tickFormatter={w => shortDate(w)} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={16} interval="preserveStartEnd" />
                              <Tooltip cursor={{ fill: 'hsl(var(--accent))' }} content={<WeekTooltip />} />
                              <Bar dataKey="completions" name="Completions" fill={COMPLETIONS} radius={[3, 3, 0, 0]} />
                              <Bar dataKey="enrollments" name="Enrollments" fill={ENROLLMENTS} radius={[3, 3, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                          {quietChart && (
                            <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[14px] text-muted-foreground">No enrollments or completions in the last 12 weeks</p>
                          )}
                        </>
                      ) : (
                        <div className="skeleton h-full w-full" />
                      )}
                    </div>
                  </Panel>
                </div>

                <div className="min-w-0 space-y-5">
                  <Panel
                    title="Upcoming sessions"
                    icon={<CalendarClock />}
                    action={
                      <Link to="/sessions" className="text-sm text-muted-foreground hover:text-foreground">
                        View all
                      </Link>
                    }
                  >
                    {!data ? (
                      <PanelLines lines={2} />
                    ) : data.sessions.length === 0 ? (
                      <div className="px-4 py-5 text-[14px]">
                        <p className="text-muted-foreground">Nothing scheduled.</p>
                        <button type="button" onClick={() => app.openCreateSession()} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] font-medium shadow-2xs hover:bg-accent">
                          <Plus className="h-3.5 w-3.5" /> Schedule a session
                        </button>
                      </div>
                    ) : (
                      <div className="divide-y">
                        {data.sessions.map(s => {
                          const d = s.startsAt ? new Date(s.startsAt) : null;
                          return (
                            <Link key={s.id} to={`/sessions/${s.id}`} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-accent/40">
                              <span className="flex h-10 w-10 flex-col items-center justify-center rounded-lg border bg-subtle leading-none">
                                <span className="text-[11px] font-medium uppercase text-muted-foreground">{d?.toLocaleDateString(undefined, { month: 'short' })}</span>
                                <span className="mt-0.5 text-[16px] font-semibold tabular-nums">{d?.getDate()}</span>
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-[14px] font-medium">{s.title}</span>
                                <span className="block truncate text-sm text-muted-foreground">
                                  {d?.toLocaleDateString(undefined, { weekday: 'short' })} {d?.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {s.location || 'Online'}
                                </span>
                              </span>
                              <Tip label={s.capacity ? `${s.registered} registered · ${s.capacity} seats` : `${s.registered} registered`} side="left">
                                <span className={cn('inline-flex items-center gap-1 text-sm tabular-nums', s.capacity && s.registered >= s.capacity ? 'text-tone-warning' : 'text-muted-foreground')}>
                                  <UsersRound className="h-3 w-3" />
                                  {s.registered}
                                  {s.capacity ? `/${s.capacity}` : ''}
                                </span>
                              </Tip>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </Panel>

                  <Panel title="Recently completed" icon={<Award />}>
                    {!data ? (
                      <PanelLines lines={3} />
                    ) : recent.length === 0 ? (
                      <p className="px-4 py-5 text-[14px] text-muted-foreground">Course and path completions will show up here.</p>
                    ) : (
                      <ol className="divide-y">
                        {recent.map(a => {
                          const title = a.courseId ? ws.courseById.get(a.courseId)?.title : a.pathId ? ws.pathById.get(a.pathId)?.title : null;
                          const certified = data.recent.some(x => x.type === 'certificate_issued' && x.personId === a.personId && (x.courseId ?? x.pathId) === (a.courseId ?? a.pathId));
                          return (
                            <li key={a.id}>
                              <Link to={a.personId ? `/people/${a.personId}` : '/people'} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2.5 px-4 py-2 text-[14px] hover:bg-accent/40">
                                <PersonAvatar person={{ name: a.personName, color: a.personColor }} size={20} className="mt-px" />
                                <span className="line-clamp-2">
                                  <span className="font-medium">{a.personName}</span> <span className="text-muted-foreground">completed {a.type === 'path_completed' ? 'the path ' : ''}</span>
                                  {title ?? (a.data.courseTitle as string) ?? (a.data.pathTitle as string) ?? 'a course'}
                                  {certified && (
                                    <>
                                      {'\u00a0'}
                                      <Award className="inline h-3 w-3 -translate-y-px text-flame" aria-label="Certificate issued" />
                                    </>
                                  )}
                                </span>
                                <span className="text-sm tabular-nums text-muted-foreground">{timeAgo(a.occurredAt).replace(' ago', '')}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </Panel>

                  {ws.courses.length === 0 && ws.isStaff && (
                    <button type="button" onClick={() => app.openCreateCourse()} className="flex w-full items-center gap-3 rounded-xl border border-dashed p-4 text-left hover:bg-accent/40">
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      <span className="text-[14px]">Create your first course</span>
                      <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AttentionRow({ to, icon, title, children, muted }: { to: string; icon: ReactNode; title: string; children?: ReactNode; muted?: boolean }) {
  return (
    <div className="px-4 py-3">
      <Link to={to} className="group flex items-center gap-2 text-[14px]">
        <span className="flex w-[18px] shrink-0 justify-center text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        <span className={cn('min-w-0 truncate font-medium', muted && 'font-normal text-muted-foreground')}>{title}</span>
        <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </Link>
      {children}
    </div>
  );
}
