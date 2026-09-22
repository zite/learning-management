import { Archive, ArchiveRestore, Mail, MailOpen } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@project/components/lib/utils';
import { timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { IconButton, Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import type { InboxItem, InboxTab } from './inboxData';
import { ActorAvatar, splitTitle, typeMeta } from './inboxMeta';

export type RowActions = {
  toggleRead: (item: InboxItem) => void;
  archive: (item: InboxItem) => void;
};

/**
 * One notification. Who and what come first and may take two lines; the
 * course and the snippet share one quieter line below, and the snippet gives
 * way first when space runs out.
 */
function InboxRowInner({ item, tab, active, sticky, onSelect, actions }: {
  item: InboxItem;
  tab: InboxTab;
  active: boolean;
  /** Read during this visit to Unread — still listed, no longer bold. */
  sticky: boolean;
  onSelect: (item: InboxItem) => void;
  actions: RowActions;
}) {
  const ws = useWorkspace();
  const unread = !item.readAt;
  const when = timeAgo(tab === 'archived' ? item.archivedAt : item.occurredAt).replace(' ago', '');
  const { actor, rest } = splitTitle(item);
  const course = item.courseId ? ws.courseById.get(item.courseId) : undefined;
  const place = item.courseTitle ?? item.pathTitle;
  // "Marcus rated Giving and Receiving Feedback 5 stars" already names the course.
  const showPlace = Boolean(place && !item.title.includes(place));
  const snippet = item.body || (showPlace ? '' : typeMeta(item.type).label);

  return (
    <div
      aria-current={active ? 'true' : undefined}
      data-inbox-id={item.id}
      onClick={() => onSelect(item)}
      className={cn('group relative flex cursor-default gap-3 border-b border-border/50 py-2.5 pl-5 pr-4 outline-none transition-colors duration-75', active ? 'bg-accent' : 'hover:bg-accent/50')}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary" aria-hidden />}
      {unread && <span className="absolute left-2 top-[21px] h-1.5 w-1.5 rounded-full bg-primary" aria-label="Unread" />}
      <ActorAvatar item={item} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-[20px]">
            {actor && <span className={cn(unread ? 'font-semibold text-foreground' : sticky ? 'font-medium text-foreground' : 'font-medium text-foreground/90')}>{actor}</span>}
            <span className={cn(unread ? 'text-foreground' : 'text-foreground/75', unread && !actor && 'font-semibold')}>{rest}</span>
          </p>
          <span className={cn('shrink-0 text-sm leading-[20px] tabular-nums text-muted-foreground group-hover:invisible', active && 'invisible')}>{when}</span>
        </div>
        {(showPlace || snippet) && (
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {showPlace && (
              <>
                {course && <CourseGlyph icon={course.icon} color={course.color} coverImageUrl={course.coverImageUrl} size={14} />}
                <span className={cn('truncate', snippet ? 'max-w-[62%] shrink-0' : 'min-w-0')}>{place}</span>
              </>
            )}
            {showPlace && snippet && <span aria-hidden className="shrink-0 text-faint">·</span>}
            {snippet && <span className="min-w-0 truncate">{snippet}</span>}
          </div>
        )}
      </div>
      <div className={cn('absolute right-2.5 top-1.5 items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-sm', active ? 'flex' : 'hidden group-hover:flex')} onClick={e => e.stopPropagation()}>
        <Tip label={unread ? 'Mark as read' : 'Mark as unread'} keys={['U']}>
          <IconButton size="sm" aria-label={unread ? 'Mark as read' : 'Mark as unread'} onClick={() => actions.toggleRead(item)}>
            {unread ? <MailOpen /> : <Mail />}
          </IconButton>
        </Tip>
        <Tip label={tab === 'archived' ? 'Move back to inbox' : 'Archive'} keys={['E']}>
          <IconButton size="sm" aria-label={tab === 'archived' ? 'Move back to inbox' : 'Archive'} onClick={() => actions.archive(item)}>
            {tab === 'archived' ? <ArchiveRestore /> : <Archive />}
          </IconButton>
        </Tip>
      </div>
    </div>
  );
}

export const InboxRow = memo(InboxRowInner);
