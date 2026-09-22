import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import {
  effectiveWatchShare,
  learnerQuiz,
  mayRevealAnswers,
  parseAnswers,
  parseAssignmentSettings,
  parseChecklistSettings,
  parseEmbedSettings,
  parseQuizSettings,
  parseVideoSettings,
} from '@project/shared/lessons';
import { parseStringList } from '@project/shared/progress';
import { bool, iso, num, numOrNull, str } from '@project/shared/server/sql';
import { blockerFor, buildReview, lessonStateOf, loadLessonRecord, loadPlayer, loadSessionViews, parseFiles, requireOpenLesson } from '../server/player';

/**
 * One lesson, ready to render: its content plus what the learner has done on
 * it. Quiz questions arrive without answers; correct answers and explanations
 * come back only for an attempt the quiz's reveal rule allows. The grader's
 * rubric never leaves the server.
 */

const Input = z.object({ slug: z.string().min(1).max(200), lessonId: z.string().min(1).max(100) });

const Review = z.array(z.object({ id: z.string(), correct: z.boolean(), selected: z.array(z.string()), answerText: z.string(), correctOptionIds: z.array(z.string()), acceptedAnswers: z.array(z.string()), explanation: z.string() }));

const File = z.object({ name: z.string(), url: z.string(), size: z.number(), type: z.string() });

const Session = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  timezone: z.string(),
  location: z.string(),
  online: z.boolean(),
  meetingUrl: z.string().nullable(),
  recordingUrl: z.string().nullable(),
  capacity: z.number().nullable(),
  registeredCount: z.number(),
  waitlistCount: z.number(),
  cancelled: z.boolean(),
  phase: z.enum(['upcoming', 'live', 'ended']),
  instructorName: z.string().nullable(),
  myRegistration: z.object({ id: z.string(), status: z.string(), waitlistPosition: z.number().nullable() }).nullable(),
});

const Output = z.object({
  lesson: z.object({ id: z.string(), title: z.string(), type: z.string(), body: z.string(), mediaUrl: z.string().nullable(), mediaName: z.string().nullable(), durationMinutes: z.number(), optional: z.boolean(), sectionId: z.string().nullable(), sectionTitle: z.string().nullable() }),
  state: z.enum(['completed', 'in_progress', 'locked', 'available']),
  position: z.object({ index: z.number(), total: z.number() }),
  prevId: z.string().nullable(),
  nextId: z.string().nullable(),
  /** Why the next lesson can't be opened yet, if it can't. */
  nextLockedReason: z.string().nullable(),
  commentCount: z.number(),
  quiz: z
    .object({
      questions: z.array(z.object({ id: z.string(), type: z.enum(['single', 'multiple', 'true_false', 'short']), prompt: z.string(), options: z.array(z.object({ id: z.string(), text: z.string() })), points: z.number() })),
      passingScore: z.number(),
      maxAttempts: z.number(),
      timeLimitMinutes: z.number().nullable(),
      revealAnswers: z.enum(['after_submit', 'after_pass', 'never']),
      attempts: z.array(z.object({ number: z.number(), score: z.number(), passed: z.boolean(), submittedAt: z.string().nullable() })),
      attemptsLeft: z.number().nullable(),
      bestScore: z.number().nullable(),
      passed: z.boolean(),
      nextAttempt: z.number(),
      /** When the learner started the attempt in progress (server clock), so a reload keeps the countdown honest. */
      startedAt: z.string().nullable(),
      review: z.object({ attemptNumber: z.number(), score: z.number(), passed: z.boolean(), questions: Review }).nullable(),
    })
    .nullable(),
  assignment: z
    .object({
      submissionType: z.enum(['text', 'file', 'text_and_file']),
      passingGrade: z.number(),
      submissions: z.array(z.object({ id: z.string(), attempt: z.number(), status: z.string(), grade: z.number().nullable(), feedback: z.string(), body: z.string(), files: z.array(File), submittedAt: z.string().nullable(), gradedAt: z.string().nullable(), gradedByName: z.string().nullable() })),
      canSubmit: z.boolean(),
    })
    .nullable(),
  checklist: z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })), checked: z.array(z.string()) }).nullable(),
  video: z.object({ requiredWatchShare: z.number(), watched: z.number() }).nullable(),
  file: z.object({ opened: z.boolean() }).nullable(),
  embed: z.object({ height: z.number() }).nullable(),
  live: z.object({ sessions: z.array(Session), canSelfComplete: z.boolean() }).nullable(),
});

