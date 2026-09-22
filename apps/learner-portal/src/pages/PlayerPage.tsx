import { ArrowLeft, Keyboard } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@project/components/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { Kbd } from '../components/player/bits';
import { Celebration, RatingDialog } from '../components/player/Celebration';
import { LessonSkeleton, LessonView, type LessonActions } from '../components/player/LessonView';
import { Outline } from '../components/player/Outline';
import { QuestionsDrawer } from '../components/player/QuestionsDrawer';
import { useLesson, usePlayer, type CertificateInfo, type CompletionResult, type Player } from '../components/player/queries';
import { TopBar } from '../components/player/TopBar';
import { TutorDrawer, type TutorTurn } from '../components/player/TutorDrawer';
import { useHeartbeat } from '../components/player/useHeartbeat';
import { Button, EmptyState, LinkButton, Skeleton } from '../components/ui';
import { errorMessage, errorStatus } from '../lib/errors';
import { MOD, useHotkeys } from '../lib/hotkeys';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * The course player: a calm, full-screen space for working through a course.
 * `/learn/:slug` resumes where the learner left off; `/learn/:slug/:lessonId`
 * opens a lesson. People who can't take the course are sent somewhere useful.
 */
export function PlayerPage() {
  const { slug = '', lessonId } = useParams();
  const query = usePlayer(slug);
  const player = query.data;

  // Toast once per visit, not on every render of the redirect.
  const told = useRef(false);
  useEffect(() => {
    if (!player?.reason || told.current) return;
    told.current = true;
    const title = player.course.title;
    if (player.reason === 'not_enrolled') toast(`Enroll in ${title} to start learning.`);
    else if (player.reason === 'withdrawn') toast(`You were withdrawn from ${title}. Ask your administrator if you need access again.`);
    else toast(`${title} isn’t available right now.`);
  }, [player]);

  if (query.isPending) return <PlayerSkeleton />;
  if (query.isError || !player) {
    const status = errorStatus(query.error);
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5">
        <EmptyState
          title={status === 404 ? 'We couldn’t find that course' : 'We couldn’t open this course'}
          action={
            <>
              {status !== 404 && <Button onClick={() => query.refetch()}>Try again</Button>}
              <LinkButton to="/learning" variant="secondary">
                My learning
              </LinkButton>
            </>
          }
        >
          {status === 404 ? 'It may have been removed, or the link is incomplete.' : errorMessage(query.error, 'Check your connection and try again.')}
        </EmptyState>
      </main>
    );
  }
  if (player.reason === 'unpublished') return <Navigate to="/learning" replace />;
  if (player.reason) return <Navigate to={`/courses/${player.course.slug}`} replace />;
  if (!player.lessons.length) {
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5">
        <EmptyState
          title="This course has no lessons yet"
          action={
            <LinkButton to={`/courses/${player.course.slug}`} variant="secondary">
              Back to the course
            </LinkButton>
          }
        >
          Lessons appear here as soon as your instructor adds them.
        </EmptyState>
      </main>
    );
  }
  const exists = lessonId && player.lessons.some(l => l.id === lessonId);
  if (!exists) {
    const target = player.resumeLessonId ?? player.lessons[0].id;
    const search = typeof window !== 'undefined' ? window.location.hash.split('?')[1] : '';
    return <Navigate to={`/learn/${slug}/${target}${search ? `?${search}` : ''}`} replace />;
  }
  return <PlayerShell player={player} slug={slug} lessonId={lessonId!} />;
}

const OUTLINE_KEY = 'lms:player:outline';

