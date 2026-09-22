import { Archive, ArchiveRestore, ArrowRight, Check, Copy, ExternalLink, Eye, GraduationCap, Link2, Loader2, Settings, Sparkles, Trash2, TriangleAlert, Undo2, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { duplicateCourse, saveCourse } from 'zitejs/api';
import { ContextMenuItem, ContextMenuSeparator } from '@project/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { DropdownMenuItem, DropdownMenuSeparator } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { asLessonType, lessonIssues, type AnyLessonSettings } from '@project/shared/lessons';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { formatMinutes, plural } from '../../lib/format';
import { useCourse } from '../../lib/queries';
import type { Course } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { LessonTypeIcon } from '../primitives/icons';
import { learnerUrl } from './CourseBits';
import { useRefreshCourse } from './courseData';
import { buttonClass, primaryButtonClass } from './fields';
import { useModEnter } from './useModEnter';

type CourseLike = Pick<Course, 'id' | 'title' | 'slug' | 'status' | 'publishedAt' | 'counts'>;

/** Lifecycle actions shared by the courses list, the course header and its settings. */
export function useCourseLifecycle() {
  const app = useAppActions();
  const navigate = useNavigate();
  const refresh = useRefreshCourse();

  async function run<T>(course: CourseLike, fn: () => Promise<T>, error: string): Promise<T | null> {
    try {
      const res = await fn();
      refresh(course.id);
      return res;
    } catch (e) {
      toast.error(errorMessage(e, error));
      return null;
    }
  }

  const active = (c: CourseLike) => c.counts.notStarted + c.counts.inProgress;

  const unpublish = async (c: CourseLike) => {
    const n = active(c);
    const ok = await app.confirm({
      title: `Unpublish ${c.title}?`,
      description: `It goes back to being a draft: it leaves the catalog, and nobody new can be enrolled or enroll themselves.${n ? ` The ${plural(n, 'person', 'people')} still working through it keep their access and progress.` : ' Anyone already enrolled keeps their progress.'} Assignment rules for it won’t enroll anyone until you publish again.`,
      confirmLabel: 'Unpublish',
    });
    if (!ok) return false;
    const res = await run(c, () => saveCourse({ action: 'unpublish', id: c.id }), "Couldn't unpublish the course");
    if (res) toast.success(`${c.title} is a draft again`);
    return Boolean(res);
  };

  const archive = async (c: CourseLike) => {
    const ok = await app.confirm({
      title: `Archive ${c.title}?`,
      description: 'It’s hidden from the catalog, course lists and pickers, and nobody new can enroll. People already enrolled keep their progress and certificates, and reports keep its history. Active assignment rules for it are paused. You can unarchive it any time.',
      confirmLabel: 'Archive',
    });
    if (!ok) return false;
    const res = await run(c, () => saveCourse({ action: 'archive', id: c.id }), "Couldn't archive the course");
    if (res) toast.success(`Archived ${c.title}`, { description: res.pausedRules ? `${plural(res.pausedRules, 'assignment rule')} paused` : undefined });
    return Boolean(res);
  };

  const unarchive = async (c: CourseLike) => {
    const res = await run(c, () => saveCourse({ action: 'unarchive', id: c.id }), "Couldn't unarchive the course");
    if (res) toast.success(res.status === 'Published' ? `${c.title} is back and published` : `${c.title} is back as a draft`, { description: res.status === 'Draft' && c.publishedAt ? 'Some lessons need fixing before it can be published again.' : undefined });
    return Boolean(res);
  };

  const duplicate = async (c: CourseLike) => {
    const id = toast.loading(`Duplicating ${c.title}…`);
    try {
      const res = await duplicateCourse({ id: c.id });
      refresh(null);
      toast.success(`Duplicated as “${res.title}”`, { id, description: `A draft with ${plural(res.lessons, 'lesson')}. Learners and discussions stay with the original.` });
      navigate(`/courses/${res.id}/settings`);
      return res.id;
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't duplicate the course"), { id });
      return null;
    }
  };

  const remove = async (c: CourseLike) => {
    const everEnrolled = c.counts.enrolled > 0;
    if (everEnrolled) {
      const ok = await app.confirm({
        title: `${c.title} can’t be deleted`,
        description: `${plural(c.counts.enrolled, 'person has', 'people have')} enrolled, so deleting it would erase their training records. Archive it instead — it disappears from the catalog and lists, and its history is kept.`,
        confirmLabel: c.status === 'Archived' ? 'OK' : 'Archive instead',
      });
      if (ok && c.status !== 'Archived') return archive(c);
      return false;
    }
    const ok = await app.confirm({
      title: `Delete ${c.title}?`,
      description: 'Its sections, lessons, discussions and live sessions are deleted with it, and it’s removed from any learning paths. This can’t be undone.',
      confirmLabel: 'Delete course',
      destructive: true,
    });
    if (!ok) return false;
    const res = await run(c, () => saveCourse({ action: 'delete', id: c.id }), "Couldn't delete the course");
    if (res) {
      toast.success(`Deleted ${c.title}`);
      navigate('/courses');
    }
    return Boolean(res);
  };

  return { unpublish, archive, unarchive, duplicate, remove };
}

type MenuKind = 'context' | 'dropdown';

/** The same actions in a right-click menu or a "…" menu. */
export function CourseMenuItems({ course, kind, onPublish, showOpen = true, onPreview }: { course: Course; kind: MenuKind; onPublish: (id: string) => void; showOpen?: boolean; onPreview?: () => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const life = useCourseLifecycle();
  const Item = kind === 'context' ? ContextMenuItem : DropdownMenuItem;
  const Sep = kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator;
  const link = learnerUrl(ws.settings.learnUrl, 'courses', course.slug);
  const cls = 'gap-2 text-[14px] [&_svg]:h-3.5 [&_svg]:w-3.5';
  return (
    <>
      {showOpen && (
        <>
          <Item className={cls} onSelect={() => navigate(`/courses/${course.id}`)}>
            <ArrowRight /> Open
          </Item>
          <Item className={cls} onSelect={() => navigate(`/courses/${course.id}/settings`)}>
            <Settings /> Settings
          </Item>
        </>
      )}
      <Item className={cls} disabled={course.status !== 'Published'} onSelect={() => app.openEnroll({ targetType: 'Course', targetId: course.id })}>
        <GraduationCap /> Enroll people{course.status !== 'Published' && <span className="ml-auto text-2xs text-muted-foreground">Publish first</span>}
      </Item>
      {onPreview && (
        <Item className={cls} onSelect={onPreview}>
          <Eye /> Preview lessons
        </Item>
      )}
      <Item className={cls} disabled={!link} onSelect={() => link && copyText(link, 'Learner link copied')}>
        <Link2 /> Copy learner link{!link && <span className="ml-auto hidden pl-2 text-2xs text-muted-foreground sm:inline">Open academy first</span>}
      </Item>
      {link && course.status === 'Published' && (
        <Item className={cls} onSelect={() => window.open(link, '_blank', 'noopener')}>
          <ExternalLink /> Open in the academy
        </Item>
      )}
      <Sep />
      {course.canEdit && course.status === 'Draft' && (
        <Item className={cls} onSelect={() => onPublish(course.id)}>
          <Sparkles /> Publish…
        </Item>
      )}
      {course.canEdit && course.status === 'Published' && (
        <Item className={cls} onSelect={() => life.unpublish(course)}>
          <Undo2 /> Unpublish…
        </Item>
      )}
      <Item className={cls} onSelect={() => life.duplicate(course)}>
        <Copy /> Duplicate
      </Item>
      {course.canEdit &&
        (course.status === 'Archived' ? (
          <Item className={cls} onSelect={() => life.unarchive(course)}>
            <ArchiveRestore /> Unarchive
          </Item>
        ) : (
          <Item className={cls} onSelect={() => life.archive(course)}>
            <Archive /> Archive…
          </Item>
        ))}
      {course.canEdit && (
        <Item className={cn(cls, 'text-tone-danger focus:text-tone-danger')} onSelect={() => life.remove(course)}>
          <Trash2 /> Delete…
        </Item>
      )}
    </>
  );
}

/**
 * Publishing puts a course in the catalog and makes it assignable, so it
 * shows exactly what would stop a learner finishing — lesson by lesson, with
 * a link straight to each one in the builder. The server checks the same rules.
 */
export function PublishCourseDialog({ courseId, onOpenChange }: { courseId: string | null; onOpenChange: (open: boolean) => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const refresh = useRefreshCourse();
  const { data, isPending, isError } = useCourse(courseId);
  const [busy, setBusy] = useState(false);
  const course = courseId ? ws.courseById.get(courseId) : undefined;

  const problems = useMemo(() => {
    if (!data) return [];
    const sectionIndex = new Map(data.sections.map((s, i) => [s.id, i]));
    return [...data.lessons]
      .sort((a, b) => (a.sectionId ? sectionIndex.get(a.sectionId) ?? 0 : -1) - (b.sectionId ? sectionIndex.get(b.sectionId) ?? 0 : -1) || a.position - b.position)
      .map(l => ({ lesson: l, issues: lessonIssues({ type: asLessonType(l.type), title: l.title, body: l.body, mediaUrl: l.mediaUrl, settings: l.settings as AnyLessonSettings }) }))
      .filter(p => p.issues.length);
  }, [data]);

  const lessons = data?.lessons.length ?? 0;
  const blocked = !data || lessons === 0 || problems.length > 0;

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  const publish = async () => {
    if (!courseId || blocked || busy) return;
    setBusy(true);
    try {
      await saveCourse({ action: 'publish', id: courseId });
      refresh(courseId);
      toast.success(`Published ${data?.course.title ?? 'the course'}`, { description: data?.course.visibility === 'Catalog' ? (ws.settings.selfEnrollment ? 'It’s in the catalog and ready to assign.' : 'It’s ready to assign.') : 'It’s private — people see it once they’re enrolled.' });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't publish the course"));
    } finally {
      setBusy(false);
    }
  };

  const d = data?.course;
  useModEnter(Boolean(courseId), () => void publish());
  return (
    <Dialog open={Boolean(courseId)} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg gap-0 p-0 sm:rounded-xl"
      >
        <DialogHeader className="px-5 pb-3 pt-4">
          <DialogTitle className="text-[16px]">Publish {course?.title ?? d?.title ?? 'course'}?</DialogTitle>
          <DialogDescription className="text-[14px]">
            {d?.visibility === 'Private' ? 'It stays out of the catalog — people see it once they’re enrolled or assigned.' : ws.settings.selfEnrollment ? 'It appears in the catalog, where anyone can enroll themselves, and you can assign it.' : 'It appears in the catalog and you can assign it to people.'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto px-5 pb-4">
          {isPending ? (
            <div className="space-y-2">
              <div className="skeleton h-9 w-full rounded-lg" />
              <div className="skeleton h-9 w-full rounded-lg" />
            </div>
          ) : isError ? (
            <p className="text-[14px] text-muted-foreground">Couldn’t check the lessons. Close this and try again.</p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border">
              <CheckRow
                ok={lessons > 0}
                title={lessons > 0 ? `${plural(lessons, 'lesson')}${d?.estimatedMinutes ? ` · about ${formatMinutes(d.estimatedMinutes)}` : ''}` : 'The course has no lessons yet'}
                detail={lessons > 0 ? undefined : 'Add at least one lesson before publishing.'}
                action={<FixLink onClick={() => go(`/courses/${courseId}/content`)}>{lessons > 0 ? 'Review' : 'Add lessons'}</FixLink>}
              />
              <CheckRow
                ok={problems.length === 0}
                title={problems.length === 0 ? 'Every lesson can be completed' : `${plural(problems.length, 'lesson needs', 'lessons need')} fixing`}
                detail={problems.length === 0 ? undefined : 'Learners would get stuck on these.'}
              />
              {problems.map(p => (
                <li key={p.lesson.id} className="flex items-start gap-2.5 bg-subtle/40 py-2 pl-9 pr-3">
                  <LessonTypeIcon type={p.lesson.type} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px]">{p.lesson.title || 'Untitled lesson'}</div>
                    <ul className="mt-0.5 space-y-px">
                      {p.issues.map(i => (
                        <li key={i} className="text-sm text-tone-danger">
                          {i}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <FixLink onClick={() => go(`/courses/${courseId}/content/${p.lesson.id}`)}>Fix</FixLink>
                </li>
              ))}
              <CheckRow
                ok
                neutral={!d?.certificateEnabled}
                title={d?.certificateEnabled ? `Certificate on completion${d.certificateValidityMonths ? ` · valid ${plural(d.certificateValidityMonths, 'month')}` : ''}` : 'No certificate on completion'}
                action={<FixLink onClick={() => go(`/courses/${courseId}/settings/certificate`)}>Change</FixLink>}
              />
            </ul>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t bg-subtle/60 px-5 py-3">
          <button type="button" onClick={() => onOpenChange(false)} className={buttonClass}>
            Cancel
          </button>
          <button type="button" onClick={publish} disabled={blocked || busy} className={primaryButtonClass}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? 'Publishing…' : 'Publish course'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FixLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 text-sm font-medium text-primary hover:underline">
      {children}
    </button>
  );
}

function CheckRow({ ok, neutral, title, detail, action }: { ok: boolean; neutral?: boolean; title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5">
      <span className={cn('mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full', neutral ? 'bg-muted text-muted-foreground' : ok ? 'bg-tone-success/[0.14] text-tone-success' : 'bg-tone-danger/[0.14] text-tone-danger')} aria-hidden>
        {neutral ? <span className="h-1 w-1 rounded-full bg-current" /> : ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" strokeWidth={3} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{title}</div>
        {detail && <div className="mt-0.5 text-sm text-muted-foreground">{detail}</div>}
      </div>
      {action}
    </li>
  );
}

/** A slim banner under the header for drafts and archived courses or paths. */
export function LifecycleBanner({ status, kind, canEdit, onPublish, onUnarchive }: { status: 'Draft' | 'Published' | 'Archived'; kind: 'course' | 'path'; canEdit: boolean; onPublish: () => void; onUnarchive: () => void }) {
  if (status === 'Published') return null;
  const draft = status === 'Draft';
  return (
    <div className={cn('flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-[14px]', draft ? 'bg-tone-warning/[0.07]' : 'bg-muted/60')}>
      {draft ? <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-tone-warning" /> : <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        {draft ? (
          <>
            <span className="font-medium">This {kind} is a draft.</span> <span className="text-muted-foreground">Learners can’t find it or be enrolled until it’s published.</span>
          </>
        ) : (
          <>
            <span className="font-medium">This {kind} is archived.</span> <span className="text-muted-foreground">It’s hidden from the catalog and nobody new can enroll. Existing learners keep their progress.</span>
          </>
        )}
      </span>
      {canEdit && (
        <button type="button" onClick={draft ? onPublish : onUnarchive} className={cn(draft ? primaryButtonClass : buttonClass, 'h-8 text-[13.5px]')}>
          {draft ? <Sparkles /> : <ArchiveRestore />} {draft ? 'Review and publish' : 'Unarchive'}
        </button>
      )}
    </div>
  );
}
