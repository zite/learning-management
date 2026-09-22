import { ArrowUpRight, Award, BellRing, CalendarDays, CheckCircle2, Clock3, MoreHorizontal, RotateCcw, Route, Undo2, UserMinus, X } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@project/components/ui/sheet';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { SOURCE_LABEL, STATUS_META } from '../../lib/constants';
import { dateTime, formatDuration, shortDate, timeAgo } from '../../lib/format';
import { useEnrollmentActions } from '../../lib/mutations';
import { useEnrollment } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, Tip } from '../primitives/bits';
import { CourseGlyph, DuePill, LessonTypeIcon, ProgressMeter, StatusGlyph } from '../primitives/icons';
import { DatePicker } from '../pickers/pickers';
import { activityText } from './activityText';

/** Neutral unless it needs attention (below a typical pass mark). */
function Score({ value, className }: { value: number | null; className?: string }) {
  if (value == null) return <span className={cn('text-muted-foreground/60', className)}>—</span>;
  return <span className={cn('tabular-nums', value < 70 ? 'text-tone-warning' : 'text-foreground', className)}>{Math.round(value)}%</span>;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-2xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-[14px]">{children}</div>
    </div>
  );
}

/**
 * Everything about one learner's enrollment, in a side panel that opens from
 * any list with Space or a click: where they are, every lesson, quiz attempts,
 * submissions, the certificate and who did what.
 */
