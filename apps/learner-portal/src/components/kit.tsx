import { AlertCircle, BookOpenText, CalendarClock, CheckSquare, ClipboardList, FileText, Globe, ListChecks, Lock, PlayCircle, RotateCw, Star, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import type { LessonType } from '@project/shared/lessons';
import type { CertificateState, DueState } from '@project/shared/progress';
import { CertificateArt } from '@project/shared/ui/CertificateArt';
import { contrast, hexToRgb } from '../lib/brand';
import { errorMessage, isNotFound } from '../lib/errors';
import { initials } from '../lib/format';
import { certificateStateText, CERT_TONE, dueText, DUE_TONE } from '../lib/learnFormat';
import type { CertificateOrg, CertificateSummary } from '../lib/learn';
import { useAcademy } from '../lib/queries';
import { Button, Container, EmptyState, StatusPill } from './ui';

/**
 * Shared pieces for the learner app's pages: course covers, avatars, due and
 * certificate pills, progress rings, tabs and page headers.
 */

// ── Brand mark ────────────────────────────────────────────────────────────

export function AcademyMark({ size = 32, className }: { size?: number; className?: string }) {
  const { data } = useAcademy();
  if (data?.logoUrl) return <img src={data.logoUrl} alt="" className={cn('object-contain', className)} style={{ height: size, maxWidth: size * 4 }} />;
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground shadow-xs', className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 64 64" style={{ width: size * 0.74, height: size * 0.74 }}>
        <path d="M25 17.5c0-3.9 3.1-7 7-7s7 3.1 7 7" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
        <rect x="21" y="19" width="22" height="4.5" rx="2.25" fill="currentColor" />
        <path d="M23 24h18l-1.6 20.5a3 3 0 0 1-3 2.8h-8.8a3 3 0 0 1-3-2.8z" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinejoin="round" />
        <path d="M32 29.5c2.6 3 3.9 5.1 3.9 7.1a3.9 3.9 0 0 1-7.8 0c0-2 1.3-4.1 3.9-7.1z" fill="#fde68a" />
        <rect x="24" y="48.5" width="16" height="4" rx="2" fill="currentColor" />
      </svg>
    </span>
  );
}

// ── Covers and glyphs ─────────────────────────────────────────────────────

const CREAM: [number, number, number] = [250, 246, 238];

/** Unsplash-style URLs can be asked for a smaller size. */
export function sizedImage(url: string, width: number) {
  return /images\.unsplash\.com/.test(url) ? url.replace(/([?&])w=\d+/, `$1w=${width}`).replace(/([?&])h=\d+/, `$1h=${Math.round((width * 9) / 16)}`) : url;
}

/**
 * The stand-in for a missing cover photo: a solid field of the course colour
 * with a faint engraved texture, lettered in cream (or ink, on a pale colour).
 */
export function pigmentStyle(color: string) {
  const rgb = hexToRgb(color) ?? hexToRgb('#2f6b55')!;
  return {
    backgroundColor: `rgb(${rgb.join(' ')})`,
    backgroundImage: 'radial-gradient(130% 100% at 100% 0%, rgb(255 255 255 / 0.16), transparent 55%), repeating-linear-gradient(135deg, rgb(255 255 255 / 0.05) 0 1px, transparent 1px 9px)',
    color: contrast(rgb, CREAM) < 3 ? '#1f1b17' : '#faf6ee',
  };
}

/** The first letter or digit of a title, for a lettered cover. */
export const monogram = (title: string) => (title.match(/[\p{L}\p{N}]/u)?.[0] ?? '').toUpperCase();

