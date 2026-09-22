import { BookOpen, Eye, GraduationCap, MoreHorizontal } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { CourseMenuItems, LifecycleBanner, PublishCourseDialog, useCourseLifecycle } from '../components/courses/CourseActions';
import { StatusPill } from '../components/courses/CourseBits';
import { useCourseLearnerTotal } from '../components/courses/courseData';
import { CourseOverview } from '../components/courses/CourseOverview';
import { CourseSettings } from '../components/courses/CourseSettings';
import { EnrollmentsView } from '../components/enrollments/EnrollmentsView';
import { rememberCourse } from '../components/shell/Sidebar';
import { buildOutline } from '../components/builder/model';
import { PreviewDialog } from '../components/builder/PreviewDialog';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { CourseGlyph } from '../components/primitives/icons';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';
import { MOD } from '../lib/hotkeys';
import { useCourse } from '../lib/queries';
import type { EnrollmentFilters } from '../lib/types';
import { useWorkspace } from '../lib/workspace';

const CourseBuilder = lazy(() => import('../components/builder/CourseBuilder').then(m => ({ default: m.CourseBuilder })));
const CourseDiscussions = lazy(() => import('../components/discussions/CourseDiscussions').then(m => ({ default: m.CourseDiscussions })));

const TABS = ['overview', 'content', 'learners', 'discussions', 'settings'] as const;
type Tab = (typeof TABS)[number];

const Loading = () => (
  <div className="p-4">
    <SkeletonRows rows={8} />
  </div>
);

