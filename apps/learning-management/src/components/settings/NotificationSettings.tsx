import { useQueryClient } from '@tanstack/react-query';
import { BellRing, ChevronRight, Loader2, Minus, Plus, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { saveTemplate, sendReminders } from 'zitejs/api';
import { Button } from '@project/components/ui/button';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { qk } from '../../lib/queries';
import type { Bootstrap, EmailTemplate } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { IconButton, Tip } from '../primitives/bits';
import { TRIGGER_INFO, TRIGGERS, type Trigger } from './constants';
import { TemplateEditor } from './TemplateEditor';
import { SettingsCard, SettingsPageTitle, SettingsRow, SettingsSection, useSaveSettings } from './ui';

/** 0–30, saved a moment after the last change so clicking + five times is one save. */
function DaysStepper({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [n, setN] = useState(value);
  const [text, setText] = useState(String(value));
  const timer = useRef<number | null>(null);
  useEffect(() => {
    setN(value);
    setText(String(value));
  }, [value]);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);
  const change = (next: number) => {
    const clamped = Math.max(0, Math.min(30, Math.round(next)));
    setN(clamped);
    setText(String(clamped));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => clamped !== value && onCommit(clamped), 600);
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 items-center overflow-hidden rounded-md border border-input bg-background shadow-sm">
        <button type="button" aria-label="One day fewer" disabled={n <= 0} onClick={() => change(n - 1)} className="flex h-full w-7 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          id="reminder-days"
          inputMode="numeric"
          value={text}
          aria-label="Days before the due date"
          onChange={e => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
          onBlur={() => change(text === '' ? value : Number(text))}
          onKeyDown={e => {
            if (e.key === 'Enter') change(text === '' ? value : Number(text));
            if (e.key === 'ArrowUp') { e.preventDefault(); change(n + 1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); change(n - 1); }
          }}
          className="h-full w-9 border-x border-input bg-transparent text-center text-[14px] tabular-nums outline-none focus:bg-accent/40"
        />
        <button type="button" aria-label="One day more" disabled={n >= 30} onClick={() => change(n + 1)} className="flex h-full w-7 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className="text-[14px] text-muted-foreground">{n === 1 ? 'day before' : 'days before'}</span>
    </div>
  );
}

function Reminders() {
  const ws = useWorkspace();
  const save = useSaveSettings();
  const s = ws.settings;
  const days = s.reminderDaysBefore;
  return (
    <SettingsCard>
      <SettingsRow
        label="Remind learners before a due date"
        htmlFor="reminder-days"
        compact
        description={days === 0 ? 'Learners get the “Due date reminder” on the day training is due.' : `Learners get the “Due date reminder” once unfinished training is due within ${days === 1 ? 'a day' : `${days} days`}, and again every few days until it’s done.`}
      >
        <DaysStepper
          value={days}
          onCommit={n => void save({ reminderDaysBefore: n }, { success: n === 0 ? 'Reminders will go out on the due date' : `Reminders will go out ${n} day${n === 1 ? '' : 's'} before`, error: "Couldn't change the reminder timing", optimistic: { reminderDaysBefore: n } }).catch(() => undefined)}
        />
      </SettingsRow>
      <SettingsRow label="Weekly manager digest" htmlFor="escalate-overdue" description="Email managers at most once a week when anyone who reports to them has overdue training, with the list." compact="switch">
        <Switch
          id="escalate-overdue"
          checked={s.escalateOverdue}
          onCheckedChange={v => void save({ escalateOverdue: v }, { success: v ? 'Managers will get a weekly digest' : 'Manager digests are off', error: "Couldn't change the manager digest", optimistic: { escalateOverdue: v } }).catch(() => undefined)}
        />
      </SettingsRow>
      <SettingsRow label="Daily reminder run" description="Every day at 14:00 UTC: due-date and overdue reminders, manager digests, recertification, expiring certificates and tomorrow’s sessions. Running it now sends only what’s due; nobody is reminded twice." compact>
        <RunRemindersButton />
      </SettingsRow>
    </SettingsCard>
  );
}

const RUN_PARTS: Array<{ key: 'dueSoon' | 'overdue' | 'managerDigests' | 'recertified' | 'expiringCertificates' | 'sessionReminders'; one: string; many?: string }> = [
  { key: 'dueSoon', one: 'due-date reminder' },
  { key: 'overdue', one: 'overdue reminder' },
  { key: 'managerDigests', one: 'manager digest' },
  { key: 'recertified', one: 'recertification' },
  { key: 'expiringCertificates', one: 'expiring-certificate email' },
  { key: 'sessionReminders', one: 'session reminder' },
];

/** The scheduled `sendReminders` job, run by hand. Every nudge is stamped on its row, so running it twice never double-sends. */
function RunRemindersButton() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const res = await sendReminders({});
      const sent = RUN_PARTS.filter(p => res[p.key] > 0).map(p => `${res[p.key]} ${res[p.key] === 1 ? p.one : p.many ?? `${p.one}s`}`);
      if (sent.length) toast.success('Reminders sent', { description: sent.join(' · ') });
      else toast.message('Nothing needed a reminder', { description: 'Anyone already reminded recently is skipped.' });
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't run reminders"));
    } finally {
      setRunning(false);
    }
  };
  return (
    <Button size="sm" variant="outline" disabled={running} onClick={() => void run()}>
      {running ? <Loader2 className="animate-spin" /> : <BellRing />} {running ? 'Running…' : 'Run reminders now'}
    </Button>
  );
}

