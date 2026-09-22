import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { trackLesson } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Markdown } from '@project/shared/ui/Markdown';
import { errorMessage } from '../../lib/errors';
import { ProgressBar } from '../ui';
import type { LessonControls } from './LessonView';
import { playerKeys, type LessonData } from './queries';

/**
 * Practical steps, ticked off as they're done. Each tick saves on its own
 * (no save button to forget), and ticking the last one finishes the lesson.
 */
export function ChecklistLesson({ controls }: { controls: LessonControls }) {
  const { data, slug, setGate, complete, completing } = controls;
  const qc = useQueryClient();
  const items = data.checklist?.items ?? [];
  const [checked, setChecked] = useState<Set<string>>(() => new Set(data.checklist?.checked ?? []));
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [celebrate, setCelebrate] = useState(false);
  const completed = data.state === 'completed';
  const timer = useRef<number>(0);
  const latest = useRef(checked);

  const persist = useCallback(
    (next: Set<string>) => {
      window.clearTimeout(timer.current);
      setSaveState('saving');
      timer.current = window.setTimeout(() => {
        const ids = [...next];
        trackLesson({ lessonId: data.lesson.id, courseSlug: slug, state: { checked: ids } })
          .then(() => {
            if (latest.current !== next) return;
            setSaveState('saved');
            qc.setQueryData<LessonData>(playerKeys.lesson(slug, data.lesson.id), prev => (prev?.checklist ? { ...prev, checklist: { ...prev.checklist, checked: ids } } : prev));
          })
          .catch(e => {
            setSaveState('error');
            toast.error(errorMessage(e, "Your ticks couldn't be saved. Check your connection."));
          });
      }, 350);
    },
    [data.lesson.id, slug, qc],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const allDone = items.length > 0 && items.every(i => checked.has(i.id));
  useEffect(() => {
    setGate({ ready: allDone, hint: allDone ? null : `Tick all ${items.length} items to finish` });
  }, [allDone, items.length, setGate]);

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    latest.current = next;
    setChecked(next);
    const finished = items.every(i => next.has(i.id));
    if (finished && !completed) {
      // The last tick: save it with the completion itself, and celebrate.
      window.clearTimeout(timer.current);
      setSaveState('saved');
      setCelebrate(true);
      complete({ checked: [...next] });
    } else {
      persist(next);
    }
  };

  const done = items.filter(i => checked.has(i.id)).length;

  return (
    <div>
      {data.lesson.body.trim() && <Markdown className="prose-lms mb-7 max-w-[68ch] sm:text-[17px]">{data.lesson.body}</Markdown>}

      <div className="rounded-2xl border bg-card shadow-xs">
        <div className="flex items-center gap-4 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium">
              {allDone ? (
                <span className={cn('inline-flex items-center gap-2 text-tone-success', celebrate && 'animate-fade-in')}>
                  <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> All done
                </span>
              ) : (
                <>
                  <span className="tabular-nums">{done}</span> of <span className="tabular-nums">{items.length}</span> done
                </>
              )}
            </p>
            <ProgressBar value={items.length ? done / items.length : 0} className="mt-2 h-1.5" label="Checklist progress" tone={allDone ? 'success' : 'primary'} />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
            {completing ? 'Finishing…' : saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : ''}
          </span>
        </div>
        <ul className="divide-y">
          {items.map((item, i) => {
            const on = checked.has(item.id);
            return (
              <li key={item.id}>
                <label className={cn('flex min-h-[3.75rem] cursor-pointer items-center gap-4 px-5 py-3.5 transition-colors hover:bg-accent/60 has-[:focus-visible]:bg-accent/60', i === items.length - 1 && 'rounded-b-2xl')}>
                  <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggle(item.id)} />
                  <span
                    aria-hidden
                    className={cn(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-md border-[1.5px] transition-[background-color,border-color,transform] duration-200 peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/35',
                      on ? 'scale-100 border-tone-success bg-tone-success text-white dark:text-[hsl(30_8%_7%)]' : 'border-input bg-background',
                    )}
                  >
                    {on && <Check className="h-4 w-4 animate-pop" strokeWidth={3} />}
                  </span>
                  <span className={cn('text-[15.5px] leading-snug transition-colors', on ? 'text-muted-foreground' : 'text-foreground')}>{item.text}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
