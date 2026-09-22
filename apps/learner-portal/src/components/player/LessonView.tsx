import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Lock, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { completeLesson } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { formatMinutes } from '@project/shared/lessons';
import { errorMessage, errorStatus } from '../../lib/errors';
import { Button, EmptyState, LinkButton, Skeleton } from '../ui';
import { AssignmentLesson } from './AssignmentLesson';
import { LessonTypeIcon } from './bits';
import { ChecklistLesson } from './ChecklistLesson';
import { ArticleLesson, EmbedLesson, FileLessonView, VideoLesson } from './ContentLessons';
import { firstUnfinished, LessonFooter, type Gate } from './LessonFooter';
import { LiveSessionLesson } from './LiveSessionLesson';
import { blockingLesson, lockReason } from './Outline';
import { patchPlayerCompletion, playerKeys, refreshProgressEverywhere, useLesson, type CompletionResult, type LessonData, type Player } from './queries';
import { passRule, QuizLesson } from './QuizLesson';

/**
 * One lesson on the canvas: where it sits in the course, its content, and the
 * one thing to do next — finish it, or move on.
 */

export type { Gate };

export type LessonActions = {
  /** ⌘↵ — whatever the lesson's main action is right now. */
  primary: (() => void) | null;
  prev: (() => void) | null;
  next: (() => void) | null;
};

export type LessonControls = {
  slug: string;
  player: Player;
  data: LessonData;
  complete: (state?: { watched?: number; checked?: string[] }) => void;
  completing: boolean;
  setGate: (gate: Gate) => void;
  /** A lesson component that owns the main action (submitting a quiz or an assignment) registers it here. */
  setPrimary: (fn: (() => void) | null) => void;
  setFocusMode: (on: boolean) => void;
  /** While on, the footer keeps only the previous/next links — the lesson's own block has the next step. */
  setQuietFooter: (on: boolean) => void;
  onCompleted: (result: CompletionResult) => void;
  goNext: () => void;
};

function initialGate(data: LessonData): Gate {
  switch (data.lesson.type) {
    case 'Video': {
      const need = data.video?.requiredWatchShare ?? 0;
      const ready = need <= 0 || (data.video?.watched ?? 0) + 0.005 >= need;
      return { ready, hint: ready ? null : `Watch at least ${Math.round(need * 100)}% of the video to continue` };
    }
    case 'File':
      return data.file?.opened ? { ready: true, hint: null } : { ready: false, hint: 'Open the file to continue' };
    case 'Checklist': {
      const total = data.checklist?.items.length ?? 0;
      const done = data.checklist?.checked.length ?? 0;
      return { ready: total > 0 && done >= total, hint: done >= total ? null : `Tick all ${total} items to finish` };
    }
    case 'Live session':
      return data.live?.canSelfComplete ? { ready: true, hint: null } : { ready: false, hint: 'Attending a session completes this lesson' };
    case 'Quiz':
      return { ready: false, hint: data.quiz?.attemptsLeft === 0 && !data.quiz.passed ? 'No attempts left — ask your instructor for another' : passRule(data.quiz?.passingScore ?? 80) };
    case 'Assignment': {
      const waiting = data.assignment?.submissions.some(s => s.status === 'Submitted');
      return { ready: false, hint: waiting ? 'Your submission is waiting for review' : 'Completes when your submission is graded as passed' };
    }
    default:
      return { ready: true, hint: null };
  }
}

const SELF_COMPLETE = new Set(['Article', 'Video', 'File', 'Embed', 'Checklist']);

export function LessonView({
  player,
  slug,
  lessonId,
  actionsRef,
  onCourseComplete,
  onRate,
  scrollRef,
}: {
  player: Player;
  slug: string;
  lessonId: string;
  actionsRef: MutableRefObject<LessonActions>;
  onCourseComplete: (result: CompletionResult) => void;
  onRate: () => void;
  scrollRef: MutableRefObject<HTMLElement | null>;
}) {
  const outlineLesson = player.lessons.find(l => l.id === lessonId);
  const locked = !outlineLesson || outlineLesson.state === 'locked';
  const query = useLesson(slug, lessonId, !locked);
  const navigate = useNavigate();

  if (locked && outlineLesson) return <LockedLesson player={player} lessonId={lessonId} />;
  if (query.isPending) return <LessonSkeleton type={outlineLesson?.type} />;
  if (query.isError || !query.data) {
    const status = errorStatus(query.error);
    return (
      <div className="mx-auto max-w-lg px-5 py-20">
        <EmptyState
          icon={status === 403 ? Lock : RotateCcw}
          title={status === 403 ? 'This lesson is locked' : status === 404 ? 'This lesson has moved' : "We couldn't load this lesson"}
          action={
            status === 404 ? (
              <Button variant="secondary" onClick={() => navigate(`/learn/${slug}`, { replace: true })}>
                Go to where you left off
              </Button>
            ) : status === 403 ? null : (
              <Button onClick={() => query.refetch()}>Try again</Button>
            )
          }
        >
          {errorMessage(query.error, 'Check your connection and try again.')}
        </EmptyState>
      </div>
    );
  }
  return <LoadedLesson key={lessonId} player={player} slug={slug} data={query.data} actionsRef={actionsRef} onCourseComplete={onCourseComplete} onRate={onRate} scrollRef={scrollRef} />;
}

