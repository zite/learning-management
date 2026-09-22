import { AtSign, Copy, ExternalLink, Globe, GraduationCap, Link2, Lock, Pipette, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@project/components/ui/button';
import { Input } from '@project/components/ui/input';
import { Switch } from '@project/components/ui/switch';
import { Textarea } from '@project/components/ui/textarea';
import { cn } from '@project/components/lib/utils';
import { copyText } from '../../lib/clipboard';
import type { Settings } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { BrandPreview } from './BrandPreview';
import { BRAND_SWATCHES } from './constants';
import { Field, FieldError, HEX_RE, RadioCards, SaveBar, SettingsCard, SettingsPageTitle, SettingsRow, SettingsSection, Swatches, inputClass, useDraft, useSaveSettings } from './ui';

type Policy = Settings['signInPolicy'];

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const PUBLIC_PROVIDERS = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|aol|proton|protonmail)\.[a-z.]+$/;

/** "@Fernwood.com " → "fernwood.com"; also accepts a whole email address or a pasted URL. */
function cleanDomain(raw: string) {
  let d = raw.trim().toLowerCase();
  if (d.includes('://')) {
    try {
      d = new URL(d).hostname;
    } catch {
      /* keep as typed */
    }
  }
  d = d.replace(/^.*@/, '').replace(/^www\./, '').replace(/\/.*$/, '');
  return d;
}

function domainProblem(d: string) {
  if (!DOMAIN_RE.test(d)) return `“${d}” isn’t a domain. Use the part after the @, like fernwood.com.`;
  if (PUBLIC_PROVIDERS.test(d)) return `${d} is a public email provider — it would let anyone in. Choose “Anyone with the link” if that’s what you want.`;
  return null;
}