type Out = z.infer<typeof Output>;

export default createEndpoint({
  description: 'One lesson of a course for the signed-in learner, with their progress on it',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<Out> => {
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) throw new ZiteError('Which lesson?', 'BAD_REQUEST');
    const ctx = await loadPlayer(context, parsed.data.slug);
    const outlineLesson = requireOpenLesson(ctx, parsed.data.lessonId);
    const enrollment = ctx.enrollment!;
    const lesson = await loadLessonRecord(outlineLesson.id, ctx.course.id);
    const progress = ctx.progress.get(lesson.id);
    const state = progress?.state ?? {};

    const index = ctx.lessons.findIndex(l => l.id === lesson.id);
    const prev = ctx.lessons[index - 1] ?? null;
    const next = ctx.lessons[index + 1] ?? null;
    let nextLockedReason: string | null = null;
    if (next && ctx.locked.has(next.id)) {
      // Finishing this lesson may be exactly what unlocks the next one.
      const blocker = blockerFor(ctx, next.id);
      nextLockedReason = blocker ? `Finish “${blocker.title}” to unlock the next lesson` : 'The next lesson is still locked';
    }

    const { rows: countRows } = await zite.sql({
      query: `SELECT COUNT(*) AS "threadTotal" FROM "Comments" c WHERE c."lessonId" = $1 AND COALESCE(c."parentId", '') = '' AND (COALESCE(c."body", '') <> '' OR EXISTS (SELECT 1 FROM "Comments" r WHERE r."parentId" = c.id::text))`,
      params: [lesson.id],
    });

    const out: Out = {
      lesson: {
        id: lesson.id,
        title: lesson.title,
        type: lesson.type,
        body: lesson.body,
        mediaUrl: lesson.mediaUrl,
        mediaName: lesson.mediaName,
        durationMinutes: lesson.durationMinutes,
        optional: lesson.optional,
        sectionId: outlineLesson.sectionId,
        sectionTitle: ctx.sections.find(s => s.id === outlineLesson.sectionId)?.title ?? null,
      },
      state: lessonStateOf(ctx, lesson.id),
      position: { index, total: ctx.lessons.length },
      prevId: prev?.id ?? null,
      nextId: next?.id ?? null,
      nextLockedReason,
      commentCount: ctx.settings.discussionsEnabled ? num(countRows[0]?.threadTotal) : 0,
      quiz: null,
      assignment: null,
      checklist: null,
      video: null,
      file: null,
      embed: null,
      live: null,
    };

    switch (lesson.type) {
      case 'Quiz': {
        const settings = parseQuizSettings(lesson.settings);
        const { rows } = await zite.sql({
          query: `SELECT "number", "score", "passed", "answers", "submittedAt" FROM "QuizAttempts" WHERE "enrollmentId" = $1 AND "lessonId" = $2 ORDER BY COALESCE("number", 0) ASC, created_at ASC`,
          params: [enrollment.id, lesson.id],
        });
        const attempts = rows.map((r, i) => ({ number: num(r.number, i + 1) || i + 1, score: num(r.score), passed: bool(r.passed), submittedAt: iso(r.submittedAt), answers: r.answers }));
        const used = attempts.length;
        const passed = attempts.some(a => a.passed) || progress?.status === 'Completed';
        const latest = attempts[attempts.length - 1];
        const nextAttempt = used + 1;
        const running = typeof state.quizStartedAt === 'string' && num(state.quizAttempt) === nextAttempt ? state.quizStartedAt : null;
        // An attempt whose time ran out while the learner was away isn't resumable.
        const startedAt = running && !(settings.timeLimitMinutes && Date.now() - Date.parse(running) > settings.timeLimitMinutes * 60_000 + 30_000) ? running : null;
        out.quiz = {
          ...learnerQuiz(settings, { shuffleSeed: `${enrollment.id}:${lesson.id}:${nextAttempt}` }),
          attempts: attempts.map(({ answers: _a, ...a }) => a),
          attemptsLeft: settings.maxAttempts > 0 ? Math.max(0, settings.maxAttempts - used) : null,
          bestScore: attempts.length ? Math.max(...attempts.map(a => a.score)) : numOrNull(progress?.score),
          passed,
          nextAttempt,
          startedAt,
          review:
            latest && mayRevealAnswers(settings, passed, used)
              ? { attemptNumber: latest.number, score: latest.score, passed: latest.passed, questions: buildReview(settings, parseAnswers(latest.answers)) }
              : null,
        };
        break;
      }
      case 'Assignment': {
        const settings = parseAssignmentSettings(lesson.settings);
        const { rows } = await zite.sql({
          query: `SELECT s.id, s."attempt", s."status", s."grade", s."feedback", s."body", s."files", s."submittedAt", s."gradedAt", g."name" AS "gradedByName"
                  FROM "Submissions" s LEFT JOIN "People" g ON g.id::text = s."gradedById"
                  WHERE s."enrollmentId" = $1 AND s."lessonId" = $2 AND s."personId" = $3 ORDER BY COALESCE(s."attempt", 0) DESC, s.created_at DESC`,
          params: [enrollment.id, lesson.id, ctx.actor.id],
        });
        const submissions = rows.map(r => ({
          id: String(r.id),
          attempt: num(r.attempt, 1) || 1,
          status: str(r.status) || 'Submitted',
          grade: numOrNull(r.grade),
          feedback: str(r.feedback) ?? '',
          body: str(r.body) ?? '',
          files: parseFiles(r.files),
          submittedAt: iso(r.submittedAt),
          gradedAt: iso(r.gradedAt),
          gradedByName: str(r.gradedByName) || null,
        }));
        const waiting = submissions.some(s => s.status === 'Submitted');
        const passedAlready = submissions.some(s => s.status === 'Passed') || progress?.status === 'Completed';
        out.assignment = { submissionType: settings.submissionType, passingGrade: settings.passingGrade, submissions, canSubmit: !waiting && !passedAlready };
        break;
      }
      case 'Checklist': {
        const settings = parseChecklistSettings(lesson.settings);
        const valid = new Set(settings.items.map(i => i.id));
        out.checklist = { items: settings.items, checked: parseStringList(state.checked, 200).filter(id => valid.has(id)) };
        break;
      }
      case 'Video': {
        const settings = parseVideoSettings(lesson.settings);
        // Sources that can't report progress (Loom, Wistia, links) aren't gated — see effectiveWatchShare.
        out.video = { requiredWatchShare: effectiveWatchShare(lesson.mediaUrl as string | null, settings.requiredWatchShare), watched: Math.min(1, Math.max(0, num(state.watched))) };
        break;
      }
      case 'File':
        out.file = { opened: state.opened === true };
        break;
      case 'Embed':
        out.embed = { height: parseEmbedSettings(lesson.settings).height };
        break;
      case 'Live session': {
        const { sessions, scheduledCount } = await loadSessionViews({ lessonId: lesson.id, personId: ctx.actor.id });
        out.live = { sessions, canSelfComplete: scheduledCount === 0 };
        break;
      }
      default:
        break;
    }
    return out;
  },
});
