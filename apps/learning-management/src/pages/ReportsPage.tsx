import { BarChart3, BookOpen, ChevronDown, RotateCw, X } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { ComplianceControls, ComplianceTab, complianceInput } from '../components/reports/ComplianceTab';
import { CourseReportSkeleton, CoursesTab, NoCourses } from '../components/reports/CoursesTab';
import { EngagementSkeleton, EngagementTab } from '../components/reports/EngagementTab';
import { ExportMenu, type ExportOption } from '../components/reports/ExportMenu';
import { CategoryFilter, chipClass, FilterBar, GroupFilter, RangeControl } from '../components/reports/FilterBar';
import { OverviewSkeleton, OverviewTab } from '../components/reports/OverviewTab';
import { QuizDetail, QuizList, QuizListSkeleton, QuizReportSkeleton } from '../components/reports/QuizzesTab';
import { rangeText, scopeInput, TABS, useCourseReportQuery, useQuizReportQuery, useReportParams, useReportsQuery, type ReportRange, type TabId } from '../components/reports/params';
import { VIZ_STYLE } from '../components/reports/viz';
import { CoursePicker } from '../components/pickers/pickers';
import { EmptyState } from '../components/primitives/bits';
import { CourseGlyph } from '../components/primitives/icons';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useWorkspace } from '../lib/workspace';

function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={<BarChart3 />}
      title={`${what} couldn't load`}
      description="The report didn't come back. It's usually temporary."
      action={
        <button type="button" onClick={onRetry} className="flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
          <RotateCw className="h-3.5 w-3.5" /> Try again
        </button>
      }
    />
  );
}

