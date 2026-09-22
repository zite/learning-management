import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, MessageCircleQuestion, MoreHorizontal, Pin, Reply } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { postComment, updateComment } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { Markdown } from '@project/shared/ui/Markdown';
import { errorMessage } from '../../lib/errors';
import { timeAgo } from '../../lib/format';
import { MOD } from '../../lib/hotkeys';
import { Avatar } from '../kit';
import { Button, EmptyState, Skeleton, textareaClass } from '../ui';
import { ConfirmDialog, Kbd, revealInScroller } from './bits';
import { playerKeys, useComments, type Thread } from './queries';

/**
 * Questions on the lesson, in a side sheet so the lesson stays in view. Ask,
 * reply, edit or delete your own; answers from instructors carry a badge.
 */
export function QuestionsDrawer({
  open,
  onOpenChange,
  slug,
  lessonId,
  lessonTitle,
  threadId,
  draft,
  onDraftUsed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  lessonId: string;
  lessonTitle: string;
  threadId: string | null;
  draft: string | null;
  onDraftUsed: () => void;
}) {
  const query = useComments(lessonId, open);
  const qc = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  // A deep link (?thread=…) opens the sheet scrolled to that thread.
  useEffect(() => {
    if (!open || !threadId || !query.data) return;
    const t = window.setTimeout(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(threadId)}"]`);
      if (el) {
        revealInScroller(el, { block: 'center' });
        setHighlight(threadId);
        window.setTimeout(() => setHighlight(null), 2400);
      }
    }, 150);
    return () => window.clearTimeout(t);
  }, [open, threadId, query.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: playerKeys.comments(lessonId) });
    void qc.invalidateQueries({ queryKey: playerKeys.lesson(slug, lessonId) });
  };

  const threads = query.data?.threads ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[460px]">
        <div className="shrink-0 border-b px-5 pb-4 pt-5">
          <SheetTitle className="flex items-center gap-2 text-lg font-semibold">
            <MessageCircleQuestion className="h-5 w-5 text-muted-foreground" aria-hidden /> Questions
          </SheetTitle>
          <SheetDescription className="mt-0.5 truncate pr-8 text-sm text-muted-foreground">{lessonTitle}</SheetDescription>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {query.data?.enabled !== false && <Composer key={draft ?? 'composer'} lessonId={lessonId} initial={draft ?? ''} onPosted={() => { onDraftUsed(); refresh(); }} autoFocus={Boolean(draft)} />}
          {query.isPending ? (
            <div className="space-y-4 px-5 py-5">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : query.isError ? (
            <EmptyState title="Couldn’t load questions" action={<Button onClick={() => query.refetch()}>Try again</Button>}>
              {errorMessage(query.error, 'Check your connection and try again.')}
            </EmptyState>
          ) : query.data?.enabled === false ? (
            <EmptyState icon={MessageCircleQuestion} title="Questions are turned off">
              Your academy doesn’t use lesson questions. Contact your instructor directly if you’re stuck.
            </EmptyState>
          ) : threads.length === 0 ? (
            <EmptyState icon={MessageCircleQuestion} title="No questions yet" className="py-10">
              Stuck on something, or curious? Ask above — your instructor will answer here for everyone taking the course.
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {threads.map(t => (
                <li key={t.id} data-thread-id={t.id} className={cn('px-5 py-4 transition-colors duration-700', highlight === t.id && 'bg-primary/[0.07]')}>
                  <ThreadView thread={t} lessonId={lessonId} onChanged={refresh} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Composer({ lessonId, initial, onPosted, autoFocus, parentId, onCancel, placeholder }: { lessonId: string; initial?: string; onPosted: () => void; autoFocus?: boolean; parentId?: string; onCancel?: () => void; placeholder?: string }) {
  const [body, setBody] = useState(initial ?? '');
  const id = useId();
  const mutation = useMutation({
    mutationFn: () => postComment({ lessonId, body, parentId: parentId ?? null }),
    onSuccess: () => {
      setBody('');
      toast.success(parentId ? 'Reply posted.' : 'Question posted. Your instructor has been notified.');
      onPosted();
      onCancel?.();
    },
    onError: e => toast.error(errorMessage(e, "Couldn't post that. Try again.")),
  });
  const submit = () => {
    if (body.trim() && !mutation.isPending) mutation.mutate();
  };
  return (
    <form
      className={cn(parentId ? 'mt-3' : 'border-b bg-subtle px-5 py-4')}
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {parentId ? 'Your reply' : 'Ask a question about this lesson'}
      </label>
      <textarea
        id={id}
        value={body}
        autoFocus={autoFocus}
        onChange={e => setBody(e.target.value)}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape' && onCancel) {
            e.stopPropagation();
            onCancel();
          }
        }}
        maxLength={5000}
        rows={parentId ? 2 : 3}
        placeholder={placeholder ?? 'Ask a question about this lesson…'}
        className={textareaClass('min-h-0 resize-none text-[15px]')}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto hidden text-xs text-faint sm:inline">
          <Kbd>{MOD}↵</Kbd> to post
        </span>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!body.trim()} loading={mutation.isPending}>
          {parentId ? 'Reply' : 'Post question'}
        </Button>
      </div>
    </form>
  );
}

function ThreadView({ thread, lessonId, onChanged }: { thread: Thread; lessonId: string; onChanged: () => void }) {
  const [replying, setReplying] = useState(false);
  const staffAnswered = thread.replies.some(r => r.author.badge);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {thread.pinned && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
            <Pin className="h-3 w-3" aria-hidden /> Pinned
          </span>
        )}
        {(thread.resolved || staffAnswered) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-tone-success/[0.1] px-2 py-0.5 text-2xs font-medium text-tone-success">
            <CheckCheck className="h-3 w-3" aria-hidden /> Answered
          </span>
        )}
      </div>
      <CommentView comment={thread} onChanged={onChanged} isQuestion />
      {thread.replies.length > 0 && (
        <ul className="ml-4 mt-3 space-y-3 border-l pl-4">
          {thread.replies.map(r => (
            <li key={r.id}>
              <CommentView comment={r} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
      {replying ? (
        <div className="ml-4 border-l pl-4">
          <Composer lessonId={lessonId} parentId={thread.id} onPosted={onChanged} onCancel={() => setReplying(false)} autoFocus placeholder="Write a reply…" />
        </div>
      ) : (
        <button type="button" onClick={() => setReplying(true)} className="ml-10 mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-muted-foreground hover:text-foreground">
          <Reply className="h-3.5 w-3.5" aria-hidden /> Reply
        </button>
      )}
    </div>
  );
}

function CommentView({ comment: c, onChanged, isQuestion }: { comment: Thread | Thread['replies'][number]; onChanged: () => void; isQuestion?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useMutation({
    mutationFn: () => updateComment({ id: c.id, body }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: e => toast.error(errorMessage(e, "Couldn't save your edit.")),
  });
  const remove = useMutation({
    mutationFn: () => updateComment({ id: c.id, delete: true }),
    onSuccess: () => {
      setConfirmDelete(false);
      toast.success(isQuestion ? 'Question deleted.' : 'Reply deleted.');
      onChanged();
    },
    onError: e => {
      setConfirmDelete(false);
      toast.error(errorMessage(e, "Couldn't delete that."));
    },
  });

  return (
    <div className="flex gap-3">
      <Avatar name={c.author.name} color={c.author.color} avatarUrl={c.author.avatarUrl} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 truncate text-sm">
            <span className="font-semibold">{c.own ? 'You' : c.author.name}</span>
            {c.author.badge && <span className="ml-1.5 rounded bg-primary/[0.1] px-1.5 py-px text-2xs font-semibold text-primary">{c.author.badge}</span>}
            <span className="ml-1.5 text-xs text-muted-foreground">
              {timeAgo(c.postedAt)}
              {c.editedAt && !c.deleted ? ' · edited' : ''}
            </span>
          </p>
          {c.own && !c.deleted && !editing && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Comment actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[8rem]">
                <DropdownMenuItem onSelect={() => { setBody(c.body); setEditing(true); }}>Edit</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-tone-danger focus:text-tone-danger">
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {editing ? (
          <form
            className="mt-1.5"
            onSubmit={e => {
              e.preventDefault();
              if (body.trim()) save.mutate();
            }}
          >
            <textarea
              value={body}
              autoFocus
              onFocus={e => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              onChange={e => setBody(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim()) {
                  e.preventDefault();
                  save.mutate();
                }
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
              maxLength={5000}
              rows={3}
              aria-label="Edit comment"
              className={textareaClass('min-h-0 resize-none text-[15px]')}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={save.isPending} disabled={!body.trim()}>
                Save
              </Button>
            </div>
          </form>
        ) : c.deleted ? (
          <p className="mt-0.5 text-[15px] italic text-muted-foreground">This question was deleted.</p>
        ) : (
          <Markdown compact className="mt-0.5 break-words text-[15px] leading-relaxed">
            {c.body}
          </Markdown>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={isQuestion ? 'Delete your question?' : 'Delete your reply?'}
        description={isQuestion ? 'If someone has already replied, their answers stay and your question shows as deleted.' : 'This can’t be undone.'}
        confirmLabel="Delete"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
