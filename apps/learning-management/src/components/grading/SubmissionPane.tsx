import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp, Copy, EyeOff, FileText, GraduationCap, History, MoreHorizontal, NotebookPen, Paperclip, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { fileSize, Markdown } from '@project/shared/ui/Markdown';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { appUrl, dateTime, shortDate, shortDateTime, timeAgo, todayString } from '../../lib/format';
import { PersonAvatar } from '../primitives/Avatar';
import { IconButton, ProgressBar, Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { GradePill } from './GradingQueue';
import type { SubmissionDetail } from './gradingData';

function usePersistedToggle(key: string, initial: boolean) {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(`lms:grading:${key}`);
      return v == null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  const toggle = () =>
    setOpen(o => {
      try {
        localStorage.setItem(`lms:grading:${key}`, o ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !o;
    });
  return [open, toggle] as const;
}

function Section({ title, icon, open, onToggle, meta, className, children }: { title: string; icon: ReactNode; open: boolean; onToggle: () => void; meta?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-lg border', className)}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[14px] font-medium hover:bg-accent/40">
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        {title}
        {meta && <span className="ml-auto flex items-center gap-1 text-sm font-normal text-muted-foreground">{meta}</span>}
      </button>
      {open && <div className="border-t px-4 py-3 animate-fade-in">{children}</div>}
    </section>
  );
}

export const STATUS_TONE: Record<string, string> = {
  Submitted: 'bg-tone-info/[0.1] text-tone-info',
  Passed: 'bg-tone-success/[0.1] text-tone-success',
  'Needs revision': 'bg-tone-warning/[0.12] text-tone-warning',
};

export function StatusChip({ status, className }: { status: string; className?: string }) {
  return <span className={cn('inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-sm font-medium', STATUS_TONE[status] ?? 'bg-muted text-muted-foreground', className)}>{status === 'Submitted' ? 'Waiting to be graded' : status}</span>;
}

function Files({ files }: { files: SubmissionDetail['submission']['files'] }) {
  const images = files.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(f.name));
  const others = files.filter(f => !images.includes(f));
  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map(f => (
            <a key={f.url} href={f.url} target="_blank" rel="noreferrer noopener" className="group overflow-hidden rounded-md border bg-subtle" title={`Open ${f.name}`}>
              <img src={f.url} alt={f.name} loading="lazy" className="h-28 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" />
              <span className="flex items-center gap-1 truncate border-t bg-background px-2 py-1 text-sm text-muted-foreground">
                <span className="truncate">{f.name}</span>
                {f.size > 0 && <span className="ml-auto shrink-0 tabular-nums">{fileSize(f.size)}</span>}
              </span>
            </a>
          ))}
        </div>
      )}
      {others.map(f => {
        const pdf = /pdf/i.test(f.type) || /\.pdf(\?|$)/i.test(f.name);
        return (
          <a key={f.url} href={f.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-[14px] hover:bg-accent/50">
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', pdf ? 'bg-tone-danger/[0.1] text-tone-danger' : 'bg-muted text-muted-foreground')}>
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {f.size > 0 && <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{fileSize(f.size)}</span>}
            <span className="shrink-0 text-sm font-medium text-primary">{pdf ? 'Open PDF' : 'Open'}</span>
          </a>
        );
      })}
    </div>
  );
}

