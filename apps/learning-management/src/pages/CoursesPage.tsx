import { Archive, ArchiveRestore, BookOpen, Check, ChevronRight, Copy, Filter, LayoutGrid, Link2, List, MoreHorizontal, Plus, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { saveCourse } from 'zitejs/api';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@project/components/ui/context-menu';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@project/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { CourseMenuItems, PublishCourseDialog, useCourseLifecycle } from '../components/courses/CourseActions';
import { completionOf, CourseCover, learnerUrl, MiniBar, QueryTabs, SearchField, StatusPill } from '../components/courses/CourseBits';
import { useRefreshCourse } from '../components/courses/courseData';
import { useListKeys, useStoredState } from '../components/courses/useListKeys';
import { PersonAvatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, Kbd, Tip } from '../components/primitives/bits';
import { CourseGlyph, Stars } from '../components/primitives/icons';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { LEVELS } from '../lib/constants';
import { errorMessage } from '../lib/errors';
import { formatDuration, formatMinutes, plural, timeAgo } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import type { Course } from '../lib/types';
import { useWorkspace, type Workspace } from '../lib/workspace';

type TabKey = 'published' | 'drafts' | 'archived' | 'all';
type Ordering = 'manual' | 'title' | 'enrolled' | 'overdue' | 'completion' | 'updated';
type Filters = { categoryIds: string[]; ownerIds: string[]; levels: string[]; overdue: boolean };

const TABS: Array<{ key: TabKey; label: string; match: (c: Course) => boolean }> = [
  { key: 'published', label: 'Published', match: c => c.status === 'Published' },
  { key: 'drafts', label: 'Drafts', match: c => c.status === 'Draft' },
  { key: 'archived', label: 'Archived', match: c => c.status === 'Archived' },
  { key: 'all', label: 'All', match: () => true },
];

const EMPTY: Record<TabKey, { title: string; description: string }> = {
  published: { title: 'No published courses', description: 'Publish a draft to put it in the catalog and make it assignable.' },
  drafts: { title: 'No drafts', description: 'New courses start here, visible only to staff until you publish them.' },
  archived: { title: 'Nothing archived', description: 'Archive courses you no longer run. Their learners, certificates and history are kept.' },
  all: { title: 'No courses yet', description: 'Create a course to start building your academy.' },
};

const ORDERINGS: Array<{ value: Ordering; label: string }> = [
  { value: 'manual', label: 'Default' },
  { value: 'title', label: 'Title' },
  { value: 'enrolled', label: 'Most enrolled' },
  { value: 'overdue', label: 'Most overdue' },
  { value: 'completion', label: 'Lowest completion' },
  { value: 'updated', label: 'Recently updated' },
];

const NO_FILTERS: Filters = { categoryIds: [], ownerIds: [], levels: [], overdue: false };

function readFilters(): Filters {
  try {
    return { ...NO_FILTERS, ...JSON.parse(sessionStorage.getItem('lms:courses:filters') ?? '{}') };
  } catch {
    return NO_FILTERS;
  }
}

function sortCourses(list: Course[], ordering: Ordering) {
  const out = [...list];
  switch (ordering) {
    case 'title':
      return out.sort((a, b) => a.title.localeCompare(b.title));
    case 'enrolled':
      return out.sort((a, b) => b.counts.enrolled - a.counts.enrolled);
    case 'overdue':
      return out.sort((a, b) => b.counts.overdue - a.counts.overdue || b.counts.enrolled - a.counts.enrolled);
    case 'completion':
      return out.sort((a, b) => (completionOf(a) ?? 101) - (completionOf(b) ?? 101));
    case 'updated':
      return out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    default:
      return out;
  }
}

function groupCourses(list: Course[], ws: Workspace, byCategory: boolean) {
  if (!byCategory) return [{ key: 'all', label: '', icon: '', rows: list }];
  const groups = ws.categories.map(cat => ({ key: cat.id, label: cat.name, icon: cat.icon, rows: list.filter(c => c.categoryId === cat.id) }));
  const none = list.filter(c => !c.categoryId || !ws.categoryById.has(c.categoryId));
  return [...groups, { key: 'none', label: 'No category', icon: '', rows: none }].filter(g => g.rows.length);
}

export function CoursesPage() {
  useDocumentTitle('Courses');
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [layout, setLayout] = useStoredState<'list' | 'grid'>('lms:courses:layout', 'list');
  const [byCategory, setByCategory] = useStoredState('lms:courses:group', false);
  const [ordering, setOrdering] = useStoredState<Ordering>('lms:courses:ordering', 'manual');
  const [filters, setFiltersState] = useState<Filters>(readFilters);
  const [q, setQ] = useState('');
  const [publishing, setPublishing] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const life = useCourseLifecycle();

  const setFilters = (f: Filters) => {
    setFiltersState(f);
    try {
      sessionStorage.setItem('lms:courses:filters', JSON.stringify(f));
    } catch {
      /* ignore */
    }
  };

  const tab = TABS.find(t => t.key === params.get('tab')) ?? TABS[0];
  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params);
    if (key === 'published') next.delete('tab');
    else next.set('tab', key);
    setParams(next, { replace: true });
  };
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, ws.courses.filter(t.match).length])) as Record<TabKey, number>, [ws.courses]);

  const activeFilters = filters.categoryIds.length + filters.ownerIds.length + filters.levels.length + (filters.overdue ? 1 : 0);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = ws.orderedCourses.filter(c => {
      if (!tab.match(c)) return false;
      if (filters.categoryIds.length && !filters.categoryIds.includes(c.categoryId ?? '')) return false;
      if (filters.ownerIds.length && !filters.ownerIds.includes(c.ownerId ?? '')) return false;
      if (filters.levels.length && !filters.levels.includes(c.level)) return false;
      if (filters.overdue && c.counts.overdue === 0) return false;
      if (needle) {
        const hay = `${c.title} ${c.summary} ${ws.categoryById.get(c.categoryId ?? '')?.name ?? ''} ${c.skills.join(' ')}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return sortCourses(list, ordering);
  }, [ws, tab, filters, q, ordering]);

  const groups = useMemo(() => groupCourses(visible, ws, byCategory), [visible, ws, byCategory]);
  const ids = useMemo(() => groups.flatMap(g => (collapsed.has(g.key) ? [] : g.rows.map(r => r.id))), [groups, collapsed]);
  const list = useListKeys({
    ids,
    scrollRef,
    onOpen: id => navigate(`/courses/${id}`),
    extra: {
      e: id => {
        const c = id ? ws.courseById.get(id) : undefined;
        if (c?.status === 'Published') app.openEnroll({ targetType: 'Course', targetId: c.id });
      },
    },
  });

  useHotkeys({
    '/': () => window.setTimeout(() => searchRef.current?.focus(), 0),
    '1': () => setTab('published'),
    '2': () => setTab('drafts'),
    '3': () => setTab('archived'),
    '4': () => setTab('all'),
  });
  useEffect(() => list.clear(), [tab.key]);

  const selected = visible.filter(c => list.selection.has(c.id));
  const fresh = ws.courses.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<BookOpen />}
        title="Courses"
        actions={
          <button type="button" onClick={app.openCreateCourse} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 sm:px-2.5">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New course</span>
          </button>
        }
      >
        {!fresh && <QueryTabs label="Filter courses by status" value={tab.key} onChange={setTab} tabs={TABS.map((t, i) => ({ key: t.key, label: t.label, count: counts[t.key], tip: `${t.label} courses`, keys: [String(i + 1)] }))} />}
      </PageHeader>

      {!fresh && (
        <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
          <FilterMenu filters={filters} onChange={setFilters} />
          <FilterChips filters={filters} onChange={setFilters} />
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <SearchField ref={searchRef} value={q} onChange={setQ} placeholder="Search courses…" className="w-40 sm:w-56" />
            <div className="flex h-8 items-center rounded-md border bg-background p-0.5" role="radiogroup" aria-label="Layout">
              {([['list', <List key="l" />, 'List'], ['grid', <LayoutGrid key="g" />, 'Grid']] as const).map(([value, icon, label]) => (
                <Tip key={value} label={`${label} layout`}>
                  <button type="button" role="radio" aria-checked={layout === value} aria-label={`${label} layout`} onClick={() => setLayout(value)} className={cn('flex h-full w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5', layout === value ? 'bg-accent text-foreground shadow-2xs' : 'hover:text-foreground')}>
                    {icon}
                  </button>
                </Tip>
              ))}
            </div>
            <DisplayMenu byCategory={byCategory} onByCategory={setByCategory} ordering={ordering} onOrdering={setOrdering} />
          </div>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {fresh ? (
          <EmptyState
            className="py-24"
            icon={<BookOpen />}
            title="Create your first course"
            description="A course is a sequence of lessons — articles, videos, quizzes, assignments and live sessions — that people complete for a certificate."
            action={
              <button type="button" onClick={app.openCreateCourse} className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                <Plus className="h-3.5 w-3.5" /> New course
              </button>
            }
          />
        ) : visible.length === 0 ? (
          activeFilters || q ? (
            <EmptyState
              icon={<Filter />}
              title="No courses match"
              description={q ? `Nothing in ${tab.label.toLowerCase()} matches “${q}”${activeFilters ? ' with these filters' : ''}.` : 'Try removing a filter or switching tabs.'}
              action={
                <button type="button" onClick={() => { setFilters(NO_FILTERS); setQ(''); }} className="text-[14px] text-primary hover:underline">
                  Clear filters and search
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={tab.key === 'archived' ? <Archive /> : tab.key === 'drafts' ? <Sparkles /> : <BookOpen />}
              title={EMPTY[tab.key].title}
              description={EMPTY[tab.key].description}
              action={tab.key !== 'archived' ? <button type="button" onClick={app.openCreateCourse} className="text-[14px] text-primary hover:underline">New course</button> : undefined}
            />
          )
        ) : layout === 'grid' ? (
          <div className="p-3 sm:p-4">
            {groups.map(g => (
              <section key={g.key} className="mb-5 last:mb-0">
                {byCategory && (
                  <h2 className="mb-2 flex items-center gap-2 px-1 text-[14px] font-medium">
                    {g.icon && <span className="text-[14px] leading-none">{g.icon}</span>}
                    {g.label}
                    <span className="text-sm tabular-nums text-muted-foreground">{g.rows.length}</span>
                  </h2>
                )}
                {/* Never a half-empty row of columns: one course lies across the width, two or three share it. */}
                <div className={cn('grid grid-cols-1 gap-3', g.rows.length === 2 ? 'sm:grid-cols-2' : g.rows.length === 3 ? 'md:grid-cols-3' : g.rows.length > 3 && 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4')}>
                  {g.rows.map(c => (
                    <CourseCard key={c.id} course={c} wide={g.rows.length === 1} focused={list.focusedId === c.id} selected={list.selection.has(c.id)} onPublish={setPublishing} onClick={e => list.onRowClick(c.id, e)} onHover={() => list.setFocusedId(c.id)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div role="grid" aria-label="Courses">
            <div className="sticky top-0 z-[2] hidden h-9 items-center gap-3 border-b bg-subtle/95 px-4 text-sm text-muted-foreground backdrop-blur md:grid md:grid-cols-[minmax(0,1fr)_112px_64px_128px_64px_92px_44px_28px]">
              <span className="pl-[56px]">Course</span>
              <span>Length</span>
              <span className="text-right">Enrolled</span>
              <span>Completion</span>
              <span className="text-right">Overdue</span>
              <span>Rating</span>
              <span>Owner</span>
              <span />
            </div>
            {groups.map(g => {
              const isCollapsed = collapsed.has(g.key);
              return (
                <div key={g.key}>
                  {byCategory && (
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      onClick={() => setCollapsed(prev => { const next = new Set(prev); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; })}
                      className="sticky top-0 z-[1] flex h-9 w-full items-center gap-2 border-b bg-subtle px-4 text-left text-[14px] md:top-8"
                    >
                      <ChevronRight className={cn('h-3 w-3 text-muted-foreground transition-transform', !isCollapsed && 'rotate-90')} />
                      {g.icon && <span className="text-[14px] leading-none">{g.icon}</span>}
                      <span className="font-medium">{g.label}</span>
                      <span className="text-sm tabular-nums text-muted-foreground">{g.rows.length}</span>
                    </button>
                  )}
                  {!isCollapsed && g.rows.map(c => <CourseRow key={c.id} course={c} showStatus={tab.key !== 'published'} focused={list.focusedId === c.id} selected={list.selection.has(c.id)} selecting={list.selection.size > 0} onToggle={e => list.toggle(c.id, e)} onPublish={setPublishing} onClick={e => list.onRowClick(c.id, e)} onHover={() => list.setFocusedId(c.id)} />)}
                </div>
              );
            })}
            <div className="hidden items-center gap-3 px-4 py-3 text-2xs text-muted-foreground md:flex">
              <span className="flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> move</span>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
              <span className="flex items-center gap-1"><Kbd>X</Kbd> select</span>
              <span className="flex items-center gap-1"><Kbd>E</Kbd> enroll</span>
              <span className="flex items-center gap-1"><Kbd>/</Kbd> search</span>
            </div>
          </div>
        )}
      </div>
        <BulkBar courses={selected} onClear={list.clear} life={life} />
      </div>
      <PublishCourseDialog courseId={publishing} onOpenChange={o => !o && setPublishing(null)} />
    </div>
  );
}

function RowMenuButton({ course, onPublish }: { course: Course; onPublish: (id: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" aria-label={`Actions for ${course.title}`} className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <CourseMenuItems course={course} kind="dropdown" onPublish={onPublish} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CourseRow({ course: c, showStatus, focused, selected, selecting, onToggle, onPublish, onClick, onHover }: {
  course: Course;
  showStatus: boolean;
  focused: boolean;
  selected: boolean;
  selecting: boolean;
  onToggle: (e: MouseEvent) => void;
  onPublish: (id: string) => void;
  onClick: (e: MouseEvent) => void;
  onHover: () => void;
}) {
  const ws = useWorkspace();
  const category = c.categoryId ? ws.categoryById.get(c.categoryId) : undefined;
  const owner = c.ownerId ? ws.staffById.get(c.ownerId) : undefined;
  const completion = completionOf(c);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-row-id={c.id}
          role="row"
          aria-selected={selected}
          onClick={onClick}
          onMouseEnter={onHover}
          className={cn(
            'group relative grid h-10 cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 text-[14px] transition-colors md:grid-cols-[minmax(0,1fr)_112px_64px_128px_64px_92px_44px_28px]',
            selected ? 'bg-primary/[0.06]' : focused ? 'bg-accent/60' : 'hover:bg-accent/40',
          )}
        >
          {focused && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />}
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={`Select ${c.title}`}
              onClick={e => {
                e.stopPropagation();
                onToggle(e);
              }}
              className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-opacity', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background', selected || selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
            >
              {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            </button>
            <CourseGlyph icon={c.icon} color={c.color} size={20} />
            <span className="min-w-0 truncate font-medium">{c.title}</span>
            {showStatus && c.status !== 'Published' && <StatusPill status={c.status} />}
            {category && (
              <span className="hidden min-w-0 shrink items-center gap-1 truncate rounded-full border px-2 text-2xs leading-[20px] text-muted-foreground lg:inline-flex">
                <span className="leading-none">{category.icon}</span>
                <span className="truncate">{category.name}</span>
              </span>
            )}
          </div>
          <span className="hidden truncate text-sm tabular-nums text-muted-foreground md:block">
            {plural(c.lessonCount, 'lesson')}
            {c.estimatedMinutes > 0 && ` · ${formatDuration(c.estimatedMinutes * 60)}`}
          </span>
          <span className="hidden text-right tabular-nums md:block">{c.counts.enrolled || <span className="text-muted-foreground/60">—</span>}</span>
          <MiniBar value={completion} className="hidden md:flex" />
          <span className={cn('hidden text-right tabular-nums md:block', c.counts.overdue ? 'font-medium text-tone-danger' : 'text-muted-foreground/60')}>{c.counts.overdue || '—'}</span>
          <span className="hidden items-center gap-1.5 md:flex">
            {c.rating.average ? (
              <Tip label={`${c.rating.average.toFixed(1)} from ${plural(c.rating.count, 'rating')}`}>
                <span className="flex items-center gap-1.5">
                  <Stars value={c.rating.average} size={10} />
                  <span className="text-sm tabular-nums text-muted-foreground">{c.rating.average.toFixed(1)}</span>
                </span>
              </Tip>
            ) : (
              <span className="text-sm text-muted-foreground/60">—</span>
            )}
          </span>
          <span className="hidden md:block">
            {owner && (
              <Tip label={`Owner: ${owner.name}`}>
                <span className="inline-flex">
                  <PersonAvatar person={owner} size={18} />
                </span>
              </Tip>
            )}
          </span>
          <div className="flex items-center justify-end gap-2">
            <span className="text-sm tabular-nums text-muted-foreground md:hidden">
              {c.counts.overdue > 0 ? <span className="text-tone-danger">{c.counts.overdue} overdue</span> : completion != null ? `${completion}% complete` : plural(c.lessonCount, 'lesson')}
            </span>
            <RowMenuButton course={c} onPublish={onPublish} />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <CourseMenuItems course={c} kind="context" onPublish={onPublish} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CourseCard({ course: c, wide, focused, selected, onPublish, onClick, onHover }: { course: Course; wide: boolean; focused: boolean; selected: boolean; onPublish: (id: string) => void; onClick: (e: MouseEvent) => void; onHover: () => void }) {
  const ws = useWorkspace();
  const category = c.categoryId ? ws.categoryById.get(c.categoryId) : undefined;
  const owner = c.ownerId ? ws.staffById.get(c.ownerId) : undefined;
  const completion = completionOf(c);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-row-id={c.id}
          onClick={onClick}
          onMouseEnter={onHover}
          className={cn(
            'group relative flex min-w-0 cursor-default flex-col overflow-hidden rounded-xl border bg-card shadow-2xs transition-[border-color,box-shadow]',
            wide && 'sm:flex-row',
            selected ? 'border-primary/60 ring-1 ring-primary/40' : focused ? 'border-foreground/25 shadow-sm' : 'hover:border-foreground/20 hover:shadow-sm',
          )}
        >
          <div className={cn('relative', wide && 'sm:w-[340px] sm:shrink-0')}>
            <CourseCover coverImageUrl={c.coverImageUrl} title={c.title} color={c.color} className={wide ? 'sm:aspect-auto sm:h-full sm:min-h-[191px]' : undefined} />
            {c.status !== 'Published' && <StatusPill status={c.status} className="absolute left-2.5 top-2.5 bg-background/90 shadow-xs backdrop-blur" />}
            {!wide && (
              <div className="absolute right-2 top-2 rounded-md bg-background/85 opacity-0 shadow-xs backdrop-blur transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100 [@media(pointer:coarse)]:opacity-100">
                <RowMenuButton course={c} onPublish={onPublish} />
              </div>
            )}
          </div>
          <div className={cn('flex min-w-0 flex-1 flex-col p-3.5', wide && 'sm:px-5 sm:py-4')}>
            <div className="flex items-start gap-2">
              <h3 className="line-clamp-2 min-w-0 flex-1 text-[15px] font-medium leading-5">{c.title}</h3>
              {wide && <RowMenuButton course={c} onPublish={onPublish} />}
            </div>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {[category ? `${category.icon} ${category.name}` : null, c.level, plural(c.lessonCount, 'lesson'), c.estimatedMinutes ? formatMinutes(c.estimatedMinutes) : null].filter(Boolean).join(' · ')}
            </div>
            <p className={cn('mt-2 line-clamp-2 min-h-[36px] text-[13.5px] leading-[20px] text-muted-foreground', wide && 'sm:mb-4 sm:max-w-[640px]')}>{c.summary || 'No summary yet.'}</p>
            <div className={cn('mt-3 grid grid-cols-3 gap-2 border-t pt-3', wide && 'sm:mt-auto sm:max-w-md')}>
              <Metric label="Enrolled" value={c.counts.enrolled} />
              <div className="min-w-0">
                <div className="text-[16px] font-medium leading-5 tabular-nums">{completion == null ? '—' : `${completion}%`}</div>
                <div className="truncate text-2xs text-muted-foreground">Completion</div>
              </div>
              <Metric label="Overdue" value={c.counts.overdue} danger />
            </div>
            <div className="mt-3 flex items-center gap-2">
              {c.rating.average ? (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Stars value={c.rating.average} size={11} /> <span className="tabular-nums">{c.rating.average.toFixed(1)}</span>
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">No ratings yet</span>
              )}
              <span className="ml-auto flex items-center gap-1.5 text-2xs text-muted-foreground">
                {c.updatedAt && <span className="hidden sm:inline">Updated {timeAgo(c.updatedAt)}</span>}
                {owner && <PersonAvatar person={owner} size={18} />}
              </span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <CourseMenuItems course={c} kind="context" onPublish={onPublish} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function Metric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={cn('text-[16px] font-medium leading-5 tabular-nums', danger && value > 0 && 'text-tone-danger', !value && 'text-muted-foreground')}>{value.toLocaleString()}</div>
      <div className="truncate text-2xs text-muted-foreground">{label}</div>
    </div>
  );
}

function FilterMenu({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const ws = useWorkspace();
  const owners = ws.activeStaff.filter(s => ws.courses.some(c => c.ownerId === s.id));
  const toggle = (key: 'categoryIds' | 'ownerIds' | 'levels', v: string) => onChange({ ...filters, [key]: filters[key].includes(v) ? filters[key].filter(x => x !== v) : [...filters[key], v] });
  const n = filters.categoryIds.length + filters.ownerIds.length + filters.levels.length + (filters.overdue ? 1 : 0);
  const item = 'text-[14px]';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('ghost-chip h-8 text-[13.5px] text-muted-foreground hover:text-foreground', n > 0 && 'text-foreground')}>
          <Filter className="h-3.5 w-3.5" /> Filter
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={item}>Category</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            {ws.categories.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No categories yet</div>}
            {ws.categories.map(cat => (
              <DropdownMenuCheckboxItem key={cat.id} className={item} checked={filters.categoryIds.includes(cat.id)} onSelect={e => e.preventDefault()} onCheckedChange={() => toggle('categoryIds', cat.id)}>
                <span className="mr-1.5 leading-none">{cat.icon || '•'}</span> {cat.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={item}>Owner</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            {owners.map(s => (
              <DropdownMenuCheckboxItem key={s.id} className={item} checked={filters.ownerIds.includes(s.id)} onSelect={e => e.preventDefault()} onCheckedChange={() => toggle('ownerIds', s.id)}>
                <PersonAvatar person={s} size={16} className="mr-1.5" /> {s.id === ws.me.id ? `${s.name} (you)` : s.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={item}>Level</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {LEVELS.map(l => (
              <DropdownMenuCheckboxItem key={l} className={item} checked={filters.levels.includes(l)} onSelect={e => e.preventDefault()} onCheckedChange={() => toggle('levels', l)}>
                {l}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem className={item} checked={filters.overdue} onCheckedChange={v => onChange({ ...filters, overdue: Boolean(v) })}>
          Has overdue learners
        </DropdownMenuCheckboxItem>
        {n > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="p-0">
              <button type="button" onClick={() => onChange(NO_FILTERS)} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-[13.5px] font-normal text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-3.5 w-3.5" /> Clear filters
              </button>
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterChips({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const ws = useWorkspace();
  const chips: Array<{ key: string; label: string; remove: () => void }> = [];
  if (filters.categoryIds.length) chips.push({ key: 'cat', label: `Category: ${filters.categoryIds.map(id => ws.categoryById.get(id)?.name ?? 'Unknown').join(', ')}`, remove: () => onChange({ ...filters, categoryIds: [] }) });
  if (filters.ownerIds.length) chips.push({ key: 'owner', label: `Owner: ${filters.ownerIds.map(id => ws.staffById.get(id)?.name.split(' ')[0] ?? 'Unknown').join(', ')}`, remove: () => onChange({ ...filters, ownerIds: [] }) });
  if (filters.levels.length) chips.push({ key: 'level', label: `Level: ${filters.levels.join(', ')}`, remove: () => onChange({ ...filters, levels: [] }) });
  if (filters.overdue) chips.push({ key: 'overdue', label: 'Has overdue learners', remove: () => onChange({ ...filters, overdue: false }) });
  return (
    <>
      {chips.map(c => (
        <span key={c.key} className="chip h-8 max-w-[260px] rounded-md bg-background pr-1 text-[13.5px] shadow-2xs">
          <span className="truncate">{c.label}</span>
          <button type="button" onClick={c.remove} aria-label={`Remove filter ${c.label}`} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </>
  );
}

function DisplayMenu({ byCategory, onByCategory, ordering, onOrdering }: { byCategory: boolean; onByCategory: (v: boolean) => void; ordering: Ordering; onOrdering: (o: Ordering) => void }) {
  const dirty = byCategory || ordering !== 'manual';
  return (
    <Popover>
      <Tip label="Display options">
        <PopoverTrigger asChild>
          <IconButton aria-label="Display options" active={dirty}>
            <SlidersHorizontal />
          </IconButton>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-64 space-y-3 p-3 shadow-lg">
        <label className="flex items-center justify-between gap-3 text-[14px]">
          <span className="text-muted-foreground">Group by category</span>
          <Switch checked={byCategory} onCheckedChange={onByCategory} />
        </label>
        <div className="flex items-center justify-between gap-3 text-[14px]">
          <span className="text-muted-foreground">Ordering</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="h-8 min-w-[130px] rounded-md border bg-background px-2 text-left text-[14px] shadow-2xs hover:bg-accent">
                {ORDERINGS.find(o => o.value === ordering)?.label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={ordering} onValueChange={v => onOrdering(v as Ordering)}>
                {ORDERINGS.map(o => (
                  <DropdownMenuRadioItem key={o.value} value={o.value} className="text-[14px]">
                    {o.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BulkBar({ courses, onClear, life }: { courses: Course[]; onClear: () => void; life: ReturnType<typeof useCourseLifecycle> }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const refresh = useRefreshCourse();
  const [busy, setBusy] = useState(false);
  if (!courses.length) return null;
  const editable = courses.filter(c => c.canEdit);
  const archivable = editable.filter(c => c.status !== 'Archived');
  const restorable = editable.filter(c => c.status === 'Archived');
  const links = courses.map(c => learnerUrl(ws.settings.learnUrl, 'courses', c.slug)).filter(Boolean) as string[];

  const bulk = async (targets: Course[], action: 'archive' | 'unarchive') => {
    if (action === 'archive') {
      const ok = await app.confirm({
        title: `Archive ${plural(targets.length, 'course')}?`,
        description: 'They’re hidden from the catalog and lists, and nobody new can enroll. Learners keep their progress and certificates, and active assignment rules for them are paused.',
        confirmLabel: 'Archive',
      });
      if (!ok) return;
    }
    setBusy(true);
    const id = toast.loading(`${action === 'archive' ? 'Archiving' : 'Unarchiving'} ${plural(targets.length, 'course')}…`);
    let done = 0;
    let failed = '';
    for (const c of targets) {
      try {
        await saveCourse({ action, id: c.id });
        done++;
      } catch (e) {
        failed = errorMessage(e, `Couldn't ${action} ${c.title}`);
      }
    }
    refresh(null);
    setBusy(false);
    onClear();
    if (failed) toast.error(done ? `${action === 'archive' ? 'Archived' : 'Unarchived'} ${done} · ${failed}` : failed, { id });
    else toast.success(`${action === 'archive' ? 'Archived' : 'Unarchived'} ${plural(done, 'course')}`, { id });
  };

  const btn = 'ghost-chip h-9 gap-1.5 px-2.5 text-[14px] text-foreground/90 hover:text-foreground disabled:opacity-50';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div role="toolbar" aria-label="Bulk actions" className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border bg-popover p-1 shadow-xl animate-fade-up">
        <div className="flex h-9 items-center gap-2 border-r pl-2.5 pr-2">
          <span className="whitespace-nowrap text-[14px] font-medium tabular-nums">{courses.length} selected</span>
          <button type="button" onClick={onClear} aria-label="Clear selection" className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {links.length > 0 && (
          <button type="button" className={btn} onClick={() => copyText(links.join('\n'), links.length === 1 ? 'Learner link copied' : `${links.length} learner links copied`)}>
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Copy links</span>
          </button>
        )}
        {archivable.length > 0 && (
          <button type="button" disabled={busy} className={btn} onClick={() => bulk(archivable, 'archive')}>
            <Archive className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Archive{archivable.length !== courses.length ? ` ${archivable.length}` : ''}</span>
          </button>
        )}
        {restorable.length > 0 && (
          <button type="button" disabled={busy} className={btn} onClick={() => bulk(restorable, 'unarchive')}>
            <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Unarchive{restorable.length !== courses.length ? ` ${restorable.length}` : ''}</span>
          </button>
        )}
        {courses.length === 1 && (
          <button type="button" className={btn} onClick={() => life.duplicate(courses[0])}>
            <Copy className="h-3.5 w-3.5 text-muted-foreground" /> <span className="hidden sm:inline">Duplicate</span>
          </button>
        )}
        <span className="hidden items-center gap-1 border-l px-2 text-2xs text-muted-foreground md:flex">
          <Kbd>Esc</Kbd> to clear
        </span>
      </div>
    </div>
  );
}
