import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { deleteLesson } from 'zitejs/api';
import { Button } from '@project/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { cn } from '@project/components/lib/utils';
import type { CourseLesson, CourseSection } from '../../lib/types';
import { plural } from './model';

export type SectionDeleteMode = 'move_lessons' | 'delete_lessons';

/**
 * Deleting a section asks what happens to its lessons: keep them (they move
 * out of any section) or delete them too, with how many learners that touches.
 */
export function SectionDeleteDialog({ section, lessons, onOpenChange, onConfirm }: {
  section: CourseSection | null;
  lessons: CourseLesson[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (mode: SectionDeleteMode) => Promise<void>;
}) {
  const [mode, setMode] = useState<SectionDeleteMode>('move_lessons');
  const [busy, setBusy] = useState(false);
  const [learners, setLearners] = useState<number | null>(null);

  useEffect(() => {
    if (!section) return;
    setMode('move_lessons');
    setBusy(false);
    setLearners(null);
    if (!lessons.length) return;
    let live = true;
    deleteLesson({ ids: lessons.map(l => l.id), dryRun: true })
      .then(r => live && setLearners(r.impact.learners))
      .catch(() => live && setLearners(null));
    return () => {
      live = false;
    };
  }, [section?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = lessons.length;
  const title = section?.title || 'Untitled section';

  return (
    <Dialog open={Boolean(section)} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent
        className="max-w-md"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) {
            e.preventDefault();
            setBusy(true);
            void onConfirm(mode).finally(() => setBusy(false));
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-[16px]">Delete “{title}”?</DialogTitle>
          <DialogDescription className="text-[14px]">
            {count ? `This section has ${plural(count, 'lesson')}. Choose what happens to ${count === 1 ? 'it' : 'them'}.` : 'The section is empty, so no lessons are affected.'}
          </DialogDescription>
        </DialogHeader>
        {count > 0 && (
          <div role="radiogroup" aria-label="What happens to the lessons" className="space-y-2">
            <Choice
              checked={mode === 'move_lessons'}
              onSelect={() => setMode('move_lessons')}
              title={`Keep the ${count === 1 ? 'lesson' : 'lessons'}`}
              description={`${count === 1 ? 'It moves' : 'They move'} out of any section, to the top of the outline. Learner progress is unaffected.`}
            />
            <Choice
              checked={mode === 'delete_lessons'}
              onSelect={() => setMode('delete_lessons')}
              danger
              title={`Delete the ${count === 1 ? 'lesson' : `${count} lessons`} too`}
              description={
                learners == null
                  ? 'They’re removed for good and everyone’s course progress is recalculated.'
                  : learners > 0
                    ? `${plural(learners, 'learner')} ${learners === 1 ? 'has' : 'have'} worked on ${count === 1 ? 'it' : 'them'}. Their records stay in the history, but progress is recalculated without ${count === 1 ? 'it' : 'these lessons'}.`
                    : `Nobody has started ${count === 1 ? 'it' : 'them'} yet. ${count === 1 ? 'It’s' : 'They’re'} removed for good.`
              }
            />
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" className="h-9 text-[14px]" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={mode === 'delete_lessons' ? 'destructive' : 'default'}
            className="h-9 gap-1.5 text-[14px]"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm(mode).finally(() => setBusy(false));
            }}
          >
            {busy && <Loader2 className="!h-3.5 !w-3.5 animate-spin" />}
            {mode === 'delete_lessons' && count ? `Delete section and ${plural(count, 'lesson')}` : 'Delete section'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Choice({ checked, onSelect, title, description, danger }: { checked: boolean; onSelect: () => void; title: string; description: string; danger?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn('flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors', checked ? (danger ? 'border-tone-danger/60 bg-tone-danger/[0.05]' : 'border-primary bg-primary/[0.05]') : 'hover:bg-accent')}
    >
      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', checked ? (danger ? 'border-tone-danger' : 'border-primary') : 'border-input')}>
        {checked && <span className={cn('h-2 w-2 rounded-full', danger ? 'bg-tone-danger' : 'bg-primary')} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
