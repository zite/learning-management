import { isPast, parseISO } from 'date-fns';
import { ArrowLeft, ArrowRight, CalendarClock, Check, CheckCircle2, Clock, ExternalLink, Eye, Lock, MapPin, Paperclip, RotateCcw, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@project/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { cn } from '@project/components/lib/utils';
import {
  canTrackWatchProgress, formatMinutes, gradeQuiz, LESSON_TYPE_META, mayRevealAnswers, parseAssignmentSettings, parseChecklistSettings, parseEmbedSettings, parseQuizSettings, parseVideoSettings,
  type LessonType, type QuizAnswers, type QuizResult,
} from '@project/shared/lessons';
import { EmbedFrame, FileLesson, VideoEmbed } from '@project/shared/ui/LessonMedia';
import { Markdown } from '@project/shared/ui/Markdown';
import { dateTime } from '../../lib/format';
import { shouldIgnore } from '../../lib/hotkeys';
import type { CourseDetail, CourseLesson } from '../../lib/types';
import { IconButton, Kbd, Tip } from '../primitives/bits';
import { LessonTypeIcon } from '../primitives/icons';
import { buildOutline, lessonLabel } from './model';

/**
 * The lesson as a learner sees it — the same Markdown and media components the
 * learner app renders, with quizzes, checklists and assignments you can try
 * out here without recording anything.
 */
export function PreviewDialog({ open, onOpenChange, detail, lessonId, onNavigate, learnUrl }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: CourseDetail;
  lessonId: string | null;
  onNavigate: (lessonId: string) => void;
  learnUrl: string | null;
}) {
  const { ordered, sections } = useMemo(() => buildOutline(detail), [detail]);
  const index = ordered.findIndex(l => l.id === lessonId);
  const lesson = index >= 0 ? ordered[index] : null;
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  const section = lesson?.sectionId ? sections.find(s => s.id === lesson.sectionId) : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnore(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev.id);
      if (e.key === 'ArrowRight' && next) onNavigate(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, prev, next, onNavigate]);

  // Learners can only open published courses, so the academy link only appears for one.
  const learnerLink = learnUrl && lesson && detail.course.status === 'Published' ? `${learnUrl.replace(/\/+$/, '')}/#/learn/${detail.course.slug || detail.course.id}/${lesson.id}` : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92dvh] max-w-[860px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl [&>button.absolute]:hidden" onOpenAutoFocus={e => e.preventDefault()}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
          <span className="chip-soft gap-1.5 text-tone-accent">
            <Eye className="h-3 w-3" /> Learner preview
          </span>
          <DialogTitle className="sr-only">Preview: {lesson ? lessonLabel(lesson) : 'lesson'}</DialogTitle>
          <DialogDescription className="sr-only">How this lesson looks to learners. Nothing you do here is recorded.</DialogDescription>
          {index >= 0 && <span className="hidden text-sm tabular-nums text-muted-foreground sm:inline">Lesson {index + 1} of {ordered.length}</span>}
          <div className="ml-auto flex items-center gap-1">
            <Tip label="Previous lesson" keys={['←']}>
              <IconButton aria-label="Previous lesson" disabled={!prev} onClick={() => prev && onNavigate(prev.id)}>
                <ArrowLeft />
              </IconButton>
            </Tip>
            <Tip label="Next lesson" keys={['→']}>
              <IconButton aria-label="Next lesson" disabled={!next} onClick={() => next && onNavigate(next.id)}>
                <ArrowRight />
              </IconButton>
            </Tip>
            {learnerLink && (
              <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-[13.5px]">
                <a href={learnerLink} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="!h-3.5 !w-3.5" /> <span className="hidden sm:inline">Open in the academy</span>
                </a>
              </Button>
            )}
            <Tip label="Close" keys={['Esc']}>
              <IconButton aria-label="Close preview" onClick={() => onOpenChange(false)}>
                <X />
              </IconButton>
            </Tip>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
          {lesson ? (
            <article key={lesson.id} className="mx-auto max-w-[720px] px-5 pb-16 pt-8 sm:px-8 animate-fade-in">
              <p className="truncate text-sm text-muted-foreground">
                {detail.course.title}
                {section ? ` · ${section.title}` : ''}
              </p>
              <h1 className="mt-1.5 font-serif text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">{lessonLabel(lesson)}</h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <LessonTypeIcon type={lesson.type} /> {LESSON_TYPE_META[lesson.type as LessonType].verb}
                </span>
                {lesson.durationMinutes > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {formatMinutes(lesson.durationMinutes)}
                  </span>
                )}
                {lesson.optional && <span className="chip-soft">Optional</span>}
                {detail.course.sequential && <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Unlocks in order</span>}
              </div>
              <div className="mt-7">
                <LessonBody lesson={lesson} detail={detail} />
              </div>
            </article>
          ) : (
            <p className="px-6 py-16 text-center text-[14px] text-muted-foreground">Choose a lesson to preview.</p>
          )}
        </div>
        <div className="hidden h-9 shrink-0 items-center justify-center gap-1.5 border-t bg-background text-2xs text-muted-foreground sm:flex">
          Nothing you do in the preview is recorded · <Kbd>←</Kbd> <Kbd>→</Kbd> move between lessons
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LessonBody({ lesson, detail }: { lesson: CourseLesson; detail: CourseDetail }) {
  switch (lesson.type) {
    case 'Video': {
      const s = parseVideoSettings(lesson.settings);
      // A watch requirement only applies where the player reports progress; elsewhere learners complete it themselves.
      const gated = s.requiredWatchShare > 0 && canTrackWatchProgress(lesson.mediaUrl);
      return (
        <div className="space-y-6">
          <VideoEmbed url={lesson.mediaUrl} title={lesson.title} />
          <Markdown>{lesson.body}</Markdown>
          <CompleteBar label={gated ? `Watch ${Math.round(s.requiredWatchShare * 100)}% of the video to complete` : 'Mark complete'} disabled={gated} />
        </div>
      );
    }
    case 'File':
      return (
        <div className="space-y-6">
          <FileLesson url={lesson.mediaUrl} name={lesson.mediaName} />
          <Markdown>{lesson.body}</Markdown>
          <CompleteBar label="Mark complete" />
        </div>
      );
    case 'Embed': {
      const s = parseEmbedSettings(lesson.settings);
      return (
        <div className="space-y-6">
          <Markdown>{lesson.body}</Markdown>
          <EmbedFrame url={lesson.mediaUrl} height={s.height} title={lesson.title} />
          <CompleteBar label="Mark complete" />
        </div>
      );
    }
    case 'Quiz':
      return <QuizPreview lesson={lesson} />;
    case 'Assignment':
      return <AssignmentPreview lesson={lesson} />;
    case 'Checklist':
      return <ChecklistPreview lesson={lesson} />;
    case 'Live session':
      return <SessionPreview lesson={lesson} detail={detail} />;
    default:
      return (
        <div className="space-y-8">
          {lesson.body.trim() ? <Markdown className="text-[16px] leading-7">{lesson.body}</Markdown> : <Empty text="This article is empty." />}
          <CompleteBar label="Mark complete" />
        </div>
      );
  }
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed px-6 py-10 text-center text-[14px] text-muted-foreground">{text}</p>;
}

