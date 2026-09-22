import { ArrowDown, ArrowUp, ChevronLeft, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@project/components/lib/utils';
import { useWorkspace } from '../../lib/workspace';
import { Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import type { QuizReport } from './params';
import { AXIS_TICK, countAxis, CountTooltip, DataTable, GRID_STROKE, HBar, KpiSkeleton, KpiTile, LegendKey, OTHER, Panel, PanelEmpty, PanelSkeleton, fmt, pctText, slot } from './viz';

const TYPE_LABEL: Record<string, string> = { single: 'Single choice', multiple: 'Multiple choice', true_false: 'True or false', short: 'Short answer' };
/** Only "Hard" is coloured: it's the one that asks for a look at the question. */
const DIFFICULTY: Record<string, { label: string; cls: string; hint: string }> = {
  easy: { label: 'Easy', cls: 'text-muted-foreground', hint: '85% or more answer correctly' },
  moderate: { label: 'Moderate', cls: 'text-foreground', hint: 'Between half and 85% answer correctly' },
  hard: { label: 'Hard', cls: 'bg-tone-danger/[0.08] px-1.5 font-medium text-tone-danger', hint: 'Fewer than half answer correctly — check the wording and the answer key' },
  unknown: { label: 'Too few answers', cls: 'text-muted-foreground/70', hint: 'Needs at least 3 answers to judge' },
};

type QuizSort = 'title' | 'questions' | 'attempts' | 'learners' | 'firstPassRate' | 'passRate' | 'averageScore';

function SortTh({ label, k, sort, dir, onSort, align = 'right', className }: { label: string; k: QuizSort; sort: QuizSort; dir: 'asc' | 'desc'; onSort: (k: QuizSort) => void; align?: 'left' | 'right'; className?: string }) {
  const active = sort === k;
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('h-9 whitespace-nowrap border-b px-3 font-medium', align === 'right' ? 'text-right' : 'text-left', className)}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 rounded hover:text-foreground', align === 'right' && 'flex-row-reverse', active && 'text-foreground')}>
        {label}
        {active ? dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <span className="w-3" />}
      </button>
    </th>
  );
}

export function QuizListSkeleton() {
  return <PanelSkeleton title="Quizzes" description="Every quiz, with pass rates for attempts in the range." height={240} />;
}

