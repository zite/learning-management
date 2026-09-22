import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatMinutes } from '@project/shared/lessons';
import { refreshCourseMinutes } from '@project/shared/server/courses';
import { assertStaff, getActor } from '@project/shared/server/people';
import { eachWrite, str, withRetry } from '@project/shared/server/sql';
import { isConfigured, structured, truncate } from '../server/ai';
import {
  AI_NOT_CONFIGURED, currentOrder, editableCourse, lessonImpact, questionJsonSchema, removeLessons, syncCourseProgress, writeCourseDraft, writeOutline, type CourseDraft,
} from '../server/builder';

/**
 * Draft a course outline with Claude and APPEND it: sections of articles with
 * real Markdown bodies, a practical checklist and, optionally, a final quiz.
 * Existing lessons are never touched. The course summary, objectives and
 * skills are filled in only where they're empty.
 *
 * `undo` removes exactly what a draft added (and the summary fields it
 * filled), as long as nobody has made progress on those lessons yet.
 */

const Input = z.object({
  courseId: z.string().min(1),
  topic: z.string().max(2000).optional(),
  audience: z.string().max(500).optional(),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
  length: z.enum(['short', 'standard', 'deep']).optional(),
  includeQuiz: z.boolean().optional(),
  undo: z
    .object({ sectionIds: z.array(z.string()).max(50), lessonIds: z.array(z.string()).max(200), filled: z.array(z.enum(['summary', 'objectives', 'skills'])).max(3) })
    .optional(),
});

const Output = z.object({
  sectionIds: z.array(z.string()),
  lessonIds: z.array(z.string()),
  lessonCount: z.number(),
  minutes: z.number(),
  filled: z.array(z.enum(['summary', 'objectives', 'skills'])),
  sections: z.array(z.object({ id: z.string(), title: z.string(), lessons: z.array(z.object({ id: z.string(), title: z.string(), type: z.string() })) })),
});

const SHAPE = {
  short: { sections: '2', lessons: '4 to 5 lessons in total', words: '250–400 words', maxTokens: 8000 },
  standard: { sections: '3 or 4', lessons: '7 to 9 lessons in total', words: '300–500 words', maxTokens: 14000 },
  deep: { sections: '5 or 6', lessons: '11 to 14 lessons in total', words: '350–550 words', maxTokens: 20000 },
} as const;

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'objectives', 'skills', 'sections'],
  properties: {
    summary: { type: 'string', description: 'One sentence (under 160 characters) telling a learner what they will be able to do.' },
    objectives: { type: 'array', description: '3 to 5 learning objectives, each starting with a verb.', items: { type: 'string' } },
    skills: { type: 'array', description: '2 to 5 short skill tags, e.g. "Conflict resolution".', items: { type: 'string' } },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'lessons'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string', description: 'One sentence about what this section covers.' },
          lessons: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'title', 'durationMinutes', 'body', 'checklistItems', 'questions'],
              properties: {
                type: { type: 'string', enum: ['Article', 'Checklist', 'Quiz'] },
                title: { type: 'string' },
                durationMinutes: { type: 'integer', description: 'Realistic minutes to complete.' },
                body: { type: 'string', description: 'Markdown. For an Article: the full lesson. For a Checklist or Quiz: a short introduction (1–3 sentences).' },
                checklistItems: { type: 'array', description: 'Checklist lessons only: 4 to 8 concrete actions. Empty for other types.', items: { type: 'string' } },
                questions: { type: 'array', description: 'Quiz lessons only. Empty for other types.', items: questionJsonSchema },
              },
            },
          },
        },
      },
    },
  },
} as const;

