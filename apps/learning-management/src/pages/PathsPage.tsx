import { Archive, Filter, Lock, MoreHorizontal, Plus, Route, Shuffle, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@project/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { completionOf, MiniBar, QueryTabs, SearchField, StatusPill } from '../components/courses/CourseBits';
import { useListKeys } from '../components/courses/useListKeys';
import { PathMenuItems, PublishPathDialog } from '../components/paths/PathActions';
import { PersonAvatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, Kbd, Tip } from '../components/primitives/bits';
import { CourseGlyph } from '../components/primitives/icons';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { formatDuration, plural } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import type { Path } from '../lib/types';
import { useWorkspace } from '../lib/workspace';

type TabKey = 'published' | 'drafts' | 'archived';

const TABS: Array<{ key: TabKey; label: string; status: Path['status'] }> = [
  { key: 'published', label: 'Published', status: 'Published' },
  { key: 'drafts', label: 'Drafts', status: 'Draft' },
  { key: 'archived', label: 'Archived', status: 'Archived' },
];

const EMPTY: Record<TabKey, { title: string; description: string }> = {
  published: { title: 'No published paths', description: 'Publish a draft path to put it in the catalog and make it assignable.' },
  drafts: { title: 'No draft paths', description: 'New learning paths start here until every course in them is ready.' },
  archived: { title: 'Nothing archived', description: 'Archive paths you no longer run. Progress and certificates are kept.' },
};

/** Learning paths: a series of courses taken together, with one due date and one certificate. */
export function PathsPage() {
  useDocumentTitle('Learning paths');
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [publishing, setPublishing] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tab = TABS.find(t => t.key === params.get('tab')) ?? TABS[0];
  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params);
    if (key === 'published') next.delete('tab');
    else next.set('tab', key);
    setParams(next, { replace: true });
  };
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, ws.paths.filter(p => p.status === t.status).length])) as Record<TabKey, number>, [ws.paths]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ws.orderedPaths.filter(p => p.status === tab.status && (!needle || `${p.title} ${p.summary} ${p.courseIds.map(id => ws.courseById.get(id)?.title ?? '').join(' ')}`.toLowerCase().includes(needle)));
  }, [ws, tab, q]);
  const ids = useMemo(() => visible.map(p => p.id), [visible]);
  const list = useListKeys({
    ids,
    scrollRef,
    onOpen: id => navigate(`/paths/${id}`),
    extra: {
      e: id => {
        const p = id ? ws.pathById.get(id) : undefined;
        if (p?.status === 'Published') app.openEnroll({ targetType: 'Path', targetId: p.id });
      },
    },
  });
  useHotkeys({
    '/': () => window.setTimeout(() => searchRef.current?.focus(), 0),
    '1': () => setTab('published'),
    '2': () => setTab('drafts'),
    '3': () => setTab('archived'),
  });

  const fresh = ws.paths.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<Route />}
        title="Learning paths"
        actions={
          <button type="button" onClick={app.openCreatePath} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 sm:px-2.5">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New path</span>
          </button>
        }
      >
        {!fresh && <QueryTabs label="Filter paths by status" value={tab.key} onChange={setTab} tabs={TABS.map((t, i) => ({ key: t.key, label: t.label, count: counts[t.key], tip: `${t.label} paths`, keys: [String(i + 1)] }))} />}
      </PageHeader>
      {!fresh && (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">{plural(visible.length, 'path')}</span>
          <div className="ml-auto">
            <SearchField ref={searchRef} value={q} onChange={setQ} placeholder="Search paths…" className="w-44 sm:w-60" />
          </div>
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {fresh ? (
          <EmptyState
            className="py-24"
            icon={<Route />}
            title="Create your first learning path"
            description="Group courses into a journey — onboarding, a certification, a manager programme — with one due date and one certificate at the end."
            action={
              <button type="button" onClick={app.openCreatePath} className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                <Plus className="h-3.5 w-3.5" /> New path
              </button>
            }
          />
        ) : visible.length === 0 ? (
          q ? (
            <EmptyState icon={<Filter />} title="No paths match" description={`Nothing in ${tab.label.toLowerCase()} matches “${q}”.`} action={<button type="button" onClick={() => setQ('')} className="text-[14px] text-primary hover:underline">Clear search</button>} />
          ) : (
            <EmptyState icon={tab.key === 'archived' ? <Archive /> : tab.key === 'drafts' ? <Sparkles /> : <Route />} title={EMPTY[tab.key].title} description={EMPTY[tab.key].description} action={tab.key !== 'archived' ? <button type="button" onClick={app.openCreatePath} className="text-[14px] text-primary hover:underline">New path</button> : undefined} />
          )
        ) : (
          <div role="grid" aria-label="Learning paths">
            <div className="sticky top-0 z-[1] hidden h-9 grid-cols-[minmax(0,1fr)_200px_64px_128px_64px_96px_44px_28px] items-center gap-3 border-b bg-subtle/95 px-4 text-sm text-muted-foreground backdrop-blur md:grid">
              <span className="pl-[30px]">Path</span>
              <span>Courses</span>
              <span className="text-right">Enrolled</span>
              <span>Completion</span>
              <span className="text-right">Overdue</span>
              <span>Order</span>
              <span>Owner</span>
              <span />
            </div>
            {visible.map(p => (
              <PathRow key={p.id} path={p} focused={list.focusedId === p.id} onPublish={setPublishing} onClick={e => list.onRowClick(p.id, e)} onHover={() => list.setFocusedId(p.id)} />
            ))}
            <div className="hidden items-center gap-3 px-4 py-3 text-2xs text-muted-foreground md:flex">
              <span className="flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> move</span>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
              <span className="flex items-center gap-1"><Kbd>E</Kbd> enroll</span>
              <span className="flex items-center gap-1"><Kbd>/</Kbd> search</span>
            </div>
          </div>
        )}
      </div>
      <PublishPathDialog pathId={publishing} onOpenChange={o => !o && setPublishing(null)} />
    </div>
  );
}

