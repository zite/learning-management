import { useQueryClient } from '@tanstack/react-query';
import { Archive, CheckCheck, Inbox, MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@project/components/ui/sheet';
import { EmptyPreview, emptyCopy, InboxPreview } from '../components/inbox/InboxPreview';
import { InboxRow, type RowActions } from '../components/inbox/InboxRow';
import { asInboxTab, groupItems, sourceFor, syncUnreadBadge, useInboxActions, useNotifications, type InboxItem } from '../components/inbox/inboxData';
import { destinationFor } from '../components/inbox/inboxMeta';
import { EmptyState, IconButton, Kbd } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { hasOpenOverlay, shouldIgnore, useHotkeys } from '../lib/hotkeys';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useWorkspace } from '../lib/workspace';

/**
 * Inbox keys listen in the capture phase so they win over the shell's own
 * single-letter shortcuts (⇧E is "enroll" everywhere else). A "G then …"
 * navigation still belongs to the shell.
 */
function useInboxKeys(handlers: Record<string, (e: KeyboardEvent) => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    let lastG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (shouldIgnore(e) || hasOpenOverlay()) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === 'g') {
        lastG = Date.now();
        return;
      }
      if (Date.now() - lastG < 1200) {
        lastG = 0;
        return;
      }
      const combo = `${e.shiftKey && key.length === 1 ? 'shift+' : ''}${key}`;
      const handler = ref.current[combo];
      if (!handler) return;
      const target = e.target as HTMLElement | null;
      // Enter on a focused button or link means that control, not "open".
      if (key === 'Enter' && target?.closest?.('button, a, [role="button"], [role="menuitem"]')) return;
      e.preventDefault();
      e.stopPropagation();
      handler(e);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

