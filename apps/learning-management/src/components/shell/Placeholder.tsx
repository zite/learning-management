import { Construction } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '../primitives/bits';
import { PageHeader, useDocumentTitle } from './PageHeader';

/** Temporary page body while a feature area is being built. Removed before launch. */
export function Placeholder({ title, icon }: { title: string; icon?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader icon={icon} title={title} />
      <EmptyState icon={<Construction />} title={`${title} is being built`} description="This area is under construction." />
    </div>
  );
}
