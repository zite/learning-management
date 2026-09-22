import { Bold, Check, GripVertical, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, Loader2, Plus, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { uploadFile } from 'zitejs/upload';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { cn } from '@project/components/lib/utils';
import { Markdown } from '@project/shared/ui/Markdown';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import { Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';

/**
 * Dense form controls for course and path settings. Every control saves on
 * its own (on blur, Enter, a pick, or a short pause while typing) and shows a
 * small inline "Saved" beside its label, so there's no Save button to forget.
 */

export const inputClass =
  'h-9 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-[14px] shadow-2xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';
export const textareaClass =
  'block w-full min-w-0 resize-y rounded-md border border-input bg-background px-2.5 py-2 text-[14px] leading-[1.5] shadow-2xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';
export const buttonClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-[14px] shadow-2xs transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5';
export const primaryButtonClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5';

// ── Save state ─────────────────────────────────────────────────────────────

export type SaveStatus = { state: 'saving' } | { state: 'saved' } | { state: 'error'; message: string } | undefined;

/** Per-field save status with "Saved" fading after a moment. */
export function useSaveStatus() {
  const [map, setMap] = useState<Record<string, SaveStatus>>({});
  const timers = useRef(new Map<string, number>());
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);
  const set = useCallback((field: string, status: SaveStatus) => {
    window.clearTimeout(timers.current.get(field));
    setMap(m => ({ ...m, [field]: status }));
    if (status?.state === 'saved') timers.current.set(field, window.setTimeout(() => setMap(m => ({ ...m, [field]: undefined })), 2200));
  }, []);
  return { get: (field: string) => map[field], set };
}

export function SaveState({ status, className }: { status: SaveStatus; className?: string }) {
  if (!status) return null;
  if (status.state === 'saving')
    return (
      <span className={cn('inline-flex items-center gap-1 text-2xs text-muted-foreground animate-fade-in', className)} aria-live="polite">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving
      </span>
    );
  if (status.state === 'saved')
    return (
      <span className={cn('inline-flex items-center gap-1 text-2xs text-tone-success animate-fade-in', className)} aria-live="polite">
        <Check className="h-3 w-3" strokeWidth={2.5} /> Saved
      </span>
    );
  return (
    <span className={cn('inline-flex items-center gap-1 text-2xs text-tone-danger', className)} aria-live="polite">
      <TriangleAlert className="h-3 w-3" /> Not saved
    </span>
  );
}

// ── Layout ─────────────────────────────────────────────────────────────────

export function Field({ label, htmlFor, hint, error, status, children, className, aside }: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  status?: SaveStatus;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  const err = error ?? (status?.state === 'error' ? status.message : null);
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <div className="flex min-h-4 items-center gap-2">
        <label htmlFor={htmlFor} className="block text-sm font-medium">
          {label}
        </label>
        <SaveState status={status?.state === 'error' ? undefined : status} />
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
      {err ? <p className="text-sm text-tone-danger">{err}</p> : hint ? <div className="text-sm text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function PageTitle({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <div className="min-w-0 flex-1">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-1 max-w-[600px] text-[14px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SettingsSection({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mb-8 last:mb-0', className)}>
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-semibold">{title}</h3>
          {description && <p className="mt-0.5 max-w-[620px] text-[13.5px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('divide-y overflow-hidden rounded-lg border bg-background', className)}>{children}</div>;
}

/** Label and explanation on the left, the control on the right; stacks on a phone. */
export function SettingsRow({ label, description, children, className, htmlFor, status }: { label: ReactNode; description?: ReactNode; children?: ReactNode; className?: string; htmlFor?: string; status?: SaveStatus }) {
  return (
    <div className={cn('flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <label htmlFor={htmlFor} className="text-[14px] font-medium">
            {label}
          </label>
          <SaveState status={status} />
        </div>
        {description && <div className="mt-0.5 text-[13.5px] text-muted-foreground">{description}</div>}
        {status?.state === 'error' && <p className="mt-1 text-sm text-tone-danger">{status.message}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

// ── Inputs that commit themselves ─────────────────────────────────────────

/**
 * A text input that keeps its own draft and commits on blur, Enter or (with
 * `debounce`) a pause in typing. Escape reverts. It follows the server value
 * whenever it isn't focused, so an optimistic save or refetch shows up.
 */
export function AutoInput({ id, value, onCommit, placeholder, required, maxLength, className, disabled, debounce, transform, multiline, rows = 3, 'aria-label': ariaLabel }: {
  id?: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
  debounce?: number;
  transform?: (v: string) => string;
  multiline?: boolean;
  rows?: number;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const cancelled = useRef(false);
  const lastCommitted = useRef(value);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    lastCommitted.current = value;
    if (!focused.current) setDraft(value);
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const commit = (text: string) => {
    window.clearTimeout(timer.current);
    const next = multiline ? text : text.trim();
    if (required && !next.trim()) return;
    if (next === lastCommitted.current) return;
    lastCommitted.current = next;
    onCommit(next);
  };

  const common = {
    id,
    value: draft,
    maxLength,
    placeholder,
    disabled,
    'aria-label': ariaLabel,
    onFocus: () => {
      focused.current = true;
    },
    onChange: (e: { target: { value: string } }) => {
      const v = transform ? transform(e.target.value) : e.target.value;
      setDraft(v);
      if (debounce) {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => commit(v), debounce);
      }
    },
    onBlur: () => {
      focused.current = false;
      if (cancelled.current) {
        cancelled.current = false;
        setDraft(value);
        return;
      }
      if (required && !draft.trim()) {
        setDraft(value);
        return;
      }
      commit(draft);
    },
  };

  if (multiline) {
    return (
      <textarea
        {...common}
        rows={rows}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className={cn(textareaClass, className)}
      />
    );
  }
  return (
    <input
      {...common}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={cn(inputClass, className)}
    />
  );
}

/** A whole number or "not set", committed on blur. */
export function NumberInput({ id, value, onCommit, min = 1, max = 3650, placeholder, disabled, suffix, className, 'aria-label': ariaLabel }: {
  id?: string;
  value: number | null;
  onCommit: (next: number | null) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  suffix?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : String(value));
  }, [value]);
  const commit = () => {
    const raw = text.trim();
    if (!raw) {
      if (value != null) onCommit(null);
      return;
    }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) {
      setText(value == null ? '' : String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <div className={cn('flex h-9 items-center rounded-md border border-input bg-background shadow-2xs focus-within:border-ring focus-within:ring-1 focus-within:ring-ring', disabled && 'opacity-60', className)}>
      <input
        id={id}
        inputMode="numeric"
        aria-label={ariaLabel}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onChange={e => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
        className="h-full w-16 min-w-0 flex-1 bg-transparent px-2.5 text-[14px] tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      {suffix && <span className="pr-2.5 text-[13.5px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

// ── Icon and colour ────────────────────────────────────────────────────────

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

export function SwatchGrid({ value, colors, onPick, columns = 10 }: { value: string | null | undefined; colors: string[]; onPick: (c: string) => void; columns?: number }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, 22px)` }} role="radiogroup" aria-label="Colour">
      {colors.map(c => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-label={`Colour ${c}`}
          aria-checked={same(c, value)}
          onClick={() => onPick(c)}
          className={cn('flex h-[22px] w-[22px] items-center justify-center rounded-full ring-offset-2 ring-offset-popover transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', same(c, value) && 'ring-2 ring-foreground/50')}
          style={{ background: c }}
        >
          {same(c, value) && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

export function IconColorPicker({ icon, color, icons, colors, onChange, disabled, size = 32 }: {
  icon: string | null | undefined;
  color: string | null | undefined;
  icons: string[];
  colors: string[];
  onChange: (next: { icon?: string; color?: string }) => void;
  disabled?: boolean;
  size?: number;
}) {
  const choices = icon && !icons.includes(icon) ? [icon, ...icons] : icons;
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button type="button" aria-label="Change icon and colour" className="flex shrink-0 items-center justify-center rounded-lg border border-input bg-background p-1 shadow-2xs transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-60" style={{ width: size + 10, height: size + 10 }}>
          <CourseGlyph icon={icon} color={color} size={size} className="rounded-md" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3 shadow-lg">
        <div className="mb-1.5 text-2xs font-medium text-muted-foreground">Icon</div>
        <div className="mb-3 grid grid-cols-8 gap-1">
          {choices.map(i => (
            <button
              key={i}
              type="button"
              onClick={() => onChange({ icon: i })}
              aria-label={`Icon ${i}`}
              aria-pressed={i === icon}
              className={cn('flex h-7 w-7 items-center justify-center rounded-md text-[16px] transition-colors', i === icon ? 'bg-accent ring-1 ring-foreground/25' : 'hover:bg-accent')}
            >
              {i}
            </button>
          ))}
        </div>
        <div className="mb-1.5 text-2xs font-medium text-muted-foreground">Colour</div>
        <SwatchGrid value={color} colors={colors} onPick={c => onChange({ color: c })} columns={8} />
      </PopoverContent>
    </Popover>
  );
}

// ── Markdown ───────────────────────────────────────────────────────────────

type Wrap = { before: string; after?: string; line?: boolean; placeholder: string };

const ACTIONS: Array<{ key: string; label: string; icon: ReactNode; keys?: string[]; wrap: Wrap }> = [
  { key: 'bold', label: 'Bold', icon: <Bold />, keys: [MOD, 'B'], wrap: { before: '**', after: '**', placeholder: 'bold text' } },
  { key: 'italic', label: 'Italic', icon: <Italic />, keys: [MOD, 'I'], wrap: { before: '_', after: '_', placeholder: 'emphasis' } },
  { key: 'heading', label: 'Heading', icon: <Heading2 />, wrap: { before: '## ', line: true, placeholder: 'Heading' } },
  { key: 'list', label: 'Bulleted list', icon: <List />, wrap: { before: '- ', line: true, placeholder: 'List item' } },
  { key: 'ordered', label: 'Numbered list', icon: <ListOrdered />, wrap: { before: '1. ', line: true, placeholder: 'List item' } },
  { key: 'link', label: 'Link', icon: <Link2 />, wrap: { before: '[', after: '](https://)', placeholder: 'link text' } },
];

/**
 * Markdown with a formatting bar and a live preview rendered by the same
 * component learners see. Side by side on wide screens; Write and Preview tabs
 * on narrow ones. Saves after a pause in typing and on blur.
 */
export function MarkdownEditor({ id, value, onCommit, placeholder, rows = 10, maxLength, disabled }: {
  id?: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const last = useRef(value);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    last.current = value;
    if (!focused.current) setDraft(value);
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const commit = (text: string) => {
    window.clearTimeout(timer.current);
    if (text === last.current) return;
    last.current = text;
    onCommit(text);
  };
  const change = (text: string) => {
    setDraft(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commit(text), 1200);
  };

  const apply = (w: Wrap) => {
    const el = ref.current;
    if (!el || disabled) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = draft.slice(start, end) || w.placeholder;
    let next: string;
    let selStart: number;
    let selEnd: number;
    if (w.line) {
      const lineStart = draft.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = draft.indexOf('\n', end) === -1 ? draft.length : draft.indexOf('\n', end);
      const block = (draft.slice(lineStart, lineEnd) || w.placeholder)
        .split('\n')
        .map((l, i) => (w.before === '1. ' ? `${i + 1}. ` : w.before) + l.replace(/^(#{1,6} |- |\d+\. )/, ''))
        .join('\n');
      next = `${draft.slice(0, lineStart)}${block}${draft.slice(lineEnd)}`;
      selStart = lineStart;
      selEnd = lineStart + block.length;
    } else {
      next = `${draft.slice(0, start)}${w.before}${selected}${w.after ?? ''}${draft.slice(end)}`;
      selStart = start + w.before.length;
      selEnd = selStart + selected.length;
    }
    if (maxLength && next.length > maxLength) return;
    change(next);
    window.setTimeout(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    }, 0);
  };

  return (
    <div className={cn('overflow-hidden rounded-lg border border-input bg-background shadow-2xs focus-within:border-ring focus-within:ring-1 focus-within:ring-ring', disabled && 'opacity-70')}>
      <div className="flex h-9 items-center gap-0.5 border-b px-1.5">
        {ACTIONS.map(a => (
          <Tip key={a.key} label={a.label} keys={a.keys}>
            <button
              type="button"
              aria-label={a.label}
              disabled={disabled}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                setTab('write');
                apply(a.wrap);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none [&_svg]:h-3.5 [&_svg]:w-3.5"
            >
              {a.icon}
            </button>
          </Tip>
        ))}
        <div className="ml-auto flex items-center gap-0.5 lg:hidden" role="tablist" aria-label="Editor mode">
          {(['write', 'preview'] as const).map(t => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('h-6 rounded-md px-2 text-sm capitalize', tab === t ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {t}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden text-2xs text-muted-foreground lg:inline">Markdown</span>
      </div>
      <div className="grid lg:grid-cols-2">
        <textarea
          id={id}
          ref={ref}
          value={draft}
          rows={rows}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            commit(draft);
          }}
          onChange={e => change(e.target.value)}
          onKeyDown={e => {
            if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
            const k = e.key.toLowerCase();
            const hit = k === 'b' ? ACTIONS[0] : k === 'i' ? ACTIONS[1] : null;
            if (hit) {
              e.preventDefault();
              e.stopPropagation();
              apply(hit.wrap);
            }
          }}
          className={cn('block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[13.5px] leading-[1.6] outline-none placeholder:font-sans placeholder:text-muted-foreground disabled:cursor-not-allowed lg:border-r', tab === 'preview' && 'hidden lg:block')}
        />
        <div className={cn('min-h-[120px] overflow-y-auto bg-subtle/60 px-4 py-3 lg:block', tab === 'write' && 'hidden')} style={{ maxHeight: rows * 26 + 40 }}>
          <div className="mb-2 text-sm text-muted-foreground">Preview</div>
          {draft.trim() ? <Markdown className="text-[14px]">{draft}</Markdown> : <p className="text-[14px] text-muted-foreground">Nothing to preview yet.</p>}
        </div>
      </div>
    </div>
  );
}

// ── Lists ──────────────────────────────────────────────────────────────────

/** An ordered list of short lines — learning objectives. Add, edit in place, drag or nudge to reorder, delete. */
export function ListEditor({ value, onCommit, placeholder, addLabel, max = 30, disabled }: { value: string[]; onCommit: (next: string[]) => void; placeholder: string; addLabel: string; max?: number; disabled?: boolean }) {
  const [items, setItems] = useState(value);
  const [newText, setNewText] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setItems(value);
  }, [value]);

  const commit = (next: string[]) => {
    const clean = next.map(s => s.trim()).filter(Boolean);
    setItems(clean);
    if (JSON.stringify(clean) !== JSON.stringify(value)) onCommit(clean);
  };
  const add = () => {
    const t = newText.trim();
    if (!t || items.length >= max) return;
    setNewText('');
    commit([...items, t]);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    commit(next);
  };

  return (
    <div className="space-y-1.5">
      {items.length > 0 && (
        <ol className="overflow-hidden rounded-md border bg-background">
          {items.map((item, i) => (
            <li
              key={i}
              draggable={!disabled}
              onDragStart={e => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={e => {
                if (dragIndex === null) return;
                e.preventDefault();
                setOverIndex(i);
              }}
              onDrop={e => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={cn('group flex items-center gap-1.5 border-b pl-1 pr-1.5 last:border-b-0', dragIndex === i && 'opacity-40', overIndex === i && dragIndex !== null && dragIndex !== i && 'bg-primary/[0.06]')}
            >
              <span className={cn('flex h-9 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/60 active:cursor-grabbing', disabled && 'invisible')} aria-hidden>
                <GripVertical className="h-3.5 w-3.5" />
              </span>
              <span className="w-4 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{i + 1}</span>
              <input
                value={item}
                disabled={disabled}
                aria-label={`Objective ${i + 1}`}
                maxLength={300}
                onFocus={() => (editing.current = true)}
                onChange={e => setItems(list => list.map((x, j) => (j === i ? e.target.value : x)))}
                onBlur={() => {
                  editing.current = false;
                  commit(items);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.altKey && e.key === 'ArrowUp') {
                    e.preventDefault();
                    move(i, i - 1);
                  }
                  if (e.altKey && e.key === 'ArrowDown') {
                    e.preventDefault();
                    move(i, i + 1);
                  }
                }}
                className="h-9 min-w-0 flex-1 bg-transparent px-1.5 text-[14px] outline-none disabled:cursor-not-allowed"
              />
              {!disabled && (
                <button type="button" onClick={() => commit(items.filter((_, j) => j !== i))} aria-label={`Remove objective ${i + 1}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {!disabled && items.length < max && (
        <div className="flex items-center gap-1.5">
          <input
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            maxLength={300}
            placeholder={placeholder}
            aria-label={addLabel}
            className={inputClass}
          />
          <button type="button" onClick={add} disabled={!newText.trim()} className={buttonClass}>
            <Plus /> Add
          </button>
        </div>
      )}
    </div>
  );
}

/** Short tags typed and confirmed with Enter or a comma — skills. */
export function ChipsInput({ value, onCommit, placeholder, max = 30, disabled, suggestions = [] }: { value: string[]; onCommit: (next: string[]) => void; placeholder: string; max?: number; disabled?: boolean; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(',').map(s => s.trim().slice(0, 60)).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.some(x => x.toLowerCase() === p.toLowerCase()) && next.length < max) next.push(p);
    setText('');
    if (next.length !== value.length) onCommit(next);
  };
  const open = suggestions.filter(s => !value.some(v => v.toLowerCase() === s.toLowerCase()) && (!text || s.toLowerCase().includes(text.toLowerCase()))).slice(0, 6);
  return (
    <div>
      <div className={cn('flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 shadow-2xs focus-within:border-ring focus-within:ring-1 focus-within:ring-ring', disabled && 'opacity-60')}>
        {value.map(s => (
          <span key={s} className="chip h-6 bg-subtle pr-0.5">
            {s}
            {!disabled && (
              <button type="button" onClick={() => onCommit(value.filter(x => x !== s))} aria-label={`Remove ${s}`} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            value={text}
            onChange={e => {
              if (e.target.value.endsWith(',')) add(e.target.value);
              else setText(e.target.value);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(text);
              }
              if (e.key === 'Backspace' && !text && value.length) onCommit(value.slice(0, -1));
            }}
            onBlur={() => text.trim() && add(text)}
            placeholder={value.length ? '' : placeholder}
            aria-label={placeholder}
            className="h-6 min-w-[120px] flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-muted-foreground"
          />
        )}
      </div>
      {!disabled && open.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-2xs text-muted-foreground">Used elsewhere:</span>
          {open.map(s => (
            <button key={s} type="button" onClick={() => add(s)} className="chip h-5 border-dashed px-1.5 text-2xs text-muted-foreground hover:border-foreground/30 hover:text-foreground">
              <Plus className="h-2.5 w-2.5" /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cover image ────────────────────────────────────────────────────────────

/** A 16:9 cover: upload a file, paste an address, preview it, or remove it. Falls back to the course colour and icon. */
export function CoverImageField({ value, onCommit, title, color, disabled }: { value: string | null; onCommit: (url: string | null) => void; title: string; color: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [broken, setBroken] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setBroken(false), [value]);

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file — JPG, PNG, WebP or GIF');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('That image is over 10 MB. Try a smaller one.');
      return;
    }
    setBusy(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      onCommit(fileUrl);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't upload the image"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div
        className="relative aspect-video w-full max-w-[280px] shrink-0 overflow-hidden rounded-lg border bg-muted"
        onDragOver={e => !disabled && e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f && !disabled) upload(f);
        }}
      >
        {value && !broken ? <img src={value} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" /> : <CoverFallback title={title} color={color} letterSize={48} />}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-sm text-muted-foreground">{broken ? 'That image couldn’t be loaded — check the address or upload it instead.' : value ? 'Shown in the catalog and at the top of the page. 1600×900 or larger works best.' : 'Without an image, the catalog shows the colour lettered with the title’s initial. 1600×900 or larger works best.'}</p>
        {!disabled && (
          <div className="flex flex-wrap gap-1.5">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={buttonClass}>
              <Upload /> {value ? 'Replace' : 'Upload image'}
            </button>
            <Popover open={urlOpen} onOpenChange={o => { setUrlOpen(o); if (o) setUrl(value ?? ''); }}>
              <PopoverTrigger asChild>
                <button type="button" className={buttonClass}>
                  <ImagePlus /> Use a link
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-3 shadow-lg">
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    const u = url.trim();
                    if (u && !/^https?:\/\/\S+$/i.test(u)) {
                      toast.error('Use a full address starting with https://');
                      return;
                    }
                    onCommit(u || null);
                    setUrlOpen(false);
                  }}
                  className="space-y-2"
                >
                  <label className="text-sm font-medium" htmlFor="cover-url">Image address</label>
                  <input id="cover-url" autoFocus value={url} onChange={e => setUrl(e.target.value)} placeholder="https://images.example.com/cover.jpg" className={inputClass} />
                  <div className="flex justify-end">
                    <button type="submit" className={primaryButtonClass}>Use image</button>
                  </div>
                </form>
              </PopoverContent>
            </Popover>
            {value && (
              <button type="button" onClick={() => onCommit(null)} className={cn(buttonClass, 'text-muted-foreground hover:text-foreground')}>
                <X /> Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function hexChannels(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]) {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * A solid field of the course colour with a faint engraved texture, lettered in
 * cream (or ink, on a pale colour) — the same stand-in the academy shows, so a
 * course without a photo looks the same to staff and learners.
 */
export function pigmentStyle(color: string | null | undefined) {
  const rgb = hexChannels(color || '') ?? [47, 107, 85];
  const cream = (1.05) / (luminance(rgb) + 0.05) >= 3;
  return {
    backgroundColor: `rgb(${rgb.join(' ')})`,
    backgroundImage: 'radial-gradient(130% 100% at 100% 0%, rgb(255 255 255 / 0.16), transparent 55%), repeating-linear-gradient(135deg, rgb(255 255 255 / 0.05) 0 1px, transparent 1px 9px)',
    color: cream ? '#faf6ee' : '#1f1b17',
  };
}

/** The first letter or digit of a title. */
export const monogram = (title: string | null | undefined) => ((title ?? '').match(/[\p{L}\p{N}]/u)?.[0] ?? '').toUpperCase();

/** The cover when there's no image: the course colour, lettered with its initial. */
export function CoverFallback({ title, color, className, letterSize = 56 }: { title?: string | null; color?: string | null; className?: string; letterSize?: number }) {
  return (
    <div className={cn('relative h-full w-full', className)} style={pigmentStyle(color)} aria-hidden>
      <span className="absolute bottom-[7%] left-[5.5%] font-serif font-medium leading-none" style={{ fontSize: letterSize }}>
        {monogram(title) || '·'}
      </span>
    </div>
  );
}