function TemplateRow({ trigger, template, onOpen, onToggle, onSetUp, settingUp }: { trigger: Trigger; template: EmailTemplate | undefined; onOpen: () => void; onToggle: (v: boolean) => void; onSetUp: () => void; settingUp: boolean }) {
  const info = TRIGGER_INFO[trigger];
  const on = Boolean(template?.enabled);
  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40" data-trigger={trigger}>
      <button type="button" onClick={template ? onOpen : onSetUp} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-label={template ? `Edit ${info.title}` : `Set up ${info.title}`}>
        <info.icon className={cn('mt-[3px] h-3.5 w-3.5 shrink-0', on ? 'text-foreground/80' : 'text-muted-foreground/70')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('truncate text-[14px] font-medium', !on && 'text-muted-foreground')}>{info.title}</span>
            {!template && <span className="shrink-0 rounded bg-tone-warning/[0.12] px-1.5 py-px text-2xs font-medium text-tone-warning">Not set up</span>}
            {template && !on && <span className="shrink-0 rounded bg-muted px-1.5 py-px text-2xs font-medium text-muted-foreground">Off</span>}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{info.when}</span>
          {template && <span className="mt-1 block truncate text-sm text-foreground/80"><span className="text-muted-foreground">Subject:</span> {template.subject}</span>}
        </span>
      </button>
      {template ? (
        <>
          <Tip label={on ? 'Sending — click to stop' : 'Not sending — click to turn on'}>
            <span className="flex items-center">
              <Switch checked={on} onCheckedChange={onToggle} aria-label={`Send ${info.title}`} />
            </span>
          </Tip>
          <IconButton aria-label={`Open ${info.title}`} onClick={onOpen} className="hidden sm:inline-flex">
            <ChevronRight />
          </IconButton>
        </>
      ) : (
        <Button size="sm" variant="outline" className="h-8 shrink-0 text-[13.5px]" disabled={settingUp} onClick={onSetUp}>
          {settingUp ? <Loader2 className="!size-3.5 animate-spin" /> : <Wrench className="!size-3.5" />} Set up
        </Button>
      )}
    </div>
  );
}

export function NotificationSettings() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ open: boolean; trigger: Trigger }>({ open: false, trigger: 'Course assigned' });
  const [settingUp, setSettingUp] = useState<Trigger | null>(null);

  // The send path uses the first template per trigger by position.
  const byTrigger = new Map<string, EmailTemplate>();
  for (const t of ws.templates) if (!byTrigger.has(t.trigger)) byTrigger.set(t.trigger, t);
  const enabledCount = TRIGGERS.filter(t => byTrigger.get(t)?.enabled).length;

  const toggle = async (t: EmailTemplate, trigger: Trigger, enabled: boolean) => {
    const previous = qc.getQueryData<Bootstrap>(qk.bootstrap);
    qc.setQueryData<Bootstrap>(qk.bootstrap, old => (old ? { ...old, templates: old.templates.map(x => (x.id === t.id ? { ...x, enabled } : x)) } : old));
    try {
      await saveTemplate({ action: 'save', id: t.id, trigger, enabled });
      toast.success(enabled ? `“${TRIGGER_INFO[trigger].title}” emails are on` : `“${TRIGGER_INFO[trigger].title}” emails are off`);
    } catch (e) {
      if (previous) qc.setQueryData(qk.bootstrap, previous);
      toast.error(errorMessage(e, "Couldn't change that email"));
    } finally {
      void qc.invalidateQueries({ queryKey: qk.bootstrap });
    }
  };

  const setUp = async (trigger: Trigger) => {
    setSettingUp(trigger);
    try {
      const row = await saveTemplate({ action: 'restoreDefault', trigger });
      qc.setQueryData<Bootstrap>(qk.bootstrap, old => (old ? { ...old, templates: [...old.templates, row] } : old));
      void qc.invalidateQueries({ queryKey: qk.bootstrap });
      setEditing({ open: true, trigger });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't set up that email"));
    } finally {
      setSettingUp(null);
    }
  };

  const editingTemplate = byTrigger.get(editing.trigger) ?? null;

  return (
    <>
      <SettingsPageTitle title="Notifications" description="When the app nudges people about their training, and the words it uses. Everyone also gets these as in-app notifications; people can mute non-essential email from their profile." />

      <SettingsSection title="Reminders">
        <Reminders />
      </SettingsSection>

      <SettingsSection title="Email templates" description={`${enabledCount} of ${TRIGGERS.length} emails are on. Click one to edit its wording, preview it and send yourself a test.`}>
        <SettingsCard>
          {TRIGGERS.map(trigger => {
            const t = byTrigger.get(trigger);
            return (
              <TemplateRow
                key={trigger}
                trigger={trigger}
                template={t}
                settingUp={settingUp === trigger}
                onOpen={() => setEditing({ open: true, trigger })}
                onToggle={v => t && void toggle(t, trigger, v)}
                onSetUp={() => void setUp(trigger)}
              />
            );
          })}
        </SettingsCard>
      </SettingsSection>

      {editingTemplate && <TemplateEditor open={editing.open} onOpenChange={o => setEditing(e => ({ ...e, open: o }))} template={editingTemplate} trigger={editing.trigger} />}
    </>
  );
}
