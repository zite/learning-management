import { CheckCheck, ChevronDown, MessagesSquare, Pin, Search, SearchX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebounce } from 'use-debounce';
import { cn } from '@project/components/lib/utils';
import { useHotkeys } from '../../lib/hotkeys';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useWorkspace } from '../../lib/workspace';
import { CoursePicker } from '../pickers/pickers';
import { EmptyState, IconButton, Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { FILTERS, useDiscussions, type DiscussionFilter, type DiscussionList, type Thread } from './discussionsData';
import { ThreadRow } from './ThreadList';
import { ThreadView } from './ThreadView';

const EMPTY: Record<DiscussionFilter, { icon: ReactNode; title: string; description: string }> = {
  unanswered: { icon: <CheckCheck />, title: 'Every question has an answer', description: 'When a learner asks something on a lesson and no instructor has replied yet, it waits here.' },
  all: { icon: <MessagesSquare />, title: 'No questions yet', description: 'Questions learners ask on lessons land here, with every reply.' },
  resolved: { icon: <CheckCheck />, title: 'Nothing resolved yet', description: 'Mark a thread resolved once the question is settled and it moves here.' },
  pinned: { icon: <Pin />, title: 'Nothing pinned', description: 'Pin a thread to keep it at the top of its lesson for everyone taking the course.' },
};

function ListSkeleton() {
  return (
    <div className="space-y-px pt-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex gap-2.5 px-4 py-3">
          <div className="skeleton h-6 w-6 rounded-full" />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="skeleton h-3" style={{ width: `${30 + ((i * 17) % 25)}%` }} />
            <div className="skeleton h-2.5" style={{ width: `${60 + ((i * 29) % 35)}%` }} />
            <div className="skeleton h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Threads on the left, the conversation on the right. The Discussions page
 * and a course's Discussions tab are the same workspace; the course tab locks
 * it to one course and carries its own filter tabs.
 */
export function DiscussionsWorkspace({ filter, onFilter, lockedCourseId, onCounts }: {
  filter: DiscussionFilter;
  /** When set, the workspace renders its own filter tabs (the course tab has no page header to hold them). */
  onFilter?: (f: DiscussionFilter) => void;
  lockedCourseId?: string;
  onCounts?: (counts: DiscussionList['counts'] | undefined) => void;
}) {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  const wide = useMediaQuery('(min-width: 1024px)');
  const threadParam = params.get('thread');
  const courseParam = params.get('course');
  const courseId = lockedCourseId ?? courseParam;
  const [q, setQ] = useState('');
  const [debouncedQ] = useDebounce(q, 250);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const query = useMemo(() => ({ filter, courseId: courseId ?? null, q: debouncedQ }), [filter, courseId, debouncedQ]);
  const { data, isPending, isError, refetch, isPlaceholderData, isFetching } = useDiscussions(query, threadParam);
  const threads = useMemo(() => data?.threads ?? [], [data]);
  const selected: Thread | null = threadParam ? threads.find(t => t.id === threadParam) ?? (data?.focus?.id === threadParam ? data.focus : null) : null;

  useEffect(() => onCounts?.(data?.counts), [data?.counts, onCounts]);

  const setThread = useCallback(
    (id: string | null, replace = true) => {
      setParams(p => {
        if (id) p.set('thread', id);
        else p.delete('thread');
        return p;
      }, { replace });
    },
    [setParams],
  );

  // A deep link to a thread outside this filter: ask for it once.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!threadParam || !data || isPlaceholderData || selected || asked.current.has(threadParam)) return;
    asked.current.add(threadParam);
    void refetch();
  }, [threadParam, data, isPlaceholderData, selected, refetch]);

  // A new search takes the open thread with it when the thread no longer matches.
  const searchKey = debouncedQ.trim();
  const lastSearch = useRef(searchKey);
  const refocus = useRef(false);
  useEffect(() => {
    if (lastSearch.current === searchKey) return;
    lastSearch.current = searchKey;
    refocus.current = true;
  }, [searchKey]);
  useEffect(() => {
    if (!refocus.current || !data || isPlaceholderData || isFetching) return;
    refocus.current = false;
    if (!threadParam || threads.some(t => t.id === threadParam)) return;
    setThread(wide && threads.length ? threads[0].id : null);
  }, [data, isPlaceholderData, isFetching, threadParam, threads, wide, setThread]);

  // On a wide screen a thread is always open.
  useEffect(() => {
    if (!wide || !data || isPlaceholderData || !threads.length || threadParam) return;
    setThread(threads[0].id);
  }, [wide, data, isPlaceholderData, threads, threadParam, setThread]);

  useEffect(() => {
    if (!threadParam) return;
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-thread-id="${threadParam}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [threadParam, threads.length]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const index = selected ? threads.findIndex(t => t.id === selected.id) : -1;
  const prevId = index > 0 ? threads[index - 1].id : null;
  const nextId = index >= 0 ? threads[index + 1]?.id ?? null : threads[0]?.id ?? null;

  const onDeleted = (t: Thread) => {
    const i = threads.findIndex(x => x.id === t.id);
    const neighbour = threads[i + 1] ?? threads[i - 1];
    setThread(wide && neighbour ? neighbour.id : null);
  };

  useHotkeys({
    j: () => nextId && setThread(nextId),
    k: () => prevId && setThread(prevId),
    r: () => selected && replyRef.current?.focus(),
    '/': () => setSearchOpen(true),
    esc: () => !wide && threadParam && setThread(null, false),
  });

  const course = courseParam ? ws.courseById.get(courseParam) : undefined;
  const filtered = Boolean(debouncedQ.trim() || (!lockedCourseId && courseParam));

  const toolbar = (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
      {searchOpen ? (
        <div className="flex h-8 max-w-[364px] flex-1 items-center gap-1.5 rounded-md border bg-background px-2 animate-fade-in">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setQ('');
                setSearchOpen(false);
              } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Search questions, replies, people…"
            aria-label="Search discussions"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
          <button type="button" aria-label="Clear search" onClick={() => { setQ(''); setSearchOpen(false); }} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <>
          {onFilter ? (
            <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none" role="tablist" aria-label="Filter threads">
              {FILTERS.map(f => {
                const n = data?.counts[f.value];
                return (
                  <button
                    key={f.value}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.value}
                    onClick={() => onFilter(f.value)}
                    className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13.5px] transition-colors', filter === f.value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}
                  >
                    {f.label}
                    {n ? <span className={cn('tabular-nums', f.value === 'unanswered' ? 'text-tone-warning' : 'text-muted-foreground')}>{n}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <CoursePicker
              value={courseParam}
              onChange={v =>
                setParams(p => {
                  if (v) p.set('course', v);
                  else p.delete('course');
                  p.delete('thread');
                  return p;
                }, { replace: true })
              }
              allowNone
              trigger={
                <button type="button" className={cn('ghost-chip h-8 min-w-0 gap-1.5 px-2 text-[13.5px]', course ? 'text-foreground' : 'text-muted-foreground')}>
                  {course && <CourseGlyph icon={course.icon} color={course.color} size={14} />}
                  <span className="truncate">{course?.title ?? 'All courses'}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                </button>
              }
            />
          )}
          <Tip label="Search" keys={['/']}>
            <IconButton className="ml-auto" aria-label="Search discussions" onClick={() => setSearchOpen(true)}>
              <Search />
            </IconButton>
          </Tip>
        </>
      )}
    </div>
  );

  const empty = filtered ? (
    <EmptyState
      icon={<SearchX />}
      title="No threads match"
      description={lockedCourseId ? 'Try another search.' : 'Try another search or course.'}
      className="h-full"
      action={
        <button
          type="button"
          onClick={() => {
            setQ('');
            setSearchOpen(false);
            if (!lockedCourseId && courseParam) {
              setParams(p => {
                p.delete('course');
                return p;
              }, { replace: true });
            }
          }}
          className="h-9 rounded-md border bg-background px-3 text-[14px] font-medium shadow-2xs hover:bg-accent"
        >
          Clear filters
        </button>
      }
    />
  ) : (
    <EmptyState icon={EMPTY[filter].icon} title={EMPTY[filter].title} description={EMPTY[filter].description} className="h-full" />
  );

  const list = (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" aria-label="Threads">
        {isPending ? (
          <ListSkeleton />
        ) : isError ? (
          <EmptyState title="Discussions didn’t load" description="Check your connection and try again." action={<button type="button" onClick={() => void refetch()} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">Try again</button>} />
        ) : threads.length === 0 ? (
          empty
        ) : (
          threads.map(t => <ThreadRow key={t.id} thread={t} active={t.id === selected?.id} showCourse={!lockedCourseId} onOpen={id => setThread(id, wide)} />)
        )}
      </div>
    </div>
  );

  const view = selected ? (
    <ThreadView
      key={selected.id}
      thread={selected}
      compact={Boolean(lockedCourseId)}
      onBack={wide ? undefined : () => setThread(null, false)}
      prevId={prevId}
      nextId={nextId}
      onPrev={() => prevId && setThread(prevId)}
      onNext={() => nextId && setThread(nextId)}
      replyRef={replyRef}
      onDeleted={onDeleted}
    />
  ) : threadParam && data && !isPlaceholderData && !isFetching && asked.current.has(threadParam) ? (
    <EmptyState title="This thread isn’t available" description="It may have been deleted." className="h-full" action={<button type="button" onClick={() => setThread(null)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">Back to threads</button>} />
  ) : isPending || (threadParam && !selected) ? (
    <div className="space-y-3 p-8">
      <div className="skeleton h-4 w-1/3" />
      <div className="skeleton h-24 w-full rounded-xl" />
      <div className="skeleton h-4 w-1/2" />
    </div>
  ) : (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-xs">
        <MessagesSquare className="mx-auto h-5 w-5 text-muted-foreground" />
        <p className="mt-2 text-[14px] text-muted-foreground">{threads.length ? 'Select a thread to read and reply.' : 'Nothing to show here.'}</p>
      </div>
    </div>
  );

  if (!wide) return <div className="flex min-h-[480px] min-w-0 flex-1 flex-col">{threadParam ? view : list}</div>;
  // Nothing to list: the list takes the full width and says so once. Same element either way, so a focused search box keeps focus.
  const wideEmpty = !isPending && !isError && threads.length === 0 && !threadParam;
  return (
    <div className="flex min-h-[520px] min-w-0 flex-1">
      <aside className={cn('flex flex-col', wideEmpty ? 'min-w-0 flex-1' : 'w-[380px] shrink-0 border-r')} aria-label="Threads">{list}</aside>
      {!wideEmpty && <section className="flex min-w-0 flex-1 flex-col" aria-label="Thread">{view}</section>}
    </div>
  );
}
