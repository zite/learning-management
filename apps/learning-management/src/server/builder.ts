import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { asLessonType, LESSON_TYPES, newId, parseChecklistSettings, parseQuizSettings, parseSettings } from '@project/shared/lessons';
import { courseProgress } from '@project/shared/progress';
import { loadCourse, loadOutline, refreshCourseMinutes, type CourseRecord } from '@project/shared/server/courses';
import { recomputeEnrollment } from '@project/shared/server/enroll';
import { assertCanEditCourse, type Actor } from '@project/shared/server/people';
import { bool, eachWrite, iso, num, numOrNull, ref, str, withRetry } from '@project/shared/server/sql';

/**
 * The course builder's server side: outline positions, lesson rows in the
 * exact shape `getCourse` sends (so the client can drop a saved lesson
 * straight into its cache), cleanup when lessons go away, and keeping active
 * enrollments' derived progress honest after the outline changes.
 */

// ── Shapes ────────────────────────────────────────────────────────────────

export const lessonSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(LESSON_TYPES),
  sectionId: z.string().nullable(),
  position: z.number(),
  body: z.string(),
  mediaUrl: z.string().nullable(),
  mediaName: z.string().nullable(),
  settings: z.record(z.string(), z.any()),
  durationMinutes: z.number(),
  optional: z.boolean(),
  updatedAt: z.string().nullable(),
  completedCount: z.number(),
});
export type BuilderLesson = z.infer<typeof lessonSchema>;

export const sectionSchema = z.object({ id: z.string(), title: z.string(), description: z.string(), position: z.number() });
export type BuilderSection = z.infer<typeof sectionSchema>;

/** Where everything sits after a structural change, so the client can settle its optimistic outline. */
export const positionsSchema = z.object({
  sections: z.array(z.object({ id: z.string(), position: z.number() })),
  lessons: z.array(z.object({ id: z.string(), sectionId: z.string().nullable(), position: z.number() })),
});
export type OutlinePositions = z.infer<typeof positionsSchema>;

export const LESSON_TYPE_ENUM = z.enum(LESSON_TYPES);

// ── Access ────────────────────────────────────────────────────────────────

export async function editableCourse(actor: Actor, courseId: string): Promise<CourseRecord> {
  const course = await loadCourse(courseId);
  if (!course) throw new ZiteError('That course no longer exists', 'NOT_FOUND');
  assertCanEditCourse(actor, course);
  return course;
}

/** The lesson and the course it belongs to, checking the actor may edit it. */
export async function editableLesson(actor: Actor, lessonId: string) {
  const row = await loadLessonRow(lessonId);
  if (!row) throw new ZiteError('That lesson no longer exists. It may have been deleted.', 'NOT_FOUND');
  const course = await editableCourse(actor, String(row.courseId ?? ''));
  return { row, course };
}

// ── Reading ───────────────────────────────────────────────────────────────

export async function loadLessonRow(id: string): Promise<Record<string, unknown> | null> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Lessons" WHERE id::text = $1 LIMIT 1`, params: [id] });
  return rows[0] ?? null;
}

async function sectionIdsOf(courseId: string) {
  const { rows } = await zite.sql({ query: `SELECT id::text AS id FROM "Sections" WHERE "courseId" = $1`, params: [courseId] });
  return new Set(rows.map(r => String(r.id)));
}