function PlayerShell({ player, slug, lessonId }: { player: Player; slug: string; lessonId: string }) {
  const [params, setParams] = useSearchParams();
  const [outlineOpen, setOutlineOpen] = useState(() => {
    try {
      return localStorage.getItem(OUTLINE_KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  const [mobileOutline, setMobileOutline] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(() => Boolean(params.get('thread')));
  const [questionDraft, setQuestionDraft] = useState<string | null>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorTurns, setTutorTurns] = useState<Record<string, TutorTurn[]>>({});
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [celebration, setCelebration] = useState<{ certificate: CertificateInfo | null } | null>(null);
  const actionsRef = useRef<LessonActions>({ primary: null, prev: null, next: null });
  const scrollRef = useRef<HTMLElement | null>(null);

  const lesson = player.lessons.find(l => l.id === lessonId)!;
  const lessonData = useLesson(slug, lessonId, lesson.state !== 'locked').data;
  const threadId = params.get('thread');

  useDocumentTitle(`${lesson.title} · ${player.course.title}`);
  useHeartbeat(slug, lessonId, lesson.state !== 'locked');

  useEffect(() => {
    try {
      localStorage.setItem(OUTLINE_KEY, outlineOpen ? 'open' : 'closed');
    } catch {
      /* ignore */
    }
  }, [outlineOpen]);

  // A deep link to a thread opens Questions; closing it drops the link.
  useEffect(() => {
    if (threadId) setQuestionsOpen(true);
  }, [threadId]);
  const setQuestions = (open: boolean) => {
    setQuestionsOpen(open);
    if (!open && params.get('thread')) {
      const next = new URLSearchParams(params);
      next.delete('thread');
      setParams(next, { replace: true });
    }
  };

  const onCourseComplete = useCallback((result: CompletionResult) => setCelebration({ certificate: result.certificate }), []);

  useHotkeys({
    left: () => actionsRef.current.prev?.(),
    right: () => actionsRef.current.next?.(),
    k: () => actionsRef.current.prev?.(),
    j: () => actionsRef.current.next?.(),
    o: () => {
      if (window.matchMedia('(min-width: 1024px)').matches) setOutlineOpen(o => !o);
      else setMobileOutline(o => !o);
    },
    q: () => player.features.discussions && setQuestions(true),
    '?': () => setShortcutsOpen(true),
  });
  // ⌘↵ works from inside a text field too (submitting an answer), but never while a dialog owns the keyboard.
  useHotkeys(
    {
      'mod+enter': () => {
        if (document.querySelector('[role="dialog"][data-state="open"]')) return;
        actionsRef.current.primary?.();
      },
    },
    { allowInInputs: ['mod+enter'] },
  );

  const commentCount = lessonData?.commentCount ?? 0;
  const turns = tutorTurns[lessonId] ?? [];

  return (
    // `relative` everywhere a scroller lives: visually hidden inputs are absolutely positioned, and without a
    // positioned ancestor they'd stretch the document and let the whole frame scroll away under the top bar.
    <div className="relative flex h-[100dvh] flex-col overflow-clip bg-canvas">
      <a href="#lesson-main" onClick={e => { e.preventDefault(); document.getElementById('lesson-main')?.focus(); }} className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:shadow-md">
        Skip to lesson
      </a>
      <TopBar
        player={player}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen(o => !o)}
        onOpenMobileOutline={() => setMobileOutline(true)}
        onOpenQuestions={() => setQuestions(true)}
        onOpenTutor={() => setTutorOpen(true)}
        questionCount={commentCount}
      />
      <div className="flex min-h-0 flex-1">
        <aside
          id="player-outline"
          aria-label="Course outline"
          className={cn('hidden shrink-0 flex-col overflow-hidden border-r bg-background transition-[width] duration-200 ease-out lg:flex', outlineOpen ? 'w-[300px]' : 'w-0 border-r-0')}
        >
          <div className="flex h-full w-[300px] flex-col" hidden={!outlineOpen}>
            <Outline player={player} currentLessonId={lessonId} onRate={() => setRatingOpen(true)} />
          </div>
        </aside>
        <main id="lesson-main" ref={scrollRef} tabIndex={-1} className="relative min-w-0 flex-1 overflow-y-auto outline-none [scrollbar-gutter:stable]">
          <LessonView player={player} slug={slug} lessonId={lessonId} actionsRef={actionsRef} onCourseComplete={onCourseComplete} onRate={() => setRatingOpen(true)} scrollRef={scrollRef} />
          <div className="mx-auto hidden max-w-[46rem] justify-center px-8 pb-10 md:flex">
            <button type="button" onClick={() => setShortcutsOpen(true)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faint hover:text-muted-foreground">
              <Keyboard className="h-3.5 w-3.5" aria-hidden /> Keyboard shortcuts <Kbd>?</Kbd>
            </button>
          </div>
        </main>
      </div>

      <Sheet open={mobileOutline} onOpenChange={setMobileOutline}>
        <SheetContent
          side="bottom"
          className="flex h-[82dvh] flex-col gap-0 rounded-t-2xl p-0"
          onOpenAutoFocus={e => {
            // Start on the lesson you're on, not the close button.
            const current = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[aria-current="page"]');
            if (current) {
              e.preventDefault();
              current.focus({ preventScroll: true });
            }
          }}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted" aria-hidden />
          <div className="shrink-0 px-5 pb-2 pt-3">
            <SheetTitle className="pr-8 font-serif text-xl font-semibold leading-tight">{player.course.title}</SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">Course outline</SheetDescription>
          </div>
          <Outline player={player} currentLessonId={lessonId} onNavigate={() => setMobileOutline(false)} onRate={() => { setMobileOutline(false); setRatingOpen(true); }} />
        </SheetContent>
      </Sheet>

      {player.features.discussions && (
        <QuestionsDrawer
          open={questionsOpen}
          onOpenChange={setQuestions}
          slug={slug}
          lessonId={lessonId}
          lessonTitle={lesson.title}
          threadId={threadId}
          draft={questionDraft}
          onDraftUsed={() => setQuestionDraft(null)}
        />
      )}
      {player.features.ai && (
        <TutorDrawer
          open={tutorOpen}
          onOpenChange={setTutorOpen}
          slug={slug}
          lessonId={lessonId}
          lessonTitle={lesson.title}
          lessonType={lesson.type}
          body={lessonData?.lesson.body ?? ''}
          turns={turns}
          setTurns={fn => setTutorTurns(prev => ({ ...prev, [lessonId]: fn(prev[lessonId] ?? []) }))}
          discussions={player.features.discussions}
          onAskInstructor={q => {
            setTutorOpen(false);
            setQuestionDraft(q);
            window.setTimeout(() => setQuestions(true), 150);
          }}
        />
      )}

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} discussions={player.features.discussions} />
      {player.enrollment?.status === 'Completed' && <RatingDialog open={ratingOpen} onOpenChange={setRatingOpen} player={player} />}
      {celebration && (
        <Celebration
          open
          onOpenChange={o => {
            if (!o) setCelebration(null);
          }}
          player={player}
          certificate={celebration.certificate ?? player.certificate}
        />
      )}
    </div>
  );
}

function ShortcutsDialog({ open, onOpenChange, discussions }: { open: boolean; onOpenChange: (open: boolean) => void; discussions: boolean }) {
  // Each row: alternatives (joined by "or"), each a key combination.
  const rows: Array<{ keys: string[][]; label: string }> = [
    { keys: [['K'], ['←']], label: 'Previous lesson' },
    { keys: [['J'], ['→']], label: 'Next lesson' },
    { keys: [[MOD, '↵']], label: 'Mark complete, submit, or continue' },
    { keys: [['O']], label: 'Show or hide the outline' },
    ...(discussions ? [{ keys: [['Q']], label: 'Questions on this lesson' }] : []),
    { keys: [['?']], label: 'Keyboard shortcuts' },
    { keys: [['Esc']], label: 'Close a panel' },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-xl p-6">
        <DialogTitle className="text-lg font-semibold">Keyboard shortcuts</DialogTitle>
        <DialogDescription className="sr-only">Keys you can use in the course player</DialogDescription>
        <ul className="mt-2 divide-y">
          {rows.map(row => (
            <li key={row.label} className="flex items-center justify-between gap-4 py-2.5 text-[15px]">
              <span>{row.label}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {row.keys.map((combo, i) => (
                  <span key={combo.join('+')} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
                    <span className="flex gap-1">
                      {combo.map(k => (
                        <Kbd key={k} className="h-6 min-w-6 text-xs">
                          {k}
                        </Kbd>
                      ))}
                    </span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function PlayerSkeleton() {
  return (
    <div className="flex h-[100dvh] flex-col bg-canvas" role="status" aria-label="Loading course">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-3">
        <span className="grid h-10 w-10 place-items-center text-muted-foreground">
          <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-44" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[300px] shrink-0 space-y-3 border-r bg-background p-4 lg:block">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-5 w-5 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <LessonSkeleton />
        </div>
      </div>
    </div>
  );
}
