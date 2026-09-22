import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getLearner } from '@project/shared/server/people';
import { byUrgency, loadMyEnrollments, loadMyPathEnrollments, type MyEnrollment, type MyPathEnrollment } from '../server/learn';

/**
 * Everything the learner is enrolled in — the latest cycle of each course and
 * path — for My learning's tabs. Withdrawn enrollments are left out: the
 * learner no longer has that training.
 */

export type MyLearningOutput = {
  enrollments: MyEnrollment[];
  paths: MyPathEnrollment[];
  counts: { inProgress: number; notStarted: number; completed: number; overdue: number; dueSoon: number };
};

export default createEndpoint({
  description: "The learner's courses and paths",
  authenticated: true,
  inputSchema: z.object({}),
  execute: async ({ context }): Promise<MyLearningOutput> => {
    const actor = await getLearner(context);
    const enrollments = await loadMyEnrollments(actor.id);
    const paths = await loadMyPathEnrollments(actor.id);

    const open = enrollments.filter(e => e.status !== 'Completed').sort(byUrgency);
    const completed = enrollments.filter(e => e.status === 'Completed').sort((a, b) => (Date.parse(b.completedAt ?? '') || 0) - (Date.parse(a.completedAt ?? '') || 0));

    return {
      // Lesson ids are only needed on a course's own page.
      enrollments: [...open, ...completed].map(e => ({ ...e, completedLessonIds: [] })),
      paths: paths.sort((a, b) => (a.status === 'Completed' ? 1 : 0) - (b.status === 'Completed' ? 1 : 0) || byUrgency(a, b)),
      counts: {
        inProgress: enrollments.filter(e => e.status === 'In progress').length,
        notStarted: enrollments.filter(e => e.status === 'Not started').length,
        completed: completed.length,
        overdue: open.filter(e => e.dueState === 'overdue').length,
        dueSoon: open.filter(e => e.dueState === 'due_soon').length,
      },
    };
  },
});
