import { Check, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { aiGenerateQuiz, type AiGenerateQuizOutputType } from 'zitejs/api';
import { Button } from '@project/components/ui/button';
import { Checkbox } from '@project/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { cn } from '@project/components/lib/utils';
import { QUESTION_TYPE_LABEL, type QuestionType, type QuizQuestion } from '@project/shared/lessons';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import type { CourseDetail, CourseLesson } from '../../lib/types';
import { Keys } from '../primitives/bits';
import { LessonTypeIcon } from '../primitives/icons';
import { buildOutline, lessonLabel, plural } from './model';
import { Segmented } from './ui';

type Generated = AiGenerateQuizOutputType['questions'][number];

const TYPES: QuestionType[] = ['single', 'multiple', 'true_false', 'short'];

/**
 * Draft questions from the course's own lessons, then review them before
 * anything lands in the quiz. Nothing is saved until "Insert".
 */
export function AiQuizDialog({ open, onOpenChange, lesson, detail, onInsert }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: CourseLesson;
  detail: CourseDetail;
  onInsert: (questions: QuizQuestion[]) => void;
}) {
  const sources = useMemo(() => buildOutline(detail).ordered.filter(l => l.id !== lesson.id && l.type !== 'Quiz' && l.body.trim()), [detail, lesson.id]);
  const [count, setCount] = useState('5');
  const [types, setTypes] = useState<Set<QuestionType>>(new Set(TYPES));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<'setup' | 'loading' | 'review' | 'error'>('setup');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Generated[]>([]);
  const [keep, setKeep] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setPhase('setup');
    setResult([]);
    setError('');
    setPicked(new Set(sources.map(s => s.id)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    setPhase('loading');
    try {
      const all = picked.size === sources.length;
      const res = await aiGenerateQuiz({ lessonId: lesson.id, count: Number(count), sourceLessonIds: all ? undefined : [...picked], types: [...types] });
      setResult(res.questions);
      setKeep(new Set(res.questions.map(q => q.id)));
      setPhase('review');
    } catch (e) {
      setError(errorMessage(e, 'The AI questions didn’t come through. Try again in a moment.'));
      setPhase('error');
    }
  };

  const insert = () => onInsert(result.filter(q => keep.has(q.id)));
  const canGenerate = types.size > 0 && (sources.length === 0 || picked.size > 0);

  return (
    <Dialog open={open} onOpenChange={o => phase !== 'loading' && onOpenChange(o)}>
      <DialogContent
        className="flex max-h-[88dvh] max-w-[640px] flex-col gap-0 p-0"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (phase === 'setup' && canGenerate) void generate();
            else if (phase === 'review' && keep.size) insert();
          }
        }}
      >
        <DialogHeader className="border-b px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <Sparkles className="h-4 w-4 text-tone-accent" /> Generate questions
          </DialogTitle>
          <DialogDescription className="text-[14px]">
            {phase === 'review' ? 'Choose the questions to add. You can edit them afterwards.' : 'AI drafts questions from your lessons. You review them before anything is added.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phase === 'setup' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[14px] font-medium">How many questions</span>
                <Segmented value={count} onChange={setCount} ariaLabel="How many questions" options={['3', '5', '8', '10'].map(v => ({ value: v, label: v }))} />
              </div>
              <div className="space-y-2">
                <span className="text-[14px] font-medium">Question types</span>
                <div className="flex flex-wrap gap-1.5">
                  {TYPES.map(t => {
                    const on = types.has(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setTypes(s => {
                          const next = new Set(s);
                          if (on) next.delete(t);
                          else next.add(t);
                          return next;
                        })}
                        className={cn('chip h-8 gap-1.5 px-2.5 text-[13.5px]', on ? 'border-primary/40 bg-primary/[0.08] text-foreground' : 'text-muted-foreground hover:bg-accent')}
                      >
                        {on && <Check className="h-3 w-3 text-primary" />}
                        {QUESTION_TYPE_LABEL[t]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-medium">Write questions about</span>
                  {sources.length > 1 && (
                    <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setPicked(p => (p.size === sources.length ? new Set() : new Set(sources.map(s => s.id))))}>
                      {picked.size === sources.length ? 'Clear all' : 'Select all'}
                    </button>
                  )}
                </div>
                {sources.length ? (
                  <div className="max-h-[240px] space-y-0.5 overflow-y-auto rounded-lg border p-1">
                    {sources.map(s => (
                      <label key={s.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent">
                        <Checkbox checked={picked.has(s.id)} onCheckedChange={v => setPicked(p => {
                          const next = new Set(p);
                          if (v) next.add(s.id);
                          else next.delete(s.id);
                          return next;
                        })} />
                        <LessonTypeIcon type={s.type} />
                        <span className="min-w-0 flex-1 truncate text-[14px]">{lessonLabel(s)}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg bg-subtle px-3 py-2.5 text-[14px] text-muted-foreground">
                    {lesson.body.trim().length >= 400 ? 'Questions will come from this quiz’s introduction.' : 'This course has no lesson text yet. Add articles first, or write a longer quiz introduction to generate from.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {phase === 'loading' && (
            <div className="flex flex-col items-center justify-center py-14 text-center" aria-live="polite">
              <Loader2 className="h-5 w-5 animate-spin text-tone-accent" />
              <p className="mt-3 text-[14px] font-medium">Reading your lessons and drafting {count} questions…</p>
              <p className="mt-1 text-sm text-muted-foreground">This usually takes 10–30 seconds.</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col items-center justify-center py-12 text-center" role="alert">
              <p className="max-w-sm text-[14px] font-medium">{error}</p>
              <Button variant="outline" size="sm" className="mt-4 h-9 gap-1.5 text-[13.5px]" onClick={() => setPhase('setup')}>
                <RotateCcw className="!h-3.5 !w-3.5" /> Back
              </Button>
            </div>
          )}

          {phase === 'review' && (
            <ul className="space-y-2">
              {result.map((q, i) => {
                const on = keep.has(q.id);
                return (
                  <li key={q.id}>
                    <label className={cn('flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors', on ? 'border-primary/30 bg-primary/[0.03]' : 'opacity-60 hover:opacity-100')}>
                      <Checkbox className="mt-0.5" checked={on} onCheckedChange={v => setKeep(k => {
                        const next = new Set(k);
                        if (v) next.add(q.id);
                        else next.delete(q.id);
                        return next;
                      })} />
                      <span className="min-w-0 flex-1 space-y-1.5">
                        <span className="flex items-center gap-2 text-2xs text-muted-foreground">
                          <span className="font-medium tabular-nums">Q{i + 1}</span>
                          <span className="chip-soft">{QUESTION_TYPE_LABEL[q.type]}</span>
                        </span>
                        <span className="block text-[14.5px] font-medium leading-snug">{q.prompt}</span>
                        {q.type === 'short' ? (
                          <span className="flex flex-wrap gap-1">
                            {q.acceptedAnswers.map(a => (
                              <span key={a} className="chip gap-1 border-tone-success/40 bg-tone-success/[0.06] text-sm">
                                <Check className="h-3 w-3 text-tone-success" /> {a}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="block space-y-0.5">
                            {q.options.map(o => (
                              <span key={o.id} className={cn('flex items-center gap-2 text-[14px]', o.correct ? 'font-medium text-tone-success' : 'text-muted-foreground')}>
                                {o.correct ? <Check className="h-3.5 w-3.5 shrink-0" /> : <span className="h-3.5 w-3.5 shrink-0" />}
                                {o.text}
                              </span>
                            ))}
                          </span>
                        )}
                        {q.explanation && <span className="block text-sm text-muted-foreground">{q.explanation}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t px-5 py-3 sm:justify-between">
          <span className="hidden text-2xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1.5">
            <Keys keys={[MOD, '↵']} /> {phase === 'review' ? 'to insert' : 'to generate'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {phase === 'review' ? (
              <>
                <Button variant="ghost" size="sm" className="h-9 text-[14px]" onClick={() => setPhase('setup')}>Start over</Button>
                <Button size="sm" className="h-9 text-[14px]" disabled={!keep.size} onClick={insert}>
                  Insert {plural(keep.size, 'question')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" className="h-9 text-[14px]" disabled={phase === 'loading'} onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button size="sm" className="h-9 gap-1.5 text-[14px]" disabled={!canGenerate || phase === 'loading'} onClick={() => void generate()}>
                  {phase === 'loading' ? <Loader2 className="!h-3.5 !w-3.5 animate-spin" /> : <Sparkles className="!h-3.5 !w-3.5" />} Generate
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
