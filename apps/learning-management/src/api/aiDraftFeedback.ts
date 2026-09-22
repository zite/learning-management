import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseAssignmentSettings } from '@project/shared/lessons';
import { firstName } from '@project/shared/merge';
import { assertStaff, canEditCourse, getActor } from '@project/shared/server/people';
import { numOrNull, ref, str } from '@project/shared/server/sql';
import { isConfigured, structured, truncate } from '../server/ai';
import { parseFiles } from '../server/grading';

/**
 * A first draft of grading feedback from Claude, for the grader to edit. It
 * reads the assignment's instructions, the private rubric and the learner's
 * work. Advisory only: nothing is saved until the grader chooses an outcome.
 */

const Input = z.object({ submissionId: z.string().min(1) });

const Output = z.object({
  suggestedGrade: z.number(),
  outcome: z.enum(['Passed', 'Needs revision']),
  feedback: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
});

type Draft = z.infer<typeof Output>;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestedGrade', 'outcome', 'feedback', 'strengths', 'improvements'],
  properties: {
    suggestedGrade: { type: 'integer', description: 'A grade from 0 to 100, judged against the rubric.' },
    outcome: { type: 'string', enum: ['Passed', 'Needs revision'] },
    feedback: { type: 'string', description: 'Feedback addressed to the learner: warm, specific, 2–5 sentences, referencing the rubric criteria.' },
    strengths: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short phrases on what the work does well.' },
    improvements: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short, actionable phrases on what to improve.' },
  },
};

export default createEndpoint({
  description: 'Draft a suggested grade and feedback for an assignment submission with AI, for the grader to review',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<Draft> => {
    const actor = await getActor(context);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which submission?', 'BAD_REQUEST');
    assertStaff(actor);
    if (!isConfigured()) throw new ZiteError('AI suggestions aren’t set up for this workspace. Connect Anthropic to turn them on.', 'BAD_REQUEST');

    const { rows } = await zite.sql({
      query: `SELECT s."body", s."files", s."attempt", s."status", p."name" AS "personName", l."title" AS "lessonTitle", l."body" AS "lessonBody", l."settings" AS "lessonSettings",
                c."title" AS "courseTitle", c."ownerId", c."instructorIds"
              FROM "Submissions" s LEFT JOIN "People" p ON p.id::text = s."personId" LEFT JOIN "Lessons" l ON l.id::text = s."lessonId" LEFT JOIN "Courses" c ON c.id::text = s."courseId"
              WHERE s.id::text = $1`,
      params: [parsed.data.submissionId],
    });
    const r = rows[0];
    if (!r) throw new ZiteError('That submission no longer exists', 'NOT_FOUND');
    if (!canEditCourse(actor, { ownerId: ref(r.ownerId), instructorIds: r.instructorIds })) throw new ZiteError(`Only the course owner, its instructors or an admin can grade work in “${str(r.courseTitle) ?? 'this course'}”`, 'FORBIDDEN');

    const settings = parseAssignmentSettings(r.lessonSettings);
    const { rows: earlier } = await zite.sql({
      query: `SELECT "attempt", "grade", "feedback" FROM "Submissions" WHERE "personId" = (SELECT "personId" FROM "Submissions" WHERE id::text = $1) AND "lessonId" = (SELECT "lessonId" FROM "Submissions" WHERE id::text = $1) AND id::text <> $1 AND COALESCE("feedback", '') <> '' ORDER BY COALESCE("attempt", 1) ASC LIMIT 3`,
      params: [parsed.data.submissionId],
    });
    const body = str(r.body) ?? '';
    const files = parseFiles(r.files);
    const learner = firstName(str(r.personName)) || 'the learner';

    const prompt = [
      `Course: ${str(r.courseTitle) ?? ''}`,
      `Assignment: ${str(r.lessonTitle) ?? ''}`,
      `Passing grade: ${settings.passingGrade} out of 100`,
      `\n<instructions>\n${truncate(str(r.lessonBody), 2500) || 'No written instructions.'}\n</instructions>`,
      `\n<rubric_for_graders>\n${settings.rubric.trim() ? settings.rubric.slice(0, 3000) : 'No rubric. Judge against the instructions.'}\n</rubric_for_graders>`,
      earlier.length ? `\n<earlier_feedback>\n${earlier.map(e => `Attempt ${e.attempt ?? 1}${numOrNull(e.grade) != null ? ` (grade ${e.grade})` : ''}: ${truncate(str(e.feedback), 500)}`).join('\n')}\n</earlier_feedback>` : '',
      `\n<submission attempt="${Number(r.attempt) || 1}" learner_first_name="${learner}">\n${body.trim() ? body.slice(0, 8000) : '(No written response.)'}\n</submission>`,
      files.length ? `Attached files (not readable here, mention them only if relevant): ${files.map(f => f.name).join(', ')}` : '',
      `\nSuggest a grade and outcome. Use "Passed" only when the grade is at or above ${settings.passingGrade}. Write the feedback to ${learner} directly, in plain language, 2–5 sentences: name one specific thing they did well and, if it needs work, exactly what to change. Reference the rubric criteria without quoting it verbatim. No greeting or sign-off.`,
    ]
      .filter(Boolean)
      .join('\n');

    let draft: Draft | null = null;
    try {
      draft = await structured<Draft>({
        system: 'You help workplace trainers grade assignments fairly and give encouraging, concrete feedback. The grader reviews and edits everything you suggest.',
        prompt,
        schema: SCHEMA,
        maxTokens: 1200,
      });
    } catch (e) {
      console.error('aiDraftFeedback failed', e instanceof Error ? e.message : e);
      throw new ZiteError('The AI suggestion didn’t come through. Try again in a moment.', 'BAD_REQUEST');
    }
    if (!draft) throw new ZiteError('The AI couldn’t suggest feedback for this submission. Grade it yourself.', 'BAD_REQUEST');

    const grade = Math.max(0, Math.min(100, Math.round(Number(draft.suggestedGrade) || 0)));
    return {
      suggestedGrade: grade,
      outcome: grade >= settings.passingGrade ? 'Passed' : 'Needs revision',
      feedback: String(draft.feedback ?? '').trim(),
      strengths: (draft.strengths ?? []).map(String).filter(Boolean).slice(0, 3),
      improvements: (draft.improvements ?? []).map(String).filter(Boolean).slice(0, 3),
    };
  },
});