function LoadedLesson({ player, slug, data, actionsRef, onCourseComplete, onRate, scrollRef }: { player: Player; slug: string; data: LessonData; actionsRef: MutableRefObject<LessonActions>; onCourseComplete: (r: CompletionResult) => void; onRate: () => void; scrollRef: MutableRefObject<HTMLElement | null> }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [gate, setGateState] = useState<Gate>(() => initialGate(data));
  const [focusMode, setFocusMode] = useState(false);
  const [quietFooter, setQuietFooter] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const primaryOverride = useRef<(() => void) | null>(null);
  const lesson = data.lesson;
  const completed = data.state === 'completed';

  // Arriving on a lesson: top of the page, and focus on its title for keyboard and screen reader users.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    titleRef.current?.focus({ preventScroll: true });
  }, [lesson.id, scrollRef]);

  const setGate = useCallback((g: Gate) => setGateState(prev => (prev.ready === g.ready && prev.hint === g.hint ? prev : g)), []);

  const nextLesson = data.nextId ? player.lessons.find(l => l.id === data.nextId) : null;
  const nextLocked = nextLesson ? nextLesson.state === 'locked' : false;
  const prevLesson = data.prevId ? player.lessons.find(l => l.id === data.prevId) : null;

  const goTo = useCallback((id: string) => navigate(`/learn/${slug}/${id}`), [navigate, slug]);
  const goNext = useCallback(
    (preferred?: string | null) => {
      const target = preferred ?? (nextLesson && !nextLocked ? nextLesson.id : null);
      if (target) return goTo(target);
      if (nextLesson) return toast(lockReason(player, nextLesson.id));
      // The end of the outline: pick up what's left, else the certificate, else the course page.
      const left = firstUnfinished(player, lesson.id);
      if (left) goTo(left.id);
      else if (player.enrollment?.status === 'Completed' && player.certificate) navigate(`/certificates/${player.certificate.id}`);
      else navigate(`/courses/${slug}`);
    },
    [goTo, navigate, nextLesson, nextLocked, player, slug, lesson.id],
  );

  const onCompleted = useCallback(
    (result: CompletionResult) => {
      patchPlayerCompletion(qc, slug, lesson.id, result);
      refreshProgressEverywhere(qc, slug);
      void qc.invalidateQueries({ queryKey: playerKeys.lesson(slug, lesson.id) });
      setJustCompleted(true);
      if (result.completedNow) onCourseComplete(result);
    },
    [qc, slug, lesson.id, onCourseComplete],
  );

  const mutation = useMutation({
    mutationFn: (state?: { watched?: number; checked?: string[] }) => completeLesson({ lessonId: lesson.id, courseSlug: slug, state }),
    onSuccess: result => onCompleted(result),
    onError: e => toast.error(errorMessage(e, "Couldn't mark the lesson complete. Try again.")),
  });

  const selfCompletable = SELF_COMPLETE.has(lesson.type) || (lesson.type === 'Live session' && Boolean(data.live?.canSelfComplete));
  const canMarkComplete = !completed && selfCompletable && gate.ready;

  const primary = useCallback(() => {
    if (primaryOverride.current) return primaryOverride.current();
    if (completed) return goNext();
    if (canMarkComplete && !mutation.isPending) mutation.mutate(undefined);
    // ⌘↵ on a lesson that isn't ready yet says why, rather than doing nothing.
    else if (selfCompletable && !gate.ready && gate.hint) toast(gate.hint);
  }, [completed, canMarkComplete, goNext, mutation, selfCompletable, gate]);

  useEffect(() => {
    actionsRef.current = {
      primary,
      prev: prevLesson ? () => goTo(prevLesson.id) : null,
      next: nextLesson && !nextLocked ? () => goTo(nextLesson.id) : null,
    };
  });
  useEffect(
    () => () => {
      actionsRef.current = { primary: null, prev: null, next: null };
    },
    [actionsRef],
  );

  const controls: LessonControls = {
    slug,
    player,
    data,
    complete: state => mutation.mutate(state),
    completing: mutation.isPending,
    setGate,
    setPrimary: fn => {
      primaryOverride.current = fn;
    },
    setFocusMode,
    setQuietFooter,
    onCompleted,
    goNext: () => goNext(),
  };

  const wide = lesson.type === 'Video' || lesson.type === 'Embed' || lesson.type === 'File';
  const section = data.lesson.sectionTitle;

  return (
    <div className={cn('mx-auto w-full px-4 pb-32 pt-7 sm:px-8 sm:pt-12 md:pb-16', wide ? 'max-w-[58rem]' : 'max-w-[46rem]')}>
      <div className="animate-fade-up">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {section && <span className="max-w-[16rem] truncate">{section}</span>}
          {section && <span aria-hidden className="text-faint">·</span>}
          <span className="inline-flex items-center gap-1.5">
            <LessonTypeIcon type={lesson.type} className="h-3.5 w-3.5" /> {lesson.type}
          </span>
          {lesson.durationMinutes > 0 && <span aria-hidden className="text-faint">·</span>}
          {lesson.durationMinutes > 0 && <span>{formatMinutes(lesson.durationMinutes)}</span>}
          {lesson.optional && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">Optional</span>}
          {completed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-tone-success/[0.1] px-2 py-0.5 text-xs font-medium text-tone-success">
              <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> Completed
            </span>
          )}
        </p>
        <h1 ref={titleRef} tabIndex={-1} className="mt-2 font-serif text-[1.9rem] font-semibold leading-[1.15] tracking-[-0.01em] outline-none sm:text-[2.4rem]">
          {lesson.title}
        </h1>
      </div>

      <div className="mt-7 sm:mt-9">
        {lesson.type === 'Article' && <ArticleLesson controls={controls} />}
        {lesson.type === 'Video' && <VideoLesson controls={controls} />}
        {lesson.type === 'File' && <FileLessonView controls={controls} />}
        {lesson.type === 'Embed' && <EmbedLesson controls={controls} />}
        {lesson.type === 'Checklist' && <ChecklistLesson controls={controls} />}
        {lesson.type === 'Quiz' && <QuizLesson controls={controls} />}
        {lesson.type === 'Assignment' && <AssignmentLesson controls={controls} />}
        {lesson.type === 'Live session' && <LiveSessionLesson controls={controls} />}
      </div>

      {!focusMode && (
        <LessonFooter
          player={player}
          slug={slug}
          lessonId={lesson.id}
          lessonType={lesson.type}
          gate={gate}
          quiet={quietFooter}
          completed={completed}
          justCompleted={justCompleted}
          selfCompletable={selfCompletable}
          canMarkComplete={canMarkComplete}
          completing={mutation.isPending}
          onComplete={() => mutation.mutate(undefined)}
          onNext={() => goNext()}
          onRate={onRate}
          prevLesson={prevLesson ?? null}
          nextLesson={nextLesson ?? null}
          nextLocked={nextLocked}
        />
      )}
    </div>
  );
}

