import { Search, X } from 'lucide-react';
import { forwardRef, useState, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { Tip } from '../primitives/bits';
import { CoverFallback } from './fields';

export type CatalogStatus = 'Draft' | 'Published' | 'Archived';

/** A course or path's status as a small pill. Published is quiet; drafts and archives stand out. */
export function StatusPill({ status, className }: { status: CatalogStatus; className?: string }) {
  const meta = {
    Published: { label: 'Published', cls: 'bg-tone-success/[0.1] text-tone-success', dot: 'bg-tone-success' },
    Draft: { label: 'Draft', cls: 'bg-tone-warning/[0.12] text-tone-warning', dot: 'bg-tone-warning' },
    Archived: { label: 'Archived', cls: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/60' },
  }[status];
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-2xs font-medium', meta.cls, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

/** Where a learner opens this course or path, once the learner app has run and recorded its address. */
export function learnerUrl(learnUrl: string | null | undefined, kind: 'courses' | 'paths', slug: string) {
  if (!learnUrl) return null;
  return `${learnUrl.replace(/\/+$/, '')}/#/${kind}/${slug}`;
}

/** 16:9 cover image, or the lettered colour field when there's none (or it fails to load). */
export function CourseCover({ coverImageUrl, title, color, className, letterSize = 56, width = 640 }: { coverImageUrl?: string | null; title: string; color?: string | null; className?: string; letterSize?: number; width?: number }) {
  const [broken, setBroken] = useState(false);
  const src = coverImageUrl ? coverImageUrl.replace(/w=\d+&h=\d+/, `w=${width}&h=${Math.round((width * 9) / 16)}`) : null;
  return (
    <div className={cn('relative aspect-video w-full overflow-hidden bg-muted', className)}>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" /> : <CoverFallback title={title} color={color} letterSize={letterSize} />}
    </div>
  );
}

/** A tiny completion bar with its percentage. */
export function MiniBar({ value, className, tone = 'primary', label = true }: { value: number | null; className?: string; tone?: 'primary' | 'success'; label?: boolean }) {
  if (value == null) return <span className={cn('text-sm text-muted-foreground/60', className)}>—</span>;
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="h-1 min-w-[36px] flex-1 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full', tone === 'success' ? 'bg-tone-success' : 'bg-foreground/70')} style={{ width: `${v}%` }} />
      </span>
      {label && <span className="w-8 text-right text-sm tabular-nums text-muted-foreground">{Math.round(v)}%</span>}
    </span>
  );
}

/** Header tabs that live in the query string. */
export function QueryTabs<K extends string>({ tabs, value, onChange, label }: { tabs: Array<{ key: K; label: string; count?: number; tip?: string; keys?: string[] }>; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <nav className="ml-2 flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none" aria-label={label}>
      {tabs.map(t => {
        const on = t.key === value;
        const btn = (
          <button
            key={t.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(t.key)}
            className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13.5px] transition-colors', on ? 'border-border bg-accent font-medium text-foreground shadow-2xs' : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground')}
          >
            {t.label}
            {t.count != null && t.count > 0 && <span className="tabular-nums text-muted-foreground">{t.count}</span>}
          </button>
        );
        return t.tip ? (
          <Tip key={t.key} label={t.tip} keys={t.keys}>
            {btn}
          </Tip>
        ) : (
          btn
        );
      })}
    </nav>
  );
}

/** The inline search field lists open with `/`. */
export const SearchField = forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void; placeholder: string; className?: string; onEscape?: () => void }>(({ value, onChange, placeholder, className, onEscape }, ref) => (
  <div className={cn('flex h-8 min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring', className)}>
    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    <input
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (value) onChange('');
          else {
            (e.target as HTMLInputElement).blur();
            onEscape?.();
          }
        }
        if (e.key === 'ArrowDown' || e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full min-w-0 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
    />
    {value ? (
      <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    ) : (
      <kbd className="kbd hidden sm:inline-flex">/</kbd>
    )}
  </div>
));
SearchField.displayName = 'SearchField';

export function Panel({ title, icon, action, children, className, bodyClassName }: { title: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-xl border bg-card', className)}>
      <header className="flex h-10 items-center gap-2 border-b px-4">
        {icon && <span className="text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>}
        <h2 className="min-w-0 truncate text-[14px] font-medium">{title}</h2>
        {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Completed over enrolled, as a whole percentage; null when nobody is enrolled. */
export const completionOf = (c: { counts: { enrolled: number; completed: number } }) => (c.counts.enrolled > 0 ? Math.round((c.counts.completed / c.counts.enrolled) * 100) : null);
