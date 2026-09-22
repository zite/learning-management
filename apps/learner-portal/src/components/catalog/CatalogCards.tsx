import { Award, Check, Clock, Layers, ListOrdered } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { formatMinutes } from '@project/shared/lessons';
import type { CatalogCourse, CatalogPath, CourseCardData } from '../../lib/learn';
import { plural } from '../../lib/format';
import { CourseCover, RatingText } from '../kit';

/**
 * Catalog cards. Every card in a row has the same body — eyebrow, title,
 * summary, and a meta line pinned to the bottom — so the meta lines align
 * across the row. Where the learner stands is drawn on the cover (a badge and,
 * while in progress, a thin bar along its bottom edge) so it never changes the
 * height of the text below.
 */

type Mine = { status: string; progress: number } | null | undefined;

const cardShell =
  'group relative flex overflow-hidden rounded-xl border bg-card shadow-xs transition-[box-shadow,border-color] duration-200 hover:border-foreground/20 hover:shadow-md focus-within:border-foreground/20';

const titleLink = 'decoration-foreground/30 underline-offset-4 after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-[3px] focus-visible:after:ring-ring/35 group-hover:underline';

/** "Completed", "33% done" or "Enrolled", on the cover's top-left corner. */
function StatusBadge({ mine }: { mine: Mine }) {
  if (!mine) return null;
  const done = mine.status === 'Completed';
  return (
    <span className="absolute left-3 top-3 inline-flex h-7 items-center gap-1.5 rounded-full bg-background/95 px-2.5 text-xs font-semibold text-foreground shadow-sm ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
      {done && <Check className="h-3.5 w-3.5 text-tone-success" strokeWidth={2.6} aria-hidden />}
      {done ? 'Completed' : mine.status === 'In progress' ? (mine.progress > 0 ? `${mine.progress}% done` : 'Started') : 'Enrolled'}
    </span>
  );
}

/** A thin progress bar along the bottom edge of a cover. */
function CoverProgress({ mine, label }: { mine: Mine; label: string }) {
  if (mine?.status !== 'In progress') return null;
  const pct = Math.max(0, Math.min(100, Math.round(mine.progress)));
  return (
    <span className="absolute inset-x-0 bottom-0 block h-1 bg-black/30" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
    </span>
  );
}

function Eyebrow({ children, certificate }: { children: ReactNode; certificate: boolean }) {
  return (
    <div className="flex h-5 items-center justify-between gap-3">
      <p className="min-w-0 truncate text-2xs font-semibold uppercase leading-5 tracking-[0.14em] text-faint">{children}</p>
      {certificate && (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium leading-5 text-muted-foreground">
          <Award className="h-3.5 w-3.5 text-tone-warning" aria-hidden /> Certificate
        </span>
      )}
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-faint">
      ·
    </span>
  );
}

/** A course in a grid: cover, category, title, two lines of summary, level · length · rating pinned to the bottom. */
export function CatalogCourseCard({ course, mine, className }: { course: CourseCardData | CatalogCourse; mine?: Mine; className?: string }) {
  return (
    <article className={cn(cardShell, 'flex-col', className)}>
      <CourseCover coverImageUrl={course.coverImageUrl} title={course.title} color={course.color}>
        <StatusBadge mine={mine} />
        <CoverProgress mine={mine} label={`${course.title} progress`} />
      </CourseCover>
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <Eyebrow certificate={course.certificateEnabled}>{course.category?.name ?? ' '}</Eyebrow>
        <h3 className="mt-2 font-serif text-lg font-semibold leading-snug">
          <Link to={`/courses/${course.slug}`} className={titleLink}>
            {course.title}
          </Link>
        </h3>
        {course.summary && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{course.summary}</p>}
        <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-4 text-sm text-muted-foreground">
          <span>{course.level}</span>
          <Dot />
          <span>{formatMinutes(course.estimatedMinutes)}</span>
          {course.rating.average ? (
            <>
              <Dot />
              <RatingText average={course.rating.average} count={course.rating.count} />
            </>
          ) : null}
        </p>
      </div>
    </article>
  );
}

/**
 * A learning path as a wide card: cover beside the text on tablets and up,
 * with the courses it's made of listed in order (ticked when done).
 */
export function CatalogPathCard({ path, className }: { path: CatalogPath; className?: string }) {
  const mine = path.mine;
  const shown = path.courses.length > 5 ? path.courses.slice(0, 4) : path.courses;
  const hidden = path.courses.length - shown.length;
  return (
    <article className={cn(cardShell, 'flex-col sm:flex-row', className)}>
      <CourseCover coverImageUrl={path.coverImageUrl} title={path.title} color={path.color} rounded="rounded-none" className="sm:aspect-auto sm:min-h-[180px] sm:w-64 sm:shrink-0 lg:w-80">
        <StatusBadge mine={mine} />
        <CoverProgress mine={mine} label={`${path.title} progress`} />
      </CourseCover>
      <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5 lg:px-6">
        <Eyebrow certificate={false}>Learning path{path.category ? ` · ${path.category.name}` : ''}</Eyebrow>
        <h3 className="mt-2 font-serif text-xl font-semibold leading-snug">
          <Link to={`/paths/${path.slug}`} className={titleLink}>
            {path.title}
          </Link>
        </h3>
        {path.summary && <p className="mt-1.5 line-clamp-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{path.summary}</p>}
        {shown.length > 0 && (
          <ol className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Courses in this path">
            {shown.map((c, i) => (
              <li key={`${c.title}-${i}`} className="inline-flex min-w-0 max-w-full items-center gap-2">
                <span
                  className={cn(
                    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                    c.done ? 'bg-tone-success text-white dark:text-[hsl(240_10%_6%)]' : 'border text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {c.done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0 truncate text-foreground/85">
                  {c.title}
                  {c.optional && <span className="text-muted-foreground"> (optional)</span>}
                  {c.done && <span className="sr-only"> — completed</span>}
                </span>
              </li>
            ))}
            {hidden > 0 && <li className="text-muted-foreground">+{hidden} more</li>}
          </ol>
        )}
        <p className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-faint" aria-hidden /> {plural(path.courseCount, 'course')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-faint" aria-hidden /> {formatMinutes(path.totalMinutes)}
          </span>
          {path.sequential && path.courseCount > 1 && (
            <span className="inline-flex items-center gap-1.5">
              <ListOrdered className="h-3.5 w-3.5 text-faint" aria-hidden /> Taken in order
            </span>
          )}
          {path.certificateEnabled && (
            <span className="inline-flex items-center gap-1.5">
              <Award className="h-3.5 w-3.5 text-tone-warning" aria-hidden /> Certificate
            </span>
          )}
        </p>
      </div>
    </article>
  );
}
