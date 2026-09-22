import {
  DndContext, DragOverlay, MeasuringStrategy, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ChevronRight, GripVertical, MoreHorizontal, PenLine, Plus, Text, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@project/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { formatMinutes, type LessonType } from '@project/shared/lessons';
import type { CourseLesson, CourseSection } from '../../lib/types';
import { IconButton, Tip } from '../primitives/bits';
import { LessonTypeIcon } from '../primitives/icons';
import { AddLessonMenu } from './AddLessonMenu';
import { gentleAutoScroll, pointerFirst, verticalOnly } from './dnd';
import { lessonLabel, plural, type Order, type OutlineGroup } from './model';
import { textareaClass } from './ui';

type Row =
  | { key: string; kind: 'section'; section: CourseSection; count: number; minutes: number }
  | { key: string; kind: 'lesson'; lesson: CourseLesson; inSection: boolean };

const sectionKey = (id: string) => `s:${id}`;
const lessonKey = (id: string) => `l:${id}`;

export type OutlineActions = {
  onSelect: (lessonId: string) => void;
  onReorder: (order: Order) => void;
  onAddLesson: (sectionId: string | null, type: LessonType) => void;
  onAddSection: () => void;
  onRenameSection: (id: string, title: string) => void;
  onDescribeSection: (id: string, description: string) => void;
  onDeleteSection: (section: CourseSection) => void;
};

/**
 * The course at a glance. Lessons drag within and between sections; a section
 * drags as a block with its lessons (every section folds while one is held,
 * so what's being reordered is the order of sections). Lessons outside any
 * section come first, as they do for learners.
 */
export function Outline({ courseId, groups, selectedId, canEdit, issues, renamingId, setRenamingId, actions }: {
  courseId: string;
  groups: OutlineGroup[];
  selectedId: string | null;
  canEdit: boolean;
  issues: Map<string, string[]>;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  actions: OutlineActions;
}) {
  const storageKey = `lms:builder:collapsed:${courseId}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [describingId, setDescribingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const toggle = (id: string, force?: boolean) =>
    setCollapsed(c => {
      const next = new Set(c);
      const collapse = force ?? !next.has(id);
      if (collapse) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* private mode */
      }
      return next;
    });

  // Selecting a lesson inside a folded section unfolds it, and keeps it in view.
  useEffect(() => {
    if (!selectedId) return;
    const group = groups.find(g => g.lessons.some(l => l.id === selectedId));
    if (group?.section && collapsed.has(group.section.id)) toggle(group.section.id, false);
    const el = listRef.current?.querySelector(`[data-lesson-row="${window.CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const draggingSection = activeKey?.startsWith('s:') ?? false;

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const g of groups) {
      if (g.section) {
        out.push({ key: sectionKey(g.section.id), kind: 'section', section: g.section, count: g.lessons.length, minutes: g.lessons.reduce((s, l) => s + l.durationMinutes, 0) });
        if (draggingSection || collapsed.has(g.section.id)) continue;
      }
      for (const l of g.lessons) out.push({ key: lessonKey(l.id), kind: 'lesson', lesson: l, inSection: Boolean(g.section) });
    }
    return out;
  }, [groups, collapsed, draggingSection]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragStart = (e: DragStartEvent) => setActiveKey(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    const wasSection = draggingSection;
    setActiveKey(null);
    const over = e.over ? String(e.over.id) : null;
    const active = String(e.active.id);
    if (!over || over === active) return;
    const visible = rows.map(r => r.key);
    const from = visible.indexOf(active);
    const to = visible.indexOf(over);
    if (from < 0 || to < 0) return;
    let keys = arrayMove(visible, from, to);
    // Lessons outside any section always lead the outline; a section dropped above them mustn't swallow them.
    const loose = (groups[0]?.lessons ?? []).map(l => lessonKey(l.id));
    if (wasSection) keys = [...loose, ...keys.filter(k => !loose.includes(k))];

    const shown = new Set(visible);
    const order: Order = { sectionIds: [], groups: new Map([[null, []]]) };
    let current: string | null = null;
    for (const key of keys) {
      if (key.startsWith('s:')) {
        current = key.slice(2);
        order.sectionIds.push(current);
        // Lessons folded out of view follow their section — so a lesson dropped onto a folded section lands at its end.
        const hidden = (groups.find(g => g.section?.id === current)?.lessons ?? []).filter(l => !shown.has(lessonKey(l.id))).map(l => l.id);
        order.groups.set(current, hidden);
      } else {
        order.groups.get(current)!.push(key.slice(2));
      }
    }
    actions.onReorder(order);
  };

  const activeRow = activeKey ? rows.find(r => r.key === activeKey) ?? null : null;

  if (!groups.some(g => g.section || g.lessons.length)) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">Lessons you add appear here.</p>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerFirst}
      modifiers={[verticalOnly]}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      autoScroll={gentleAutoScroll}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveKey(null)}
    >
      <SortableContext items={rows.map(r => r.key)} strategy={verticalListSortingStrategy}>
        <div ref={listRef} role="tree" aria-label="Course outline" className="select-none px-2 pb-3 pt-1">
          {rows.map((row, i) =>
            row.kind === 'section' ? (
              <SortableSection
                key={row.key}
                row={row}
                first={i === 0}
                canEdit={canEdit}
                collapsed={collapsed.has(row.section.id) || draggingSection}
                renaming={renamingId === row.section.id}
                describing={describingId === row.section.id}
                onToggle={() => toggle(row.section.id)}
                onStartRename={() => setRenamingId(row.section.id)}
                onRename={title => {
                  setRenamingId(null);
                  if (title.trim() && title.trim() !== row.section.title) actions.onRenameSection(row.section.id, title.trim());
                }}
                onCancelRename={() => setRenamingId(null)}
                onDescribe={open => setDescribingId(open ? row.section.id : null)}
                onSaveDescription={d => {
                  setDescribingId(null);
                  if (d.trim() !== row.section.description) actions.onDescribeSection(row.section.id, d.trim());
                }}
                onAddLesson={type => {
                  if (collapsed.has(row.section.id)) toggle(row.section.id, false);
                  actions.onAddLesson(row.section.id, type);
                }}
                onDelete={() => actions.onDeleteSection(row.section)}
              />
            ) : (
              <SortableLesson
                key={row.key}
                row={row}
                canEdit={canEdit}
                selected={row.lesson.id === selectedId}
                issues={issues.get(row.lesson.id)}
                onSelect={() => actions.onSelect(row.lesson.id)}
              />
            ),
          )}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>{activeRow ? <RowPreview row={activeRow} /> : null}</DragOverlay>
    </DndContext>
  );
}

