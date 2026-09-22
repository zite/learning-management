import { Award, BookOpenText, CalendarClock, CheckSquare, ClipboardList, FileText, Globe, ListChecks, PlayCircle, Star } from 'lucide-react';
import { cn } from '@project/components/lib/utils';
import { DUE_META } from '../../lib/constants';
import { dueLabel } from '../../lib/format';
import type { DueState, EnrollmentStatus, LessonType } from '../../lib/types';

/**
 * The app's glyph vocabulary. An enrollment's status is a ring that fills as
 * the learner progresses and becomes a check when they finish — the same mark
 * in lists, the peek, transcripts and the command menu.
 */

export function StatusGlyph({ status, progress = 0, dueState, size = 16, className }: { status: EnrollmentStatus; progress?: number; dueState?: DueState; size?: number; className?: string }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const overdue = dueState === 'overdue';
  if (status === 'Completed') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('shrink-0 text-tone-success', className)} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 0.5} fill="currentColor" />
        <path d={`M${size * 0.3} ${size * 0.52} L${size * 0.44} ${size * 0.66} L${size * 0.71} ${size * 0.37}`} fill="none" stroke="white" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'Withdrawn') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('shrink-0 text-muted-foreground/70', className)} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="2 2.2" />
        <path d={`M${size * 0.34} ${size * 0.5} H${size * 0.66}`} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    );
  }
  const v = status === 'Not started' ? 0 : Math.max(0.08, Math.min(0.96, progress / 100));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('shrink-0 -rotate-90', overdue ? 'text-tone-danger' : status === 'In progress' ? 'text-primary' : 'text-muted-foreground', className)} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={status === 'Not started' ? 0.55 : 0.22} strokeWidth={1.5} strokeDasharray={status === 'Not started' ? '2.4 1.9' : undefined} />
      {v > 0 && <circle cx={size / 2} cy={size / 2} r={r / 2} fill="none" stroke="currentColor" strokeWidth={r} strokeDasharray={`${v * Math.PI * r} ${Math.PI * r}`} />}
    </svg>
  );
}

/** "Overdue · Sep 3", "Due Fri", "Due Oct 12" — coloured only when it matters. */
export function DuePill({ dueDate, dueState, className, compact }: { dueDate: string | null; dueState: DueState; className?: string; compact?: boolean }) {
  if (dueState === 'done' || dueState === 'withdrawn') return null;
  if (!dueDate) return compact ? null : <span className={cn('text-sm text-muted-foreground/70', className)}>No due date</span>;
  const d = dueLabel(dueDate);
  const label = dueState === 'overdue' ? (compact ? d?.label : `Overdue · ${d?.label}`) : `Due ${d?.label}`;
  return (
    <span className={cn('inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-md px-1.5 text-sm font-medium tabular-nums', dueState === 'overdue' || dueState === 'due_soon' ? DUE_META[dueState].chip : 'text-muted-foreground', className)}>
      {label}
    </span>
  );
}

export const LESSON_ICONS: Record<LessonType, typeof FileText> = {
  Article: BookOpenText,
  Video: PlayCircle,
  Quiz: ListChecks,
  Assignment: ClipboardList,
  File: FileText,
  Embed: Globe,
  'Live session': CalendarClock,
  Checklist: CheckSquare,
};

export const LESSON_TONE: Record<LessonType, string> = {
  Article: 'text-tone-info',
  Video: 'text-tone-accent',
  Quiz: 'text-tone-warning',
  Assignment: 'text-tone-danger',
  File: 'text-tone-neutral',
  Embed: 'text-tone-info',
  'Live session': 'text-tone-success',
  Checklist: 'text-tone-success',
};

export function LessonTypeIcon({ type, className, colored = true }: { type: string; className?: string; colored?: boolean }) {
  const Icon = LESSON_ICONS[type as LessonType] ?? FileText;
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', colored ? LESSON_TONE[type as LessonType] : 'text-muted-foreground', className)} aria-hidden />;
}

/** A course or path mark: its cover image, or its emoji on a soft tint of its colour. */
export function CourseGlyph({ icon, color, coverImageUrl, size = 18, className, cover = false }: { icon?: string | null; color?: string | null; coverImageUrl?: string | null; size?: number; className?: string; cover?: boolean }) {
  if (cover && coverImageUrl) {
    return <img src={coverImageUrl.replace(/w=\d+&h=\d+/, `w=${size * 3}&h=${size * 3}`)} alt="" className={cn('shrink-0 rounded-[5px] object-cover', className)} style={{ width: size, height: size }} loading="lazy" />;
  }
  const isEmoji = icon && /\p{Extended_Pictographic}/u.test(icon);
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[5px] leading-none', className)}
      style={{ width: size, height: size, fontSize: isEmoji ? Math.round(size * 0.66) : Math.round(size * 0.55), background: `${color || '#2f6b55'}22`, color: color || '#2f6b55' }}
    >
      {icon || '📘'}
    </span>
  );
}

export function Stars({ value, size = 12, className }: { value: number | null | undefined; size?: number; className?: string }) {
  const v = Math.max(0, Math.min(5, value ?? 0));
  return (
    <span className={cn('inline-flex items-center gap-px', className)} aria-label={value ? `${v.toFixed(1)} out of 5` : 'Not rated'}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} style={{ width: size, height: size }} className={cn(i <= Math.round(v) ? 'fill-flame text-flame' : 'text-muted-foreground/40')} strokeWidth={1.8} />
      ))}
    </span>
  );
}

/** A quiz score coloured by band. */
export function ScoreText({ score, className }: { score: number | null | undefined; className?: string }) {
  if (score == null) return <span className={cn('text-muted-foreground/50', className)}>—</span>;
  return <span className={cn('tabular-nums', score >= 90 ? 'text-tone-success' : score >= 70 ? 'text-foreground' : 'text-tone-warning', className)}>{Math.round(score)}%</span>;
}

export function CertificateMark({ className }: { className?: string }) {
  return <Award className={cn('h-3.5 w-3.5 text-flame', className)} aria-hidden />;
}

/** A thin progress bar with the percentage beside it. */
export function ProgressMeter({ value, status, className, showLabel = true }: { value: number; status?: EnrollmentStatus; className?: string; showLabel?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="h-1.5 min-w-[40px] flex-1 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full transition-[width] duration-500', // Done is quiet: the status glyph already says so, and a column of green bars drowns what needs attention.
            status === 'Completed' ? 'bg-muted-foreground/40' : 'bg-primary')} style={{ width: `${v}%` }} />
      </span>
      {showLabel && <span className="w-8 text-right text-sm tabular-nums text-muted-foreground">{Math.round(v)}%</span>}
    </span>
  );
}
