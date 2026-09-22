import * as SliderPrimitive from '@radix-ui/react-slider';
import { Check, Loader2, Lock, PencilLine, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { aiDraftFeedback } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Markdown } from '@project/shared/ui/Markdown';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import { dateTime, timeAgo } from '../../lib/format';
import { Kbd, Tip } from '../primitives/bits';
import { GradePill } from './GradingQueue';
import type { Draft, SubmissionDetail } from './gradingData';

/** 0–100 with the pass line marked, coloured by which side of it the grade falls. */
function GradeSlider({ value, passing, onChange }: { value: number | null; passing: number; onChange: (v: number) => void }) {
  const passes = value != null && value >= passing;
  return (
    <div className="relative flex h-8 flex-1 items-center">
      <SliderPrimitive.Root
        value={[value ?? 0]}
        min={0}
        max={100}
        step={1}
        onValueChange={v => onChange(v[0])}
        aria-label="Grade"
        className="relative flex h-5 w-full touch-none select-none items-center"
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Range className={cn('absolute h-full rounded-full', value == null ? 'bg-transparent' : passes ? 'bg-tone-success' : 'bg-tone-warning')} />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className={cn('block h-4 w-4 rounded-full border-2 bg-background shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40', value == null ? 'border-muted-foreground/40' : passes ? 'border-tone-success' : 'border-tone-warning')} />
      </SliderPrimitive.Root>
      <span className="pointer-events-none absolute top-[3px] h-[22px] w-px bg-foreground/35" style={{ left: `calc(${passing}% + ${8 - (passing / 100) * 16}px)` }} aria-hidden />
      <span className="pointer-events-none absolute -top-2.5 -translate-x-1/2 text-[11px] font-medium tabular-nums text-muted-foreground" style={{ left: `calc(${passing}% + ${8 - (passing / 100) * 16}px)` }} aria-hidden>
        Pass {passing}
      </span>
    </div>
  );
}