function SortableSection({ row, first, canEdit, collapsed, renaming, describing, onToggle, onStartRename, onRename, onCancelRename, onDescribe, onSaveDescription, onAddLesson, onDelete }: {
  row: Extract<Row, { kind: 'section' }>;
  first: boolean;
  canEdit: boolean;
  collapsed: boolean;
  renaming: boolean;
  describing: boolean;
  onToggle: () => void;
  onStartRename: () => void;
  onRename: (title: string) => void;
  onCancelRename: () => void;
  onDescribe: (open: boolean) => void;
  onSaveDescription: (description: string) => void;
  onAddLesson: (type: LessonType) => void;
  onDelete: () => void;
}) {
  const s = row.section;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.key, disabled: !canEdit || renaming });
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const title = (
    <span
      className={cn('min-w-0 truncate text-[13.5px] font-medium', !s.title && 'text-muted-foreground')}
      onDoubleClick={e => {
        if (!canEdit) return;
        e.stopPropagation();
        onStartRename();
      }}
    >
      {s.title || 'Untitled section'}
    </span>
  );
  return (
    <>
        <div
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          role="treeitem"
          tabIndex={-1}
          aria-expanded={!collapsed}
          aria-label={`Section: ${s.title || 'Untitled section'}`}
          data-section-row={s.id}
          style={{ transform: CSS.Translate.toString(transform), transition }}
          className={cn('relative', !first && 'mt-2.5', isDragging && 'z-10 opacity-40')}
        >
          <div className={cn('group/section relative flex h-9 items-center gap-1 rounded-md pl-0.5 pr-1 transition-colors hover:bg-accent/60', (menuOpen || addOpen) && 'bg-accent/60')}>
            {canEdit && (
              <span
                aria-hidden
                style={{ touchAction: 'none' }}
                className="absolute -left-2 top-1/2 flex h-5 w-3 -translate-y-1/2 cursor-grab items-center justify-center text-muted-foreground/70 opacity-0 transition-opacity group-hover/section:opacity-100 [@media(pointer:coarse)]:opacity-100"
              >
                <GripVertical className="h-3 w-3" />
              </span>
            )}
            <button
              type="button"
              aria-label={collapsed ? `Expand ${s.title || 'section'}` : `Collapse ${s.title || 'section'}`}
              onPointerDown={e => e.stopPropagation()}
              onClick={onToggle}
              className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', !collapsed && 'rotate-90')} />
            </button>
            {renaming ? (
              <RenameInput initial={s.title} onCommit={onRename} onCancel={onCancelRename} />
            ) : s.description ? (
              <Tip label={<span className="block max-w-[260px] whitespace-normal">{s.description}</span>} side="right">
                {title}
              </Tip>
            ) : (
              title
            )}
            {!renaming && (
              <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
                <span className={cn('px-1 text-2xs tabular-nums text-muted-foreground', canEdit && 'group-hover/section:hidden', (menuOpen || addOpen) && 'hidden')}>
                  {row.count}
                </span>
                {canEdit && (
                  <span className={cn('hidden items-center gap-0.5 group-hover/section:flex', (menuOpen || addOpen) && 'flex')} onPointerDown={e => e.stopPropagation()}>
                    <AddLessonMenu open={addOpen} onOpenChange={setAddOpen} onPick={onAddLesson} align="start" label={`Add to “${s.title || 'Untitled section'}”`}>
                      <IconButton size="sm" aria-label={`Add a lesson to ${s.title || 'this section'}`}>
                        <Plus />
                      </IconButton>
                    </AddLessonMenu>
                    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
                      <DropdownMenuTrigger asChild>
                        <IconButton size="sm" aria-label="Section actions">
                          <MoreHorizontal />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-48"
                        // Focus returning to the ⋯ button would pull it out of the rename or description field that just opened.
                        onCloseAutoFocus={e => e.preventDefault()}
                      >
                        <DropdownMenuItem className="gap-2 text-[14px]" onSelect={onStartRename}>
                          <PenLine className="h-3.5 w-3.5 text-muted-foreground" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => onDescribe(true)}>
                          <Text className="h-3.5 w-3.5 text-muted-foreground" /> {s.description ? 'Edit description' : 'Add a description'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={onDelete}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete section…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                )}
              </span>
            )}
          </div>
          {collapsed && row.count > 0 && !isDragging && <span className="sr-only">{plural(row.count, 'lesson')} hidden</span>}
          {describing && (
            <div className="mb-1 ml-5 mt-1 animate-fade-in" onPointerDown={e => e.stopPropagation()}>
              <DescriptionForm initial={s.description} onSave={onSaveDescription} onCancel={() => onDescribe(false)} />
            </div>
          )}
        </div>
    </>
  );
}