export async function completedCount(lessonId: string) {
  const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "doneTotal" FROM "LessonProgress" WHERE "lessonId" = $1 AND "status" = 'Completed'`, params: [lessonId] });
  return num(rows[0]?.doneTotal);
}

export function toBuilderLesson(l: Record<string, unknown>, sectionIds: Set<string>, done: number): BuilderLesson {
  const type = asLessonType(l.type);
  const sectionId = ref(l.sectionId);
  return {
    id: String(l.id),
    title: str(l.title) ?? '',
    type,
    sectionId: sectionId && sectionIds.has(sectionId) ? sectionId : null,
    position: num(l.position),
    body: str(l.body) ?? '',
    mediaUrl: ref(l.mediaUrl),
    mediaName: ref(l.mediaName),
    settings: parseSettings(type, l.settings) as Record<string, unknown>,
    durationMinutes: num(l.durationMinutes),
    optional: bool(l.optional),
    updatedAt: iso(l.updated_at),
    completedCount: done,
  };
}

/** A lesson as `getCourse` would send it. */
export async function readLesson(id: string): Promise<BuilderLesson> {
  const row = await loadLessonRow(id);
  if (!row) throw new ZiteError('That lesson no longer exists', 'NOT_FOUND');
  const [sections, done] = await Promise.all([sectionIdsOf(String(row.courseId ?? '')), completedCount(id)]);
  return toBuilderLesson(row, sections, done);
}

type PositionRow = { id: string; sectionId: string | null; position: number };

async function lessonPositions(courseId: string): Promise<{ sections: Array<{ id: string; position: number }>; lessons: PositionRow[] }> {
  const [sectionsRes, lessonsRes] = await Promise.all([
    zite.sql({ query: `SELECT id, "position" FROM "Sections" WHERE "courseId" = $1 ORDER BY COALESCE("position", 0) ASC, created_at ASC`, params: [courseId] }),
    zite.sql({ query: `SELECT id, "sectionId", "position" FROM "Lessons" WHERE "courseId" = $1 ORDER BY COALESCE("position", 0) ASC, created_at ASC`, params: [courseId] }),
  ]);
  const sections = sectionsRes.rows.map(s => ({ id: String(s.id), position: num(s.position) }));
  const known = new Set(sections.map(s => s.id));
  const lessons = lessonsRes.rows.map(l => {
    const sid = ref(l.sectionId);
    return { id: String(l.id), sectionId: sid && known.has(sid) ? sid : null, position: num(l.position) };
  });
  return { sections, lessons };
}

export async function outlinePositions(courseId: string): Promise<OutlinePositions> {
  return lessonPositions(courseId);
}

// ── Writing positions ─────────────────────────────────────────────────────

/**
 * Write a full outline order: sections by index, lessons by index within their
 * group (lessons outside any section form the first group). Only rows whose
 * position or section actually changed are written.
 */
export async function writeOutline(courseId: string, order: { sectionIds: string[]; groups: Map<string | null, string[]> }) {
  const current = await lessonPositions(courseId);
  const sectionById = new Map(current.sections.map(s => [s.id, s]));
  const lessonById = new Map(current.lessons.map(l => [l.id, l]));
  const sectionWrites: Array<{ id: string; position: number }> = [];
  const lessonWrites: Array<{ id: string; sectionId: string | null; position: number; moved: boolean }> = [];

  const seenSections = new Set<string>();
  const sectionOrder = order.sectionIds.filter(id => sectionById.has(id) && !seenSections.has(id) && seenSections.add(id));
  // Sections the client didn't know about (created elsewhere meanwhile) keep their relative order at the end.
  for (const s of current.sections) if (!seenSections.has(s.id)) sectionOrder.push(s.id);
  sectionOrder.forEach((id, i) => {
    if (sectionById.get(id)!.position !== i) sectionWrites.push({ id, position: i });
  });

  const placed = new Set<string>();
  const groups = new Map<string | null, string[]>();
  for (const [sectionId, ids] of order.groups) {
    if (sectionId !== null && !sectionById.has(sectionId)) continue;
    groups.set(sectionId, ids.filter(id => lessonById.has(id) && !placed.has(id) && placed.add(id)));
  }
  // Lessons the client didn't mention stay in their current group, after the ones it did.
  for (const l of current.lessons) {
    if (placed.has(l.id)) continue;
    const list = groups.get(l.sectionId) ?? [];
    list.push(l.id);
    groups.set(l.sectionId, list);
    placed.add(l.id);
  }
  for (const [sectionId, ids] of groups) {
    ids.forEach((id, i) => {
      const l = lessonById.get(id)!;
      if (l.position !== i || l.sectionId !== sectionId) lessonWrites.push({ id, sectionId, position: i, moved: l.sectionId !== sectionId });
    });
  }

  await eachWrite(sectionWrites, s => zite.sections.update({ id: s.id, record: { position: s.position } }));
  await eachWrite(lessonWrites, l => zite.lessons.update({ id: l.id, record: l.moved ? { position: l.position, sectionId: l.sectionId } : { position: l.position } }));
  return { sectionsWritten: sectionWrites.length, lessonsWritten: lessonWrites.length };
}

/** Current order as groups, for small edits (insert one lesson, move one lesson). */
export async function currentOrder(courseId: string) {
  const { sections, lessons } = await lessonPositions(courseId);
  const groups = new Map<string | null, string[]>([[null, []]]);
  for (const s of sections) groups.set(s.id, []);
  for (const l of lessons) groups.get(l.sectionId)!.push(l.id);
  return { sectionIds: sections.map(s => s.id), groups };
}

/**
 * Put a lesson into a group: after `afterLessonId`, at the start (null) or at
 * the end (undefined, or an id that isn't in that group).
 */
export async function placeLesson(courseId: string, lessonId: string, sectionId: string | null, afterLessonId?: string | null) {
  const order = await currentOrder(courseId);
  const target = sectionId !== null && order.groups.has(sectionId) ? sectionId : null;
  for (const [key, ids] of order.groups) order.groups.set(key, ids.filter(id => id !== lessonId));
  const group = order.groups.get(target)!;
  let index = group.length;
  if (afterLessonId === null) index = 0;
  else if (afterLessonId) {
    const at = group.indexOf(afterLessonId);
    if (at >= 0) index = at + 1;
  }
  group.splice(index, 0, lessonId);
  await writeOutline(courseId, order);
}

// ── Removing lessons ──────────────────────────────────────────────────────

export type LessonImpact = { learners: number; completed: number; inProgress: number; attempts: number; submissions: number; ungraded: number; sessions: number };

/** What deleting these lessons would touch, in people rather than rows. */
export async function lessonImpact(lessonIds: string[]): Promise<LessonImpact> {
  if (!lessonIds.length) return { learners: 0, completed: 0, inProgress: 0, attempts: 0, submissions: 0, ungraded: 0, sessions: 0 };
  const { rows } = await zite.sql({
    query: `SELECT
        (SELECT COUNT(DISTINCT "personId") FROM "LessonProgress" WHERE "lessonId" = ANY($1::text[])) AS "learnerTotal",
        (SELECT COUNT(DISTINCT "personId") FROM "LessonProgress" WHERE "lessonId" = ANY($1::text[]) AND "status" = 'Completed') AS "doneTotal",
        (SELECT COUNT(DISTINCT "personId") FROM "LessonProgress" WHERE "lessonId" = ANY($1::text[]) AND COALESCE("status", '') <> 'Completed') AS "startedTotal",
        (SELECT COUNT(*) FROM "QuizAttempts" WHERE "lessonId" = ANY($1::text[])) AS "attemptTotal",
        (SELECT COUNT(*) FROM "Submissions" WHERE "lessonId" = ANY($1::text[])) AS "submissionTotal",
        (SELECT COUNT(*) FROM "Submissions" WHERE "lessonId" = ANY($1::text[]) AND "status" = 'Submitted') AS "ungradedTotal",
        (SELECT COUNT(*) FROM "Sessions" WHERE "lessonId" = ANY($1::text[])) AS "sessionTotal"`,
    params: [lessonIds],
  });
  const r = rows[0] ?? {};
  return {
    learners: num(r.learnerTotal),
    completed: num(r.doneTotal),
    inProgress: num(r.startedTotal),
    attempts: num(r.attemptTotal),
    submissions: num(r.submissionTotal),
    ungraded: num(r.ungradedTotal),
    sessions: num(r.sessionTotal),
  };
}

/**
 * Delete lessons for good. Learners' records of work (attempts, submissions,
 * lesson progress) stay for the audit trail but stop counting, because
 * progress is derived from the outline. Sessions and questions that pointed
 * at a lesson are kept and belong to the course instead, and nobody resumes
 * into a lesson that's gone.
 */
export async function removeLessons(courseId: string, lessonIds: string[]) {
  if (!lessonIds.length) return;
  const [sessions, comments, enrollments] = await Promise.all([
    zite.sql({ query: `SELECT id::text AS id FROM "Sessions" WHERE "lessonId" = ANY($1::text[])`, params: [lessonIds] }),
    zite.sql({ query: `SELECT id::text AS id FROM "Comments" WHERE "courseId" = $2 AND "lessonId" = ANY($1::text[])`, params: [lessonIds, courseId] }),
    zite.sql({ query: `SELECT id::text AS id FROM "Enrollments" WHERE "courseId" = $2 AND "currentLessonId" = ANY($1::text[])`, params: [lessonIds, courseId] }),
  ]);
  await eachWrite(sessions.rows, r => zite.sessions.update({ id: String(r.id), record: { lessonId: null } }));
  await eachWrite(comments.rows, r => zite.comments.update({ id: String(r.id), record: { lessonId: null } }));
  await eachWrite(enrollments.rows, r => zite.enrollments.update({ id: String(r.id), record: { currentLessonId: null } }));
  await eachWrite(lessonIds, id => zite.lessons.delete({ id }));
}

// ── Keeping progress honest ───────────────────────────────────────────────

export const RECOMPUTE_CAP = 500;

/**
 * Progress is derived from the outline, so adding, removing or making a lesson
 * optional changes what "37% done" means for everyone mid-course.
 *
 * The engine's derivation (`recomputeEnrollment`) is repeated here in bulk —
 * three reads for the whole course instead of four per enrollment — and only
 * rows whose progress, status or score actually changed are written, two at a
 * time (live Zite rate-limits bursts). Anyone who is now finished goes through
 * the engine itself, so they get their certificate and their paths move on.
 *
 * - `progress` (a lesson was added or made optional/required): In progress enrollments.
 * - `full` (lessons were deleted): Not started and In progress, including scores.
 *
 * Completed enrollments are final and never touched. Bounded to the 500 most
 * recently active.
 *
 * `maxWrites` keeps quick actions quick: adding one lesson to a course with
 * hundreds of people mid-way shouldn't take a minute at the write rate live
 * Zite allows. Beyond it the percentage-only writes are skipped (each
 * enrollment is recomputed by the engine the next time its learner finishes a
 * lesson); completions are always handled.
 */
export async function syncCourseProgress(courseId: string, mode: 'full' | 'progress' = 'progress', opts: { maxWrites?: number } = {}) {
  const statuses = mode === 'full' ? ['Not started', 'In progress'] : ['In progress'];
  const { rows: enrollments } = await zite.sql({
    query: `SELECT id::text AS id, "status", "progress", "score" FROM "Enrollments" WHERE "courseId" = $1 AND "status" = ANY($2::text[])
            ORDER BY "lastActivityAt" DESC NULLS LAST, created_at DESC LIMIT ${RECOMPUTE_CAP}`,
    params: [courseId, statuses],
  });
  if (!enrollments.length) return { recomputed: 0, updated: 0 };

  const ids = enrollments.map(e => String(e.id));
  const [{ lessons }, progressRes] = await Promise.all([
    loadOutline(courseId),
    zite.sql({ query: `SELECT "enrollmentId", "lessonId", "status", "score" FROM "LessonProgress" WHERE "courseId" = $1 AND "enrollmentId" = ANY($2::text[])`, params: [courseId, ids] }),
  ]);
  const lessonIds = new Set(lessons.map(l => l.id));
  const quizIds = new Set(lessons.filter(l => l.type === 'Quiz').map(l => l.id));
  const rowsBy = new Map<string, Array<Record<string, unknown>>>();
  for (const r of progressRes.rows) {
    if (!lessonIds.has(String(r.lessonId))) continue;
    const key = String(r.enrollmentId);
    if (!rowsBy.has(key)) rowsBy.set(key, []);
    rowsBy.get(key)!.push(r);
  }

  const finish: string[] = [];
  const writes: Array<{ id: string; record: Record<string, unknown> }> = [];
  for (const e of enrollments) {
    const rows = rowsBy.get(String(e.id)) ?? [];
    const p = courseProgress(lessons, new Set(rows.filter(r => r.status === 'Completed').map(r => String(r.lessonId))));
    if (p.complete) {
      finish.push(String(e.id));
      continue;
    }
    const record: Record<string, unknown> = {};
    if (num(e.progress) !== p.percent) record.progress = p.percent;
    if (mode === 'full') {
      const status = rows.length ? 'In progress' : 'Not started';
      if (status !== e.status) record.status = status;
      const scores = rows.filter(r => quizIds.has(String(r.lessonId)) && r.score != null && r.score !== '').map(r => num(r.score));
      const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      if (score !== numOrNull(e.score)) record.score = score;
    }
    if (Object.keys(record).length) writes.push({ id: String(e.id), record });
  }
  const skipped = opts.maxWrites != null && writes.length > opts.maxWrites;
  if (skipped) console.log(`syncCourseProgress: ${writes.length} progress updates deferred for course ${courseId}`);
  else await eachWrite(writes, w => zite.enrollments.update({ id: w.id, record: w.record }));
  // One learner's failed recompute mustn't stop everyone else's; the next change or lesson they finish recomputes it again.
  await eachWrite(finish, async id => {
    try {
      await withRetry(() => recomputeEnrollment(id));
    } catch (err) {
      console.error('Recompute failed', id, err);
    }
  });
  return { recomputed: finish.length + (skipped ? 0 : writes.length), updated: skipped ? 0 : writes.length };
}

// ── AI drafting ───────────────────────────────────────────────────────────

export const AI_NOT_CONFIGURED = 'AI drafting isn’t set up for this workspace. Connect Anthropic to your Zite workspace to turn it on.';

/** One quiz question as Claude writes it — ids are assigned here, never by the model. */
export type AiQuestion = { type: 'single' | 'multiple' | 'true_false' | 'short'; prompt: string; options: Array<{ text: string; correct: boolean }>; acceptedAnswers: string[]; explanation: string };

export const questionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'prompt', 'options', 'acceptedAnswers', 'explanation'],
  properties: {
    type: { type: 'string', enum: ['single', 'multiple', 'true_false', 'short'] },
    prompt: { type: 'string' },
    options: {
      type: 'array',
      description: 'single: 3–4 options, exactly one correct. multiple: 4–5 options, two or more correct. true_false: exactly "True" and "False". short: empty.',
      items: { type: 'object', additionalProperties: false, required: ['text', 'correct'], properties: { text: { type: 'string' }, correct: { type: 'boolean' } } },
    },
    acceptedAnswers: { type: 'array', description: 'short only: every reasonable accepted answer. Empty for other types.', items: { type: 'string' } },
    explanation: { type: 'string', description: 'One sentence explaining the right answer.' },
  },
} as const;

/** Turn model output into lessons.ts questions with fresh ids. Anything unusable is dropped. */
export function toQuizQuestions(raw: AiQuestion[]) {
  return (Array.isArray(raw) ? raw : [])
    .map(q => {
      const type = (['single', 'multiple', 'true_false', 'short'] as const).includes(q?.type) ? q.type : 'single';
      const options = (Array.isArray(q?.options) ? q.options : []).filter(o => o && String(o.text ?? '').trim()).slice(0, 8);
      let built = options.map(o => ({ id: newId('o'), text: String(o.text).trim().slice(0, 500), correct: o.correct === true }));
      if (type === 'true_false') {
        const trueCorrect = options.find(o => /^true$/i.test(String(o.text).trim()))?.correct ?? !options.find(o => /^false$/i.test(String(o.text).trim()))?.correct;
        built = [
          { id: newId('o'), text: 'True', correct: Boolean(trueCorrect) },
          { id: newId('o'), text: 'False', correct: !trueCorrect },
        ];
      }
      return {
        id: newId('q'),
        type,
        prompt: String(q?.prompt ?? '').trim().slice(0, 2000),
        options: type === 'short' ? [] : built,
        acceptedAnswers: type === 'short' ? (Array.isArray(q?.acceptedAnswers) ? q.acceptedAnswers : []).map(a => String(a).trim().slice(0, 200)).filter(Boolean).slice(0, 12) : [],
        explanation: String(q?.explanation ?? '').trim().slice(0, 2000),
        points: 1,
      };
    })
    .filter(q => q.prompt && (q.type === 'short' ? q.acceptedAnswers.length > 0 : q.options.length >= 2 && q.options.some(o => o.correct)));
}

export type CourseDraft = {
  summary: string;
  objectives: string[];
  skills: string[];
  sections: Array<{
    title: string;
    description: string;
    lessons: Array<{ type: 'Article' | 'Checklist' | 'Quiz'; title: string; durationMinutes: number; body: string; checklistItems: string[]; questions: AiQuestion[] }>;
  }>;
};

const oneLine = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Append a drafted outline to a course: one section at a time, its lessons in
 * one bulkCreate, then the course's empty summary fields. Returns what was
 * created, for the builder's summary and its Undo.
 */
export async function writeCourseDraft(course: CourseRecord, draft: CourseDraft) {
  const order = await currentOrder(course.id);
  const sections: Array<{ id: string; title: string; lessons: Array<{ id: string; title: string; type: string }> }> = [];
  const lessonIds: string[] = [];
  let minutes = 0;
  for (const s of (draft.sections ?? []).slice(0, 8)) {
    const lessons = (s.lessons ?? []).filter(l => l && typeof l.title === 'string' && l.title.trim()).slice(0, 10);
    if (!lessons.length) continue;
    const title = oneLine(s.title, 200) || 'Untitled section';
    const section = await withRetry(() => zite.sections.create({ record: { title, description: oneLine(s.description, 500), courseId: course.id, position: 9999 } }));
    const records = lessons.map((l, i) => {
      const type = l.type === 'Quiz' || l.type === 'Checklist' ? l.type : 'Article';
      const settings =
        type === 'Quiz'
          ? { ...parseQuizSettings({ questions: toQuizQuestions(l.questions ?? []) }), passingScore: 80, revealAnswers: 'after_submit' }
          : type === 'Checklist'
            ? parseChecklistSettings({ items: (l.checklistItems ?? []).slice(0, 12).map(text => ({ id: newId('c'), text: oneLine(text, 500) })) })
            : {};
      const duration = Math.max(1, Math.min(120, Math.round(Number(l.durationMinutes) || (type === 'Quiz' ? 8 : type === 'Checklist' ? 10 : 6))));
      minutes += duration;
      return {
        title: oneLine(l.title, 200),
        courseId: course.id,
        sectionId: section.id,
        type,
        body: String(l.body ?? '').trim().slice(0, 60_000),
        mediaUrl: null,
        mediaName: null,
        settings: JSON.stringify(settings),
        durationMinutes: duration,
        optional: false,
        position: i,
      };
    });
    const res = (await withRetry(() => zite.lessons.bulkCreate({ records }))) as unknown as { records: Array<{ id: string }> };
    const ids = res.records.map(r => String(r.id));
    lessonIds.push(...ids);
    order.sectionIds.push(section.id);
    order.groups.set(section.id, ids);
    sections.push({ id: section.id, title, lessons: records.map((r, i) => ({ id: ids[i], title: r.title, type: r.type })) });
  }
  if (!lessonIds.length) return { sectionIds: [], lessonIds: [], lessonCount: 0, minutes: 0, filled: [] as Array<'summary' | 'objectives' | 'skills'>, sections: [] };
  await writeOutline(course.id, order);

  const filled: Array<'summary' | 'objectives' | 'skills'> = [];
  const patch: Record<string, unknown> = {};
  if (!course.summary.trim() && draft.summary?.trim()) {
    patch.summary = oneLine(draft.summary, 300);
    filled.push('summary');
  }
  const objectives = (draft.objectives ?? []).map(o => oneLine(o, 200)).filter(Boolean).slice(0, 6);
  if (!course.objectives.length && objectives.length) {
    patch.objectives = JSON.stringify(objectives);
    filled.push('objectives');
  }
  const skills = (draft.skills ?? []).map(o => oneLine(o, 40)).filter(Boolean).slice(0, 6);
  if (!course.skills.length && skills.length) {
    patch.skills = JSON.stringify(skills);
    filled.push('skills');
  }
  if (Object.keys(patch).length) await withRetry(() => zite.courses.update({ id: course.id, record: patch }));
  await refreshCourseMinutes(course.id);
  await syncCourseProgress(course.id, 'progress');
  return { sectionIds: sections.map(s => s.id), lessonIds, lessonCount: lessonIds.length, minutes, filled, sections };
}
