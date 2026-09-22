import { useMutation } from '@tanstack/react-query';
import { ArrowUp, BookOpen, MessageCircleQuestion, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { askTutor } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { Markdown } from '@project/shared/ui/Markdown';
import { errorMessage } from '../../lib/errors';

/**
 * A study assistant for the lesson on screen. It only knows this lesson and
 * the course's summary, says so when something isn't covered, and hands the
 * question to the instructor with one tap.
 */

export type TutorTurn = { role: 'user' | 'assistant'; content: string; section?: string | null; inMaterial?: boolean; error?: boolean };

const headings = (md: string) => [...md.matchAll(/^#{2,3}\s+(.+?)\s*#*\s*$/gm)].map(m => m[1].replace(/[*_`]/g, '').trim()).filter(Boolean);

export function TutorDrawer({
  open,
  onOpenChange,
  slug,
  lessonId,
  lessonTitle,
  lessonType,
  body,
  turns,
  setTurns,
  onAskInstructor,
  discussions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  lessonId: string;
  lessonTitle: string;
  lessonType: string;
  body: string;
  turns: TutorTurn[];
  setTurns: (fn: (prev: TutorTurn[]) => TutorTurn[]) => void;
  onAskInstructor: (question: string) => void;
  discussions: boolean;
}) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const starters = useMemo(() => {
    const hs = headings(body).slice(0, 2).map(h => `Explain “${h}” in plain words`);
    const generic = lessonType === 'Quiz' ? ['What should I review before this quiz?'] : body.trim() ? ['Summarise this lesson in three points', 'Give me a real example of this at work'] : ['What is this lesson about?'];
    return [...hs, ...generic].slice(0, 4);
  }, [body, lessonType]);

  const mutation = useMutation({
    mutationFn: (question: string) => askTutor({ lessonId, courseSlug: slug, question, history: turns.filter(t => !t.error).slice(-6).map(t => ({ role: t.role, content: t.content })) }),
    onSuccess: res => setTurns(prev => [...prev, { role: 'assistant', content: res.answer, section: res.section, inMaterial: res.inMaterial }]),
    onError: e => setTurns(prev => [...prev, { role: 'assistant', content: errorMessage(e, "The study assistant couldn't answer just now. Try again in a moment."), error: true }]),
  });

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || mutation.isPending) return;
    setTurns(prev => [...prev, { role: 'user', content: question }]);
    setText('');
    mutation.mutate(question);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, mutation.isPending]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  const lastQuestion = [...turns].reverse().find(t => t.role === 'user')?.content ?? '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[440px]">
        <div className="shrink-0 border-b px-5 pb-4 pt-5">
          <SheetTitle className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-muted-foreground" aria-hidden /> Study assistant
          </SheetTitle>
          <SheetDescription className="mt-0.5 truncate pr-8 text-sm text-muted-foreground">Answers from “{lessonTitle}”</SheetDescription>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5" aria-live="polite">
          {turns.length === 0 && (
            <div className="animate-fade-up">
              <p className="text-[15px] text-muted-foreground">Ask anything about this lesson. Answers come from the course material, and the assistant says so when something isn’t covered.</p>
              <p className="mb-2 mt-5 text-sm font-medium text-muted-foreground">Try asking</p>
              <div className="flex flex-col items-start gap-2">
                {starters.map(s => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border bg-background px-3.5 py-2 text-left text-sm hover:border-foreground/25 hover:bg-accent">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[15px] text-foreground">{t.content}</p>
              </div>
            ) : (
              <div key={i} className="flex">
                <div className="min-w-0 max-w-[92%]">
                  <div className={cn('rounded-2xl rounded-tl-md px-4 py-2.5 text-[15px] ring-1 ring-inset', t.error ? 'bg-tone-danger/[0.05] ring-tone-danger/20' : 'bg-card ring-border')}>
                    <Markdown compact className="leading-relaxed [&_li]:mt-1">{t.content}</Markdown>
                  </div>
                  {t.section && (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <BookOpen className="h-3 w-3" aria-hidden /> From “{t.section}”
                    </p>
                  )}
                  {t.error && i === turns.length - 1 && turns[i - 1]?.role === 'user' && !mutation.isPending && (
                    <button
                      type="button"
                      onClick={() => {
                        const question = turns[i - 1].content;
                        setTurns(prev => prev.slice(0, -1));
                        mutation.mutate(question);
                      }}
                      className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-background px-3 text-sm font-medium hover:bg-accent"
                    >
                      Try again
                    </button>
                  )}
                  {t.inMaterial === false && discussions && (
                    <button type="button" onClick={() => onAskInstructor(turns[i - 1]?.content ?? lastQuestion)} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-background px-3 text-sm font-medium hover:bg-accent">
                      <MessageCircleQuestion className="h-4 w-4" aria-hidden /> Ask your instructor instead
                    </button>
                  )}
                </div>
              </div>
            ),
          )}
          {mutation.isPending && (
            <div className="flex" role="status" aria-label="The assistant is typing">
              <span className="inline-flex items-center gap-1 rounded-2xl rounded-tl-md bg-card px-4 py-3.5 ring-1 ring-inset ring-border">
                {[0, 1, 2].map(d => (
                  <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${d * 140}ms` }} />
                ))}
              </span>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t bg-background px-4 pb-3 pt-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <form
            className="flex items-end gap-2 rounded-2xl border border-input bg-background p-1.5 pl-3.5 shadow-xs focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15"
            onSubmit={e => {
              e.preventDefault();
              ask(text);
            }}
          >
            <label htmlFor="tutor-input" className="sr-only">
              Ask about this lesson
            </label>
            <textarea
              id="tutor-input"
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(text);
                }
              }}
              rows={1}
              maxLength={1000}
              placeholder="Ask about this lesson…"
              className="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-muted-foreground/80"
            />
            <button type="submit" disabled={!text.trim() || mutation.isPending} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40" aria-label="Send">
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
          </form>
          <p className="mt-2 text-center text-xs text-muted-foreground">AI can make mistakes — check with your instructor.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
