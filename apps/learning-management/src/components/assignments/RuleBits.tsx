import { Archive, CirclePause, CirclePlay, Pencil, Play, Trash2, Undo2, UserRound, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { ContextMenuItem, ContextMenuSeparator } from '@project/components/ui/context-menu';
import { DropdownMenuItem, DropdownMenuSeparator } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { LabelDot, Tip } from '../primitives/bits';
import { useRuleActions, type RuleRow } from './data';

/** Everyone / group chips / "N people", compact enough for a list row. */
export function AudienceChips({ rule, max = 2, className }: { rule: RuleRow; max?: number; className?: string }) {
  const ws = useWorkspace();
  if (rule.audience === 'Everyone') {
    return (
      <span className={cn('chip bg-background', className)}>
        <Users className="h-3 w-3 text-muted-foreground" aria-hidden />
        Everyone
      </span>
    );
  }
  if (rule.audience === 'People') {
    return (
      <span className={cn('chip bg-background tabular-nums', className)}>
        <UserRound className="h-3 w-3 text-muted-foreground" aria-hidden />
        {rule.personIds.length} {rule.personIds.length === 1 ? 'person' : 'people'}
      </span>
    );
  }
  const groups = rule.groupIds.map(id => ws.groupById.get(id)).filter(Boolean) as Array<NonNullable<ReturnType<typeof ws.groupById.get>>>;
  const shown = groups.slice(0, max);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      {shown.map(g => (
        <span key={g.id} className="chip min-w-0 max-w-[150px] bg-background" title={`${g.name} · ${g.memberCount} people`}>
          <LabelDot color={g.color} />
          <span className="truncate">{g.name}</span>
        </span>
      ))}
      {groups.length > shown.length && (
        <Tip label={groups.slice(max).map(g => g.name).join(', ')}>
          <span className="chip bg-background">+{groups.length - shown.length}</span>
        </Tip>
      )}
      {!groups.length && <span className="chip bg-background text-muted-foreground">No groups</span>}
    </span>
  );
}

export const RULE_STATUS_META: Record<RuleRow['status'], { label: string; cls: string; dot: string }> = {
  Active: { label: 'Active', cls: 'text-tone-success', dot: 'bg-tone-success' },
  Paused: { label: 'Paused', cls: 'text-tone-warning', dot: 'bg-tone-warning' },
  Archived: { label: 'Archived', cls: 'text-muted-foreground', dot: 'bg-muted-foreground/50' },
};

export function RuleStatusPill({ status, className }: { status: RuleRow['status']; className?: string }) {
  const meta = RULE_STATUS_META[status];
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md bg-muted px-1.5 text-2xs font-medium', meta.cls, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

export function CreatedBy({ rule }: { rule: RuleRow }) {
  const ws = useWorkspace();
  const staff = rule.createdById ? ws.staffById.get(rule.createdById) : undefined;
  if (!rule.createdByName) return <span className="text-muted-foreground">Unknown</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <PersonAvatar person={staff ?? { name: rule.createdByName }} size={16} />
      {rule.createdByName}
    </span>
  );
}

type MenuKind = 'dropdown' | 'context';

export const RESTORED = { success: 'Rule restored', description: 'It’s paused, so it enrolls nobody until you resume it.' };

/**
 * The actions on a rule, for both its row's context menu and "…" menus:
 * run now, pause or resume, edit, archive (or restore), delete.
 */
export function RuleMenuItems({ rule, kind, onEdit, onDeleted }: { rule: RuleRow; kind: MenuKind; onEdit: (r: RuleRow) => void; onDeleted?: () => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { save, run } = useRuleActions();
  const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem;
  const Sep = kind === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator;
  if (!ws.isAdmin) return null;
  const unpublished = rule.targetStatus !== 'Published';
  const item = (icon: ReactNode, label: string, onSelect: () => void, opts: { destructive?: boolean; disabled?: boolean } = {}) => (
    <Item className={cn('gap-2 text-[14px]', opts.destructive && 'text-destructive focus:text-destructive')} disabled={opts.disabled} onSelect={onSelect}>
      {icon}
      {label}
    </Item>
  );

  return (
    <>
      {rule.status === 'Active' && item(<Play className="h-3.5 w-3.5" />, unpublished ? 'Run now (publish first)' : 'Run now', () => run(rule), { disabled: unpublished })}
      {rule.status === 'Active' && item(<CirclePause className="h-3.5 w-3.5" />, 'Pause', () => save({ action: 'pause', id: rule.id }, 'Pausing…').catch(() => undefined))}
      {rule.status === 'Paused' && item(<CirclePlay className="h-3.5 w-3.5" />, unpublished ? 'Resume (publish first)' : 'Resume and run', () => save({ action: 'resume', id: rule.id }, 'Resuming and enrolling people…').catch(() => undefined), { disabled: unpublished })}
      {rule.status === 'Archived' && item(<Undo2 className="h-3.5 w-3.5" />, 'Restore as paused', () => save({ action: 'pause', id: rule.id }, 'Restoring…', RESTORED).catch(() => undefined))}
      {item(<Pencil className="h-3.5 w-3.5" />, 'Edit…', () => onEdit(rule))}
      <Sep />
      {rule.status !== 'Archived' &&
        item(<Archive className="h-3.5 w-3.5" />, 'Archive', async () => {
          if (await app.confirm({ title: `Archive “${rule.name}”?`, description: 'It stops running, including for people who join later and for recertification. People keep the training it already assigned. You can restore it from Archived.', confirmLabel: 'Archive rule' })) save({ action: 'archive', id: rule.id }, 'Archiving…').catch(() => undefined);
        })}
      {item(
        <Trash2 className="h-3.5 w-3.5" />,
        'Delete…',
        async () => {
          if (
            await app.confirm({
              title: `Delete “${rule.name}”?`,
              description: rule.counts.enrolled
                ? `The rule is removed for good. ${rule.counts.enrolled === 1 ? 'The enrollment it created stays' : `The ${rule.counts.enrolled.toLocaleString()} enrollments it created stay`}, with progress and history. To keep a record of the rule, archive it instead.`
                : 'The rule is removed for good. It hasn’t enrolled anyone. To keep a record of it, archive it instead.',
              confirmLabel: 'Delete rule',
              destructive: true,
            })
          ) {
            await save({ action: 'delete', id: rule.id }, 'Deleting…')
              .then(() => onDeleted?.())
              .catch(() => undefined);
          }
        },
        { destructive: true },
      )}
    </>
  );
}
