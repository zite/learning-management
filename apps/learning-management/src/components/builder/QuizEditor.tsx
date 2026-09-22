import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronDown, Copy, GripVertical, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@project/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Slider } from '@project/components/ui/slider';
import { cn } from '@project/components/lib/utils';
import { newId, parseQuizSettings, QUESTION_TYPE_LABEL, type QuestionType, type QuizQuestion, type QuizSettings } from '@project/shared/lessons';
import { useWorkspace } from '../../lib/workspace';
import { IconButton, Tip } from '../primitives/bits';
import { AiQuizDialog } from './AiQuizDialog';
import { gentleAutoScroll, pointerFirst, verticalOnly } from './dnd';
import { MarkdownField } from './MarkdownField';
import { plural } from './model';
import type { EditorProps } from './TypeEditors';
import { AutoTextarea, BlockLabel, Field, NumberField, Panel, Segmented, ToggleRow } from './ui';

const QUESTION_TYPES: QuestionType[] = ['single', 'multiple', 'true_false', 'short'];
const TYPE_HINT: Record<QuestionType, string> = {
  single: 'One correct answer',
  multiple: 'Learners must pick every correct answer',
  true_false: 'A statement that’s true or false',
  short: 'A typed answer, matched to your accepted answers',
};

export function blankQuestion(type: QuestionType = 'single'): QuizQuestion {
  const base = { id: newId('q'), type, prompt: '', acceptedAnswers: [] as string[], explanation: '', points: 1 };
  if (type === 'true_false') return { ...base, options: [{ id: newId('o'), text: 'True', correct: true }, { id: newId('o'), text: 'False', correct: false }] };
  if (type === 'short') return { ...base, options: [] };
  return { ...base, options: [{ id: newId('o'), text: '', correct: true }, { id: newId('o'), text: '', correct: false }, ...(type === 'multiple' ? [{ id: newId('o'), text: '', correct: false }] : [])] };
}

/** Change a question's type, keeping as much of what was written as makes sense. */
function convert(q: QuizQuestion, type: QuestionType): QuizQuestion {
  if (q.type === type) return q;
  if (type === 'true_false') {
    const falseCorrect = q.options.some(o => /^false$/i.test(o.text.trim()) && o.correct);
    return { ...q, type, options: [{ id: newId('o'), text: 'True', correct: !falseCorrect }, { id: newId('o'), text: 'False', correct: falseCorrect }], acceptedAnswers: [] };
  }
  if (type === 'short') {
    const accepted = q.type === 'true_false' ? [] : q.options.filter(o => o.correct && o.text.trim()).map(o => o.text.trim());
    return { ...q, type, options: [], acceptedAnswers: q.acceptedAnswers.length ? q.acceptedAnswers : accepted };
  }
  let options = q.type === 'short' ? q.acceptedAnswers.map((text, i) => ({ id: newId('o'), text, correct: i === 0 })) : q.type === 'true_false' ? [] : q.options;
  while (options.length < 2) options = [...options, { id: newId('o'), text: '', correct: options.length === 0 }];
  if (type === 'single') {
    const first = Math.max(0, options.findIndex(o => o.correct));
    options = options.map((o, i) => ({ ...o, correct: i === first }));
  }
  return { ...q, type, options, acceptedAnswers: [] };
}

type Focus = { questionId: string; target: 'prompt' | { option: string } | 'answer' } | null;

/**
 * Quiz builder: settings up top, then question cards that reorder by drag.
 * Correct answers are marked right on each choice — a radio for single
 * choice, checkboxes for multiple — so there's no separate answer key to keep
 * in sync.
 */
