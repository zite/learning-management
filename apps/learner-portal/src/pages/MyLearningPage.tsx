import { BookOpen, CheckCircle2, Compass, PlayCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { EnrollmentRow, PathRow } from '../components/cards';
import { Chip, LoadError, PageHeader, Tabs } from '../components/kit';
import { Card, Container, EmptyState, LinkButton, SectionHeading, Skeleton } from '../components/ui';
import { useMyLearning, type MyEnrollment, type MyLearning } from '../lib/learn';
import { useMe } from '../lib/queries';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Tab = 'in_progress' | 'not_started' | 'completed';
type Source = 'all' | 'assigned' | 'self' | 'path';

const SOURCES: Array<{ value: Source; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'assigned', label: 'Assigned to me' },
  { value: 'path', label: 'From a path' },
  { value: 'self', label: 'I enrolled' },
];

const matchesSource = (e: MyEnrollment, s: Source) =>
  s === 'all' || (s === 'path' ? Boolean(e.path) && e.source !== 'Self-enrolled' : s === 'self' ? e.source === 'Self-enrolled' : !e.path && e.source !== 'Self-enrolled');

const inTab = (e: MyEnrollment, t: Tab) => (t === 'completed' ? e.status === 'Completed' : t === 'in_progress' ? e.status === 'In progress' : e.status === 'Not started');

export function MyLearningPage() {
  const q = useMyLearning();
  useDocumentTitle('My learning');

  return (
    <div>
      <PageHeader title="My learning" description="Everything assigned to you and everything you've chosen to take, in one place." />
      {q.isPending ? (
        <Container className="space-y-4 py-8" aria-hidden>
          <Skeleton className="h-11 w-80 max-w-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </Container>
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} title="Your learning didn't load" />
      ) : (
        <LearningView data={q.data} />
      )}
    </div>
  );
}

function LearningView({ data }: { data: MyLearning }) {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const selfEnrollment = Boolean(me.data?.features.selfEnrollment);
  const fallback: Tab = data.counts.inProgress ? 'in_progress' : data.counts.notStarted ? 'not_started' : 'completed';
  const tab = (['in_progress', 'not_started', 'completed'] as Tab[]).includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : fallback;
  const source = (SOURCES.map(s => s.value) as string[]).includes(params.get('source') ?? '') ? (params.get('source') as Source) : 'all';
  const set = (key: 'tab' | 'source', value: string) =>
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (value === 'all' && key === 'source') next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  if (!data.enrollments.length && !data.paths.length) {
    return (
      <Container className="py-10">
        <Card>
          <EmptyState
            icon={BookOpen}
            title="Nothing here yet"
            action={
              selfEnrollment ? (
                <LinkButton to="/catalog" size="lg">
                  <Compass /> Explore the catalog
                </LinkButton>
              ) : undefined
            }
          >
            {selfEnrollment ? 'When training is assigned to you it appears here. You can also pick a course from the catalog and start right away.' : 'When training is assigned to you it appears here, with its due date and your progress.'}
          </EmptyState>
        </Card>
      </Container>
    );
  }

  const bySource = data.enrollments.filter(e => matchesSource(e, source));
  const shown = bySource.filter(e => inTab(e, tab));
  const count = (t: Tab) => bySource.filter(e => inTab(e, t)).length;
  const activePaths = data.paths.filter(p => p.status !== 'Completed');
  const donePaths = data.paths.filter(p => p.status === 'Completed');
  const usedSources = SOURCES.filter(s => s.value === 'all' || data.enrollments.some(e => matchesSource(e, s.value)));

  return (
    <Container className="space-y-12 py-8 sm:py-10">
      {data.paths.length > 0 && (
        <section aria-labelledby="paths-heading">
          <SectionHeading id="paths-heading" count={data.paths.length}>
            Learning paths
          </SectionHeading>
          <ul className="-mt-4 divide-y">
            {[...activePaths, ...donePaths].map(p => (
              <PathRow key={p.id} p={p} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="courses-heading">
        <h2 id="courses-heading" className="sr-only">
          Courses
        </h2>
        <Tabs
          label="Course status"
          value={tab}
          onChange={v => set('tab', v)}
          tabs={[
            { value: 'in_progress', label: 'In progress', count: count('in_progress') },
            { value: 'not_started', label: 'Not started', count: count('not_started') },
            { value: 'completed', label: 'Completed', count: count('completed') },
          ]}
        />
        {usedSources.length > 2 && (
          <div role="group" aria-label="Filter by where it came from" className="scrollbar-none -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {usedSources.map(s => (
              <Chip key={s.value} active={source === s.value} onClick={() => set('source', s.value)}>
                {s.label}
              </Chip>
            ))}
          </div>
        )}

        <div aria-live="polite" className="mt-2">
          {shown.length ? (
            <ul className="divide-y">
              {shown.map(e => (
                <EnrollmentRow key={e.id} e={e} showNext={tab !== 'completed'} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={tab === 'completed' ? CheckCircle2 : PlayCircle} title={emptyTitle(tab, source)} className="py-12">
              {emptyBody(tab, selfEnrollment)}
            </EmptyState>
          )}
        </div>
      </section>
    </Container>
  );
}

function emptyTitle(tab: Tab, source: Source) {
  const filtered = source !== 'all' ? ' with this filter' : '';
  if (tab === 'completed') return `Nothing completed yet${filtered}`;
  if (tab === 'in_progress') return `Nothing in progress${filtered}`;
  return `Nothing waiting to start${filtered}`;
}

function emptyBody(tab: Tab, selfEnrollment: boolean) {
  if (tab === 'completed') return 'Courses you finish land here, with a link to review them and any certificate you earned.';
  if (tab === 'in_progress') return 'Start a course and it moves here, so you can pick up exactly where you left off.';
  return selfEnrollment ? 'Everything you’re enrolled in has been started. Find something new in the catalog.' : 'Everything you’re enrolled in has been started.';
}
