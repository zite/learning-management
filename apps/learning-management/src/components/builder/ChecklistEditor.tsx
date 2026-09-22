import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Square, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@project/components/ui/button';
import { cn } from '@project/components/lib/utils';
import { newId, type ChecklistItem } from '@project/shared/lessons';
import { IconButton } from '../primitives/bits';
import { gentleAutoScroll, pointerFirst, verticalOnly } from './dnd';
import { MarkdownField } from './MarkdownField';
import { plural } from './model';
import type { EditorProps } from './TypeEditors';
import { AutoTextarea, BlockLabel } from './ui';

/** Items as stored, keeping blank ones that are still being typed (the server drops blanks when it saves). */
function itemsOf(settings: Record<string, unknown>): ChecklistItem[] {
  const raw = Array.isArray(settings.items) ? (settings.items as unknown[]) : [];
  return raw.map((it, i) => {
    if (typeof it === 'string') return { id: `c${i}`, text: it };
    const o = (it ?? {}) as Record<string, unknown>;
    return { id: typeof o.id === 'string' && o.id ? o.id : `c${i}`, text: typeof o.text === 'string' ? o.text : '' };
  });
}

/**
 * Practical steps learners tick off. Works like a list in a notes app: Enter
 * adds the next item, Backspace on an empty item removes it, arrows move
 * between items, and pasting several lines makes several items.
 */
