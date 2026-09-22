import { CheckCircle2, MessageSquare, Pin } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@project/components/lib/utils';
import { dateTime, timeAgo } from '../../lib/format';
import { PersonAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import type { Thread } from './discussionsData';

export function RoleBadge({ role, className }: { role: string; className?: string }) {
  if (role !== 'Admin' && role !== 'Instructor') return null;
  return (
    <span className={cn('inline-flex h-[18px] shrink-0 items-center rounded px-1.5 text-2xs font-medium', role === 'Admin' ? 'bg-tone-accent/[0.1] text-tone-accent' : 'bg-primary/[0.1] text-primary', className)}>
      {role}
    </span>
  );
}

function ThreadRowInner({ thread: t, active, showCourse, onOpen }: { thread: Thread; active: boolean; showCourse: boolean; onOpen: (id: string) => void }) {
  const last = t.lastReplyAt ?? t.postedAt;
  return (
    <button
      type="button"
      data-thread-id={t.id}
      aria-current={active ? 'true' : undefined}
      onClick={() => onOpen(t.id)}
      className={cn('group relative flex w-full items-start gap-2.5 border-b border-border/50 py-2.5 pl-4 pr-3 text-left outline-none transition-colors duration-75 focus-visible:bg-accent/60', active ? 'bg-accent' : 'hover:bg-accent/50')}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary" aria-hidden />}
      <PersonAvatar person={t.author} size={24} className="mt-px" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14px]">
          <span className={cn('truncate', t.unanswered ? 'font-medium text-foreground' : 'text-foreground/90')}>{t.author.name}</span>
          <RoleBadge role={t.author.role} />
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1 text-sm text-muted-foreground">
            {t.pinned && (
              <Tip label="Pinned to the top of the lesson">
                <Pin className="h-3 w-3 -rotate-45 text-tone-warning" aria-label="Pinned" />
              </Tip>
            )}
            {t.answeredByStaff && (
              <Tip label="Answered by staff">
                <CheckCircle2 className="h-3.5 w-3.5 text-tone-success" aria-label="Answered by staff" />
              </Tip>
            )}
            {t.replyCount > 0 && (
              <span className="flex items-center gap-0.5 tabular-nums">
                <MessageSquare className="h-3 w-3" /> {t.replyCount}
              </span>
            )}
            <Tip label={`${t.lastReplyAt ? 'Last reply' : 'Asked'} ${dateTime(last)}`}>
              <span className="tabular-nums">{timeAgo(last).replace(' ago', '')}</span>
            </Tip>
          </span>
        </span>
        <span className={cn('mt-0.5 line-clamp-2 text-[13.5px] leading-snug', t.resolvedAt ? 'text-muted-foreground' : 'text-foreground/80')}>{t.body}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          {showCourse && (
            <>
              <Tip label={t.courseTitle}>
                <span className="inline-flex shrink-0">
                  <CourseGlyph icon={t.courseIcon} color={t.courseColor} size={14} />
                </span>
              </Tip>
              {/* On a phone the glyph stands in for the course, so the lesson keeps its room. */}
              <span className="hidden max-w-[45%] truncate sm:inline">{t.courseTitle}</span>
              <span className="hidden text-faint sm:inline">›</span>
            </>
          )}
          <span className="truncate">{t.lessonTitle}</span>
          {t.resolvedAt && <span className="ml-auto shrink-0 text-2xs font-medium text-tone-success">Resolved</span>}
        </span>
      </span>
    </button>
  );
}

export const ThreadRow = memo(ThreadRowInner);
