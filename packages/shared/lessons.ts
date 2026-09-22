/**
 * Lessons: the eight kinds of step a course is made of, their type-specific
 * settings, and quiz grading.
 *
 * Settings are JSON in `Lessons.settings`. Everything that reads them goes
 * through `parseSettings`, so a hand-edited or half-written row degrades to
 * sensible defaults instead of breaking the player. Quiz grading lives here
 * too, and runs only on the server — the learner app receives questions with
 * the answers stripped (`learnerQuiz`).
 *
 * No zod in this package: the root node_modules has zod 4 and endpoints use
 * the app's zod 3.
 */

export const LESSON_TYPES = ['Article', 'Video', 'Quiz', 'Assignment', 'File', 'Embed', 'Live session', 'Checklist'] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

export const asLessonType = (v: unknown): LessonType => (LESSON_TYPES.includes(v as LessonType) ? (v as LessonType) : 'Article');

export const LESSON_TYPE_META: Record<LessonType, { label: string; verb: string; description: string; defaultMinutes: number }> = {
  Article: { label: 'Article', verb: 'Read', description: 'Formatted text with images, lists and links', defaultMinutes: 5 },
  Video: { label: 'Video', verb: 'Watch', description: 'YouTube, Vimeo, Loom, Wistia or an uploaded video', defaultMinutes: 6 },
  Quiz: { label: 'Quiz', verb: 'Take the quiz', description: 'Auto-graded questions with a passing score', defaultMinutes: 8 },
  Assignment: { label: 'Assignment', verb: 'Submit', description: 'Work an instructor reviews and grades', defaultMinutes: 20 },
  File: { label: 'File', verb: 'Review', description: 'A PDF, slide deck or document to read or download', defaultMinutes: 5 },
  Embed: { label: 'Embed', verb: 'Explore', description: 'An interactive page, prototype or tool', defaultMinutes: 5 },
  'Live session': { label: 'Live session', verb: 'Attend', description: 'An instructor-led session learners register for', defaultMinutes: 60 },
  Checklist: { label: 'Checklist', verb: 'Complete', description: 'Practical steps learners tick off', defaultMinutes: 10 },
};

// ── Settings per type ─────────────────────────────────────────────────────

export type QuestionType = 'single' | 'multiple' | 'true_false' | 'short';

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  single: 'Single choice',
  multiple: 'Multiple choice',
  true_false: 'True or false',
  short: 'Short answer',
};

export type QuizOption = { id: string; text: string; correct: boolean };

export type QuizQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  /** Choices for single, multiple and true_false. */
  options: QuizOption[];
  /** Accepted answers for `short`, compared case- and whitespace-insensitively. */
  acceptedAnswers: string[];
  /** Shown after answering, when the quiz reveals answers. */
  explanation: string;
  points: number;
};

export type RevealAnswers = 'after_submit' | 'after_pass' | 'never';

export type QuizSettings = {
  questions: QuizQuestion[];
  /** 0–100. */
  passingScore: number;
  /** 0 means unlimited. */
  maxAttempts: number;
  shuffleQuestions: boolean;
  revealAnswers: RevealAnswers;
  /** null means untimed. */
  timeLimitMinutes: number | null;
};

export type AssignmentSettings = {
  submissionType: 'text' | 'file' | 'text_and_file';
  /** 0–100; a grade at or above this passes. */
  passingGrade: number;
  /** Guidance for graders, never shown to learners. */
  rubric: string;
};

export type ChecklistItem = { id: string; text: string };
export type ChecklistSettings = { items: ChecklistItem[] };

export type VideoSettings = {
  /** Learners can only mark the lesson complete after the video has played this share (0–1). 0 disables the gate. */
  requiredWatchShare: number;
};

export type EmbedSettings = { height: number };

export type LessonSettingsMap = {
  Article: Record<string, never>;
  Video: VideoSettings;
  Quiz: QuizSettings;
  Assignment: AssignmentSettings;
  File: Record<string, never>;
  Embed: EmbedSettings;
  'Live session': Record<string, never>;
  Checklist: ChecklistSettings;
};

export type AnyLessonSettings = Partial<QuizSettings & AssignmentSettings & ChecklistSettings & VideoSettings & EmbedSettings>;

export function newId(prefix = '') {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return prefix ? `${prefix}_${s}` : s;
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};
const text = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');

