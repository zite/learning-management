import { Check, Loader2, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { aiGenerateCourse, type AiGenerateCourseOutputType } from 'zitejs/api';
import { Button } from '@project/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { formatMinutes } from '@project/shared/lessons';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import type { CourseDetail } from '../../lib/types';
import { Keys } from '../primitives/bits';
import { LessonTypeIcon } from '../primitives/icons';
import { plural } from './model';
import { AutoTextarea, Field, inputClass, Segmented, textareaClass } from './ui';

export type DraftResult = AiGenerateCourseOutputType;

const STEPS = ['Outlining sections', 'Writing the lessons', 'Adding practical steps', 'Writing quiz questions', 'Putting it all together'];

/**
 * Draft a course with AI. What it writes is appended — existing lessons are
 * never touched — and one click undoes the whole draft.
 */
export function AiCourseSheet({ open, onOpenChange, detail, onDrafted, onUndo, onOpenLesson }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: CourseDetail;
  onDrafted: (result: DraftResult) => void;
  onUndo: (result: DraftResult) => Promise<boolean>;
  onOpenLesson: (lessonId: string) => void;
}) {
  const course = detail.course;
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [level, setLevel] = useState(course.level || 'Beginner');
  const [length, setLength] = useState<'short' | 'standard' | 'deep'>('standard');
  const [includeQuiz, setIncludeQuiz] = useState(true);
  const [phase, setPhase] = useState<'form' | 'working' | 'done' | 'error'>('form');
  const [error, setError] = useState('');
  const [result, setResult] = useState<DraftResult | null>(null);
  const [step, setStep] = useState(0);
  const [undoing, setUndoing] = useState(false);
  const started = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!open || phase === 'working') return;
    if (phase !== 'done') {
      setTopic([course.title, course.summary].filter(Boolean).join(' — '));
      setLevel(course.level || 'Beginner');
      setPhase('form');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'working') return;
    const t = window.setInterval(() => {
      const s = Math.round((Date.now() - started.current) / 1000);
      setElapsed(s);
      setStep(Math.min(STEPS.length - 1, Math.floor(s / (length === 'deep' ? 22 : length === 'short' ? 8 : 14))));
    }, 500);
    return () => window.clearInterval(t);
  }, [phase, length]);

  const draft = async () => {
    if (!topic.trim()) return;
    started.current = Date.now();
    setElapsed(0);
    setStep(0);
    setPhase('working');
    try {
      const res = await aiGenerateCourse({ courseId: course.id, topic: topic.trim(), audience: audience.trim() || undefined, level: level as 'Beginner' | 'Intermediate' | 'Advanced', length, includeQuiz });
      setResult(res);
      setPhase('done');
      onDrafted(res);
    } catch (e) {
      setError(errorMessage(e, 'The AI draft didn’t come through. Try again, or choose a shorter course.'));
      setPhase('error');
    }
  };

  const existing = detail.lessons.length;
  const steps = STEPS.filter(s => includeQuiz || !s.includes('quiz'));

  return (
    <Sheet open={open} onOpenChange={o => phase !== 'working' && onOpenChange(o)}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[460px] [&>button.absolute]:top-3.5"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && phase === 'form') {
            e.preventDefault();
            void draft();
          }
        }}
      >
        <div className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-[16px]">
            <Sparkles className="h-4 w-4 text-tone-accent" /> Draft with AI
          </SheetTitle>
          <SheetDescription className="mt-1 text-[14px]">
            {existing ? `Adds new sections after the ${plural(existing, 'lesson')} already here. Nothing existing changes.` : 'Writes sections of lessons with real content, a checklist and a quiz. Review and edit everything before you publish.'}
          </SheetDescription>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {phase === 'form' && (
            <div className="space-y-5">
              <Field label="What should it cover?" htmlFor="ai-topic" hint="The more specific, the better: the situations people face, the policy or process, what they get wrong today.">
                <AutoTextarea id="ai-topic" autoFocus value={topic} minRows={4} maxHeight={260} maxLength={2000} className={textareaClass} onChange={e => setTopic(e.target.value)} placeholder="e.g. De-escalating difficult customer conversations in our stores, including refunds and safety" />
              </Field>
              <Field label="Who is it for?" htmlFor="ai-audience">
                <input id="ai-audience" value={audience} maxLength={500} className={inputClass} onChange={e => setAudience(e.target.value)} placeholder="e.g. New store associates in their first month" />
              </Field>
              <Field label="Level">
                <Segmented value={level} onChange={setLevel} ariaLabel="Level" options={['Beginner', 'Intermediate', 'Advanced'].map(v => ({ value: v, label: v }))} />
              </Field>
              <Field label="Length">
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Length">
                  {([
                    ['short', 'Short', '4–5 lessons', '~30 min'],
                    ['standard', 'Standard', '7–9 lessons', '~1 hr'],
                    ['deep', 'In depth', '11–14 lessons', '~2 hr'],
                  ] as const).map(([value, label, lessons, time]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={length === value}
                      onClick={() => setLength(value)}
                      className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors', length === value ? 'border-primary bg-primary/[0.06] ring-1 ring-primary' : 'hover:bg-accent')}
                    >
                      <span className="block text-[14px] font-medium">{label}</span>
                      <span className="mt-0.5 block text-2xs text-muted-foreground">{lessons}</span>
                      <span className="block text-2xs text-muted-foreground">{time}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <label htmlFor="ai-quiz" className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
                <span>
                  <span className="block text-[14px] font-medium">End with a quiz</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">5–8 questions covering the whole course, with a passing score of 80%.</span>
                </span>
                <Switch id="ai-quiz" checked={includeQuiz} onCheckedChange={setIncludeQuiz} className="mt-0.5" />
              </label>
            </div>
          )}

          {phase === 'working' && (
            <div className="py-6" aria-live="polite">
              <p className="text-[15px] font-medium">Drafting “{course.title || 'your course'}”</p>
              <p className="mt-1 text-sm text-muted-foreground">This takes a minute or two for a full course. Keep this panel open.</p>
              <ol className="mt-6 space-y-3">
                {steps.map((s, i) => {
                  const idx = Math.min(step, steps.length - 1);
                  const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
                  return (
                    <li key={s} className={cn('flex items-center gap-3 text-[14px]', state === 'todo' && 'text-muted-foreground')}>
                      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', state === 'done' && 'border-tone-success bg-tone-success text-white', state === 'active' && 'border-primary')}>
                        {state === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : state === 'active' ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : null}
                      </span>
                      {s}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-6 text-2xs tabular-nums text-muted-foreground">{elapsed}s</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col items-center py-12 text-center" role="alert">
              <p className="max-w-xs text-[14px] font-medium">{error}</p>
              <Button variant="outline" size="sm" className="mt-4 h-9 gap-1.5 text-[13.5px]" onClick={() => setPhase('form')}>
                <RotateCcw className="!h-3.5 !w-3.5" /> Back to the brief
              </Button>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="space-y-5 animate-fade-up">
              <div className="flex items-start gap-3 rounded-lg border border-tone-success/30 bg-tone-success/[0.06] px-3 py-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-tone-success" />
                <div className="text-[14px]">
                  <p className="font-medium">Added {plural(result.sectionIds.length, 'section')} and {plural(result.lessonCount, 'lesson')}</p>
                  <p className="mt-0.5 text-muted-foreground">
                    About {formatMinutes(result.minutes)} of learning.
                    {result.filled.length ? ` Also filled in the course ${result.filled.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : ''}
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {result.sections.map(s => (
                  <div key={s.id}>
                    <p className="mb-1 text-sm font-medium text-muted-foreground">{s.title}</p>
                    <ul className="space-y-0.5">
                      {s.lessons.map(l => (
                        <li key={l.id}>
                          <button type="button" onClick={() => onOpenLesson(l.id)} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-accent">
                            <LessonTypeIcon type={l.type} />
                            <span className="min-w-0 flex-1 truncate">{l.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">AI can get details wrong. Read every lesson, and check anything about your policies, before you publish.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
          {phase === 'form' ? (
            <>
              <span className="hidden items-center gap-1.5 text-2xs text-muted-foreground sm:inline-flex">
                <Keys keys={[MOD, '↵']} /> to draft
              </span>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" className="h-9 text-[14px]" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button size="sm" className="h-9 gap-1.5 text-[14px]" disabled={!topic.trim()} onClick={() => void draft()}>
                  <Sparkles className="!h-3.5 !w-3.5" /> Draft course
                </Button>
              </div>
            </>
          ) : phase === 'done' && result ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 text-[14px]"
                disabled={undoing}
                onClick={async () => {
                  setUndoing(true);
                  const ok = await onUndo(result);
                  setUndoing(false);
                  if (ok) {
                    setResult(null);
                    setPhase('form');
                  }
                }}
              >
                {undoing ? <Loader2 className="!h-3.5 !w-3.5 animate-spin" /> : <Undo2 className="!h-3.5 !w-3.5" />} Undo draft
              </Button>
              <Button size="sm" className="h-9 text-[14px]" onClick={() => result.lessonIds[0] && onOpenLesson(result.lessonIds[0])}>
                Review the first lesson
              </Button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">{phase === 'working' ? 'Working…' : ''}</span>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
