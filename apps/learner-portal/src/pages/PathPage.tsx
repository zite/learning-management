import { ArrowRight, Award, Check, CheckCircle2, Clock, Layers, ListOrdered, Lock, UserRoundCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@project/components/lib/utils';
import { formatMinutes } from '@project/shared/lessons';
import { Markdown } from '@project/shared/ui/Markdown';
import { BarText, DetailBody, DetailHeader, DetailSkeleton, DueValue, Fact, Facts, MetaItem, Panel, PanelNote } from '../components/catalog/Detail';
import { CourseCover, CourseGlyph, LoadError } from '../components/kit';
import { Button, LinkButton, ProgressBar, SectionHeading } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { plural, shortDate } from '../lib/format';
import { useEnrollSelf, usePath, type PathDetail, type PathStep } from '../lib/learn';
import { qk } from '../lib/queries';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Mine = NonNullable<PathDetail['mine']>;

export function PathPage() {
  const { slug } = useParams();
  const q = usePath(slug);
  useDocumentTitle(q.data?.path.title ?? (q.isError ? 'Learning path not found' : null));
  if (q.isPending) return <DetailSkeleton />;
  if (q.isError)
    return (
      <LoadError
        error={q.error}
        onRetry={() => q.refetch()}
        title="This learning path didn't load"
        notFoundTitle="We couldn't find that learning path"
        notFoundBody="It may have been unpublished, or it may be a path that's only open to people it's assigned to."
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
  return <PathView key={q.data.path.id} d={q.data} />;
}

function usePathEnroll(d: PathDetail) {
  const enroll = useEnrollSelf();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const first = d.steps.find(s => !s.optional) ?? d.steps[0];
  const run = () =>
    enroll.mutate(
      { pathId: d.path.id },
      {
        onSuccess: () =>
          toast.success(`You're enrolled in ${d.path.title}.`, {
            description: d.path.sequential ? `Start with ${first?.title ?? 'the first course'}.` : 'Take the courses in any order.',
            action: first ? { label: 'Start now', onClick: () => navigate(`/learn/${first.slug}`) } : undefined,
          }),
        onError: e => {
          toast.error(errorMessage(e, "You couldn't be enrolled. Try again in a moment."));
          // The refusal usually means something changed (enrollment closed, path unpublished): show the page as it is now.
          void qc.invalidateQueries({ queryKey: qk.pathRoot });
          void qc.invalidateQueries({ queryKey: qk.me });
        },
      },
    );
  return { run, pending: enroll.isPending };
}

type Enroll = ReturnType<typeof usePathEnroll>;

function PathView({ d }: { d: PathDetail }) {
  const p = d.path;
  const m = d.mine;
  const enroll = usePathEnroll(d);
  const required = d.steps.filter(s => !s.optional).length;
  const optional = d.steps.length - required;
  // Fixed when the page opens, so enrolling doesn't change where "back" goes.
  const [back] = useState(() => (m ? { to: '/learning', label: 'My learning' } : { to: '/catalog', label: 'Catalog' }));

  return (
    <div>
      <DetailHeader
        back={back}
        eyebrow={
          <>
            <Layers className="h-3.5 w-3.5" aria-hidden /> Learning path{p.category ? ` · ${p.category.name}` : ''}
          </>
        }
        title={p.title}
        summary={p.summary}
        cover={<CourseCover coverImageUrl={p.coverImageUrl} title={p.title} color={p.color} width={760} rounded="rounded-xl" className="border shadow-xs" />}
        meta={
          <>
            <MetaItem icon={Layers}>{plural(d.steps.length, 'course')}</MetaItem>
            <MetaItem icon={Clock}>{formatMinutes(p.totalMinutes)}</MetaItem>
            {p.sequential && d.steps.length > 1 && <MetaItem icon={ListOrdered}>Taken in order</MetaItem>}
            {p.certificateEnabled && (
              <MetaItem icon={Award} iconClassName="text-tone-warning">
                Certificate
              </MetaItem>
            )}
          </>
        }
      />

      <DetailBody panelLabel="Your progress" panel={wide => <PathPanel d={d} enroll={enroll} wide={wide} />} bar={pathBar(d, enroll)}>
        {p.description && (
          <section aria-labelledby="about-path-heading">
            <SectionHeading id="about-path-heading">About this path</SectionHeading>
            <Markdown>{p.description}</Markdown>
          </section>
        )}

        <section aria-labelledby="steps-heading">
          <SectionHeading id="steps-heading" count={d.steps.length}>
            Courses
          </SectionHeading>
          {d.steps.length > 0 && (
            <p className="-mt-1 text-sm text-muted-foreground">
              {p.sequential && d.steps.length > 1 ? 'Each course opens when you finish the one before it.' : 'Take the courses in any order.'}
              {optional > 0 ? ` ${plural(required, 'course')} ${required === 1 ? 'is' : 'are'} required; optional ones never hold you up.` : ''}
            </p>
          )}

          {d.steps.length === 0 ? (
            <p className="mt-4 rounded-xl border bg-card p-6 text-[15px] text-muted-foreground">Courses are still being added to this path.</p>
          ) : (
            <ol className="mt-6">
              {d.steps.map((s, i) => (
                <Step key={s.courseId} s={s} index={i} last={i === d.steps.length - 1} current={Boolean(m && m.status !== 'Completed' && m.nextCourse?.id === s.courseId)} enrolled={Boolean(m)} />
              ))}
            </ol>
          )}
        </section>
      </DetailBody>
    </div>
  );
}

function SourceFact({ m }: { m: Mine }) {
  if (m.source === 'Self-enrolled') return <Fact label="Enrolled">{m.enrolledAt ? `By you, ${shortDate(m.enrolledAt)}` : 'By you'}</Fact>;
  if (m.source === 'Automatic') return <Fact label="Enrollment">Required training</Fact>;
  return <Fact label="Assigned by">{m.assignedByName ?? 'Your team'}</Fact>;
}

/** One segment per course, filled from the left — done, up next, still to do (optional ones fainter) — so it reads as a bar whatever order they were taken in. */
function Segments({ steps, nextId, className }: { steps: PathStep[]; nextId: string | null; className?: string }) {
  const rank = (s: PathStep) => (s.status === 'Completed' ? 0 : s.courseId === nextId ? 1 : 2);
  const ordered = [...steps].sort((a, b) => rank(a) - rank(b));
  return (
    <ol className={cn('flex items-center gap-1', className)} aria-hidden>
      {ordered.map(s => (
        <li key={s.courseId} className="flex-1">
          <span className={cn('block h-1.5 rounded-full', s.status === 'Completed' ? 'bg-primary' : s.courseId === nextId ? 'bg-primary/35' : 'bg-muted', s.optional && s.status !== 'Completed' && 'opacity-60')} />
        </li>
      ))}
    </ol>
  );
}

function certificateText(d: PathDetail) {
  const required = d.steps.filter(s => !s.optional).length;
  const what = required === d.steps.length ? 'every course' : `all ${plural(required, 'required course')}`;
  return `Finish ${what} to earn it${d.path.certificateValidityMonths ? `. It’s valid for ${plural(d.path.certificateValidityMonths, 'month')}` : ''}.`;
}

function PathPanel({ d, enroll, wide }: { d: PathDetail; enroll: Enroll; wide: boolean }) {
  const m = d.mine;
  const p = d.path;
  const certificateNote = (
    <PanelNote icon={Award} title="Earns a certificate">
      {certificateText(d)}
    </PanelNote>
  );

  if (!m) {
    return (
      <Panel wide={wide} side={p.certificateEnabled && d.steps.length > 0 ? certificateNote : null}>
        {d.canSelfEnroll ? (
          // With nothing beside it on a tablet, the button sits at the end of a row rather than stretching across.
          <div className={cn(wide && !(p.certificateEnabled && d.steps.length > 0) && 'md:flex md:flex-row-reverse md:items-center md:justify-between md:gap-6')}>
            <Button size="lg" className={cn('w-full', wide && !(p.certificateEnabled && d.steps.length > 0) && 'md:w-auto md:px-8')} loading={enroll.pending} onClick={enroll.run}>
              Enroll in this path
            </Button>
            <p className={cn('mt-2.5 text-center text-sm text-muted-foreground', wide && !(p.certificateEnabled && d.steps.length > 0) && 'md:mt-0 md:text-left')}>No due date. Take the courses at your own pace.</p>
          </div>
        ) : d.selfEnrollment && d.steps.length === 0 ? (
          <PanelNote icon={Layers} title="Not open yet">
            Courses are still being added to this path.
          </PanelNote>
        ) : (
          <PanelNote icon={UserRoundCheck} title="Your team assigns this path">
            Enrolling yourself is turned off. Ask your manager or the learning team if you’d like to take it.
          </PanelNote>
        )}
      </Panel>
    );
  }

  const done = m.status === 'Completed';
  const next = m.nextCourse ? (d.steps.find(s => s.courseId === m.nextCourse!.id) ?? null) : null;
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
            {m.cycle > 1 && <Fact label="Cycle">Recertification {m.cycle}</Fact>}
          </Facts>
          {p.certificateEnabled && !done && certificateNote}
        </>
      }
    >
      {done ? (
        <>
          <p className="flex items-center gap-2 text-[15px] font-medium">
            <CheckCircle2 className="h-5 w-5 text-tone-success" aria-hidden />
            Completed{m.completedAt ? ` ${shortDate(m.completedAt)}` : ''}
          </p>
          {m.certificateId && (
            <LinkButton to={`/certificates/${m.certificateId}`} size="lg" className="mt-4 w-full">
              <Award /> View certificate
            </LinkButton>
          )}
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">
              {m.done} of {plural(m.total, 'course')} done
            </span>
            <span className="tabular-nums text-muted-foreground">{m.progress}%</span>
          </div>
          <Segments steps={d.steps} nextId={next?.courseId ?? null} className="mt-2" />
          <span className="sr-only">
            {m.progress}% of {p.title} complete
          </span>
          {next ? (
            <>
              <LinkButton to={next.status ? `/learn/${next.slug}` : `/courses/${next.slug}`} size="lg" className="mt-4 w-full">
                {next.status === 'In progress' ? 'Resume' : next.status ? 'Start next course' : 'View next course'} <ArrowRight />
              </LinkButton>
              <p className="mt-2.5 truncate text-center text-sm text-muted-foreground">
                {next.status === 'In progress' ? 'Continue' : 'Next'}: <span className="text-foreground/85">{next.title}</span>
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Nothing to start right now. Your progress updates as each course is marked complete.</p>
          )}
        </>
      )}
    </Panel>
  );
}

