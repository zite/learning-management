import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowRight, ArrowUp, Award, BookOpen, ChevronDown, Clock, GripVertical, MoreHorizontal, Plus, Route, Trash2, Users, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { savePath } from 'zitejs/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { formatDuration, plural, shortDate } from '../../lib/format';
import { qk } from '../../lib/queries';
import type { Bootstrap } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { OptionPicker, type Option } from '../pickers/OptionPicker';
import { verticalOnly } from '../builder/dnd';
import { Panel, StatusPill } from '../courses/CourseBits';
import { SaveState } from '../courses/fields';
import { pathKey, usePathAutosave, useRefreshPath, type PathCourse, type PathDetail } from './pathData';

/** Course rows and their header share one template, so every column lines up. */
const ROW_GRID = 'grid grid-cols-[20px_24px_minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[20px_24px_minmax(0,1fr)_128px_104px_28px]';

/**
 * The path's courses in order, with how the path is set up beside them.
 * Drag (or ⌥↑/⌥↓, or the row menu) to reorder, mark courses optional, add and
 * remove — each change saves straight away.
 */
export function PathCourses({ detail }: { detail: PathDetail }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const refresh = useRefreshPath();
  const [items, setItems] = useState<PathCourse[]>(detail.courses);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const ro = !detail.canEdit;
  const path = detail.path;

  useEffect(() => {
    if (!saving) setItems(detail.courses);
  }, [detail.courses, saving]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const commit = async (next: PathCourse[], message?: { success?: string; error: string }) => {
    const prev = items;
    setItems(next);
    setSaving(true);
    const key = pathKey(path.id);
    const snapshot = qc.getQueryData<PathDetail>(key);
    const boot = qc.getQueryData<Bootstrap>(qk.bootstrap);
    if (snapshot) qc.setQueryData<PathDetail>(key, { ...snapshot, courses: next });
    if (boot) qc.setQueryData<Bootstrap>(qk.bootstrap, { ...boot, paths: boot.paths.map(p => (p.id === path.id ? { ...p, courseIds: next.map(c => c.courseId) } : p)) });
    try {
      const res = await savePath({ action: 'set_courses', id: path.id, courses: next.map(c => ({ courseId: c.courseId, optional: c.optional })) });
      if (message?.success || res.newEnrollments) toast.success(message?.success ?? 'Saved', { description: res.newEnrollments ? `${plural(res.newEnrollments, 'person', 'people')} already on the path ${res.newEnrollments === 1 ? 'was' : 'were'} enrolled in the new course.` : undefined });
      refresh({ enrollments: res.added > 0 || res.removed > 0 });
    } catch (e) {
      setItems(prev);
      if (snapshot) qc.setQueryData(key, snapshot);
      if (boot) qc.setQueryData(qk.bootstrap, boot);
      toast.error(errorMessage(e, message?.error ?? "Couldn't save the course order"));
    } finally {
      setSaving(false);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex(i => i.courseId === active.id);
    const to = items.findIndex(i => i.courseId === over.id);
    if (from < 0 || to < 0) return;
    commit(arrayMove(items, from, to));
  };

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    commit(arrayMove(items, i, j));
  };

  const remove = async (c: PathCourse) => {
    if (path.status === 'Published' && items.length === 1) {
      toast.error('A published path needs at least one course. Unpublish it first to empty it.');
      return;
    }
    const open = c.learners.openThroughPath;
    const ok = await app.confirm({
      title: `Remove ${c.title} from the path?`,
      description: open
        ? `${plural(open, 'person is', 'people are')} taking it through this path. They keep the course and their progress in it, but it stops counting toward the path — anyone who has finished everything else completes the path now${path.certificateEnabled ? ' and gets its certificate' : ''}.`
        : 'The course itself isn’t affected, and nobody loses progress.',
      confirmLabel: 'Remove course',
      destructive: open > 0,
    });
    if (!ok) return;
    commit(items.filter(i => i.courseId !== c.courseId), { success: `Removed ${c.title}`, error: "Couldn't remove the course" });
  };

  const add = (courseId: string) => {
    const c = ws.courseById.get(courseId);
    if (!c) return;
    setPickerOpen(false);
    const entry: PathCourse = {
      pathCourseId: `new-${courseId}`,
      courseId,
      optional: false,
      position: items.length + 1,
      title: c.title,
      slug: c.slug,
      summary: c.summary,
      icon: c.icon,
      color: c.color,
      coverImageUrl: c.coverImageUrl,
      status: c.status,
      lessonCount: c.lessonCount,
      estimatedMinutes: c.estimatedMinutes,
      learners: { enrolled: 0, completed: 0, inProgress: 0, notStarted: 0, throughPath: 0, openThroughPath: 0 },
    };
    commit([...items, entry], { success: `Added ${c.title}`, error: "Couldn't add the course" });
  };

  const inPath = useMemo(() => new Set(items.map(i => i.courseId)), [items]);
  const options: Option<string>[] = ws.orderedCourses
    .filter(c => c.status !== 'Archived' && !inPath.has(c.id))
    .map(c => ({
      value: c.id,
      label: c.title,
      icon: <CourseGlyph icon={c.icon} color={c.color} size={16} />,
      hint: c.status === 'Draft' ? (path.status === 'Published' ? 'Publish first' : 'Draft') : plural(c.lessonCount, 'lesson'),
      disabled: c.status !== 'Published' && path.status === 'Published',
      group: c.status === 'Published' ? 'Published courses' : 'Drafts',
      keywords: [ws.categoryById.get(c.categoryId ?? '')?.name ?? ''],
    }));

  const required = items.filter(i => !i.optional).length;
  const minutes = items.reduce((s, c) => s + c.estimatedMinutes, 0);
  const counts = detail.counts;
  const completedRate = counts.enrolled ? Math.round((counts.completed / counts.enrolled) * 100) : null;

  const addButton = !ro && (
    <OptionPicker
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      value={null}
      onChange={v => v && add(v)}
      options={options}
      placeholder="Add a course…"
      emptyText="Every course is already in the path"
      width={340}
      align="end"
      trigger={
        <button type="button" disabled={saving} className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> Add course
        </button>
      }
    />
  );

  return (
    <div className="mx-auto max-w-[1180px] space-y-5 px-4 py-5 sm:px-6">
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card md:grid-cols-4 [&>*]:border-b [&>*]:border-r md:[&>*:nth-child(4n)]:border-r-0 max-md:[&>*:nth-child(2n)]:border-r-0 md:[&>*]:border-b-0 max-md:[&>*:nth-last-child(-n+2)]:border-b-0">
        <Stat label="Courses" value={items.length.toLocaleString()} foot={items.length ? `${required} required${minutes ? ` · ${formatDuration(minutes * 60)}` : ''}` : 'None yet'} />
        <Stat label="Enrolled" value={counts.enrolled.toLocaleString()} foot={counts.enrolled ? `${counts.inProgress} in progress · ${counts.notStarted} not started` : 'Nobody yet'} to={`/paths/${path.id}/learners`} />
        <Stat label="Completed" value={counts.completed.toLocaleString()} foot={completedRate == null ? 'Shows once people enroll' : `${completedRate}% of enrolled${detail.certificates.issued ? ` · ${plural(detail.certificates.issued, 'certificate')}` : ''}`} />
        <Stat label="Overdue" value={counts.overdue.toLocaleString()} tone={counts.overdue ? 'text-tone-danger' : undefined} foot={counts.overdue ? 'See who' : counts.enrolled ? 'Everyone is on track' : 'Nobody enrolled yet'} to={counts.overdue ? `/paths/${path.id}/learners?status=overdue` : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Courses in the path" icon={<Route />} action={addButton || undefined} className="self-start">
          {items.length === 0 ? (
            <EmptyState
              className="py-12"
              icon={<Route />}
              title="No courses in this path yet"
              description="Add the courses people should take, in order. Everyone on the path is enrolled in each of them."
              action={!ro ? <button type="button" onClick={() => setPickerOpen(true)} className="text-[14px] text-primary hover:underline">Add a course</button> : undefined}
            />
          ) : (
            <>
              <div className={cn(ROW_GRID, 'hidden border-b px-4 py-2 text-sm text-muted-foreground md:grid')}>
                <span />
                <span className="text-center">#</span>
                <span>Course</span>
                <Tip label="How many of the path’s learners have finished this course">
                  <span>Completed</span>
                </Tip>
                <span>Requirement</span>
                <span />
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[verticalOnly]} onDragEnd={onDragEnd}>
                <SortableContext items={items.map(i => i.courseId)} strategy={verticalListSortingStrategy}>
                  <ol>
                    {items.map((c, i) => (
                      <SortableCourse
                        key={c.courseId}
                        course={c}
                        index={i}
                        count={items.length}
                        ro={ro}
                        pathPublished={path.status === 'Published'}
                        onMove={d => move(i, d)}
                        onOptional={v => commit(items.map(x => (x.courseId === c.courseId ? { ...x, optional: v } : x)))}
                        onRemove={() => remove(c)}
                      />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
              {!ro && items.length > 1 && (
                <p className="border-t px-4 py-2.5 text-sm text-muted-foreground">Drag a handle to reorder, or focus it and press ⌥↑ or ⌥↓. Changes apply to everyone on the path straight away.</p>
              )}
            </>
          )}
        </Panel>

        <div className="min-w-0 space-y-5">
          <PathDetailsPanel detail={detail} />
          <Panel title="Assignment rules" icon={<Workflow />} action={ws.isAdmin ? <Link to="/assignments?new=1" className="text-sm text-muted-foreground hover:text-foreground">New rule</Link> : undefined}>
            {detail.rules.length === 0 ? (
              <p className="px-4 py-3.5 text-[14px] text-muted-foreground">No rules assign this path automatically.</p>
            ) : (
              <ul className="divide-y">
                {detail.rules.map(r => (
                  <li key={r.id}>
                    <Link to={`/assignments/${r.id}`} className="block px-4 py-2.5 text-[14px] hover:bg-accent/40">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                        {r.status !== 'Active' && <span className="shrink-0 text-sm text-muted-foreground">{r.status}</span>}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-muted-foreground">
                        {r.audience === 'Everyone' ? 'Everyone' : r.audience === 'Groups' ? r.groupIds.map(id => ws.groupById.get(id)?.name).filter(Boolean).join(', ') || plural(r.groupIds.length, 'group') : plural(r.personCount, 'person', 'people')}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, foot, tone, to }: { label: string; value: string; foot: string; tone?: string; to?: string }) {
  const body = (
    <>
      <div className="truncate text-sm text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-[22px] font-semibold leading-7 tabular-nums tracking-tight', tone)}>{value}</div>
      <div className="mt-0.5 h-4 truncate text-sm leading-4 text-muted-foreground">{foot}</div>
    </>
  );
  return to ? (
    <Link to={to} className="block min-w-0 px-4 py-3.5 transition-colors hover:bg-accent/40">
      {body}
    </Link>
  ) : (
    <div className="min-w-0 px-4 py-3.5">{body}</div>
  );
}

/** How the path is set up, with the one setting people change most — order — right here. */
function PathDetailsPanel({ detail }: { detail: PathDetail }) {
  const ws = useWorkspace();
  const p = detail.path;
  const { save, status } = usePathAutosave(p.id);
  const owner = p.ownerId ? ws.staffById.get(p.ownerId) : undefined;
  const category = p.categoryId ? ws.categoryById.get(p.categoryId) : undefined;
  const rows: Array<[string, ReactNode]> = [
    [
      'Order',
      <span key="order" className="flex items-center justify-between gap-3">
        <Tip label={p.sequential ? 'Each required course opens once the one before it is done. Optional courses never block anyone.' : 'Every course is open from the start. The path completes when every required course is done.'}>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{p.sequential ? 'Unlock in order' : 'Any order'}</span>
            <SaveState status={status('sequential')} />
          </span>
        </Tip>
        <Switch checked={p.sequential} disabled={!detail.canEdit} onCheckedChange={v => save('sequential', { sequential: v })} aria-label="Courses unlock in order" className="shrink-0" />
      </span>,
    ],
    ['Due', p.dueDays ? `${plural(p.dueDays, 'day')} after enrolling` : <span className="text-muted-foreground">No default</span>],
    ['Certificate', p.certificateEnabled ? <span className="flex items-center gap-1.5"><Award className="h-3.5 w-3.5 shrink-0 text-flame" />{p.certificateValidityMonths ? `Valid ${plural(p.certificateValidityMonths, 'month')}` : 'Never expires'}</span> : <span className="text-muted-foreground">None</span>],
    ['Visibility', p.visibility === 'Catalog' ? 'In the catalog' : 'Private — assigned only'],
    ['Category', category ? `${category.icon} ${category.name}` : <span className="text-muted-foreground">None</span>],
    ['Owner', owner ? <span className="flex min-w-0 items-center gap-1.5"><PersonAvatar person={owner} size={16} /><span className="truncate">{owner.name}</span></span> : <span className="text-muted-foreground">Nobody — admins manage it</span>],
  ];
  return (
    <Panel title="Details" icon={<Users />} action={detail.canEdit ? <Link to={`/paths/${p.id}/settings`} className="text-sm text-muted-foreground hover:text-foreground">Edit</Link> : undefined}>
      <dl className="divide-y">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start gap-3 px-4 py-2 text-[14px] leading-5">
            <dt className="w-[76px] shrink-0 text-sm leading-5 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 flex-1 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {p.publishedAt && (
        <div className="flex items-center gap-1.5 border-t px-4 py-2 text-sm text-muted-foreground">
          <Clock className="h-3 w-3" /> Published {shortDate(p.publishedAt)}
        </div>
      )}
    </Panel>
  );
}

function SortableCourse({ course: c, index, count, ro, pathPublished, onMove, onOptional, onRemove }: {
  course: PathCourse;
  index: number;
  count: number;
  ro: boolean;
  pathPublished: boolean;
  onMove: (d: number) => void;
  onOptional: (v: boolean) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: c.courseId, disabled: ro });
  const done = c.learners.enrolled ? Math.round((c.learners.completed / c.learners.enrolled) * 100) : null;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-path-course={c.courseId}
      className={cn(ROW_GRID, 'group relative border-b bg-card px-4 py-2.5 last:border-b-0', isDragging && 'z-10 shadow-lg ring-1 ring-border')}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={ro}
        aria-label={`Reorder ${c.title}`}
        onKeyDown={e => {
          if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            e.stopPropagation();
            onMove(e.key === 'ArrowUp' ? -1 : 1);
            return;
          }
          listeners?.onKeyDown?.(e);
        }}
        style={{ touchAction: 'none' }}
        className={cn('flex h-9 w-5 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing', ro && 'invisible')}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Tip label={c.optional ? 'Optional — doesn’t count toward completing the path' : `Course ${index + 1} of ${count}`}>
        <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-sm font-medium tabular-nums', c.optional ? 'border-dashed text-muted-foreground' : 'bg-subtle')}>{index + 1}</span>
      </Tip>
      <div className="flex min-w-0 items-center gap-3">
        <CourseGlyph icon={c.icon} color={c.color} coverImageUrl={c.coverImageUrl} size={36} cover className="hidden rounded-md sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link to={`/courses/${c.courseId}`} className="truncate text-[14px] font-medium hover:underline">
              {c.title}
            </Link>
            {c.status !== 'Published' && <StatusPill status={c.status} />}
          </div>
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {plural(c.lessonCount, 'lesson')}
            {c.estimatedMinutes ? ` · ${formatDuration(c.estimatedMinutes * 60)}` : ''}
            {c.optional && <span className="md:hidden"> · optional</span>}
            {c.status !== 'Published' && pathPublished && <span className="text-tone-warning"> · learners can’t start it until it’s published</span>}
          </div>
        </div>
      </div>
      <Tip label={c.learners.enrolled ? `${c.learners.completed} completed · ${c.learners.inProgress} in progress · ${c.learners.notStarted} not started, among this path’s learners` : 'Nobody on the path has started it yet'}>
        <div className="hidden min-w-0 md:block">
          <div className="text-sm tabular-nums text-muted-foreground">{c.learners.enrolled ? `${c.learners.completed} of ${c.learners.enrolled}` : '—'}</div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-foreground/60" style={{ width: `${done ?? 0}%` }} />
          </div>
        </div>
      </Tip>
      <div className="hidden md:block">
        {ro ? (
          <span className="text-[13.5px] text-muted-foreground">{c.optional ? 'Optional' : 'Required'}</span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`${c.title}: ${c.optional ? 'optional' : 'required'}. Change`} className="ghost-chip -ml-2 h-8 gap-1 px-2 text-[13.5px] text-foreground/90 data-[state=open]:bg-accent">
                {c.optional ? 'Optional' : 'Required'} <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuRadioGroup value={c.optional ? 'optional' : 'required'} onValueChange={v => onOptional(v === 'optional')}>
                <DropdownMenuRadioItem value="required" className="items-start py-1.5">
                  <span>
                    <span className="block text-[14px]">Required</span>
                    <span className="block text-2xs text-muted-foreground">Counts toward completing the path</span>
                  </span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="optional" className="items-start py-1.5">
                  <span>
                    <span className="block text-[14px]">Optional</span>
                    <span className="block text-2xs text-muted-foreground">Offered, but never blocks the path or its certificate</span>
                  </span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {ro ? (
        <span className="md:block" />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" aria-label={`More actions for ${c.title}`}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => onOptional(!c.optional)}>
              <BookOpen className="h-3.5 w-3.5" /> {c.optional ? 'Make required' : 'Make optional'}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-[14px]" disabled={index === 0} onSelect={() => onMove(-1)}>
              <ArrowUp className="h-3.5 w-3.5" /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-[14px]" disabled={index === count - 1} onSelect={() => onMove(1)}>
              <ArrowDown className="h-3.5 w-3.5" /> Move down
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="gap-2 text-[14px]">
              <Link to={`/courses/${c.courseId}`}>
                <ArrowRight className="h-3.5 w-3.5" /> Open course
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={onRemove}>
              <Trash2 className="h-3.5 w-3.5" /> Remove from path…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
