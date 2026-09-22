import { AlertTriangle, BellRing, CirclePlay, Mail, MoreHorizontal, Pencil, Play, Plus, Repeat, Route, Undo2, UserPlus, Workflow } from 'lucide-react';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@project/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { AudienceChips, CreatedBy, RESTORED, RuleMenuItems, RuleStatusPill } from '../components/assignments/RuleBits';
import { RuleEditor } from '../components/assignments/RuleEditor';
import { recurrenceText, useRuleActions, useRules, type RuleRow, type RuleStatus } from '../components/assignments/data';
import { EnrollmentsView } from '../components/enrollments/EnrollmentsView';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { CourseGlyph } from '../components/primitives/icons';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { longDate, shortDate, timeAgo } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useWorkspace } from '../lib/workspace';

const TABS: Array<{ key: RuleStatus; label: string }> = [
  { key: 'Active', label: 'Active' },
  { key: 'Paused', label: 'Paused' },
  { key: 'Archived', label: 'Archived' },
];

/**
 * Assignment rules: training that assigns itself. The list, each rule's
 * detail with the enrollments it created, and the editor (a sheet) for both.
 * `?new=1` opens the editor straight away (the sidebar's "New assignment rule").
 */
export function AssignmentsPage() {
  const { ruleId } = useParams();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rules = useRules();
  const [editor, setEditor] = useState<{ open: boolean; rule: RuleRow | null }>({ open: false, rule: null });

  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (ws.isAdmin) setEditor({ open: true, rule: null });
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams, ws.isAdmin]);

  const openEditor = useCallback((rule: RuleRow | null) => setEditor({ open: true, rule }), []);
  const rule = ruleId ? rules.data?.rules.find(r => r.id === ruleId) : undefined;

  return (
    <>
      {ruleId ? <RuleDetail ruleId={ruleId} rule={rule} loading={rules.isPending} failed={rules.isError} onEdit={openEditor} /> : <RulesList query={rules} onEdit={openEditor} />}
      <RuleEditor
        open={editor.open}
        rule={editor.rule}
        onOpenChange={o => setEditor(s => ({ ...s, open: o }))}
        onSaved={id => {
          if (!editor.rule) navigate(`/assignments/${id}`);
        }}
      />
    </>
  );
}