export function QuizEditor({ lesson, detail, readOnly, onChange, onSettings }: EditorProps) {
  const ws = useWorkspace();
  const quiz = parseQuizSettings(lesson.settings);
  const [focus, setFocus] = useState<Focus>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const updateQuiz = (fn: (q: QuizSettings) => QuizSettings, immediate = false) => onSettings(s => fn(parseQuizSettings(s)) as unknown as Record<string, unknown>, { immediate });
  const updateQuestion = (id: string, fn: (q: QuizQuestion) => QuizQuestion, immediate = false) => updateQuiz(qz => ({ ...qz, questions: qz.questions.map(q => (q.id === id ? fn(q) : q)) }), immediate);

  useEffect(() => {
    if (!focus) return;
    const root = listRef.current?.querySelector(`[data-question="${focus.questionId}"]`);
    if (!root) return;
    const sel = focus.target === 'prompt' ? 'textarea[data-prompt]' : focus.target === 'answer' ? 'input[data-answer]' : `input[data-option="${focus.target.option}"]`;
    const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel);
    if (el) {
      el.focus();
      if (focus.target === 'prompt') root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setFocus(null);
    }
  });

  const add = (type: QuestionType) => {
    const q = blankQuestion(type);
    updateQuiz(qz => ({ ...qz, questions: [...qz.questions, q] }), true);
    setFocus({ questionId: q.id, target: 'prompt' });
  };

  const duplicate = (id: string) => {
    const copyId = newId('q');
    updateQuiz(
      qz => {
        const i = qz.questions.findIndex(q => q.id === id);
        if (i < 0) return qz;
        const src = qz.questions[i];
        const copy = { ...src, id: copyId, options: src.options.map(o => ({ ...o, id: newId('o') })) };
        return { ...qz, questions: [...qz.questions.slice(0, i + 1), copy, ...qz.questions.slice(i + 1)] };
      },
      true,
    );
    setFocus({ questionId: copyId, target: 'prompt' });
  };

  const remove = (id: string) => updateQuiz(qz => ({ ...qz, questions: qz.questions.filter(q => q.id !== id) }), true);

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over || e.active.id === e.over.id) return;
    updateQuiz(qz => {
      const from = qz.questions.findIndex(q => q.id === e.active.id);
      const to = qz.questions.findIndex(q => q.id === e.over!.id);
      return from < 0 || to < 0 ? qz : { ...qz, questions: arrayMove(qz.questions, from, to) };
    }, true);
  };

  const totalPoints = quiz.questions.reduce((s, q) => s + q.points, 0);
  const active = activeId ? quiz.questions.find(q => q.id === activeId) : null;
  const aiAvailable = ws.features.ai && !readOnly;

  return (
    <div className="space-y-5">
      <MarkdownField
        id="lesson-body"
        label="Introduction"
        value={lesson.body}
        readOnly={readOnly}
        minRows={3}
        onChange={body => onChange({ body })}
        placeholder="What the quiz covers, and anything learners should know before they start."
        emptyPreview="No introduction."
      />

      <Panel title="Quiz settings" description={`${plural(quiz.questions.length, 'question')} · ${plural(totalPoints, 'point')}`}>
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <Field label="Passing score" htmlFor="quiz-passing" hint="Learners need this score to pass and complete the lesson.">
            <div className="flex items-center gap-3">
              <Slider aria-label="Passing score" min={0} max={100} step={5} disabled={readOnly} value={[quiz.passingScore]} onValueChange={([v]) => updateQuiz(q => ({ ...q, passingScore: v }))} className="flex-1" />
              <NumberField id="quiz-passing" ariaLabel="Passing score" value={quiz.passingScore} min={0} max={100} suffix="%" disabled={readOnly} className="w-20" onChange={v => v != null && updateQuiz(q => ({ ...q, passingScore: v }))} />
            </div>
          </Field>
          <Field label="Attempts allowed" htmlFor="quiz-attempts" hint={quiz.maxAttempts ? `After ${plural(quiz.maxAttempts, 'failed attempt')}, learners need an instructor to reset their progress.` : 'Unlimited. Learners can retake it until they pass.'}>
            <NumberField id="quiz-attempts" ariaLabel="Attempts allowed" value={quiz.maxAttempts || null} placeholder="Unlimited" min={0} max={50} disabled={readOnly} className="w-32" onChange={v => updateQuiz(q => ({ ...q, maxAttempts: v ?? 0 }))} />
          </Field>
          <Field label="Time limit" htmlFor="quiz-time" hint={quiz.timeLimitMinutes ? `The quiz submits itself after ${quiz.timeLimitMinutes} minutes.` : 'No time limit.'}>
            <NumberField id="quiz-time" ariaLabel="Time limit in minutes" value={quiz.timeLimitMinutes} placeholder="None" min={1} max={600} suffix="min" disabled={readOnly} className="w-32" onChange={v => updateQuiz(q => ({ ...q, timeLimitMinutes: v || null }))} />
          </Field>
          <div className="sm:pt-6">
            <ToggleRow id="quiz-shuffle" label="Shuffle question order" description="Each learner gets the questions in their own order." checked={quiz.shuffleQuestions} disabled={readOnly} onChange={v => updateQuiz(q => ({ ...q, shuffleQuestions: v }), true)} />
          </div>
        </div>
        <div className="border-t pt-4">
          <Field
            label="Show correct answers"
            hint={quiz.revealAnswers === 'after_submit' ? 'Learners see the right answers and explanations as soon as they submit.' : quiz.revealAnswers === 'after_pass' ? 'Revealed once they pass (or run out of attempts), so retakes stay honest.' : 'Learners only ever see their score.'}
          >
            <Segmented
              value={quiz.revealAnswers}
              disabled={readOnly}
              ariaLabel="Show correct answers"
              onChange={v => updateQuiz(q => ({ ...q, revealAnswers: v as QuizSettings['revealAnswers'] }), true)}
              options={[
                { value: 'after_submit', label: 'After submitting' },
                { value: 'after_pass', label: 'After passing' },
                { value: 'never', label: 'Never' },
              ]}
              className="max-w-full overflow-x-auto scrollbar-none"
            />
          </Field>
        </div>
      </Panel>

      <section>
        <BlockLabel
          action={
            aiAvailable && (
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-[13.5px]" onClick={() => setAiOpen(true)}>
                <Sparkles className="!h-3.5 !w-3.5 text-tone-accent" /> Generate questions with AI
              </Button>
            )
          }
        >
          Questions
        </BlockLabel>
        <div ref={listRef} className="space-y-3">
          {quiz.questions.length === 0 && (
            <div className="rounded-xl border border-dashed px-6 py-8 text-center">
              <p className="text-[14px] font-medium">No questions yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Add a question below{aiAvailable ? ', or have AI draft some from this course’s lessons for you to review' : ''}.</p>
            </div>
          )}
          <DndContext sensors={sensors} collisionDetection={pointerFirst} modifiers={[verticalOnly]} autoScroll={gentleAutoScroll} onDragStart={e => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
            <SortableContext items={quiz.questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
              {quiz.questions.map((q, i) => (
                <QuestionCard
                  key={q.id}
                  index={i}
                  question={q}
                  readOnly={readOnly}
                  onUpdate={(fn, immediate) => updateQuestion(q.id, fn, immediate)}
                  onDuplicate={() => duplicate(q.id)}
                  onRemove={() => remove(q.id)}
                  onFocus={target => setFocus({ questionId: q.id, target })}
                />
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {active ? (
                <div className="flex h-11 items-center gap-2 rounded-xl border bg-background px-3 text-[14px] shadow-lg">
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">Question {quiz.questions.findIndex(q => q.id === active.id) + 1}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{active.prompt || 'No prompt yet'}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
        {!readOnly && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 text-[13.5px]">
                  <Plus className="!h-3.5 !w-3.5" /> Add question <ChevronDown className="!h-3 !w-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {QUESTION_TYPES.map(t => (
                  <DropdownMenuItem key={t} onSelect={() => add(t)} className="flex-col items-start gap-0 py-1.5">
                    <span className="text-[14px] font-medium">{QUESTION_TYPE_LABEL[t]}</span>
                    <span className="text-2xs text-muted-foreground">{TYPE_HINT[t]}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" className="h-9 text-[13.5px] text-muted-foreground" onClick={() => add(quiz.questions[quiz.questions.length - 1]?.type ?? 'single')}>
              Add another {QUESTION_TYPE_LABEL[quiz.questions[quiz.questions.length - 1]?.type ?? 'single'].toLowerCase()}
            </Button>
          </div>
        )}
      </section>

      {aiAvailable && (
        <AiQuizDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          lesson={lesson}
          detail={detail}
          onInsert={questions => {
            updateQuiz(qz => ({ ...qz, questions: [...qz.questions.filter(q => q.prompt.trim() || q.options.some(o => o.text.trim()) || q.acceptedAnswers.length), ...questions] }), true);
            setAiOpen(false);
            if (questions[0]) setFocus({ questionId: questions[0].id, target: 'prompt' });
          }}
        />
      )}
    </div>
  );
}

function QuestionCard({ index, question: q, readOnly, onUpdate, onDuplicate, onRemove, onFocus }: {
  index: number;
  question: QuizQuestion;
  readOnly: boolean;
  onUpdate: (fn: (q: QuizQuestion) => QuizQuestion, immediate?: boolean) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onFocus: (target: 'prompt' | { option: string } | 'answer') => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: q.id, disabled: readOnly });
  const [showExplanation, setShowExplanation] = useState(Boolean(q.explanation));
  const [answer, setAnswer] = useState('');
  const choice = q.type !== 'short';
  const problems: string[] = [];
  if (!q.prompt.trim()) problems.push('Add a prompt');
  if ((q.type === 'single' || q.type === 'multiple') && q.options.filter(o => o.text.trim()).length < 2) problems.push('Needs at least two choices');
  if (q.type === 'multiple' && !q.options.some(o => o.correct)) problems.push('Mark at least one correct choice');
  if (q.type === 'short' && !q.acceptedAnswers.length) problems.push('Add an accepted answer');
  // Learners see every choice, blank or not — and a blank correct choice can never be picked knowingly.
  if ((q.type === 'single' || q.type === 'multiple') && q.options.some(o => o.correct && !o.text.trim())) problems.push('The correct choice is empty');
  else if ((q.type === 'single' || q.type === 'multiple') && q.options.filter(o => o.text.trim()).length >= 2 && q.options.some(o => !o.text.trim())) problems.push('Fill in or remove the empty choice');

  const addAnswer = (raw: string) => {
    const parts = raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onUpdate(x => ({ ...x, acceptedAnswers: [...new Set([...x.acceptedAnswers, ...parts])].slice(0, 20) }), true);
    setAnswer('');
  };

  const toggleCorrect = (optionId: string) =>
    onUpdate(
      x => ({
        ...x,
        options: x.options.map(o => (x.type === 'multiple' ? (o.id === optionId ? { ...o, correct: !o.correct } : o) : { ...o, correct: o.id === optionId })),
      }),
      true,
    );

  return (
    <div ref={setNodeRef} data-question={q.id} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('group/question rounded-xl border bg-card shadow-2xs', isDragging && 'opacity-40')}>
      <div className="flex h-10 items-center gap-1.5 border-b pl-1.5 pr-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          disabled={readOnly}
          aria-label={`Reorder question ${index + 1}`}
          style={{ touchAction: 'none' }}
          className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/70 hover:text-foreground disabled:cursor-default disabled:opacity-0"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="text-[13.5px] font-medium tabular-nums">Q{index + 1}</span>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild disabled={readOnly}>
            <button type="button" className="ghost-chip h-6 gap-1 px-1.5 text-sm text-muted-foreground disabled:pointer-events-none">
              {QUESTION_TYPE_LABEL[q.type]}
              {!readOnly && <ChevronDown className="h-3 w-3" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {QUESTION_TYPES.map(t => (
              <DropdownMenuItem key={t} onSelect={() => onUpdate(x => convert(x, t), true)} className="items-start gap-2 py-1.5">
                <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', t === q.type ? 'text-primary' : 'opacity-0')} />
                <span className="flex flex-col">
                  <span className="text-[14px] font-medium">{QUESTION_TYPE_LABEL[t]}</span>
                  <span className="text-2xs text-muted-foreground">{TYPE_HINT[t]}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {problems.length > 0 && (
          <Tip label={problems.join(' · ')}>
            <span role="img" aria-label={problems.join(', ')} className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tone-warning" />
          </Tip>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <NumberField
            ariaLabel={`Points for question ${index + 1}`}
            value={q.points}
            min={1}
            max={100}
            suffix="pts"
            disabled={readOnly}
            className="mr-1 w-[72px]"
            inputClassName="h-8 text-sm"
            onChange={v => v != null && onUpdate(x => ({ ...x, points: v }))}
          />
          {!readOnly && (
            <>
              <Tip label="Duplicate question">
                <IconButton size="sm" aria-label={`Duplicate question ${index + 1}`} onClick={onDuplicate}>
                  <Copy />
                </IconButton>
              </Tip>
              <Tip label="Delete question">
                <IconButton size="sm" aria-label={`Delete question ${index + 1}`} onClick={onRemove} className="hover:text-tone-danger">
                  <Trash2 />
                </IconButton>
              </Tip>
            </>
          )}
        </span>
      </div>

      <div className="space-y-3 px-4 py-3.5">
        <AutoTextarea
          data-prompt
          aria-label={`Question ${index + 1} prompt`}
          value={q.prompt}
          readOnly={readOnly}
          maxLength={2000}
          placeholder={q.type === 'true_false' ? 'Write a statement that’s true or false' : 'Ask a question'}
          className="block w-full resize-none bg-transparent text-[15px] font-medium leading-6 outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
          onChange={e => {
            const prompt = e.target.value;
            onUpdate(x => ({ ...x, prompt }));
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (q.type === 'short') onFocus('answer');
              else if (q.options[0]) onFocus({ option: q.options[0].id });
            }
          }}
        />

        {choice ? (
          <div role={q.type === 'multiple' ? 'group' : 'radiogroup'} aria-label="Choices" className="space-y-1">
            {q.options.map((o, oi) => (
              <div key={o.id} className={cn('group/option flex items-center gap-2 rounded-lg border px-2 py-1 transition-colors', o.correct ? 'border-tone-success/40 bg-tone-success/[0.06]' : 'border-transparent bg-subtle/60 hover:border-border')}>
                <Tip label={o.correct ? 'Correct answer' : 'Mark as correct'} side="left">
                  <button
                    type="button"
                    role={q.type === 'multiple' ? 'checkbox' : 'radio'}
                    aria-checked={o.correct}
                    aria-label={`${o.correct ? 'Correct' : 'Mark correct'}: ${o.text || `choice ${oi + 1}`}`}
                    disabled={readOnly}
                    onClick={() => toggleCorrect(o.id)}
                    className={cn(
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center border transition-colors disabled:cursor-default',
                      q.type === 'multiple' ? 'rounded-[5px]' : 'rounded-full',
                      o.correct ? 'border-tone-success bg-tone-success text-white' : 'border-input bg-background hover:border-tone-success/70',
                    )}
                  >
                    {o.correct && (q.type === 'multiple' ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-white" />)}
                  </button>
                </Tip>
                <input
                  data-option={o.id}
                  value={o.text}
                  readOnly={readOnly || q.type === 'true_false'}
                  maxLength={500}
                  aria-label={`Choice ${oi + 1}`}
                  placeholder={`Choice ${oi + 1}`}
                  className="h-8 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/60 read-only:cursor-default"
                  onChange={e => {
                    const text = e.target.value;
                    onUpdate(x => ({ ...x, options: x.options.map(y => (y.id === o.id ? { ...y, text } : y)) }));
                  }}
                  onKeyDown={e => {
                    if (readOnly || q.type === 'true_false') return;
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      const next = q.options[oi + 1];
                      if (next && !next.text) onFocus({ option: next.id });
                      else if (q.options.length < 8) {
                        const id = newId('o');
                        onUpdate(x => {
                          const at = x.options.findIndex(y => y.id === o.id);
                          return { ...x, options: [...x.options.slice(0, at + 1), { id, text: '', correct: false }, ...x.options.slice(at + 1)] };
                        }, true);
                        onFocus({ option: id });
                      }
                    } else if (e.key === 'Backspace' && !o.text && q.options.length > 2) {
                      e.preventDefault();
                      const prev = q.options[oi - 1] ?? q.options[oi + 1];
                      onUpdate(x => {
                        const options = x.options.filter(y => y.id !== o.id);
                        if (x.type === 'single' && o.correct && options[0]) options[0] = { ...options[0], correct: true };
                        return { ...x, options };
                      }, true);
                      if (prev) onFocus({ option: prev.id });
                    }
                  }}
                />
                {o.correct && <span className="hidden shrink-0 text-2xs font-medium text-tone-success sm:inline">Correct</span>}
                {!readOnly && q.type !== 'true_false' && q.options.length > 2 && (
                  <IconButton
                    size="sm"
                    aria-label={`Remove choice ${oi + 1}`}
                    className="opacity-0 focus-visible:opacity-100 group-hover/option:opacity-100 [@media(pointer:coarse)]:opacity-100"
                    onClick={() =>
                      onUpdate(x => {
                        const options = x.options.filter(y => y.id !== o.id);
                        if (x.type === 'single' && o.correct && options[0]) options[0] = { ...options[0], correct: true };
                        return { ...x, options };
                      }, true)
                    }
                  >
                    <X />
                  </IconButton>
                )}
              </div>
            ))}
            {!readOnly && q.type !== 'true_false' && q.options.length < 8 && (
              <button
                type="button"
                onClick={() => {
                  const id = newId('o');
                  onUpdate(x => ({ ...x, options: [...x.options, { id, text: '', correct: false }] }), true);
                  onFocus({ option: id });
                }}
                className="flex h-9 items-center gap-2 rounded-lg px-2 text-[14px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Add choice
              </button>
            )}
            <p className="px-0.5 pt-0.5 text-2xs text-muted-foreground">{q.type === 'multiple' ? 'Tick every correct choice. Learners must pick exactly those.' : q.type === 'true_false' ? 'Mark whether the statement is true or false.' : 'Mark the one correct choice.'}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15">
              {q.acceptedAnswers.map(a => (
                <span key={a} className="chip gap-1 border-tone-success/40 bg-tone-success/[0.06]">
                  <Check className="h-3 w-3 text-tone-success" />
                  {a}
                  {!readOnly && (
                    <button type="button" aria-label={`Remove ${a}`} className="-mr-1 rounded-full px-0.5 text-muted-foreground hover:text-foreground" onClick={() => onUpdate(x => ({ ...x, acceptedAnswers: x.acceptedAnswers.filter(y => y !== a) }), true)}>
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {!readOnly && (
                <input
                  data-answer
                  value={answer}
                  maxLength={200}
                  aria-label="Add an accepted answer"
                  placeholder={q.acceptedAnswers.length ? 'Add another spelling…' : 'Type an accepted answer and press Enter'}
                  className="h-6 min-w-[160px] flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/60"
                  onChange={e => {
                    const v = e.target.value;
                    if (v.includes(',')) addAnswer(v);
                    else setAnswer(v);
                  }}
                  onBlur={() => answer.trim() && addAnswer(answer)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addAnswer(answer);
                    } else if (e.key === 'Backspace' && !answer && q.acceptedAnswers.length) {
                      onUpdate(x => ({ ...x, acceptedAnswers: x.acceptedAnswers.slice(0, -1) }), true);
                    }
                  }}
                />
              )}
            </div>
            <p className="px-0.5 text-2xs text-muted-foreground">Any of these counts as correct. Capitals, accents and punctuation are ignored.</p>
          </div>
        )}

        {showExplanation || q.explanation ? (
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground" htmlFor={`explanation-${q.id}`}>Explanation</label>
            <AutoTextarea
              id={`explanation-${q.id}`}
              value={q.explanation}
              readOnly={readOnly}
              maxLength={2000}
              autoFocus={showExplanation && !q.explanation}
              placeholder="Why the answer is right. Shown to learners when answers are revealed."
              className="block w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-[14px] leading-relaxed outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
              onChange={e => {
                const explanation = e.target.value;
                onUpdate(x => ({ ...x, explanation }));
              }}
            />
          </div>
        ) : (
          !readOnly && (
            <button type="button" className="text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowExplanation(true)}>
              + Add an explanation
            </button>
          )
        )}
      </div>
    </div>
  );
}
