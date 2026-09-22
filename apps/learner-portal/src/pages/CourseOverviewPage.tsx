import { Archive, ArrowRight, Award, BarChart3, Check, CheckCircle2, ChevronDown, Clock, ListChecks, Lock, UserRoundCheck, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@project/components/lib/utils';
import { formatMinutes } from '@project/shared/lessons';
import { Markdown } from '@project/shared/ui/Markdown';
import { DateBlock, SessionLine } from '../components/cards';
import { BarText, DetailBody, DetailHeader, DetailSkeleton, DueValue, Fact, Facts, MetaItem, Panel, PanelNote } from '../components/catalog/Detail';
import { Avatar, CourseCover, CourseGlyph, LessonIcon, LoadError, RatingText, Stars } from '../components/kit';
import { SessionActions } from '../components/sessions';
import { Button, LinkButton, ProgressBar, SectionHeading, StatusPill } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { plural, shortDate } from '../lib/format';
import { useCourseOverview, useEnrollSelf, type CourseOverview } from '../lib/learn';
import { qk } from '../lib/queries';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Mine = NonNullable<CourseOverview['mine']>;

export function CourseOverviewPage() {
  const { slug } = useParams();
  const q = useCourseOverview(slug);
  useDocumentTitle(q.data?.course.title ?? (q.isError ? 'Course not found' : null));

  if (q.isPending) return <DetailSkeleton />;
  if (q.isError)
    return (
      <LoadError
        error={q.error}
        onRetry={() => q.refetch()}
        title="This course didn't load"
        notFoundTitle="We couldn't find that course"
        notFoundBody="It may have been unpublished, or it may be a course that's only open to people it's assigned to."
        action={
          <>
            <LinkButton to="/catalog" variant="secondary">
              Browse the catalog
            </LinkButton>
            <LinkButton to="/learning">Go to my learning</LinkButton>
          </>
        }
      />
    );
  return <Overview key={q.data.course.id} data={q.data} />;
}

/** Enrolling, shared by the panel and the phone bar so both show the same pending state. */
function useCourseEnroll(d: CourseOverview) {
  const enroll = useEnrollSelf();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const run = () =>
    enroll.mutate(
      { courseId: d.course.id },
      {
        onSuccess: () => toast.success(`You're enrolled in ${d.course.title}.`, { description: 'It’s in My learning whenever you want to pick it up.', action: { label: 'Start now', onClick: () => navigate(`/learn/${d.course.slug}`) } }),
        onError: e => {
          toast.error(errorMessage(e, "You couldn't be enrolled. Try again in a moment."));
          // The refusal usually means something changed (enrollment closed, course archived): show the page as it is now.
          void qc.invalidateQueries({ queryKey: qk.courseRoot });
          void qc.invalidateQueries({ queryKey: qk.me });
        },
      },
    );
  return { run, pending: enroll.isPending };
}

function Overview({ data: d }: { data: CourseOverview }) {
  const c = d.course;
  const lessonCount = d.sections.reduce((n, s) => n + s.lessons.length, 0);
  const enroll = useCourseEnroll(d);
  // Fixed when the page opens, so enrolling doesn't change where "back" goes.
  const [back] = useState(() => (d.mine ? { to: '/learning', label: 'My learning' } : { to: '/catalog', label: 'Catalog' }));

  return (
    <div>
      <DetailHeader
        back={back}
        eyebrow={c.category?.name}
        badges={
          c.status === 'Archived' ? (
            <StatusPill tone="neutral" dot={false} className="h-6">
              Archived
            </StatusPill>
          ) : null
        }
        title={c.title}
        summary={c.summary}
        cover={<CourseCover coverImageUrl={c.coverImageUrl} title={c.title} color={c.color} width={760} rounded="rounded-xl" className="border shadow-xs" />}
        meta={
          <>
            <MetaItem icon={BarChart3}>{c.level}</MetaItem>
            <MetaItem icon={Clock}>{formatMinutes(c.estimatedMinutes)}</MetaItem>
            <MetaItem icon={ListChecks}>{plural(lessonCount, 'lesson')}</MetaItem>
            {d.rating.average ? (
              <li>
                <button
                  type="button"
                  onClick={() => document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="rounded hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                  aria-label={`Rated ${d.rating.average.toFixed(1)} out of 5 by ${plural(d.rating.count, 'learner')}. Jump to reviews`}
                >
                  <RatingText average={d.rating.average} count={d.rating.count} />
                </button>
              </li>
            ) : null}
            {c.certificateEnabled && (
              <MetaItem icon={Award} iconClassName="text-tone-warning">
                Certificate
              </MetaItem>
            )}
            {c.enrolledCount > 1 && <MetaItem icon={Users}>{plural(c.enrolledCount, 'learner')}</MetaItem>}
          </>
        }
      />

      <DetailBody panelLabel="Your enrollment" panel={wide => <CoursePanel d={d} enroll={enroll} wide={wide} />} bar={courseBar(d, enroll)}>
        {c.objectives.length > 0 && (
          <section aria-labelledby="learn-heading">
            <SectionHeading id="learn-heading">What you'll learn</SectionHeading>
            <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
              {c.objectives.map(o => (
                <li key={o} className="flex gap-3 text-[15px] leading-relaxed">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
            {c.skills.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-sm text-muted-foreground">Skills</span>
                <ul className="contents" aria-label="Skills">
                  {c.skills.map(s => (
                    <li key={s} className="chip-soft">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {c.description && (
          <section aria-labelledby="about-heading">
            <SectionHeading id="about-heading">About this course</SectionHeading>
            <Markdown>{c.description}</Markdown>
          </section>
        )}

        <Curriculum d={d} />

        {d.sessions.length > 0 && (
          <section aria-labelledby="course-sessions-heading">
            <SectionHeading id="course-sessions-heading" count={d.sessions.length}>
              Upcoming live sessions
            </SectionHeading>
            <ul className="-mt-4 divide-y">
              {d.sessions.map(s => (
                <li key={s.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 py-4 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-center">
                  <DateBlock iso={s.startsAt} className="self-start" />
                  <div className="min-w-0 self-start">
                    <p className="font-medium leading-snug">{s.title}</p>
                    <SessionLine startsAt={s.startsAt} endsAt={s.endsAt} location={s.location} meetingUrl={s.meetingUrl}>
                      {s.registrationStatus === 'Registered' ? (
                        <span className="font-medium text-tone-success">You’re registered</span>
                      ) : s.spotsLeft != null && !s.registrationStatus ? (
                        <span className={cn(s.spotsLeft <= 3 && 'font-medium text-tone-warning')}>{s.spotsLeft === 0 ? 'Full · waitlist open' : `${plural(s.spotsLeft, 'seat')} left`}</span>
                      ) : null}
                    </SessionLine>
                  </div>
                  <div className="col-start-2 mt-3 sm:col-start-3 sm:mt-0 sm:pl-4">
                    <SessionActions s={{ ...s, course: { id: c.id, title: c.title, slug: c.slug } }} enrolled={Boolean(d.mine)} canEnroll={d.canSelfEnroll} variant={d.mine ? 'primary' : 'secondary'} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {d.instructors.length > 0 && (
          <section aria-labelledby="instructors-heading">
            <SectionHeading id="instructors-heading">{d.instructors.length === 1 ? 'Your instructor' : 'Your instructors'}</SectionHeading>
            <ul className="-mt-4 divide-y">
              {d.instructors.map(p => (
                <li key={p.id} className="flex gap-4 py-4">
                  <Avatar name={p.name} color={p.color} avatarUrl={p.avatarUrl} size={44} />
                  <div className="min-w-0">
                    <p className="font-medium leading-snug">{p.name}</p>
                    {p.title && <p className="text-sm text-muted-foreground">{p.title}</p>}
                    {p.bio && <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-foreground/85">{p.bio}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Reviews d={d} />

        {d.paths.length > 0 && (
          <section aria-labelledby="in-paths-heading">
            <SectionHeading id="in-paths-heading">{d.paths.length === 1 ? 'Part of a learning path' : 'Part of these learning paths'}</SectionHeading>
            <ul className="-mt-4 divide-y">
              {d.paths.map(p => (
                <li key={p.id}>
                  <Link to={`/paths/${p.slug}`} className="group -mx-2 flex items-center gap-4 rounded-lg px-2 py-4 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                    <CourseGlyph coverImageUrl={p.coverImageUrl} title={p.title} color={p.color} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-snug">{p.title}</span>
                      <span className="block text-sm text-muted-foreground">
                        Learning path · {plural(p.courseCount, 'course')}
                        {p.sequential && p.courseCount > 1 ? ' · Taken in order' : ''}
                        {p.myStatus === 'Completed' ? ' · Completed' : p.myStatus ? ' · You’re enrolled' : ''}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </DetailBody>
    </div>
  );
}

type Enroll = ReturnType<typeof useCourseEnroll>;

/** How the learner came to have this course, as a label and a value. */
function SourceFact({ m }: { m: Mine }) {
  if (m.path && m.source !== 'Self-enrolled')
    return (
      <Fact label="Part of">
        <Link to={`/paths/${m.path.slug}`} className="rounded font-medium underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
          {m.path.title}
        </Link>
      </Fact>
    );
  if (m.source === 'Self-enrolled') return <Fact label="Enrolled">{m.enrolledAt ? `By you, ${shortDate(m.enrolledAt)}` : 'By you'}</Fact>;
  if (m.source === 'Automatic') return <Fact label="Enrollment">Required training</Fact>;
  return <Fact label="Assigned by">{m.assignedByName ?? 'Your team'}</Fact>;
}

/** Where the learner stands and what to do next. */
function CoursePanel({ d, enroll, wide }: { d: CourseOverview; enroll: Enroll; wide: boolean }) {
  const c = d.course;
  const m = d.mine;
  const archived = c.status === 'Archived';
  const certificateNote = (
    <PanelNote icon={Award} title="Earns a certificate">
      Finish every required lesson to earn it{c.certificateValidityMonths ? `. It’s valid for ${plural(c.certificateValidityMonths, 'month')}` : ''}.
    </PanelNote>
  );

  if (!m) {
    return (
      <Panel wide={wide} side={c.certificateEnabled ? certificateNote : null}>
        {d.canSelfEnroll ? (
          // With nothing beside it on a tablet, the button sits at the end of a row rather than stretching across.
          <div className={cn(wide && !(c.certificateEnabled) && 'md:flex md:flex-row-reverse md:items-center md:justify-between md:gap-6')}>
            <Button size="lg" className={cn('w-full', wide && !(c.certificateEnabled) && 'md:w-auto md:px-8')} loading={enroll.pending} onClick={enroll.run}>
              Enroll in this course
            </Button>
            <p className={cn('mt-2.5 text-center text-sm text-muted-foreground', wide && !(c.certificateEnabled) && 'md:mt-0 md:text-left')}>No due date. Learn at your own pace.</p>
          </div>
        ) : (
          <PanelNote icon={UserRoundCheck} title="Your team assigns this course">
            Enrolling yourself is turned off. Ask your manager or the learning team if you’d like to take it.
          </PanelNote>
        )}
      </Panel>
    );
  }

  const done = m.status === 'Completed';
  return (
    <Panel
      wide={wide}
      side={
        <>
          <Facts>
            <SourceFact m={m} />
            {m.dueDate && !done && (
              <Fact label="Due">
                <DueValue dueDate={m.dueDate} dueState={m.dueState} />
              </Fact>
            )}
            {m.score != null && <Fact label="Quiz score">{Math.round(m.score)}%</Fact>}
            {m.cycle > 1 && <Fact label="Cycle">Recertification {m.cycle}</Fact>}
            {m.rating ? (
              <Fact label="Your rating">
                <Stars value={m.rating} size={14} className="align-[-2px]" />
              </Fact>
            ) : null}
          </Facts>
          {c.certificateEnabled && !done && certificateNote}
        </>
      }
    >
      {archived && (
        <PanelNote icon={Archive} className="mb-4 border-b pb-4" title="This course is archived">
          {done ? 'You can still review it, but it won’t be updated.' : 'You can still finish it, but it won’t be updated.'}
        </PanelNote>
      )}

      {m.lockedBy ? (
        <>
          <PanelNote icon={Lock} title={`Opens after ${m.lockedBy}`}>
            {m.path ? `${m.path.title} is taken in order.` : 'Finish the course before it first.'}
          </PanelNote>
          {m.path && (
            <LinkButton to={`/paths/${m.path.slug}`} variant="secondary" size="lg" className="mt-4 w-full">
              Go to {m.path.title}
            </LinkButton>
          )}
        </>
      ) : done ? (
        <>
          <p className="flex items-center gap-2 text-[15px] font-medium">
            <CheckCircle2 className="h-5 w-5 text-tone-success" aria-hidden />
            Completed{m.completedAt ? ` ${shortDate(m.completedAt)}` : ''}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {m.certificateId && (
              <LinkButton to={`/certificates/${m.certificateId}`} size="lg" className="w-full">
                <Award /> View certificate
              </LinkButton>
            )}
            <LinkButton to={`/learn/${c.slug}`} size="lg" variant={m.certificateId ? 'secondary' : 'primary'} className="w-full">
              Review course
            </LinkButton>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{m.progress > 0 ? `${m.progress}% complete` : m.status === 'In progress' ? 'Started' : 'Not started'}</span>
            <span className="tabular-nums text-muted-foreground">
              {m.lessonsDone} of {plural(m.lessonsTotal, 'lesson')}
            </span>
          </div>
          <ProgressBar value={m.progress / 100} className="mt-2 h-1.5" label="Your progress" />
          <LinkButton to={`/learn/${c.slug}`} size="lg" className="mt-4 w-full">
            {m.status === 'In progress' ? 'Resume' : 'Start course'} <ArrowRight />
          </LinkButton>
          {m.nextLesson && (
            <p className="mt-2.5 flex min-w-0 items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <LessonIcon type={m.nextLesson.type} className="h-3.5 w-3.5" />
              <span className="truncate">
                {m.status === 'In progress' ? 'Next' : 'Starts with'}: <span className="text-foreground/85">{m.nextLesson.title}</span>
              </span>
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/** The phone bar: the panel’s main action in one row, or nothing when there is no action. */
function courseBar(d: CourseOverview, enroll: Enroll): ReactNode {
  const c = d.course;
  const m = d.mine;
  if (!m) {
    if (!d.canSelfEnroll) return null;
    return (
      <>
        <BarText label="No due date" value={c.title} />
        <Button size="lg" loading={enroll.pending} onClick={enroll.run} className="shrink-0">
          Enroll
        </Button>
      </>
    );
  }
  if (m.lockedBy) {
    return (
      <>
        <BarText label="Locked" value={`Finish ${m.lockedBy} first`} />
        {m.path && (
          <LinkButton to={`/paths/${m.path.slug}`} variant="secondary" size="lg" className="shrink-0">
            View path
          </LinkButton>
        )}
      </>
    );
  }
  if (m.status === 'Completed') {
    return (
      <>
        <BarText label="Completed" value={m.completedAt ? shortDate(m.completedAt) : c.title} />
        {m.certificateId ? (
          <LinkButton to={`/certificates/${m.certificateId}`} size="lg" className="shrink-0">
            <Award /> Certificate
          </LinkButton>
        ) : (
          <LinkButton to={`/learn/${c.slug}`} variant="secondary" size="lg" className="shrink-0">
            Review
          </LinkButton>
        )}
      </>
    );
  }
  const started = m.status === 'In progress';
  return (
    <>
      <BarText label={started ? `${m.progress}% complete · Next` : 'Starts with'} value={m.nextLesson?.title ?? c.title} />
      <LinkButton to={`/learn/${c.slug}`} size="lg" className="shrink-0">
        {started ? 'Resume' : 'Start'} <ArrowRight />
      </LinkButton>
    </>
  );
}

function Curriculum({ d }: { d: CourseOverview }) {
  const keyOf = (s: CourseOverview['sections'][number], i: number) => s.id ?? `loose-${i}`;
  const [closed, setClosed] = useState<Set<string>>(() => new Set(d.sections.length > 4 ? d.sections.slice(2).map((s, i) => keyOf(s, i + 2)) : []));
  const total = d.sections.reduce((n, s) => n + s.lessons.length, 0);
  const minutes = d.sections.reduce((n, s) => n + s.lessons.reduce((m, l) => m + l.durationMinutes, 0), 0);
  const m = d.mine;
  const enrolled = Boolean(m);
  const upNext = m && m.status !== 'Completed' && !m.lockedBy ? m.resumeLessonId : null;
  const toggle = (key: string) =>
    setClosed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allOpen = closed.size === 0;

  return (
    <section aria-labelledby="curriculum-heading">
      <SectionHeading
        id="curriculum-heading"
        action={
          d.sections.length > 1 ? (
            <button type="button" onClick={() => setClosed(allOpen ? new Set(d.sections.map(keyOf)) : new Set())} className="shrink-0 rounded text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          ) : undefined
        }
      >
        Curriculum
      </SectionHeading>
      <p className="-mt-1 text-sm text-muted-foreground">
        {d.sections.length > 1 ? `${plural(d.sections.length, 'section')} · ` : ''}
        {plural(total, 'lesson')} · {formatMinutes(minutes)}
        {d.course.sequential ? ' · Lessons open in order' : ''}
      </p>
      {total === 0 ? (
        <p className="mt-4 rounded-xl border bg-card p-6 text-[15px] text-muted-foreground">Lessons are still being added to this course.</p>
      ) : (
        <div className="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
          {d.sections.map((s, i) => {
            const key = keyOf(s, i);
            const open = !closed.has(key);
            const doneCount = s.lessons.filter(l => l.done).length;
            const sectionMinutes = s.lessons.reduce((n, l) => n + l.durationMinutes, 0);
            const panelId = `section-${key}`;
            return (
              <div key={key}>
                <h3>
                  <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => toggle(key)} className="flex w-full items-center gap-3 bg-subtle px-4 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35 sm:px-5">
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', !open && '-rotate-90')} aria-hidden />
                    <span className="min-w-0 flex-1 font-medium">{s.title || 'Getting started'}</span>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {enrolled ? `${doneCount} of ${s.lessons.length} done` : `${plural(s.lessons.length, 'lesson')} · ${formatMinutes(sectionMinutes)}`}
                    </span>
                  </button>
                </h3>
                {open && (
                  <ol id={panelId} className="divide-y">
                    {s.lessons.map(l => {
                      const linkable = enrolled && !l.locked && !m?.lockedBy;
                      const next = l.id === upNext;
                      const inner = (
                        <>
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                            {l.done ? <CheckCircle2 className="h-[18px] w-[18px] text-tone-success" aria-hidden /> : <LessonIcon type={l.type} locked={l.locked || Boolean(m?.lockedBy)} className={cn('h-4 w-4', next && 'text-primary')} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn('block text-[15px] leading-snug', (l.locked || m?.lockedBy) && !l.done && 'text-muted-foreground', next && 'font-medium')}>
                              {l.title}
                              {next && <span className="ml-2 text-xs font-medium text-primary">Up next</span>}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground sm:hidden">
                              {l.type}
                              {l.durationMinutes > 0 ? ` · ${formatMinutes(l.durationMinutes)}` : ''}
                              {l.optional ? ' · Optional' : ''}
                            </span>
                            <span className="sr-only">{l.done ? ', completed' : l.locked || m?.lockedBy ? ', locked' : ''}</span>
                          </span>
                          <span className="hidden shrink-0 text-sm tabular-nums text-muted-foreground sm:block">
                            {l.optional ? 'Optional · ' : ''}
                            {l.type}
                            {l.durationMinutes > 0 ? ` · ${formatMinutes(l.durationMinutes)}` : ''}
                          </span>
                        </>
                      );
                      return (
                        <li key={l.id}>
                          {linkable ? (
                            <Link to={`/learn/${d.course.slug}/${l.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35 sm:px-5">
                              {inner}
                            </Link>
                          ) : (
                            <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{inner}</div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Reviews({ d }: { d: CourseOverview }) {
  if (!d.rating.count) return null;
  const max = Math.max(1, ...d.rating.distribution);
  return (
    <section aria-labelledby="reviews-heading" id="reviews" className="scroll-mt-24">
      <SectionHeading id="reviews-heading">What learners say</SectionHeading>
      <div className="grid gap-6 sm:grid-cols-[168px_minmax(0,1fr)] sm:items-center">
        <div className="flex items-center gap-4 sm:block">
          <p className="font-serif text-5xl font-semibold leading-none tabular-nums">{d.rating.average?.toFixed(1)}</p>
          <div>
            <Stars value={d.rating.average} size={16} className="sm:mt-2.5" />
            <p className="mt-1 text-sm text-muted-foreground">{plural(d.rating.count, 'rating')}</p>
          </div>
        </div>
        <ul className="max-w-md space-y-1.5" aria-label="Ratings breakdown">
          {d.rating.distribution.map((n, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{5 - i} star</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-foreground/55" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{n}</span>
              <span className="sr-only">{plural(n, 'rating')}</span>
            </li>
          ))}
        </ul>
      </div>
      {d.reviews.length > 0 && (
        <ul className="mt-6 divide-y border-t">
          {d.reviews.map(r => (
            <li key={r.id} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3.5 py-4">
              <Avatar name={r.name} color={r.color} size={32} />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  <span className="font-medium">{r.name}</span>
                  <Stars value={r.rating} size={12} />
                  {r.ratedAt && <span className="text-muted-foreground">{shortDate(r.ratedAt)}</span>}
                </p>
                <p className="mt-1 text-[15px] leading-relaxed text-foreground/90">{r.review}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
