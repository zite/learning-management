import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronDown, FilePlus2, Loader2, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveCourse } from 'zitejs/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { cn } from '@project/components/lib/utils';
import { COURSE_COLORS, COURSE_ICONS, LEVELS } from '../../lib/constants';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import { qk } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { Kbd } from '../primitives/bits';
import { CategoryPicker } from '../pickers/pickers';
import { buttonClass, Field, IconColorPicker, inputClass, primaryButtonClass, textareaClass } from './fields';
import { useModEnter } from './useModEnter';

type Start = 'blank' | 'ai';

function Choice({ selected, onSelect, icon, title, description }: { selected: boolean; onSelect: () => void; icon: ReactNode; title: string; description: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex min-w-0 flex-1 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary/60 bg-primary/[0.05] ring-1 ring-primary/40' : 'hover:border-foreground/20 hover:bg-accent/40',
      )}
    >
      <span className={cn('mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4', selected ? 'text-primary' : 'text-muted-foreground')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/**
 * A new course in one step: what it's called, where it lives in the catalog,
 * how it looks, and how to start writing it. It lands on the Content tab —
 * with the AI drafting panel open when that's what was picked.
 */
export function CreateCourseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void; courseId?: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [icon, setIcon] = useState(COURSE_ICONS[0]);
  const [color, setColor] = useState(COURSE_COLORS[0]);
  const [summary, setSummary] = useState('');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('Beginner');
  const [start, setStart] = useState<Start>('blank');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setCategoryId(null);
    // A different starting look each time, so a batch of new drafts doesn't all look the same.
    const n = Math.floor(Math.random() * COURSE_COLORS.length);
    setColor(COURSE_COLORS[n]);
    setIcon(COURSE_ICONS[Math.floor(Math.random() * 12)]);
    setSummary('');
    setLevel('Beginner');
    setStart('blank');
    setBusy(false);
    setTried(false);
  }, [open]);

  const category = categoryId ? ws.categoryById.get(categoryId) : undefined;
  const titleError = tried && !title.trim() ? 'Give the course a title' : null;

  const submit = async () => {
    setTried(true);
    if (!title.trim()) {
      titleRef.current?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await saveCourse({ action: 'create', title: title.trim(), categoryId, icon, color, summary: summary.trim(), level });
      await qc.invalidateQueries({ queryKey: qk.bootstrap });
      toast.success(`Created ${title.trim()}`, { description: 'It’s a draft — only staff can see it until you publish.' });
      onOpenChange(false);
      navigate(`/courses/${res.id}/content${start === 'ai' ? '?ai=1' : ''}`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't create the course"));
      setBusy(false);
    }
  };

  useModEnter(open, submit);
  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent
        className="max-h-[92dvh] max-w-[560px] gap-0 overflow-y-auto p-0 sm:rounded-xl"
      >
        <DialogHeader className="border-b px-5 pb-3.5 pt-4">
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <BookOpen className="h-4 w-4 text-muted-foreground" /> New course
          </DialogTitle>
          <DialogDescription className="text-[14px]">It starts as a draft. Learners won’t see it until you publish.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4 px-5 py-4"
        >
          <div className="flex items-end gap-3">
            <Field label="Icon" className="shrink-0">
              <IconColorPicker icon={icon} color={color} icons={COURSE_ICONS} colors={COURSE_COLORS} size={26} onChange={n => { if (n.icon) setIcon(n.icon); if (n.color) setColor(n.color); }} />
            </Field>
            <Field label="Title" htmlFor="nc-title" error={titleError} className="flex-1">
              <input id="nc-title" ref={titleRef} autoFocus value={title} maxLength={160} onChange={e => setTitle(e.target.value)} placeholder="e.g. Food Safety Basics" className={cn(inputClass, 'h-9')} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <CategoryPicker
                value={categoryId}
                onChange={setCategoryId}
                trigger={
                  <button type="button" className={cn(inputClass, 'flex items-center gap-2 text-left hover:bg-accent/40')}>
                    {category ? (
                      <>
                        <span className="text-[14px] leading-none">{category.icon || '•'}</span>
                        <span className="flex-1 truncate">{category.name}</span>
                      </>
                    ) : (
                      <span className="flex-1 text-muted-foreground">No category</span>
                    )}
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                }
              />
            </Field>
            <Field label="Level">
              <div className="flex h-9 rounded-md border border-input p-0.5" role="radiogroup" aria-label="Level">
                {LEVELS.map(l => (
                  <button key={l} type="button" role="radio" aria-checked={level === l} onClick={() => setLevel(l)} className={cn('flex-1 rounded-[4px] text-[13.5px] transition-colors', level === l ? 'bg-accent font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}>
                    {l}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <Field label="Summary" htmlFor="nc-summary" hint="One or two sentences for the catalog card. You can change it later.">
            <textarea id="nc-summary" value={summary} maxLength={400} rows={2} onChange={e => setSummary(e.target.value)} placeholder="What learners will be able to do after this course." className={textareaClass} />
          </Field>

          {ws.features.ai && (
            <Field label="Start from">
              <div role="radiogroup" aria-label="Start from" className="flex flex-col gap-2 sm:flex-row">
                <Choice selected={start === 'blank'} onSelect={() => setStart('blank')} icon={<FilePlus2 />} title="A blank course" description="Add sections and lessons yourself." />
                <Choice selected={start === 'ai'} onSelect={() => setStart('ai')} icon={<Sparkles />} title="Draft it with AI" description="Describe the course and get an outline with lessons to edit." />
              </div>
            </Field>
          )}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>

        <div className="flex items-center justify-between gap-2 border-t bg-subtle/60 px-5 py-3">
          <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Kbd>{MOD}</Kbd>
            <Kbd>↵</Kbd> to create
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} disabled={busy} className={buttonClass}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={busy} className={primaryButtonClass}>
              {busy && <Loader2 className="animate-spin" />} {busy ? 'Creating…' : start === 'ai' ? 'Create and draft' : 'Create course'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
