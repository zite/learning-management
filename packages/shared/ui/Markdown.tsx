import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@project/components/lib/utils';

/**
 * Markdown for program pages, instructions and help text. Raw HTML is never
 * rendered, and links always open in a new tab so an applicant mid-form never
 * loses their place.
 */
export function Markdown({ children, className, compact }: { children: string | null | undefined; className?: string; compact?: boolean }) {
  if (!children?.trim()) return null;
  return (
    <div className={cn(compact ? 'md-compact' : 'prose-lms', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-primary underline-offset-2 hover:underline">
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function fileSize(bytes: number | null | undefined) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
