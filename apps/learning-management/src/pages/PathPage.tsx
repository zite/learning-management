import { ExternalLink, GraduationCap, MoreHorizontal, Route } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { LifecycleBanner } from '../components/courses/CourseActions';
import { learnerUrl, StatusPill } from '../components/courses/CourseBits';
import { PathMenuItems, PublishPathDialog, usePathLifecycle } from '../components/paths/PathActions';
import { PathCourses } from '../components/paths/PathCourses';
import { PathLearners } from '../components/paths/PathLearners';
import { PathSettings } from '../components/paths/PathSettings';
import { usePath } from '../components/paths/pathData';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { CourseGlyph } from '../components/primitives/icons';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';
import { useWorkspace } from '../lib/workspace';

const TABS = ['courses', 'learners', 'settings'] as const;
type Tab = (typeof TABS)[number];

/** One learning path: its ordered courses, the people on it, and its settings. */
export function PathPage() {
  const { pathId = '', tab: rawTab } = useParams();
  const ws = useWorkspace();
  const app = useAppActions();
  const life = usePathLifecycle();
  const { data, isPending, isError, error, refetch } = usePath(pathId);
  const [publishing, setPublishing] = useState<string | null>(null);
  const listed = ws.pathById.get(pathId);
  const tab: Tab | null = rawTab === undefined ? 'courses' : (TABS as readonly string[]).includes(rawTab) ? (rawTab as Tab) : null;
  useDocumentTitle(data?.path.title ?? listed?.title ?? 'Learning path');

  if (tab === null) return <Navigate to={`/paths/${pathId}`} replace />;

  const notFound = isError && /not found|no longer exists|\(404\)/i.test(String((error as Error)?.message ?? ''));
  if (notFound || (!isPending && !data && !listed)) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader icon={<Route />} title="Path not found" breadcrumb={{ to: '/paths', label: 'Learning paths' }} />
        <EmptyState
          className="py-24"
          icon={<Route />}
          title="This learning path doesn’t exist"
          description="It may have been deleted, or the link is wrong. Archived paths are still listed under Learning paths → Archived."
          action={
            <Link to="/paths" className="flex h-9 items-center rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
              Back to learning paths
            </Link>
          }
        />
      </div>
    );
  }

  const path = data?.path;
  const title = path?.title ?? listed?.title ?? '';
  const status = path?.status ?? listed?.status ?? 'Draft';
  const learnLink = learnerUrl(ws.settings.learnUrl, 'paths', path?.slug ?? listed?.slug ?? '');
  const preview = status === 'Published' ? learnLink : null;
  // The academy address is recorded the first time someone opens the learner app, so until then there's nowhere to link to.
  const previewTip = !learnLink
    ? `Open ${ws.settings.academyName} once after publishing — then this opens the path as learners see it`
    : status !== 'Published'
      ? `Learners can’t open ${status === 'Draft' ? 'a draft' : 'an archived'} path — publish it to see it in ${ws.settings.academyName}`
      : `Open in ${ws.settings.academyName}, as learners see it`;
  const canEdit = data?.canEdit ?? false;
  const base = `/paths/${pathId}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<CourseGlyph icon={path?.icon ?? listed?.icon} color={path?.color ?? listed?.color} size={18} />}
        breadcrumb={{ to: '/paths', label: 'Learning paths' }}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{title || <span className="skeleton inline-block h-3.5 w-40 align-middle" />}</span>
            {status !== 'Published' && <StatusPill status={status} className="hidden sm:inline-flex" />}
          </span>
        }
        tabs={[
          { to: `${base}/courses`, label: 'Courses', count: data?.courses.length ?? listed?.courseIds.length, active: tab === 'courses' },
          { to: `${base}/learners`, label: 'Learners', count: data?.counts.enrolled ?? listed?.counts.enrolled, active: tab === 'learners' },
          { to: `${base}/settings`, label: 'Settings', active: tab === 'settings' },
        ]}
        actions={
          <>
            <Tip label={previewTip}>
              <span className="hidden sm:inline-flex">
                {preview ? (
                  <a href={preview} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs transition-colors hover:bg-accent">
                    <ExternalLink className="h-3.5 w-3.5" /> Preview
                  </a>
                ) : (
                  <button type="button" aria-disabled="true" aria-label={`Preview — ${previewTip}`} onClick={e => e.preventDefault()} className="flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] text-muted-foreground">
                    <ExternalLink className="h-3.5 w-3.5" /> Preview
                  </button>
                )}
              </span>
            </Tip>
            <Tip label={status === 'Published' ? 'Enroll people in this path' : 'Publish the path before enrolling people'}>
              <span className="inline-flex">
                <button type="button" disabled={status !== 'Published'} onClick={() => app.openEnroll({ targetType: 'Path', targetId: pathId })} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50 sm:px-2.5">
                  <GraduationCap className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Enroll people</span>
                </button>
              </span>
            </Tip>
            {listed && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton aria-label="Path actions">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <PathMenuItems path={listed} kind="dropdown" onPublish={setPublishing} showOpen={false} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      {listed && <LifecycleBanner kind="path" status={status} canEdit={canEdit} onPublish={() => setPublishing(pathId)} onUnarchive={() => life.unarchive(listed)} />}

      {isError && !notFound ? (
        <EmptyState icon={<Route />} title="Couldn't load the path" description={errorMessage(error, 'Check your connection and try again.')} action={<button type="button" onClick={() => refetch()} className="text-[14px] text-primary hover:underline">Retry</button>} />
      ) : !data ? (
        <div className="p-4">
          <SkeletonRows rows={6} />
        </div>
      ) : tab === 'learners' ? (
        <PathLearners detail={data} />
      ) : tab === 'settings' ? (
        <PathSettings detail={data} onPublish={() => setPublishing(pathId)} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PathCourses detail={data} />
        </div>
      )}
      <PublishPathDialog pathId={publishing} onOpenChange={o => !o && setPublishing(null)} />
    </div>
  );
}