function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={v}
      maxLength={200}
      aria-label="Section title"
      onPointerDown={e => e.stopPropagation()}
      onChange={e => setV(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          done.current = true;
          onCommit(v);
        }
        if (e.key === 'Escape') {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => !done.current && onCommit(v)}
      className="h-6 min-w-0 flex-1 rounded border border-primary bg-background px-1.5 text-[13.5px] font-medium outline-none ring-[3px] ring-primary/15"
    />
  );
}

function DescriptionForm({ initial, onSave, onCancel }: { initial: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => ref.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSave(v);
      }}
      className="space-y-2"
    >
      <label htmlFor="section-description" className="sr-only">Section description</label>
      <textarea
        id="section-description"
        ref={ref}
        value={v}
        rows={2}
        maxLength={2000}
        placeholder="What this section covers. Learners see it in the course outline."
        className={textareaClass}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(v);
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" className="h-8 text-[13.5px]" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" className="h-8 text-[13.5px]">Save</Button>
      </div>
    </form>
  );
}

function SortableLesson({ row, canEdit, selected, issues, onSelect }: { row: Extract<Row, { kind: 'lesson' }>; canEdit: boolean; selected: boolean; issues?: string[]; onSelect: () => void }) {
  const l = row.lesson;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.key, disabled: !canEdit });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="treeitem"
      tabIndex={-1}
      aria-selected={selected}
      data-lesson-row={l.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative', isDragging && 'z-10 opacity-40')}
    >
      <div
        onClick={onSelect}
        className={cn(
          'group/row relative flex h-9 cursor-default items-center gap-2 rounded-md pl-2 pr-2 text-[14px] transition-colors',
          row.inSection && 'pl-6',
          selected ? 'bg-primary/[0.1] text-foreground' : 'text-foreground/90 hover:bg-accent',
        )}
      >
        {canEdit && (
          <span
            aria-hidden
            style={{ touchAction: 'none' }}
            className={cn('absolute top-1/2 flex h-5 w-3.5 -translate-y-1/2 cursor-grab items-center justify-center text-muted-foreground/70 opacity-0 transition-opacity group-hover/row:opacity-100 [@media(pointer:coarse)]:opacity-100', row.inSection ? 'left-1.5' : '-left-0.5')}
          >
            <GripVertical className="h-3 w-3" />
          </span>
        )}
        <LessonTypeIcon type={l.type} />
        <span className={cn('min-w-0 flex-1 truncate', !l.title.trim() && 'text-muted-foreground')}>{lessonLabel(l)}</span>
        {l.optional && <span className="shrink-0 rounded border px-1 text-[11px] font-medium leading-4 text-muted-foreground">Optional</span>}
        {issues && issues.length > 0 && (
          <Tip label={<span className="block max-w-[240px] whitespace-normal">{issues.join(' · ')}</span>}>
            <span role="img" aria-label={`${plural(issues.length, 'issue')}: ${issues.join(', ')}`} className="flex h-4 w-3 shrink-0 items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-tone-warning" />
            </span>
          </Tip>
        )}
        <Tip label={`${formatMinutes(l.durationMinutes)} · ${l.completedCount ? `completed by ${plural(l.completedCount, 'person', 'people')}` : 'nobody has completed it yet'}`} side="right">
          <span className="w-9 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">{l.durationMinutes ? `${l.durationMinutes}m` : '—'}</span>
        </Tip>
      </div>
    </div>
  );
}