function parseQuestion(q: unknown, i: number): QuizQuestion | null {
  if (!q || typeof q !== 'object') return null;
  const r = q as Record<string, unknown>;
  const type: QuestionType = ['single', 'multiple', 'true_false', 'short'].includes(String(r.type)) ? (r.type as QuestionType) : 'single';
  let options: QuizOption[] = Array.isArray(r.options)
    ? (r.options as unknown[])
        .filter(o => o && typeof o === 'object')
        .map((o, j) => {
          const oo = o as Record<string, unknown>;
          return { id: text(oo.id, 40) || `o${i}_${j}`, text: text(oo.text, 500), correct: oo.correct === true };
        })
    : [];
  if (type === 'true_false') {
    const trueCorrect = options.find(o => /^true$/i.test(o.text))?.correct ?? options[0]?.correct ?? true;
    options = [
      { id: options.find(o => /^true$/i.test(o.text))?.id ?? 'true', text: 'True', correct: trueCorrect },
      { id: options.find(o => /^false$/i.test(o.text))?.id ?? 'false', text: 'False', correct: !trueCorrect },
    ];
  }
  if (type === 'single') {
    // Exactly one correct answer; the first marked one wins.
    const first = options.findIndex(o => o.correct);
    options = options.map((o, j) => ({ ...o, correct: j === (first === -1 ? 0 : first) }));
  }
  return {
    id: text(r.id, 40) || `q${i}`,
    type,
    prompt: text(r.prompt, 2000),
    options: type === 'short' ? [] : options,
    acceptedAnswers: type === 'short' && Array.isArray(r.acceptedAnswers) ? (r.acceptedAnswers as unknown[]).map(a => text(a, 200)).filter(Boolean) : [],
    explanation: text(r.explanation, 2000),
    points: clamp(r.points, 1, 100, 1),
  };
}

export function parseQuizSettings(raw: unknown): QuizSettings {
  const r = parseJson(raw);
  const questions = Array.isArray(r.questions) ? (r.questions as unknown[]).map(parseQuestion).filter((q): q is QuizQuestion => Boolean(q)) : [];
  const reveal = ['after_submit', 'after_pass', 'never'].includes(String(r.revealAnswers)) ? (r.revealAnswers as RevealAnswers) : 'after_submit';
  const limit = Number(r.timeLimitMinutes);
  return {
    questions,
    passingScore: clamp(r.passingScore, 0, 100, 80),
    maxAttempts: clamp(r.maxAttempts, 0, 50, 0),
    shuffleQuestions: r.shuffleQuestions === true,
    revealAnswers: reveal,
    timeLimitMinutes: Number.isFinite(limit) && limit > 0 ? Math.min(600, Math.round(limit)) : null,
  };
}

export function parseAssignmentSettings(raw: unknown): AssignmentSettings {
  const r = parseJson(raw);
  const t = String(r.submissionType);
  return {
    submissionType: t === 'file' || t === 'text_and_file' ? t : 'text',
    passingGrade: clamp(r.passingGrade, 0, 100, 70),
    rubric: text(r.rubric, 10000),
  };
}

export function parseChecklistSettings(raw: unknown): ChecklistSettings {
  const r = parseJson(raw);
  const items = Array.isArray(r.items)
    ? (r.items as unknown[])
        .map((it, i) => {
          if (typeof it === 'string') return { id: `c${i}`, text: it.slice(0, 500) };
          const o = (it ?? {}) as Record<string, unknown>;
          return { id: text(o.id, 40) || `c${i}`, text: text(o.text, 500) };
        })
        .filter(it => it.text.trim())
    : [];
  return { items };
}

export function parseVideoSettings(raw: unknown): VideoSettings {
  const r = parseJson(raw);
  return { requiredWatchShare: clamp(r.requiredWatchShare, 0, 1, 0) };
}

export function parseEmbedSettings(raw: unknown): EmbedSettings {
  const r = parseJson(raw);
  return { height: clamp(r.height, 240, 1600, 640) };
}

/** The settings for a lesson of this type, normalised. Unknown keys are dropped. */
export function parseSettings(type: LessonType, raw: unknown): AnyLessonSettings {
  switch (type) {
    case 'Quiz':
      return parseQuizSettings(raw);
    case 'Assignment':
      return parseAssignmentSettings(raw);
    case 'Checklist':
      return parseChecklistSettings(raw);
    case 'Video':
      return parseVideoSettings(raw);
    case 'Embed':
      return parseEmbedSettings(raw);
    default:
      return {};
  }
}

