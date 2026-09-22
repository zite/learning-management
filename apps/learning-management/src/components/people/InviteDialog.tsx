import { ChevronDown, ClipboardPaste, Plus, UserPlus, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { MOD } from '../../lib/hotkeys';
import { usePeopleSearch } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { GroupPicker, PersonPicker } from '../pickers/pickers';
import { PersonAvatar } from '../primitives/Avatar';
import { Kbd, LabelDot } from '../primitives/bits';
import { inputCls } from './PeopleBits';
import { peopleCount, ROLE_INFO, usePeopleWrites, type Role } from './peopleData';

/**
 * Add one person or a whole team at once: rows of email + name (the name
 * fills itself in from the address), shared defaults for role, groups, manager
 * and title, and an optional invitation email. Pasting a list of addresses —
 * from a spreadsheet, an email thread, "Name <email>" — expands into rows.
 */

type Draft = { key: number; email: string; name: string; nameTouched: boolean; blurred?: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_FIND = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]{2,}/g;

export function nameFromEmail(email: string) {
  const local = email.split('@')[0] ?? '';
  return local.replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim().replace(/\b\w/g, c => c.toUpperCase());
}

/** "Jane Doe <jane@x.com>, bob@y.com; Carla\tcarla@z.com" → [{email, name}] */
export function parseAddressList(text: string) {
  const out: Array<{ email: string; name: string }> = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n|;|,(?![^<]*>)/)) {
    const emails = line.match(EMAIL_FIND) ?? [];
    for (const raw of emails) {
      const email = raw.toLowerCase().replace(/[.]+$/, '');
      if (seen.has(email)) continue;
      seen.add(email);
      const rest = emails.length === 1 ? line.replace(raw, '').replace(/[<>"'\t]/g, ' ').replace(/\s+/g, ' ').trim() : '';
      out.push({ email, name: rest && !/@/.test(rest) && rest.length <= 80 ? rest : '' });
    }
  }
  return out;
}

let keySeq = 1;
const blank = (): Draft => ({ key: keySeq++, email: '', name: '', nameTouched: false });

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void; courseId?: string }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const writes = usePeopleWrites();
  const [rows, setRows] = useState<Draft[]>([blank()]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [role, setRole] = useState<Role>('Learner');
  const [title, setTitle] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [sendInvite, setSendInvite] = useState(true);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setRows([blank()]);
    setPasteOpen(false);
    setPasteText('');
    setRole('Learner');
    setTitle('');
    setGroupIds([]);
    setManagerId(null);
    setSendInvite(true);
    setTouched(false);
    setBusy(false);
  }, [open]);

  const { data: managerData } = usePeopleSearch('', { ids: managerId ? [managerId] : [], enabled: Boolean(managerId) });
  const manager = managerData?.people.find(p => p.id === managerId);

  const filled = rows.filter(r => r.email.trim());
  const emailCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filled) m.set(r.email.trim().toLowerCase(), (m.get(r.email.trim().toLowerCase()) ?? 0) + 1);
    return m;
  }, [filled]);
  const errorFor = (r: Draft) => {
    const e = r.email.trim().toLowerCase();
    if (!e) return null;
    if (!EMAIL_RE.test(e)) return 'Check this address';
    if ((emailCounts.get(e) ?? 0) > 1 && rows.find(x => x.email.trim().toLowerCase() === e)?.key !== r.key) return 'Listed twice';
    return null;
  };
  const invalid = filled.filter(r => errorFor(r));
  const unique = [...new Map(filled.filter(r => !errorFor(r)).map(r => [r.email.trim().toLowerCase(), r])).values()];
  const canSubmit = ws.isAdmin && unique.length > 0 && invalid.length === 0 && !busy;

  const setRow = (key: number, patch: Partial<Draft>) =>
    setRows(prev =>
      prev.map(r => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        if (patch.email !== undefined && !next.nameTouched) next.name = EMAIL_RE.test(patch.email.trim()) ? nameFromEmail(patch.email.trim()) : '';
        return next;
      }),
    );

  const addParsed = (list: Array<{ email: string; name: string }>, replaceKey?: number) => {
    if (!list.length) return 0;
    setRows(prev => {
      const existing = new Set(prev.map(r => r.email.trim().toLowerCase()).filter(Boolean));
      const fresh = list.filter(p => !existing.has(p.email)).map(p => ({ key: keySeq++, email: p.email, name: p.name || nameFromEmail(p.email), nameTouched: Boolean(p.name) }));
      const kept = prev.filter(r => r.email.trim() || r.name.trim()).filter(r => r.key !== replaceKey);
      return [...kept, ...fresh, blank()];
    });
    window.setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 30);
    return list.length;
  };

  const submit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    setBusy(true);
    const people = unique.map(r => ({ email: r.email.trim(), name: r.name.trim() }));
    const res = await writes.save(
      people.length === 1
        ? { action: 'create', email: people[0].email, name: people[0].name, role, title, groupIds, managerId, sendInvite }
        : { action: 'createMany', people, role, title, groupIds, managerId, sendInvite },
      { error: people.length === 1 ? "Couldn't add that person" : "Couldn't add those people" },
    );
    setBusy(false);
    if (!res) return;
    onOpenChange(false);
    const created = res.created.length;
    const details = [
      sendInvite && res.invited ? `Invitation${res.invited === 1 ? '' : 's'} sent to ${res.invited === created ? (created === 1 ? res.created[0].email : 'everyone') : peopleCount(res.invited)}` : !sendInvite ? 'No invitation sent — they can sign in any time' : null,
      res.existing.length ? `${peopleCount(res.existing.length)} already in this workspace: ${res.existing.slice(0, 3).map(p => p.name).join(', ')}${res.existing.length > 3 ? '…' : ''}` : null,
      res.enrolled ? `Assignment rules added ${res.enrolled} enrollment${res.enrolled === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    if (!created) {
      toast.info('Everyone is already in this workspace', { description: details.join(' · ') || undefined, action: res.existing.length === 1 ? { label: 'View', onClick: () => navigate(`/people/${res.existing[0].id}`) } : undefined });
      return;
    }
    toast.success(created === 1 ? `Added ${res.created[0].name}` : `Added ${peopleCount(created)}`, {
      description: details.join(' · ') || undefined,
      duration: 7000,
      action: { label: 'View', onClick: () => navigate(created === 1 ? `/people/${res.created[0].id}` : sendInvite ? '/people?tab=invited' : '/people') },
    });
  };

  const chipBtn = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-2 text-[13.5px] text-muted-foreground hover:border-foreground/30 hover:text-foreground';

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent
        className="flex max-h-[92dvh] max-w-[640px] flex-col gap-0 p-0 sm:rounded-xl"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 pb-3.5 pt-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <UserPlus className="h-4 w-4 text-muted-foreground" /> Add people
          </DialogTitle>
          <DialogDescription className="text-[14px]">
            {ws.isAdmin ? `Add teammates to ${ws.settings.academyName}. Anyone already here is skipped, and assignment rules enroll newcomers in required training.` : 'Only admins can add people. Ask an admin to invite them, or enroll people who are already here.'}
          </DialogDescription>
        </DialogHeader>

        {ws.isAdmin && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  People{unique.length > 0 && <span className="ml-1.5 tabular-nums text-foreground">{unique.length}</span>}
                </span>
                <button type="button" onClick={() => setPasteOpen(o => !o)} className={cn('inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground', pasteOpen && 'bg-accent text-foreground')}>
                  <ClipboardPaste className="h-3.5 w-3.5" /> Paste a list
                </button>
              </div>

              {pasteOpen && (
                <div className="mb-3 rounded-lg border bg-subtle/60 p-2.5 animate-fade-in">
                  <textarea
                    autoFocus
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    rows={4}
                    placeholder={'Paste addresses separated by commas or new lines.\nJane Doe <jane@company.com>, sam@company.com'}
                    className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-[14px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/20"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">{pasteText.trim() ? `${parseAddressList(pasteText).length} address${parseAddressList(pasteText).length === 1 ? '' : 'es'} found` : 'Names are filled in from each address when there isn’t one.'}</span>
                    <button
                      type="button"
                      disabled={!parseAddressList(pasteText).length}
                      onClick={() => {
                        const n = addParsed(parseAddressList(pasteText));
                        if (n) {
                          setPasteText('');
                          setPasteOpen(false);
                        }
                      }}
                      className="h-8 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      Add to list
                    </button>
                  </div>
                </div>
              )}

              <div ref={listRef} className="max-h-[260px] space-y-1.5 overflow-y-auto pr-0.5">
                {rows.map((r, i) => {
                  const error = errorFor(r);
                  const showError = error && (touched || r.blurred);
                  return (
                    <div key={r.key}>
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus={i === 0 && rows.length === 1}
                          type="email"
                          value={r.email}
                          aria-label={`Email ${i + 1}`}
                          aria-invalid={Boolean(showError)}
                          placeholder="name@company.com"
                          onChange={e => setRow(r.key, { email: e.target.value })}
                          onBlur={() => r.email.trim() && setRow(r.key, { blurred: true })}
                          onPaste={e => {
                            const text = e.clipboardData.getData('text');
                            const found = parseAddressList(text);
                            if (found.length > 1) {
                              e.preventDefault();
                              addParsed(found, r.email.trim() ? undefined : r.key);
                              toast.success(`Added ${found.length} addresses from the clipboard`);
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                              e.preventDefault();
                              if (i === rows.length - 1 && r.email.trim()) setRows(prev => [...prev, blank()]);
                              window.setTimeout(() => (listRef.current?.querySelectorAll('input[type="email"]')[i + 1] as HTMLInputElement | undefined)?.focus(), 20);
                            }
                          }}
                          className={cn(inputCls, 'min-w-0 flex-[1.3]', showError && 'border-tone-danger/60 focus:border-tone-danger/60 focus:ring-tone-danger/20')}
                        />
                        <input
                          value={r.name}
                          aria-label={`Name ${i + 1}`}
                          placeholder="Full name"
                          onChange={e => setRow(r.key, { name: e.target.value, nameTouched: true })}
                          className={cn(inputCls, 'min-w-0 flex-1')}
                        />
                        <button
                          type="button"
                          aria-label="Remove row"
                          disabled={rows.length === 1 && !r.email && !r.name}
                          onClick={() => setRows(prev => (prev.length === 1 ? [blank()] : prev.filter(x => x.key !== r.key)))}
                          className="flex h-9 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {showError && <p className="mt-0.5 pl-1 text-2xs text-tone-danger">{error}</p>}
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={() => { setRows(prev => [...prev, blank()]); window.setTimeout(() => (listRef.current?.querySelectorAll('input[type="email"]')[rows.length] as HTMLInputElement | undefined)?.focus(), 20); }} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
                <Plus className="h-3.5 w-3.5" /> Add another
              </button>
            </section>

            <section className="space-y-3">
              <div className="text-sm font-medium text-muted-foreground">For everyone above</div>
              <div>
                <div className="flex rounded-lg border p-0.5" role="radiogroup" aria-label="Role">
                  {(['Learner', 'Instructor', 'Admin'] as const).map(r => (
                    <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r)} className={cn('flex h-8 flex-1 items-center justify-center rounded-md text-[13.5px] transition-colors', role === r ? 'bg-accent font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}>
                      {r}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{ROLE_INFO[role].description}.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm text-muted-foreground">Job title</span>
                  <input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} placeholder="e.g. Sales Associate" className={inputCls} />
                </label>
                <div>
                  <span className="mb-1 block text-sm text-muted-foreground">Manager</span>
                  <PersonPicker
                    value={managerId ? [managerId] : []}
                    onChange={ids => setManagerId(ids[ids.length - 1] ?? null)}
                    placeholder="Who do they report to?"
                    trigger={
                      <button type="button" className={cn(inputCls, 'flex items-center gap-2 text-left')}>
                        {manager ? <PersonAvatar person={manager} size={18} /> : null}
                        <span className={cn('flex-1 truncate', !manager && 'text-muted-foreground')}>{manager?.name ?? 'No manager'}</span>
                        {managerId ? (
                          <span role="button" tabIndex={-1} aria-label="Clear manager" onClick={e => { e.stopPropagation(); setManagerId(null); }} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                            <X className="h-3 w-3" />
                          </span>
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </button>
                    }
                  />
                </div>
              </div>
              <div>
                <span className="mb-1 block text-sm text-muted-foreground">Groups</span>
                <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1.5">
                  {groupIds.map(id => {
                    const g = ws.groupById.get(id);
                    if (!g) return null;
                    return (
                      <span key={id} className="chip h-6 bg-subtle pr-1">
                        <LabelDot color={g.color} /> {g.name}
                        <button type="button" onClick={() => setGroupIds(ids => ids.filter(x => x !== id))} aria-label={`Remove ${g.name}`} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                  <GroupPicker value={groupIds} onChange={setGroupIds} trigger={<button type="button" className={cn(chipBtn, 'h-6')}><UsersRound className="h-3.5 w-3.5" /> {groupIds.length ? 'Add' : 'Add to groups'}</button>} />
                </div>
                {groupIds.length > 0 && <p className="mt-1 text-sm text-muted-foreground">Rules for these groups that include future members enroll them right away.</p>}
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5">
                <Switch checked={sendInvite} onCheckedChange={setSendInvite} className="mt-0.5" />
                <span>
                  <span className="block text-[14px] font-medium">Send invitation email</span>
                  <span className="block text-sm text-muted-foreground">{sendInvite ? `Uses the Invitation template, with a link to ${ws.settings.academyName}. They show as Invited until they sign in.` : 'They’re added as Active without an email — useful before launch. You can send invitations later.'}</span>
                </span>
              </label>
            </section>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-subtle/60 px-5 py-3">
          <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            {ws.isAdmin && (
              <>
                <Kbd>{MOD}</Kbd>
                <Kbd>↵</Kbd> to add
              </>
            )}
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
              {ws.isAdmin ? 'Cancel' : 'Close'}
            </button>
            {ws.isAdmin && (
              <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="h-9 rounded-md bg-primary px-3.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
                {busy ? 'Adding…' : unique.length > 1 ? `Add ${unique.length} people` : 'Add person'}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
