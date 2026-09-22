import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { asLessonType, parseQuizSettings } from '@project/shared/lessons';
import { assertStaff, getActor } from '@project/shared/server/people';
import { str } from '@project/shared/server/sql';
import { isConfigured, structured, truncate } from '../server/ai';
import { AI_NOT_CONFIGURED, editableLesson, questionJsonSchema, toQuizQuestions, type AiQuestion } from '../server/builder';

/**
 * Draft quiz questions from course material. The source is the lessons the
 * builder picked, else the quiz's own introduction when it's substantial,
 * else every other lesson in the course that has text. Nothing is saved: the
 * questions come back for someone to review and insert.
 */

const Input = z.object({
  lessonId: z.string().min(1),
  count: z.number().int().min(1).max(15).optional(),
  sourceLessonIds: z.array(z.string()).max(50).optional(),
  /** Question types to use; all of them when omitted. */
  types: z.array(z.enum(['single', 'multiple', 'true_false', 'short'])).max(4).optional(),
});

const Output = z.object({
  questions: z.array(z.object({
    id: z.string(),
    type: z.enum(['single', 'multiple', 'true_false', 'short']),
    prompt: z.string(),
    options: z.array(z.object({ id: z.string(), text: z.string(), correct: z.boolean() })),
    acceptedAnswers: z.array(z.string()),
    explanation: z.string(),
    points: z.number(),
  })),
  sources: z.array(z.object({ id: z.string(), title: z.string() })),
});

const SOURCE_BUDGET = 40_000;

export default createEndpoint({
  description: 'Draft quiz questions from a course’s lessons with AI',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Choose how many questions to draft', 'BAD_REQUEST');
    const { row, course } = await editableLesson(actor, parsed.data.lessonId);
    if (!isConfigured()) throw new ZiteError(AI_NOT_CONFIGURED, 'BAD_REQUEST');
    const count = parsed.data.count ?? 5;

    const { rows } = await zite.sql({
      query: `SELECT l.id::text AS id, l."title", l."type", l."body" FROM "Lessons" l LEFT JOIN "Sections" s ON s.id::text = l."sectionId"
              WHERE l."courseId" = $1 AND l.id::text <> $2 AND COALESCE(l."body", '') <> ''
              ORDER BY COALESCE(s."position", -1) ASC, COALESCE(l."position", 0) ASC`,
      params: [course.id, String(row.id)],
    });
    const own = str(row.body) ?? '';
    const picked = parsed.data.sourceLessonIds?.length ? rows.filter(r => parsed.data.sourceLessonIds!.includes(String(r.id))) : [];
    let sources: Array<{ id: string; title: string; body: string }>;
    if (picked.length) sources = picked.map(r => ({ id: String(r.id), title: str(r.title) ?? '', body: str(r.body) ?? '' }));
    else if (own.trim().length >= 400) sources = [{ id: String(row.id), title: str(row.title) ?? 'This quiz', body: own }];
    else sources = rows.filter(r => asLessonType(r.type) !== 'Quiz').map(r => ({ id: String(r.id), title: str(r.title) ?? '', body: str(r.body) ?? '' }));
    if (!sources.length) throw new ZiteError('There’s no lesson text to write questions from yet. Add some articles first, or write the quiz introduction.', 'BAD_REQUEST');

    let budget = SOURCE_BUDGET;
    const material = sources
      .map(s => {
        const take = Math.max(0, Math.min(s.body.length, budget));
        budget -= take;
        return take ? `### ${s.title}\n${s.body.slice(0, take)}` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    const existing = parseQuizSettings(row.settings).questions.map(q => q.prompt.trim()).filter(Boolean);
    const types = parsed.data.types?.length ? parsed.data.types : ['single', 'multiple', 'true_false', 'short'];
    const system = [
      'You write assessment questions for workplace training. Questions test understanding and application of the material provided — never facts that are not in it.',
      'Types: "single" (3–4 options, exactly one correct), "multiple" (4–5 options, two or more correct), "true_false" (options exactly "True" and "False"), "short" (a one- or two-word answer; list every reasonable accepted answer and leave options empty).',
      'Wrong options must be plausible. Avoid "all of the above", trick wording and negatives like "Which is NOT". Each question gets a one-sentence explanation.',
    ].join('\n');
    const prompt = [
      `Course: ${course.title}`,
      `Quiz: ${str(row.title) || 'Untitled quiz'}`,
      `Write ${count} question${count === 1 ? '' : 's'} using these types: ${types.join(', ')}.`,
      existing.length ? `The quiz already asks these — don't repeat them:\n${existing.slice(0, 30).map(p => `- ${truncate(p, 200)}`).join('\n')}` : '',
      `Material:\n\n${material}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    let result: { questions: AiQuestion[] } | null;
    try {
      result = await structured<{ questions: AiQuestion[] }>({
        system,
        prompt,
        schema: { type: 'object', additionalProperties: false, required: ['questions'], properties: { questions: { type: 'array', items: questionJsonSchema } } },
        maxTokens: 1200 + count * 350,
        effort: 'low',
      });
    } catch (e) {
      console.error('aiGenerateQuiz failed', e);
      throw new ZiteError('The AI questions didn’t come through. Try again in a moment.', 'BAD_REQUEST');
    }
    const questions = toQuizQuestions(result?.questions ?? [])
      .filter(q => types.includes(q.type))
      .slice(0, count);
    if (!questions.length) throw new ZiteError('The AI couldn’t write usable questions from this material. Try choosing different lessons.', 'BAD_REQUEST');
    return { questions, sources: sources.map(s => ({ id: s.id, title: s.title })) };
  },
});