export function QuizList({ data, onPick, courseFiltered, stale }: { data: QuizReport; onPick: (lessonId: string) => void; courseFiltered: boolean; stale: boolean }) {
  const ws = useWorkspace();
  const [sort, setSort] = useState<QuizSort>('attempts');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const rows = useMemo(() => {
    const val = (q: QuizReport['quizzes'][number]) => (sort === 'title' ? q.title.toLowerCase() : q[sort] ?? -1);
    // Server order (most attempts, then course) breaks ties, so equal rows never shuffle.
    return data.quizzes
      .map((q, i) => ({ q, i }))
      .sort((a, b) => {
        const x = val(a.q);
        const y = val(b.q);
        const c = typeof x === 'string' ? x.localeCompare(String(y)) : (x as number) - (y as number);
        return (dir === 'asc' ? c : -c) || a.i - b.i;
      })
      .map(r => r.q);
  }, [data.quizzes, sort, dir]);
  const onSort = (k: QuizSort) => {
    if (k === sort) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      setDir(k === 'title' || k === 'firstPassRate' || k === 'passRate' || k === 'averageScore' ? 'asc' : 'desc');
    }
  };
  const td = 'h-11 whitespace-nowrap border-b px-3 tabular-nums';
  const th = { sort, dir, onSort };
  return (
    <Panel id="quizzes" title="Quizzes" description="Every quiz, with pass rates for attempts in the range. Select one for item analysis." className={cn('transition-opacity', stale && 'opacity-60')} bodyClassName="px-0 pb-1 pt-2">
      {!rows.length ? (
        <PanelEmpty className="h-[200px]" title={courseFiltered ? 'This course has no quizzes' : 'No quizzes yet'} description="Add a quiz lesson to a course to see pass rates and item analysis here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[14px] [&>tbody>tr:last-child>td]:border-b-0">
            <caption className="sr-only">Quizzes</caption>
            <thead>
              <tr className="text-left text-sm text-muted-foreground">
                <SortTh label="Quiz" k="title" align="left" className="pl-4" {...th} />
                <SortTh label="Questions" k="questions" {...th} />
                <SortTh label="Attempts" k="attempts" {...th} />
                <SortTh label="Learners" k="learners" {...th} />
                <SortTh label="Passed first time" k="firstPassRate" align="left" className="w-[200px]" {...th} />
                <SortTh label="Passed eventually" k="passRate" {...th} />
                <SortTh label="Avg score" k="averageScore" className="pr-4" {...th} />
              </tr>
            </thead>
            <tbody>
              {rows.map(q => {
                const course = ws.courseById.get(q.courseId);
                const below = q.averageScore != null && q.averageScore < q.passingScore;
                return (
                  <tr key={q.lessonId} className="cursor-pointer hover:bg-accent/40" onClick={() => onPick(q.lessonId)}>
                    <td className={cn(td, 'max-w-[340px] pl-4')}>
                      <button type="button" onClick={e => (e.stopPropagation(), onPick(q.lessonId))} className="flex min-w-0 items-center gap-2 text-left">
                        <CourseGlyph icon={course?.icon} color={course?.color} size={18} />
                        <span className="min-w-0">
                          <span className="block truncate leading-4 hover:underline">{q.title}</span>
                          <span className="block truncate text-2xs leading-4 text-muted-foreground">{course?.title ?? q.courseTitle}</span>
                        </span>
                      </button>
                    </td>
                    <td className={cn(td, 'text-right')}>{fmt(q.questions)}</td>
                    <td className={cn(td, 'text-right')}>{q.attempts ? fmt(q.attempts) : <span className="text-muted-foreground/60">0</span>}</td>
                    <td className={cn(td, 'text-right')}>{q.learners ? fmt(q.learners) : <span className="text-muted-foreground/60">0</span>}</td>
                    <td className={td}>{q.firstPassRate == null ? <span className="text-muted-foreground/60">No attempts</span> : <HBar value={q.firstPassRate} max={100} color={slot(0)} track label={pctText(q.firstPassRate)} />}</td>
                    <td className={cn(td, 'text-right')}>{pctText(q.passRate)}</td>
                    <td className={cn(td, 'pr-4 text-right')}>
                      {q.averageScore == null ? (
                        <span className="text-muted-foreground/60">—</span>
                      ) : (
                        <Tip label={below ? `Below the ${q.passingScore}% passing score` : `Passing score is ${q.passingScore}%`}>
                          <span className={cn(below && 'text-tone-warning')}>{pctText(q.averageScore)}</span>
                        </Tip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ScoresPanel({ report, className }: { report: NonNullable<QuizReport['report']>; className?: string }) {
  const rows = report.scores;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const table = <DataTable caption="Score distribution" headers={['Score', 'Attempts']} align={['left', 'right']} rows={rows.map(r => [`${r.label}%`, fmt(r.count)])} footer={['Total', fmt(total)]} />;
  return (
    <Panel
      id="scores"
      title="Score distribution"
      description={`Every attempt in the range. Passing score ${report.passingScore}%.`}
      className={className}
      table={total ? table : undefined}
      actions={
        total > 0 && (
          <div className="flex items-center gap-3">
            <LegendKey color={slot(0)} label="Passing" />
            <LegendKey color={OTHER} label="Below passing" />
          </div>
        )
      }
    >
      {!total ? (
        <PanelEmpty className="h-[200px]" title="No attempts in this range" />
      ) : (
        <div onMouseDown={e => e.preventDefault()} role="figure" aria-label={`Score distribution: ${rows.filter(r => r.count).map(r => `${r.label}%: ${r.count}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows} margin={{ top: 18, right: 4, bottom: 0, left: -18 }} barCategoryGap="14%">
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID_STROKE }} tick={AXIS_TICK} tickMargin={8} interval="preserveStartEnd" minTickGap={4} />
              <YAxis {...countAxis(Math.max(0, ...rows.map(r => r.count)))} />
              <Tooltip cursor={{ fill: 'hsl(var(--accent))', opacity: 0.6 }} content={<CountTooltip noun={['attempt', 'attempts']} title={l => `Scored ${l}%`} />} isAnimationActive={false} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false}>
                {rows.map(r => (
                  <Cell key={r.label} fill={r.min >= report.passingScore || (r.min + 10 > report.passingScore && r.min === 90) ? slot(0) : OTHER} />
                ))}
                <LabelList dataKey="count" position="top" offset={6} className="fill-muted-foreground text-[12px] tabular-nums" formatter={(v: number) => (v ? v.toLocaleString() : '')} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function AttemptsPanel({ report, className }: { report: NonNullable<QuizReport['report']>; className?: string }) {
  const rows = report.attemptsPerLearner;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const table = <DataTable caption="Attempts per learner" headers={['Attempts', 'Learners']} align={['left', 'right']} rows={rows.map(r => [r.label, fmt(r.count)])} footer={['Total', fmt(total)]} />;
  return (
    <Panel id="attempts" title="Attempts per learner" description={report.maxAttempts ? `Learners may take it up to ${report.maxAttempts} times.` : 'Unlimited attempts allowed.'} className={className} table={total ? table : undefined} actions={report.averageAttempts != null && <span className="text-sm text-muted-foreground">Average <span className="font-medium tabular-nums text-foreground">{report.averageAttempts}</span></span>}>
      {!total ? (
        <PanelEmpty className="h-[200px]" title="No attempts in this range" />
      ) : (
        <div onMouseDown={e => e.preventDefault()} role="figure" aria-label={`Attempts per learner: ${rows.map(r => `${r.label}: ${r.count}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows} margin={{ top: 18, right: 4, bottom: 0, left: -18 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID_STROKE }} tick={AXIS_TICK} tickMargin={8} interval={0} />
              <YAxis {...countAxis(Math.max(0, ...rows.map(r => r.count)))} />
              <Tooltip cursor={{ fill: 'hsl(var(--accent))', opacity: 0.6 }} content={<CountTooltip noun={['learner', 'learners']} title={l => `Took ${l}`} />} isAnimationActive={false} />
              <Bar dataKey="count" fill={slot(0)} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                <LabelList dataKey="count" position="top" offset={6} className="fill-muted-foreground text-[12px] tabular-nums" formatter={(v: number) => (v ? v.toLocaleString() : '')} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function ItemAnalysis({ report }: { report: NonNullable<QuizReport['report']> }) {
  const items = report.items;
  const hard = items.filter(i => i.difficulty === 'hard');
  const td = 'border-b px-3 py-2.5 align-top';
  return (
    <Panel
      id="items"
      title="Item analysis"
      description="Each question in quiz order, graded against the quiz as it is now."
      bodyClassName="px-0 pb-1 pt-2"
      actions={<span className="text-sm text-muted-foreground">{fmt(report.analyzedAttempts)} {report.analyzedAttempts === 1 ? 'attempt' : 'attempts'} analysed</span>}
    >
      {!items.length ? (
        <PanelEmpty className="h-[160px]" title="This quiz has no questions" />
      ) : !report.attempts ? (
        <PanelEmpty className="h-[160px]" title="No attempts in this range" description="Item analysis appears once learners take the quiz." />
      ) : (
        <>
          {(report.truncated || report.removedQuestionAnswers > 0 || hard.length > 0) && (
            <div className="mx-4 mb-2 space-y-1 text-sm text-muted-foreground">
              {hard.length > 0 && <p><span className="font-medium text-tone-danger">{hard.length === 1 ? 'Question' : 'Questions'} {hard.map(h => h.position).join(', ')}</span> {hard.length === 1 ? 'is' : 'are'} answered correctly by fewer than half of learners — worth checking the wording and the answer key.</p>}
              {report.truncated && <p>Analysed the most recent {fmt(report.analyzedAttempts)} attempts; narrow the range to include older ones.</p>}
              {report.removedQuestionAnswers > 0 && <p>{fmt(report.removedQuestionAnswers)} {report.removedQuestionAnswers === 1 ? 'answer was' : 'answers were'} to questions that have since been removed and aren’t counted.</p>}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[14px] [&>tbody>tr:last-child>td]:border-b-0">
              <caption className="sr-only">Item analysis</caption>
              <thead>
                <tr className="text-left text-sm text-muted-foreground">
                  <th scope="col" className="h-9 w-10 border-b px-3 pl-4 text-right font-medium">#</th>
                  <th scope="col" className="h-9 border-b px-3 font-medium">Question</th>
                  <th scope="col" className="h-9 border-b px-3 text-right font-medium">Answered</th>
                  <th scope="col" className="h-9 w-[180px] border-b px-3 font-medium">Correct</th>
                  <th scope="col" className="h-9 w-[260px] border-b px-3 font-medium">Most common wrong answer</th>
                  <th scope="col" className="h-9 border-b px-3 pr-4 font-medium">Difficulty</th>
                </tr>
              </thead>
              <tbody>
                {items.map(i => {
                  const d = DIFFICULTY[i.difficulty];
                  return (
                    <tr key={i.questionId} className="hover:bg-accent/30">
                      <td className={cn(td, 'pl-4 text-right text-sm tabular-nums text-muted-foreground')}>{i.position}</td>
                      <td className={cn(td, 'max-w-[380px]')}>
                        <span className="line-clamp-2" title={i.prompt}>
                          {i.prompt || <span className="italic text-muted-foreground">No prompt</span>}
                        </span>
                        <span className="text-2xs text-muted-foreground">{TYPE_LABEL[i.type]}</span>
                      </td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmt(i.answered)}</td>
                      <td className={td}>
                        {i.correctRate == null ? (
                          <span className="text-muted-foreground/60">—</span>
                        ) : (
                          <Tip label={`${fmt(i.correct)} of ${fmt(i.answered)} answered correctly`}>
                            <div className="pt-1">
                              <HBar value={i.correctRate} max={100} color={i.difficulty === 'hard' ? 'rgb(var(--tone-danger))' : slot(0)} track label={pctText(i.correctRate)} />
                            </div>
                          </Tip>
                        )}
                      </td>
                      <td className={cn(td, 'max-w-[260px] text-[13.5px]')}>
                        {i.type === 'short' ? (
                          i.topWrongAnswers.length ? (
                            <span className="flex flex-wrap gap-1">
                              {i.topWrongAnswers.map(a => (
                                <span key={a.text} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-subtle px-1.5 text-sm leading-5">
                                  <span className="truncate">“{a.text}”</span>
                                  <span className="tabular-nums text-muted-foreground">×{a.count}</span>
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )
                        ) : i.topWrongOption ? (
                          <span className="block">
                            <span className="line-clamp-2">{i.topWrongOption.text}</span>
                            <span className="text-2xs text-muted-foreground">
                              {fmt(i.topWrongOption.count)} {i.topWrongOption.count === 1 ? 'pick' : 'picks'} · {i.topWrongOption.share}% of wrong answers
                            </span>
                          </span>
                        ) : i.answered > i.correct ? (
                          <span className="text-sm text-muted-foreground">Missed a correct choice</span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className={cn(td, 'pr-4')}>
                        <Tip label={d.hint}>
                          <span tabIndex={0} className={cn('inline-flex h-[22px] items-center whitespace-nowrap rounded-md text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring', d.cls)}>{d.label}</span>
                        </Tip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

export function QuizReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-5 w-64" />
      <KpiSkeleton count={5} className="grid-cols-2 xl:grid-cols-5" />
      <PanelSkeleton title="Item analysis" height={220} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PanelSkeleton title="Score distribution" height={200} />
        <PanelSkeleton title="Attempts per learner" height={200} />
      </div>
    </div>
  );
}

export function QuizDetail({ report, onBack, stale, onWiden }: { report: NonNullable<QuizReport['report']>; onBack: () => void; stale: boolean; onWiden?: () => void }) {
  const ws = useWorkspace();
  const course = ws.courseById.get(report.courseId);
  return (
    <div className={cn('space-y-4 transition-opacity', stale && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={onBack} className="flex h-8 items-center gap-1 rounded-md pl-1 pr-2 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> All quizzes
        </button>
        <CourseGlyph icon={course?.icon} color={course?.color} size={28} />
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-[16px] font-semibold tracking-tight sm:truncate">{report.title}</h2>
          <p className="truncate text-sm text-muted-foreground">
            {report.courseTitle} · {report.items.length} {report.items.length === 1 ? 'question' : 'questions'} · pass at {report.passingScore}%
          </p>
        </div>
        {ws.editableCourseIds.has(report.courseId) || ws.isAdmin ? (
          <Link to={`/courses/${report.courseId}/content/${report.lessonId}`} className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
            <Pencil className="h-3.5 w-3.5" /> Edit quiz
          </Link>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border xl:grid-cols-5 [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1" role="list" aria-label="Quiz numbers">
        <KpiTile label="Attempts" value={fmt(report.attempts)} hint={`${fmt(report.learners)} ${report.learners === 1 ? 'learner' : 'learners'}`} />
        <KpiTile label="Passed first time" value={pctText(report.firstPassRate)} hint="Of first attempts" />
        <KpiTile label="Passed eventually" value={pctText(report.passRate)} hint="Of learners who tried" />
        <KpiTile label="Average score" value={pctText(report.averageScore)} tone={report.averageScore != null && report.averageScore < report.passingScore ? 'text-tone-warning' : undefined} hint={`Passing is ${report.passingScore}%`} />
        <KpiTile label="Attempts per learner" value={report.averageAttempts != null ? report.averageAttempts.toLocaleString() : '—'} hint={report.maxAttempts ? `Up to ${report.maxAttempts} allowed` : 'Unlimited allowed'} />
      </div>
      {report.attempts === 0 && report.items.length > 0 ? (
        // Three empty panels say the same thing three times; one message and a way out says it once.
        <div className="rounded-lg border bg-card">
          <PanelEmpty
            className="py-14"
            title="Nobody took this quiz in the range"
            description="Item analysis, scores and attempts appear once learners have answered it."
            action={
              onWiden ? (
                <button type="button" onClick={onWiden} className="text-[14px] font-medium text-primary hover:underline">
                  Show the last 12 months
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <ItemAnalysis report={report} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ScoresPanel report={report} />
            <AttemptsPanel report={report} />
          </div>
        </>
      )}
    </div>
  );
}