export function defaultSettings(type: LessonType): AnyLessonSettings {
  switch (type) {
    case 'Quiz':
      return {
        questions: [
          {
            id: newId('q'),
            type: 'single',
            prompt: '',
            options: [
              { id: newId('o'), text: '', correct: true },
              { id: newId('o'), text: '', correct: false },
            ],
            acceptedAnswers: [],
            explanation: '',
            points: 1,
          },
        ],
        passingScore: 80,
        maxAttempts: 0,
        shuffleQuestions: false,
        revealAnswers: 'after_submit',
        timeLimitMinutes: null,
      };
    case 'Assignment':
      return { submissionType: 'text', passingGrade: 70, rubric: '' };
    case 'Checklist':
      return { items: [{ id: newId('c'), text: '' }] };
    case 'Video':
      return { requiredWatchShare: 0 };
    case 'Embed':
      return { height: 640 };
    default:
      return {};
  }
}

/** Problems that would stop a learner finishing the lesson — shown in the builder and checked before publishing. */
export function lessonIssues(lesson: { type: LessonType; title: string; body: string; mediaUrl: string | null; settings: AnyLessonSettings }): string[] {
  const issues: string[] = [];
  if (!lesson.title.trim()) issues.push('Give the lesson a title');
  switch (lesson.type) {
    case 'Article':
      if (!lesson.body.trim()) issues.push('The article is empty');
      break;
    case 'Video':
      if (!lesson.mediaUrl) issues.push('Add a video link or upload a video');
      break;
    case 'File':
      if (!lesson.mediaUrl) issues.push('Upload a file or link to one');
      break;
    case 'Embed':
      if (!lesson.mediaUrl) issues.push('Add the address of the page to embed');
      break;
    case 'Quiz': {
      const qs = (lesson.settings.questions ?? []) as QuizQuestion[];
      if (!qs.length) issues.push('Add at least one question');
      qs.forEach((q, i) => {
        if (!q.prompt.trim()) issues.push(`Question ${i + 1} has no prompt`);
        if (q.type === 'short' && !q.acceptedAnswers.length) issues.push(`Question ${i + 1} needs at least one accepted answer`);
        if (q.type === 'single' || q.type === 'multiple') {
          const filled = q.options.filter(o => o.text.trim()).length;
          if (filled < 2) issues.push(`Question ${i + 1} needs at least two choices`);
          else if (filled < q.options.length) issues.push(`Question ${i + 1} has an empty choice`);
          // A blank correct option can't be chosen knowingly, so the question can't be answered right.
          if (q.options.some(o => o.correct && !o.text.trim())) issues.push(`Question ${i + 1}'s correct choice is empty`);
          else if (!q.options.some(o => o.correct)) issues.push(`Question ${i + 1} has no correct choice`);
        }
      });
      break;
    }
    case 'Checklist':
      if (!(lesson.settings.items ?? []).length) issues.push('Add at least one checklist item');
      break;
    default:
      break;
  }
  return issues;
}

// ── Quizzes ───────────────────────────────────────────────────────────────

/** An answer per question id: option ids for choice questions, text for short answers. */
export type QuizAnswers = Record<string, string[] | string>;

export type QuestionResult = { id: string; correct: boolean; earned: number; points: number };

export type QuizResult = { score: number; earned: number; total: number; passed: boolean; results: QuestionResult[] };

const normalise = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function parseAnswers(raw: unknown): QuizAnswers {
  const r = parseJson(raw);
  const out: QuizAnswers = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'string') out[k] = v.slice(0, 1000);
    else if (Array.isArray(v)) out[k] = v.map(x => String(x).slice(0, 60)).slice(0, 50);
  }
  return out;
}

/**
 * Grade a quiz. Multiple-choice questions need exactly the right set (no
 * partial credit — the same rule most compliance quizzes use), short answers
 * match any accepted answer ignoring case, accents and punctuation.
 */
export function gradeQuiz(settings: QuizSettings, answers: QuizAnswers): QuizResult {
  const results = settings.questions.map(q => {
    const given = answers[q.id];
    let correct = false;
    if (q.type === 'short') {
      const t = typeof given === 'string' ? normalise(given) : Array.isArray(given) ? normalise(given.join(' ')) : '';
      correct = Boolean(t) && q.acceptedAnswers.some(a => normalise(a) === t);
    } else {
      const picked = new Set(Array.isArray(given) ? given : typeof given === 'string' && given ? [given] : []);
      const right = new Set(q.options.filter(o => o.correct).map(o => o.id));
      correct = picked.size === right.size && [...right].every(id => picked.has(id));
    }
    return { id: q.id, correct, earned: correct ? q.points : 0, points: q.points };
  });
  const total = results.reduce((s, r) => s + r.points, 0);
  const earned = results.reduce((s, r) => s + r.earned, 0);
  const score = total > 0 ? Math.round((earned / total) * 100) : 0;
  return { score, earned, total, passed: score >= settings.passingScore, results };
}

