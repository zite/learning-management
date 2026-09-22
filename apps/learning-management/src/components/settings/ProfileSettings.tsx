import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Keyboard, Laptop, Moon, Sun, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { saveProfile, type SaveProfileInputType, type SaveProfileOutputType } from 'zitejs/api';
import { Button } from '@project/components/ui/button';
import { Input } from '@project/components/ui/input';
import { Switch } from '@project/components/ui/switch';
import { Textarea } from '@project/components/ui/textarea';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import { qk } from '../../lib/queries';
import { useTheme, type ThemePref } from '../../lib/theme';
import type { Bootstrap } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { Avatar } from '../primitives/Avatar';
import { EmptyState, Kbd } from '../primitives/bits';
import { UploadButtons, useImageUpload } from './fields';
import { Field, SaveBar, SettingsCard, SettingsPageTitle, SettingsRow, SettingsSection, inputClass, settingsKeys, useDraft } from './ui';

type Profile = SaveProfileOutputType;

const THEMES: Array<{ value: ThemePref; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Laptop },
];

const ROLE_DETAIL: Record<string, string> = {
  Admin: 'Everything, including people, roles, assignment rules and these settings.',
  Instructor: 'Builds and teaches courses, enrolls learners, grades and sees reports.',
  Learner: 'Takes training in the academy.',
};

/** A tiny drawing of the app in each theme, pinned to that theme whatever the current one is. */
function ThemeSwatch({ tone }: { tone: 'light' | 'dark' }) {
  const c = tone === 'light'
    ? { canvas: '#f5f4f2', panel: '#fefefd', line: '#e5e2df', ink: '#1f1c19', soft: '#a39d96', primary: '#221f1c' }
    : { canvas: '#0f0e0d', panel: '#191817', line: '#2a2826', ink: '#edece8', soft: '#6b665f', primary: '#ece9e4' };
  return (
    <div className="absolute inset-0 flex gap-1.5 p-1.5" style={{ background: c.canvas }}>
      <div className="flex w-[28%] flex-col gap-1.5 px-1 pt-1.5">
        <div className="h-1.5 w-4/5 rounded-full" style={{ background: c.ink, opacity: 0.35 }} />
        <div className="h-1.5 w-3/5 rounded-full" style={{ background: c.soft, opacity: 0.5 }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: c.soft, opacity: 0.5 }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 rounded-[5px] p-2" style={{ background: c.panel, border: `1px solid ${c.line}` }}>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: c.primary }} />
          <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.ink, opacity: 0.4 }} />
        </div>
        <div className="h-1.5 w-5/6 rounded-full" style={{ background: c.soft, opacity: 0.45 }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: c.soft, opacity: 0.45 }} />
        <div className="mt-auto h-2.5 w-1/3 rounded-sm" style={{ background: c.primary }} />
      </div>
    </div>
  );
}

/** Profile writes go to the profile cache and to the name/photo every avatar in the app reads from bootstrap. */
function useProfileSave() {
  const qc = useQueryClient();
  const ws = useWorkspace();
  return async (patch: SaveProfileInputType) => {
    const previous = qc.getQueryData<Profile>(settingsKeys.profile);
    if (previous) qc.setQueryData<Profile>(settingsKeys.profile, { ...previous, ...(patch as Partial<Profile>) });
    try {
      const next = await saveProfile(patch);
      qc.setQueryData(settingsKeys.profile, next);
      qc.setQueryData<Bootstrap>(qk.bootstrap, old =>
        old ? { ...old, me: { ...old.me, name: next.name, avatarUrl: next.avatarUrl }, staff: old.staff.map(m => (m.id === ws.me.id ? { ...m, name: next.name, avatarUrl: next.avatarUrl, title: next.title || null } : m)) } : old,
      );
      void qc.invalidateQueries({ queryKey: qk.bootstrap });
      return next;
    } catch (e) {
      if (previous) qc.setQueryData(settingsKeys.profile, previous);
      throw e;
    }
  };
}

