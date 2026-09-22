import { Lock, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { saveGroup, type SaveGroupInputType } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { qk } from '../../lib/queries';
import { inputCls } from '../people/PeopleBits';
import { refreshPeople, type GroupDetail } from '../people/peopleData';
import { ColorSwatches, KIND_HINT, KindChoice, OwnerField } from './GroupDialog';

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-1.5 px-4 py-3 sm:grid-cols-[140px_minmax(0,1fr)]">
      <div className="pt-1.5 text-[14px] text-muted-foreground">{label}</div>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** Name, kind, colour, owner and description — each saves as you change it — and deleting the group. */
export function GroupSettings({ detail }: { detail: GroupDetail }) {
  const qc = useQueryClient();
  const app = useAppActions();
  const navigate = useNavigate();
  const g = detail.group;
  const canEdit = detail.canEdit;
  const [name, setName] = useState(g.name);
  const [description, setDescription] = useState(g.description);
  useEffect(() => setName(g.name), [g.name]);
  useEffect(() => setDescription(g.description), [g.description]);

  const save = async (patch: Omit<Extract<SaveGroupInputType, { action: 'update' }>, 'action' | 'id'>, message?: string) => {
    try {
      await saveGroup({ action: 'update', id: g.id, ...patch });
      if (message) toast.success(message);
      refreshPeople(qc);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save the group"));
      if (patch.name !== undefined) setName(g.name);
    }
  };

  const ownRules = detail.rules.filter(r => r.audience === 'Groups');
  const pausing = ownRules.filter(r => r.onlyThisGroup && r.status === 'Active');

  const remove = async () => {
    const ok = await app.confirm({
      title: `Delete ${g.name}?`,
      description: [
        `${detail.memberCount + detail.deactivatedCount} membership${detail.memberCount + detail.deactivatedCount === 1 ? '' : 's'} will be removed. People keep their accounts and all their training.`,
        ownRules.length ? `${ownRules.length} assignment rule${ownRules.length === 1 ? ' targets' : 's target'} this group: the group is taken out of ${ownRules.length === 1 ? 'it' : 'them'}${pausing.length ? `, and ${pausing.length === 1 ? `“${pausing[0].name}”` : `${pausing.length} rules`} that only targeted this group will be paused` : ''}.` : '',
        'This can’t be undone.',
      ].filter(Boolean).join(' '),
      confirmLabel: 'Delete group',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await saveGroup({ action: 'delete', id: g.id });
      toast.success(`Deleted ${g.name}`, { description: res.rulesUpdated ? `Updated ${res.rulesUpdated} assignment rule${res.rulesUpdated === 1 ? '' : 's'}${res.rulesPaused ? ` · paused ${res.rulesPaused}` : ''}.` : undefined });
      navigate('/groups', { replace: true });
      refreshPeople(qc);
      qc.invalidateQueries({ queryKey: qk.rulesRoot });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't delete the group"));
    }
  };

  return (
    <div className="w-full max-w-[760px] space-y-8 px-4 py-5 sm:px-6">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-medium">Group details</h2>
          {!canEdit && (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Lock className="h-3 w-3" /> Only admins can edit groups
            </span>
          )}
        </div>
        <div className="divide-y rounded-xl border bg-card">
          <Row label="Name">
            <input
              value={name}
              disabled={!canEdit}
              maxLength={80}
              onChange={e => setName(e.target.value)}
              onBlur={() => name.trim() && name.trim() !== g.name ? void save({ name: name.trim() }, `Renamed to ${name.trim()}`) : setName(g.name)}
              onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
              className={inputCls}
            />
          </Row>
          <Row label="Kind" hint={KIND_HINT[g.kind]}>
            <KindChoice value={g.kind} disabled={!canEdit} onChange={k => void save({ kind: k as never })} />
          </Row>
          <Row label="Colour">
            <ColorSwatches value={g.color} disabled={!canEdit} onChange={c => void save({ color: c })} />
          </Row>
          <Row label="Owner" hint="The owner can add and remove members, even without admin access.">
            <div className="max-w-[360px]">
              <OwnerField value={g.ownerId} disabled={!canEdit} onChange={id => void save({ ownerId: id }, id ? 'Owner updated' : 'Owner removed')} />
            </div>
          </Row>
          <Row label="Description">
            <textarea
              value={description}
              disabled={!canEdit}
              maxLength={1000}
              rows={3}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => description.trim() !== g.description && void save({ description: description.trim() })}
              placeholder="Who belongs in this group?"
              className={cn(inputCls, 'h-auto resize-y py-1.5 leading-5')}
            />
          </Row>
        </div>
      </section>

      {canEdit && (
        <section>
          <h2 className="mb-2 text-[14px] font-medium text-destructive">Delete group</h2>
          <div className="rounded-xl border border-destructive/25 bg-card px-4 py-4">
            <p className="text-[14px] text-muted-foreground">Removes the group and its memberships. People keep their accounts, enrollments and certificates.</p>
            {ownRules.length > 0 && (
              <div className="mt-3 rounded-lg border bg-tone-warning/[0.06] px-3 py-2.5 text-[14px]">
                <div className="font-medium text-tone-warning">
                  {ownRules.length} assignment rule{ownRules.length === 1 ? '' : 's'} target{ownRules.length === 1 ? 's' : ''} this group
                </div>
                <ul className="mt-1.5 space-y-1">
                  {ownRules.map(r => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                      <Link to={`/assignments/${r.id}`} className="font-medium text-foreground hover:underline">
                        {r.name}
                      </Link>
                      <span className="text-muted-foreground">{r.onlyThisGroup ? (r.status === 'Active' ? 'only targets this group — it will be paused' : 'only targets this group') : 'keeps working for its other groups'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button type="button" onClick={() => void remove()} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/30 bg-background px-3 text-[14px] text-destructive shadow-2xs hover:bg-destructive/[0.06]">
              <Trash2 className="h-3.5 w-3.5" /> Delete group…
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
