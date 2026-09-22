import { Check, ChevronDown, UsersRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { saveGroup } from 'zitejs/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { cn } from '@project/components/lib/utils';
import { COURSE_COLORS, GROUP_KINDS } from '../../lib/constants';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import { usePeopleSearch } from '../../lib/queries';
import { PersonPicker } from '../pickers/pickers';
import { PersonAvatar } from '../primitives/Avatar';
import { Kbd } from '../primitives/bits';
import { inputCls } from '../people/PeopleBits';
import { refreshPeople } from '../people/peopleData';

export const KIND_HINT: Record<string, string> = {
  Department: 'A part of the organization, like Sales or Operations',
  Team: 'People who work together',
  Location: 'A store, office or site',
  Cohort: 'People who start or train together',
  Customer: 'An external customer organization',
  Partner: 'A reseller, vendor or partner',
};

export function ColorSwatches({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
      {COURSE_COLORS.map(c => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} aria-label={c} disabled={disabled} onClick={() => onChange(c)} className="flex h-6 w-6 items-center justify-center rounded-full transition-transform enabled:hover:scale-110 disabled:opacity-60" style={{ background: c }}>
          {value.toLowerCase() === c && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

export function KindChoice({ value, onChange, disabled }: { value: string; onChange: (k: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind">
      {GROUP_KINDS.map(k => (
        <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} title={KIND_HINT[k]} onClick={() => onChange(k)} className={cn('h-8 rounded-md border px-2.5 text-[13.5px] transition-colors disabled:cursor-not-allowed', value === k ? 'border-primary/50 bg-primary/[0.06] font-medium text-foreground' : 'text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground')}>
          {k}
        </button>
      ))}
    </div>
  );
}

export function OwnerField({ value, onChange, disabled }: { value: string | null; onChange: (id: string | null) => void; disabled?: boolean }) {
  const { data } = usePeopleSearch('', { ids: value ? [value] : [], enabled: Boolean(value) });
  const owner = data?.people.find(p => p.id === value);
  return (
    <div className="flex items-center gap-1.5">
      <PersonPicker
        value={value ? [value] : []}
        onChange={ids => onChange(ids[ids.length - 1] ?? null)}
        placeholder="Who looks after this group?"
        trigger={
          <button type="button" disabled={disabled} className={cn(inputCls, 'flex items-center gap-2 text-left')}>
            {owner && <PersonAvatar person={owner} size={18} />}
            <span className={cn('flex-1 truncate', !owner && 'text-muted-foreground')}>{owner?.name ?? (value ? '…' : 'No owner')}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        }
      />
      {value && !disabled && (
        <button type="button" onClick={() => onChange(null)} aria-label="Remove owner" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Create a group. Members come after — from the group page, People, or an import. */
export function GroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('Team');
  const [color, setColor] = useState(COURSE_COLORS[0]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setKind('Team');
    setColor(COURSE_COLORS[Math.floor(Math.random() * COURSE_COLORS.length)]);
    setOwnerId(null);
    setDescription('');
    setBusy(false);
  }, [open]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await saveGroup({ action: 'create', name: name.trim(), kind: kind as (typeof GROUP_KINDS)[number], color, ownerId, description: description.trim() });
      refreshPeople(qc);
      await qc.invalidateQueries({ queryKey: ['bootstrap'] });
      toast.success(`Created ${name.trim()}`, { description: 'Add members, then assign training to the whole group.' });
      onOpenChange(false);
      navigate(`/groups/${res.id}`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't create the group"));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent
        className="max-w-[520px] gap-0 p-0 sm:rounded-xl"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader className="border-b px-5 pb-3.5 pt-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <UsersRound className="h-4 w-4 text-muted-foreground" /> New group
          </DialogTitle>
          <DialogDescription className="text-[14px]">Group people the way your organization works, then assign training to everyone in it at once.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 px-5 py-4"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm text-muted-foreground">Name</span>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
              <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="e.g. Evanston Store" className={inputCls} />
            </div>
          </label>
          <div>
            <span className="mb-1 block text-sm text-muted-foreground">Kind</span>
            <KindChoice value={kind} onChange={setKind} />
            <p className="mt-1 text-sm text-muted-foreground">{KIND_HINT[kind]}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-sm text-muted-foreground">Colour</span>
              <ColorSwatches value={color} onChange={setColor} />
            </div>
            <div>
              <span className="mb-1 block text-sm text-muted-foreground">Owner</span>
              <OwnerField value={ownerId} onChange={setOwnerId} />
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm text-muted-foreground">Description</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={2} placeholder="Who belongs here?" className={cn(inputCls, 'h-auto resize-none py-1.5')} />
          </label>
          <button type="submit" className="hidden" />
        </form>
        <div className="flex items-center justify-between gap-2 border-t bg-subtle/60 px-5 py-3">
          <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Kbd>{MOD}</Kbd>
            <Kbd>↵</Kbd> to create
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
              Cancel
            </button>
            <button type="button" disabled={!name.trim() || busy} onClick={() => void submit()} className="h-9 rounded-md bg-primary px-3.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
              {busy ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
