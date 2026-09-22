import { closestCenter, DndContext, KeyboardSensor, PointerSensor, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { FolderTree, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { saveCategory } from 'zitejs/api';
import { Button } from '@project/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { plural } from '../../lib/format';
import { qk } from '../../lib/queries';
import type { Bootstrap, Category } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { EmptyState, Glyph, IconButton, Tip } from '../primitives/bits';
import { CATEGORY_COLORS, CATEGORY_ICONS } from './constants';
import { SettingsCard, SettingsPageTitle, Swatches } from './ui';

/** The pointer decides where a row lands; the nearest row takes over when the pointer leaves the list. */
const collision: CollisionDetection = args => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
};

function usePatchCategories() {
  const qc = useQueryClient();
  return (fn: (categories: Category[]) => Category[]) => {
    const previous = qc.getQueryData<Bootstrap>(qk.bootstrap);
    qc.setQueryData<Bootstrap>(qk.bootstrap, old => (old ? { ...old, categories: fn(old.categories) } : old));
    return () => previous && qc.setQueryData(qk.bootstrap, previous);
  };
}

function IconPicker({ icon, color, onPick, label }: { icon: string; color: string; onPick: (icon: string, color: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="Icon and colour">
        <PopoverTrigger asChild>
          <button type="button" aria-label={`Icon and colour for ${label}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-accent data-[state=open]:bg-accent">
            <Glyph icon={icon || '📁'} color={color} size={22} />
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="start" className="w-[268px] space-y-3 p-3 shadow-lg">
        <div>
          <div className="mb-1.5 text-2xs font-medium text-muted-foreground">Icon</div>
          <div className="grid grid-cols-8 gap-0.5">
            {CATEGORY_ICONS.map(e => (
              <button
                key={e}
                type="button"
                aria-label={`Icon ${e}`}
                onClick={() => {
                  onPick(e, color);
                  setOpen(false);
                }}
                className={cn('flex h-7 w-7 items-center justify-center rounded-md text-[16px] hover:bg-accent', e === icon && 'bg-accent ring-1 ring-border')}
              >
                {e}
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={ev => {
              ev.preventDefault();
              const v = custom.trim();
              if (!v) return;
              onPick([...v][0] ?? v, color);
              setCustom('');
              setOpen(false);
            }}
          >
            <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="Or type any emoji" aria-label="Custom emoji" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[14px] outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            <Button type="submit" size="sm" variant="outline" className="h-8">Use</Button>
          </form>
        </div>
        <div>
          <div className="mb-1.5 text-2xs font-medium text-muted-foreground">Colour</div>
          <Swatches label="Category colour" size="sm" value={color} colors={CATEGORY_COLORS} onChange={c => onPick(icon, c)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Text that becomes an input on focus; saves on Enter or blur, Escape puts it back. */
function InlineText({ value, onCommit, placeholder, className, label, maxLength, required }: { value: string; onCommit: (v: string) => void; placeholder: string; className?: string; label: string; maxLength: number; required?: boolean }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(value);
  }, [value]);
  const commit = () => {
    const next = text.trim();
    if (next === value) return setText(value);
    if (required && !next) {
      toast.error('A category needs a name');
      return setText(value);
    }
    onCommit(next);
  };
  return (
    <input
      ref={ref}
      value={text}
      aria-label={label}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') ref.current?.blur();
        if (e.key === 'Escape') {
          setText(value);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      className={cn('h-8 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-[14px] outline-none transition-colors placeholder:text-muted-foreground hover:border-border focus:border-input focus:bg-background focus:ring-1 focus:ring-ring', className)}
    />
  );
}

function CategoryRow({ category, pathCount, onUpdate, onDelete, dragDisabled }: { category: Category; pathCount: number; onUpdate: (patch: Partial<Pick<Category, 'name' | 'description' | 'icon' | 'color'>>) => void; onDelete: () => void; dragDisabled: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: category.id, disabled: dragDisabled });
  // No DragOverlay here: the row itself follows the pointer (vertical only), so exactly one thing moves.
  const style = { transform: CSS.Translate.toString(transform ? { ...transform, x: 0 } : null), transition };
  const usage = [category.courseCount ? plural(category.courseCount, 'course') : null, pathCount ? plural(pathCount, 'path') : null].filter(Boolean).join(' · ');
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-category-id={category.id}
      className={cn('group relative flex min-h-10 items-center gap-1.5 bg-background py-1 pl-1 pr-2', isDragging && 'z-10 rounded-md shadow-lg ring-1 ring-border')}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Reorder ${category.name}`}
        className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/70 opacity-100 hover:text-foreground active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        style={{ touchAction: 'none' }}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <IconPicker icon={category.icon} color={category.color} label={category.name} onPick={(icon, color) => onUpdate({ icon, color })} />
      <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-1">
        <InlineText value={category.name} label={`Name of ${category.name}`} placeholder="Category name" maxLength={60} required onCommit={name => onUpdate({ name })} className="w-full font-medium sm:w-44 sm:shrink-0" />
        <InlineText value={category.description} label={`Description of ${category.name}`} placeholder="Add a description" maxLength={300} onCommit={description => onUpdate({ description })} className="w-full text-muted-foreground sm:flex-1" />
      </div>
      <span className={cn('hidden w-28 shrink-0 text-right text-sm tabular-nums sm:block', usage ? 'text-muted-foreground' : 'text-faint')}>{usage || 'Empty'}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={`Actions for ${category.name}`}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem className="text-[14px] text-tone-danger focus:text-tone-danger" onSelect={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete category…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function NewCategoryRow({ onCreate, onClose, nextColor }: { onCreate: (v: { name: string; icon: string; color: string }) => Promise<boolean>; onClose: () => void; nextColor: string }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [color, setColor] = useState(nextColor);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setColor(nextColor), [nextColor]);
  const submit = async () => {
    const v = name.trim();
    if (!v || busy) return;
    setBusy(true);
    const ok = await onCreate({ name: v, icon, color });
    setBusy(false);
    if (ok) {
      setName('');
      setIcon('📁');
      requestAnimationFrame(() => ref.current?.focus());
    }
  };
  return (
    <form
      className="flex min-h-10 items-center gap-1.5 bg-subtle py-1 pl-6 pr-2"
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <IconPicker icon={icon} color={color} label="the new category" onPick={(i, c) => { setIcon(i); setColor(c); }} />
      <input
        ref={ref}
        autoFocus
        value={name}
        maxLength={60}
        disabled={busy}
        aria-label="New category name"
        placeholder="Category name, then Enter"
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[14px] outline-none focus:ring-1 focus:ring-ring"
      />
      <Button type="submit" size="sm" className="h-8" disabled={!name.trim() || busy}>{busy ? 'Adding…' : 'Add'}</Button>
      <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onClose}>Done</Button>
    </form>
  );
}

export function CategoriesSettings() {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const patch = usePatchCategories();
  const [creating, setCreating] = useState(false);
  const categories = ws.categories;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const pathCount = (id: string) => ws.paths.filter(p => p.categoryId === id).length;

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.bootstrap });

  const update = async (c: Category, change: Partial<Pick<Category, 'name' | 'description' | 'icon' | 'color'>>) => {
    const rollback = patch(list => list.map(x => (x.id === c.id ? { ...x, ...change } : x)));
    try {
      await saveCategory({ action: 'update', id: c.id, ...change });
      if (change.name) toast.success(`Renamed to “${change.name}”`);
    } catch (e) {
      rollback();
      toast.error(errorMessage(e, "Couldn't save that change"));
    } finally {
      refresh();
    }
  };

  const create = async (v: { name: string; icon: string; color: string }) => {
    try {
      await saveCategory({ action: 'create', ...v });
      await qc.invalidateQueries({ queryKey: qk.bootstrap });
      toast.success(`Added “${v.name}”`);
      return true;
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't add the category"));
      return false;
    }
  };

  const remove = async (c: Category) => {
    const courses = ws.courses.filter(x => x.categoryId === c.id).length;
    const paths = pathCount(c.id);
    const inUse = [courses ? plural(courses, 'course') : null, paths ? plural(paths, 'learning path') : null].filter(Boolean).join(' and ');
    const ok = await app.confirm({
      title: `Delete “${c.name}”?`,
      description: inUse
        ? `${inUse} in it will become uncategorised. They stay exactly as they are otherwise — published, enrolled, and in the catalog.`
        : 'Nothing is in this category yet. This can’t be undone.',
      confirmLabel: 'Delete category',
      destructive: true,
    });
    if (!ok) return;
    const rollback = patch(list => list.filter(x => x.id !== c.id));
    try {
      const res = await saveCategory({ action: 'delete', id: c.id });
      const moved = res.uncategorised.courses + res.uncategorised.paths;
      toast.success(`Deleted “${c.name}”`, { description: moved ? `${inUse} ${moved === 1 ? 'is' : 'are'} now uncategorised.` : undefined });
    } catch (e) {
      rollback();
      toast.error(errorMessage(e, "Couldn't delete the category"));
    } finally {
      refresh();
    }
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = categories.findIndex(c => c.id === active.id);
    const to = categories.findIndex(c => c.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(categories, from, to).map((c, position) => ({ ...c, position }));
    const rollback = patch(() => next);
    try {
      await saveCategory({ action: 'reorder', order: next.map(c => c.id) });
    } catch (e) {
      rollback();
      toast.error(errorMessage(e, "Couldn't save the new order"));
    } finally {
      refresh();
    }
  };

  return (
    <>
      <SettingsPageTitle
        title="Categories"
        description="Group courses and learning paths in the catalog and in reports. Drag to set the order learners see them in."
        actions={
          categories.length > 0 && !creating ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New category
            </Button>
          ) : undefined
        }
      />
      {categories.length === 0 && !creating ? (
        <SettingsCard>
          <EmptyState
            icon={<FolderTree />}
            title="No categories yet"
            description="Categories like Compliance, Onboarding or Leadership help learners find their way around the catalog."
            action={<Button size="sm" onClick={() => setCreating(true)}><Plus /> New category</Button>}
          />
        </SettingsCard>
      ) : (
        <SettingsCard className="overflow-visible max-sm:[&>div:nth-child(2)]:border-t-0">
          <div className="hidden h-9 items-center gap-1.5 bg-subtle pl-[64px] pr-[42px] text-sm text-muted-foreground sm:flex">
            <span className="w-44 shrink-0 px-1.5">Name</span>
            <span className="flex-1 px-1.5">Description</span>
            <span className="w-28 shrink-0 text-right">In use</span>
          </div>
          <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={e => void onDragEnd(e)}>
            <SortableContext items={categories.map(c => c.id)} strategy={verticalListSortingStrategy}>
              {categories.map(c => (
                <CategoryRow key={c.id} category={c} pathCount={pathCount(c.id)} dragDisabled={categories.length < 2} onUpdate={change => void update(c, change)} onDelete={() => void remove(c)} />
              ))}
            </SortableContext>
          </DndContext>
          {creating ? (
            <NewCategoryRow onCreate={create} onClose={() => setCreating(false)} nextColor={CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]} />
          ) : (
            <button type="button" onClick={() => setCreating(true)} className="flex h-10 w-full items-center gap-2 pl-7 text-[14px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> New category
            </button>
          )}
        </SettingsCard>
      )}
      <p className="mt-3 px-1 text-sm text-muted-foreground">Courses and paths choose their category in their own settings. Archived courses aren’t counted.</p>
    </>
  );
}
