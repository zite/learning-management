import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, CircleCheck, CircleX, RotateCcw, Timer, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { submitQuiz, trackLesson, type SubmitQuizOutputType } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Markdown } from '@project/shared/ui/Markdown';
import { errorMessage } from '../../lib/errors';
import { shortDateTime } from '../../lib/format';
import { MOD } from '../../lib/hotkeys';
import { Button } from '../ui';
import { ConfirmDialog, formatClock, Kbd, revealInScroller, ScoreRing } from './bits';
import type { LessonControls } from './LessonView';
import { playerKeys, refreshProgressEverywhere, type QuizData, type QuizReview } from './queries';

/**
 * A quiz, start to finish: what it asks of you, the questions one card at a
 * time down the page, a clear result, and — when the quiz allows it — what
 * the right answers were and why.
 */

type Answers = Record<string, string[] | string>;
type Mode = 'intro' | 'taking' | 'result' | 'review';
type Question = QuizData['questions'][number];

const readAnswers = (key: string): Answers | null => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Answers) : null;
  } catch {
    return null;
  }
};
const writeAnswers = (key: string, a: Answers | null) => {
  try {
    if (a) sessionStorage.setItem(key, JSON.stringify(a));
    else sessionStorage.removeItem(key);
  } catch {
    /* private mode — answers just aren't kept across a reload */
  }
};

const isAnswered = (q: Question, a: Answers) => {
  const v = a[q.id];
  return q.type === 'short' ? typeof v === 'string' && v.trim().length > 0 : Array.isArray(v) && v.length > 0;
};