function pathBar(d: PathDetail, enroll: Enroll): ReactNode {
  const m = d.mine;
  if (!m) {
    if (!d.canSelfEnroll) return null;
    return (
      <>
        <BarText label={plural(d.steps.length, 'course')} value={d.path.title} />
        <Button size="lg" loading={enroll.pending} onClick={enroll.run} className="shrink-0">
          Enroll
        </Button>
      </>
    );
  }
  if (m.status === 'Completed') {
    if (!m.certificateId) return null;
    return (
      <>
        <BarText label="Completed" value={m.completedAt ? shortDate(m.completedAt) : d.path.title} />
        <LinkButton to={`/certificates/${m.certificateId}`} size="lg" className="shrink-0">
          <Award /> Certificate
        </LinkButton>
      </>
    );
  }
  const next = m.nextCourse ? d.steps.find(s => s.courseId === m.nextCourse!.id) : null;
  if (!next) return null;
  return (
    <>
      <BarText label={`${m.done} of ${plural(m.total, 'course')} done · Next`} value={next.title} />
      <LinkButton to={next.status ? `/learn/${next.slug}` : `/courses/${next.slug}`} size="lg" className="shrink-0">
        {next.status === 'In progress' ? 'Resume' : next.status ? 'Start' : 'View'} <ArrowRight />
      </LinkButton>
    </>
  );
}

