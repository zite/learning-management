import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, LogOut, Mail, Trash2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { saveMyProfile, type SaveMyProfileInputType } from 'zitejs/api';
import { uploadFile } from 'zitejs/upload';
import { cn } from '@project/components/lib/utils';
import { Switch } from '@project/components/ui/switch';
import { Avatar, PageHeader } from '../components/kit';
import { Alert, Button, Card, Container, FieldRow, PageSkeleton, inputClass, textareaClass } from '../components/ui';
import { useSession } from '../lib/auth';
import { errorMessage } from '../lib/errors';
import { qk, useMe, type MePerson } from '../lib/queries';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Draft = {
  name: string;
  title: string;
  bio: string;
  avatarUrl: string | null;
};

const fromPerson = (p: MePerson): Draft => ({
  name: p.name,
  title: p.title ?? '',
  bio: p.bio ?? '',
  avatarUrl: p.avatarUrl,
});
const trimmed = (d: Draft): Draft => ({
  ...d,
  name: d.name.trim(),
  title: d.title.trim(),
  bio: d.bio.trim(),
});
const same = (a: Draft, b: Draft) => JSON.stringify(trimmed(a)) === JSON.stringify(trimmed(b));

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_BIO = 1000;

export function ProfilePage() {
  const me = useMe();
  useDocumentTitle('Profile');
  if (me.isPending || !me.data?.person) return <PageSkeleton variant="form" />;
  return <Profile person={me.data.person} />;
}

/** Saves the profile and writes the result straight into `me`, so the top bar and every page agree at once. */
function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveMyProfileInputType) => saveMyProfile(input),
    onSuccess: res => {
      qc.setQueryData(qk.me, (prev: unknown) => {
        const p = prev as { person: MePerson } | undefined;
        return p?.person
          ? {
              ...p,
              person: {
                ...p.person,
                name: res.name,
                title: res.title || null,
                bio: res.bio,
                avatarUrl: res.avatarUrl,
                muteEmails: res.muteEmails,
              },
            }
          : prev;
      });
      void qc.invalidateQueries({ queryKey: qk.me });
      for (const root of [qk.teamRoot, qk.leaderboardRoot, qk.homeRoot]) void qc.invalidateQueries({ queryKey: root });
    },
  });
}

function Profile({ person }: { person: MePerson }) {
  const qc = useQueryClient();
  const { signOut } = useSession();

  return (
    <div>
      <PageHeader size="narrow" title="Profile" description="How you appear to instructors, your manager and on the leaderboard." />
      <Container size="narrow" className="space-y-10 py-8 sm:py-10">
        <ProfileForm person={person} />

        <section aria-labelledby="email-heading">
          <h2 id="email-heading" className="mb-3 font-serif text-lg font-semibold">
            Email
          </h2>
          <EmailPreference person={person} />
        </section>

        <section aria-labelledby="account-heading">
          <h2 id="account-heading" className="mb-3 font-serif text-lg font-semibold">
            Account
          </h2>
          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate font-medium">Signed in as {person.email}</p>
              <p className="text-sm text-muted-foreground">Signing out on a shared device keeps your progress private.</p>
            </div>
            <Button
              variant="secondary"
              className="shrink-0 self-start sm:self-auto"
              onClick={() => {
                qc.removeQueries({
                  predicate: q => q.queryKey[0] !== 'academy',
                });
                signOut();
              }}
            >
              <LogOut /> Sign out
            </Button>
          </Card>
        </section>
      </Container>
    </div>
  );
}

