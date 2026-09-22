import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import type { DueState } from '@project/shared/progress';
import { dueText } from '../../lib/learnFormat';
import { BackLink, Container, Skeleton } from '../ui';

/**
 * The anatomy shared by the course and learning-path pages.
 *
 *   header band   back link · eyebrow · title · summary · facts   |  cover
 *   body          sections                                         |  sticky panel
 *
 * Both right-hand columns are the same width, so the cover and the panel line
 * up. Below `lg` the panel sits inline at the top of the body, and once it has
 * scrolled away a compact bar keeps the main action within reach.
 */

export const SIDE = 'lg:grid-cols-[minmax(0,1fr)_360px]';

export function DetailHeader({ back, eyebrow, badges, title, summary, meta, cover }: { back: { to: string; label: string }; eyebrow?: ReactNode; badges?: ReactNode; title: string; summary?: string; meta: ReactNode; cover: ReactNode }) {
  return (
    <header className="border-b bg-background">
      <Container className="pb-8 pt-5 sm:pb-10 sm:pt-6">
        <BackLink to={back.to}>{back.label}</BackLink>
        <div className={cn('mt-5 grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_280px] lg:gap-12', SIDE)}>
          <div className="min-w-0 animate-fade-up">
            {(eyebrow || badges) && (
              <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
                {eyebrow && <p className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>}
                {badges}
              </div>
            )}
            <h1 className="mt-2 text-balance font-serif text-[32px] font-semibold leading-[1.12] sm:text-[40px]">{title}</h1>
            {summary && <p className="mt-3 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">{summary}</p>}
            <ul className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-foreground/85" aria-label="Details">
              {meta}
            </ul>
          </div>
          <div className="hidden md:block">{cover}</div>
        </div>
      </Container>
    </header>
  );
}

/** The page's shape while it loads: the band, the sections and the panel where they will be. */
export function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="border-b bg-background">
        <Container className="pb-8 pt-5 sm:pb-10 sm:pt-6">
          <Skeleton className="h-5 w-24" />
          <div className={cn('mt-5 grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_280px] lg:gap-12', SIDE)}>
            <div>
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="mt-4 h-10 w-3/4 max-w-lg" />
              <Skeleton className="mt-4 h-5 w-full max-w-xl" />
              <Skeleton className="mt-6 h-5 w-2/3 max-w-md" />
            </div>
            <Skeleton className="hidden aspect-[16/9] rounded-xl md:block" />
          </div>
        </Container>
      </div>
      <Container className="pt-8 sm:pt-10">
        <div className={cn('grid gap-12', SIDE)}>
          <div className="space-y-10">
            <Skeleton className="h-40 rounded-xl lg:hidden" />
            {[0, 1, 2].map(i => (
              <div key={i}>
                <Skeleton className="h-6 w-44" />
                <Skeleton className="mt-5 h-24 rounded-xl" />
              </div>
            ))}
          </div>
          <Skeleton className="hidden h-64 rounded-xl lg:block" />
        </div>
      </Container>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function MetaItem({ icon: Icon, children, iconClassName }: { icon: LucideIcon; children: ReactNode; iconClassName?: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon className={cn('h-4 w-4 text-muted-foreground', iconClassName)} aria-hidden />
      {children}
    </li>
  );
}

/** Body grid with the panel inline on small screens, sticky on the right from `lg`, and a phone action bar. */
export function DetailBody({ panel, panelLabel, bar, children }: { panel: (wide: boolean) => ReactNode; panelLabel: string; bar: ReactNode; children: ReactNode }) {
  const inlineRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [panelGone, setPanelGone] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const panelObserver = new IntersectionObserver(([e]) => setPanelGone(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-64px 0px 0px 0px' });
    const endObserver = new IntersectionObserver(([e]) => setAtEnd(e.isIntersecting || e.boundingClientRect.top < 0), { rootMargin: '0px 0px -140px 0px' });
    if (inlineRef.current) panelObserver.observe(inlineRef.current);
    if (endRef.current) endObserver.observe(endRef.current);
    return () => {
      panelObserver.disconnect();
      endObserver.disconnect();
    };
  }, []);

  const showBar = Boolean(bar) && panelGone && !atEnd;

  return (
    <>
      <Container className="pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className={cn('grid gap-12', SIDE)}>
          {/* gap, not space-y: the inline panel is display:none from lg and must not leave its margin behind. */}
          <div className="flex min-w-0 flex-col gap-12">
            <section ref={inlineRef} className="lg:hidden" aria-label={panelLabel}>
              {panel(true)}
            </section>
            {children}
          </div>
          <aside className="hidden lg:block" aria-label={panelLabel}>
            <div className="sticky top-[88px]">{panel(false)}</div>
          </aside>
        </div>
      </Container>
      {/* The end of the page's own content: once the footer scrolls up past the bar, the bar steps aside. */}
      <div ref={endRef} aria-hidden />
      {showBar && (
        <div className="no-print fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 animate-fade-up border-t bg-background/95 px-4 py-3 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur md:bottom-0 lg:hidden">
          <div className="mx-auto flex max-w-3xl items-center gap-3">{bar}</div>
        </div>
      )}
    </>
  );
}

/**
 * The panel's card: the main block (status and action), then a side block
 * (facts, notes) under it. `wide` is the inline placement on tablets, where the
 * side block moves beside the main one instead of stretching every button.
 */
export function Panel({ children, side, wide }: { children: ReactNode; side?: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-card p-5 shadow-xs', wide && side && 'md:grid md:grid-cols-2 md:items-start md:gap-x-8')}>
      <div className="min-w-0">{children}</div>
      {side && <div className={cn('mt-5 min-w-0 space-y-4 border-t pt-4 [&>*+*]:border-t [&>*+*]:pt-4', wide && 'md:mt-0 md:border-l md:border-t-0 md:pl-8 md:pt-0')}>{side}</div>}
    </div>
  );
}

/** A quiet explanation inside the panel: an icon, a line in ink, a line of detail. */
export function PanelNote({ icon: Icon, title, children, className }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-3', className)}>
      <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-foreground">{title}</p>
        {children && <div className="mt-0.5 text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** Label/value rows, labels in a fixed column so long values wrap under themselves. */
export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm', className)}>{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </>
  );
}

/** A due date for a `Due` fact: "Saturday", "Sep 25", or "Overdue · was due Sep 3", tone-coloured. */
export function DueValue({ dueDate, dueState }: { dueDate: string | null; dueState: DueState }) {
  const text = dueText(dueDate, dueState).replace(/^Due /, '');
  return <span className={cn(dueState === 'overdue' ? 'font-medium text-tone-danger' : dueState === 'due_soon' ? 'font-medium text-tone-warning' : 'text-foreground')}>{text.charAt(0).toUpperCase() + text.slice(1)}</span>;
}

/** The two-line text beside the phone bar's button. */
export function BarText({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium">{value}</p>
    </div>
  );
}
