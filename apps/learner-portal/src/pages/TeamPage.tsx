import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Award, BellRing, Check, ChevronDown, Mail, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { nudgeReport } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { firstName } from '@project/shared/merge';
import { Avatar, CourseGlyph, DueText, LoadError, PageHeader, StatStrip } from '../components/kit';
import { Button, Card, Container, EmptyState, ProgressBar, Skeleton, StatusPill, Tip } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { certShortDate } from '../lib/certDates';
import { plural, timeAgo } from '../lib/format';
import { learnKeys, useTeam, type Team, type TeamEnrollment, type TeamMember } from '../lib/learn';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Person · open · done · last active · status · toggle — the header and every row share it. */
const COLUMNS = 'md:grid-cols-[minmax(0,1fr)_64px_64px_120px_168px_20px]';

export function TeamPage() {
  const q = useTeam();
  useDocumentTitle('My team');

  return (
    <div>
      <PageHeader title="My team" description={q.data ? `Training for the ${plural(q.data.summary.reports, 'person', 'people')} who report to you: what's open, what's late, and certificates about to lapse.` : 'Training for the people who report to you.'} />
      <Container className="py-8 sm:py-10">
        {q.isPending ? (
          <div className="space-y-8" aria-hidden>
            <Skeleton className="h-[106px] rounded-xl" />
            <div className="divide-y rounded-xl border bg-card">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3.5 w-56" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} title="Your team didn't load" />
        ) : (
          <TeamView data={q.data} />
        )}
      </Container>
    </div>
  );
}

