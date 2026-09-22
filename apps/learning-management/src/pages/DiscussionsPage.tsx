import { MessagesSquare } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { asFilter, FILTERS, type DiscussionList } from '../components/discussions/discussionsData';
import { DiscussionsWorkspace } from '../components/discussions/DiscussionsWorkspace';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useWorkspace } from '../lib/workspace';

export function DiscussionsPage() {
  const ws = useWorkspace();
  const [params] = useSearchParams();
  const filter = asFilter(params.get('tab'));
  const [counts, setCounts] = useState<DiscussionList['counts'] | undefined>();
  const open = counts?.unanswered ?? ws.counts.openQuestions;
  useDocumentTitle(open ? `Discussions (${open})` : 'Discussions');

  const tabTo = (value: string) => {
    const p = new URLSearchParams();
    if (value !== 'unanswered') p.set('tab', value);
    const course = params.get('course');
    if (course) p.set('course', course);
    const s = p.toString();
    return `/discussions${s ? `?${s}` : ''}`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<MessagesSquare />}
        title="Discussions"
        tabs={FILTERS.map(f => ({ to: tabTo(f.value), label: f.label, count: f.value === 'unanswered' ? open : counts?.[f.value], active: filter === f.value }))}
      />
      <div className="flex min-h-0 flex-1">
        <DiscussionsWorkspace filter={filter} onCounts={setCounts} />
      </div>
    </div>
  );
}
