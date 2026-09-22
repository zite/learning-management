import { BookOpen, GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@project/components/ui/input';
import { Textarea } from '@project/components/ui/textarea';
import { useWorkspace } from '../../lib/workspace';
import { LogoTiles, TimezonePicker, UploadButtons, useImageUpload, zoneTime } from './fields';
import { EMAIL_RE, FieldError, RadioCards, SaveBar, SettingsCard, SettingsPageTitle, SettingsRow, SettingsSection, inputClass, normalizeUrl, useDraft, useSaveSettings } from './ui';

function LogoField() {
  const ws = useWorkspace();
  const save = useSaveSettings();
  const [removing, setRemoving] = useState(false);
  const [broken, setBroken] = useState(false);
  const logo = ws.settings.logoUrl;
  const upload = useImageUpload(async url => {
    setBroken(false);
    await save({ logoUrl: url }, { success: 'Logo updated', error: "Couldn't save the logo", optimistic: { logoUrl: url } });
  });

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <LogoTiles url={logo} fallback={ws.settings.organizationName.trim().charAt(0).toUpperCase() || 'L'} onBroken={() => setBroken(true)} />
      <div className="min-w-0 flex-1">
        {upload.inputEl}
        <UploadButtons
          hasImage={Boolean(logo)}
          uploading={upload.uploading}
          removing={removing}
          label="Upload logo"
          onPick={upload.pick}
          onRemove={async () => {
            setRemoving(true);
            await save({ logoUrl: null }, { success: 'Logo removed', error: "Couldn't remove the logo", optimistic: { logoUrl: null } }).catch(() => undefined);
            setRemoving(false);
          }}
        />
        <p className="mt-1.5 text-sm text-muted-foreground">
          {logo && broken ? 'The saved logo couldn’t be displayed — upload it again.' : 'A wide or square logo with a transparent background works best. Check it reads on both tiles. PNG, SVG, JPG or WebP, up to 4 MB.'}
        </p>
      </div>
    </div>
  );
}

export function GeneralSettings() {
  const ws = useWorkspace();
  const save = useSaveSettings();
  const s = ws.settings;
  const { draft, set, reset, dirty, changed } = useDraft({
    organizationName: s.organizationName,
    websiteUrl: s.websiteUrl ?? '',
    supportEmail: s.supportEmail ?? '',
    timezone: s.timezone,
    emailSignature: s.emailSignature,
    defaultStaffRole: s.defaultStaffRole,
  });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const website = normalizeUrl(draft.websiteUrl);
  const errors = {
    organizationName: draft.organizationName.trim() ? null : 'Your organization needs a name',
    websiteUrl: website.error,
    supportEmail: draft.supportEmail.trim() && !EMAIL_RE.test(draft.supportEmail.trim()) ? 'Enter a full email address, like learning@fernwood.com' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const onSave = async () => {
    setTouched(true);
    if (invalid || saving) return;
    setSaving(true);
    const patch: Parameters<typeof save>[0] = {};
    for (const key of changed) {
      if (key === 'websiteUrl') patch.websiteUrl = website.url || null;
      else if (key === 'supportEmail') patch.supportEmail = draft.supportEmail.trim() || null;
      else if (key === 'organizationName') patch.organizationName = draft.organizationName.trim();
      else if (key === 'emailSignature') patch.emailSignature = draft.emailSignature;
      else if (key === 'timezone') patch.timezone = draft.timezone;
      else if (key === 'defaultStaffRole') patch.defaultStaffRole = draft.defaultStaffRole;
    }
    try {
      await save(patch, { success: 'Settings saved', error: "Couldn't save your settings" });
      setTouched(false);
    } catch {
      /* toast already shown */
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsPageTitle title="General" description="Your organization’s name and logo, where replies to the app’s emails go, the time zone for sessions and emails, and how new staff join." />

      <SettingsSection title="Organization">
        <SettingsCard>
          <SettingsRow label="Name" htmlFor="org-name" description="Shown in the admin app, the academy, certificates and every email.">
            <div className="w-full">
              <Input id="org-name" value={draft.organizationName} maxLength={120} onChange={e => set({ organizationName: e.target.value })} className={inputClass} />
              <FieldError>{errors.organizationName}</FieldError>
            </div>
          </SettingsRow>
          <SettingsRow label="Logo" description="Appears in the sidebar, at the top of the academy, on certificates and in email headers." stacked>
            <LogoField />
          </SettingsRow>
          <SettingsRow label="Website" htmlFor="org-website" description="Linked from the academy footer.">
            <div className="w-full">
              <Input
                id="org-website"
                value={draft.websiteUrl}
                inputMode="url"
                placeholder="fernwood.com"
                onChange={e => set({ websiteUrl: e.target.value })}
                onBlur={() => website.url && !website.error && website.url !== draft.websiteUrl && set({ websiteUrl: website.url })}
                className={inputClass}
              />
              {(touched || draft.websiteUrl.length > 5) && <FieldError>{errors.websiteUrl}</FieldError>}
            </div>
          </SettingsRow>
          <SettingsRow label="Time zone" htmlFor="org-timezone" description={<>Used for live session times and dates in emails. It’s {zoneTime(draft.timezone)} there now.</>} wide>
            <TimezonePicker id="org-timezone" value={draft.timezone} onChange={timezone => set({ timezone })} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Email" description="Every email the app sends — assignments, reminders, certificates — is signed and answered the same way.">
        <SettingsCard>
          <SettingsRow label="Support email" htmlFor="org-support" description="Used as the reply-to address, so when a learner replies to a reminder it reaches your team.">
            <div className="w-full">
              <Input id="org-support" type="email" value={draft.supportEmail} placeholder="learning@fernwood.com" onChange={e => set({ supportEmail: e.target.value })} className={inputClass} />
              {(touched || draft.supportEmail.includes('@')) && <FieldError>{errors.supportEmail}</FieldError>}
            </div>
          </SettingsRow>
          <SettingsRow label="Email signature" htmlFor="org-signature" description="Plain text, added below a divider at the end of every email." stacked>
            <Textarea
              id="org-signature"
              value={draft.emailSignature}
              maxLength={1000}
              rows={3}
              placeholder={'The Learning & Development team\nFernwood Supply Co.'}
              onChange={e => set({ emailSignature: e.target.value })}
              className="resize-y text-[14px] leading-relaxed md:text-[14px]"
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="New staff" description="People in your organization who open the admin app for the first time, without having been added, join with this role. You can change anyone’s role later in People.">
        <RadioCards
          name="Default role for new staff"
          value={draft.defaultStaffRole}
          onChange={defaultStaffRole => set({ defaultStaffRole })}
          options={[
            { value: 'Instructor' as const, label: 'Instructor', icon: <BookOpen />, description: 'Can build and teach courses, enroll learners, grade and see reports. Good when everyone who finds the admin app runs training.' },
            { value: 'Learner' as const, label: 'Learner', icon: <GraduationCap />, description: 'Sees a pointer to the academy instead of the admin app. Safer when the whole company can open it — promote instructors by hand.' },
          ]}
        />
      </SettingsSection>

      <SaveBar dirty={dirty} saving={saving} disabled={invalid} onSave={() => void onSave()} onDiscard={() => { reset(); setTouched(false); }} />
    </>
  );
}