/** One course: its analytics, content builder, learners, discussions and settings under one header. */
export function CoursePage() {
  const { courseId = '', tab: rawTab, itemId } = useParams();
  const [params] = useSearchParams();
  const ws = useWorkspace();
  const app = useAppActions();
  const life = useCourseLifecycle();
  const { data, isPending, isError, error, refetch } = useCourse(courseId);
  const learnerTotal = useCourseLearnerTotal(courseId);
  const [publishing, setPublishing] = useState<string | null>(null);
  // The builder previews the lesson it has open; every other tab previews from the first lesson.
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewLessonId, setPreviewLessonId] = useState<string | null>(null);
  const listed = ws.courseById.get(courseId);
  const course = data?.course;
  const tab: Tab | null = rawTab === undefined ? 'overview' : (TABS as readonly string[]).includes(rawTab) ? (rawTab as Tab) : null;

  useDocumentTitle(course?.title ?? listed?.title ?? 'Course');
  useEffect(() => {
    app.setContextCourse(courseId);
    return () => app.setContextCourse(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);
  useEffect(() => {
    if (course?.id) rememberCourse(course.id);
  }, [course?.id]);

  const stalled = params.get('stalled') ? 'stalled' : null;
  const due = params.get('due') ?? stalled;
  const defaultFilters = useMemo<EnrollmentFilters | undefined>(
    () => (due === 'overdue' || due === 'due_soon' ? { due: [due] } : due === 'stalled' ? { inactiveDays: 14, statuses: ['In progress'] } : undefined),
    [due],
  );

  if (tab === null) return <Navigate to={`/courses/${courseId}`} replace />;

  const notFound = isError && /not found|no longer exists|\(404\)/i.test(String((error as Error)?.message ?? ''));
  if (notFound || (!isPending && !data && !listed)) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader icon={<BookOpen />} title="Course not found" breadcrumb={{ to: '/courses', label: 'Courses' }} />
        <EmptyState
          className="py-24"
          icon={<BookOpen />}
          title="This course doesn’t exist"
          description="It may have been deleted, or the link is wrong. Archived courses are still listed under Courses → Archived."
          action={
            <Link to="/courses" className="flex h-9 items-center rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
              Back to courses
            </Link>
          }
        />
      </div>
    );
  }

  const title = course?.title ?? listed?.title ?? '';
  const status = course?.status ?? listed?.status ?? 'Draft';
  const slug = course?.slug ?? listed?.slug ?? '';
  const canEdit = data?.canEdit ?? listed?.canEdit ?? false;
  const lessonCount = data?.lessons.length ?? listed?.lessonCount ?? null;
  const canPreview = Boolean(data?.lessons.length);
  const openPreview = () => {
    if (!data || !canPreview) return;
    if (tab === 'content') setPreviewNonce(n => n + 1);
    else setPreviewLessonId(buildOutline(data).ordered[0]?.id ?? null);
  };
  const base = `/courses/${courseId}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<CourseGlyph icon={course?.icon ?? listed?.icon} color={course?.color ?? listed?.color} size={18} />}
        breadcrumb={{ to: '/courses', label: 'Courses' }}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{title || <span className="skeleton inline-block h-3.5 w-40 align-middle" />}</span>
            {status !== 'Published' && <StatusPill status={status} className="hidden sm:inline-flex" />}
          </span>
        }
        tabs={[
          { to: `${base}/overview`, label: 'Overview', active: tab === 'overview' },
          { to: `${base}/content`, label: 'Content', count: lessonCount, active: tab === 'content' },
          { to: `${base}/learners`, label: 'Learners', count: learnerTotal ?? listed?.counts.enrolled, active: tab === 'learners' },
          { to: `${base}/discussions`, label: 'Discussions', active: tab === 'discussions' },
          { to: `${base}/settings`, label: 'Settings', active: tab === 'settings' },
        ]}
        actions={
          <>
            <Tip label={!data ? 'Loading the course…' : canPreview ? 'See the lessons as learners do. Nothing you do in the preview is recorded.' : 'Add a lesson to preview the course'} keys={tab === 'content' && canPreview ? [MOD, '⇧', 'P'] : undefined}>
              <span className="hidden sm:inline-flex">
                <button
                  type="button"
                  disabled={!canPreview}
                  onClick={openPreview}
                  className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground disabled:shadow-none disabled:hover:bg-background"
                >
                  <Eye className="h-3.5 w-3.5" /> Preview
                </button>
              </span>
            </Tip>
            <Tip label={status === 'Published' ? 'Enroll people' : 'Publish the course before enrolling people'} keys={status === 'Published' ? ['⇧', 'E'] : undefined}>
              <span className="inline-flex">
                <button
                  type="button"
                  disabled={status !== 'Published'}
                  onClick={() => app.openEnroll({ targetType: 'Course', targetId: courseId })}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50 sm:px-2.5"
                >
                  <GraduationCap className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Enroll people</span>
                </button>
              </span>
            </Tip>
            {listed && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton aria-label="Course actions">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <CourseMenuItems course={listed} kind="dropdown" onPublish={setPublishing} showOpen={false} onPreview={canPreview ? openPreview : undefined} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      {listed && <LifecycleBanner kind="course" status={status} canEdit={canEdit} onPublish={() => setPublishing(courseId)} onUnarchive={() => life.unarchive(listed)} />}

      {isError && !notFound ? (
        <EmptyState icon={<BookOpen />} title="Couldn't load the course" description={errorMessage(error, 'Check your connection and try again.')} action={<button type="button" onClick={() => refetch()} className="text-[14px] text-primary hover:underline">Retry</button>} />
      ) : tab === 'learners' ? (
        <EnrollmentsView
          key={`course:${courseId}:${due ?? ''}`}
          surfaceKey={`course:${courseId}${due ? `?due=${due}` : ''}`}
          baseFilters={{ courseIds: [courseId] }}
          lockedFilters={['courseIds']}
          defaultFilters={defaultFilters}
          primary="person"
          defaults={{ properties: ['person', 'title', 'due', 'progress', 'score', 'activity'] }}
          emptyState={
            <EmptyState
              icon={<GraduationCap />}
              title="Nobody is enrolled yet"
              description={status === 'Published' ? 'Enroll people or groups, or set up an assignment rule so new starters are enrolled automatically.' : 'Publish the course, then enroll people or groups.'}
              action={
                status === 'Published' ? (
                  <button type="button" onClick={() => app.openEnroll({ targetType: 'Course', targetId: courseId })} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">
                    Enroll people
                  </button>
                ) : canEdit ? (
                  <button type="button" onClick={() => setPublishing(courseId)} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">
                    Review and publish
                  </button>
                ) : undefined
              }
            />
          }
        />
      ) : tab === 'content' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Suspense fallback={<Loading />}>
            <CourseBuilder courseId={courseId} lessonId={itemId ?? null} previewRequest={previewNonce} />
          </Suspense>
        </div>
      ) : tab === 'discussions' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Suspense fallback={<Loading />}>
            <CourseDiscussions courseId={courseId} />
          </Suspense>
        </div>
      ) : !data ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Loading />
        </div>
      ) : tab === 'settings' ? (
        <CourseSettings detail={data} section={itemId} onPublish={() => setPublishing(courseId)} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CourseOverview detail={data} />
        </div>
      )}
      <PublishCourseDialog courseId={publishing} onOpenChange={o => !o && setPublishing(null)} />
      {data && tab !== 'content' && <PreviewDialog open={Boolean(previewLessonId)} onOpenChange={o => !o && setPreviewLessonId(null)} detail={data} lessonId={previewLessonId} onNavigate={setPreviewLessonId} learnUrl={ws.settings.learnUrl} />}
    </div>
  );
}