function RemindersMenu() {
  const ws = useWorkspace();
  const { runReminders } = useRuleActions();
  const [busy, setBusy] = useState(false);
  if (!ws.isAdmin) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="More actions">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">Reminders go out every day at 14:00 UTC</DropdownMenuLabel>
        <DropdownMenuItem
          className="items-start gap-2 py-2 text-[14px]"
          disabled={busy}
          onSelect={async () => {
            setBusy(true);
            await runReminders();
            setBusy(false);
          }}
        >
          <BellRing className="mt-0.5 h-3.5 w-3.5" />
          <span>
            <span className="block">Run reminders now</span>
            <span className="block text-sm text-muted-foreground">Due-soon and overdue nudges, manager digests, recertification, expiring certificates and session reminders. Nobody is reminded twice.</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RulesList({ query, onEdit }: { query: ReturnType<typeof useRules>; onEdit: (r: RuleRow | null) => void }) {
  useDocumentTitle('Assignment rules');
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { run, save } = useRuleActions();
  const [params] = useSearchParams();
  const tab = (TABS.some(t => t.key === params.get('status')) ? params.get('status') : 'Active') as RuleStatus;
  const all = query.data?.rules ?? [];
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, all.filter(r => r.status === t.key).length])) as Record<RuleStatus, number>, [all]);
  const rows = useMemo(() => all.filter(r => r.status === tab), [all, tab]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => setFocusedId(null), [tab]);

  const focusIndex = rows.findIndex(r => r.id === focusedId);
  const focused = focusIndex >= 0 ? rows[focusIndex] : undefined;
  const focusAt = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    setFocusedId(r.id);
    window.setTimeout(() => scrollRef.current?.querySelector(`[data-rule-id="${r.id}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
  };
  useHotkeys({
    j: () => focusAt(focusIndex + 1),
    down: () => focusAt(focusIndex + 1),
    k: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
    up: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
    enter: () => focused && navigate(`/assignments/${focused.id}`),
    esc: () => setFocusedId(null),
    n: () => ws.isAdmin && onEdit(null),
    e: () => ws.isAdmin && focused && onEdit(focused),
    'shift+r': () => ws.isAdmin && focused?.status === 'Active' && focused.targetStatus === 'Published' && run(focused),
    'shift+p': () => {
      if (!ws.isAdmin || !focused) return;
      // The rule leaves this tab, so keep the cursor on its neighbour.
      const neighbour = rows[focusIndex + 1] ?? rows[focusIndex - 1];
      if (focused.status === 'Active') save({ action: 'pause', id: focused.id }, 'Pausing…').catch(() => undefined);
      else if (focused.status === 'Paused' && focused.targetStatus === 'Published') save({ action: 'resume', id: focused.id }, 'Resuming…').catch(() => undefined);
      else return;
      setFocusedId(neighbour?.id ?? null);
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<Workflow />}
        title="Assignment rules"
        tabs={TABS.map(t => ({
          to: t.key === 'Active' ? '/assignments' : `/assignments?status=${t.key}`,
          label: t.label,
          count: counts[t.key],
          active: tab === t.key,
        }))}
        actions={
          <>
            <RemindersMenu />
            {ws.isAdmin && (
              <Tip label="New rule" keys={['N']}>
                <button type="button" onClick={() => onEdit(null)} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                  <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New rule</span>
                </button>
              </Tip>
            )}
          </>
        }
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <SkeletonRows rows={6} className="pt-2" />
        ) : query.isError ? (
          <EmptyState
            icon={<Workflow />}
            title="Couldn't load assignment rules"
            description="Check your connection and try again."
            action={
              <button type="button" onClick={() => query.refetch()} className="text-[14px] text-primary hover:underline">
                Retry
              </button>
            }
          />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Workflow />}
            title="Training that assigns itself"
            description="A rule enrolls the right people in a course or learning path — everyone, a department or a cohort — with a due date, yearly recertification, and new joiners picked up automatically."
            action={
              ws.isAdmin ? (
                <button type="button" onClick={() => onEdit(null)} className="h-9 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">
                  Create your first rule
                </button>
              ) : undefined
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Workflow />}
            title={tab === 'Paused' ? 'No paused rules' : tab === 'Archived' ? 'No archived rules' : 'No active rules'}
            description={
              tab === 'Paused' ? 'Pause a rule to stop it enrolling anyone new without losing its setup.' : tab === 'Archived' ? 'Rules you archive stay here for the record and can be restored.' : 'Resume a paused rule or create a new one.'
            }
          />
        ) : (
          <div role="grid" aria-label={`${tab} rules`}>
            <div role="row" className={cn(RULE_COLS, 'sticky top-0 z-10 hidden h-9 border-b bg-subtle/95 text-sm text-muted-foreground backdrop-blur md:grid')}>
              <span role="columnheader">Training</span>
              <span role="columnheader">Assigned to</span>
              <span role="columnheader" className="hidden lg:block">
                Due
              </span>
              <Tip label="Enrolled through this rule, latest cycle">
                <span role="columnheader" className="text-right">
                  Enrolled
                </span>
              </Tip>
              <span role="columnheader" className="text-right">
                Completed
              </span>
              <Tip label="Past their due date and not finished">
                <span role="columnheader" className="text-right">
                  Overdue
                </span>
              </Tip>
              <span role="columnheader" className="hidden text-right xl:block">
                Last run
              </span>
              <span aria-hidden />
            </div>
            {rows.map(r => (
              <RuleListRow key={r.id} rule={r} focused={focusedId === r.id} onFocus={setFocusedId} onEdit={onEdit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One column template for the header and every row. */
const RULE_COLS = 'items-center gap-x-4 pl-5 pr-3 md:grid-cols-[minmax(0,1fr)_200px_60px_84px_60px_28px] lg:grid-cols-[minmax(0,1fr)_210px_150px_60px_84px_60px_28px] xl:grid-cols-[minmax(0,1fr)_220px_160px_64px_88px_64px_76px_28px]';

const dueLine = (r: RuleRow) => (r.dueMode === 'Relative' && r.dueDays ? `${r.dueDays} day${r.dueDays === 1 ? '' : 's'} to finish` : r.dueMode === 'Fixed' && r.dueDate ? `Due ${shortDate(r.dueDate)}` : 'No due date');
const audienceLine = (r: RuleRow) => `${r.audienceSize.toLocaleString()} ${r.audienceSize === 1 ? 'person' : 'people'}${r.includeFutureMembers && r.audience !== 'People' ? ' · and new joiners' : ''}`;

const RuleListRow = memo(function RuleListRow({ rule: r, focused, onFocus, onEdit }: { rule: RuleRow; focused: boolean; onFocus: (id: string) => void; onEdit: (r: RuleRow) => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const unpublished = r.targetStatus !== 'Published';
  const pct = r.counts.enrolled ? Math.round((r.counts.completed / r.counts.enrolled) * 100) : 0;
  const training = (
    <div className="flex min-w-0 items-center gap-2.5">
      <CourseGlyph icon={r.targetIcon} color={r.targetColor} size={24} className="rounded-md" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{r.targetTitle}</span>
          {r.targetType === 'Path' && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 text-2xs font-medium text-muted-foreground">
              <Route className="h-2.5 w-2.5" /> Path
            </span>
          )}
          {unpublished && (
            <Tip label={r.targetStatus === 'Missing' ? 'What this rule assigns was deleted' : `The ${r.targetType === 'Path' ? 'path' : 'course'} is ${r.targetStatus.toLowerCase()}, so the rule can't enroll anyone`}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-tone-warning" aria-label="Not published" />
            </Tip>
          )}
        </div>
        <div className="truncate text-sm text-muted-foreground">{r.name}</div>
      </div>
    </div>
  );
  const menu = (
    <div className="flex w-7 justify-end" onClick={e => e.stopPropagation()}>
      {ws.isAdmin && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" aria-label={`Actions for ${r.name}`} className="opacity-60 group-hover/row:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <RuleMenuItems rule={r} kind="dropdown" onEdit={onEdit} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="row"
          data-rule-id={r.id}
          onClick={() => navigate(`/assignments/${r.id}`)}
          onMouseMove={() => !focused && onFocus(r.id)}
          className={cn('group/row relative cursor-default select-none border-b border-border/60 text-[14px] transition-colors duration-75', focused ? 'bg-accent/80' : 'hover:bg-accent/50')}
        >
          {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
          {/* Phones: what, then who, then how it's going in words. */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 py-2.5 pl-4 pr-2 md:hidden">
            {training}
            {menu}
            <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-[34px] text-sm text-muted-foreground">
              <AudienceChips rule={r} />
              <span className="tabular-nums">
                {r.counts.enrolled.toLocaleString()} enrolled · {r.counts.completed.toLocaleString()} completed
                {r.counts.overdue > 0 && <span className="text-tone-danger"> · {r.counts.overdue.toLocaleString()} overdue</span>}
              </span>
            </div>
          </div>
          <div className={cn(RULE_COLS, 'hidden min-h-[52px] py-2 md:grid')}>
            <div role="gridcell" className="min-w-0">
              {training}
            </div>
            <div role="gridcell" className="min-w-0">
              <AudienceChips rule={r} />
              <div className="mt-0.5 truncate text-sm text-muted-foreground">{audienceLine(r)}</div>
            </div>
            <div role="gridcell" className="hidden min-w-0 text-sm lg:block">
              <div className="truncate">{dueLine(r)}</div>
              <div className="truncate text-muted-foreground">{r.recurrenceMonths ? `Repeats ${recurrenceText(r.recurrenceMonths)}` : 'Once'}</div>
            </div>
            <div role="gridcell" className="text-right tabular-nums">
              {r.counts.enrolled.toLocaleString()}
            </div>
            <div role="gridcell" className="text-right tabular-nums">
              <Tip label={`${pct}% of the people it enrolled have finished`}>
                <span>
                  {r.counts.completed.toLocaleString()} <span className="text-sm text-muted-foreground">{pct}%</span>
                </span>
              </Tip>
            </div>
            <div role="gridcell" className={cn('text-right tabular-nums', r.counts.overdue ? 'font-medium text-tone-danger' : 'text-muted-foreground')}>
              {r.counts.overdue.toLocaleString()}
            </div>
            <div role="gridcell" className="hidden whitespace-nowrap text-right text-sm text-muted-foreground xl:block">
              {r.lastRunAt ? timeAgo(r.lastRunAt) : 'Never'}
            </div>
            {menu}
          </div>
        </div>
      </ContextMenuTrigger>
      {ws.isAdmin && (
        <ContextMenuContent className="w-52">
          <RuleMenuItems rule={r} kind="context" onEdit={onEdit} />
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
});

/** A stat strip cell: label, number, and a hint line that's always there so every number sits on one baseline. */
function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="truncate text-sm text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-[20px] font-semibold leading-6 tabular-nums tracking-tight', tone)}>{value}</div>
      <div className="mt-0.5 h-4 truncate text-sm text-muted-foreground">{hint}</div>
    </div>
  );
}

function RuleDetail({ ruleId, rule, loading, failed, onEdit }: { ruleId: string; rule: RuleRow | undefined; loading: boolean; failed: boolean; onEdit: (r: RuleRow) => void }) {
  useDocumentTitle(rule?.name ?? 'Assignment rule');
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { run, save } = useRuleActions();
  const [running, setRunning] = useState(false);

  useHotkeys({ e: () => rule && ws.isAdmin && onEdit(rule) });

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader icon={<Workflow />} breadcrumb={{ to: '/assignments', label: 'Assignment rules' }} title={<span className="skeleton inline-block h-3.5 w-48 align-middle" />} />
        <div className="space-y-3 p-6">
          <div className="skeleton h-6 w-2/3" />
          <div className="skeleton h-16 w-full" />
          <SkeletonRows rows={6} />
        </div>
      </div>
    );
  }
  if (!rule) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader icon={<Workflow />} breadcrumb={{ to: '/assignments', label: 'Assignment rules' }} title="Rule" />
        <EmptyState
          icon={<Workflow />}
          title={failed ? "Couldn't load this rule" : 'This rule no longer exists'}
          description={failed ? 'Check your connection and try again.' : 'It may have been deleted. The enrollments it created are still in Enrollments.'}
          action={
            <Link to="/assignments" className="text-[14px] text-primary hover:underline">
              Back to assignment rules
            </Link>
          }
        />
      </div>
    );
  }

  const target = rule.targetType === 'Path' ? ws.pathById.get(rule.pathId ?? '') : ws.courseById.get(rule.courseId ?? '');
  const targetLink = rule.targetType === 'Path' ? `/paths/${rule.pathId}` : `/courses/${rule.courseId}`;
  const unpublished = rule.targetStatus !== 'Published';
  const pct = rule.counts.enrolled ? Math.round((rule.counts.completed / rule.counts.enrolled) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={<Workflow />}
        breadcrumb={{
          to: rule.status === 'Active' ? '/assignments' : `/assignments?status=${rule.status}`,
          label: 'Assignment rules',
        }}
        title={rule.name}
        actions={
          <>
            <RuleStatusPill status={rule.status} className="mr-1" />
            {ws.isAdmin && rule.status === 'Active' && (
              <Tip label={unpublished ? 'Publish what this rule assigns first' : 'Enroll anyone in the audience who isn’t yet'}>
                <span className="hidden sm:inline-flex">
                  <button
                    type="button"
                    disabled={unpublished || running}
                    onClick={async () => {
                      setRunning(true);
                      await run(rule);
                      setRunning(false);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" /> {running ? 'Running…' : 'Run now'}
                  </button>
                </span>
              </Tip>
            )}
            {ws.isAdmin && rule.status === 'Paused' && (
              <Tip label={unpublished ? 'Publish what this rule assigns first' : 'Turn it back on and enroll anyone in the audience who isn’t yet'}>
                <span className="inline-flex">
                  <button
                    type="button"
                    disabled={unpublished || running}
                    onClick={async () => {
                      setRunning(true);
                      await save({ action: 'resume', id: rule.id }, 'Resuming and enrolling people…').catch(() => undefined);
                      setRunning(false);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50"
                  >
                    <CirclePlay className="h-3.5 w-3.5" /> {running ? 'Resuming…' : 'Resume'}
                  </button>
                </span>
              </Tip>
            )}
            {ws.isAdmin && rule.status === 'Archived' && (
              <button
                type="button"
                disabled={running}
                onClick={async () => {
                  setRunning(true);
                  await save({ action: 'pause', id: rule.id }, 'Restoring…', RESTORED).catch(() => undefined);
                  setRunning(false);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent disabled:opacity-50"
              >
                <Undo2 className="h-3.5 w-3.5" /> {running ? 'Restoring…' : 'Restore'}
              </button>
            )}
            {ws.isAdmin && (
              <Tip label="Edit rule" keys={['E']}>
                <button type="button" onClick={() => onEdit(rule)} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
                  <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
                </button>
              </Tip>
            )}
            {ws.isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton aria-label="More rule actions">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <RuleMenuItems rule={rule} kind="dropdown" onEdit={onEdit} onDeleted={() => navigate('/assignments')} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      {/* Phones: the summary scrolls away so the learner list gets the screen. */}
      <div className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto">
        <div className="shrink-0 border-b px-4 py-4 sm:px-6">
          {/* Plain inline text, so it wraps like a sentence: each clause stays whole and a separator never starts a line. */}
          <p className="text-[15px] leading-8">
            <span className="text-muted-foreground">Assigns </span>
            <Link to={targetLink} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border bg-background px-2 align-middle font-medium shadow-2xs hover:bg-accent">
              <CourseGlyph icon={target?.icon ?? rule.targetIcon} color={target?.color ?? rule.targetColor} size={16} />
              <span className="truncate">{rule.targetTitle}</span>
              {rule.targetType === 'Path' && <Route className="h-3 w-3 shrink-0 text-muted-foreground" />}
            </Link>
            <span className="text-muted-foreground"> to </span>
            <AudienceChips rule={rule} max={6} className="align-middle" />
            <span className="text-muted-foreground">{'\u00a0·'}</span>{' '}
            {[
              <span key="due">{rule.dueMode === 'Fixed' && rule.dueDate ? `due ${longDate(rule.dueDate)}` : rule.dueMode === 'Relative' ? rule.dueText.replace(/^Due/, 'due') : 'no due date'}</span>,
              rule.recurrenceMonths ? (
                <span key="repeat">
                  <Repeat className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" />
                  repeats {recurrenceText(rule.recurrenceMonths)}
                </span>
              ) : (
                <span key="repeat">assigned once</span>
              ),
              rule.includeFutureMembers && rule.audience !== 'People' ? (
                <span key="join">
                  <UserPlus className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" />
                  includes people who join later
                </span>
              ) : null,
              <span key="mail" className="text-muted-foreground">
                <Mail className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                {rule.sendEmail ? 'emails people' : 'no emails'}
              </span>,
            ]
              .filter(Boolean)
              .map((clause, i, all) => (
                <Fragment key={i}>
                  <span className="whitespace-nowrap">
                    {clause}
                    {i < all.length - 1 && <span className="text-muted-foreground">{'\u00a0·'}</span>}
                  </span>{' '}
                </Fragment>
              ))}
          </p>
          {unpublished && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-tone-warning/30 bg-tone-warning/[0.06] px-3 py-2 text-[14px]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-warning" />
              <span>
                {rule.targetStatus === 'Missing'
                  ? 'What this rule assigns has been deleted, so it can’t enroll anyone. Archive or delete the rule.'
                  : `“${rule.targetTitle}” is ${rule.targetStatus.toLowerCase()}. The rule enrolls nobody until it’s published again.`}
              </span>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4 [&>*]:bg-card">
            <Stat
              label="In the audience"
              value={rule.audienceSize.toLocaleString()}
              hint={rule.audience === 'Everyone' ? 'Active people' : rule.audience === 'Groups' ? `In ${rule.groupIds.length} ${rule.groupIds.length === 1 ? 'group' : 'groups'}` : 'Picked by name'}
            />
            <Stat
              label="Enrolled by this rule"
              value={rule.counts.enrolled.toLocaleString()}
              hint={rule.recurrenceMonths ? 'Latest cycle' : rule.audienceSize > rule.counts.enrolled ? `${(rule.audienceSize - rule.counts.enrolled).toLocaleString()} not enrolled by it` : 'Everyone in the audience'}
            />
            <Stat label="Completed" value={rule.counts.completed.toLocaleString()} hint={rule.counts.enrolled ? `${pct}% of enrolled` : 'Nobody enrolled yet'} />
            <Stat label="Overdue" value={rule.counts.overdue.toLocaleString()} tone={rule.counts.overdue ? 'text-tone-danger' : undefined} hint={rule.counts.overdue ? 'Past due, not finished' : 'Nobody is late'} />
          </div>
          <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              Created by <CreatedBy rule={rule} />
              {rule.createdAt && <span>on {shortDate(rule.createdAt)}</span>}
            </span>
            <span aria-hidden>·</span>
            <Tip label={rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString() : 'It runs when it’s created or resumed, when people join, and when you run it'}>
              <span>{rule.lastRunAt ? `Last ran ${timeAgo(rule.lastRunAt)}` : 'Hasn’t run yet'}</span>
            </Tip>
          </p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col max-md:min-h-[calc(100dvh-6rem)]">
          <EnrollmentsView
            key={ruleId}
            surfaceKey={`rule:${ruleId}`}
            baseFilters={{ ruleId }}
            // A course rule's list is all one course, so lead with people and drop the course column.
            defaults={
              rule.targetType === 'Path'
                ? { groupBy: 'person' }
                : {
                    groupBy: 'none',
                    properties: ['person', 'due', 'progress', 'score', 'activity'],
                  }
            }
            hideSaveView
            emptyState={
              <EmptyState
                icon={<Workflow />}
                title="Nobody enrolled by this rule yet"
                description={
                  rule.status === 'Active' ? (rule.audienceSize ? 'Everyone in the audience was already enrolled when it ran. People who join later show up here.' : 'The audience is empty right now.') : 'Resume the rule to enroll its audience.'
                }
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
