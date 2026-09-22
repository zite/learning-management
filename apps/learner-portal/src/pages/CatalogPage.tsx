import { Search, SearchX, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { CatalogCourseCard, CatalogPathCard } from '../components/catalog/CatalogCards';
import { FilterMenu } from '../components/catalog/FilterMenu';
import { Chip, LoadError, PageHeader, useDebounced } from '../components/kit';
import { Button, Container, EmptyState, SectionHeading, Skeleton, inputClass } from '../components/ui';
import { plural } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useCatalog, type CatalogFilters } from '../lib/learn';
import { useMe } from '../lib/queries';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;
const DURATIONS = [
  { value: 'short', label: 'Under 30 min' },
  { value: 'medium', label: '30–60 min' },
  { value: 'long', label: 'Over an hour' },
] as const;
const KINDS = [
  { value: 'course', label: 'Courses only' },
  { value: 'path', label: 'Paths only' },
] as const;

type Level = (typeof LEVELS)[number];
type Duration = (typeof DURATIONS)[number]['value'];
type Kind = (typeof KINDS)[number]['value'];

export function CatalogPage() {
  useDocumentTitle('Catalog');
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const search = useDebounced(text.trim(), 200);
  const inputRef = useRef<HTMLInputElement>(null);
  useHotkeys({
    '/': () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  });

  const categoryId = params.get('category') || null;
  const level = (LEVELS as readonly string[]).includes(params.get('level') ?? '') ? (params.get('level') as Level) : null;
  const duration = DURATIONS.some(d => d.value === params.get('duration')) ? (params.get('duration') as Duration) : null;
  const kind = KINDS.some(k => k.value === params.get('kind')) ? (params.get('kind') as Kind) : null;

  const filters: CatalogFilters = { q: search || undefined, categoryId, level, duration, kind };
  const q = useCatalog(filters);

  const setParam = (key: string, value: string | null) =>
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        // Paths have no level or length, so those filters would hide every path.
        if (key === 'kind' && value === 'path') {
          next.delete('level');
          next.delete('duration');
        }
        return next;
      },
      { replace: true },
    );
  const onText = (v: string) => {
    setText(v);
    setParam('q', v.trim() || null);
  };
  const clearAll = () => {
    setText('');
    setParams(new URLSearchParams(), { replace: true });
    // Keep keyboard users in the search; on touch screens that would pop the keyboard open.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  };
  const filtered = Boolean(search || categoryId || level || duration || kind);
  const selfEnrollment = q.data?.selfEnrollment ?? me.data?.features.selfEnrollment ?? true;
  const academy = me.data?.settings.academyName;
  // Level and length describe courses; a path has neither.
  const courseOnly = kind === 'path' ? 'Levels and lengths apply to courses. Choose “Courses and paths” to use them.' : null;

  return (
    <div>
      <PageHeader
        title="Catalog"
        description={
          selfEnrollment
            ? 'Courses and learning paths you can start whenever suits you. Enroll in a click and pick up on any device.'
            : `Everything ${academy ?? 'your academy'} offers. Your team assigns training here, so ask your manager or the learning team if something would help you.`
        }
      >
        <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label htmlFor="catalog-search" className="sr-only">
              Search the catalog
            </label>
            <input
              id="catalog-search"
              ref={inputRef}
              type="search"
              value={text}
              onChange={e => onText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  if (text) onText('');
                  else e.currentTarget.blur();
                }
              }}
              placeholder="Search courses, paths and skills"
              className={inputClass('h-12 pl-11 pr-12 text-base [&::-webkit-search-cancel-button]:hidden')}
              autoComplete="off"
              enterKeyHint="search"
            />
            {text ? (
              <button type="button" onClick={() => onText('')} className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="kbd pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 sm:inline-flex" title="Press / to search">
                /
              </kbd>
            )}
          </div>
          <div role="group" aria-label="Filters" className="flex flex-wrap gap-2 md:flex-nowrap">
            <FilterMenu name="Level" anyLabel="Any level" value={level} options={LEVELS.map(l => ({ value: l, label: l }))} onChange={v => setParam('level', v)} disabledReason={courseOnly} />
            <FilterMenu name="Length" anyLabel="Any length" value={duration} options={[...DURATIONS]} onChange={v => setParam('duration', v)} disabledReason={courseOnly} />
            <FilterMenu name="Type" anyLabel="Courses and paths" value={kind} options={[...KINDS]} onChange={v => setParam('kind', v)} />
            {filtered && (
              <Button variant="ghost" onClick={clearAll} className="h-10 shrink-0 px-3 text-sm text-muted-foreground hover:text-foreground sm:h-12" aria-label="Clear search and filters">
                Clear
              </Button>
            )}
          </div>
        </div>
        {q.data && (q.data.categories.length > 1 || categoryId) && (
          <div role="group" aria-label="Filter by topic" className="scrollbar-none -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            <Chip active={!categoryId} onClick={() => setParam('category', null)}>
              All topics
            </Chip>
            {q.data.categories.map(c => {
              const active = categoryId === c.id;
              return (
                <Chip key={c.id} active={active} onClick={() => setParam('category', active ? null : c.id)} aria-label={`${c.name}, ${plural(c.count, 'item')}`}>
                  {c.name}
                  <span className={cn('tabular-nums', active ? 'text-background/70' : 'text-faint')} aria-hidden>
                    {c.count}
                  </span>
                </Chip>
              );
            })}
          </div>
        )}
      </PageHeader>

      <Container className="py-8 sm:py-10">
        {q.isPending ? (
          <CatalogSkeleton />
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} title="The catalog didn't load" />
        ) : (
          <div className={cn('transition-opacity', q.isPlaceholderData && 'opacity-60')} aria-busy={q.isPlaceholderData || undefined}>
            <p className="sr-only" aria-live="polite">
              {q.isPlaceholderData ? '' : plural(q.data.total, 'result')}
            </p>
            {q.data.total === 0 ? (
              <EmptyState icon={SearchX} title={filtered ? (search ? `Nothing matches “${search}”` : 'Nothing matches these filters') : 'Nothing in the catalog yet'} action={filtered ? <Button variant="secondary" onClick={clearAll}>Clear search and filters</Button> : undefined}>
                {filtered ? 'Try another word, or remove a filter.' : 'Courses appear here as soon as they’re published.'}
              </EmptyState>
            ) : (
              <div className="space-y-12">
                {q.data.paths.length > 0 && (
                  <section aria-labelledby="catalog-paths">
                    <SectionHeading id="catalog-paths" count={q.data.paths.length}>
                      Learning paths
                    </SectionHeading>
                    <ul className="space-y-4">
                      {q.data.paths.map(p => (
                        <li key={p.id}>
                          <CatalogPathCard path={p} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {q.data.courses.length > 0 && (
                  <section aria-labelledby="catalog-courses">
                    <SectionHeading id="catalog-courses" count={q.data.courses.length}>
                      Courses
                    </SectionHeading>
                    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {q.data.courses.map(c => (
                        <li key={c.id} className="flex">
                          <CatalogCourseCard course={c} mine={c.mine} className="w-full" />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>
        )}
      </Container>
    </div>
  );
}

function CatalogSkeleton() {
  return (
    <div className="space-y-12" role="status" aria-label="Loading the catalog">
      <div>
        <Skeleton className="mb-4 h-7 w-44" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
      <div>
        <Skeleton className="mb-4 h-7 w-28" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[340px] rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
