import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, Inbox, Mail, MailOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { MOD } from '../../lib/hotkeys';
import { dateTime, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Avatar } from '../primitives/Avatar';
import { IconButton, Kbd, Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import type { InboxItem, InboxTab } from './inboxData';
import { destinationFor, TypeIcon, typeMeta } from './inboxMeta';
import type { RowActions } from './InboxRow';

const HINTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['J', 'K'], label: 'Move through the list' },
  { keys: ['↵'], label: 'Open' },
  { keys: ['E'], label: 'Archive' },
  { keys: ['U'], label: 'Mark read or unread' },
  { keys: ['⇧', 'E'], label: 'Archive everything read' },
];

const EMPTY_COPY: Record<InboxTab, { title: string; description: string }> = {
  unread: { title: 'You’re all caught up', description: 'New submissions to grade, learner questions, completions and ratings will show up here.' },
  all: { title: 'Nothing in your inbox', description: 'Submissions to grade, learner questions, completions and ratings will show up here.' },
  archived: { title: 'Nothing archived yet', description: 'Archive what you’re done with and it waits here, out of the way.' },
};

export function emptyCopy(tab: InboxTab) {
  return EMPTY_COPY[tab];
}

export function EmptyPreview({ tab, empty }: { tab: InboxTab; empty: boolean }) {
  const copy = empty ? EMPTY_COPY[tab] : { title: 'Select a notification', description: 'Read it here without losing your place in the list.' };
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="w-full max-w-[320px] animate-fade-in">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border bg-subtle text-muted-foreground">
          <Inbox className="h-[18px] w-[18px]" />
        </div>
        <h2 className="mt-4 text-[15px] font-medium">{copy.title}</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">{copy.description}</p>
        <div className="mt-6 space-y-2 border-t pt-5">
          {HINTS.map(h => (h.label === 'Archive' && tab === 'archived' ? { ...h, label: 'Move back to inbox' } : h)).filter(h => !(tab === 'archived' && h.keys.length === 2 && h.keys[0] === '⇧')).map(h => (
            <div key={h.label} className="flex items-center justify-between text-[13.5px] text-muted-foreground">
              <span>{h.label}</span>
              <span className="flex items-center gap-1">{h.keys.map(k => <Kbd key={k}>{k}</Kbd>)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-[13.5px] text-muted-foreground">
            <span>Search everything</span>
            <span className="flex items-center gap-1"><Kbd>{MOD}</Kbd><Kbd>K</Kbd></span>
          </div>
        </div>
      </div>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { Admin: 'Admin', Instructor: 'Instructor', Learner: 'Learner' };

export function InboxPreview({ item, tab, actions, onOpen, onBack }: { item: InboxItem; tab: InboxTab; actions: RowActions; onOpen: (item: InboxItem) => void; onBack?: () => void }) {
  const ws = useWorkspace();
  const unread = !item.readAt;
  const dest = destinationFor(item);
  const meta = typeMeta(item.type);
  const course = item.courseId ? ws.courseById.get(item.courseId) : undefined;
  const path = item.pathId ? ws.pathById.get(item.pathId) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        {onBack && (
          <IconButton aria-label="Back to inbox" onClick={onBack}>
            <ArrowLeft />
          </IconButton>
        )}
        <div className={cn('flex min-w-0 items-center gap-2 text-sm text-muted-foreground', !onBack && 'pl-1')}>
          <TypeIcon type={item.type} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-medium">{meta.label}</span>
          <span aria-hidden className="text-faint">·</span>
          <Tip label={dateTime(item.occurredAt)}>
            <span className="shrink-0 tabular-nums">{timeAgo(item.occurredAt)}</span>
          </Tip>
          {item.archivedAt && <span className="chip shrink-0 border-transparent bg-muted text-muted-foreground">Archived</span>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Tip label={unread ? 'Mark as read' : 'Mark as unread'} keys={['U']}>
            <IconButton aria-label={unread ? 'Mark as read' : 'Mark as unread'} onClick={() => actions.toggleRead(item)}>
              {unread ? <MailOpen /> : <Mail />}
            </IconButton>
          </Tip>
          <Tip label={tab === 'archived' ? 'Move back to inbox' : 'Archive'} keys={['E']}>
            <IconButton aria-label={tab === 'archived' ? 'Move back to inbox' : 'Archive'} onClick={() => actions.archive(item)}>
              {tab === 'archived' ? <ArchiveRestore /> : <Archive />}
            </IconButton>
          </Tip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[560px] px-5 py-8 animate-fade-in sm:px-8 sm:py-12" key={item.id}>
          <h2 className="text-[19px] font-semibold leading-snug tracking-[-0.01em]">{item.title}</h2>
          {item.body && <p className="mt-2 whitespace-pre-line text-[14.5px] leading-relaxed text-muted-foreground">{item.body}</p>}
          {item.subjectStatus && (
            <span
              className={cn(
                'mt-3 inline-flex h-5 items-center rounded-md px-1.5 text-sm font-medium',
                /^Waiting/.test(item.subjectStatus) ? 'bg-tone-warning/[0.12] text-tone-warning' : /^(Passed|Answered|Resolved)/.test(item.subjectStatus) ? 'bg-tone-success/[0.1] text-tone-success' : 'bg-muted text-muted-foreground',
              )}
            >
              {/^Waiting/.test(item.subjectStatus) ? item.subjectStatus : `Now: ${item.subjectStatus}`}
            </span>
          )}

          {(item.actorName || course || path) && (
            <div className="mt-7 divide-y overflow-hidden rounded-lg border bg-background">
              {item.actorName && item.actorId && (
                <Link to={`/people/${item.actorId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40">
                  <Avatar name={item.actorName} src={item.actorAvatarUrl} color={item.actorColor} size={30} />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{item.actorName}</div>
                    <div className="truncate text-sm text-muted-foreground">{[item.actorTitle, item.actorRole && item.actorRole !== 'Learner' ? ROLE_LABEL[item.actorRole] : null].filter(Boolean).join(' · ') || 'Learner'}</div>
                  </div>
                </Link>
              )}
              {(course || item.courseTitle) && (
                <Link to={`/courses/${item.courseId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40">
                  <CourseGlyph icon={course?.icon} color={course?.color} coverImageUrl={course?.coverImageUrl} size={30} />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{course?.title ?? item.courseTitle}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {course ? `${course.status === 'Published' ? `${course.counts.enrolled} enrolled` : course.status}${course.counts.overdue ? ` · ${course.counts.overdue} overdue` : ''}` : 'Course'}
                    </div>
                  </div>
                </Link>
              )}
              {(path || item.pathTitle) && (
                <Link to={`/paths/${item.pathId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40">
                  <CourseGlyph icon={path?.icon} color={path?.color} coverImageUrl={path?.coverImageUrl} size={30} />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{path?.title ?? item.pathTitle}</div>
                    <div className="truncate text-sm text-muted-foreground">Learning path</div>
                  </div>
                </Link>
              )}
            </div>
          )}

          {dest && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => onOpen(item)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                {dest.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <span className="ml-1 hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
                <Kbd>↵</Kbd> to open
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