/** A 16:9 cover: the image when there is one, otherwise the course colour lettered with its initial. */
export function CourseCover({ coverImageUrl, title, color, className, width = 640, children, rounded = 'rounded-t-xl' }: { coverImageUrl: string | null; title: string; color: string; className?: string; width?: number; children?: ReactNode; rounded?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = coverImageUrl && !failed;
  return (
    <div className={cn('relative aspect-[16/9] w-full overflow-hidden bg-muted', rounded, className)}>
      {showImage ? (
        <img src={sizedImage(coverImageUrl, width)} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0" style={pigmentStyle(color)} aria-hidden>
          <span className="absolute bottom-[7%] left-[5.5%] font-serif font-medium leading-none" style={{ fontSize: width >= 760 ? 112 : 68 }}>
            {monogram(title) || <BookOpenText className="h-10 w-10 opacity-80" />}
          </span>
        </span>
      )}
      {children}
    </div>
  );
}

/** A small square thumbnail for rows. */
export function CourseGlyph({ coverImageUrl, title, color, size = 48, className }: { coverImageUrl?: string | null; title: string; color: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (coverImageUrl && !failed) {
    return <img src={sizedImage(coverImageUrl, size * 3)} alt="" loading="lazy" onError={() => setFailed(true)} className={cn('shrink-0 rounded-lg object-cover ring-1 ring-inset ring-black/5', className)} style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-lg font-serif font-medium leading-none', className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.46), ...pigmentStyle(color) }}>
      {monogram(title) || <BookOpenText style={{ width: size * 0.45, height: size * 0.45 }} />}
    </span>
  );
}

// ── People ────────────────────────────────────────────────────────────────

export function Avatar({ name, color, avatarUrl, size = 36, className }: { name: string; color?: string | null; avatarUrl?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  // A new photo gets a fresh chance to load.
  useEffect(() => setFailed(false), [avatarUrl]);
  if (avatarUrl && !failed) return <img src={avatarUrl} alt="" onError={() => setFailed(true)} className={cn('shrink-0 rounded-full object-cover ring-1 ring-inset ring-black/5', className)} style={{ width: size, height: size }} />;
  const c = color || '#6b7280';
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-[color:var(--avatar)] dark:text-foreground/85', className)}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)), background: `${c}24`, boxShadow: `inset 0 0 0 1px ${c}33`, ['--avatar' as string]: c }}
    >
      {initials(name)}
    </span>
  );
}

// ── Pills ─────────────────────────────────────────────────────────────────

export function DuePill({ dueDate, dueState, className }: { dueDate: string | null; dueState: DueState; className?: string }) {
  if (dueState === 'no_due') return null;
  return (
    <StatusPill tone={DUE_TONE[dueState]} className={className} dot={dueState !== 'on_track'}>
      {dueText(dueDate, dueState)}
    </StatusPill>
  );
}

/** A due date as tone-coloured text, for rows where the date isn't the headline. */
export function DueText({ dueDate, dueState, className }: { dueDate: string | null; dueState: DueState; className?: string }) {
  if (dueState === 'no_due' || dueState === 'withdrawn' || (dueState === 'done' && !dueDate)) return null;
  return <span className={cn(dueState === 'overdue' ? 'font-medium text-tone-danger' : dueState === 'due_soon' ? 'font-medium text-tone-warning' : 'text-muted-foreground', className)}>{dueText(dueDate, dueState)}</span>;
}

export function CertificatePill({ state, expiresAt, className }: { state: CertificateState; expiresAt: string | null; className?: string }) {
  return (
    <StatusPill tone={CERT_TONE[state]} className={className}>
      {certificateStateText(state, expiresAt)}
    </StatusPill>
  );
}

// ── Progress ──────────────────────────────────────────────────────────────

export function ProgressRing({ value, size = 56, stroke = 5, className, children, label, tone = 'primary' }: { value: number; size?: number; stroke?: number; className?: string; children?: ReactNode; label?: string; tone?: 'primary' | 'success' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }} role="img" aria-label={label ?? `${pct}% complete`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          className={cn('transition-[stroke-dashoffset] duration-700 ease-out', tone === 'success' ? 'stroke-tone-success' : 'stroke-primary')}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">{children ?? <span className="text-xs font-semibold tabular-nums">{pct}%</span>}</span>
    </span>
  );
}

// ── Lessons ───────────────────────────────────────────────────────────────

export const LESSON_ICON: Record<LessonType, LucideIcon> = {
  Article: BookOpenText,
  Video: PlayCircle,
  Quiz: ListChecks,
  Assignment: ClipboardList,
  File: FileText,
  Embed: Globe,
  'Live session': CalendarClock,
  Checklist: CheckSquare,
};

export function LessonIcon({ type, className, locked }: { type: LessonType; className?: string; locked?: boolean }) {
  const Icon = locked ? Lock : (LESSON_ICON[type] ?? FileText);
  return <Icon className={cn('h-4 w-4 shrink-0 text-muted-foreground', className)} aria-hidden />;
}

// ── Ratings ───────────────────────────────────────────────────────────────

export function Stars({ value, size = 14, className }: { value: number | null; size?: number; className?: string }) {
  const v = Math.max(0, Math.min(5, value ?? 0));
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} role="img" aria-label={value ? `${v.toFixed(1)} out of 5 stars` : 'Not rated yet'}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} aria-hidden style={{ width: size, height: size }} strokeWidth={1.8} className={cn(i <= Math.round(v) ? 'fill-tone-warning text-tone-warning' : 'text-border')} />
      ))}
    </span>
  );
}

export function RatingText({ average, count, className }: { average: number | null; count: number; className?: string }) {
  if (!average || !count) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 tabular-nums', className)}>
      <Star className="h-3.5 w-3.5 fill-tone-warning text-tone-warning" aria-hidden />
      <span className="font-medium text-foreground">{average.toFixed(1)}</span>
      <span className="text-muted-foreground">({count})</span>
      <span className="sr-only">average rating from {count} reviews</span>
    </span>
  );
}

// ── Certificates ──────────────────────────────────────────────────────────