function PathRow({ path: p, focused, onPublish, onClick, onHover }: { path: Path; focused: boolean; onPublish: (id: string) => void; onClick: (e: React.MouseEvent) => void; onHover: () => void }) {
  const ws = useWorkspace();
  const owner = p.ownerId ? ws.staffById.get(p.ownerId) : undefined;
  const courses = p.courseIds.map(id => ws.courseById.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof ws.courseById.get>>[];
  const minutes = courses.reduce((s, c) => s + c.estimatedMinutes, 0);
  const drafts = courses.filter(c => c.status !== 'Published').length;
  const completion = completionOf(p);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-row-id={p.id}
          role="row"
          onClick={onClick}
          onMouseEnter={onHover}
          className={cn('group relative grid min-h-12 cursor-default py-1.5 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 text-[14px] transition-colors md:grid-cols-[minmax(0,1fr)_200px_64px_128px_64px_96px_44px_28px]', focused ? 'bg-accent/60' : 'hover:bg-accent/40')}
        >
          {focused && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />}
          <div className="flex min-w-0 items-center gap-2.5">
            <CourseGlyph icon={p.icon} color={p.color} size={20} />
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{p.title}</span>
                {p.status !== 'Published' && <StatusPill status={p.status} />}
              </span>
              {p.summary && <span className="hidden truncate text-sm text-muted-foreground lg:block">{p.summary}</span>}
            </span>
          </div>
          <span className="hidden min-w-0 items-center gap-2 md:flex">
            <span className="flex shrink-0 -space-x-0.5">
              {courses.slice(0, 3).map(c => (
                <Tip key={c.id} label={c.title}>
                  <span className="rounded-[6px] ring-2 ring-background">
                    <CourseGlyph icon={c.icon} color={c.color} size={18} />
                  </span>
                </Tip>
              ))}
            </span>
            <span className={cn('truncate text-sm tabular-nums', drafts ? 'text-tone-warning' : 'text-muted-foreground')} title={drafts ? `${plural(drafts, 'course isn’t', 'courses aren’t')} published` : undefined}>
              {plural(courses.length, 'course')}
              {minutes ? ` · ${formatDuration(minutes * 60)}` : ''}
            </span>
          </span>
          <span className="hidden text-right tabular-nums md:block">{p.counts.enrolled || <span className="text-muted-foreground/60">—</span>}</span>
          <MiniBar value={completion} className="hidden md:flex" />
          <span className={cn('hidden text-right tabular-nums md:block', p.counts.overdue ? 'font-medium text-tone-danger' : 'text-muted-foreground/60')}>{p.counts.overdue || '—'}</span>
          <span className="hidden items-center gap-1.5 text-sm text-muted-foreground md:flex">
            {p.sequential ? <Lock className="h-3 w-3 shrink-0" /> : <Shuffle className="h-3 w-3 shrink-0" />} {p.sequential ? 'In order' : 'Any order'}
          </span>
          <span className="hidden md:block">{owner && <Tip label={`Owner: ${owner.name}`}><span className="inline-flex"><PersonAvatar person={owner} size={18} /></span></Tip>}</span>
          <div className="flex items-center justify-end gap-2">
            <span className="text-sm tabular-nums text-muted-foreground md:hidden">{p.counts.overdue ? <span className="text-tone-danger">{p.counts.overdue} overdue</span> : plural(courses.length, 'course')}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" aria-label={`Actions for ${p.title}`} className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <PathMenuItems path={p} kind="dropdown" onPublish={onPublish} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <PathMenuItems path={p} kind="context" onPublish={onPublish} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