function ProfileForm({ person }: { person: MePerson }) {
  const saved = fromPerson(person);
  const [draft, setDraft] = useState<Draft>(saved);
  const [attempted, setAttempted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useSaveProfile();

  const nameError = attempted && !draft.name.trim() ? 'Enter your name.' : null;
  const dirty = !same(draft, saved);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!draft.name.trim()) {
      document.getElementById('profile-name')?.focus();
      return;
    }
    const d = trimmed(draft);
    save.mutate(
      {
        name: d.name,
        title: d.title,
        bio: d.bio,
        avatarUrl: d.avatarUrl,
        muteEmails: person.muteEmails,
      },
      {
        onSuccess: res => {
          setDraft({
            name: res.name,
            title: res.title,
            bio: res.bio,
            avatarUrl: res.avatarUrl,
          });
          setAttempted(false);
          toast.success('Profile saved.');
        },
        onError: err => toast.error(errorMessage(err, "Your profile wasn't saved. Try again.")),
      },
    );
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Choose an image file: a JPG, PNG or WebP.');
    if (file.size > MAX_PHOTO_BYTES) return toast.error('That photo is over 5 MB. Choose a smaller one.');
    setUploading(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      setDraft(d => ({ ...d, avatarUrl: fileUrl }));
      toast.success('Photo uploaded. Save your profile to use it.');
    } catch (e) {
      toast.error(errorMessage(e, "The photo didn't upload. Try again."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <form noValidate onSubmit={submit} aria-label="Your details">
      <Card className="divide-y overflow-hidden">
        <div className="flex items-start gap-4 p-5 sm:items-center sm:gap-5 sm:p-6">
          {/* Keyed by URL so a new photo gets a fresh try after a broken one. */}
          <Avatar key={draft.avatarUrl ?? 'none'} name={draft.name || person.email} color={person.color} avatarUrl={draft.avatarUrl} size={64} />
          <div className="min-w-0">
            <p className="text-[15px] font-medium">Photo</p>
            <p className="text-sm text-muted-foreground">A square image works best. Up to 5 MB.</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="sr-only" id="profile-photo" onChange={e => pickPhoto(e.target.files?.[0])} tabIndex={-1} aria-hidden />
              <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
                {!uploading && <Camera />} {draft.avatarUrl ? 'Change photo' : 'Upload photo'}
              </Button>
              {draft.avatarUrl && (
                <Button variant="ghost" size="sm" onClick={() => setDraft(d => ({ ...d, avatarUrl: null }))} disabled={uploading}>
                  <Trash2 /> Remove
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6 p-5 sm:p-6">
          <FieldRow id="profile-name" label="Full name" error={nameError}>
            <input
              id="profile-name"
              autoComplete="name"
              className={inputClass()}
              value={draft.name}
              maxLength={120}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              aria-invalid={Boolean(nameError) || undefined}
              aria-describedby={nameError ? 'profile-name-error' : undefined}
              required
            />
          </FieldRow>
          <FieldRow id="profile-title" label="Job title" optional>
            <input id="profile-title" autoComplete="organization-title" className={inputClass()} value={draft.title} maxLength={120} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Store Manager, Oak Park" />
          </FieldRow>
          <FieldRow id="profile-bio" label="About you" optional hint="A line or two. Instructors see this in discussions.">
            <textarea id="profile-bio" className={textareaClass()} value={draft.bio} maxLength={MAX_BIO} onChange={e => setDraft({ ...draft, bio: e.target.value })} aria-describedby="profile-bio-hint profile-bio-count" />
            <p id="profile-bio-count" className={cn('mt-1.5 text-right text-xs tabular-nums', draft.bio.length >= MAX_BIO ? 'text-tone-warning' : 'text-faint')} aria-live="polite">
              {draft.bio.length.toLocaleString()} / {MAX_BIO.toLocaleString()}
            </p>
          </FieldRow>
        </div>

        <dl className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          <ReadOnly label="Email" icon={Mail} value={person.email} hint="The email you sign in with." />
          <ReadOnly label="Manager" icon={UserRound} value={person.managerName ?? 'No manager set'} hint="Set by your administrator." />
        </dl>

        {save.isError && (
          <div className="p-5 sm:p-6">
            <Alert tone="danger" title="Your profile wasn't saved">
              {errorMessage(save.error, 'Check your connection and try again.')}
            </Alert>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 bg-subtle px-5 py-3.5 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(saved);
                setAttempted(false);
                save.reset();
              }}
              disabled={save.isPending}
            >
              Discard changes
            </Button>
          )}
          <Button type="submit" loading={save.isPending} disabled={!dirty || uploading}>
            Save profile
          </Button>
        </div>
      </Card>
    </form>
  );
}

function ReadOnly({ label, icon: Icon, value, hint }: { label: string; icon: typeof Mail; value: string; hint: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[15px] font-medium">{label}</dt>
      <dd className="mt-2 flex h-11 items-center gap-2 rounded-lg border bg-muted/60 px-3 text-[15px] text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{value}</span>
      </dd>
      <dd className="mt-1.5 text-sm text-muted-foreground">{hint}</dd>
    </div>
  );
}

/** Email preference saves the moment it's switched, apart from the profile form. */
function EmailPreference({ person }: { person: MePerson }) {
  const save = useSaveProfile();
  const [on, setOn] = useState(!person.muteEmails);
  useEffect(() => setOn(!person.muteEmails), [person.muteEmails]);

  const toggle = (next: boolean) => {
    setOn(next);
    const p = fromPerson(person);
    save.mutate(
      {
        name: p.name,
        title: p.title,
        bio: p.bio,
        avatarUrl: p.avatarUrl,
        muteEmails: !next,
      },
      {
        onSuccess: () => toast.success(next ? 'You’ll get emails about assignments and reminders.' : 'Emails are off. You’ll still see everything in the academy.'),
        onError: err => {
          setOn(!next);
          toast.error(errorMessage(err, "That didn't save. Try again."));
        },
      },
    );
  };

  return (
    <Card className="flex items-start justify-between gap-4 p-5">
      <label htmlFor="profile-emails" className="min-w-0 cursor-pointer">
        <span className="block text-[15px] font-medium">Email me about assignments and reminders</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">New training, due-date reminders, grades and certificates. You’ll still see everything in the academy either way.</span>
      </label>
      <Switch id="profile-emails" checked={on} onCheckedChange={toggle} disabled={save.isPending} className="mt-1 shrink-0" />
    </Card>
  );
}