/** Domains as chips. Enter, comma, space or leaving the field adds what's typed; Backspace in an empty field removes the last. */
function DomainsInput({ value, onChange, invalidEmpty }: { value: string[]; onChange: (v: string[]) => void; invalidEmpty: boolean }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map(cleanDomain).filter(Boolean);
    if (!parts.length) return true;
    const bad = parts.filter(d => !DOMAIN_RE.test(d));
    const problem = bad.length > 1 ? `${bad.slice(0, 3).map(d => `“${d}”`).join(', ')} aren’t domains. Use the part after the @, like fernwood.com.` : parts.map(domainProblem).find(Boolean);
    if (problem) {
      setError(problem);
      return false;
    }
    onChange([...new Set([...value, ...parts])]);
    setText('');
    setError(null);
    return true;
  };

  return (
    <div>
      <div
        className={cn(
          'flex min-h-9 w-full cursor-text flex-wrap items-center gap-1 rounded-md border bg-background px-1.5 py-1 shadow-sm focus-within:ring-1 focus-within:ring-ring',
          error || invalidEmpty ? 'border-tone-danger/60' : 'border-input',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map(d => (
          <span key={d} className="chip h-6 gap-1 bg-subtle pl-2 pr-1 text-[13.5px]">
            <AtSign className="h-3 w-3 text-muted-foreground" />
            {d}
            <button type="button" aria-label={`Remove ${d}`} onClick={() => onChange(value.filter(x => x !== d))} className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          aria-label="Add an email domain"
          aria-invalid={Boolean(error)}
          placeholder={value.length ? 'Add another…' : 'fernwood.com'}
          onChange={e => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
              if (!text.trim()) return;
              e.preventDefault();
              commit(text);
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onPaste={e => {
            const pasted = e.clipboardData.getData('text');
            if (/[\s,;]/.test(pasted.trim())) {
              e.preventDefault();
              commit(pasted);
            }
          }}
          onBlur={() => text.trim() && commit(text)}
          className="h-6 min-w-[120px] flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      {error ? (
        <FieldError>{error}</FieldError>
      ) : invalidEmpty ? (
        <FieldError>Add at least one domain, or choose a different option.</FieldError>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Subdomains count too: fernwood.com also lets in people @stores.fernwood.com.</p>
      )}
    </div>
  );
}

function BrandColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hexText, setHexText] = useState(value);
  useEffect(() => {
    if (value.toLowerCase() !== hexText.toLowerCase()) setHexText(value);
  }, [value]);
  const valid = HEX_RE.test(value);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <Swatches label="Brand colour" value={value} onChange={c => onChange(c.toLowerCase())} colors={BRAND_SWATCHES} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border shadow-sm" style={{ background: valid ? value : undefined }} title="Pick any colour">
          <Pipette className="h-3.5 w-3.5 text-white mix-blend-difference" />
          <input type="color" value={valid ? value : '#2f7a55'} onChange={e => onChange(e.target.value.toLowerCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Pick a custom colour" />
        </label>
        <Input
          value={hexText}
          maxLength={7}
          spellCheck={false}
          aria-label="Hex colour"
          aria-invalid={!valid}
          onChange={e => {
            const v = e.target.value.trim();
            const withHash = v.startsWith('#') ? v : `#${v}`;
            setHexText(withHash);
            onChange(withHash.toLowerCase());
          }}
          className={cn(inputClass, 'w-28 font-mono uppercase')}
        />
      </div>
      {!valid && <p className="w-full text-sm text-tone-danger" role="alert">Use a six-digit hex colour, like #2F7A55</p>}
    </div>
  );
}

function LearnerAppLink() {
  const ws = useWorkspace();
  const url = ws.settings.learnUrl;
  return (
    <SettingsCard>
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-subtle text-muted-foreground">
          <Link2 className="h-4 w-4" />
        </span>
        {url ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium">{ws.settings.academyName}</div>
              <div className="truncate text-[13.5px] text-muted-foreground" data-learn-url>{url}</div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="outline" onClick={() => copyText(url, 'Copied the academy link')}>
                <Copy /> Copy link
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink /> Open
                </a>
              </Button>
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">No academy link yet</div>
            <div className="text-[13.5px] text-muted-foreground">Publish the Learner Portal app, then open the academy once after publishing and its link appears here — and in every email to learners.</div>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}

const FEATURES: Array<{ key: 'selfEnrollment' | 'discussionsEnabled' | 'leaderboardEnabled'; label: string; description: string; on: string; off: string }> = [
  { key: 'selfEnrollment', label: 'Self-enrollment from the catalog', description: 'Learners can start any published catalog course or path on their own. Private courses stay assign-only.', on: 'Learners can enroll themselves', off: 'Only staff and rules enroll learners now' },
  { key: 'discussionsEnabled', label: 'Lesson discussions', description: 'Learners can ask questions under a lesson. Instructors answer them in Discussions.', on: 'Lesson discussions are on', off: 'Lesson discussions are hidden' },
  { key: 'leaderboardEnabled', label: 'Leaderboard and points', description: 'Learners earn points for lessons, courses and certificates, and see where they rank.', on: 'The leaderboard is on', off: 'The leaderboard is hidden' },
];

function LearnerFeatures() {
  const ws = useWorkspace();
  const save = useSaveSettings();
  return (
    <SettingsCard>
      {FEATURES.map(f => {
        const checked = ws.settings[f.key];
        return (
          <SettingsRow key={f.key} label={f.label} htmlFor={`feature-${f.key}`} description={f.description} compact="switch">
            <Switch
              id={`feature-${f.key}`}
              checked={checked}
              onCheckedChange={v => void save({ [f.key]: v }, { success: v ? f.on : f.off, error: "Couldn't change that setting", optimistic: { [f.key]: v } }).catch(() => undefined)}
            />
          </SettingsRow>
        );
      })}
    </SettingsCard>
  );
}

export function AcademySettings() {
  const ws = useWorkspace();
  const save = useSaveSettings();
  const s = ws.settings;
  const { draft, set, reset, dirty, changed } = useDraft({
    academyName: s.academyName,
    academyHeadline: s.academyHeadline,
    academyIntro: s.academyIntro,
    brandColor: s.brandColor,
    signInPolicy: s.signInPolicy as Policy,
    allowedDomains: s.allowedDomains,
  });
  const [saving, setSaving] = useState(false);

  const errors = {
    academyName: draft.academyName.trim() ? null : 'The academy needs a name',
    academyHeadline: draft.academyHeadline.trim() ? null : 'Add a headline for the home page',
    academyIntro: draft.academyIntro.trim() ? null : 'Add a sentence or two of introduction',
    brandColor: HEX_RE.test(draft.brandColor) ? null : 'Use a six-digit hex colour',
    allowedDomains: draft.signInPolicy === 'Allowed domains' && draft.allowedDomains.length === 0 ? 'Add at least one domain' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const onSave = async () => {
    if (invalid || saving) return;
    setSaving(true);
    const patch: Parameters<typeof save>[0] = {};
    for (const key of changed) {
      if (key === 'academyName') patch.academyName = draft.academyName.trim();
      else if (key === 'academyHeadline') patch.academyHeadline = draft.academyHeadline.trim();
      else if (key === 'academyIntro') patch.academyIntro = draft.academyIntro.trim();
      else if (key === 'brandColor') patch.brandColor = draft.brandColor;
      else if (key === 'signInPolicy') patch.signInPolicy = draft.signInPolicy;
      else if (key === 'allowedDomains') patch.allowedDomains = draft.allowedDomains;
    }
    // Policy and domains are validated together on the server.
    if (patch.signInPolicy && draft.signInPolicy === 'Allowed domains') patch.allowedDomains = draft.allowedDomains;
    try {
      await save(patch, { success: 'Academy settings saved', error: "Couldn't save the academy settings", optimistic: { ...patch, allowedDomains: draft.allowedDomains } as Partial<Settings> });
    } catch {
      /* toast shown */
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsPageTitle title="Academy" description={`${s.academyName} is where your people learn: its name and welcome, your brand colour, who can sign in, and which learner features are on.`} />

      <SettingsSection title="Academy link" description="Share it with learners, or put it on your intranet.">
        <LearnerAppLink />
      </SettingsSection>

      <SettingsSection title="Welcome" description="The top of the academy home page.">
        <SettingsCard>
          <SettingsRow label="Academy name" htmlFor="academy-name" description="Shown in the academy header, browser tab and emails.">
            <div className="w-full">
              <Input id="academy-name" value={draft.academyName} maxLength={80} onChange={e => set({ academyName: e.target.value })} className={inputClass} />
              <FieldError>{errors.academyName}</FieldError>
            </div>
          </SettingsRow>
          <SettingsRow label="Headline" htmlFor="academy-headline" stacked>
            <Input id="academy-headline" value={draft.academyHeadline} maxLength={160} onChange={e => set({ academyHeadline: e.target.value })} className={inputClass} />
            <FieldError>{errors.academyHeadline}</FieldError>
          </SettingsRow>
          <SettingsRow label="Introduction" htmlFor="academy-intro" description="A few plain sentences under the headline: what’s here and where to start." stacked>
            <Textarea id="academy-intro" value={draft.academyIntro} maxLength={2000} rows={3} onChange={e => set({ academyIntro: e.target.value })} className="resize-y text-[14px] leading-relaxed md:text-[14px]" />
            <div className="mt-1 flex items-start justify-between gap-3">
              <FieldError>{errors.academyIntro}</FieldError>
              <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">{draft.academyIntro.length}/2000</span>
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Brand colour" description="Used for buttons, links, progress and the focus ring in the academy — and on certificates. Preview updates as you pick.">
        <div className="space-y-3">
          <SettingsCard>
            <div className="p-4">
              <BrandColorField value={draft.brandColor} onChange={brandColor => set({ brandColor })} />
            </div>
          </SettingsCard>
          <BrandPreview hex={HEX_RE.test(draft.brandColor) ? draft.brandColor : s.brandColor} academyName={draft.academyName} headline={draft.academyHeadline} logoUrl={s.logoUrl} />
        </div>
      </SettingsSection>

      <SettingsSection title="Who can sign in" description="Everyone signs in with their email address. People you add in People can always sign in, whichever you choose.">
        <div className="space-y-3">
          <RadioCards
            name="Who can sign in"
            columns={3}
            value={draft.signInPolicy}
            onChange={signInPolicy => set({ signInPolicy })}
            options={[
              { value: 'Invited only' as Policy, label: 'Invited only', icon: <Lock />, description: 'Only people you’ve added. Anyone else sees a “you haven’t been invited yet” page.' },
              { value: 'Allowed domains' as Policy, label: 'Your email domains', icon: <AtSign />, description: 'Anyone with an email at your domains joins as a learner the first time they sign in.' },
              { value: 'Anyone' as Policy, label: 'Anyone with the link', icon: <Globe />, description: 'Anyone who signs in joins as a learner. For customer, partner or public academies.' },
            ]}
          />
          {draft.signInPolicy === 'Allowed domains' && (
            <SettingsCard>
              <div className="p-4">
                <Field label="Allowed email domains">
                  <DomainsInput value={draft.allowedDomains} onChange={allowedDomains => set({ allowedDomains })} invalidEmpty={Boolean(errors.allowedDomains)} />
                </Field>
              </div>
            </SettingsCard>
          )}
          {draft.signInPolicy !== 'Invited only' && (
            <p className="flex items-start gap-2 px-1 text-sm text-muted-foreground">
              <GraduationCap className="mt-px h-3.5 w-3.5 shrink-0" />
              Newcomers are enrolled right away by any assignment rule for everyone, so required training starts on day one.
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="Learner features" description="These switch on and off right away.">
        <LearnerFeatures />
      </SettingsSection>

      <SaveBar dirty={dirty} saving={saving} disabled={invalid} onSave={() => void onSave()} onDiscard={reset} />
    </>
  );
}
