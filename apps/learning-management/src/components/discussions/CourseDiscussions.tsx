import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DiscussionFilter } from './discussionsData';
import { DiscussionsWorkspace } from './DiscussionsWorkspace';

/**
 * A course's Discussions tab: the same threads-and-conversation workspace as
 * the Discussions page, locked to this course, with its own filter tabs since
 * it sits under the course's header.
 */
export function CourseDiscussions({ courseId }: { courseId: string }) {
  const [filter, setFilter] = useState<DiscussionFilter>('all');
  const [, setParams] = useSearchParams();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <DiscussionsWorkspace
        lockedCourseId={courseId}
        filter={filter}
        onFilter={f => {
          setFilter(f);
          setParams(p => {
            p.delete('thread');
            return p;
          }, { replace: true });
        }}
      />
    </div>
  );
}