function RangeNote({ range, fetching }: { range: ReportRange | undefined; fetching: boolean }) {
  return (
    <>
      {fetching && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/70" aria-label="Updating" />}
      {range && <span className="hidden whitespace-nowrap text-sm text-muted-foreground md:inline">{rangeText(range.fromDay, range.toDay)} · vs {rangeText(range.prevFromDay, range.prevToDay)}</span>}
    </>
  );
}

/**
 * Reports: how training is going across the organization. Five tabs share one
 * filter row whose state lives in the URL, so any view can be linked to.
 */
export function ReportsPage() {
  const { tab } = useParams();
  const ws = useWorkspace();
  const { params, update, search } = useReportParams();
  const tabId = TABS.find(t => t.id === tab)?.id as TabId | undefined;
  const label = TABS.find(t => t.id === tabId)?.label;
  useDocumentTitle(label ? `${label} · Reports` : 'Reports');

  const scope = useMemo(() => scopeInput(params), [params]);
  const filtered = params.groupIds.length > 0 || params.categoryIds.length > 0;

  // Overview and Engagement share one report.
  const wantsReports = tabId === 'overview' || tabId === 'engagement';
  const reports = useReportsQuery(scope, wantsReports);

  // Courses: default to the most-enrolled course, and put it in the URL so the link is shareable.
  const defaultCourseId = useMemo(() => [...ws.courses].filter(c => c.status !== 'Archived').sort((a, b) => b.counts.enrolled - a.counts.enrolled || a.position - b.position)[0]?.id ?? ws.courses[0]?.id ?? null, [ws.courses]);
  const courseId = params.courseId && ws.courseById.has(params.courseId) ? params.courseId : defaultCourseId;
  useEffect(() => {
    if (tabId === 'courses' && courseId && params.courseId !== courseId) update({ courseId });
  }, [tabId, courseId, params.courseId, update]);
  const courseScope = useMemo(() => ({ range: scope.range, from: scope.from, to: scope.to, groupIds: scope.groupIds }), [scope]);
  const course = useCourseReportQuery(tabId === 'courses' ? courseId : null, courseScope);

  const quizScope = useMemo(() => ({ ...scope, ...(params.quizCourseId ? { courseIds: [params.quizCourseId] } : {}) }), [scope, params.quizCourseId]);
  const quiz = useQuizReportQuery(tabId === 'quizzes' ? params.quizId : null, quizScope, tabId === 'quizzes');

  if (!tabId) return <Navigate to={`/reports/overview${search}`} replace />;

  const exportScope = { ...scope };
  const exportOptions: ExportOption[] =
    tabId === 'overview'
      ? [
          { label: 'Courses', hint: 'Every course with completion, overdue, scores and ratings', input: { kind: 'courses', ...exportScope } },
          { label: 'Groups', hint: 'Completion, overdue and activity by group', input: { kind: 'groups', ...exportScope } },
          { label: 'Enrollments', hint: 'Every enrollment open in the range', input: { kind: 'enrollments', ...exportScope } },
        ]
      : tabId === 'engagement'
        ? [
            { label: 'Learners', hint: 'Active days, hours, points and last learned per person', input: { kind: 'learners', ...exportScope } },
            { label: 'Enrollments', hint: 'Every enrollment open in the range', input: { kind: 'enrollments', ...exportScope } },
          ]
        : tabId === 'compliance'
          ? [{ label: 'Compliance matrix', hint: 'Everyone in scope with the status of each required item', input: { kind: 'compliance', ...complianceInput(params) } }]
          : tabId === 'courses'
            ? [
                ...(courseId ? [{ label: `Enrollments in ${ws.courseById.get(courseId)?.title ?? 'this course'}`, hint: 'Learners, status, dates, scores and time spent', input: { kind: 'enrollments' as const, ...courseScope, courseIds: [courseId] } }] : []),
                { label: 'All courses', hint: 'Every course with completion, overdue, scores and ratings', input: { kind: 'courses', ...exportScope } },
              ]
            : [
                ...(params.quizId && quiz.data?.report ? [{ label: 'Item analysis', hint: `Every question in “${quiz.data.report.title}”`, input: { kind: 'quiz' as const, ...quizScope, lessonId: params.quizId } }] : []),
                { label: 'All quizzes', hint: 'Attempts, pass rates and average scores', input: { kind: 'quiz', ...quizScope } },
              ];

  const widen = () => update({ range: '12m', from: null, to: null });
  const clear = () => update({ groupIds: [], categoryIds: [] });
  const pickedCourse = courseId ? ws.courseById.get(courseId) : undefined;
  const quizCourse = params.quizCourseId ? ws.courseById.get(params.quizCourseId) : undefined;

  let controls: ReactNode;
  let trailing: ReactNode = null;
  let body: ReactNode;

  switch (tabId) {
    case 'overview':
    case 'engagement': {
      controls = (
        <>
          <RangeControl params={params} update={update} />
          <GroupFilter value={params.groupIds} onChange={ids => update({ groupIds: ids })} />
          <CategoryFilter value={params.categoryIds} onChange={ids => update({ categoryIds: ids })} />
        </>
      );
      trailing = <RangeNote range={reports.data?.range} fetching={reports.isFetching && Boolean(reports.data)} />;
      const { data, isPending, isError, refetch, isFetching, isPlaceholderData } = reports;
      body =
        isError && !data ? (
          <LoadError what="Reports" onRetry={() => refetch()} />
        ) : isPending || !data ? (
          tabId === 'overview' ? <OverviewSkeleton /> : <EngagementSkeleton />
        ) : (
          <div className={cn('transition-opacity duration-200', isPlaceholderData && isFetching && 'opacity-60')}>
            {tabId === 'overview' ? <OverviewTab data={data} search={search} onWiden={widen} onClear={clear} filtered={filtered} /> : <EngagementTab data={data} onWiden={widen} onClear={clear} filtered={filtered} />}
          </div>
        );
      break;
    }
    case 'compliance':
      controls = <ComplianceControls params={params} update={update} />;
      trailing = <span className="hidden whitespace-nowrap text-sm text-muted-foreground md:inline">As of today</span>;
      body = <ComplianceTab params={params} update={update} />;
      break;
    case 'courses': {
      controls = (
        <>
          {ws.courses.length > 0 && (
            <CoursePicker
              value={courseId}
              onChange={id => id && update({ courseId: id })}
              trigger={
                <button type="button" className={cn(chipClass(true), 'max-w-[260px]')} aria-label="Choose a course">
                  {pickedCourse ? <CourseGlyph icon={pickedCourse.icon} color={pickedCourse.color} size={16} /> : <BookOpen className="h-3.5 w-3.5" />}
                  <span className="truncate font-medium">{pickedCourse?.title ?? 'Choose a course'}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                </button>
              }
            />
          )}
          <RangeControl params={params} update={update} />
          <GroupFilter value={params.groupIds} onChange={ids => update({ groupIds: ids })} />
        </>
      );
      trailing = <RangeNote range={course.data?.range} fetching={course.isFetching && Boolean(course.data)} />;
      body = !courseId ? (
        <NoCourses />
      ) : course.isError && !course.data ? (
        <LoadError what="The course report" onRetry={() => course.refetch()} />
      ) : course.isPending || !course.data ? (
        <CourseReportSkeleton />
      ) : (
        <CoursesTab data={course.data} stale={course.isFetching && (course.isPlaceholderData || course.data.course.id !== courseId)} onWiden={widen} />
      );
      break;
    }
    case 'quizzes': {
      const { data, isPending, isError, refetch, isFetching, isPlaceholderData } = quiz;
      const report = data?.report && data.report.lessonId === params.quizId ? data.report : null;
      controls = (
        <>
          <RangeControl params={params} update={update} />
          <GroupFilter value={params.groupIds} onChange={ids => update({ groupIds: ids })} />
          {!params.quizId && (
            <span className="inline-flex shrink-0 items-center">
              <CoursePicker
                allowNone
                noneLabel="All courses"
                value={params.quizCourseId}
                onChange={id => update({ quizCourseId: id })}
                trigger={
                  <button type="button" className={chipClass(Boolean(quizCourse))} aria-label="Filter quizzes by course">
                    {quizCourse ? <CourseGlyph icon={quizCourse.icon} color={quizCourse.color} size={16} /> : <BookOpen className="h-3.5 w-3.5" />}
                    <span className="max-w-[180px] truncate">{quizCourse?.title ?? 'Course'}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                }
              />
              {quizCourse && (
                <button type="button" aria-label="Show quizzes from every course" onClick={() => update({ quizCourseId: null })} className="-ml-1 flex h-8 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          )}
          {!params.quizId && <CategoryFilter value={params.categoryIds} onChange={ids => update({ categoryIds: ids })} />}
        </>
      );
      trailing = <RangeNote range={data?.range} fetching={isFetching && Boolean(data)} />;
      const missing = isError && /no longer exists|isn’t a quiz/i.test(String((quiz.error as Error)?.message));
      body = missing ? (
        <EmptyState
          icon={<BarChart3 />}
          title="That quiz isn’t available"
          description="It may have been deleted, or changed to another kind of lesson."
          action={
            <button type="button" onClick={() => update({ quizId: null })} className="text-[14px] font-medium text-primary hover:underline">
              See all quizzes
            </button>
          }
        />
      ) : isError && !data ? (
        <LoadError what="Quiz reports" onRetry={() => refetch()} />
      ) : params.quizId ? (
        report ? (
          <QuizDetail report={report} onBack={() => update({ quizId: null })} stale={isFetching && isPlaceholderData} onWiden={data?.range.id !== '12m' ? widen : undefined} />
        ) : (
          <QuizReportSkeleton />
        )
      ) : isPending || !data ? (
        <QuizListSkeleton />
      ) : (
        <QuizList data={data} onPick={id => update({ quizId: id })} courseFiltered={Boolean(params.quizCourseId)} stale={isFetching && isPlaceholderData} />
      );
      break;
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <style>{VIZ_STYLE}</style>
      <PageHeader
        icon={<BarChart3 />}
        title="Reports"
        tabs={TABS.map(t => ({ to: `/reports/${t.id}${search}`, label: t.label, active: t.id === tabId }))}
        actions={<ExportMenu options={exportOptions} />}
      />
      <FilterBar trailing={trailing}>{controls}</FilterBar>
      {tabId === 'compliance' ? (
        <div className="lms-viz flex min-h-0 flex-1 flex-col px-3 py-4 sm:px-6">{body}</div>
      ) : (
        <div className="lms-viz min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1240px] px-3 py-4 sm:px-6 sm:py-5">{body}</div>
        </div>
      )}
    </div>
  );
}
