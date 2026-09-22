import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, Plus, Route, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { savePath } from 'zitejs/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { COURSE_COLORS, COURSE_ICONS } from '../../lib/constants';
import { errorMessage } from '../../lib/errors';
import { formatDuration, plural } from '../../lib/format';
import { MOD } from '../../lib/hotkeys';
import { qk } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { IconButton, Kbd } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { OptionPicker, type Option } from '../pickers/OptionPicker';
import { StatusPill } from '../courses/CourseBits';
import { buttonClass, Field, IconColorPicker, inputClass, primaryButtonClass, textareaClass } from '../courses/fields';
import { useModEnter } from '../courses/useModEnter';

const PATH_ICONS = ['🧭', '🚀', '🎯', '🗺️', '🏗️', '🌱', '📈', '🧠', '🛡️', '⛑️', '🤝', '🎓', ...COURSE_ICONS.filter(i => !['🧭', '🚀', '🎯', '🏗️', '📈', '🧠', '🛡️', '⛑️', '🤝', '🎓'].includes(i))];

/**
 * A new learning path: name, look, summary and its courses in order. Created
 * as a draft and opened on its Courses tab, where the order can be refined.
 */
export function CreatePathDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void; courseId?: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState(PATH_ICONS[0]);
  const [color, setColor] = useState(COURSE_COLORS[1]);
  const [summary, setSummary] = useState('');
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [sequential, setSequential] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setIcon(PATH_ICONS[Math.floor(Math.random() * 8)]);
    setColor(COURSE_COLORS[Math.floor(Math.random() * COURSE_COLORS.length)]);
    setSummary('');
    setCourseIds([]);
    setSequential(true);
    setBusy(false);
    setTried(false);
  }, [open]);

  const options: Option<string>[] = ws.orderedCourses
    .filter(c => c.status !== 'Archived')
    .map(c => ({ value: c.id, label: c.title, icon: <CourseGlyph icon={c.icon} color={c.color} size={16} />, hint: c.status === 'Draft' ? 'Draft' : `${c.lessonCount} lessons`, group: c.status === 'Published' ? 'Published' : 'Drafts', keywords: [ws.categoryById.get(c.categoryId ?? '')?.name ?? ''] }));
  const picked = courseIds.map(id => ws.courseById.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof ws.courseById.get>>[];
  const minutes = picked.reduce((s, c) => s + c.estimatedMinutes, 0);
  const drafts = picked.filter(c => c.status !== 'Published').length;

  const move = (i: number, d: number) =>
    setCourseIds(ids => {
      const j = i + d;
      if (j < 0 || j >= ids.length) return ids;
      const next = [...ids];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const submit = async () => {
    setTried(true);
    if (!title.trim()) {
      titleRef.current?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await savePath({ action: 'create', title: title.trim(), icon, color, summary: summary.trim(), sequential, courses: courseIds.map(courseId => ({ courseId, optional: false })) });
      await qc.invalidateQueries({ queryKey: qk.bootstrap });
      toast.success(`Created ${title.trim()}`, { description: 'It’s a draft until you publish it.' });
      onOpenChange(false);
      navigate(`/paths/${res.id}`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't create the path"));
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
            <Route className="h-4 w-4 text-muted-foreground" /> New learning path
          </DialogTitle>
          <DialogDescription className="text-[14px]">A series of courses people work through together, with one due date and one certificate.</DialogDescription>
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
              <IconColorPicker icon={icon} color={color} icons={PATH_ICONS} colors={COURSE_COLORS} size={26} onChange={n => { if (n.icon) setIcon(n.icon); if (n.color) setColor(n.color); }} />
            </Field>
            <Field label="Title" htmlFor="np-title" error={tried && !title.trim() ? 'Give the path a title' : null} className="flex-1">
              <input id="np-title" ref={titleRef} autoFocus value={title} maxLength={160} onChange={e => setTitle(e.target.value)} placeholder="e.g. Store Manager Onboarding" className={cn(inputClass, 'h-9')} />
            </Field>
          </div>

          <Field label="Summary" htmlFor="np-summary">
            <textarea id="np-summary" value={summary} maxLength={400} rows={2} onChange={e => setSummary(e.target.value)} placeholder="Who it’s for and what they’ll be ready to do at the end." className={textareaClass} />
          </Field>

          <Field
            label="Courses"
            hint={picked.length ? `${plural(picked.length, 'course')}${minutes ? ` · about ${formatDuration(minutes * 60)}` : ''}${drafts ? ` · publish ${drafts === 1 ? 'the draft' : 'the drafts'} before publishing the path` : ''}` : 'Pick them in the order people should take them. You can reorder later.'}
            aside={
              <OptionPicker
                multiple
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                value={courseIds}
                onChange={setCourseIds}
                options={options}
                placeholder="Search courses…"
                width={320}
                align="end"
                trigger={
                  <button type="button" className="flex h-6 items-center gap-1 rounded-md px-1.5 text-sm text-primary hover:bg-accent">
                    <Plus className="h-3 w-3" /> Add courses
                  </button>
                }
              />
            }
          >
            {picked.length === 0 ? (
              <button type="button" onClick={() => setPickerOpen(true)} className="flex h-16 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-[14px] text-muted-foreground hover:border-foreground/30 hover:text-foreground">
                <Plus className="h-4 w-4" /> Choose courses
              </button>
            ) : (
              <ol className="divide-y overflow-hidden rounded-lg border">
                {picked.map((c, i) => (
                  <li key={c.id} className="group flex h-10 items-center gap-2 pl-3 pr-1.5 text-[14px]">
                    <span className="w-4 text-right text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                    <CourseGlyph icon={c.icon} color={c.color} size={18} />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {c.status !== 'Published' && <StatusPill status={c.status} />}
                    <IconButton size="sm" aria-label={`Move ${c.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </IconButton>
                    <IconButton size="sm" aria-label={`Move ${c.title} down`} disabled={i === picked.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown />
                    </IconButton>
                    <IconButton size="sm" aria-label={`Remove ${c.title}`} onClick={() => setCourseIds(ids => ids.filter(x => x !== c.id))}>
                      <X />
                    </IconButton>
                  </li>
                ))}
              </ol>
            )}
          </Field>

          <div className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
            <label htmlFor="np-sequential" className="min-w-0 cursor-pointer">
              <span className="block text-[14px] font-medium">Courses unlock in order</span>
              <span className="block text-sm text-muted-foreground">{sequential ? 'Each course opens once the one before it is finished.' : 'Learners can start any course in the path whenever they like.'}</span>
            </label>
            <Switch id="np-sequential" checked={sequential} onCheckedChange={setSequential} className="mt-0.5 shrink-0" />
          </div>
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
              {busy && <Loader2 className="animate-spin" />} {busy ? 'Creating…' : 'Create path'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
