import { Archive, BellOff, CheckCheck, Mail, MailOpen } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { updateMyNotifications } from 'zitejs/api';
import { NotificationRow } from '../components/Layout';
import { LoadError, Tabs, PageHeader } from '../components/kit';
import { Button, Card, Container, EmptyState, Skeleton, Tip } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { useNotificationActions, useNotifications, type LearnNotification } from '../lib/learn';
import { qk } from '../lib/queries';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [limit, setLimit] = useState(50);
  const q = useNotifications(filter, limit);
  const actions = useNotificationActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useDocumentTitle('Notifications');

  const run = (action: 'read' | 'unread' | 'archive' | 'read_all', ids: string[] = []) =>
    actions.mutate(
      { action, ids },
      {
        onSuccess: () => {
          if (action === 'archive')
            toast.success('Notification archived.', {
              action: { label: 'Undo', onClick: () => undoArchive(ids) },
            });
          if (action === 'read_all') toast.success('Everything is marked as read.');
        },
        onError: e => toast.error(errorMessage(e, "That didn't save. Try again.")),
      },
    );

  const undoArchive = (ids: string[]) =>
    updateMyNotifications({ action: 'unarchive', ids })
      .then(() => {
        void qc.invalidateQueries({ queryKey: qk.notificationsRoot });
        void qc.invalidateQueries({ queryKey: qk.me });
      })
      .catch(e => toast.error(errorMessage(e, "That couldn't be undone. Try again.")));

  const open = (n: LearnNotification) => {
    if (!n.readAt) run('read', [n.id]);
    if (n.link) navigate(n.link);
  };

  const unread = q.data?.unreadCount ?? 0;

  return (
    <div>
      <PageHeader size="narrow"
        title="Notifications"
        description="Assignments, reminders, grades, certificates and replies."
        actions={
          unread > 0 ? (
            <Button variant="secondary" onClick={() => run('read_all')} disabled={actions.isPending}>
              <CheckCheck /> Mark all read
            </Button>
          ) : undefined
        }
      >
        <Tabs
          className="mt-6 border-b-0"
          label="Show"
          value={filter}
          onChange={v => {
            setFilter(v);
            setLimit(50);
          }}
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread', count: unread || undefined },
          ]}
        />
      </PageHeader>
      <Container size="narrow" className="py-8 sm:py-10">
        {q.isPending ? (
          <div className="divide-y rounded-xl border bg-card" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 px-4 py-4 sm:px-5">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} title="Notifications didn't load" />
        ) : q.data.items.length === 0 ? (
          <Card>
            <EmptyState
              icon={BellOff}
              title={filter === 'unread' ? 'You’re all caught up' : 'No notifications yet'}
              action={
                filter === 'unread' ? (
                  <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>
                    Show all notifications
                  </Button>
                ) : undefined
              }
            >
              {filter === 'unread' ? 'Nothing unread. New notifications will appear here.' : 'When you’re assigned training, earn a certificate or get a reply, you’ll hear about it here.'}
            </EmptyState>
          </Card>
        ) : (
          <>
            <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-live="polite">
              {q.data.items.map(n => (
                <li key={n.id}>
                  <NotificationRow
                    n={n}
                    onOpen={() => open(n)}
                    trailing={
                      <>
                        <Tip label={n.readAt ? 'Mark as unread' : 'Mark as read'}>
                          <button
                            type="button"
                            onClick={() => run(n.readAt ? 'unread' : 'read', [n.id])}
                            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                            aria-label={n.readAt ? `Mark “${n.title}” as unread` : `Mark “${n.title}” as read`}
                          >
                            {n.readAt ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
                          </button>
                        </Tip>
                        <Tip label="Archive">
                          <button
                            type="button"
                            onClick={() => run('archive', [n.id])}
                            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                            aria-label={`Archive “${n.title}”`}
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        </Tip>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
            {q.data.total > q.data.items.length && (
              <div className="mt-6 flex justify-center">
                {limit < 100 ? (
                  <Button variant="secondary" onClick={() => setLimit(l => Math.min(100, l + 50))}>
                    Show older notifications
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">Showing your latest 100. Archive a few to see older ones.</p>
                )}
              </div>
            )}
          </>
        )}
      </Container>
    </div>
  );
}