export function ChecklistEditor({ lesson, readOnly, onChange, onSettings }: EditorProps) {
  const items = itemsOf(lesson.settings);
  const [focusId, setFocusId] = useState<{ id: string; at: 'end' | 'start' } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Layout effect: focus must move before the next keystroke arrives.
  useLayoutEffect(() => {
    if (!focusId) return;
    const el = listRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-item="${focusId.id}"]`);
    if (el) {
      el.focus();
      const pos = focusId.at === 'end' ? el.value.length : 0;
      el.setSelectionRange(pos, pos);
      setFocusId(null);
    }
  }, [focusId, items.length]);

  const update = (fn: (list: ChecklistItem[]) => ChecklistItem[], immediate = false) => onSettings(s => ({ ...s, items: fn(itemsOf(s)) }), { immediate });

  const insertAfter = (index: number, texts: string[] = [''], at: 'end' | 'start' = 'end') => {
    const created = texts.map(text => ({ id: newId('c'), text }));
    update(list => [...list.slice(0, index + 1), ...created, ...list.slice(index + 1)]);
    setFocusId({ id: created[created.length - 1].id, at });
  };

  const remove = (index: number) => {
    const prev = items[index - 1] ?? items[index + 1];
    update(list => list.filter((_, i) => i !== index), true);
    if (prev) setFocusId({ id: prev.id, at: 'end' });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex(i => i.id === e.active.id);
    const to = items.findIndex(i => i.id === e.over!.id);
    if (from < 0 || to < 0) return;
    update(list => arrayMove(list, from, to), true);
  };

  const filled = items.filter(i => i.text.trim()).length;
  const active = activeId ? items.find(i => i.id === activeId) : null;

  return (
    <div className="space-y-5">
      <MarkdownField
        id="lesson-body"
        label="Introduction"
        value={lesson.body}
        readOnly={readOnly}
        minRows={3}
        onChange={body => onChange({ body })}
        placeholder="Why these steps matter, and when to do them."
        emptyPreview="No introduction."
      />

      <section>
        <BlockLabel action={<span className="text-sm tabular-nums text-muted-foreground">{plural(filled, 'item')}</span>}>Checklist</BlockLabel>
        <div ref={listRef} className="rounded-xl border bg-card p-1.5 shadow-2xs">
          {items.length === 0 &&
            (readOnly ? (
              <p className="px-3 py-4 text-center text-[14px] text-muted-foreground">No items yet.</p>
            ) : (
              // A blank first row to type into; it becomes an item with the first keystroke.
              <div className="flex h-9 items-center gap-1.5 rounded-md pr-1">
                <span className="w-5 shrink-0" />
                <Square className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                <input
                  data-item="new"
                  value=""
                  aria-label="First checklist item"
                  placeholder="Describe the first step learners tick off…"
                  className="h-9 min-w-0 flex-1 bg-transparent px-1 text-[14.5px] outline-none placeholder:text-muted-foreground/60"
                  onChange={e => {
                    const id = newId('c');
                    const text = e.target.value.slice(0, 500);
                    update(() => [{ id, text }]);
                    setFocusId({ id, at: 'end' });
                  }}
                />
              </div>
            ))}
          <DndContext sensors={sensors} collisionDetection={pointerFirst} modifiers={[verticalOnly]} autoScroll={gentleAutoScroll} onDragStart={e => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
              {items.map((item, index) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  readOnly={readOnly}
                  onText={text => update(list => list.map(i => (i.id === item.id ? { ...i, text } : i)))}
                  onEnter={(before, after) => {
                    if (after) {
                      // Split the item at the caret, like a notes app.
                      update(list => list.map(i => (i.id === item.id ? { ...i, text: before } : i)));
                      insertAfter(index, [after], 'start');
                    } else insertAfter(index);
                  }}
                  onBackspaceEmpty={() => remove(index)}
                  onRemove={() => remove(index)}
                  onUp={() => items[index - 1] && setFocusId({ id: items[index - 1].id, at: 'end' })}
                  onDown={() => items[index + 1] && setFocusId({ id: items[index + 1].id, at: 'end' })}
                  onPasteLines={lines => {
                    // Into an empty item, the first line fills it; next to existing text, every line becomes its own item.
                    if (!item.text.trim()) {
                      update(list => list.map(i => (i.id === item.id ? { ...i, text: lines[0].slice(0, 500) } : i)));
                      if (lines.length > 1) insertAfter(index, lines.slice(1));
                    } else insertAfter(index, lines);
                  }}
                />
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {active ? (
                <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-2 text-[14px] shadow-lg">
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                  <Square className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{active.text || 'Empty item'}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          {!readOnly && (
            <Button variant="ghost" size="sm" className="mt-0.5 h-9 w-full justify-start gap-2 px-2 text-[14px] font-normal text-muted-foreground" onClick={() => insertAfter(items.length - 1)}>
              <Plus className="!h-3.5 !w-3.5" /> Add item
            </Button>
          )}
        </div>
        {!readOnly && <p className="mt-2 text-sm text-muted-foreground">Enter adds the next item. Paste several lines to add them all at once.</p>}
      </section>
    </div>
  );
}

function ItemRow({ item, readOnly, onText, onEnter, onBackspaceEmpty, onRemove, onUp, onDown, onPasteLines }: {
  item: ChecklistItem;
  readOnly: boolean;
  onText: (text: string) => void;
  onEnter: (before: string, after: string) => void;
  onBackspaceEmpty: () => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  onPasteLines: (lines: string[]) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: readOnly });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('group/item flex min-h-9 items-start gap-1.5 rounded-md py-0.5 pr-1 hover:bg-accent/50', isDragging && 'opacity-40')}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={readOnly}
        aria-label="Reorder item"
        style={{ touchAction: 'none' }}
        className="mt-0.5 flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/70 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/item:opacity-100 disabled:hidden [@media(pointer:coarse)]:opacity-100"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Square className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
      <AutoTextarea
        data-item={item.id}
        value={item.text}
        readOnly={readOnly}
        maxLength={500}
        aria-label="Checklist item"
        placeholder="Describe a step…"
        className="block min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-[7px] text-[14.5px] leading-[20px] outline-none placeholder:text-muted-foreground/60"
        onChange={e => onText(e.target.value.replace(/\n/g, ' '))}
        onPaste={e => {
          const text = e.clipboardData.getData('text/plain');
          if (!text.includes('\n')) return;
          e.preventDefault();
          const lines = text.split(/\r?\n/).map(l => l.replace(/^\s*([-*+]|\d+[.)]|\[[ xX]\])\s+/, '').trim()).filter(Boolean);
          if (lines.length) onPasteLines(lines);
        }}
        onKeyDown={e => {
          if (readOnly) return;
          const el = e.currentTarget;
          // Wrapped items keep the arrows for moving the caret, until it reaches the first or last character.
          const oneLine = el.scrollHeight <= el.clientHeight + 4;
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const at = el.selectionStart ?? el.value.length;
            onEnter(el.value.slice(0, at), el.value.slice(at));
          } else if (e.key === 'Backspace' && !el.value) {
            e.preventDefault();
            onBackspaceEmpty();
          } else if (e.key === 'ArrowUp' && (oneLine || el.selectionStart === 0)) {
            e.preventDefault();
            onUp();
          } else if (e.key === 'ArrowDown' && (oneLine || el.selectionEnd === el.value.length)) {
            e.preventDefault();
            onDown();
          }
        }}
      />
      {!readOnly && (
        <IconButton size="sm" aria-label="Remove item" className="mt-1 opacity-0 focus-visible:opacity-100 group-hover/item:opacity-100 [@media(pointer:coarse)]:opacity-100" onClick={onRemove}>
          <X />
        </IconButton>
      )}
    </div>
  );
}
