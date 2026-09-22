import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { POINTS } from '@project/shared/progress';
import { assertStaff, getActor } from '@project/shared/server/people';
import { day, num, numOrNull, str } from '@project/shared/server/sql';
import {
  badInput, complianceInput, sql, courseExportRows, enrollmentExportRows, EXPORT_KINDS, groupExportRows, learnerExportRows, loadCompliance, loadQuizReport, scopeFields, toCsv,
  type ComplianceOutput, type ComplianceStatus,
} from '../server/reports';

/**
 * Every report as a CSV, built on the server from the same queries the
 * screens use, so an export always matches what's on screen.
 */

const Input = z.object({
  kind: z.enum(EXPORT_KINDS),
  ...scopeFields,
  lessonId: z.string().max(100).optional(),
  managerId: z.string().max(100).optional(),
  itemIds: z.array(z.string().min(1).max(100)).max(200).optional(),
  gapsOnly: z.boolean().optional(),
});

const Output = z.object({ filename: z.string(), csv: z.string(), rows: z.number(), truncated: z.boolean() });

const STATUS_LABEL: Record<ComplianceStatus, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  not_started: 'Not started',
  overdue: 'Overdue',
  expired: 'Expired',
  not_assigned: 'Not assigned',
};

const pct = (v: number | null | undefined) => (v == null ? '' : Math.round(v * 10) / 10);
const ratio = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : '');
const d = (v: unknown) => day(v) ?? '';
const hours = (seconds: unknown) => Math.round((num(seconds) / 3600) * 10) / 10;
const avg = (v: unknown) => (v == null || v === '' ? '' : Math.round(num(v) * 10) / 10);
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export default createEndpoint({
  description: 'Export a report as CSV: enrollments, compliance, courses, groups, a quiz or learners',
  authenticated: true,
  inputSchema: Input,
  outputSchema: Output,
  execute: async ({ input, context }): Promise<z.infer<typeof Output>> => {
    const actor = await getActor(context);
    assertStaff(actor);
    const parsed = Input.safeParse(input ?? {});
    if (!parsed.success) badInput(parsed.error, 'Choose what to export.');
    const q = parsed.data;
    const today = new Date().toISOString().slice(0, 10);
    const span = (r: { fromDay: string; toDay: string }) => `${r.fromDay}-to-${r.toDay}`;

    switch (q.kind) {
      case 'enrollments': {
        const { range, rows, truncated } = await enrollmentExportRows(q);
        const csv = toCsv(
          ['Learner', 'Email', 'Manager', 'Groups', 'Course', 'Category', 'Enrolled via', 'Status', 'Enrolled', 'Started', 'Completed', 'Due', 'On time', 'Overdue', 'Progress (%)', 'Quiz score (%)', 'Rating', 'Time spent (hours)', 'Cycle'],
          rows.map(r => [
            str(r.personName), str(r.personEmail), str(r.managerName), str(r.groupNames), str(r.courseTitle), str(r.categoryName), r.source === 'Automatic' ? 'Assignment rule' : r.source === 'Path' ? 'Learning path' : str(r.source),
            str(r.status), d(r.enrolledAt), d(r.startedAt), d(r.completedAt), d(r.dueDate), r.status === 'Completed' ? (r.isOnTime === true ? 'Yes' : 'No') : '', r.isOverdue === true ? 'Yes' : 'No',
            r.status === 'Completed' ? 100 : num(r.progress), numOrNull(r.score) ?? '', numOrNull(r.rating) || '', hours(r.timeSpentSeconds), num(r.cycle, 1),
          ]),
        );
        // One course: name the file after it, so several course exports don't all read "enrollments".
        let prefix = 'enrollments';
        if (q.courseIds?.length === 1) {
          const { rows: found } = await sql(`SELECT "title" FROM "Courses" WHERE id::text = $1`, [q.courseIds[0]]);
          const title = slug(str(found[0]?.title) ?? '');
          if (title) prefix = `enrollments-${title}`;
        }
        return { filename: `lms-${prefix}-${span(range)}.csv`, csv, rows: rows.length, truncated };
      }
      case 'courses': {
        const { range, rows, truncated } = await courseExportRows(q);
        const csv = toCsv(
          ['Course', 'Status', 'Category', 'Enrollments open in range', 'Completed', 'Completion rate (%)', 'Overdue', 'Overdue rate (%)', 'New enrollments', 'Completions in range', 'Average quiz score (%)', 'Average rating', 'Ratings', 'Average time to complete (hours)'],
          rows.map(r => [str(r.title), str(r.courseStatus), str(r.categoryName), num(r.cohortTotal), num(r.doneTotal), ratio(num(r.doneTotal), num(r.cohortTotal)), num(r.overdueTotal), ratio(num(r.overdueTotal), num(r.cohortTotal)), num(r.enrolledTotal), num(r.completedTotal), avg(r.scoreAverage), avg(r.ratingAverage), num(r.ratingTotal), r.secondsAverage == null ? '' : hours(r.secondsAverage)]),
        );
        return { filename: `lms-courses-${span(range)}.csv`, csv, rows: rows.length, truncated };
      }
      case 'groups': {
        const { range, rows } = await groupExportRows(q);
        const csv = toCsv(
          ['Group', 'Kind', 'Members', 'Active learners', 'Active (%)', 'Enrollments open in range', 'Completed', 'Completion rate (%)', 'Overdue', 'Overdue rate (%)', 'Average quiz score (%)'],
          rows.map(r => [str(r.name), str(r.kind), num(r.memberTotal), num(r.activeTotal), ratio(num(r.activeTotal), num(r.memberTotal)), num(r.cohortTotal), num(r.doneTotal), ratio(num(r.doneTotal), num(r.cohortTotal)), num(r.overdueTotal), ratio(num(r.overdueTotal), num(r.cohortTotal)), avg(r.scoreAverage)]),
        );
        return { filename: `lms-groups-${span(range)}.csv`, csv, rows: rows.length, truncated: false };
      }
      case 'learners': {
        const { range, rows, truncated } = await learnerExportRows(q);
        const csv = toCsv(
          ['Learner', 'Email', 'Job title', 'Status', 'Manager', 'Groups', 'Active days', 'Lessons completed', 'Courses completed', 'Paths completed', 'Quizzes passed', 'Perfect quizzes', 'Learning hours', 'Points', 'Last learned', 'Open enrollments', 'Overdue now'],
          rows.map(r => [
            str(r.name), str(r.email), str(r.title), str(r.status), str(r.managerName), str(r.groupNames), num(r.dayTotal), num(r.lessonTotal), num(r.courseTotal), num(r.pathTotal), num(r.passTotal), num(r.perfectTotal), hours(r.secondsTotal),
            num(r.lessonTotal) * POINTS.lesson + num(r.courseTotal) * POINTS.course + num(r.pathTotal) * POINTS.path + num(r.passTotal) * POINTS.quizPass + num(r.perfectTotal) * POINTS.perfectQuiz,
            d(r.lastAt), num(r.openTotal), num(r.overdueTotal),
          ]),
        );
        return { filename: `lms-learners-${span(range)}.csv`, csv, rows: rows.length, truncated };
      }
      case 'quiz': {
        const data = await loadQuizReport({ ...q, lessonId: q.lessonId });
        if (!q.lessonId || !data.report) {
          const csv = toCsv(
            ['Quiz', 'Course', 'Questions', 'Passing score (%)', 'Attempts', 'Learners', 'Passed first time (%)', 'Passed eventually (%)', 'Average score (%)', 'Last attempt'],
            data.quizzes.map(x => [x.title, x.courseTitle, x.questions, x.passingScore, x.attempts, x.learners, pct(x.firstPassRate), pct(x.passRate), pct(x.averageScore), x.lastAttemptAt?.slice(0, 10) ?? '']),
          );
          return { filename: `lms-quizzes-${span(data.range)}.csv`, csv, rows: data.quizzes.length, truncated: false };
        }
        const r = data.report;
        const TYPE: Record<string, string> = { single: 'Single choice', multiple: 'Multiple choice', true_false: 'True or false', short: 'Short answer' };
        const DIFFICULTY: Record<string, string> = { easy: 'Easy', moderate: 'Moderate', hard: 'Hard', unknown: 'Not enough answers' };
        const csv = toCsv(
          ['#', 'Question', 'Type', 'Answered', 'Correct', 'Correct (%)', 'Difficulty', 'Most chosen wrong answer', 'Chosen by (wrong answers, %)', 'Common wrong short answers'],
          r.items.map(i => [i.position, i.prompt, TYPE[i.type], i.answered, i.correct, pct(i.correctRate), DIFFICULTY[i.difficulty], i.topWrongOption?.text ?? '', i.topWrongOption ? i.topWrongOption.share : '', i.topWrongAnswers.map(a => `${a.text} (${a.count})`).join('; ')]),
        );
        return { filename: `lms-quiz-${slug(r.title) || 'items'}-${span(data.range)}.csv`, csv, rows: r.items.length, truncated: r.truncated };
      }
      case 'compliance': {
        const base = complianceInput.parse({ groupIds: q.groupIds, managerId: q.managerId, itemIds: q.itemIds, gapsOnly: q.gapsOnly, offset: 0, limit: 500 });
        let first: ComplianceOutput | null = null;
        const rows: ComplianceOutput['rows'] = [];
        for (let offset = 0; offset < 20_000; offset += 500) {
          const page = await loadCompliance({ ...base, offset });
          first ??= page;
          rows.push(...page.rows);
          if (page.rows.length < 500) break;
        }
        if (!first) throw new ZiteError('Nothing to export.', 'NOT_FOUND');
        const items = first.items;
        const { rows: groupRows } = await sql(`SELECT id::text AS "id", "name" FROM "Groups"`);
        const groupName = new Map(groupRows.map(g => [String(g.id), str(g.name) ?? '']));
        const keyDate = (c: ComplianceOutput['rows'][number]['cells'][number] | undefined) => {
          if (!c) return '';
          if (c.status === 'completed' || c.status === 'expired') return c.certificateExpiresAt ? `${c.status === 'expired' ? 'Expired' : 'Expires'} ${c.certificateExpiresAt.slice(0, 10)}` : c.completedAt ? `Completed ${c.completedAt.slice(0, 10)}` : '';
          return c.dueDate ? `Due ${c.dueDate}` : '';
        };
        const csv = toCsv(
          ['Person', 'Email', 'Job title', 'Groups', 'Required items', 'Compliant items', 'Gaps', ...items.flatMap(i => [i.title, `${i.title} — date`])],
          rows.map(r => [r.name, r.email, r.title ?? '', r.groupIds.map(g => groupName.get(g) ?? '').filter(Boolean).join('; '), r.required, r.compliant, r.gaps, ...items.flatMap((_, n) => {
            const c = r.cells[n];
            return [c ? STATUS_LABEL[c.status] + (c.compliant && c.status !== 'completed' ? ' (still certified)' : '') : 'Not required', keyDate(c)];
          })]),
        );
        return { filename: `lms-compliance-${today}.csv`, csv, rows: rows.length, truncated: rows.length >= 20_000 };
      }
    }
  },
});