function Step({ s, index, last, current, enrolled }: { s: PathStep; index: number; last: boolean; current: boolean; enrolled: boolean }) {
  const done = s.status === 'Completed';
  // Locks only apply inside an enrollment in the path.
  const locked = enrolled && s.locked && !done;
  const c = s.course;
  const action = !locked && s.status ? (
    done ? (
      <LinkButton to={`/learn/${c.slug}`} variant="secondary" size="sm" aria-label={`Review ${c.title}`}>
        Review
      </LinkButton>
    ) : (
      <LinkButton to={`/learn/${c.slug}`} variant={current ? 'primary' : 'secondary'} size="sm" aria-label={`${s.status === 'In progress' ? 'Resume' : 'Start'} ${c.title}`}>
        {s.status === 'In progress' ? 'Resume' : 'Start'} <ArrowRight />
      </LinkButton>
    )
  ) : null;

  return (
    <li className={cn('relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 sm:grid-cols-[28px_56px_minmax(0,1fr)_auto] sm:items-center sm:gap-x-5', !last && 'pb-7')}>
      {!last && <span className={cn('absolute bottom-1 left-[13.5px] top-[34px] w-px sm:top-12', done ? 'bg-tone-success/50' : 'bg-border')} aria-hidden />}
      <span
        className={cn(
          'relative flex h-7 w-7 items-center justify-center self-start rounded-full text-xs font-semibold tabular-nums sm:mt-3.5',
          done ? 'bg-tone-success text-white dark:text-[hsl(240_10%_6%)]' : current ? 'border-2 border-primary bg-background text-primary' : locked ? 'border bg-muted text-muted-foreground' : 'border bg-background text-foreground/80',
        )}
        aria-hidden
      >
        {done ? <Check className="h-4 w-4" strokeWidth={2.6} /> : locked ? <Lock className="h-3.5 w-3.5" /> : index + 1}
      </span>
      <CourseGlyph coverImageUrl={c.coverImageUrl} title={c.title} color={c.color} size={56} className={cn('hidden self-start sm:block', locked && 'opacity-60 grayscale')} />
      <div className="min-w-0 self-start">
        <h3 className={cn('font-serif text-[17px] font-semibold leading-snug', locked && 'text-foreground/70')}>
          <span className="sr-only">
            Course {index + 1}
            {done ? ', completed' : locked ? ', locked' : current ? ', up next' : ''}:{' '}
          </span>
          {s.linkable ? (
            <Link to={`/courses/${c.slug}`} className="rounded decoration-foreground/25 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
              {c.title}
            </Link>
          ) : (
            c.title
          )}
        </h3>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
          {current && (
            <>
              <span className="font-medium text-primary">Up next</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span>{plural(c.lessonCount, 'lesson')}</span>
          <span aria-hidden>·</span>
          <span>{formatMinutes(c.estimatedMinutes)}</span>
          {s.optional && (
            <>
              <span aria-hidden>·</span>
              <span>Optional</span>
            </>
          )}
          {c.certificateEnabled && (
            <>
              <span aria-hidden>·</span>
              <span>Certificate</span>
            </>
          )}
        </p>
        {c.summary && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground/90">{c.summary}</p>}
        {locked && s.lockedBy ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-foreground/80">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Finish {s.lockedBy} first
          </p>
        ) : !done && s.status === 'In progress' ? (
          <div className="mt-2.5 flex items-center gap-2">
            <ProgressBar value={s.progress / 100} className="h-1.5 w-28 sm:w-36" label={`${c.title} progress`} />
            <span className="text-xs tabular-nums text-muted-foreground">{s.progress}%</span>
          </div>
        ) : done && !enrolled ? (
          <p className="mt-2 text-sm text-tone-success">You’ve completed this course</p>
        ) : null}
      </div>
      {action && <div className="col-start-2 mt-3 flex sm:col-start-4 sm:mt-0 sm:justify-end sm:pl-2">{action}</div>}
    </li>
  );
}
