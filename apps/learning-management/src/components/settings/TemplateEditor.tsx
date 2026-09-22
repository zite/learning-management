import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Braces, Loader2, RotateCcw, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { saveTemplate, sendTestEmail } from 'zitejs/api';
import { MERGE_TAGS, renderMerge, sampleMergeContext } from '@project/shared/merge';
import { Button } from '@project/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@project/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { Input } from '@project/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import { qk } from '../../lib/queries';
import type { Bootstrap, EmailTemplate } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { Kbd } from '../primitives/bits';
import { TRIGGER_INFO, type Trigger } from './constants';
import { Field, inputClass } from './ui';

const KNOWN = new Set(MERGE_TAGS.map(t => t.tag));

type Draft = { subject: string; body: string; enabled: boolean };

function unknownTags(...texts: string[]) {
  const found = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) if (!KNOWN.has(m[1].toLowerCase())) found.add(m[1]);
  return [...found];
}

/** The email as a learner receives it: the org's logo, the same paragraphs, button and signature the send path builds. */
function EmailPreview({ draft, trigger }: { draft: Draft; trigger: Trigger }) {
  const ws = useWorkspace();
  const s = ws.settings;
  const [logoBroken, setLogoBroken] = useState(false);
  const ctx = useMemo(() => ({ ...sampleMergeContext(), organization_name: s.organizationName, academy_name: s.academyName, ...(s.learnUrl ? { academy_link: s.learnUrl } : {}) }), [s]);
  const sample = sampleMergeContext();
  const subject = renderMerge(draft.subject, ctx);
  const paragraphs = renderMerge(draft.body, ctx).replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const signature = s.emailSignature.trim();
  const recipient = trigger === 'Manager overdue digest' ? { name: sample.manager_name, email: 'marcus@example.com' } : { name: sample.learner_name, email: sample.learner_email };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Preview</span>
        <span className="truncate">· sample data, your organization’s details</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="mx-auto max-w-[520px] overflow-hidden rounded-lg border border-black/10 bg-white text-[#1f1d1a] shadow-xs" data-email-preview>
          <dl className="space-y-1 border-b border-black/10 px-4 py-3 text-sm">
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-[#6b645a]">To</dt><dd className="truncate">{recipient.name} &lt;{recipient.email}&gt;</dd></div>
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-[#6b645a]">Reply to</dt><dd className="truncate">{s.supportEmail || <span className="text-[#6b645a]">No support email set</span>}</dd></div>
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-[#6b645a]">Subject</dt><dd className="truncate font-medium" data-preview-subject>{subject || <span className="font-normal text-[#6b645a]">No subject</span>}</dd></div>
          </dl>
          <div className="space-y-3 px-5 py-5 text-[14.5px] leading-relaxed">
            {s.logoUrl && !logoBroken && <img src={s.logoUrl} alt="" className="mb-2 h-9 w-auto max-w-[160px] object-contain" onError={() => setLogoBroken(true)} />}
            {paragraphs.length ? paragraphs.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>) : <p className="text-[#6b645a]">Start writing the message…</p>}
            <div className="pt-1">
              <span className={cn('inline-flex h-9 items-center rounded-md bg-[#1f1d1a] px-4 text-[14px] font-medium text-white', !s.learnUrl && 'opacity-40')}>{TRIGGER_INFO[trigger].button}</span>
            </div>
            {signature && (
              <>
                <hr className="!my-4 border-black/10" />
                <p className="whitespace-pre-line text-[14px] text-[#57534e]">{signature}</p>
              </>
            )}
          </div>
        </div>
        <p className="mx-auto mt-3 max-w-[520px] text-sm text-muted-foreground">
          {s.learnUrl ? 'The button links to the right page in the academy.' : 'The button appears once the academy has a link — open the published academy once.'}
          {!signature && ' Add an email signature in General to sign every email.'}
        </p>
      </div>
    </div>
  );
}

function MergeTagMenu({ onInsert, target }: { onInsert: (tag: string) => void; target: 'subject' | 'body' }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="-mr-2 h-6 gap-1 px-2 text-sm text-muted-foreground hover:text-foreground">
          <Braces className="!size-3.5" /> Insert merge tag
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 shadow-lg" onCloseAutoFocus={e => e.preventDefault()}>
        <Command loop>
          <CommandInput placeholder="Search merge tags…" className="h-9 text-[14px]" />
          <div className="border-b px-3 py-1.5 text-2xs text-muted-foreground">Inserts into the {target === 'subject' ? 'subject' : 'message'} at your cursor</div>
          <CommandList className="max-h-[300px] p-1">
            <CommandEmpty className="py-5 text-center text-sm text-muted-foreground">No merge tag matches</CommandEmpty>
            {MERGE_TAGS.map(t => (
              <CommandItem
                key={t.tag}
                value={`${t.label} ${t.tag}`}
                onSelect={() => {
                  setOpen(false);
                  onInsert(t.tag);
                }}
                className="flex-col items-start gap-0 rounded-[5px] px-2 py-1.5 text-[14px]"
              >
                <span>{t.label}</span>
                <span className="w-full truncate font-mono text-2xs text-muted-foreground">{`{{${t.tag}}}`} · {t.sample}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function TemplateEditor({ open, onOpenChange, template, trigger }: { open: boolean; onOpenChange: (o: boolean) => void; template: EmailTemplate | null; trigger: Trigger }) {
  const app = useAppActions();
  const qc = useQueryClient();
  const info = TRIGGER_INFO[trigger];
  const [draft, setDraft] = useState<Draft>({ subject: '', body: '', enabled: true });
  const [base, setBase] = useState<Draft>({ subject: '', body: '', enabled: true });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'restore'>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [lastField, setLastField] = useState<'subject' | 'body'>('body');

  useEffect(() => {
    if (!open || !template) return;
    const next = { subject: template.subject, body: template.body, enabled: template.enabled };
    setDraft(next);
    setBase(next);
    setTouched(false);
  }, [open, template?.id]);

  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const errors = { subject: draft.subject.trim() ? null : 'Add a subject line', body: draft.body.trim() ? null : 'Write the message' };
  const invalid = Boolean(errors.subject || errors.body);
  const unknown = unknownTags(draft.subject, draft.body);

  const close = async () => {
    if (busy === 'save') return;
    if (dirty && !(await app.confirm({ title: 'Discard your changes?', description: `Your edits to “${info.title}” haven’t been saved.`, confirmLabel: 'Discard changes', destructive: true }))) return;
    onOpenChange(false);
  };

  const insertTag = (tag: string) => {
    const token = `{{${tag}}}`;
    const el = lastField === 'subject' ? subjectRef.current : bodyRef.current;
    const value = lastField === 'subject' ? draft.subject : draft.body;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    set(lastField === 'subject' ? { subject: next } : { body: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const writeCache = (row: EmailTemplate) =>
    qc.setQueryData<Bootstrap>(qk.bootstrap, old => (old ? { ...old, templates: old.templates.some(t => t.id === row.id) ? old.templates.map(t => (t.id === row.id ? row : t)) : [...old.templates, row] } : old));

  const save = async () => {
    setTouched(true);
    if (invalid || busy) return;
    if (!dirty) return onOpenChange(false);
    setBusy('save');
    try {
      const row = await saveTemplate({ action: 'save', id: template?.id, trigger, subject: draft.subject.trim(), body: draft.body.trim(), enabled: draft.enabled });
      writeCache(row);
      setBase(draft);
      toast.success(`Saved “${info.title}”`, { description: draft.enabled ? undefined : 'It’s switched off, so it won’t send until you turn it on.' });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save the template"));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: qk.bootstrap });
    }
  };

  const restore = async () => {
    const ok = await app.confirm({
      title: 'Restore the original wording?',
      description: `The subject and message of “${info.title}” go back to the default${dirty ? ', and your unsaved edits are lost' : ''}. Whether it sends stays as it is.`,
      confirmLabel: 'Restore default',
    });
    if (!ok) return;
    setBusy('restore');
    try {
      const row = await saveTemplate({ action: 'restoreDefault', id: template?.id, trigger });
      writeCache(row);
      const next = { subject: row.subject, body: row.body, enabled: draft.enabled };
      setDraft(next);
      setBase({ ...next, enabled: row.enabled });
      toast.success('Restored the default wording');
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't restore the default"));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: qk.bootstrap });
    }
  };

  const sendTest = async () => {
    if (invalid) {
      setTouched(true);
      toast.error('Add a subject and a message before sending a test');
      return;
    }
    setBusy('test');
    try {
      const res = await sendTestEmail({ subject: draft.subject, body: draft.body });
      if (res.status === 'Sent') toast.success(`Sent a test to ${res.to}`, { description: 'Filled in with sample data, just like the preview.' });
      else if (res.status === 'Skipped') toast.message(`${res.to} can’t receive email`, { description: 'Demo addresses on example domains never get real mail.' });
      else toast.error(`The test to ${res.to} didn’t send`, { description: 'Email delivery isn’t available right now. Try again in a minute.' });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't send the test email"));
    } finally {
      setBusy(null);
    }
  };

  // ⌘↵ / ⌘S save from anywhere while the editor is open — focus can sit outside the dialog after a confirm closes.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== 'Enter' && e.key !== 's')) return;
      e.preventDefault();
      if (document.querySelector('[role="alertdialog"]')) return;
      void saveRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={o => (o ? onOpenChange(true) : void close())}>
      <DialogContent className="flex h-[min(800px,94dvh)] max-w-[1080px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <div className="flex shrink-0 items-start gap-3 border-b px-5 py-3.5 pr-12">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-subtle text-muted-foreground">
            <info.icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-[16px]">{info.title}</DialogTitle>
            <DialogDescription className="mt-0.5 text-[13.5px]">
              {info.when} <span className="text-foreground/80">To: {info.to.toLowerCase()}.</span>
            </DialogDescription>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:content-stretch md:overflow-hidden">
          <div className="space-y-4 px-5 py-4 md:min-h-0 md:overflow-y-auto">
            <Field label="Subject" htmlFor="tpl-subject" error={touched ? errors.subject : null} aside={lastField === 'subject' ? <MergeTagMenu target="subject" onInsert={insertTag} /> : null}>
              <Input
                id="tpl-subject"
                ref={subjectRef}
                value={draft.subject}
                maxLength={200}
                onFocus={() => setLastField('subject')}
                onChange={e => set({ subject: e.target.value })}
                className={inputClass}
              />
            </Field>

            <Field label="Message" htmlFor="tpl-body" error={touched ? errors.body : null} aside={lastField === 'body' ? <MergeTagMenu target="body" onInsert={insertTag} /> : null} hint="Plain text. Leave a blank line between paragraphs. The button and your signature are added for you.">
              <textarea
                id="tpl-body"
                ref={bodyRef}
                value={draft.body}
                maxLength={20000}
                onFocus={() => setLastField('body')}
                onChange={e => set({ body: e.target.value })}
                className="block min-h-[240px] w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-[14px] leading-relaxed shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring md:min-h-[320px]"
              />
            </Field>
            {unknown.length > 0 && (
              <p className="-mt-2 flex items-start gap-1.5 text-sm text-tone-warning" role="alert">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{unknown.map(u => `{{${u}}}`).join(', ')} {unknown.length === 1 ? 'isn’t a merge tag' : 'aren’t merge tags'} and will be left blank.</span>
              </p>
            )}

            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border px-3 py-2.5">
              <span>
                <span className="block text-[14px] font-medium">Send this email</span>
                <span className="block text-sm text-muted-foreground">{trigger === 'Invitation' ? 'Invitations always go out, even to people who muted email.' : 'Off means it isn’t sent. People who muted email never get it either.'}</span>
              </span>
              <Switch checked={draft.enabled} onCheckedChange={enabled => set({ enabled })} aria-label="Send this email" />
            </label>
          </div>
          <div className="min-h-[440px] border-t bg-subtle md:min-h-0 md:border-l md:border-t-0">
            <EmailPreview draft={draft} trigger={trigger} />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2.5">
          <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" disabled={Boolean(busy)} onClick={() => void restore()} aria-label="Restore default wording">
            {busy === 'restore' ? <Loader2 className="animate-spin" /> : <RotateCcw />} <span className="hidden sm:inline">Restore default</span>
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void sendTest()}>
            {busy === 'test' ? <Loader2 className="animate-spin" /> : <Send />} Send test to me
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1 text-sm text-muted-foreground lg:flex"><Kbd>{MOD}</Kbd><Kbd>↵</Kbd> to save</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => void close()}>Cancel</Button>
            <Button type="button" size="sm" disabled={Boolean(busy) || (touched && invalid)} onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save template'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