function LockedLesson({ player, lessonId }: { player: Player; lessonId: string }) {
  const lesson = player.lessons.find(l => l.id === lessonId)!;
  const slug = player.course.slug;
  const blocker = useMemo(() => blockingLesson(player, lessonId), [player, lessonId]);
  const waitingOn = player.pathLockCourse;
  const unlockWhen = !blocker
    ? 'It unlocks once you finish the lessons before it.'
    : blocker.type === 'Assignment'
      ? `It unlocks once “${blocker.title}” is graded as passed.`
      : blocker.type === 'Quiz'
        ? `It unlocks once you pass “${blocker.title}”.`
        : blocker.type === 'Live session'
          ? `It unlocks once your attendance at “${blocker.title}” is recorded.`
          : `It unlocks once you finish “${blocker.title}”.`;
  const short = (t: string) => (t.length > 34 ? `${t.slice(0, 33)}…` : t);
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-5 py-20 text-center animate-fade-up">
      <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Lock className="h-3.5 w-3.5" aria-hidden /> {player.pathLock ? 'This course is locked' : 'This lesson is locked'}
      </p>
      <h1 className="mt-2 font-serif text-3xl font-semibold" tabIndex={-1}>
        {player.pathLock ? player.course.title : lesson.title}
      </h1>
      <p className="mt-3 text-[15px] text-muted-foreground">
        {player.pathLock ? `Courses in ${player.path?.title ?? 'this learning path'} are taken in order. It unlocks once you finish “${player.pathLock}”.` : `${player.course.title} is taken in order. ${unlockWhen}`}
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {player.pathLock ? (
          <>
            {waitingOn ? (
              <LinkButton to={`/learn/${waitingOn.slug}`} size="lg">
                Go to “{short(waitingOn.title)}” <ArrowRight aria-hidden />
              </LinkButton>
            ) : null}
            {player.path && (
              <LinkButton to={`/paths/${player.path.slug}`} size="lg" variant={waitingOn ? 'secondary' : 'primary'}>
                View the path
              </LinkButton>
            )}
          </>
        ) : blocker ? (
          <LinkButton to={`/learn/${slug}/${blocker.id}`} size="lg">
            Go to “{short(blocker.title)}” <ArrowRight aria-hidden />
          </LinkButton>
        ) : null}
      </div>
    </div>
  );
}

export function LessonSkeleton({ type }: { type?: string }) {
  const media = type === 'Video' || type === 'File' || type === 'Embed';
  return (
    <div className={cn('mx-auto w-full px-4 pt-7 sm:px-8 sm:pt-12', media ? 'max-w-[58rem]' : 'max-w-[46rem]')} role="status" aria-label="Loading lesson">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-3 h-10 w-3/4" />
      {media ? <Skeleton className="mt-9 aspect-video w-full rounded-xl" /> : null}
      <div className="mt-9 space-y-3">
        {['w-[92%]', 'w-full', 'w-[86%]', 'w-[97%]', 'w-[60%]'].map(w => (
          <Skeleton key={w} className={cn('h-4', w)} />
        ))}
      </div>
    </div>
  );
}