function ProfileForm({ profile, children }: { profile: Profile; children: ReactNode }) {
  const ws = useWorkspace();
  const saveProfileChange = useProfileSave();
  const { draft, set, reset, dirty } = useDraft({ name: profile.name, title: profile.title, bio: profile.bio });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const nameError = draft.name.trim() ? null : 'Your name can’t be empty';

  const upload = useImageUpload(async url => {
    await saveProfileChange({ avatarUrl: url });
    toast.success('Photo updated');
  });

  const onSave = async () => {
    if (nameError || saving) return;
    setSaving(true);
    try {
      await saveProfileChange({ name: draft.name.trim(), title: draft.title.trim(), bio: draft.bio.trim() });
      toast.success('Profile saved');
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save your profile"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsSection title="You" description="How you appear to your team and, as an instructor, to learners.">
        <SettingsCard>
          <div className="flex flex-col gap-5 p-4 sm:flex-row">
            <div className="flex items-center gap-3 sm:w-44 sm:shrink-0 sm:flex-col sm:items-start">
              <Avatar name={draft.name.trim() || profile.name} src={profile.avatarUrl} color={profile.color} size={64} />
              <div className="min-w-0 space-y-1.5">
                {upload.inputEl}
                <UploadButtons
                  hasImage={Boolean(profile.avatarUrl)}
                  uploading={upload.uploading}
                  removing={removing}
                  label="Upload photo"
                  onPick={upload.pick}
                  onRemove={async () => {
                    setRemoving(true);
                    try {
                      await saveProfileChange({ avatarUrl: null });
                      toast.success('Photo removed');
                    } catch (e) {
                      toast.error(errorMessage(e, "Couldn't remove your photo"));
                    } finally {
                      setRemoving(false);
                    }
                  }}
                />
              </div>
            </div>
            <div className="grid flex-1 content-start gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="profile-name" error={nameError}>
                <Input id="profile-name" value={draft.name} maxLength={120} autoComplete="name" onChange={e => set({ name: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Job title" htmlFor="profile-title">
                <Input id="profile-title" value={draft.title} maxLength={120} placeholder="Learning & Development Lead" onChange={e => set({ title: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Bio" htmlFor="profile-bio" className="sm:col-span-2" hint="Shown on courses you teach and on your live sessions.">
                <Textarea id="profile-bio" value={draft.bio} maxLength={1000} rows={3} placeholder="A sentence or two about what you teach." onChange={e => set({ bio: e.target.value })} className="resize-y text-[14px] leading-relaxed md:text-[14px]" />
              </Field>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Account">
        <SettingsCard>
          <SettingsRow label="Email" description="Comes from how you sign in, so it can’t be changed here." compact>
            <span className="truncate text-[14px] text-muted-foreground">{profile.email}</span>
          </SettingsRow>
          <SettingsRow label="Role" description={ROLE_DETAIL[profile.role]} compact="switch">
            <span className="rounded-md bg-muted px-2 py-0.5 text-[13.5px] font-medium" data-role>{profile.role}</span>
          </SettingsRow>
          <SettingsRow label="Mute non-essential email" htmlFor="profile-mute" description="Stop assignment, reminder and certificate emails to you. You’ll still see everything in your inbox and in the academy." compact="switch">
            <Switch
              id="profile-mute"
              checked={profile.muteEmails}
              onCheckedChange={v =>
                void saveProfileChange({ muteEmails: v })
                  .then(() => toast.success(v ? 'Non-essential email muted' : 'You’ll get training emails again'))
                  .catch(e => toast.error(errorMessage(e, "Couldn't change your email preference")))
              }
            />
          </SettingsRow>
          <SettingsRow label="The academy, as a learner" description={ws.settings.learnUrl ? `Your own courses, certificates and progress live in ${ws.settings.academyName}.` : 'The academy link appears once the published academy has been opened once.'} compact>
            {ws.settings.learnUrl ? (
              <Button size="sm" variant="outline" asChild>
                <a href={ws.settings.learnUrl} target="_blank" rel="noreferrer noopener">
                  <ExternalLink /> Open the academy as a learner
                </a>
              </Button>
            ) : (
              <span className="text-[14px] text-muted-foreground">No link yet</span>
            )}
          </SettingsRow>
        </SettingsCard>
        <p className="mt-2 px-1 text-sm text-muted-foreground">{profile.role === 'Admin' ? 'Another admin can change your role in People.' : 'Ask an admin if you need a different role.'}</p>
      </SettingsSection>

      {children}

      <SaveBar dirty={dirty} saving={saving} disabled={Boolean(nameError)} onSave={() => void onSave()} onDiscard={reset} />
    </>
  );
}

export function ProfileSettings() {
  const app = useAppActions();
  const { pref, resolved, setPref } = useTheme();
  const { data, isPending, isError, refetch } = useQuery({ queryKey: settingsKeys.profile, queryFn: () => saveProfile({}), staleTime: 30_000 });

  const deviceSections = (
    <>
      <SettingsSection title="Appearance" description={`Choose how the app looks on this device.${pref === 'system' ? ` Following your system — currently ${resolved}.` : ''}`}>
        <div className="grid grid-cols-3 gap-3 sm:gap-4" role="radiogroup" aria-label="Theme">
          {THEMES.map(t => {
            const on = pref === t.value;
            return (
              <button key={t.value} type="button" role="radio" aria-checked={on} data-theme-option={t.value} onClick={() => setPref(t.value)} className="group min-w-0 text-left outline-none">
                <div className={cn('relative h-[72px] overflow-hidden rounded-lg border transition-[box-shadow,border-color] sm:h-[92px]', on ? 'border-transparent ring-2 ring-primary ring-offset-2 ring-offset-background' : 'group-hover:border-foreground/25 group-focus-visible:ring-2 group-focus-visible:ring-ring')}>
                  {t.value === 'system' ? (
                    <>
                      <div className="absolute inset-0" style={{ clipPath: 'polygon(0 0, 62% 0, 38% 100%, 0 100%)' }}><ThemeSwatch tone="light" /></div>
                      <div className="absolute inset-0" style={{ clipPath: 'polygon(62% 0, 100% 0, 100% 100%, 38% 100%)' }}><ThemeSwatch tone="dark" /></div>
                    </>
                  ) : (
                    <ThemeSwatch tone={t.value} />
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 text-[14px]">
                  <t.icon className={cn('h-3.5 w-3.5', on ? 'text-primary' : 'text-muted-foreground')} />
                  <span className={cn('truncate', on && 'font-medium')}>{t.label}</span>
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">Switch any time with <Kbd>{MOD}</Kbd><Kbd>⇧</Kbd><Kbd>L</Kbd></p>
      </SettingsSection>

      <SettingsSection title="Keyboard">
        <SettingsCard>
          <SettingsRow label="Keyboard shortcuts" description={<>Almost everything has one. Press <Kbd>?</Kbd> anywhere to see them.</>} compact>
            <Button variant="outline" size="sm" onClick={() => app.openShortcuts()}>
              <Keyboard /> View shortcuts
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </>
  );

  return (
    <>
      <SettingsPageTitle title="Profile" description="Your details, your email preferences, and how the app looks on this device." />

      {isPending ? (
        <SettingsSection title="You">
          <SettingsCard>
            <div className="flex gap-5 p-4">
              <div className="skeleton h-16 w-16 rounded-full" />
              <div className="flex-1 space-y-3">
                <div className="skeleton h-9 w-full" />
                <div className="skeleton h-9 w-2/3" />
                <div className="skeleton h-16 w-full" />
              </div>
            </div>
          </SettingsCard>
        </SettingsSection>
      ) : isError || !data ? (
        <SettingsSection title="You">
          <SettingsCard>
            <EmptyState icon={<UserRound />} title="Your profile didn’t load" description="Check your connection and try again." action={<Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>} />
          </SettingsCard>
        </SettingsSection>
      ) : (
        <ProfileForm profile={data}>{deviceSections}</ProfileForm>
      )}
      {(isPending || isError || !data) && deviceSections}

    </>
  );
}