function Attempts({ detail, queueSearch }: { detail: SubmissionDetail; queueSearch: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const others = detail.attempts;
  return (
    <ol className="relative space-y-0">
      {others.map((a, i) => {
        const last = i === others.length - 1;
        const long = a.feedback.length > 220;
        const open = expanded === a.id || !long;
        return (
          <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && <span className="absolute left-[7px] top-4 h-[calc(100%-8px)] w-px bg-border" aria-hidden />}
            <span className={cn('relative mt-1 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border-2 bg-background', a.status === 'Passed' ? 'border-tone-success' : a.status === 'Needs revision' ? 'border-tone-warning' : 'border-tone-info', a.current && 'ring-2 ring-primary/25')}>
              {a.current && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
                <span className="font-medium">Attempt {a.attempt}</span>
                {a.current ? <span className="text-sm text-muted-foreground">This one</span> : (
                  <Link to={`/grading/${a.id}${queueSearch}`} className="text-sm text-primary hover:underline">Open</Link>
                )}
                <StatusChip status={a.status} />
                {a.grade != null && <GradePill grade={a.grade} status={a.status} />}
                <Tip label={dateTime(a.submittedAt)}>
                  <span className="text-sm text-muted-foreground">Submitted {shortDate(a.submittedAt)}</span>
                </Tip>
              </div>
              {a.feedback && (
                <div className="mt-1.5 rounded-md bg-subtle px-3 py-2">
                  <div className={cn('text-[14px] text-foreground/90', !open && 'line-clamp-3')}>
                    <Markdown compact>{a.feedback}</Markdown>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    {a.gradedByName && <span>{a.gradedByName}</span>}
                    {a.gradedAt && <span>· {timeAgo(a.gradedAt)}</span>}
                    {long && (
                      <button type="button" onClick={() => setExpanded(open ? null : a.id)} className="ml-auto font-medium text-foreground/80 hover:text-foreground">
                        {open ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function SubmissionPane({
  detail,
  position,
  prevId,
  nextId,
  onPrev,
  onNext,
  onBack,
  queueSearch,
  bar,
  inlineBar,
}: {
  detail: SubmissionDetail;
  position: string | null;
  prevId: string | null;
  nextId: string | null;
  onPrev: () => void;
  onNext: () => void;
  onBack?: () => void;
  queueSearch: string;
  bar: ReactNode;
  /** On a phone the grading bar sits at the end of the page instead of pinned to the bottom. */
  inlineBar: boolean;
}) {
  const app = useAppActions();
  const navigate = useNavigate();
  const { submission: s, lesson, course, learner, enrollment } = detail;
  const [instructionsOpen, toggleInstructions] = usePersistedToggle('instructions', false);
  const [rubricOpen, toggleRubric] = usePersistedToggle('rubric', true);
  const [attemptsOpen, toggleAttempts] = usePersistedToggle('attempts', true);
  const newer = s.supersededById ? detail.attempts.find(a => a.id === s.supersededById) : null;
  const emptyBody = !s.body.trim();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        {onBack && (
          <IconButton aria-label="Back to the queue" onClick={onBack}>
            <ArrowLeft />
          </IconButton>
        )}
        <div className={cn('flex min-w-0 items-center gap-2 text-[14px]', !onBack && 'pl-1')}>
          <PersonAvatar person={learner} size={20} />
          <Link to={`/people/${learner.id}`} className="shrink-0 truncate font-medium hover:underline">{learner.name}</Link>
          <span aria-hidden className="hidden text-faint sm:inline">›</span>
          <span className="hidden min-w-0 truncate text-muted-foreground sm:inline">{lesson.title}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {position && <span className="mr-1 hidden text-sm tabular-nums text-muted-foreground sm:inline">{position}</span>}
          <Tip label="Previous" keys={['K']}>
            <IconButton aria-label="Previous submission" disabled={!prevId} onClick={onPrev}>
              <ChevronUp />
            </IconButton>
          </Tip>
          <Tip label="Next" keys={['J']}>
            <IconButton aria-label="Next submission" disabled={!nextId} onClick={onNext}>
              <ChevronDown />
            </IconButton>
          </Tip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="More actions">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {enrollment && (
                <DropdownMenuItem className="text-[14px]" onSelect={() => app.openEnrollment(enrollment.id)}>
                  <GraduationCap className="h-3.5 w-3.5" /> Open enrollment
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-[14px]" onSelect={() => navigate(`/people/${learner.id}`)}>
                <UserRound className="h-3.5 w-3.5" /> Open {learner.name.split(' ')[0]}’s profile
              </DropdownMenuItem>
              {lesson.exists && (
                <DropdownMenuItem className="text-[14px]" onSelect={() => navigate(`/courses/${course.id}/content/${lesson.id}`)}>
                  <NotebookPen className="h-3.5 w-3.5" /> Open lesson in builder
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[14px]" onSelect={() => void copyText(appUrl(`/grading/${s.id}`), 'Link copied')}>
                <Copy className="h-3.5 w-3.5" /> Copy link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" data-grading-scroll>
        <div className="mx-auto max-w-[780px] px-4 pb-8 pt-5 sm:px-8 animate-fade-in" key={s.id}>
          {newer && (
            <Link to={`/grading/${newer.id}${queueSearch}`} className="mb-4 flex items-center gap-2 rounded-lg border border-tone-info/30 bg-tone-info/[0.06] px-3 py-2 text-[14px] hover:bg-tone-info/[0.1]">
              <History className="h-3.5 w-3.5 text-tone-info" />
              <span>{learner.name.split(' ')[0]} resubmitted — this is an earlier attempt.</span>
              <span className="ml-auto shrink-0 font-medium text-tone-info">Open attempt {newer.attempt} →</span>
            </Link>
          )}

          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CourseGlyph icon={course.icon} color={course.color} size={14} />
            <Link to={`/courses/${course.id}`} className="truncate hover:text-foreground hover:underline">{course.title}</Link>
          </div>
          <h2 className="mt-1 text-[19px] font-semibold leading-snug tracking-[-0.01em]">{lesson.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-muted-foreground">
            <StatusChip status={s.status} />
            {s.attempt > 1 && <span className="font-medium text-foreground/80">Attempt {s.attempt}</span>}
            <Tip label={dateTime(s.submittedAt)}>
              <span>Submitted {timeAgo(s.submittedAt)}</span>
            </Tip>
            <span aria-hidden>·</span>
            <span>Pass at {lesson.passingGrade}</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <PersonAvatar person={learner} size={30} />
              <div className="min-w-0">
                <Link to={`/people/${learner.id}`} className="block truncate text-[14px] font-medium hover:underline">{learner.name}</Link>
                <div className="truncate text-sm text-muted-foreground">{[learner.title, learner.managerName ? `reports to ${learner.managerName}` : null].filter(Boolean).join(' · ') || learner.email}</div>
              </div>
            </div>
            {enrollment && (
              <button type="button" onClick={() => app.openEnrollment(enrollment.id)} className="ml-auto flex min-w-[180px] flex-col gap-1 rounded-md px-2 py-1 text-left hover:bg-accent/50" aria-label="Open enrollment">
                <span className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{enrollment.status}{enrollment.cycle > 1 ? ` · cycle ${enrollment.cycle}` : ''}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {enrollment.progress}%
                    {enrollment.dueDate && enrollment.status !== 'Completed' && enrollment.status !== 'Withdrawn' && (
                      <span className={cn(enrollment.dueDate < todayString() && 'text-tone-danger')}>
                        {' · '}
                        {enrollment.dueDate < todayString() ? `overdue since ${shortDate(enrollment.dueDate)}` : `due ${shortDate(enrollment.dueDate)}`}
                      </span>
                    )}
                  </span>
                </span>
                <ProgressBar value={enrollment.progress / 100} tone={enrollment.status === 'Completed' ? 'success' : 'primary'} />
              </button>
            )}
          </div>

          <div className="mt-4 space-y-2.5">
            <Section title="Instructions" icon={<FileText />} open={instructionsOpen} onToggle={toggleInstructions} meta={!lesson.exists ? 'Lesson deleted' : undefined}>
              {lesson.instructions.trim() ? <Markdown className="text-[14px]">{lesson.instructions}</Markdown> : <p className="text-[14px] text-muted-foreground">This assignment has no written instructions.</p>}
            </Section>
            <Section
              title="Rubric for graders"
              icon={<EyeOff />}
              open={rubricOpen}
              onToggle={toggleRubric}
              className="bg-subtle/70"
              meta={<span className="hidden sm:inline">Private — learners never see this</span>}
            >
              {lesson.rubric.trim() ? <Markdown className="text-[14px]">{lesson.rubric}</Markdown> : (
                <p className="text-[14px] text-muted-foreground">
                  No rubric yet.{' '}
                  {lesson.exists && <Link to={`/courses/${course.id}/content/${lesson.id}`} className="text-primary hover:underline">Add one in the builder</Link>}
                  {lesson.exists && ' so every grader judges this the same way.'}
                </p>
              )}
            </Section>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-[14px] font-medium">Submission</h3>
              {s.files.length > 0 && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Paperclip className="h-3 w-3" /> {s.files.length} {s.files.length === 1 ? 'file' : 'files'}
                </span>
              )}
              <Tip label={dateTime(s.submittedAt)}>
                <span className="ml-auto text-sm text-muted-foreground">{shortDateTime(s.submittedAt)}</span>
              </Tip>
            </div>
            <div className="rounded-lg border bg-background px-4 py-4 shadow-2xs sm:px-5">
              {emptyBody ? (
                <p className="text-[14px] text-muted-foreground">
                  {s.files.length ? `${learner.name.split(' ')[0]} didn’t write anything — the work is in the attached ${s.files.length === 1 ? 'file' : 'files'}.` : 'This submission is empty — nothing was written or attached.'}
                </p>
              ) : (
                <Markdown className="text-[14.5px]">{s.body}</Markdown>
              )}
              {s.files.length > 0 && <div className={cn(!emptyBody && 'mt-4 border-t pt-4', emptyBody && 'mt-3')}><Files files={s.files} /></div>}
            </div>
          </div>

          {detail.attempts.length > 1 && (
            <div className="mt-6">
              <Section title="All attempts" icon={<History />} open={attemptsOpen} onToggle={toggleAttempts} meta={`${detail.attempts.length}`}>
                <Attempts detail={detail} queueSearch={queueSearch} />
              </Section>
            </div>
          )}

          {inlineBar && <div className="mt-6 overflow-hidden rounded-lg border">{bar}</div>}
        </div>
      </div>
      {!inlineBar && bar}
    </div>
  );
}