const FeedbackEditor = forwardRef<HTMLTextAreaElement, { value: string; onChange: (v: string) => void; placeholder: string; invalid?: boolean }>(({ value, onChange, placeholder, invalid }, ref) => {
  const [preview, setPreview] = useState(false);
  const inner = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the text, up to about ten lines.
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, Math.max(72, el.scrollHeight))}px`;
  }, [value, preview]);

  return (
    <div className={cn('overflow-hidden rounded-md border bg-background shadow-2xs focus-within:ring-1 focus-within:ring-ring', invalid && 'border-tone-danger/60')}>
      {preview ? (
        <div className="max-h-[220px] min-h-[72px] overflow-y-auto px-3 py-2">
          {value.trim() ? <Markdown className="text-[14px]">{value}</Markdown> : <p className="text-[14px] text-muted-foreground">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea
          ref={el => {
            inner.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          placeholder={placeholder}
          aria-label="Feedback for the learner"
          maxLength={10000}
          className="block w-full resize-none bg-transparent px-3 py-2 text-[14px] leading-[1.55] outline-none placeholder:text-muted-foreground"
        />
      )}
      <div className="flex h-8 items-center gap-1 border-t bg-subtle/60 px-1.5">
        {(['Write', 'Preview'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setPreview(t === 'Preview')}
            aria-pressed={preview === (t === 'Preview')}
            className={cn('h-5 rounded px-1.5 text-2xs', preview === (t === 'Preview') ? 'bg-background font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto text-2xs text-faint">Markdown · the learner sees this</span>
      </div>
    </div>
  );
});
FeedbackEditor.displayName = 'FeedbackEditor';

export function GradingBar({
  detail,
  draft,
  onDraft,
  onSubmit,
  aiEnabled,
  feedbackRef,
  gradeRef,
  attempted,
  inline,
}: {
  detail: SubmissionDetail;
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  onSubmit: (outcome: 'Passed' | 'Needs revision') => void;
  aiEnabled: boolean;
  feedbackRef: RefObject<HTMLTextAreaElement>;
  gradeRef: RefObject<HTMLInputElement>;
  attempted: 'grade' | 'feedback' | null;
  inline: boolean;
}) {
  const { submission: s, lesson, learner } = detail;
  const [aiBusy, setAiBusy] = useState(false);
  const first = learner.name.split(' ')[0];
  const passing = lesson.passingGrade;
  const gradeNum = draft.grade.trim() === '' ? null : Number(draft.grade);
  const validGrade = gradeNum != null && Number.isFinite(gradeNum) && gradeNum >= 0 && gradeNum <= 100;
  const below = validGrade && gradeNum! < passing;
  const superseded = Boolean(s.supersededById);
  const graded = s.status !== 'Submitted';
  const shell = cn('shrink-0 bg-background', !inline && 'border-t shadow-[0_-1px_12px_-6px_rgb(0_0_0/0.08)]');
  // Pinned under the submission, the bar's controls line up with the reading column above them.
  const column = cn('w-full', !inline && 'mx-auto max-w-[780px] sm:px-8');

  if (!detail.canGrade) {
    return (
      <div className={cn(shell, 'px-4 py-3 text-[14px] text-muted-foreground')}>
        <div className={cn(column, 'flex items-start gap-2')}>
          <Lock className="mt-[3px] h-3.5 w-3.5 shrink-0" />
          <span>
            Only the course owner, its instructors or an admin can grade <span className="font-medium text-foreground">{detail.course.title}</span>.
            {graded && s.grade != null && <> Graded {s.grade}{s.gradedByName ? ` by ${s.gradedByName}` : ''}.</>}
          </span>
        </div>
      </div>
    );
  }

  if (graded && !draft.editing) {
    return (
      <div className={cn(shell, 'px-4 py-3 sm:px-5')}>
        <div className={column}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[14px] font-medium">
                {s.status === 'Passed' ? <Check className="h-4 w-4 shrink-0 text-tone-success" /> : <RotateCcw className="h-3.5 w-3.5 shrink-0 text-tone-warning" />}
                {s.status === 'Passed' ? 'Passed' : 'Sent back for revision'}
                <GradePill grade={s.grade} status={s.status} />
              </div>
              <Tip label={dateTime(s.gradedAt)}>
                <div className="pl-6 text-sm text-muted-foreground">
                  {s.gradedByName ? `${s.gradedByName} · ` : ''}
                  {timeAgo(s.gradedAt)}
                </div>
              </Tip>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {superseded ? (
                <span className="text-sm text-muted-foreground">{first} has resubmitted since</span>
              ) : (
                <button type="button" onClick={() => onDraft({ editing: true, grade: s.grade == null ? '' : String(s.grade), feedback: s.feedback })} className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-[14px] font-medium shadow-2xs hover:bg-accent">
                  <PencilLine className="h-3.5 w-3.5" /> Change grade
                </button>
              )}
            </div>
          </div>
          {s.feedback.trim() && (
            <div className="mt-2.5 max-h-[160px] overflow-y-auto rounded-md bg-subtle px-3 py-2">
              <Markdown className="text-[14px]">{s.feedback}</Markdown>
            </div>
          )}
        </div>
      </div>
    );
  }

  const suggest = async () => {
    setAiBusy(true);
    try {
      const res = await aiDraftFeedback({ submissionId: s.id });
      onDraft({ grade: String(res.suggestedGrade), feedback: res.feedback, ai: { ...res, previous: { grade: draft.grade, feedback: draft.feedback } } });
      window.setTimeout(() => feedbackRef.current?.focus(), 0);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t get an AI suggestion'));
    } finally {
      setAiBusy(false);
    }
  };

  const passLocked = s.status === 'Passed';
  const primary: 'Passed' | 'Needs revision' = below ? 'Needs revision' : 'Passed';
  const btn = (outcome: 'Passed' | 'Needs revision') => {
    const isPrimary = primary === outcome;
    const disabled = outcome === 'Needs revision' && passLocked;
    const button = (
      <button
        type="button"
        onClick={() => onSubmit(outcome)}
        disabled={disabled}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-md px-3 text-[14px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
          isPrimary
            ? outcome === 'Passed' ? 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90' : 'bg-tone-warning text-white shadow-xs hover:bg-tone-warning/90 dark:text-black'
            : 'border bg-background shadow-2xs hover:bg-accent',
        )}
      >
        {outcome === 'Passed' ? (s.status === 'Passed' ? 'Save grade' : 'Pass') : 'Needs revision'}
        <span className={cn('hidden items-center gap-0.5 sm:inline-flex', isPrimary ? 'opacity-70' : 'text-muted-foreground')}>
          <span className="text-[12px]">{MOD}</span>
          {outcome === 'Needs revision' && <span className="text-[12px]">⇧</span>}
          <span className="text-[12px]">↵</span>
        </span>
      </button>
    );
    return outcome === 'Needs revision' && passLocked ? (
      <Tip label="A pass can’t be sent back — the lesson is already complete">
        <span>{button}</span>
      </Tip>
    ) : (
      button
    );
  };

  return (
    <div className={cn(shell, 'px-4 pb-3 pt-3.5 sm:px-5')}>
      <div className={column}>
        {draft.ai && (
          <div className="mb-2.5 rounded-md border border-tone-accent/25 bg-tone-accent/[0.05] px-3 py-2 text-sm animate-fade-in">
            <div className="flex items-center gap-1.5 font-medium text-tone-accent">
              <Sparkles className="h-3.5 w-3.5" /> AI suggestion — {draft.ai.suggestedGrade}, {draft.ai.outcome === 'Passed' ? 'pass' : 'needs revision'}
              <span className="font-normal text-muted-foreground">· advisory, edit before you grade</span>
              <button type="button" onClick={() => onDraft({ grade: draft.ai!.previous.grade, feedback: draft.ai!.previous.feedback, ai: null })} className="ml-auto inline-flex items-center gap-1 font-medium text-foreground/80 hover:text-foreground">
                <Undo2 className="h-3 w-3" /> Undo
              </button>
            </div>
            {(draft.ai.strengths.length > 0 || draft.ai.improvements.length > 0) && (
              <div className="mt-1.5 grid gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-2">
                {draft.ai.strengths.length > 0 && <div><span className="font-medium text-tone-success">Strengths:</span> {draft.ai.strengths.join('; ')}</div>}
                {draft.ai.improvements.length > 0 && <div><span className="font-medium text-tone-warning">To improve:</span> {draft.ai.improvements.join('; ')}</div>}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <label htmlFor="grade-input" className="shrink-0 text-sm font-medium text-muted-foreground">Grade</label>
          <div className={cn('flex h-9 w-[68px] shrink-0 items-center rounded-md border bg-background pr-2 shadow-2xs focus-within:ring-1 focus-within:ring-ring', attempted === 'grade' && !validGrade && 'border-tone-danger/60')}>
            <input
              id="grade-input"
              ref={gradeRef}
              inputMode="numeric"
              value={draft.grade}
              onFocus={e => e.target.select()}
              onChange={e => {
                const v = e.target.value.replace(/[^\d]/g, '').slice(0, 3);
                onDraft({ grade: v === '' ? '' : String(Math.min(100, Number(v))) });
              }}
              onKeyDown={e => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  const step = e.shiftKey ? 10 : 1;
                  const cur = validGrade ? gradeNum! : passing;
                  onDraft({ grade: String(Math.max(0, Math.min(100, cur + (e.key === 'ArrowUp' ? step : -step)))) });
                } else if (e.key === 'Escape') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="—"
              aria-label="Grade from 0 to 100"
              className="h-full w-full min-w-0 bg-transparent pl-2 text-[15px] font-semibold tabular-nums outline-none placeholder:font-normal placeholder:text-muted-foreground"
            />
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <GradeSlider value={validGrade ? gradeNum : null} passing={passing} onChange={v => onDraft({ grade: String(v) })} />
          {aiEnabled && (
            <Tip label="Draft a grade and feedback from the rubric — you review it before grading">
              <button type="button" onClick={suggest} disabled={aiBusy} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] font-medium shadow-2xs hover:bg-accent disabled:opacity-60">
                {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-tone-accent" /> : <Sparkles className="h-3.5 w-3.5 text-tone-accent" />}
                <span className="hidden sm:inline">{aiBusy ? 'Drafting…' : 'Suggest with AI'}</span>
              </button>
            </Tip>
          )}
        </div>

        <div className="mt-2.5">
          <FeedbackEditor
            ref={feedbackRef}
            value={draft.feedback}
            onChange={v => onDraft({ feedback: v })}
            invalid={attempted === 'feedback' && !draft.feedback.trim()}
            placeholder={`Feedback for ${first} — what worked, and what to change if it needs another pass`}
          />
          {attempted === 'feedback' && !draft.feedback.trim() && <p className="mt-1 text-sm text-tone-danger">Add feedback so {first} knows what to change.</p>}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="hidden items-center gap-1 text-2xs text-muted-foreground md:flex">
            <Kbd>F</Kbd> feedback <span className="mx-1 text-faint">·</span> <Kbd>J</Kbd><Kbd>K</Kbd> move
          </span>
          {attempted === 'grade' && !validGrade ? (
            <span className="text-sm text-tone-danger">Enter a grade from 0 to 100</span>
          ) : below ? (
            <span className="text-sm text-tone-warning">Below the pass line of {passing}</span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {draft.editing && (
              <button type="button" onClick={() => onDraft({ editing: false, grade: s.grade == null ? '' : String(s.grade), feedback: s.feedback, ai: null })} className="h-9 rounded-md px-2.5 text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground">
                Cancel
              </button>
            )}
            {btn('Needs revision')}
            {btn('Passed')}
          </div>
        </div>
      </div>
    </div>
  );
}