export type LearnerQuestion = { id: string; type: QuestionType; prompt: string; options: Array<{ id: string; text: string }>; points: number };

/** What a learner may see before answering: no correct flags, accepted answers or explanations. */
export function learnerQuiz(settings: QuizSettings, opts: { shuffleSeed?: string } = {}): { questions: LearnerQuestion[]; passingScore: number; maxAttempts: number; timeLimitMinutes: number | null; revealAnswers: RevealAnswers } {
  let questions = settings.questions.map(q => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options.map(o => ({ id: o.id, text: o.text })), points: q.points }));
  if (settings.shuffleQuestions && opts.shuffleSeed) questions = seededShuffle(questions, opts.shuffleSeed);
  return { questions, passingScore: settings.passingScore, maxAttempts: settings.maxAttempts, timeLimitMinutes: settings.timeLimitMinutes, revealAnswers: settings.revealAnswers };
}

export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Whether the learner may see correct answers and explanations for this attempt. */
export function mayRevealAnswers(settings: Pick<QuizSettings, 'revealAnswers' | 'maxAttempts'>, passed: boolean, attemptsUsed: number) {
  if (settings.revealAnswers === 'never') return false;
  if (settings.revealAnswers === 'after_pass') return passed || (settings.maxAttempts > 0 && attemptsUsed >= settings.maxAttempts);
  return true;
}

// ── Media ─────────────────────────────────────────────────────────────────

export type VideoSource = { kind: 'youtube' | 'vimeo' | 'loom' | 'wistia' | 'file' | 'link'; src: string };

/** Turn a pasted video address into something a player can embed. */
export function videoSource(url: string | null | undefined): VideoSource | null {
  const u = (url ?? '').trim();
  if (!u) return null;
  let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (m) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0&modestbranding=1&enablejsapi=1` };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${m[1]}?dnt=1&api=1` };
  m = u.match(/loom\.com\/(?:share|embed)\/([a-f0-9]{16,})/i);
  if (m) return { kind: 'loom', src: `https://www.loom.com/embed/${m[1]}` };
  m = u.match(/(?:wistia\.(?:com|net)\/(?:medias|embed\/iframe)\/)([a-z0-9]+)/i);
  if (m) return { kind: 'wistia', src: `https://fast.wistia.net/embed/iframe/${m[1]}` };
  if (/\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i.test(u)) return { kind: 'file', src: u };
  if (/^https:\/\//.test(u)) return { kind: 'link', src: u };
  return null;
}

/**
 * Whether the player can measure how much of a video was watched: uploaded
 * files and YouTube/Vimeo (through their player APIs). Loom, Wistia and plain
 * links only say "started", so a watch requirement is ignored for them —
 * otherwise nobody could ever complete the lesson.
 */
export const canTrackWatchProgress = (url: string | null | undefined) => {
  const kind = videoSource(url)?.kind;
  return kind === 'youtube' || kind === 'vimeo' || kind === 'file';
};

/** The watch share actually enforced for a lesson: the setting, or 0 when the source can't report progress. */
export const effectiveWatchShare = (url: string | null | undefined, requiredWatchShare: number) => (canTrackWatchProgress(url) ? requiredWatchShare : 0);

export function fileKind(nameOrUrl: string | null | undefined): 'pdf' | 'image' | 'slides' | 'doc' | 'sheet' | 'video' | 'other' {
  const s = (nameOrUrl ?? '').toLowerCase().split('?')[0];
  if (s.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(s)) return 'image';
  if (/\.(pptx?|key|odp)$/.test(s)) return 'slides';
  if (/\.(docx?|odt|rtf|txt|md)$/.test(s)) return 'doc';
  if (/\.(xlsx?|csv|ods|numbers)$/.test(s)) return 'sheet';
  if (/\.(mp4|webm|mov|m4v)$/.test(s)) return 'video';
  return 'other';
}

/** Minutes as "45 min", "1 hr 30 min". */
export function formatMinutes(total: number | null | undefined) {
  const m = Math.max(0, Math.round(total ?? 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}