export default createEndpoint({
  description: 'Draft sections and lessons for a course with AI, or undo a draft',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError(parsed.error.issues[0]?.message ?? 'Describe what the course should cover', 'BAD_REQUEST');
    const data = parsed.data;
    const course = await editableCourse(actor, data.courseId);

    if (data.undo) {
      const [{ rows: lessons }, { rows: sections }] = await Promise.all([
        zite.sql({ query: `SELECT id::text AS id FROM "Lessons" WHERE "courseId" = $1 AND id::text = ANY($2::text[])`, params: [course.id, data.undo.lessonIds] }),
        zite.sql({ query: `SELECT id::text AS id FROM "Sections" WHERE "courseId" = $1 AND id::text = ANY($2::text[])`, params: [course.id, data.undo.sectionIds] }),
      ]);
      const lessonIds = lessons.map(r => String(r.id));
      const impact = await lessonImpact(lessonIds);
      if (impact.learners > 0) throw new ZiteError('Learners have already started some of these lessons, so the draft can’t be undone. Delete lessons one by one instead.', 'CONFLICT');
      await removeLessons(course.id, lessonIds);
      // Lessons someone added to a drafted section since stay, outside any section.
      const order = await currentOrder(course.id);
      const sectionIds = sections.map(r => String(r.id));
      for (const sid of sectionIds) {
        const kept = order.groups.get(sid) ?? [];
        if (kept.length) order.groups.set(null, [...(order.groups.get(null) ?? []), ...kept]);
        order.groups.delete(sid);
      }
      await writeOutline(course.id, order);
      await eachWrite(sectionIds, id => zite.sections.delete({ id }));
      await writeOutline(course.id, await currentOrder(course.id));
      const clear: Record<string, unknown> = {};
      if (data.undo.filled.includes('summary')) clear.summary = '';
      if (data.undo.filled.includes('objectives')) clear.objectives = '[]';
      if (data.undo.filled.includes('skills')) clear.skills = '[]';
      if (Object.keys(clear).length) await withRetry(() => zite.courses.update({ id: course.id, record: clear }));
      await refreshCourseMinutes(course.id);
      await syncCourseProgress(course.id, 'progress');
      return { sectionIds: [], lessonIds: [], lessonCount: 0, minutes: 0, filled: [], sections: [] };
    }

    if (!isConfigured()) throw new ZiteError(AI_NOT_CONFIGURED, 'BAD_REQUEST');
    const topic = (data.topic ?? '').trim() || course.title;
    if (!topic) throw new ZiteError('Describe what the course should cover', 'BAD_REQUEST');
    const length = data.length ?? 'standard';
    const shape = SHAPE[length];
    const includeQuiz = data.includeQuiz ?? true;

    const { rows: existing } = await zite.sql({
      query: `SELECT l."title", l."type", COALESCE(s."title", '') AS "sectionTitle" FROM "Lessons" l LEFT JOIN "Sections" s ON s.id::text = l."sectionId" WHERE l."courseId" = $1 ORDER BY COALESCE(s."position", -1), COALESCE(l."position", 0) LIMIT 80`,
      params: [course.id],
    });
    const existingOutline = existing.map(r => `- ${str(r.sectionTitle) ? `${str(r.sectionTitle)} › ` : ''}${str(r.title)} (${str(r.type)})`).join('\n');

    const system = [
      'You are an instructional designer writing workplace training for an internal learning platform.',
      'Write in plain, warm, specific language for adults at work. Prefer concrete examples, short paragraphs, and "you".',
      'Articles are complete lessons in GitHub-flavoured Markdown: start with a one- or two-sentence hook (no title heading — the lesson title is shown separately), then use ## headings, bulleted or numbered lists, a worked example or short scenario, and a brief "Key takeaways" list at the end. Tables are welcome where they help. Never use raw HTML or images.',
      'Never invent statistics, laws or company policies as facts; where a policy would differ by organization, say "check your organization’s policy".',
      'Quiz questions test understanding and application, not trivia. Types: "single" (exactly one correct option, 3–4 options), "multiple" (two or more correct options, 4–5 options), "true_false" (options must be exactly "True" and "False"), "short" (a one- or two-word answer; list every reasonable accepted spelling in acceptedAnswers and leave options empty). Every question has a one-sentence explanation. Points are 1.',
    ].join('\n');

    const prompt = [
      `Draft ${existing.length ? 'additional content for' : 'the content of'} a course.`,
      `Course title: ${course.title || '(untitled)'}`,
      course.summary ? `Current summary: ${truncate(course.summary, 400)}` : '',
      course.description ? `Description: ${truncate(course.description, 1200)}` : '',
      `What it should cover: ${truncate(topic, 1500)}`,
      data.audience ? `Audience: ${truncate(data.audience, 400)}` : '',
      `Level: ${data.level ?? course.level ?? 'Beginner'}`,
      existingOutline ? `The course already has these lessons — don't repeat them, build on them:\n${existingOutline}` : '',
      '',
      `Shape: ${shape.sections} sections, ${shape.lessons}. Mostly Article lessons of ${shape.words} each.`,
      'Include exactly one Checklist lesson with practical steps learners take on the job, in whichever section it fits best.',
      includeQuiz ? 'End the LAST section with one Quiz lesson of 5 to 8 questions covering the whole draft, mixing at least three question types.' : 'Do not include any Quiz lessons.',
    ]
      .filter(Boolean)
      .join('\n');

    let draft: CourseDraft | null;
    try {
      draft = await structured<CourseDraft>({ system, prompt, schema, maxTokens: shape.maxTokens, effort: 'low' });
    } catch (e) {
      console.error('aiGenerateCourse failed', e);
      throw new ZiteError('The AI draft didn’t come through. Try again, or choose a shorter course.', 'BAD_REQUEST');
    }
    if (!draft || !Array.isArray(draft.sections) || !draft.sections.length) throw new ZiteError('The AI couldn’t draft this course. Try describing the topic differently.', 'BAD_REQUEST');

    const written = await writeCourseDraft(course, draft);
    if (!written.lessonIds.length) throw new ZiteError('The AI couldn’t draft this course. Try describing the topic differently.', 'BAD_REQUEST');
    console.log(`aiGenerateCourse: ${course.title} +${written.lessonCount} lessons (${formatMinutes(written.minutes)})`);
    return written;
  },
});
