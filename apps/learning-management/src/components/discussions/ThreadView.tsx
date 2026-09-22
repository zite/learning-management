import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, CircleDot, Copy, MoreHorizontal, NotebookPen, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { Markdown } from '@project/shared/ui/Markdown';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { MOD } from '../../lib/hotkeys';
import { appUrl, dateTime, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { IconButton, Tip } from '../primitives/bits';
import { CourseGlyph, LessonTypeIcon } from '../primitives/icons';
import { useDiscussionActions, type Reply, type Thread } from './discussionsData';
import { RoleBadge } from './ThreadList';

const MAX = 5000;

/** A textarea that grows with its text and submits with ⌘↵. */
const Composer = forwardRef<HTMLTextAreaElement, { value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel?: () => void; placeholder: string; minHeight?: number; autoFocus?: boolean }>(
  ({ value, onChange, onSubmit, onCancel, placeholder, minHeight = 40, autoFocus }, ref) => {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    useEffect(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(240, Math.max(minHeight, el.scrollHeight))}px`;
    }, [value, minHeight]);
    return (
      <textarea
        ref={el => {
          inner.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        autoFocus={autoFocus}
        value={value}
        maxLength={MAX}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            onSubmit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (onCancel) onCancel();
            else (e.target as HTMLTextAreaElement).blur();
          }
        }}
        placeholder={placeholder}
        className="block w-full resize-none bg-transparent px-3 py-2 text-[14px] leading-[1.55] outline-none placeholder:text-muted-foreground"
      />
    );
  },
);
Composer.displayName = 'Composer';

function Comment({ author, body, postedAt, editedAt, canEdit, onEdit, onDelete, question }: {
  author: Reply['author'];
  body: string;
  postedAt: string | null;
  editedAt: string | null;
  canEdit: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
  question?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const save = () => {
    const text = draft.trim();
    if (!text) return;
    if (text !== body) onEdit(text);
    setEditing(false);
  };
  return (
    <div className="group/comment relative flex gap-3">
      <PersonAvatar person={author} size={question ? 32 : 28} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px]">
          <Link to={`/people/${author.id}`} className="font-medium hover:underline">{author.name}</Link>
          <RoleBadge role={author.role} />
          {author.title && question && <span className="hidden truncate text-sm text-muted-foreground sm:inline">{author.title}</span>}
          <Tip label={dateTime(postedAt)}>
            <span className="text-sm text-muted-foreground">{timeAgo(postedAt)}</span>
          </Tip>
          {editedAt && (
            <Tip label={`Edited ${dateTime(editedAt)}`}>
              <span className="text-sm text-faint">edited</span>
            </Tip>
          )}
        </div>
        {editing ? (
          <div className="mt-1.5 overflow-hidden rounded-md border bg-background shadow-2xs focus-within:ring-1 focus-within:ring-ring">
            <Composer value={draft} onChange={setDraft} onSubmit={save} onCancel={() => { setDraft(body); setEditing(false); }} placeholder="Edit your comment" autoFocus minHeight={60} />
            <div className="flex items-center justify-end gap-1.5 border-t bg-subtle/60 px-2 py-1.5">
              <button type="button" onClick={() => { setDraft(body); setEditing(false); }} className="h-8 rounded-md px-2 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground">Cancel</button>
              <button type="button" onClick={save} disabled={!draft.trim()} className="h-8 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Save</button>
            </div>
          </div>
        ) : (
          <div className={cn('mt-1', question ? 'text-[15px]' : 'text-[14.5px]')}>
            <Markdown className={question ? 'text-[15px]' : 'text-[14.5px]'}>{body}</Markdown>
          </div>
        )}
      </div>
      {!editing && (
        <div className="absolute -top-1 right-0 hidden items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-sm group-hover/comment:flex group-focus-within/comment:flex">
          {canEdit && (
            <Tip label="Edit">
              <IconButton size="sm" aria-label="Edit comment" onClick={() => { setDraft(body); setEditing(true); }}>
                <Pencil />
              </IconButton>
            </Tip>
          )}
          <Tip label={question ? 'Delete question' : 'Delete reply'}>
            <IconButton size="sm" aria-label={question ? 'Delete question' : 'Delete reply'} onClick={onDelete} className="hover:text-tone-danger">
              <Trash2 />
            </IconButton>
          </Tip>
        </div>
      )}
    </div>
  );
}

export function ThreadView({ thread: t, onBack, prevId, nextId, onPrev, onNext, replyRef, onDeleted, compact }: {
  thread: Thread;
  onBack?: () => void;
  prevId: string | null;
  nextId: string | null;
  onPrev: () => void;
  onNext: () => void;
  replyRef: React.RefObject<HTMLTextAreaElement>;
  onDeleted: (thread: Thread) => void;
  compact?: boolean;
}) {
  const ws = useWorkspace();
  const app = useAppActions();
  const actions = useDiscussionActions({ id: ws.me.id, name: ws.me.name, color: ws.me.color, avatarUrl: ws.me.avatarUrl, role: ws.me.role });
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const first = t.author.name.split(' ')[0];
  const lessonExists = Boolean(ws.courseById.get(t.courseId)) && t.lessonTitle !== 'Deleted lesson';

  useEffect(() => {
    setDraft('');
    scrollRef.current?.scrollTo({ top: 0 });
  }, [t.id]);

  const send = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setDraft('');
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }));
    const res = await actions.reply(t, body);
    if (!res) setDraft(body);
    setPosting(false);
  };

  const deleteComment = async (commentId: string, isQuestion: boolean) => {
    const ok = await app.confirm(
      isQuestion
        ? { title: 'Delete this question?', description: `${t.replyCount ? `Its ${t.replyCount === 1 ? 'reply' : `${t.replyCount} replies`} will be deleted too. ` : ''}${first} and other learners won’t see it on the lesson any more. This can’t be undone.`, confirmLabel: 'Delete question', destructive: true }
        : { title: 'Delete this reply?', description: 'It disappears from the lesson for everyone. This can’t be undone.', confirmLabel: 'Delete reply', destructive: true },
    );
    if (!ok) return;
    if (isQuestion) onDeleted(t);
    await actions.remove(t, commentId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-2 sm:px-3">
        {onBack && (
          <IconButton aria-label="Back to threads" onClick={onBack}>
            <ArrowLeft />
          </IconButton>
        )}
        <div className="flex min-w-0 items-center gap-1.5 pl-1 text-[14px]">
          {!compact && (
            <>
              <CourseGlyph icon={t.courseIcon} color={t.courseColor} size={16} />
              <Link to={`/courses/${t.courseId}`} className="hidden max-w-[220px] truncate text-muted-foreground hover:text-foreground sm:inline">{t.courseTitle}</Link>
              <span className="hidden text-muted-foreground/60 sm:inline">›</span>
            </>
          )}
          <LessonTypeIcon type={t.lessonType} />
          <span className="truncate font-medium">{t.lessonTitle}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Tip label={t.pinned ? 'Unpin' : 'Pin to the top of the lesson'}>
            <IconButton aria-label={t.pinned ? 'Unpin thread' : 'Pin thread'} active={t.pinned} onClick={() => void actions.setPinned(t, !t.pinned)}>
              {t.pinned ? <PinOff /> : <Pin />}
            </IconButton>
          </Tip>
          <Tip label={t.resolvedAt ? 'Reopen' : 'Mark resolved'}>
            <button
              type="button"
              onClick={() => void actions.setResolved(t, !t.resolvedAt)}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13.5px] transition-colors', t.resolvedAt ? 'text-tone-success hover:bg-accent' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
            >
              {t.resolvedAt ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDot className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{t.resolvedAt ? 'Resolved' : 'Resolve'}</span>
            </button>
          </Tip>
          {!onBack && (
            <>
              <Tip label="Previous thread" keys={['K']}>
                <IconButton aria-label="Previous thread" disabled={!prevId} onClick={onPrev}>
                  <ChevronUp />
                </IconButton>
              </Tip>
              <Tip label="Next thread" keys={['J']}>
                <IconButton aria-label="Next thread" disabled={!nextId} onClick={onNext}>
                  <ChevronDown />
                </IconButton>
              </Tip>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="Thread actions">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {lessonExists && (
                <DropdownMenuItem asChild className="text-[14px]">
                  <Link to={`/courses/${t.courseId}/content/${t.lessonId}`}>
                    <NotebookPen className="h-3.5 w-3.5" /> Open lesson in builder
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-[14px]" onSelect={() => void copyText(appUrl(`/discussions?thread=${t.id}`), 'Link copied')}>
                <Copy className="h-3.5 w-3.5" /> Copy link
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => void deleteComment(t.id, true)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete question
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-4 py-5 sm:px-8 sm:py-6 animate-fade-in" key={t.id}>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* One status: where the question stands. Pinning is a placement, so it's plain text. */}
            {t.resolvedAt ? (
              <Tip label={`Resolved ${dateTime(t.resolvedAt)}`}>
                <span className="inline-flex h-5 items-center gap-1 rounded-md bg-muted px-1.5 text-sm font-medium text-muted-foreground"><CheckCircle2 className="h-3 w-3" /> Resolved {timeAgo(t.resolvedAt)}</span>
              </Tip>
            ) : t.unanswered ? (
              <span className="inline-flex h-5 items-center rounded-md bg-tone-warning/[0.12] px-1.5 text-sm font-medium text-tone-warning">Waiting for an answer</span>
            ) : t.answeredByStaff ? (
              <span className="inline-flex h-5 items-center gap-1 rounded-md bg-tone-success/[0.1] px-1.5 text-sm font-medium text-tone-success"><CheckCircle2 className="h-3 w-3" /> Answered</span>
            ) : null}
            {t.pinned && <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Pin className="h-3 w-3 -rotate-45" /> Pinned to the lesson</span>}
            {lessonExists && (
              <Link to={`/courses/${t.courseId}/content/${t.lessonId}`} className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                <NotebookPen className="h-3 w-3" /> Open lesson in builder
              </Link>
            )}
          </div>

          <div className="mt-3 rounded-xl border bg-card px-4 py-4 shadow-2xs sm:px-5">
            <Comment question author={t.author} body={t.body} postedAt={t.postedAt} editedAt={t.editedAt} canEdit={t.author.id === ws.me.id} onEdit={body => void actions.edit(t, t.id, body)} onDelete={() => void deleteComment(t.id, true)} />
          </div>

          <div className="mt-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              {t.replies.length ? `${t.replies.length} ${t.replies.length === 1 ? 'reply' : 'replies'}` : 'No replies yet'}
              <span className="h-px flex-1 bg-border" />
            </div>
            {t.replies.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">Be the first to answer {first}. Replies show on the lesson for everyone taking the course, and {first} gets a notification.</p>
            ) : (
              <div className="space-y-5">
                {t.replies.map(r => (
                  <Comment
                    key={r.id}
                    author={r.author}
                    body={r.body}
                    postedAt={r.postedAt}
                    editedAt={r.editedAt}
                    canEdit={r.author.id === ws.me.id && !r.id.startsWith('temp-')}
                    onEdit={body => void actions.edit(t, r.id, body)}
                    onDelete={() => !r.id.startsWith('temp-') && void deleteComment(r.id, false)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t bg-background px-3 py-2.5 sm:px-4">
        <div className="mx-auto flex max-w-[720px] items-end gap-2.5">
          <PersonAvatar person={ws.me} size={24} className="mb-2 hidden sm:inline-flex" />
          <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-background shadow-2xs focus-within:ring-1 focus-within:ring-ring">
            <Composer ref={replyRef} value={draft} onChange={setDraft} onSubmit={() => void send()} placeholder={`Reply to ${first}…`} />
            <div className="flex items-center gap-2 px-2 pb-1.5">
              <span className="text-2xs text-faint">Markdown · visible to learners on the lesson</span>
              {draft.length > MAX - 300 && <span className="text-2xs tabular-nums text-tone-warning">{MAX - draft.length} left</span>}
              <button
                type="button"
                onClick={() => void send()}
                disabled={!draft.trim() || posting}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50"
              >
                Reply <span className="text-[12px] opacity-70">{MOD}↵</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