export function EnrollmentPeek({ id, onClose }: { id: string | null; onClose: () => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { run } = useEnrollmentActions();
  const { data, isPending, isError } = useEnrollment(id);
  const e = data?.enrollment;
  const course = e ? ws.courseById.get(e.courseId) : undefined;

  // Remember what had focus when the panel opened (a list row, a matrix cell) and return there on close.
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (id && !wasOpen.current) returnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  wasOpen.current = Boolean(id);

  return (
    <Sheet open={Boolean(id)} onOpenChange={o => !o && onClose()}>
      <SheetContent
        side="right"
        onCloseAutoFocus={ev => {
          const el = returnFocus.current;
          if (el && document.contains(el)) {
            ev.preventDefault();
            el.focus();
          }
        }}
        className="flex w-[min(640px,96vw)] flex-col gap-0 p-0 sm:max-w-none [&>button:first-child]:hidden"
      >
        <SheetTitle className="sr-only">Enrollment details</SheetTitle>
        {isPending && id ? (
          <div className="space-y-4 p-6">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton h-8 w-3/4" />
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-3 w-5/6" />
          </div>
        ) : isError || !data || !e ? (
          <>
            <header className="flex h-11 shrink-0 items-center justify-end border-b px-3">
              <IconButton aria-label="Close" onClick={onClose}>
                <X />
              </IconButton>
            </header>
            <EmptyState title="That enrollment couldn't be loaded" description="It may have been withdrawn and removed, or the link is out of date." />
          </>
        ) : (
          <>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
              <Link to={`/people/${e.personId}`} onClick={onClose} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
                <PersonAvatar person={{ name: e.personName, color: e.personColor, avatarUrl: e.personAvatarUrl, status: e.personStatus }} size={20} />
                <span className="truncate text-[14px] font-medium">{e.personName}</span>
              </Link>
              <span className="text-muted-foreground/60">›</span>
              <Link to={`/courses/${e.courseId}/learners`} onClick={onClose} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
                <CourseGlyph icon={course?.icon} color={course?.color} size={18} />
                <span className="truncate text-[14px]">{data.course.title}</span>
              </Link>
              <div className="ml-auto flex items-center gap-0.5">
                {e.status !== 'Completed' && e.status !== 'Withdrawn' && (
                  <Tip label="Send a reminder now">
                    <IconButton aria-label="Send reminder" onClick={() => run([e], 'remind')}>
                      <BellRing />
                    </IconButton>
                  </Tip>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton aria-label="More actions">
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {e.status !== 'Completed' && e.status !== 'Withdrawn' && (
                      <DropdownMenuItem
                        className="text-[14px]"
                        onSelect={async () => {
                          if (await app.confirm({ title: `Mark ${e.personName} complete?`, description: 'Use this for training finished offline. Any certificate for the course is issued and learning paths move forward.', confirmLabel: 'Mark complete' })) run([e], 'complete');
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Mark complete…
                      </DropdownMenuItem>
                    )}
                    {e.status !== 'Withdrawn' && <DropdownMenuItem
                      className="text-[14px]"
                      onSelect={async () => {
                        if (await app.confirm({ title: 'Reset progress?', description: `${e.personName} will start ${data.course.title} from the beginning. Quiz attempts and submissions stay on record.`, confirmLabel: 'Reset progress', destructive: true })) run([e], 'reset');
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reset progress…
                    </DropdownMenuItem>}
                    {e.status === 'Withdrawn' ? (
                      <DropdownMenuItem className="text-[14px]" onSelect={() => run([e], 'restore')}>
                        <Undo2 className="h-3.5 w-3.5" /> Restore enrollment
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        className="text-[14px] text-destructive focus:text-destructive"
                        onSelect={async () => {
                          if (await app.confirm({ title: `Withdraw ${e.personName}?`, description: 'They lose access to the course and it no longer counts toward reports. You can restore it later with progress intact.', confirmLabel: 'Withdraw', destructive: true })) run([e], 'withdraw');
                        }}
                      >
                        <UserMinus className="h-3.5 w-3.5" /> Withdraw…
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild className="text-[14px]">
                      <Link to={`/people/${e.personId}`} onClick={onClose}><ArrowUpRight className="h-3.5 w-3.5" /> Open learner</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="text-[14px]">
                      <Link to={`/courses/${e.courseId}/learners`} onClick={onClose}><ArrowUpRight className="h-3.5 w-3.5" /> Open course</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <IconButton aria-label="Close" onClick={onClose}>
                  <X />
                </IconButton>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <section className="space-y-4 border-b px-5 py-4">
                <div className="flex items-center gap-3">
                  <StatusGlyph status={e.status} progress={e.progress} dueState={e.dueState} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[16px] font-medium', STATUS_META[e.status].tone)}>{STATUS_META[e.status].label}</span>
                      <DuePill dueDate={e.dueDate} dueState={e.dueState} />
                    </div>
                    <ProgressMeter value={e.progress} status={e.status} className="mt-1.5 max-w-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  <Stat label="Due">
                    {e.status === 'Completed' || e.status === 'Withdrawn' ? (
                      e.dueDate ? shortDate(e.dueDate) : '—'
                    ) : (
                      <DatePicker
                        value={e.dueDate}
                        onChange={d => run([e], 'set_due', { dueDate: d })}
                        clearLabel="Remove due date"
                        trigger={
                          <button type="button" className="ghost-chip -ml-2 h-6 px-2 text-[14px]">
                            <CalendarDays className="h-3 w-3 text-muted-foreground" /> {e.dueDate ? shortDate(e.dueDate) : 'Set date'}
                          </button>
                        }
                      />
                    )}
                  </Stat>
                  <Stat label="Quiz score">
                    <Score value={e.score} />
                  </Stat>
                  <Stat label="Time spent">{e.timeSpentSeconds ? formatDuration(e.timeSpentSeconds) : '—'}</Stat>
                  <Stat label="Last activity">{e.lastActivityAt ? timeAgo(e.lastActivityAt) : 'Not yet'}</Stat>
                  <Stat label="Enrolled">
                    <Tip label={dateTime(e.enrolledAt)}>
                      <span>{shortDate(e.enrolledAt)}</span>
                    </Tip>
                  </Stat>
                  <Stat label="Via">{e.source === 'Assigned' && e.assignedByName ? `${e.assignedByName}` : SOURCE_LABEL[e.source] ?? e.source}</Stat>
                  <Stat label="Started">{e.startedAt ? shortDate(e.startedAt) : '—'}</Stat>
                  <Stat label="Completed">{e.completedAt ? shortDate(e.completedAt) : '—'}</Stat>
                </div>
                {(data.certificate || data.path || data.cycles.length > 1) && (
                  <div className="flex flex-wrap gap-2">
                    {data.certificate && (
                      <Link to={`/certificates?q=${data.certificate.credentialId}`} onClick={onClose} className="chip h-8 gap-1.5 bg-flame/[0.08] hover:bg-flame/[0.14]">
                        <Award className="h-3.5 w-3.5 text-flame" />
                        <span className="font-mono text-sm">{data.certificate.credentialId}</span>
                        <span className="text-muted-foreground">{data.certificate.status === 'Revoked' ? 'revoked' : data.certificate.expiresAt ? `expires ${shortDate(data.certificate.expiresAt)}` : 'no expiry'}</span>
                      </Link>
                    )}
                    {data.path && (
                      <Link to={`/paths/${data.path.id}`} onClick={onClose} className="chip h-8 gap-1.5 hover:bg-accent">
                        <Route className="h-3.5 w-3.5 text-muted-foreground" /> {data.path.title} <span className="text-muted-foreground">{data.path.progress}%</span>
                      </Link>
                    )}
                    {data.cycles.length > 1 && (
                      <span className="chip h-8 gap-1.5">
                        <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" /> Cycle {e.cycle} of {data.cycles.length}
                        <span className="text-muted-foreground">· last completed {data.cycles.find(c => c.status === 'Completed' && c.id !== e.id)?.completedAt ? shortDate(data.cycles.find(c => c.status === 'Completed' && c.id !== e.id)!.completedAt) : '—'}</span>
                      </span>
                    )}
                  </div>
                )}
              </section>

              <section className="border-b px-5 py-4">
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">Lessons</h3>
                <div className="space-y-3">
                  {[{ id: null as string | null, title: '' }, ...data.sections].map(section => {
                    const lessons = data.lessons.filter(l => l.sectionId === section.id);
                    if (!lessons.length) return null;
                    return (
                      <div key={section.id ?? 'none'}>
                        {section.title && <div className="mb-1 truncate text-sm text-muted-foreground">{section.title}</div>}
                        <div className="overflow-hidden rounded-lg border">
                          {lessons.map(l => {
                            const attempts = data.attempts.filter(a => a.lessonId === l.id);
                            const subs = data.submissions.filter(s => s.lessonId === l.id);
                            return (
                              <div key={l.id} className="border-b px-3 py-2 last:border-0">
                                <div className="flex items-center gap-2.5 text-[14px]">
                                  <StatusGlyph status={l.status} progress={l.status === 'In progress' ? 45 : 0} size={14} />
                                  <LessonTypeIcon type={l.type} />
                                  <span className={cn('min-w-0 flex-1 truncate', l.status === 'Not started' && 'text-muted-foreground')}>{l.title}</span>
                                  {l.optional && <span className="text-2xs text-muted-foreground">Optional</span>}
                                  {l.score != null && <Score value={l.score} className="text-sm" />}
                                  <span className="flex w-14 items-center justify-end gap-1 text-sm tabular-nums text-muted-foreground">
                                    {l.timeSpentSeconds > 0 && (
                                      <>
                                        <Clock3 className="h-3 w-3" /> {formatDuration(l.timeSpentSeconds)}
                                      </>
                                    )}
                                  </span>
                                </div>
                                {(attempts.length > 0 || subs.length > 0) && (
                                  <div className="ml-[46px] mt-1 space-y-0.5 text-sm text-muted-foreground">
                                    {attempts.map(a => (
                                      <div key={a.id} className="flex items-center gap-2">
                                        <span>Attempt {a.number}</span>
                                        <span className={cn('tabular-nums', a.passed ? 'text-foreground/80' : 'text-tone-warning')}>{Math.round(a.score)}% · {a.passed ? 'passed' : 'not passed'}</span>
                                        <span className="ml-auto">{shortDate(a.submittedAt)}</span>
                                      </div>
                                    ))}
                                    {subs.map(s => (
                                      <div key={s.id} className="flex items-center gap-2">
                                        <span>Submission {s.attempt}</span>
                                        <span className={s.status === 'Needs revision' ? 'text-tone-warning' : 'text-foreground/80'}>
                                          {s.status === 'Submitted' ? 'Waiting for grading' : `${s.status}${s.grade != null ? ` · ${s.grade}` : ''}`}
                                        </span>
                                        {s.status === 'Submitted' && (
                                          <Link to={`/grading/${s.id}`} onClick={onClose} className="text-primary hover:underline">
                                            Grade
                                          </Link>
                                        )}
                                        <span className="ml-auto">{shortDate(s.submittedAt)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="px-5 py-4">
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">Activity</h3>
                {data.activity.length === 0 ? (
                  <p className="text-[14px] text-muted-foreground">Nothing has happened yet.</p>
                ) : (
                  <ol className="space-y-0.5">
                    {data.activity.map(a => (
                      <li key={a.id} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-start gap-x-2 text-[14px] leading-5">
                        <span className="flex h-5 justify-center" aria-hidden>
                          <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                        </span>
                        <span className="pb-1.5">{activityText(a.type, a.data, { actor: a.actorName, subject: e.personName, lessonTitle: data.lessons.find(l => l.id === a.lessonId)?.title })}</span>
                        <Tip label={dateTime(a.occurredAt)}>
                          <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{timeAgo(a.occurredAt)}</span>
                        </Tip>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
