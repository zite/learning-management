import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { Tip } from '../primitives/bits';

export const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-2.5 text-[14px] shadow-2xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60 read-only:focus-visible:ring-0 aria-[invalid=true]:border-tone-danger';

export const textareaClass =
  'block w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-[14px] leading-relaxed shadow-2xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15 disabled:opacity-60';

/** A textarea that grows with its content. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxHeight?: number }>(
  ({ className, minRows = 1, maxHeight = 100_000, value, ...props }, forwarded) => {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    useLayoutEffect(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight + 2, maxHeight)}px`;
    }, [value, maxHeight]);
    // Width changes (a pane opening, the window resizing) re-wrap the text.
    useEffect(() => {
      const el = inner.current;
      if (!el || typeof ResizeObserver === 'undefined') return;
      let w = el.clientWidth;
      const ro = new ResizeObserver(() => {
        if (el.clientWidth === w) return;
        w = el.clientWidth;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight + 2, maxHeight)}px`;
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [maxHeight]);
    return (
      <textarea
        ref={el => {
          inner.current = el;
          if (typeof forwarded === 'function') forwarded(el);
          else if (forwarded) forwarded.current = el;
        }}
        rows={minRows}
        value={value}
        className={className}
        {...props}
      />
    );
  },
);
AutoTextarea.displayName = 'AutoTextarea';

export type SegmentOption = { value: string; label: ReactNode; icon?: ReactNode; tip?: string };

export function Segmented({ value, onChange, options, className, size = 'md', disabled, ariaLabel }: {
  value: string;
  onChange: (v: string) => void;
  options: SegmentOption[];
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex shrink-0 items-center rounded-md border bg-subtle p-0.5', disabled && 'opacity-60', className)}>
      {options.map(o => {
        const on = o.value === value;
        const button = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            aria-label={typeof o.label === 'string' && o.label ? o.label : o.tip}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] font-medium transition-colors disabled:cursor-not-allowed [&_svg]:h-3.5 [&_svg]:w-3.5',
              size === 'sm' ? 'h-6 px-2 text-sm' : 'h-[26px] px-2.5 text-[13.5px]',
              on ? 'bg-background text-foreground shadow-xs ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
        return o.tip ? (
          <Tip key={o.value} label={o.tip}>
            {button}
          </Tip>
        ) : (
          button
        );
      })}
    </div>
  );
}

/** A number box that allows an empty value while typing and only commits numbers in range. */
export function NumberField({ value, onChange, placeholder, min, max, className, suffix, ariaLabel, disabled, id, inputClassName }: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  className?: string;
  suffix?: string;
  ariaLabel: string;
  disabled?: boolean;
  id?: string;
  inputClassName?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : String(value));
  }, [value]);
  const parsed = text.trim() === '' ? null : Number(text);
  const bad = parsed !== null && (!Number.isInteger(parsed) || (min != null && parsed < min) || (max != null && parsed > max));
  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="numeric"
        disabled={disabled}
        aria-invalid={bad || undefined}
        className={cn(inputClass, 'tabular-nums', suffix && 'pr-10', inputClassName)}
        value={text}
        placeholder={placeholder}
        onFocus={e => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          setText(value == null ? '' : String(value));
        }}
        onKeyDown={e => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const base = parsed ?? value ?? min ?? 0;
          const n = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, base + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)));
          setText(String(n));
          onChange(n);
        }}
        onChange={e => {
          const t = e.target.value.replace(/[^0-9-]/g, '');
          setText(t);
          const n = t.trim() === '' ? null : Number(t);
          if (n === null) onChange(null);
          else if (Number.isInteger(n) && (min == null || n >= min) && (max == null || n <= max)) onChange(n);
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{suffix}</span>}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor, className, aside }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string; className?: string; aside?: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="block text-[13.5px] font-medium text-foreground">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint && <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ToggleRow({ label, description, checked, onChange, disabled, id }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className={cn('min-w-0 cursor-pointer', disabled && 'cursor-not-allowed')}>
        <span className="block text-[14px] font-medium leading-5">{label}</span>
        {description && <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{description}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}

/** A titled block inside the editor column. */
export function Panel({ title, description, action, children, className, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <section className={cn('rounded-xl border bg-card shadow-2xs', className)}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && <span className="mt-0.5 flex shrink-0 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
          <div className="min-w-0">
            <h3 className="text-[14px] font-medium leading-5">{title}</h3>
            {description && <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </header>
      <div className="space-y-4 px-4 py-4">{children}</div>
    </section>
  );
}

/** The small uppercase label above a block of editor content. */
export function BlockLabel({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 flex min-h-6 items-center justify-between gap-2', className)}>
      <h3 className="text-sm font-medium text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}
