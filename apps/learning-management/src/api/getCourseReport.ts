import { createEndpoint } from 'zitejs/backend';
import { assertStaff, getActor } from '@project/shared/server/people';
import { badInput, courseReportInput, courseReportOutput, loadCourseReport, type CourseReportOutput } from '../server/reports';

/**
 * One course in depth: where learners drop out lesson by lesson, how long it
 * takes to finish, grades, ratings and who is stuck.
 */
export default createEndpoint({
  description: 'Load a course report: lesson funnel, time to complete, grades, ratings and stuck learners',
  authenticated: true,
  inputSchema: courseReportInput,
  outputSchema: courseReportOutput,
  execute: async ({ input, context }): Promise<CourseReportOutput> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = courseReportInput.safeParse(input ?? {});
    if (!parsed.success) badInput(parsed.error, 'Choose a course to report on.');
    return loadCourseReport(parsed.data);
  },
});
