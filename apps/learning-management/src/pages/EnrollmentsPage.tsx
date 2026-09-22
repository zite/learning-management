import { Layers, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { saveView } from 'zitejs/api';
import { EnrollmentsView } from '../components/enrollments/EnrollmentsView';
import { parseViewConfig } from '../components/enrollments/view';
import { IconButton, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';
import { qk } from '../lib/queries';
import type { EnrollmentFilters } from '../lib/types';
import { useWorkspace } from '../lib/workspace';

/** Every enrollment across the organization. Deep links like `?due=overdue` or `?stalled=1` preset the filters. */
export function EnrollmentsPage() {
  useDocumentTitle('Enrollments');
  const [params] = useSearchParams();
  const defaultFilters = useMemo<EnrollmentFilters>(() => {
    const f: EnrollmentFilters = {};
    const due = params.get('due');
    if (due === 'overdue' || due === 'due_soon') f.due = [due];
    if (params.get('stalled')) Object.assign(f, { inactiveDays: 14, statuses: ['In progress'] });
    return f;
  }, [params]);
  const surfaceKey = `enrollments${params.toString() ? `?${params.toString()}` : ''}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader icon={<Layers />} title="Enrollments" />
      <EnrollmentsView surfaceKey={surfaceKey} defaultFilters={defaultFilters} defaults={{ groupBy: 'none' }} />
    </div>
  );
}

export function ViewPage() {
  const { viewId } = useParams();
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const view = viewId ? ws.viewById.get(viewId) : undefined;
  useDocumentTitle(view?.name ?? 'View');
  const parsed = useMemo(() => parseViewConfig(view?.config), [view?.config]);
  if (!view) return <Navigate to="/enrollments" replace />;
  const canEdit = view.ownerId === ws.me.id || ws.isAdmin;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<Layers />}
        title={view.name}
        breadcrumb={{ to: '/enrollments', label: 'Enrollments' }}
        actions={
          <>
            <span className="mr-1 hidden text-sm text-muted-foreground sm:inline">{view.scope === 'Shared' ? 'Shared view' : 'Personal view'}</span>
            {canEdit && (
              <Tip label="Delete view">
                <IconButton
                  aria-label="Delete view"
                  onClick={async () => {
                    if (!(await app.confirm({ title: `Delete “${view.name}”?`, description: view.scope === 'Shared' ? 'It disappears from everyone’s sidebar. The enrollments themselves are not affected.' : 'The enrollments themselves are not affected.', confirmLabel: 'Delete view', destructive: true }))) return;
                    try {
                      await saveView({ id: view.id, delete: true });
                      await qc.invalidateQueries({ queryKey: qk.bootstrap });
                      navigate('/enrollments');
                      toast.success('View deleted');
                    } catch (e) {
                      toast.error(errorMessage(e, "Couldn't delete the view"));
                    }
                  }}
                >
                  <Trash2 />
                </IconButton>
              </Tip>
            )}
          </>
        }
      />
      <EnrollmentsView surfaceKey={`view:${view.id}`} defaultFilters={parsed.filters} defaults={parsed.options} savedView={canEdit ? { id: view.id, name: view.name, scope: view.scope } : null} />
    </div>
  );
}
