import { ArrowRight, CheckCircle2, Compass, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { formatMinutes } from '@project/shared/lessons';
import { CourseCard, DateBlock, EnrollmentAction, EnrollmentRow, PathRow, SessionLine, WaitlistPill } from '../components/cards';
import { CertificateThumb, CourseCover, DueText, LessonIcon, LoadError, StatStrip } from '../components/kit';
import { Card, Container, EmptyState, LinkButton, ProgressBar, SectionHeading, Skeleton } from '../components/ui';
import { plural } from '../lib/format';
import { useHome, type Home, type MyEnrollment } from '../lib/learn';
import { certificateStateText, greeting, hoursText, sourceText } from '../lib/learnFormat';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function HomePage() {
  const home = useHome();
  useDocumentTitle('Home');

  if (home.isPending) return <HomeSkeleton />;
  if (home.isError) return <LoadError error={home.error} onRetry={() => home.refetch()} title="Your home page didn't load" />;
  return <HomeView data={home.data} />;
}

function statusLine(d: Home) {
  const { overdue, dueSoon, open } = d.counts;
  if (!open) return d.counts.completed ? 'You’re all caught up. Nothing is waiting on you.' : 'Nothing has been assigned to you yet.';
  const parts: string[] = [];
  if (dueSoon) parts.push(`${plural(dueSoon, 'thing')} due this week`);
  if (overdue) parts.push(`${overdue} overdue`);
  if (!parts.length) return `${plural(open, 'course')} on your list, and nothing due this week.`;
  return parts.join(' · ');
}

function HomeView({ data: d }: { data: Home }) {
  const urgent = d.todo.filter(e => e.dueState === 'overdue' || e.dueState === 'due_soon');
  const hero = d.continueLearning ?? d.todo.find(e => !e.lockedBy) ?? null;
  const upNext = urgent.length ? urgent : d.todo.filter(e => e.id !== hero?.id).slice(0, 4);
  const nothingAssigned = d.todo.length === 0 && d.paths.length === 0;

  return (
    <div>
      <section className="border-b bg-background">
        <Container className="flex items-end justify-between gap-10 pb-7 pt-8 sm:pb-9 sm:pt-11">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{format(new Date(), 'EEEE, MMMM d')}</p>
            <h1 className="mt-1 font-serif text-3xl font-semibold leading-tight sm:text-[40px]">
              {greeting()}, {d.firstName}
            </h1>
            <p className={cn('mt-2 text-[15px] sm:text-base', d.counts.overdue ? 'text-foreground' : 'text-muted-foreground')}>
              {d.counts.overdue > 0 && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-tone-danger align-middle" aria-hidden />}
              {statusLine(d)}
            </p>
          </div>
          <HeaderFigures d={d} />
        </Container>
      </section>

      <Container className="space-y-12 py-8 sm:py-10">
        {hero ? <ContinueHero e={hero} isContinue={Boolean(d.continueLearning)} /> : <NothingHero d={d} nothingAssigned={nothingAssigned} />}

        <Stats d={d} className="lg:hidden" />

        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
          <div className="min-w-0 space-y-12">
            {upNext.length > 0 && (
              <section aria-labelledby="todo-heading" className="animate-fade-up">
                <SectionHeading
                  id="todo-heading"
                  count={upNext.length}
                  action={
                    <Link to="/learning" className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                      All my learning
                    </Link>
                  }
                >
                  {urgent.length ? 'Due soon & overdue' : 'Up next'}
                </SectionHeading>
                <ul className="-mt-4 divide-y">
                  {upNext.map(e => (
                    <EnrollmentRow key={e.id} e={e} />
                  ))}
                </ul>
              </section>
            )}

            {d.paths.length > 0 && (
              <section aria-labelledby="paths-heading">
                <SectionHeading id="paths-heading" count={d.paths.length}>
                  Your learning paths
                </SectionHeading>
                <ul className="-mt-4 divide-y">
                  {d.paths.map(p => (
                    <PathRow key={p.id} p={p} />
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="min-w-0 space-y-12" aria-label="Sessions and certificates">
            <section aria-labelledby="sessions-heading">
              <SectionHeading
                id="sessions-heading"
                action={
                  <Link to="/sessions" className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                    All sessions
                  </Link>
                }
              >
                Upcoming live sessions
              </SectionHeading>
              {d.sessions.length ? (
                <ul className="space-y-5">
                  {d.sessions.map(s => (
                    <li key={s.id} className="flex gap-3.5">
                      <DateBlock iso={s.startsAt} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">
                          {s.course && s.lessonId ? (
                            <Link to={`/learn/${s.course.slug}/${s.lessonId}`} className="rounded hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                              {s.title}
                            </Link>
                          ) : (
                            s.title
                          )}
                        </p>
                        <SessionLine startsAt={s.startsAt} endsAt={s.endsAt} location={s.location} meetingUrl={s.meetingUrl} />
                        {s.registrationStatus === 'Waitlisted' && (
                          <div className="mt-1.5">
                            <WaitlistPill status={s.registrationStatus} />
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[15px]">
                  <p className="text-muted-foreground">You're not registered for any upcoming sessions.</p>
                  <Link to="/sessions" className="mt-2 inline-flex items-center gap-1 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                    Browse sessions <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </div>
              )}
            </section>

            <section aria-labelledby="certs-heading">
              <SectionHeading
                id="certs-heading"
                action={
                  d.certificates.length ? (
                    <Link to="/certificates" className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                      All certificates
                    </Link>
                  ) : undefined
                }
              >
                Recently earned
              </SectionHeading>
              {d.certificates.length ? (
                <ul className="-mx-2 space-y-1">
                  {d.certificates.map(c => (
                    <li key={c.id}>
                      <Link to={`/certificates/${c.id}`} className="group flex items-center gap-3.5 rounded-lg p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                        <CertificateThumb cert={c} org={d.org} className="w-[72px] shrink-0 shadow-xs" />
                        <div className="min-w-0">
                          <p className="truncate font-medium leading-snug">{c.title}</p>
                          <p className={cn('mt-0.5 text-sm', c.state === 'expiring' ? 'font-medium text-tone-warning' : c.state === 'revoked' ? 'text-tone-danger' : 'text-muted-foreground')}>{certificateStateText(c.state, c.expiresAt)}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[15px] text-muted-foreground">Finish a course that awards a certificate and it will appear here, ready to download or share.</p>
              )}
            </section>
          </aside>
        </div>

        {d.selfEnrollment && d.recommendations.length > 0 && (
          <section aria-labelledby="recs-heading">
            <SectionHeading
              id="recs-heading"
              action={
                <Link to="/catalog" className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                  Browse the catalog
                </Link>
              }
            >
              Recommended for you
            </SectionHeading>
            <ul className={cn('grid gap-5', d.recommendations.length === 1 ? 'sm:max-w-sm' : d.recommendations.length === 2 ? 'sm:grid-cols-2' : d.recommendations.length === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4')}>
              {d.recommendations.map(c => (
                <li key={c.id} className="flex">
                  <CourseCard course={c} className="w-full" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </Container>
    </div>
  );
}

function ContinueHero({ e, isContinue }: { e: MyEnrollment; isContinue: boolean }) {
  return (
    <section aria-labelledby="continue-heading" className="animate-fade-up">
      <Card className="overflow-hidden shadow-sm">
        <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Link to={`/courses/${e.course.slug}`} tabIndex={-1} aria-hidden className="block">
            <CourseCover coverImageUrl={e.course.coverImageUrl} title={e.course.title} color={e.course.color} width={900} rounded="rounded-none" className="h-full md:aspect-auto md:min-h-[260px]" />
          </Link>
          <div className="flex flex-col p-5 sm:p-7">
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-primary">{isContinue ? 'Continue learning' : e.status === 'In progress' ? 'Pick up where you left off' : 'Start here'}</p>
            <h2 id="continue-heading" className="mt-2 font-serif text-2xl font-semibold leading-tight sm:text-[28px]">
              <Link to={`/courses/${e.course.slug}`} className="rounded decoration-foreground/25 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                {e.course.title}
              </Link>
            </h2>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
              <span>{sourceText(e)}</span>
              {e.dueDate && e.dueState !== 'no_due' && (
                <>
                  <span aria-hidden className="hidden sm:inline">·</span>
                  <DueText dueDate={e.dueDate} dueState={e.dueState} className="w-full sm:w-auto" />
                </>
              )}
            </p>
            {e.nextLesson && (
              <div className="mt-5 flex items-center gap-3 rounded-lg border bg-subtle px-3.5 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background shadow-2xs">
                  <LessonIcon type={e.nextLesson.type} className="text-foreground" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{e.status === 'In progress' ? 'Next lesson' : 'First lesson'}</p>
                  <p className="truncate font-medium">{e.nextLesson.title}</p>
                </div>
              </div>
            )}
            <div className="mt-5 flex items-center gap-3">
              <ProgressBar value={e.progress / 100} label={`${e.course.title} progress`} />
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {e.lessonsDone} of {plural(e.lessonsTotal, 'lesson')} · {e.progress}%
              </span>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 md:mt-auto md:pt-6">
              <EnrollmentAction e={e} size="lg" className="w-full sm:w-auto" />
              {e.course.estimatedMinutes > 0 && <span className="text-sm text-muted-foreground">{formatMinutes(e.course.estimatedMinutes)} course</span>}
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}

function NothingHero({ d, nothingAssigned }: { d: Home; nothingAssigned: boolean }) {
  return (
    <Card className="animate-fade-up">
      <EmptyState
        icon={nothingAssigned ? Sparkles : CheckCircle2}
        title={nothingAssigned ? 'Your learning starts here' : 'You’re all caught up'}
        action={
          d.selfEnrollment ? (
            <LinkButton to="/catalog" size="lg">
              <Compass /> Explore the catalog
            </LinkButton>
          ) : d.counts.completed ? (
            <LinkButton to="/learning" variant="secondary">
              See what you've completed
            </LinkButton>
          ) : undefined
        }
      >
        {nothingAssigned
          ? d.selfEnrollment
            ? 'Nothing has been assigned to you yet. Browse the catalog and pick something that interests you — it only takes a click to start.'
            : 'Nothing has been assigned to you yet. When your team assigns training, it will show up here with its due date.'
          : d.selfEnrollment
            ? 'Every assigned course is done. Keep the momentum going with something from the catalog.'
            : 'Every assigned course is done. New training will show up here as soon as it’s assigned.'}
      </EmptyState>
    </Card>
  );
}

function statList(d: Home) {
  const s = d.stats;
  return [
    { value: s.streakDays, label: 'day streak', hint: s.streakDays ? (s.learnedToday ? 'You learned today' : 'Learn today to keep it going') : 'Finish a lesson to start one' },
    { value: s.points.toLocaleString(), label: 'points', hint: d.leaderboard ? 'See the leaderboard' : 'From lessons, quizzes and courses', to: d.leaderboard ? '/leaderboard' : undefined },
    { value: s.completedThisYear, label: s.completedThisYear === 1 ? 'course completed' : 'courses completed', hint: `In ${new Date().getFullYear()}` },
    { value: hoursText(s.learningMinutes), label: 'spent learning', hint: 'All time' },
  ];
}

function Stats({ d, className }: { d: Home; className?: string }) {
  return <StatStrip label="Your progress" stats={statList(d)} className={className} />;
}

/** The same figures, set quietly beside the greeting on wide screens. */
function HeaderFigures({ d }: { d: Home }) {
  return (
    <ul aria-label="Your progress" className="hidden shrink-0 divide-x lg:flex">
      {statList(d).map(st => {
        const inner = (
          <>
            <span className="block font-serif text-[28px] font-semibold leading-none tabular-nums">{st.value}</span>
            <span className="mt-2 block whitespace-nowrap text-sm text-muted-foreground">{st.label}</span>
          </>
        );
        return (
          <li key={st.label} className="px-6 first:pl-0 last:pr-0" title={st.hint}>
            {st.to ? (
              <Link to={st.to} className="block rounded decoration-foreground/25 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading your home page">
      <div className="border-b bg-background">
        <Container className="pb-8 pt-10">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-10 w-80 max-w-full" />
          <Skeleton className="mt-3 h-5 w-64 max-w-full" />
        </Container>
      </div>
      <Container className="space-y-10 py-10">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-[98px] rounded-xl lg:hidden" />
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-60 rounded-xl" />
        </div>
      </Container>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
