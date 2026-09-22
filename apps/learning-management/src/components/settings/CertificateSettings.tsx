import { Award, BookOpen, Route } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CertificateArt } from '@project/shared/ui/CertificateArt';
import { Input } from '@project/components/ui/input';
import { plural } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Field, SaveBar, SettingsCard, SettingsPageTitle, SettingsSection, inputClass, useDraft, useSaveSettings } from './ui';

export function CertificateSettings() {
  const ws = useWorkspace();
  const save = useSaveSettings();
  const s = ws.settings;
  const { draft, set, reset, dirty, changed } = useDraft({
    certificateTitle: s.certificateTitle,
    certificateSignatory: s.certificateSignatory,
    certificateSignatoryTitle: s.certificateSignatoryTitle,
  });
  const [saving, setSaving] = useState(false);
  const titleError = draft.certificateTitle.trim() ? null : 'Certificates need a title';

  const courses = ws.courses.filter(c => c.certificateEnabled && c.status !== 'Archived');
  const paths = ws.paths.filter(p => p.certificateEnabled && p.status !== 'Archived');
  const sample = courses.find(c => c.status === 'Published') ?? courses[0];
  const validity = sample?.certificateValidityMonths;
  const issued = new Date();
  const expires = validity ? new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth() + validity, issued.getUTCDate())) : null;

  const onSave = async () => {
    if (titleError || saving) return;
    setSaving(true);
    const patch: Parameters<typeof save>[0] = {};
    for (const key of changed) patch[key] = draft[key].trim();
    try {
      await save(patch, { success: 'Certificate settings saved', error: "Couldn't save the certificate settings" });
    } catch {
      /* toast shown */
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsPageTitle title="Certificates" description="How every certificate from your academy reads. Learners download them as PDFs and anyone can check one with its credential ID." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <SettingsSection title="Wording" className="mb-0">
            <SettingsCard>
              <div className="space-y-4 p-4">
                <Field label="Certificate title" htmlFor="cert-title" error={titleError}>
                  <Input id="cert-title" value={draft.certificateTitle} maxLength={80} placeholder="Certificate of Completion" onChange={e => set({ certificateTitle: e.target.value })} className={inputClass} />
                </Field>
                <Field label="Signed by" htmlFor="cert-signatory" hint="Leave empty to show no signature.">
                  <Input id="cert-signatory" value={draft.certificateSignatory} maxLength={80} placeholder="Maya Okafor" onChange={e => set({ certificateSignatory: e.target.value })} className={inputClass} />
                </Field>
                <Field label="Signatory’s title" htmlFor="cert-signatory-title" hint={`Without one, the line reads “${s.academyName}”.`}>
                  <Input id="cert-signatory-title" value={draft.certificateSignatoryTitle} maxLength={80} placeholder="Head of People & Learning" onChange={e => set({ certificateSignatoryTitle: e.target.value })} className={inputClass} />
                </Field>
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="Which training awards one" className="mb-0" description="Each course and learning path turns certificates on in its own settings, and sets how long they stay valid.">
            <SettingsCard>
              {courses.length + paths.length === 0 ? (
                <div className="flex items-start gap-3 px-4 py-3.5 text-[14px] text-muted-foreground">
                  <Award className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>No course or path awards a certificate yet. Turn it on in a course’s Settings tab.</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 px-4 py-2.5 text-[14px]">
                    <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1">{plural(courses.length, 'course')}</span>
                    <Link to="/courses" className="text-sm text-muted-foreground hover:text-foreground">Courses →</Link>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2.5 text-[14px]">
                    <Route className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1">{plural(paths.length, 'learning path')}</span>
                    <Link to="/paths" className="text-sm text-muted-foreground hover:text-foreground">Paths →</Link>
                  </div>
                </>
              )}
            </SettingsCard>
          </SettingsSection>
        </div>

        <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Preview</span>
            <span>Sample learner · your name, logo and brand colour</span>
          </div>
          <div className="rounded-xl border bg-subtle p-3 sm:p-5" data-certificate-preview>
            <CertificateArt
              recipientName="Priya Natarajan"
              title={sample?.title ?? 'Security Awareness Essentials'}
              kind="course"
              organizationName={s.organizationName}
              academyName={s.academyName}
              certificateTitle={draft.certificateTitle.trim() || 'Certificate of Completion'}
              issuedAt={issued.toISOString()}
              expiresAt={expires?.toISOString() ?? null}
              credentialId="LX7K-9QPM-3RTA"
              signatory={draft.certificateSignatory.trim() || null}
              signatoryTitle={draft.certificateSignatoryTitle.trim() || null}
              logoUrl={s.logoUrl}
              brandColor={s.brandColor}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {validity ? `Shown with ${sample?.title}’s ${validity}-month validity. ` : ''}Wording changes show on every certificate, including ones already issued; the recipient, course, dates and credential ID never change.
          </p>
        </div>
      </div>

      <SaveBar dirty={dirty} saving={saving} disabled={Boolean(titleError)} onSave={() => void onSave()} onDiscard={reset} />
    </>
  );
}
