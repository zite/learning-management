import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { Avatar, LoadError, PageHeader, Tabs } from '../components/kit';
import { Card, Container, EmptyState, Skeleton } from '../components/ui';
import { plural } from '../lib/format';
import { useLeaderboard, type Leaderboard, type LeaderboardPeriod } from '../lib/learn';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Entry = Leaderboard['entries'][number];

const PERIOD_LABEL: Record<LeaderboardPeriod, string> = {
  month: 'this month',
  quarter: 'this quarter',
  all: 'all time',
};

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${s}`;
};

export function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');
  const q = useLeaderboard(period);
  useDocumentTitle('Leaderboard');

  return (
    <div>
      <PageHeader title="Leaderboard" description="Points come from finishing things (lessons, courses, paths and quizzes), never from time spent.">
        <Tabs
          className="mt-6 border-b-0"
          label="Period"
          value={period}
          onChange={setPeriod}
          tabs={[
            { value: 'month', label: 'This month' },
            { value: 'quarter', label: 'This quarter' },
            { value: 'all', label: 'All time' },
          ]}
        />
      </PageHeader>
      <Container className="py-8 sm:py-10">
        {q.isPending ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]" aria-hidden>
            <div className="space-y-6">
              <Skeleton className="h-36 rounded-xl" />
              <Skeleton className="h-96 rounded-xl" />
            </div>
            <Skeleton className="h-72 rounded-xl" />
          </div>
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} title="The leaderboard didn't load" />
        ) : (
          <div className={cn('grid gap-8 transition-opacity lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start', q.isPlaceholderData && 'opacity-60')} aria-live="polite" aria-busy={q.isPlaceholderData || undefined}>
            <div className="min-w-0 space-y-6">
              {/* On phones your own standing comes before the long list; from lg it sits in the sidebar. */}
              <div className="lg:hidden">
                <YourStanding data={q.data} />
              </div>
              {q.data.entries.length === 0 ? (
                <Card>
                  <EmptyState icon={Trophy} title={`No points yet ${PERIOD_LABEL[q.data.period]}`}>
                    Finish a lesson to get on the board. You might be first.
                  </EmptyState>
                </Card>
              ) : (
                <>
                  {q.data.entries.length >= 3 && <TopThree entries={q.data.entries.slice(0, 3)} />}
                  <Ranked data={q.data} />
                </>
              )}
            </div>
            <aside className="space-y-6 lg:sticky lg:top-24">
              <div className="hidden lg:block">
                <YourStanding data={q.data} />
              </div>
              <HowPoints rules={q.data.rules} />
            </aside>
          </div>
        )}
      </Container>
    </div>
  );
}

/**
 * The first three places, as a strip of equal cells rather than a podium: the
 * place, the person, their points. Ties share a place and say so.
 */
function TopThree({ entries }: { entries: Entry[] }) {
  return (
    <ol aria-label="Top three" className="grid gap-px overflow-hidden rounded-xl border bg-border shadow-2xs sm:grid-cols-3">
      {entries.map(e => {
        const tied = entries.filter(x => x.rank === e.rank).length > 1;
        return (
          <li key={`${e.rank}-${e.name}`} className={cn('min-w-0 bg-card px-4 py-3 sm:px-5 sm:py-4', e.isMe && 'bg-primary/[0.05]')} aria-current={e.isMe ? 'true' : undefined}>
            {/* Phones: one compact line per place. */}
            <div className="flex items-center gap-3 sm:hidden">
              <span className="w-12 shrink-0 text-sm text-muted-foreground">{tied ? `=${ordinal(e.rank)}` : ordinal(e.rank)}</span>
              <Avatar name={e.name} color={e.color} avatarUrl={e.avatarUrl} size={32} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {e.name}
                {e.isMe && <span className="ml-2 text-sm text-primary">You</span>}
              </span>
              <span className="font-serif text-lg font-semibold tabular-nums">{e.points.toLocaleString()}</span>
            </div>
            <div className="hidden sm:block">
              <p className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  {e.rank === 1 && <Trophy className="h-3.5 w-3.5" aria-hidden />}
                  {tied ? `Tied ${ordinal(e.rank)}` : ordinal(e.rank)}
                </span>
                {e.isMe && <span className="font-medium text-primary">You</span>}
              </p>
              <div className="mt-3 flex min-w-0 items-center gap-3">
                <Avatar name={e.name} color={e.color} avatarUrl={e.avatarUrl} size={40} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{e.title ?? ' '}</p>
                </div>
              </div>
              <p className="mt-4 font-serif text-[26px] font-semibold leading-none tabular-nums">
                {e.points.toLocaleString()} <span className="font-sans text-sm font-normal text-muted-foreground">points</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Ranked({ data }: { data: Leaderboard }) {
  const rest = data.entries.length >= 3 ? data.entries.slice(3) : data.entries;
  const meListed = data.entries.some(e => e.isMe);
  const me = data.me;
  const showMe = !meListed && me && me.rank > 0;
  if (!rest.length && !showMe) return null;
  return (
    <section aria-labelledby="rankings-heading" className="overflow-hidden rounded-xl border bg-card shadow-2xs">
      <h2 id="rankings-heading" className="sr-only">
        Rankings
      </h2>
      <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] gap-x-3 border-b bg-subtle px-4 py-2 text-xs text-muted-foreground sm:px-5" aria-hidden>
        <span className="text-right">Rank</span>
        <span className="pl-11">Learner</span>
        <span className="text-right">Points</span>
      </div>
      <ol className="divide-y">
        {rest.map(e => (
          <Row key={`${e.rank}-${e.name}`} e={e} />
        ))}
        {showMe && (
          <>
            <li className="px-4 py-1 text-center text-sm leading-none text-faint" aria-hidden>
              ···
            </li>
            <Row e={me} />
          </>
        )}
      </ol>
    </section>
  );
}

function Row({ e }: { e: Entry }) {
  return (
    <li className={cn('grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 sm:px-5', e.isMe && 'bg-primary/[0.05]')} aria-current={e.isMe ? 'true' : undefined}>
      <span className="text-right tabular-nums text-muted-foreground">{e.rank}</span>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={e.name} color={e.color} avatarUrl={e.avatarUrl} size={32} />
        <span className="min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-medium">{e.name}</span>
            {e.isMe && <span className="shrink-0 text-sm font-medium text-primary">You</span>}
          </span>
          {e.title && <span className="block truncate text-sm text-muted-foreground">{e.title}</span>}
        </span>
      </span>
      <span className="text-right font-medium tabular-nums">{e.points.toLocaleString()}</span>
    </li>
  );
}

function YourStanding({ data }: { data: Leaderboard }) {
  const me = data.me;
  if (!me) return null;
  const b = me.breakdown;
  const onBoard = me.rank > 0;
  // Periods start at midnight UTC on the 1st; read them in UTC so they don't slip back a day.
  const since = data.since ? `Since ${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(data.since))}` : 'All time';
  const next = !onBoard
    ? `Finish a lesson to earn your first ${data.rules.lesson} points.`
    : me.pointsToNext == null
      ? me.tiedWith
        ? `Top of the board, tied with ${plural(me.tiedWith, 'other')}.`
        : 'You’re top of the board.'
      : `${plural(me.pointsToNext, 'point')} to move up${me.tiedWith ? ` · tied with ${plural(me.tiedWith, 'other')}` : ''}.`;

  return (
    <Card as="section" aria-labelledby="standing-heading" className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="standing-heading" className="font-serif text-lg font-semibold">
          Your standing
        </h2>
        <span className="text-sm text-muted-foreground">{since}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
        <div className="bg-card px-3.5 py-3">
          <p className="font-serif text-[26px] font-semibold leading-none tabular-nums">{onBoard ? ordinal(me.rank) : '—'}</p>
          <p className="mt-1.5 truncate text-sm text-muted-foreground">{onBoard ? `of ${plural(data.participants, 'learner')}` : 'Not ranked yet'}</p>
        </div>
        <div className="bg-card px-3.5 py-3">
          <p className="font-serif text-[26px] font-semibold leading-none tabular-nums">{me.points.toLocaleString()}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{me.points === 1 ? 'point' : 'points'}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-foreground/80">{next}</p>
      <dl className="mt-4 divide-y border-t text-sm">
        <Stat label="Lessons finished" value={b.lessons} />
        <Stat label="Courses completed" value={b.courses} />
        <Stat label="Paths completed" value={b.paths} />
        <Stat label="Quizzes passed" value={b.quizPasses} />
        <Stat label="Perfect quiz scores" value={b.perfectQuizzes} />
      </dl>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function HowPoints({ rules }: { rules: Leaderboard['rules'] }) {
  const items = [
    { label: 'Finish a lesson', points: rules.lesson },
    { label: 'Pass a quiz', points: rules.quizPass },
    {
      label: 'Score 100% on a quiz',
      points: rules.perfectQuiz,
      note: 'On top of passing',
    },
    { label: 'Complete a course', points: rules.course },
    { label: 'Complete a learning path', points: rules.path },
  ];
  return (
    <Card as="section" aria-labelledby="how-points" className="p-5">
      <h2 id="how-points" className="font-serif text-lg font-semibold">
        How points work
      </h2>
      <ul className="mt-3 divide-y border-t text-sm">
        {items.map(i => (
          <li key={i.label} className="flex items-baseline justify-between gap-3 py-2">
            <span>
              {i.label}
              {i.note && <span className="block text-xs text-muted-foreground">{i.note}</span>}
            </span>
            <span className="shrink-0 font-medium tabular-nums">+{i.points}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">Each quiz counts once, however many times you retake it. Other learners see your first name and last initial.</p>
    </Card>
  );
}