function CompleteBar({ label, disabled, hint }: { label: string; disabled?: boolean; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 border-t pt-6 sm:flex-row sm:justify-between">
      <span className="text-sm text-muted-foreground">{hint ?? 'In the learner app this records their progress.'}</span>
      <Button size="sm" className="h-9 gap-1.5 px-4 text-[14px]" disabled={disabled}>
        <Check className="!h-4 !w-4" /> {label}
      </Button>
    </div>
  );
}

function QuizPreview({ lesson }: { lesson: CourseLesson }) {
  const quiz = parseQuizSettings(lesson.settings);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const reveal = result ? mayRevealAnswers(quiz, result.passed, 1) : false;
  const answered = quiz.questions.filter(q => {
    const a = answers[q.id];
    return Array.isArray(a) ? a.length > 0 : typeof a === 'string' && a.trim();
  }).length;

  return (
    <div className="space-y-6">
      <Markdown>{lesson.body}</Markdown>
      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
        <span className="chip-soft">{quiz.questions.length} questions</span>
        <span className="chip-soft">Pass with {quiz.passingScore}%</span>
        <span className="chip-soft">{quiz.maxAttempts ? `${quiz.maxAttempts} attempt${quiz.maxAttempts === 1 ? '' : 's'}` : 'Unlimited attempts'}</span>
        {quiz.timeLimitMinutes && <span className="chip-soft">{quiz.timeLimitMinutes} min limit</span>}
      </div>
      {!quiz.questions.length && <Empty text="This quiz has no questions yet." />}
      <ol className="space-y-4">
        {quiz.questions.map((q, i) => {
          const r = result?.results.find(x => x.id === q.id);
          const given = answers[q.id];
          return (
            <li key={q.id} className={cn('rounded-xl border bg-card p-4 shadow-2xs', r && (r.correct ? 'border-tone-success/40' : 'border-tone-danger/40'))}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15.5px] font-medium leading-snug">
                  <span className="mr-1.5 tabular-nums text-muted-foreground">{i + 1}.</span>
                  {q.prompt || <span className="text-muted-foreground">No prompt yet</span>}
                </p>
                {r ? (r.correct ? <CheckCircle2 className="h-5 w-5 shrink-0 text-tone-success" /> : <XCircle className="h-5 w-5 shrink-0 text-tone-danger" />) : <span className="shrink-0 text-2xs text-muted-foreground">{q.points} pt{q.points === 1 ? '' : 's'}</span>}
              </div>
              {q.type === 'multiple' && <p className="mt-1 text-sm text-muted-foreground">Select all that apply</p>}
              {q.type === 'short' ? (
                <input
                  aria-label={`Answer to question ${i + 1}`}
                  disabled={Boolean(result)}
                  value={typeof given === 'string' ? given : ''}
                  onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                  placeholder="Type your answer"
                  className="mt-3 h-10 w-full rounded-lg border border-input bg-background px-3 text-[15px] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
                />
              ) : (
                <div className="mt-3 space-y-1.5">
                  {q.options.map(o => {
                    const picked = Array.isArray(given) ? given.includes(o.id) : given === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={Boolean(result)}
                        onClick={() =>
                          setAnswers(a => {
                            if (q.type !== 'multiple') return { ...a, [q.id]: [o.id] };
                            const cur = Array.isArray(a[q.id]) ? (a[q.id] as string[]) : [];
                            return { ...a, [q.id]: cur.includes(o.id) ? cur.filter(x => x !== o.id) : [...cur, o.id] };
                          })
                        }
                        className={cn(
                          'flex min-h-10 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-[15px] transition-colors disabled:cursor-default',
                          picked ? 'border-primary bg-primary/[0.06]' : 'bg-background hover:bg-accent',
                          reveal && o.correct && 'border-tone-success bg-tone-success/[0.08]',
                        )}
                      >
                        <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center border', q.type === 'multiple' ? 'rounded' : 'rounded-full', picked ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                          {picked && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1">{o.text || <span className="text-muted-foreground">Empty choice</span>}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {reveal && r && (
                <div className="mt-3 space-y-1 rounded-lg bg-subtle px-3 py-2 text-[14px]">
                  {q.type === 'short' && <p><span className="font-medium">Accepted:</span> {q.acceptedAnswers.join(', ') || '—'}</p>}
                  {q.explanation && <p className="text-muted-foreground">{q.explanation}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {quiz.questions.length > 0 && (
        <div className="flex flex-col items-center gap-3 border-t pt-6 sm:flex-row sm:justify-between">
          {result ? (
            <p className={cn('text-[15px] font-medium', result.passed ? 'text-tone-success' : 'text-tone-danger')}>
              {result.score}% — {result.passed ? 'Passed' : `Not passed (needs ${quiz.passingScore}%)`}
              {!reveal && <span className="ml-2 font-normal text-muted-foreground">Answers stay hidden for learners here.</span>}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{answered} of {quiz.questions.length} answered</p>
          )}
          {result ? (
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-[14px]" onClick={() => { setResult(null); setAnswers({}); }}>
              <RotateCcw className="!h-3.5 !w-3.5" /> Try again
            </Button>
          ) : (
            <Button size="sm" className="h-9 px-4 text-[14px]" onClick={() => setResult(gradeQuiz(quiz, answers))}>
              Submit answers
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function AssignmentPreview({ lesson }: { lesson: CourseLesson }) {
  const s = parseAssignmentSettings(lesson.settings);
  const [text, setText] = useState('');
  return (
    <div className="space-y-6">
      {lesson.body.trim() ? <Markdown className="text-[16px] leading-7">{lesson.body}</Markdown> : <Empty text="No instructions yet." />}
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-2xs">
        <p className="text-[15px] font-medium">Your submission</p>
        {s.submissionType !== 'file' && (
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5} placeholder="Write your response…" className="block w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15" />
        )}
        {s.submissionType !== 'text' && (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-[14px] text-muted-foreground">
            <Paperclip className="h-4 w-4" /> Attach files
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">An instructor grades it. {s.passingGrade}% or higher passes.</span>
          <Button size="sm" className="h-9 px-4 text-[14px]" disabled>Submit for grading</Button>
        </div>
      </div>
    </div>
  );
}

function ChecklistPreview({ lesson }: { lesson: CourseLesson }) {
  const { items } = parseChecklistSettings(lesson.settings);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  return (
    <div className="space-y-6">
      <Markdown>{lesson.body}</Markdown>
      {items.length ? (
        <ul className="divide-y rounded-xl border bg-card shadow-2xs">
          {items.map(it => {
            const on = checked.has(it.id);
            return (
              <li key={it.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChecked(c => {
                    const next = new Set(c);
                    if (on) next.delete(it.id);
                    else next.add(it.id);
                    return next;
                  })}
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] transition-colors hover:bg-accent/50"
                >
                  <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors', on ? 'border-tone-success bg-tone-success text-white' : 'border-input bg-background')}>
                    {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                  <span className={cn(on && 'text-muted-foreground line-through decoration-muted-foreground/50')}>{it.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty text="This checklist has no items yet." />
      )}
      <CompleteBar label="Complete" disabled={checked.size < items.length || !items.length} hint={`${checked.size} of ${items.length} done — tick every item to complete.`} />
    </div>
  );
}

function SessionPreview({ lesson, detail }: { lesson: CourseLesson; detail: CourseDetail }) {
  const sessions = detail.sessions.filter(s => s.lessonId === lesson.id && s.status !== 'Cancelled' && !(s.startsAt && isPast(parseISO(s.startsAt))));
  return (
    <div className="space-y-6">
      <Markdown>{lesson.body}</Markdown>
      {sessions.length ? (
        <ul className="space-y-2">
          {sessions.map(s => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-2xs">
              <CalendarClock className="h-5 w-5 shrink-0 text-tone-success" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{s.startsAt ? dateTime(s.startsAt) : 'Date to be announced'}</span>
                <span className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3 w-3" /> {s.location || (s.meetingUrl ? 'Online' : 'Location to be announced')}
                  {s.capacity != null && ` · ${Math.max(0, s.capacity - s.registered)} places left`}
                </span>
              </span>
              <Button size="sm" className="h-9 px-4 text-[14px]" disabled>Register</Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text="No upcoming sessions. Learners can mark this lesson complete themselves until one is scheduled." />
      )}
      <CompleteBar label={sessions.length ? 'Completes when you attend' : 'Mark complete'} disabled={sessions.length > 0} />
    </div>
  );
}