export function QuizLesson({ controls }: { controls: LessonControls }) {
  const { data, slug, setPrimary, setFocusMode, setQuietFooter, onCompleted, goNext, setGate } = controls;
  const quiz = data.quiz!;
  const qc = useQueryClient();
  const lessonId = data.lesson.id;
  const storageKey = `lms:quiz:${lessonId}:${quiz.nextAttempt}`;

  const [mode, setMode] = useState<Mode>('intro');
  const [answers, setAnswers] = useState<Answers>(() => readAnswers(storageKey) ?? {});
  const [startedAt, setStartedAt] = useState<string | null>(quiz.startedAt);
  const [result, setResult] = useState<SubmitQuizOutputType | null>(null);
  const [reviewSource, setReviewSource] = useState<'result' | 'latest'>('result');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  const questions = quiz.questions;
  const answered = questions.filter(q => isAnswered(q, answers)).length;
  const outOfAttempts = quiz.attemptsLeft === 0;
  const canStart = !outOfAttempts && questions.length > 0;
  const resumable = Boolean(quiz.startedAt) && canStart;

  useEffect(() => {
    setGate({ ready: false, hint: quiz.passed ? null : outOfAttempts ? 'No attempts left — ask your instructor for another' : passRule(quiz.passingScore) });
  }, [quiz.passed, outOfAttempts, quiz.passingScore, setGate]);

  const scrollTop = () => window.setTimeout(() => revealInScroller(topRef.current, { offset: 24 }), 30);

  const start = useCallback(async () => {
    if (!canStart || starting) return;
    setStarting(true);
    let at = new Date().toISOString();
    try {
      const res = await trackLesson({ lessonId, courseSlug: slug, state: { quizStarted: true } });
      if (typeof res.state.quizStartedAt === 'string') at = res.state.quizStartedAt;
    } catch {
      /* the server will fall back to the browser's clock */
    }
    if (at !== quiz.startedAt) {
      setAnswers({});
      writeAnswers(storageKey, null);
    }
    setStartedAt(at);
    setResult(null);
    setStarting(false);
    setMode('taking');
    setFocusMode(true);
    scrollTop();
  }, [canStart, starting, lessonId, slug, quiz.startedAt, storageKey, setFocusMode]);

  const mutation = useMutation({
    mutationFn: (a: Answers) => submitQuiz({ lessonId, courseSlug: slug, answers: a, startedAt: startedAt ?? undefined }),
    onSuccess: res => {
      writeAnswers(storageKey, null);
      setResult(res);
      setReviewSource('result');
      setMode('result');
      setFocusMode(false);
      if (res.passed) onCompleted(res);
      else {
        refreshProgressEverywhere(qc, slug);
        void qc.invalidateQueries({ queryKey: playerKeys.lesson(slug, lessonId) });
      }
      scrollTop();
      window.setTimeout(() => resultHeadingRef.current?.focus({ preventScroll: true }), 80);
    },
    onError: e => {
      const msg = errorMessage(e, "Your answers couldn't be submitted. Check your connection and try again.");
      toast.error(msg);
      if (/time limit|attempts/i.test(msg)) {
        writeAnswers(storageKey, null);
        setMode('intro');
        setFocusMode(false);
        void qc.invalidateQueries({ queryKey: playerKeys.lesson(slug, lessonId) });
      }
    },
  });

  const submitNow = useCallback(() => {
    if (!mutation.isPending) mutation.mutate(answers);
  }, [mutation, answers]);

  const trySubmit = useCallback(() => {
    if (mutation.isPending) return;
    if (answered < questions.length) setConfirmOpen(true);
    else submitNow();
  }, [answered, questions.length, submitNow, mutation.isPending]);

  const retry = useCallback(async () => {
    setResult(null);
    await qc.refetchQueries({ queryKey: playerKeys.lesson(slug, lessonId) });
    setMode('intro');
  }, [qc, slug, lessonId]);

  // Starting a retry once fresh questions (a new shuffle) have arrived.
  const pendingStart = useRef(false);
  useEffect(() => {
    if (pendingStart.current && mode === 'intro') {
      pendingStart.current = false;
      void start();
    }
  }, [quiz.nextAttempt, mode, start]);

  // ⌘↵ does the obvious thing in each state.
  useEffect(() => {
    if (mode === 'taking') setPrimary(trySubmit);
    else if (mode === 'intro' && canStart && !quiz.passed) setPrimary(() => void start());
    else if (mode === 'result' && result && !result.passed && result.attemptsLeft !== 0) setPrimary(() => {
      pendingStart.current = true;
      void retry();
    });
    else setPrimary(null);
    return () => setPrimary(null);
  }, [mode, trySubmit, start, retry, canStart, quiz.passed, result, setPrimary]);

  // A result or a review carries its own next step; the footer keeps just the lesson links meanwhile.
  useEffect(() => setQuietFooter(mode === 'result' || mode === 'review'), [mode, setQuietFooter]);

  // Leaving mid-quiz shouldn't strand the page in focus mode.
  useEffect(() => () => setFocusMode(false), [setFocusMode]);

  const setAnswer = (id: string, value: string[] | string) => {
    setAnswers(prev => {
      const next = { ...prev, [id]: value };
      writeAnswers(storageKey, next);
      return next;
    });
  };

  const reviewData: { questions: QuizReview; score: number; passed: boolean; number: number } | null =
    reviewSource === 'result' && result?.review
      ? { questions: result.review, score: result.score, passed: result.passed, number: result.attempt.number }
      : quiz.review
        ? { questions: quiz.review.questions, score: quiz.review.score, passed: quiz.review.passed, number: quiz.review.attemptNumber }
        : null;

  return (
    <div ref={topRef} className="scroll-mt-4">
      {mode === 'intro' && (
        <QuizIntro
          data={data}
          quiz={quiz}
          canStart={canStart}
          resumable={resumable}
          starting={starting}
          onStart={() => void start()}
          onReview={() => {
            setReviewSource('latest');
            setMode('review');
            scrollTop();
          }}
        />
      )}

      {mode === 'taking' && (
        <div>
          {quiz.timeLimitMinutes && startedAt && <Countdown startedAt={startedAt} minutes={quiz.timeLimitMinutes} onExpire={submitNow} />}
          <ol className="space-y-4">
            {questions.map((q, i) => (
              <li key={q.id}>
                <QuestionCard question={q} index={i} total={questions.length} value={answers[q.id]} onChange={v => setAnswer(q.id, v)} />
              </li>
            ))}
          </ol>
          <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t bg-background/95 px-4 pt-3 backdrop-blur sm:bottom-4 sm:mx-0 sm:rounded-2xl sm:border sm:px-5 sm:py-3 sm:shadow-lg" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" aria-live="polite">
                  <span className="tabular-nums">{answered}</span> of <span className="tabular-nums">{questions.length}</span> answered
                </p>
                <div className="mt-1.5 flex gap-1" aria-hidden>
                  {questions.map(q => (
                    <span key={q.id} className={cn('h-1.5 flex-1 rounded-full transition-colors', isAnswered(q, answers) ? 'bg-primary' : 'bg-muted')} />
                  ))}
                </div>
              </div>
              <Button variant="ghost" onClick={() => { setMode('intro'); setFocusMode(false); scrollTop(); }} className="hidden text-muted-foreground sm:inline-flex" disabled={mutation.isPending}>
                Continue later
              </Button>
              <Button size="lg" onClick={trySubmit} loading={mutation.isPending}>
                Submit <Kbd className="ml-1 hidden border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground sm:inline-flex">{MOD}↵</Kbd>
              </Button>
            </div>
          </div>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={`Submit with ${questions.length - answered} unanswered?`}
            description={`Unanswered questions count as incorrect.${quiz.attemptsLeft == null ? '' : quiz.attemptsLeft <= 1 ? ' This uses your last attempt.' : ` This uses one of your ${quiz.attemptsLeft} remaining attempts.`}`}
            confirmLabel="Submit anyway"
            cancelLabel="Keep answering"
            onConfirm={() => {
              setConfirmOpen(false);
              submitNow();
            }}
          />
        </div>
      )}

      {mode === 'result' && result && (
        <QuizResult
          result={result}
          headingRef={resultHeadingRef}
          canReview={Boolean(result.review)}
          revealRule={quiz.revealAnswers}
          onReview={() => {
            setReviewSource('result');
            setMode('review');
            scrollTop();
          }}
          onRetry={() => {
            pendingStart.current = true;
            void retry();
          }}
          // On the last lesson of a course that's now complete, the course ending below has the next steps.
          onContinue={result.status === 'Completed' && !data.nextId ? null : () => goNext()}
        />
      )}

      {mode === 'review' && reviewData && (
        <div>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl font-semibold">Review: attempt {reviewData.number}</h2>
              <p className="text-sm text-muted-foreground">
                {reviewData.score}% · {reviewData.passed ? 'Passed' : 'Not passed'} · {reviewData.questions.filter(q => q.correct).length} of {reviewData.questions.length} correct
              </p>
            </div>
            <Button variant="secondary" onClick={() => setMode(result ? 'result' : 'intro')}>
              {result ? 'Back to results' : 'Back to the quiz'}
            </Button>
          </div>
          <ol className="space-y-4">
            {reviewData.questions.map((r, i) => {
              const q = questions.find(x => x.id === r.id);
              return q ? (
                <li key={r.id}>
                  <ReviewCard question={q} review={r} index={i} />
                </li>
              ) : null;
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

/** What passing takes, in words: "Score 80% or higher to pass", or every answer right when the mark is 100%. */
export const passRule = (score: number) => (score >= 100 ? 'Answer every question correctly to pass.' : `Score ${score}% or higher to pass.`);

const revealRule = (rule: QuizData['revealAnswers']) =>
  rule === 'never' ? 'Correct answers aren’t shown.' : rule === 'after_pass' ? 'Correct answers are shown once you pass.' : 'You’ll see the correct answers after each attempt.';

function QuizIntro({ data, quiz, canStart, resumable, starting, onStart, onReview }: { data: LessonControls['data']; quiz: QuizData; canStart: boolean; resumable: boolean; starting: boolean; onStart: () => void; onReview: () => void }) {
  const attempts = quiz.attempts;
  const empty = quiz.questions.length === 0;
  const outOfAttempts = !quiz.passed && !canStart && !empty;
  const stats = [
    { label: 'Questions', value: String(quiz.questions.length) },
    { label: 'Pass mark', value: `${quiz.passingScore}%` },
    { label: 'Attempts', value: quiz.attemptsLeft == null ? 'Unlimited' : `${quiz.attemptsLeft} of ${quiz.maxAttempts} left` },
    { label: 'Time limit', value: quiz.timeLimitMinutes ? `${quiz.timeLimitMinutes} min` : 'None' },
  ];

  let note: React.ReactNode;
  if (empty) note = 'This quiz doesn’t have any questions yet. Check back soon.';
  else if (outOfAttempts)
    note = (
      <span className="text-foreground/85">
        <span className="font-medium text-tone-danger">You’ve used every attempt.</span> Your best score was {quiz.bestScore ?? 0}%. Ask your instructor if you’d like another try.
      </span>
    );
  else if (quiz.passed)
    note = (
      <span className="text-foreground/85">
        <span className="font-medium text-tone-success">You passed{quiz.bestScore != null ? ` with ${quiz.bestScore}%` : ''}.</span> {canStart ? 'Retake it any time — your best score counts.' : 'This lesson is complete.'}
      </span>
    );
  else if (resumable) {
    const left = quiz.timeLimitMinutes && quiz.startedAt ? Date.parse(quiz.startedAt) + quiz.timeLimitMinutes * 60_000 - Date.now() : null;
    note = left == null ? 'You have an attempt in progress.' : left > 0 ? `You have an attempt in progress. Its clock kept running — about ${formatClock(left)} left.` : 'Your attempt ran out of time. Resume to submit what you answered.';
  }
  else note = `${passRule(quiz.passingScore)} ${revealRule(quiz.revealAnswers)}${quiz.timeLimitMinutes ? ' The clock starts when you start.' : ''}`;

  return (
    <div className="space-y-8">
      <section aria-label="About this quiz" className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="px-5 py-5 sm:px-6">
          {data.lesson.body.trim() ? <Markdown className="prose-lms sm:text-[16px]">{data.lesson.body}</Markdown> : <p className="text-[16px]">Answer each question, check your answers, then submit.</p>}
        </div>
        <dl className="grid grid-cols-2 gap-px border-y bg-border sm:grid-cols-4">
          {stats.map(st => (
            <div key={st.label} className="min-w-0 bg-card px-5 py-3 sm:px-6">
              <dt className="truncate text-xs text-muted-foreground">{st.label}</dt>
              <dd className="mt-0.5 truncate text-[15px] font-semibold tabular-nums">{st.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-sm leading-relaxed text-muted-foreground" aria-live="polite">
            {note}
          </p>
          {(canStart || quiz.review) && (
            <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center">
              {quiz.review && (
                <Button variant="ghost" onClick={onReview} className="text-muted-foreground">
                  Review attempt {quiz.review.attemptNumber}
                </Button>
              )}
              {canStart && (
                <Button size="lg" onClick={onStart} loading={starting} variant={quiz.passed && !resumable ? 'secondary' : 'primary'}>
                  {resumable ? 'Resume quiz' : attempts.length ? (quiz.passed ? 'Retake quiz' : 'Try again') : 'Start quiz'} <ArrowRight aria-hidden />
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      {attempts.length > 0 && (
        <section aria-labelledby="attempts-heading">
          <h2 id="attempts-heading" className="mb-2 text-sm font-medium text-muted-foreground">
            Your attempts
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {[...attempts].reverse().map(a => (
              <li key={a.number} className="grid grid-cols-[minmax(0,1fr)_auto_5.5rem] items-center gap-4 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">Attempt {a.number}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.submittedAt ? shortDateTime(a.submittedAt) : ''}</span>
                </span>
                <span className="text-right text-[15px] font-semibold tabular-nums">{a.score}%</span>
                <span className={cn('text-right text-sm', a.passed ? 'font-medium text-tone-success' : 'text-muted-foreground')}>{a.passed ? 'Passed' : 'Not passed'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Countdown({ startedAt, minutes, onExpire }: { startedAt: string; minutes: number; onExpire: () => void }) {
  const deadline = Date.parse(startedAt) + minutes * 60_000;
  const [left, setLeft] = useState(() => deadline - Date.now());
  const fired = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    const id = window.setInterval(() => {
      const ms = deadline - Date.now();
      setLeft(ms);
      if (ms <= 5 * 60_000 && ms > 5 * 60_000 - 1000) setAnnounce('Five minutes left');
      if (ms <= 60_000 && ms > 59_000) setAnnounce('One minute left');
      if (ms <= 0 && !fired.current) {
        fired.current = true;
        setAnnounce('Time is up. Submitting your answers.');
        expireRef.current();
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [deadline]);

  const urgent = left <= 60_000;
  const share = Math.max(0, Math.min(1, left / (minutes * 60_000)));
  return (
    <div className={cn('sticky top-0 z-10 -mx-4 mb-4 border-b px-4 py-2.5 backdrop-blur sm:top-3 sm:mx-0 sm:rounded-xl sm:border', urgent ? 'border-tone-danger/30 bg-tone-danger/[0.08]' : 'bg-background/90')}>
      <div className="flex items-center gap-3">
        <Timer className={cn('h-4 w-4 shrink-0', urgent ? 'text-tone-danger' : 'text-muted-foreground')} aria-hidden />
        <p className="flex-1 text-sm">
          {left > 0 ? (
            <>
              <span className={cn('font-semibold tabular-nums', urgent && 'text-tone-danger')}>{formatClock(left)}</span> <span className="text-muted-foreground">left · submits automatically when time runs out</span>
            </>
          ) : (
            <span className="font-semibold text-tone-danger">Time’s up — submitting…</span>
          )}
        </p>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn('h-full rounded-full transition-[width] duration-500', urgent ? 'bg-tone-danger' : 'bg-primary')} style={{ width: `${share * 100}%` }} />
      </div>
      <span className="sr-only" aria-live="assertive">
        {announce}
      </span>
    </div>
  );
}

const TYPE_HINT: Record<Question['type'], string> = { single: 'Choose one', multiple: 'Choose all that apply', true_false: 'True or false', short: 'Type your answer' };

function QuestionCard({ question: q, index, total, value, onChange }: { question: Question; index: number; total: number; value: string[] | string | undefined; onChange: (v: string[] | string) => void }) {
  const selected = Array.isArray(value) ? value : [];
  const name = `q-${q.id}`;
  return (
    <fieldset className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <legend className="sr-only">
        Question {index + 1} of {total}
      </legend>
      <p className="text-sm text-muted-foreground">
        Question {index + 1} <span className="text-faint">of {total}</span>
        <span aria-hidden className="text-faint"> · </span>
        {TYPE_HINT[q.type]}
      </p>
      <p className="mt-2 text-[17px] font-medium leading-snug sm:text-lg" id={`${name}-prompt`}>
        {q.prompt}
      </p>

      {q.type === 'true_false' && (
        <div className="mt-4 grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby={`${name}-prompt`}>
          {q.options.map(o => {
            const on = selected[0] === o.id;
            return (
              <label key={o.id} className={cn('flex h-16 cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] text-[17px] font-semibold transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/35', on ? 'border-primary bg-primary/[0.07] text-primary' : 'border-border bg-background hover:border-foreground/25 hover:bg-accent')}>
                <input type="radio" name={name} className="sr-only" checked={on} onChange={() => onChange([o.id])} />
                {on && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
                {o.text}
              </label>
            );
          })}
        </div>
      )}

      {(q.type === 'single' || q.type === 'multiple') && (
        <div className="mt-4 space-y-2" role={q.type === 'single' ? 'radiogroup' : 'group'} aria-labelledby={`${name}-prompt`}>
          {q.options.map((o, i) => {
            const on = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className={cn(
                  'flex min-h-[3.25rem] cursor-pointer items-center gap-3.5 rounded-xl border-[1.5px] px-4 py-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/35',
                  on ? 'border-primary bg-primary/[0.06]' : 'border-border bg-background hover:border-foreground/25 hover:bg-accent/70',
                )}
              >
                <input
                  type={q.type === 'single' ? 'radio' : 'checkbox'}
                  name={name}
                  className="sr-only"
                  checked={on}
                  onChange={() => onChange(q.type === 'single' ? [o.id] : on ? selected.filter(id => id !== o.id) : [...selected, o.id])}
                />
                <span
                  aria-hidden
                  className={cn(
                    'grid h-5 w-5 shrink-0 place-items-center border-[1.5px] transition-colors',
                    q.type === 'single' ? 'rounded-full' : 'rounded-[5px]',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                  )}
                >
                  {on && (q.type === 'single' ? <span className="h-2 w-2 rounded-full bg-primary-foreground" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />)}
                </span>
                <span className="min-w-0 flex-1 text-[15.5px] leading-snug">{o.text}</span>
                <span className="hidden text-xs font-medium text-faint sm:inline" aria-hidden>
                  {String.fromCharCode(65 + i)}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {q.type === 'short' && (
        <input
          type="text"
          aria-labelledby={`${name}-prompt`}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          maxLength={500}
          autoComplete="off"
          placeholder="Your answer"
          className="mt-4 h-12 w-full rounded-xl border-[1.5px] border-input bg-background px-4 text-[16px] shadow-xs placeholder:text-muted-foreground/80 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15"
        />
      )}
    </fieldset>
  );
}

function QuizResult({
  result,
  headingRef,
  canReview,
  revealRule,
  onReview,
  onRetry,
  onContinue,
}: {
  result: SubmitQuizOutputType;
  headingRef: React.RefObject<HTMLHeadingElement>;
  canReview: boolean;
  revealRule: QuizData['revealAnswers'];
  onReview: () => void;
  onRetry: () => void;
  onContinue: (() => void) | null;
}) {
  const retryable = result.attemptsLeft !== 0;
  return (
    <section className="overflow-hidden rounded-2xl border bg-card text-center shadow-sm animate-fade-up" aria-live="polite">
      <div className="px-6 pb-7 pt-9 sm:px-10">
        <ScoreRing value={result.score} passed={result.passed} />
        <h2 ref={headingRef} tabIndex={-1} className="mt-5 font-serif text-3xl font-semibold outline-none">
          {result.passed ? (result.score === 100 ? 'Perfect score' : 'You passed') : 'Not quite yet'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-muted-foreground">
          {result.earned} of {result.total} point{result.total === 1 ? '' : 's'}.{' '}
          {result.passed ? 'This lesson is complete.' : passRule(result.passingScore)}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {result.attemptsLeft == null ? 'Unlimited attempts' : result.attemptsLeft === 0 ? 'No attempts left' : `${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left`}
          {result.bestScore > result.score ? ` · your best is ${result.bestScore}%` : ''}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t bg-subtle px-6 py-4 sm:flex-row sm:justify-center">
        {canReview ? (
          <Button variant="secondary" size="lg" onClick={onReview}>
            Review answers
          </Button>
        ) : (
          <p className="self-center text-sm text-muted-foreground">{revealRule === 'after_pass' && !result.passed ? 'Correct answers are shown once you pass.' : revealRule === 'never' ? 'Answers aren’t shown for this quiz.' : ''}</p>
        )}
        {!result.passed && retryable && (
          <Button size="lg" onClick={onRetry}>
            <RotateCcw aria-hidden /> Try again
          </Button>
        )}
        {result.passed && onContinue && (
          <Button size="lg" onClick={onContinue}>
            Continue <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
      {!result.passed && !retryable && (
        <p className="border-t px-6 py-3 text-sm text-muted-foreground">
          <X className="mr-1 inline h-4 w-4 align-[-3px] text-tone-danger" aria-hidden />
          You’ve used every attempt. Ask your instructor if you’d like another try.
        </p>
      )}
    </section>
  );
}

function ReviewCard({ question: q, review: r, index }: { question: Question; review: QuizReview[number]; index: number }) {
  const correctIds = new Set(r.correctOptionIds);
  const selected = new Set(r.selected);
  return (
    <article className={cn('rounded-2xl border bg-card p-5 shadow-xs sm:p-6', r.correct ? 'border-tone-success/25' : 'border-tone-danger/25')}>
      <div className="flex items-start gap-3">
        {r.correct ? <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-tone-success" aria-label="Correct" /> : <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-tone-danger" aria-label="Incorrect" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">
            Question {index + 1}
            <span aria-hidden className="text-faint"> · </span>
            {r.correct ? <span className="font-medium text-tone-success">Correct</span> : <span className="font-medium text-tone-danger">Incorrect</span>}
          </p>
          <p className="mt-1.5 text-[16px] font-medium leading-snug">{q.prompt}</p>

          {q.type === 'short' ? (
            <div className="mt-3 space-y-1.5 text-[15px]">
              <p>
                <span className="text-muted-foreground">Your answer: </span>
                {r.answerText.trim() ? <span className="font-medium">{r.answerText}</span> : <span className="italic text-muted-foreground">No answer</span>}
              </p>
              <p>
                <span className="text-muted-foreground">Accepted: </span>
                {r.acceptedAnswers.map((a, i) => (
                  <span key={i} className="chip-soft mr-1.5">
                    {a}
                  </span>
                ))}
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {q.options.map(o => {
                const isCorrect = correctIds.has(o.id);
                const picked = selected.has(o.id);
                return (
                  <li
                    key={o.id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-[15px]',
                      isCorrect ? 'border-tone-success/35 bg-tone-success/[0.06]' : picked ? 'border-tone-danger/30 bg-tone-danger/[0.05]' : 'border-transparent bg-muted/40 text-muted-foreground',
                    )}
                  >
                    <span className="min-w-0 flex-1">{o.text}</span>
                    {picked && <span className={cn('text-xs font-medium', isCorrect ? 'text-tone-success' : 'text-tone-danger')}>Your answer</span>}
                    {isCorrect && !picked && <span className="text-xs font-medium text-tone-success">Correct answer</span>}
                    {isCorrect ? <Check className="h-4 w-4 shrink-0 text-tone-success" aria-hidden /> : picked ? <X className="h-4 w-4 shrink-0 text-tone-danger" aria-hidden /> : null}
                  </li>
                );
              })}
            </ul>
          )}

          {r.explanation.trim() && (
            <div className="mt-4 rounded-lg bg-subtle px-3.5 py-2.5 text-[15px] leading-relaxed ring-1 ring-inset ring-border">
              <span className="font-medium">Why: </span>
              {r.explanation}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