export function InboxPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const desktop = useMediaQuery('(min-width: 1024px)');
  const tab = asInboxTab(params.get('tab'));
  const { data, isPending, isError, refetch } = useNotifications(sourceFor(tab));
  const actions = useInboxActions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Read while looking at Unread: they stay listed (not bold) until you leave the tab.
  const [sticky, setSticky] = useState<Set<string>>(() => new Set());
  const markTimer = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  const unreadCount = data?.counts.unread ?? ws.counts.inboxUnread;
  useDocumentTitle(unreadCount ? `Inbox (${unreadCount})` : 'Inbox');

  useEffect(() => {
    if (data) syncUnreadBadge(qc, data.counts.unread);
  }, [data, qc]);

  useEffect(() => () => window.clearTimeout(markTimer.current), []);

  useEffect(() => {
    setSelectedId(null);
    setSticky(new Set());
    setSheetOpen(false);
  }, [tab]);

  const items = useMemo(() => {
    const all = data?.notifications ?? [];
    return tab === 'unread' ? all.filter(n => !n.readAt || sticky.has(n.id)) : all;
  }, [data, tab, sticky]);
  const groups = useMemo(() => groupItems(items, tab), [items, tab]);
  const selected = items.find(n => n.id === selectedId) ?? null;

  const latest = useRef({ items, selected, tab, desktop });
  latest.current = { items, selected, tab, desktop };

  // A notification that left the list (archived from the preview, say) takes the selection with it.
  useEffect(() => {
    if (selectedId && data && !items.some(n => n.id === selectedId)) {
      setSelectedId(null);
      setSheetOpen(false);
    }
  }, [items, selectedId, data]);

  const select = useCallback(
    (item: InboxItem, how: 'click' | 'key') => {
      setSelectedId(item.id);
      if (latest.current.tab === 'unread') setSticky(s => (s.has(item.id) ? s : new Set(s).add(item.id)));
      window.clearTimeout(markTimer.current);
      if (!item.readAt) {
        const mark = () => {
          const current = latest.current.items.find(n => n.id === item.id);
          if (current && !current.readAt) void actions.setRead([current], true);
        };
        // Clicking opens it; skimming past with J and K only counts once you pause on it.
        if (how === 'click') mark();
        else markTimer.current = window.setTimeout(mark, 450);
      }
      if (how === 'click' && !latest.current.desktop) setSheetOpen(true);
      requestAnimationFrame(() => listRef.current?.querySelector(`[data-inbox-id="${item.id}"]`)?.scrollIntoView({ block: 'nearest' }));
    },
    [actions],
  );

  const onRowSelect = useCallback((item: InboxItem) => select(item, 'click'), [select]);

  /** After an item leaves the list, keep the keyboard where it was: the next one down, or the one above. */
  const selectNeighbour = useCallback(
    (item: InboxItem) => {
      const { items: list, selected: current, desktop: wide } = latest.current;
      if (current?.id !== item.id) return;
      const i = list.findIndex(n => n.id === item.id);
      const next = list[i + 1] ?? list[i - 1];
      if (next && wide) select(next, 'key');
      else {
        setSelectedId(null);
        setSheetOpen(false);
      }
    },
    [select],
  );

  const rowActions = useMemo<RowActions>(
    () => ({
      toggleRead: item => {
        if (!item.readAt) window.clearTimeout(markTimer.current);
        void actions.setRead([item], !item.readAt);
      },
      archive: item => {
        selectNeighbour(item);
        if (item.archivedAt) void actions.unarchive([item]);
        else void actions.archive([item]);
      },
    }),
    [actions, selectNeighbour],
  );

  const open = useCallback(
    (item: InboxItem) => {
      const dest = destinationFor(item);
      if (!dest) return;
      if (!item.readAt) void actions.setRead([item], true);
      navigate(dest.to);
    },
    [actions, navigate],
  );

  const move = (delta: number) => {
    const { items: list, selected: current } = latest.current;
    if (!list.length) return;
    const i = current ? list.indexOf(current) : -1;
    const nextIndex = i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + delta));
    if (list[nextIndex] && list[nextIndex].id !== current?.id) select(list[nextIndex], 'key');
  };

  useInboxKeys({
    j: () => move(1),
    ArrowDown: () => move(1),
    k: () => move(-1),
    ArrowUp: () => move(-1),
    Enter: () => latest.current.selected && open(latest.current.selected),
    e: () => latest.current.selected && rowActions.archive(latest.current.selected),
    u: () => latest.current.selected && rowActions.toggleRead(latest.current.selected),
    'shift+e': () => {
      if (latest.current.tab !== 'archived') void actions.archiveAllRead();
    },
  });
  useHotkeys({ esc: () => latest.current.selected && latest.current.desktop && setSelectedId(null) });

  const preview = selected ? (
    <InboxPreview key={selected.id} item={selected} tab={tab} actions={rowActions} onOpen={open} onBack={desktop ? undefined : () => setSheetOpen(false)} />
  ) : null;
  const copy = emptyCopy(tab);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<Inbox />}
        title="Inbox"
        tabs={[
          { to: '/inbox', label: 'Unread', count: data ? data.counts.unread : ws.counts.inboxUnread, active: tab === 'unread' },
          { to: '/inbox?tab=all', label: 'All', count: data?.counts.all, active: tab === 'all' },
          { to: '/inbox?tab=archived', label: 'Archived', active: tab === 'archived' },
        ]}
        actions={
          <>
            <button
              type="button"
              disabled={!unreadCount}
              onClick={() => void actions.markAllRead()}
              className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Mark all read</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="Inbox actions">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem className="text-[14px]" disabled={!unreadCount} onSelect={() => void actions.markAllRead()}>
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all as read
                </DropdownMenuItem>
                <DropdownMenuItem className="text-[14px]" disabled={tab === 'archived'} onSelect={() => void actions.archiveAllRead()}>
                  <Archive className="h-3.5 w-3.5" /> Archive everything read
                  <span className="ml-auto flex gap-0.5"><Kbd>⇧</Kbd><Kbd>E</Kbd></span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      {desktop && !isPending && !isError && items.length === 0 ? (
        // Nothing to list: one calm pane rather than an empty column beside an empty preview.
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmptyPreview tab={tab} empty />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-full min-w-0 flex-col lg:w-[400px] lg:shrink-0 lg:border-r">
            <div ref={listRef} aria-label="Notifications" className="min-h-0 flex-1 overflow-y-auto">
              {isPending ? (
                <div className="space-y-px pt-1">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex gap-3 px-5 py-3">
                      <div className="skeleton h-7 w-7 rounded-full" />
                      <div className="flex-1 space-y-2 pt-0.5">
                        <div className="skeleton h-3" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
                        <div className="skeleton h-2.5" style={{ width: `${35 + ((i * 29) % 40)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : isError ? (
                <EmptyState
                  icon={<Inbox />}
                  title="Your inbox didn’t load"
                  description="Check your connection and try again."
                  action={<button type="button" onClick={() => void refetch()} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">Try again</button>}
                />
              ) : items.length === 0 ? (
                <div className="lg:hidden">
                  <EmptyState icon={tab === 'archived' ? <Archive /> : <CheckCheck />} title={copy.title} description={copy.description} />
                </div>
              ) : (
                groups.map(g => (
                  <section key={g.label} aria-label={g.label}>
                    <div className="sticky top-0 z-10 flex h-8 items-center border-b border-border/50 bg-subtle/95 px-5 text-sm font-medium text-muted-foreground backdrop-blur-sm">
                      {g.label}
                      <span className="ml-1.5 tabular-nums text-faint">{g.items.length}</span>
                    </div>
                    {g.items.map(n => (
                      <InboxRow key={n.id} item={n} tab={tab} active={n.id === selectedId} sticky={sticky.has(n.id)} onSelect={onRowSelect} actions={rowActions} />
                    ))}
                  </section>
                ))
              )}
            </div>
            {items.length > 0 && (
              <div className="hidden h-9 shrink-0 items-center gap-3 whitespace-nowrap border-t px-4 text-2xs text-muted-foreground lg:flex">
                <span className="flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> move</span>
                <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
                <span className="flex items-center gap-1"><Kbd>E</Kbd> {tab === 'archived' ? 'restore' : 'archive'}</span>
                <span className="flex items-center gap-1"><Kbd>U</Kbd> read</span>
              </div>
            )}
          </div>
          {desktop && <div className="hidden min-w-0 flex-1 overflow-hidden lg:block">{preview ?? <EmptyPreview tab={tab} empty={false} />}</div>}
        </div>
      )}
      {!desktop && (
        <Sheet open={sheetOpen && Boolean(selected)} onOpenChange={setSheetOpen}>
          <SheetContent
            side="right"
            className="w-full gap-0 p-0 outline-none sm:max-w-full [&>button:first-child]:hidden"
            // Focus the sheet itself rather than ringing the back button on every tap.
            onOpenAutoFocus={e => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).focus();
            }}
          >
            <SheetTitle className="sr-only">{selected?.title ?? 'Notification'}</SheetTitle>
            {preview}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
