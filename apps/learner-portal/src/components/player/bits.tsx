import { AppWindow, CalendarClock, CircleHelp, CirclePlay, FileText, ListTodo, NotebookPen, Paperclip, Star, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { Button } from '../ui';

export const LESSON_ICON: Record<string, LucideIcon> = {
  Article: FileText,
  Video: CirclePlay,
  Quiz: CircleHelp,
  Assignment: NotebookPen,
  File: Paperclip,
  Embed: AppWindow,
  'Live session': CalendarClock,
  Checklist: ListTodo,
};

export function LessonTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = LESSON_ICON[type] ?? FileText;
  return <Icon className={cn('h-4 w-4', className)} aria-hidden />;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('kbd', className)}>{children}</kbd>;
}

/** A score as a ring: brand colour for a pass, warning for not yet. */
export function ScoreRing({ value, passed, size = 132 }: { value: number; passed: boolean; size?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(value), 60);
    return () => window.clearTimeout(t);
  }, [value]);
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={passed ? 'hsl(var(--primary))' : 'rgb(var(--tone-warning))'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(100, shown)) / 100)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-serif text-4xl font-semibold tabular-nums">
          {value}
          <span className="text-xl text-muted-foreground">%</span>
        </span>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  pending,
  cancelLabel = 'Cancel',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  pending?: boolean;
  cancelLabel?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={o => !pending && onOpenChange(o)}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-md gap-0 rounded-xl p-6"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !pending) {
            e.preventDefault();
            onConfirm();
          }
        }}
      >
        <DialogTitle className="pr-6 text-lg font-semibold leading-snug">{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{description}</div>
        </DialogDescription>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={pending} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Five stars as a radio group: arrow keys move, each star is a 44px target. */
export function StarInput({ value, onChange, label = 'Your rating' }: { value: number; onChange: (n: number) => void; label?: string }) {
  const [hover, setHover] = useState(0);
  const name = useId();
  const words = ['', 'Not for me', 'It was okay', 'Good', 'Really good', 'Excellent'];
  const shown = hover || value;
  return (
    <div>
      <div role="radiogroup" aria-label={label} className="flex items-center justify-center gap-0.5" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map(n => (
          <label key={n} className="group relative grid h-11 w-11 cursor-pointer place-items-center rounded-lg has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/35" onMouseEnter={() => setHover(n)}>
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" aria-label={`${n} star${n === 1 ? '' : 's'} — ${words[n]}`} />
            <Star
              className={cn('h-8 w-8 transition-[transform,color] duration-150 group-active:scale-90', n <= shown ? 'fill-tone-warning text-tone-warning' : 'fill-transparent text-muted-foreground/45')}
              strokeWidth={1.6}
              aria-hidden
            />
          </label>
        ))}
      </div>
      <p className="mt-1 h-5 text-center text-sm text-muted-foreground" aria-hidden>
        {words[shown]}
      </p>
    </div>
  );
}

// ── Dates ─────────────────────────────────────────────────────────────────

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function sessionTimes(startsAt: string | null, endsAt: string | null, timezone: string) {
  if (!startsAt) return { day: '', month: '', weekday: '', local: 'Time to be confirmed', original: null as string | null, dateLabel: '' };
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;
  const time = (d: Date, tz?: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d);
  const zoneName = (d: Date, tz?: string) => new Intl.DateTimeFormat(undefined, { timeZoneName: 'short', timeZone: tz }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? '';
  const local = `${time(start)}${end ? ` – ${time(end)}` : ''} ${zoneName(start)}`.trim();
  let original: string | null = null;
  try {
    const sameOffset = time(start, timezone) === time(start) && zoneName(start, timezone) === zoneName(start);
    if (timezone && timezone !== localZone() && !sameOffset) original = `${time(start, timezone)}${end ? ` – ${time(end, timezone)}` : ''} ${zoneName(start, timezone)} (${timezone.split('/').pop()?.replace(/_/g, ' ')})`;
  } catch {
    original = null;
  }
  return {
    day: new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(start),
    month: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(start),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(start),
    dateLabel: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(start),
    local,
    original,
  };
}

const icsStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** An .ics file for one session, downloaded from memory — no server round trip. */
export function downloadIcs(session: { id: string; title: string; description: string; startsAt: string | null; endsAt: string | null; location: string; meetingUrl: string | null }, pageUrl: string) {
  if (!session.startsAt) return;
  const end = session.endsAt ?? new Date(Date.parse(session.startsAt) + 3_600_000).toISOString();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Learning Management//Course player//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${session.id}@lms`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(session.startsAt)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(session.title)}`,
    `DESCRIPTION:${icsText([session.description, session.meetingUrl ? `Join: ${session.meetingUrl}` : '', `Details: ${pageUrl}`].filter(Boolean).join('\n\n'))}`,
    session.location || session.meetingUrl ? `LOCATION:${icsText(session.location || session.meetingUrl || '')}` : '',
    `URL:${pageUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${session.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'session'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/**
 * Scroll an element into view inside its own scroll container only.
 * `scrollIntoView` also nudges overflow-hidden ancestors (the player frame),
 * which slides the top bar off screen.
 */
export function revealInScroller(el: HTMLElement | null, opts: { offset?: number; block?: 'start' | 'center' | 'nearest'; smooth?: boolean } = {}) {
  if (!el) return;
  let scroller: HTMLElement | null = el.parentElement;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  if (!scroller) return;
  const offset = opts.offset ?? 16;
  const box = el.getBoundingClientRect();
  const port = scroller.getBoundingClientRect();
  let top: number | null = null;
  if (opts.block === 'center') top = scroller.scrollTop + box.top - port.top - (port.height - box.height) / 2;
  else if (opts.block === 'nearest') {
    if (box.top < port.top + offset) top = scroller.scrollTop + box.top - port.top - offset;
    else if (box.bottom > port.bottom - offset) top = scroller.scrollTop + box.bottom - port.bottom + offset;
  } else top = scroller.scrollTop + box.top - port.top - offset;
  if (top != null) scroller.scrollTo({ top: Math.max(0, top), behavior: opts.smooth === false || prefersReducedMotion() ? 'auto' : 'smooth' });
}

export const prefersReducedMotion =() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
