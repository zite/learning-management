import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { saveSettings, type SaveSettingsInputType } from 'zitejs/api';
import { Button } from '@project/components/ui/button';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import { qk } from '../../lib/queries';
import type { Bootstrap } from '../../lib/types';
import { Kbd } from '../primitives/bits';
import { hasUnsavedChanges, holdUnsaved, LEAVE_CONFIRM } from '../../lib/navGuard';

/** Query keys for this area. "settings" is not used by any other area. */
export const settingsKeys = {
  root: ['settings'] as const,
  profile: ['settings', 'profile'] as const,
  demo: ['settings', 'demo-dry-run'] as const,
};

// ---------------------------------------------------------------------------
// Saving settings
// ---------------------------------------------------------------------------

/**
 * Save a partial settings patch: written into the bootstrap cache before the
 * request leaves (every screen reading `ws.settings` updates at once), rolled
 * back if the server refuses, then replaced by the server's copy.
 */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useCallback(
    async (patch: SaveSettingsInputType, opts: { success?: string | null; error: string; optimistic?: Partial<Bootstrap['settings']> }) => {
      await qc.cancelQueries({ queryKey: qk.bootstrap });
      const previous = qc.getQueryData<Bootstrap>(qk.bootstrap);
      if (previous && opts.optimistic) qc.setQueryData<Bootstrap>(qk.bootstrap, { ...previous, settings: { ...previous.settings, ...opts.optimistic } });
      try {
        const next = await saveSettings(patch);
        qc.setQueryData<Bootstrap>(qk.bootstrap, old => (old ? { ...old, settings: { ...old.settings, ...next } } : old));
        if (opts.success) toast.success(opts.success);
        return next;
      } catch (e) {
        if (previous) qc.setQueryData(qk.bootstrap, previous);
        toast.error(errorMessage(e, opts.error));
        throw e;
      } finally {
        void qc.invalidateQueries({ queryKey: qk.bootstrap });
      }
    },
    [qc],
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function SettingsPageTitle({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <div className="min-w-0 flex-1">
        <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-1 max-w-[600px] text-[14px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SettingsSection({ title, description, actions, children, className, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn('mb-10 last:mb-0', className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {description && <p className="mt-0.5 max-w-[600px] text-[14px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('divide-y overflow-hidden rounded-lg border bg-background shadow-2xs', className)}>{children}</div>;
}

/**
 * Label and explanation on the left, the control on the right; stacks on a phone.
 * Inputs get a fixed control column so they line up row to row; `compact`
 * controls (a switch, a button, a short value) size to themselves and leave the
 * explanation room to breathe instead of wrapping into a narrow column.
 */
export function SettingsRow({ label, description, htmlFor, children, className, stacked, wide, compact }: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
  className?: string;
  stacked?: boolean;
  /** A wider control column, for inputs that need room. */
  wide?: boolean;
  /** A button or short value: no fixed control column. `'switch'` also keeps it beside the label on a phone. */
  compact?: boolean | 'switch';
}) {
  return (
    <div className={cn('flex flex-col gap-2.5 px-4 py-3.5', !stacked && 'sm:flex-row sm:items-center sm:justify-between sm:gap-8', compact === 'switch' && 'flex-row items-center justify-between gap-4', className)}>
      <div className={cn('min-w-0', !stacked && (compact ? 'flex-1 sm:max-w-[520px]' : 'sm:max-w-[320px] sm:flex-1'))}>
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-[14px] font-medium">{label}</label>
        ) : (
          <div className="text-[14px] font-medium">{label}</div>
        )}
        {description && <div className="mt-0.5 text-[13.5px] text-muted-foreground">{description}</div>}
      </div>
      {children && (
        <div className={cn('min-w-0', stacked ? 'w-full' : compact ? 'flex shrink-0 items-center gap-2' : cn('flex shrink-0 items-center gap-2 sm:justify-end', wide ? 'sm:w-[360px]' : 'sm:w-[300px]'))}>
          {children}
        </div>
      )}
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children, className, aside }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
        {aside}
      </div>
      {children}
      {error ? <p className="text-sm text-tone-danger" role="alert">{error}</p> : hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-sm text-tone-danger" role="alert">{children}</p>;
}

export const inputClass = 'h-9 text-[14px] md:text-[14px]';
export const textareaClass = 'block w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-[14px] leading-relaxed shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

/** Radio options as cards that explain themselves. Arrow keys move between them. */
export function RadioCards<V extends string>({ value, onChange, options, name, columns = 2, disabled }: {
  value: V;
  onChange: (v: V) => void;
  options: Array<{ value: V; label: string; description: ReactNode; icon?: ReactNode }>;
  name: string;
  columns?: 1 | 2 | 3;
  disabled?: boolean;
}) {
  const refs = useRef(new Map<V, HTMLButtonElement>());
  return (
    <div role="radiogroup" aria-label={name} className={cn('grid gap-2', columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '')}>
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            ref={el => {
              if (el) refs.current.set(o.value, el);
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={e => {
              const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = options[(i + step + options.length) % options.length];
              onChange(next.value);
              refs.current.get(next.value)?.focus();
            }}
            className={cn(
              'flex min-w-0 flex-col items-start gap-1 rounded-lg border bg-background p-3 text-left transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
              on ? 'border-primary ring-1 ring-primary' : 'hover:border-foreground/25',
            )}
          >
            <span className="flex w-full items-center gap-2">
              {o.icon && <span className={cn('flex shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5', on ? 'text-primary' : 'text-muted-foreground')}>{o.icon}</span>}
              <span className="min-w-0 flex-1 text-[14px] font-medium">{o.label}</span>
              <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', on ? 'border-primary bg-primary' : 'border-input')} aria-hidden>
                {on && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
              </span>
            </span>
            <span className="text-sm leading-relaxed text-muted-foreground">{o.description}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Colour swatches as a radio group, with a tick on the chosen one. */
export function Swatches({ value, onChange, colors, size = 'md', label }: { value: string; onChange: (c: string) => void; colors: string[]; size?: 'sm' | 'md'; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {colors.map(c => {
        const on = c.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`Colour ${c}`}
            onClick={() => onChange(c)}
            className={cn(
              'flex items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              size === 'sm' ? 'h-5 w-5' : 'h-7 w-7',
              on && 'ring-2 ring-foreground/60',
            )}
            style={{ background: c }}
          >
            {on && <Check className={cn('text-white', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms with a save bar
// ---------------------------------------------------------------------------

/**
 * A draft of some saved values. Edits stay local until saved; a change saved
 * elsewhere (another tab, an optimistic toggle) is adopted only while there
 * are no unsaved edits here.
 */
export function useDraft<T extends Record<string, unknown>>(base: T) {
  const [draft, setDraft] = useState<T>(base);
  const baseKey = JSON.stringify(base);
  const lastBase = useRef(baseKey);
  useEffect(() => {
    if (lastBase.current === baseKey) return;
    setDraft(current => (JSON.stringify(current) === lastBase.current ? (JSON.parse(baseKey) as T) : current));
    lastBase.current = baseKey;
  }, [baseKey]);
  const dirty = JSON.stringify(draft) !== baseKey;
  const set = useCallback((patch: Partial<T>) => setDraft(d => ({ ...d, ...patch })), []);
  const reset = useCallback(() => setDraft(JSON.parse(baseKey) as T), [baseKey]);
  const changed = (Object.keys(base) as Array<keyof T>).filter(k => JSON.stringify(draft[k]) !== JSON.stringify(base[k]));
  return { draft, set, reset, dirty, changed };
}

/**
 * Warn before leaving with unsaved edits: reloading or closing the tab, and
 * following a link inside the app (the sidebar, the settings nav). The app uses
 * a hash router without navigation blocking, so links are caught on the way in.
 */
/** True while any settings form on screen has unsaved edits — for navigation that doesn't go through a link. */
export const hasUnsavedSettings = hasUnsavedChanges;
export { LEAVE_CONFIRM };

export function useLeaveGuard(dirty: boolean) {
  const app = useAppActions();
  useEffect(() => {
    if (!dirty) return;
    const release = holdUnsaved();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      const href = link?.getAttribute('href');
      if (!link || !href?.startsWith('#/') || link.target === '_blank' || href === window.location.hash) return;
      e.preventDefault();
      e.stopPropagation();
      void app
        .confirm(LEAVE_CONFIRM)
        .then(ok => {
          if (ok) window.location.hash = href;
        });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      release();
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, app]);
}

export function SaveBar({ dirty, saving, onSave, onDiscard, disabled, message = 'You have unsaved changes' }: { dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void; disabled?: boolean; message?: string }) {
  useLeaveGuard(dirty);
  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter')) {
        if (document.querySelector('[role="dialog"][data-state="open"]')) return;
        e.preventDefault();
        if (!saving) onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, onSave]);
  if (!dirty) return null;
  return (
    <div className="sticky bottom-4 z-20 mt-8 animate-fade-up" data-save-bar>
      <div className="flex items-center gap-3 rounded-lg border bg-popover px-4 py-2.5 shadow-lg">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-tone-warning" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[14px]">
          <span className="sm:hidden">Unsaved changes</span>
          <span className="hidden sm:inline">{message}</span>
        </span>
        <span className="hidden items-center gap-1 text-sm text-muted-foreground lg:flex"><Kbd>{MOD}</Kbd><Kbd>S</Kbd></span>
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>Discard</Button>
        <Button size="sm" onClick={onSave} disabled={saving || disabled}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </div>
  );
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const HEX_RE = /^#[0-9a-f]{6}$/i;

/** "example.org" → "https://example.org"; an error message for anything that still isn't a secure web address. */
export function normalizeUrl(value: string): { url: string; error: string | null } {
  const t = value.trim();
  if (!t) return { url: '', error: null };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:') return { url: t, error: 'Use a secure https:// address' };
    if (!u.hostname.includes('.')) return { url: t, error: 'Enter a full address, like fernwood.com' };
    return { url: u.pathname === '/' && !u.search && !u.hash ? u.origin : u.toString(), error: null };
  } catch {
    return { url: t, error: 'Enter a full address, like fernwood.com' };
  }
}