function TeamView({ data }: { data: Team }) {
  const s = data.summary;
  if (!data.members.length) {
    return (
      <Card>
        <EmptyState icon={Users} title="Nobody reports to you right now">
          When people are set up with you as their manager, their training shows up here.
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="space-y-8">
      <StatStrip
        label="Team summary"
        stats={[
          {
            value: s.reports,
            label: s.reports === 1 ? 'direct report' : 'direct reports',
            hint: 'Reporting to you',
          },
          {
            value: <span className={s.overdue ? 'text-tone-danger' : undefined}>{s.overdue}</span>,
            label: 'overdue',
            hint: s.overdue ? 'Past their due date' : 'Nothing late',
          },
          {
            value: s.dueThisWeek,
            label: 'due this week',
            hint: 'In the next 7 days',
          },
          {
            value: <span className={s.expiring ? 'text-tone-warning' : undefined}>{s.expiring}</span>,
            label: s.expiring === 1 ? 'certificate lapsing' : 'certificates lapsing',
            hint: 'Within 30 days',
          },
        ]}
      />

      <section aria-labelledby="reports-heading" className="overflow-hidden rounded-xl border bg-card shadow-2xs">
        <h2 id="reports-heading" className="sr-only">
          Direct reports
        </h2>
        <div className={cn('hidden gap-x-4 border-b bg-subtle px-5 py-2 text-xs text-muted-foreground md:grid', COLUMNS)} aria-hidden>
          <span>Person</span>
          <span className="text-right">Open</span>
          <span className="text-right">Done</span>
          <span>Last active</span>
          <span>Status</span>
          <span />
        </div>
        <ul className="divide-y">
          {data.members.map(m => (
            <MemberRow key={m.id} m={m} />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The one thing about a person's training that most needs a manager's eye. */
function memberStatus(m: TeamMember) {
  if (m.counts.overdue > 0) return <StatusPill tone="danger">{m.counts.overdue} overdue</StatusPill>;
  if (m.counts.dueSoon > 0) return <StatusPill tone="warning">{m.counts.dueSoon} due this week</StatusPill>;
  if (m.expiringCertificates.some(c => c.expired)) return <StatusPill tone="warning">Certificate lapsed</StatusPill>;
  if (m.expiringCertificates.length) return <StatusPill tone="warning">Certificate expiring</StatusPill>;
  if (m.counts.active) return <span className="text-sm text-muted-foreground">On track</span>;
  return <span className="text-sm text-muted-foreground">Nothing open</span>;
}

function MemberRow({ m }: { m: TeamMember }) {
  const [open, setOpen] = useState(m.counts.overdue > 0);
  const panelId = `report-${m.id}`;
  const active = m.lastLearnedAt ? timeAgo(m.lastLearnedAt) : 'Not yet';

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35 sm:px-5',
          COLUMNS,
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={m.name} color={m.color} avatarUrl={m.avatarUrl} size={36} />
          <span className="min-w-0">
            <span className="block font-medium md:truncate">{m.name}</span>
            <span className="block truncate text-sm text-muted-foreground">{m.title ?? 'No job title'}</span>
            {/* Phones fold the columns into one line. */}
            <span className="mt-0.5 block text-sm text-muted-foreground md:hidden">
              {m.counts.active} open · {m.counts.completed} done · {m.lastLearnedAt ? `active ${active}` : 'hasn’t started'}
            </span>
          </span>
        </span>
        <span className="hidden text-right tabular-nums md:block">{m.counts.active}</span>
        <span className="hidden text-right tabular-nums text-muted-foreground md:block">{m.counts.completed}</span>
        <span className="hidden truncate text-sm text-muted-foreground md:block">{active}</span>
        <span className="flex items-center justify-end gap-2 md:justify-start">
          {memberStatus(m)}
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform md:hidden', open && 'rotate-180')} aria-hidden />
        </span>
        <ChevronDown className={cn('hidden h-4 w-4 text-muted-foreground transition-transform md:block', open && 'rotate-180')} aria-hidden />
        <span className="sr-only">{open ? 'Hide training' : 'Show training'}</span>
      </button>

      {open && (
        <div id={panelId} className="border-t bg-subtle px-4 pb-4 pt-3 sm:px-5 md:pl-[68px]">
          {m.expiringCertificates.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-1.5 text-xs text-muted-foreground">Certificates</h3>
              <ul className="divide-y rounded-lg border bg-card">
                {m.expiringCertificates.map(c => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3.5 py-2.5 text-sm">
                    <Award className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <Link to={`/certificates/${c.id}`} className="rounded font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                      {c.title}
                    </Link>
                    <span className="font-medium text-tone-warning">{c.expired ? `Expired ${certShortDate(c.expiresAt)}` : `Expires ${certShortDate(c.expiresAt)}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h3 className="mb-1.5 text-xs text-muted-foreground">Open training</h3>
          {m.open.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border bg-card px-3.5 py-3 text-[15px] text-muted-foreground">
              <Check className="h-4 w-4 text-tone-success" aria-hidden /> Nothing open
              {m.counts.completed ? ` · ${plural(m.counts.completed, 'course')} completed` : ''}.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {m.open.map(e => (
                <TrainingRow key={e.id} e={e} person={m} />
              ))}
            </ul>
          )}
          {m.email && (
            <a
              href={`mailto:${m.email}`}
              className="mt-3 inline-flex items-center gap-1.5 rounded text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
            >
              <Mail className="h-4 w-4" aria-hidden /> Email {firstName(m.name)}
            </a>
          )}
        </div>
      )}
    </li>
  );
}

/** Course · due · progress · nudge, on one grid; on phones the progress and nudge share a second line. */
function TrainingRow({ e, person }: { e: TeamEnrollment; person: TeamMember }) {
  const qc = useQueryClient();
  const recently = e.remindedAt ? Date.now() - Date.parse(e.remindedAt) < DAY_MS : false;
  const nudge = useMutation({
    mutationFn: () => nudgeReport({ enrollmentId: e.id }),
    onSuccess: res => {
      qc.setQueryData<Team>(learnKeys.team, prev =>
        prev
          ? {
              ...prev,
              members: prev.members.map(m => ({
                ...m,
                open: m.open.map(x => (x.id === e.id ? { ...x, remindedAt: res.remindedAt } : x)),
              })),
            }
          : prev,
      );
      toast.success(`Reminder sent to ${firstName(person.name)} about ${e.course.title}.`);
    },
    onError: err => {
      toast.error(errorMessage(err, "The reminder couldn't be sent. Try again in a moment."));
      void qc.invalidateQueries({ queryKey: learnKeys.team });
    },
  });

  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3.5 py-3 sm:grid-cols-[32px_minmax(0,1fr)_140px_160px]">
      <CourseGlyph title={e.course.title} color={e.course.color} size={32} className="self-start sm:self-center" />
      <div className="min-w-0">
        <p className="font-medium sm:truncate">{e.course.title}</p>
        <p className="text-sm">{e.dueDate ? <DueText dueDate={e.dueDate} dueState={e.dueState} /> : <span className="text-muted-foreground">No due date</span>}</p>
      </div>
      {/* Phones: progress and the nudge share a line under the title. From sm they're columns. */}
      <div className="col-start-2 flex items-center justify-between gap-3 sm:contents">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {e.status === 'Not started' ? (
            'Not started'
          ) : (
            <>
              <ProgressBar value={e.progress / 100} className="h-1.5 w-14 sm:w-20" label={`${e.course.title} progress`} />
              <span className="tabular-nums">{e.progress}%</span>
            </>
          )}
        </span>
        <div className="flex justify-end">
          {recently ? (
            <Tip label="You can send one reminder a day for each course">
              <span tabIndex={0} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-1 sm:whitespace-nowrap text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                <Check className="h-4 w-4 text-tone-success" aria-hidden /> Reminded {timeAgo(e.remindedAt)}
              </span>
            </Tip>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => nudge.mutate()} loading={nudge.isPending} aria-label={`Nudge ${person.name} about ${e.course.title}`}>
              {!nudge.isPending && <BellRing />} Nudge
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
