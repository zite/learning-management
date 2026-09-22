import { Download, GraduationCap, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { downloadText } from '../../lib/download';
import { dueLabel, shortDate, toDayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { EmptyState, Tip } from '../primitives/bits';
import { CourseGlyph, StatusGlyph } from '../primitives/icons';
import { toCsv, useGroup, type Compliance, type ComplianceCell } from '../people/peopleData';

function cellText(cell: ComplianceCell): { text: string; tone: string } {
  if (cell.certState === 'expired' && cell.status === 'Completed') return { text: `Expired ${shortDate(cell.certExpiresAt)}`, tone: 'text-tone-danger' };
  if (cell.dueState === 'overdue') return { text: `Overdue · ${dueLabel(cell.dueDate)?.label ?? ''}`, tone: 'text-tone-danger' };
  if (cell.status === 'Completed') {
    if (cell.certState === 'expiring') return { text: `Expires ${shortDate(cell.certExpiresAt)}`, tone: 'text-tone-warning' };
    return { text: cell.completedAt ? `Done ${shortDate(cell.completedAt)}` : 'Certified', tone: 'text-muted-foreground' };
  }
  if (cell.status === 'Withdrawn') return { text: 'Withdrawn', tone: 'text-muted-foreground' };
  if (cell.certState === 'active' || cell.certState === 'expiring') return { text: cell.status === 'Not started' ? `Renewal due ${dueLabel(cell.dueDate)?.label ?? ''}`.trim() : `Renewing · ${cell.progress}%`, tone: cell.certState === 'expiring' ? 'text-tone-warning' : 'text-foreground/80' };
  if (cell.dueState === 'due_soon') return { text: `Due ${dueLabel(cell.dueDate)?.label ?? ''}`, tone: 'text-tone-warning' };
  if (cell.status === 'In progress') return { text: `${cell.progress}%${cell.dueDate ? ` · due ${shortDate(cell.dueDate)}` : ''}`, tone: 'text-foreground/80' };
  return { text: cell.dueDate ? `Not started · ${shortDate(cell.dueDate)}` : 'Not started', tone: 'text-muted-foreground' };
}

/**
 * Everyone in the group against everything they're required to do. Columns
 * come from active assignment rules for this group or for everyone; a cell is
 * the latest enrollment (and certificate) for that person and item.
 */
export function ComplianceMatrix({ groupId, groupName }: { groupId: string; groupName: string }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useGroup(groupId, { compliance: true, limit: 1 });
  const [onlyGaps, setOnlyGaps] = useState(false);
  const matrix = data?.compliance;

  const columns = useMemo(
    () =>
      (matrix?.columns ?? []).map(col => {
        const item = col.type === 'Course' ? ws.courseById.get(col.targetId) : ws.pathById.get(col.targetId);
        return { ...col, title: item?.title ?? (col.type === 'Course' ? 'Unknown course' : 'Unknown path'), icon: item?.icon, color: item?.color, published: item?.status === 'Published' };
      }),
    [matrix, ws],
  );
  const rows = useMemo(() => (matrix?.rows ?? []).filter(r => !onlyGaps || r.compliant < columns.length), [matrix, onlyGaps, columns.length]);

  const exportCsv = (m: Compliance) => {
    const csv = toCsv(
      ['Person', 'Email', 'Job title', 'Complete', ...columns.map(c => c.title)],
      m.rows.map(r => [r.name, r.email, r.title ?? '', `${r.compliant}/${columns.length}`, ...columns.map(c => (r.cells[c.key] ? cellText(r.cells[c.key]!).text : 'Not enrolled'))]),
    );
    downloadText(`${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-compliance-${toDayString(new Date())}.csv`, csv);
    toast.success('Exported the compliance matrix');
  };

  if (isPending) return <div className="p-4"><div className="skeleton h-72 w-full rounded-lg" /></div>;
  if (isError || !matrix) return <EmptyState icon={<ShieldCheck />} title="Couldn't load compliance" description="Check your connection and try again." action={<button type="button" onClick={() => refetch()} className="text-[14px] text-primary hover:underline">Try again</button>} />;
  if (!columns.length) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Nothing is required of this group yet"
        description="Columns come from active assignment rules for this group or for everyone. Create a rule to require a course or path, and new members get it automatically."
        action={<Link to="/assignments" className="h-9 rounded-md border bg-background px-3 py-1.5 text-[14px] shadow-2xs hover:bg-accent">Go to assignment rules</Link>}
      />
    );
  }
  if (!matrix.rows.length) return <EmptyState icon={<ShieldCheck />} title="No active members" description="Add people to this group to track their required training here." />;

  const fullyCompliant = matrix.rows.filter(r => r.compliant === columns.length).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-4 py-1.5 text-[14px]">
        <span>
          <span className="font-medium tabular-nums">{fullyCompliant}</span>
          <span className="text-muted-foreground"> of {matrix.rows.length} members complete on all {columns.length} required item{columns.length === 1 ? '' : 's'}</span>
        </span>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={onlyGaps} onCheckedChange={setOnlyGaps} className="scale-90" /> Only people with gaps
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-3 text-2xs text-muted-foreground lg:flex">
            <span className="flex items-center gap-1"><StatusGlyph status="Completed" size={11} /> Complete</span>
            <span className="flex items-center gap-1"><StatusGlyph status="In progress" progress={50} size={11} /> In progress</span>
            <span className="flex items-center gap-1"><StatusGlyph status="In progress" progress={50} dueState="overdue" size={11} /> Overdue</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-muted-foreground/50" /> Not enrolled</span>
          </span>
          <button type="button" onClick={() => exportCsv(matrix)} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-[14px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-[220px] border-b border-r bg-subtle px-3 py-2 text-left align-bottom text-sm font-medium text-muted-foreground sm:min-w-[260px]">
                {rows.length} {rows.length === 1 ? 'person' : 'people'}
              </th>
              {columns.map(col => {
                const missing = matrix.rows.filter(r => !r.cells[col.key] || r.cells[col.key]!.status === 'Withdrawn').map(r => r.personId);
                return (
                  <th key={col.key} className="sticky top-0 z-20 w-[164px] min-w-[164px] max-w-[164px] border-b border-r bg-subtle p-0 text-left align-bottom font-normal">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="block w-full px-3 py-2 text-left hover:bg-accent/60">
                          <span className="flex items-start gap-1.5">
                            <CourseGlyph icon={col.icon} color={col.color} size={16} className="mt-px" />
                            <span className="line-clamp-2 text-sm font-medium leading-4 text-foreground">{col.title}</span>
                          </span>
                          <span className="mt-1.5 flex items-center gap-1.5">
                            <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                              <span className="block h-full rounded-full bg-primary" style={{ width: `${col.percent}%` }} />
                            </span>
                            <span className="text-2xs tabular-nums text-muted-foreground">{col.percent}%</span>
                          </span>
                          {col.overdue > 0 && <span className="mt-0.5 block text-2xs text-tone-danger">{col.overdue} overdue</span>}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-64">
                        <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">Required by {col.ruleNames.join(', ')}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="gap-2 text-[14px]"
                          disabled={!missing.length || !col.published}
                          onSelect={() => app.openEnroll({ targetType: col.type, targetId: col.targetId, personIds: missing })}
                        >
                          <GraduationCap className="h-3.5 w-3.5" /> {missing.length ? `Enroll ${missing.length} not enrolled…` : 'Everyone is enrolled'}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2 text-[14px]" onSelect={() => navigate(col.type === 'Course' ? `/courses/${col.targetId}/learners` : `/paths/${col.targetId}/learners`)}>
                          <CourseGlyph icon={col.icon} color={col.color} size={14} /> Open {col.type === 'Course' ? 'course' : 'learning path'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </th>
                );
              })}
              <th className="sticky top-0 z-20 w-full border-b bg-subtle" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.personId} className="group/mrow">
                <td className="sticky left-0 z-10 border-b border-r bg-background px-3 py-1.5 group-hover/mrow:bg-accent">
                  <Link to={`/people/${r.personId}`} className="flex min-w-0 items-center gap-2">
                    <PersonAvatar person={r} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate leading-4 hover:underline">{r.name}</span>
                      <span className="block truncate text-2xs leading-4 text-muted-foreground">{r.title ?? r.email}</span>
                    </span>
                    <span className={cn('shrink-0 text-2xs tabular-nums', r.compliant === columns.length ? 'text-muted-foreground' : 'text-foreground')}>
                      {r.compliant}/{columns.length}
                    </span>
                  </Link>
                </td>
                {columns.map(col => {
                  const cell = r.cells[col.key];
                  if (!cell) {
                    return (
                      <td key={col.key} className="h-11 max-w-[164px] border-b border-r bg-background px-2 group-hover/mrow:bg-accent/40">
                        <span className="group/cell flex items-center gap-1.5 px-1 text-sm text-muted-foreground/70">
                          <span className="h-3 w-3 shrink-0 rounded-full border border-dashed border-muted-foreground/50" />
                          <span className="group-hover/cell:hidden">Not enrolled</span>
                          {col.published && (
                            <button type="button" onClick={() => app.openEnroll({ targetType: col.type, targetId: col.targetId, personIds: [r.personId] })} className="hidden rounded px-1 text-sm font-medium text-primary hover:bg-primary/10 group-hover/cell:inline">
                              Enroll…
                            </button>
                          )}
                        </span>
                      </td>
                    );
                  }
                  const { text, tone } = cellText(cell);
                  const label = `${r.name} · ${col.title}: ${text}${cell.cycle > 1 ? ` (cycle ${cell.cycle})` : ''}`;
                  return (
                    <td key={col.key} className="h-11 max-w-[164px] border-b border-r bg-background p-0 group-hover/mrow:bg-accent/40">
                      <Tip label={label}>
                        <button
                          type="button"
                          onClick={() => (col.type === 'Course' && cell.id ? app.openEnrollment(cell.id) : navigate(`/people/${r.personId}`))}
                          className={cn('flex h-full w-full items-center gap-1.5 px-3 text-left hover:bg-accent', !cell.compliant && cell.dueState === 'overdue' && 'bg-tone-danger/[0.04]')}
                        >
                          <StatusGlyph status={cell.status} progress={cell.progress} dueState={cell.dueState} size={14} className={cell.certState === 'expired' && cell.status === 'Completed' ? 'text-tone-danger' : undefined} />
                          <span className={cn('truncate text-sm tabular-nums', tone)}>{text}</span>
                        </button>
                      </Tip>
                    </td>
                  );
                })}
                <td className="border-b bg-background group-hover/mrow:bg-accent/40" aria-hidden />
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="px-4 py-8 text-center text-[14px] text-muted-foreground">Everyone in {groupName} is complete on every required item.</p>}
        {matrix.truncated && <p className="px-4 py-3 text-sm text-muted-foreground">Showing the first 500 members. Export to CSV or filter Progress to see everyone.</p>}
      </div>
    </div>
  );
}