function RowPreview({ row }: { row: Row }) {
  if (row.kind === 'section') {
    return (
      <div className="flex h-9 cursor-grabbing items-center gap-2 rounded-md border bg-background px-2 text-[13.5px] font-medium shadow-lg">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{row.section.title || 'Untitled section'}</span>
        <span className="text-2xs font-normal text-muted-foreground">{plural(row.count, 'lesson')}</span>
      </div>
    );
  }
  return (
    <div className="flex h-9 cursor-grabbing items-center gap-2 rounded-md border bg-background px-2 text-[14px] shadow-lg">
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
      <LessonTypeIcon type={row.lesson.type} />
      <span className="min-w-0 flex-1 truncate">{lessonLabel(row.lesson)}</span>
      <span className="text-2xs tabular-nums text-muted-foreground">{row.lesson.durationMinutes}m</span>
    </div>
  );
}

/** The outline pane: header with add actions, the tree, and what's left to do before publishing. */
export function OutlinePane({ header, children, footer, className }: { header: ReactNode; children: ReactNode; footer: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-0 flex-col bg-background', className)}>
      <div className="flex h-10 shrink-0 items-center gap-1 pl-4 pr-2">{header}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="shrink-0 border-t">{footer}</div>
    </div>
  );
}

export function IssuesSummary({ count, onClick }: { count: number; onClick: () => void }) {
  if (!count) return null;
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-tone-warning transition-colors hover:bg-accent">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{plural(count, 'issue')} to fix before publishing</span>
    </button>
  );
}

