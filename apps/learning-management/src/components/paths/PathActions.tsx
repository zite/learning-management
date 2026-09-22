import { Archive, ArchiveRestore, ArrowRight, Check, ExternalLink, GraduationCap, Link2, Loader2, Settings, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { savePath } from 'zitejs/api';
import { ContextMenuItem, ContextMenuSeparator } from '@project/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { DropdownMenuItem, DropdownMenuSeparator } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { plural } from '../../lib/format';
import type { Path } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { CourseGlyph } from '../primitives/icons';
import { learnerUrl, StatusPill } from '../courses/CourseBits';
import { buttonClass, primaryButtonClass } from '../courses/fields';
import { useModEnter } from '../courses/useModEnter';
import { canEditPath, usePath, useRefreshPath } from './pathData';

type PathLike = Pick<Path, 'id' | 'title' | 'status' | 'publishedAt' | 'counts'>;

export function usePathLifecycle() {
  const app = useAppActions();
  const navigate = useNavigate();
  const refresh = useRefreshPath();

  async function run<T>(fn: () => Promise<T>, error: string): Promise<T | null> {
    try {
      const res = await fn();
      refresh({ enrollments: true });
      return res;
    } catch (e) {
      toast.error(errorMessage(e, error));
      return null;
    }
  }

  const unpublish = async (p: PathLike) => {
    const n = p.counts.notStarted + p.counts.inProgress;
    const ok = await app.confirm({
      title: `Unpublish ${p.title}?`,
      description: `It goes back to being a draft: it leaves the catalog and nobody new can be enrolled.${n ? ` The ${plural(n, 'person', 'people')} working through it keep their access and progress.` : ''}`,
      confirmLabel: 'Unpublish',
    });
    if (!ok) return false;
    const res = await run(() => savePath({ action: 'unpublish', id: p.id }), "Couldn't unpublish the path");
    if (res) toast.success(`${p.title} is a draft again`);
    return Boolean(res);
  };

  const archive = async (p: PathLike) => {
    const ok = await app.confirm({
      title: `Archive ${p.title}?`,
      description: 'It’s hidden from the catalog and lists, and nobody new can enroll. People on the path keep their progress and certificates. Active assignment rules for it are paused. You can unarchive it any time.',
      confirmLabel: 'Archive',
    });
    if (!ok) return false;
    const res = await run(() => savePath({ action: 'archive', id: p.id }), "Couldn't archive the path");
    if (res) toast.success(`Archived ${p.title}`, { description: res.pausedRules ? `${plural(res.pausedRules, 'assignment rule')} paused` : undefined });
    return Boolean(res);
  };

  const unarchive = async (p: PathLike) => {
    const res = await run(() => savePath({ action: 'unarchive', id: p.id }), "Couldn't unarchive the path");
    if (res) toast.success(res.status === 'Published' ? `${p.title} is back and published` : `${p.title} is back as a draft`, { description: res.status === 'Draft' && p.publishedAt ? 'Some of its courses aren’t published, so it came back as a draft.' : undefined });
    return Boolean(res);
  };

  const remove = async (p: PathLike) => {
    const total = p.counts.enrolled + p.counts.completed > 0;
    if (total) {
      const ok = await app.confirm({
        title: `${p.title} can’t be deleted`,
        description: `People have enrolled in it, so deleting it would erase their training records. Archive it instead — it disappears from the catalog and lists, and its history is kept.`,
        confirmLabel: p.status === 'Archived' ? 'OK' : 'Archive instead',
      });
      if (ok && p.status !== 'Archived') return archive(p);
      return false;
    }
    const ok = await app.confirm({ title: `Delete ${p.title}?`, description: 'The path and its course list are deleted. The courses themselves aren’t affected. This can’t be undone.', confirmLabel: 'Delete path', destructive: true });
    if (!ok) return false;
    const res = await run(() => savePath({ action: 'delete', id: p.id }), "Couldn't delete the path");
    if (res) {
      toast.success(`Deleted ${p.title}`);
      navigate('/paths');
    }
    return Boolean(res);
  };

  return { unpublish, archive, unarchive, remove };
}

export function PathMenuItems({ path, kind, onPublish, showOpen = true }: { path: Path; kind: 'context' | 'dropdown'; onPublish: (id: string) => void; showOpen?: boolean }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const life = usePathLifecycle();
  const Item = kind === 'context' ? ContextMenuItem : DropdownMenuItem;
  const Sep = kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator;
  const link = learnerUrl(ws.settings.learnUrl, 'paths', path.slug);
  const canEdit = canEditPath(ws, path);
  const cls = 'gap-2 text-[14px] [&_svg]:h-3.5 [&_svg]:w-3.5';
  return (
    <>
      {showOpen && (
        <>
          <Item className={cls} onSelect={() => navigate(`/paths/${path.id}`)}>
            <ArrowRight /> Open
          </Item>
          <Item className={cls} onSelect={() => navigate(`/paths/${path.id}/settings`)}>
            <Settings /> Settings
          </Item>
        </>
      )}
      <Item className={cls} disabled={path.status !== 'Published'} onSelect={() => app.openEnroll({ targetType: 'Path', targetId: path.id })}>
        <GraduationCap /> Enroll people{path.status !== 'Published' && <span className="ml-auto text-2xs text-muted-foreground">Publish first</span>}
      </Item>
      <Item className={cls} disabled={!link} onSelect={() => link && copyText(link, 'Learner link copied')}>
        <Link2 /> Copy learner link{!link && <span className="ml-auto hidden pl-2 text-2xs text-muted-foreground sm:inline">Open academy first</span>}
      </Item>
      {link && path.status === 'Published' && (
        <Item className={cls} onSelect={() => window.open(link, '_blank', 'noopener')}>
          <ExternalLink /> Open in the academy
        </Item>
      )}
      {canEdit && (
        <>
          <Sep />
          {path.status === 'Draft' && (
            <Item className={cls} onSelect={() => onPublish(path.id)}>
              <Sparkles /> Publish…
            </Item>
          )}
          {path.status === 'Published' && (
            <Item className={cls} onSelect={() => life.unpublish(path)}>
              <Undo2 /> Unpublish…
            </Item>
          )}
          {path.status === 'Archived' ? (
            <Item className={cls} onSelect={() => life.unarchive(path)}>
              <ArchiveRestore /> Unarchive
            </Item>
          ) : (
            <Item className={cls} onSelect={() => life.archive(path)}>
              <Archive /> Archive…
            </Item>
          )}
          <Item className={cn(cls, 'text-tone-danger focus:text-tone-danger')} onSelect={() => life.remove(path)}>
            <Trash2 /> Delete…
          </Item>
        </>
      )}
    </>
  );
}

/** Publishing a path needs courses, all of them published — this shows which aren't yet, with a link to each. */
export function PublishPathDialog({ pathId, onOpenChange }: { pathId: string | null; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const refresh = useRefreshPath();
  const { data, isPending } = usePath(pathId ?? undefined);
  const [busy, setBusy] = useState(false);
  const courses = data?.courses ?? [];
  const drafts = courses.filter(c => c.status !== 'Published');
  const blocked = !data || courses.length === 0 || drafts.length > 0;

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  const publish = async () => {
    if (!pathId || blocked || busy) return;
    setBusy(true);
    try {
      const res = await savePath({ action: 'publish', id: pathId });
      refresh({ enrollments: res.newEnrollments > 0 });
      toast.success(`Published ${data?.path.title}`, { description: res.newEnrollments ? `${plural(res.newEnrollments, 'course enrollment')} added for people already on the path.` : data?.path.visibility === 'Catalog' ? 'It’s in the catalog and ready to assign.' : 'It’s ready to assign.' });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't publish the path"));
    } finally {
      setBusy(false);
    }
  };

  useModEnter(Boolean(pathId), () => void publish());
  return (
    <Dialog open={Boolean(pathId)} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg gap-0 p-0 sm:rounded-xl"
      >
        <DialogHeader className="px-5 pb-3 pt-4">
          <DialogTitle className="text-[16px]">Publish {data?.path.title ?? ws.pathById.get(pathId ?? '')?.title ?? 'path'}?</DialogTitle>
          <DialogDescription className="text-[14px]">{data?.path.visibility === 'Private' ? 'It stays out of the catalog — people see it once they’re enrolled.' : 'It appears in the catalog and you can assign it to people and groups.'}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto px-5 pb-4">
          {isPending ? (
            <div className="skeleton h-20 w-full rounded-lg" />
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border">
              <Check2 ok={courses.length > 0} title={courses.length ? `${plural(courses.length, 'course')}${data?.path.sequential ? ', taken in order' : ', in any order'}` : 'The path has no courses yet'} action={<Fix onClick={() => go(`/paths/${pathId}/courses`)}>{courses.length ? 'Review' : 'Add courses'}</Fix>} />
              <Check2 ok={drafts.length === 0} title={drafts.length === 0 ? 'Every course is published' : `${plural(drafts.length, 'course isn’t', 'courses aren’t')} published yet`} detail={drafts.length ? 'Learners can only take published courses.' : undefined} />
              {drafts.map(c => (
                <li key={c.courseId} className="flex items-center gap-2.5 bg-subtle/40 py-2 pl-9 pr-3">
                  <CourseGlyph icon={c.icon} color={c.color} size={18} />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{c.title}</span>
                  <StatusPill status={c.status} />
                  <Fix onClick={() => go(`/courses/${c.courseId}`)}>Open</Fix>
                </li>
              ))}
              <Check2 ok neutral={!data?.path.certificateEnabled} title={data?.path.certificateEnabled ? 'Certificate when the path is complete' : 'No path certificate'} action={<Fix onClick={() => go(`/paths/${pathId}/settings?section=certificate`)}>Change</Fix>} />
            </ul>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t bg-subtle/60 px-5 py-3">
          <button type="button" onClick={() => onOpenChange(false)} className={buttonClass}>
            Cancel
          </button>
          <button type="button" onClick={publish} disabled={blocked || busy} className={primaryButtonClass}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? 'Publishing…' : 'Publish path'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Fix({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 text-sm font-medium text-primary hover:underline">
      {children}
    </button>
  );
}

function Check2({ ok, neutral, title, detail, action }: { ok: boolean; neutral?: boolean; title: string; detail?: string; action?: ReactNode }) {
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