export function CertificateThumb({ cert, org, className }: { cert: Pick<CertificateSummary, 'recipientName' | 'title' | 'kind' | 'issuedAt' | 'expiresAt' | 'credentialId' | 'status'>; org: CertificateOrg; className?: string }) {
  return (
    <CertificateArt
      className={className}
      recipientName={cert.recipientName}
      title={cert.title}
      kind={cert.kind}
      organizationName={org.organizationName}
      academyName={org.academyName}
      certificateTitle={org.certificateTitle}
      issuedAt={cert.issuedAt}
      expiresAt={cert.expiresAt}
      credentialId={cert.credentialId}
      signatory={org.signatory || null}
      signatoryTitle={org.signatoryTitle || null}
      logoUrl={org.logoUrl}
      brandColor={org.brandColor}
      revoked={cert.status === 'Revoked'}
    />
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

export type TabItem<T extends string> = { value: T; label: string; count?: number };

/** Underlined tabs with arrow-key movement, as a tablist. */
export function Tabs<T extends string>({ tabs, value, onChange, label, className }: { tabs: Array<TabItem<NoInfer<T>>>; value: T; onChange: (v: NoInfer<T>) => void; label: string; className?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onChange(tabs[next].value);
  };
  return (
    <div role="tablist" aria-label={label} className={cn('scrollbar-none -mx-4 flex gap-6 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0', className)}>
      {tabs.map((t, i) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={el => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={e => onKey(e, i)}
            onClick={() => onChange(t.value)}
            className={cn(
              'inline-flex h-11 shrink-0 items-center gap-2 border-b-2 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
              active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.count != null && <span className={cn('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Pill-shaped filter toggles (categories, levels). */
export function Chip({ active, onClick, children, className, ...rest }: { active: boolean; onClick: () => void; children: ReactNode; className?: string } & Record<string, unknown>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
        active ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-foreground hover:border-foreground/30 hover:bg-accent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Page scaffolding ──────────────────────────────────────────────────────

/** `size` matches the body's Container, so a narrow page's header shares its left edge. */
export function PageHeader({ title, description, eyebrow, actions, children, className, size = 'page' }: { title: ReactNode; description?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; size?: 'page' | 'narrow' | 'form' }) {
  return (
    <div className={cn('border-b bg-background', className)}>
      <Container size={size} className="pb-6 pt-8 sm:pb-8 sm:pt-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 animate-fade-up">
            {eyebrow && <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-faint">{eyebrow}</p>}
            <h1 className={cn('font-serif text-3xl font-semibold leading-tight sm:text-[34px]', eyebrow && 'mt-2')}>{title}</h1>
            {description && <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
        {children}
      </Container>
    </div>
  );
}

/** A friendly error for a page or section that didn't load. */
export function LoadError({ error, onRetry, title, notFoundTitle, notFoundBody, action }: { error: unknown; onRetry?: () => void; title: string; notFoundTitle?: string; notFoundBody?: string; action?: ReactNode }) {
  const missing = isNotFound(error);
  return (
    <Container size="narrow" className="py-16">
      <EmptyState
        icon={AlertCircle}
        title={missing && notFoundTitle ? notFoundTitle : title}
        action={
          <>
            {!missing && onRetry && (
              <Button variant="secondary" onClick={onRetry}>
                <RotateCw /> Try again
              </Button>
            )}
            {action}
          </>
        }
      >
        {missing && notFoundBody ? notFoundBody : errorMessage(error, 'Check your connection and try again.')}
      </EmptyState>
    </Container>
  );
}

export type Stat = { label: string; value: ReactNode; hint?: ReactNode; to?: string };

/**
 * A row of figures in one bordered strip, split by hairlines. Every cell has
 * the same three lines — figure, label, hint (reserved when empty) — so the
 * figures share a baseline however the hints differ. Two columns on phones.
 */
export function StatStrip({ stats, label, className }: { stats: Stat[]; label: string; className?: string }) {
  const cols = stats.length >= 4 ? 'lg:grid-cols-4' : stats.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  // A 1px gap over a border-coloured ground draws the hairlines at any column count.
  return (
    <section aria-label={label} className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-2xs', cols, className)}>
      {stats.map((st, i) => {
        const body = (
          <>
            <span className="block font-serif text-[26px] font-semibold leading-none tabular-nums">{st.value}</span>
            <span className="mt-2 block truncate text-sm text-foreground/80">{st.label}</span>
            <span className="mt-0.5 block truncate text-xs text-faint">{st.hint ?? '\u00a0'}</span>
          </>
        );
        // An odd last cell spans the row on phones rather than leaving a grey hole.
        const cell = cn('min-w-0 bg-card px-4 py-4 sm:px-5', stats.length % 2 === 1 && i === stats.length - 1 && 'col-span-2 sm:col-span-1');
        return st.to ? (
          <Link key={st.label} to={st.to} className={cn(cell, 'transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35')}>
            {body}
          </Link>
        ) : (
          <div key={st.label} className={cell}>
            {body}
          </div>
        );
      })}
    </section>
  );
}

/** Debounced value, for search-as-you-type. */
export function useDebounced<T>(value: T, ms = 180) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
