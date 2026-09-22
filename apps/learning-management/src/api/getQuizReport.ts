import { createEndpoint } from 'zitejs/backend';
import { assertStaff, getActor } from '@project/shared/server/people';
import { badInput, loadQuizReport, quizReportInput, quizReportOutput, type QuizReportOutput } from '../server/reports';

/**
 * Quizzes: every quiz with its pass rates, and — for one quiz — score and
 * attempt distributions plus item analysis graded against the questions as
 * they are now.
 */
export default createEndpoint({
  description: 'Load quiz pass rates, and item analysis for one quiz',
  authenticated: true,
  inputSchema: quizReportInput,
  outputSchema: quizReportOutput,
  execute: async ({ input, context }): Promise<QuizReportOutput> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = quizReportInput.safeParse(input ?? {});
    if (!parsed.success) badInput(parsed.error);
    return loadQuizReport(parsed.data);
  },
});
