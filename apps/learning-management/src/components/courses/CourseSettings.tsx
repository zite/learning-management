import { AlertOctagon, Archive, ArchiveRestore, Award, BookOpen, ChevronDown, Copy, Eye, Gauge, Lock, Sparkles, Trash2, Undo2, Users } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@project/components/ui/select';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { CertificateArt } from '@project/shared/ui/CertificateArt';
import { COURSE_COLORS, COURSE_ICONS, LEVELS } from '../../lib/constants';
import { copyText } from '../../lib/clipboard';
import { plural } from '../../lib/format';
import type { CourseDetail } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { AvatarStack, PersonAvatar } from '../primitives/Avatar';
import { CategoryPicker, StaffMultiPicker, StaffPicker } from '../pickers/pickers';
import { useCourseLifecycle } from './CourseActions';
import { learnerUrl } from './CourseBits';
import { useCourseAutosave } from './courseData';
import {
  AutoInput, buttonClass, ChipsInput, CoverImageField, Field, IconColorPicker, inputClass, ListEditor, MarkdownEditor, NumberInput, PageTitle, SaveState, SettingsCard, SettingsRow, SettingsSection, type SaveStatus,
} from './fields';

export const COURSE_SETTINGS_SECTIONS: Array<{ key: string; label: string; icon: ReactNode }> = [
  { key: 'details', label: 'Details', icon: <BookOpen /> },
  { key: 'access', label: 'Access & pacing', icon: <Gauge /> },
  { key: 'certificate', label: 'Certificate', icon: <Award /> },
  { key: 'team', label: 'Team', icon: <Users /> },
  { key: 'danger', label: 'Danger zone', icon: <AlertOctagon /> },
];

/** The two-column settings frame: section nav on the left (a picker on a phone), the section on the right. */
export function SettingsFrame({ sections, section, onSection, children, label }: { sections: Array<{ key: string; label: string; icon: ReactNode }>; section: string; onSection: (key: string) => void; children: ReactNode; label: string }) {
  const current = sections.find(s => s.key === section) ?? sections[0];
  return (
    <div className="flex min-h-0 flex-1">
      <nav className="hidden w-[208px] shrink-0 border-r bg-subtle/40 p-2 md:block" aria-label={label}>
        <div className="px-2 pb-1.5 pt-2 text-2xs font-medium text-muted-foreground">Settings</div>
        <ul className="space-y-px">
          {sections.map(s => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onSection(s.key)}
                aria-current={s.key === current.key ? 'page' : undefined}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5',
                  s.key === current.key ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  s.key === 'danger' && s.key !== current.key && 'text-tone-danger/90 hover:text-tone-danger',
                )}
              >
                {s.icon}
                <span className="truncate">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-[5] border-b bg-background px-4 py-2 md:hidden">
          <Select value={current.key} onValueChange={onSection}>
            <SelectTrigger className="h-9 text-[14px]" aria-label="Settings section">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sections.map(s => (
                <SelectItem key={s.key} value={s.key} className="text-[14px]">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div key={current.key} className="mx-auto max-w-[760px] px-4 py-6 animate-fade-in sm:px-8 sm:py-8">
          {children}
        </div>
      </div>
    </div>
  );
}

export function ReadOnlyNote({ kind }: { kind: 'course' | 'path' }) {
  return (
    <div className="mb-6 flex items-start gap-2.5 rounded-lg border bg-subtle/60 px-3.5 py-2.5 text-[14px]">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{kind === 'course' ? 'You can look, but only the course owner, its instructors or an admin can change these settings.' : 'You can look, but only the path owner or an admin can change these settings.'}</span>
    </div>
  );
}

/**
 * Everything about a course that isn't its lessons. Each field saves on its
 * own — a pick, a blur or a pause in typing — and says "Saved" beside it.
 */
export function CourseSettings({ detail, section, onPublish }: { detail: CourseDetail; section: string | undefined; onPublish: () => void }) {
  const navigate = useNavigate();
  const key = COURSE_SETTINGS_SECTIONS.some(s => s.key === section) ? section! : null;
  if (!key) return <Navigate to={`/courses/${detail.course.id}/settings/details`} replace />;
  return (
    <SettingsFrame label="Course settings" sections={COURSE_SETTINGS_SECTIONS} section={key} onSection={k => navigate(`/courses/${detail.course.id}/settings/${k}`)}>
      {!detail.canEdit && key !== 'danger' && <ReadOnlyNote kind="course" />}
      {key === 'details' && <DetailsSection detail={detail} />}
      {key === 'access' && <AccessSection detail={detail} />}
      {key === 'certificate' && <CertificateSection detail={detail} />}
      {key === 'team' && <TeamSection detail={detail} />}
      {key === 'danger' && <DangerSection detail={detail} onPublish={onPublish} />}
    </SettingsFrame>
  );
}

function DetailsSection({ detail }: { detail: CourseDetail }) {
  const ws = useWorkspace();
  const c = detail.course;
  const { save, status } = useCourseAutosave(c.id);
  const ro = !detail.canEdit;
  const category = c.categoryId ? ws.categoryById.get(c.categoryId) : undefined;
  const link = learnerUrl(ws.settings.learnUrl, 'courses', c.slug);
  const skillSuggestions = useMemo(() => [...new Set(ws.courses.flatMap(x => x.skills))].sort(), [ws.courses]);

  return (
    <div>
      <PageTitle title="Details" description="How the course appears in the catalog and at the top of the course page." />

      <SettingsSection title="Cover and identity">
        <div className="space-y-4 rounded-lg border bg-background p-4">
          <Field label="Cover image" status={status('coverImageUrl')}>
            <CoverImageField value={c.coverImageUrl} title={c.title} color={c.color} disabled={ro} onCommit={url => save('coverImageUrl', { coverImageUrl: url })} />
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Icon" status={status('icon')} className="shrink-0">
              <IconColorPicker icon={c.icon} color={c.color} icons={COURSE_ICONS} colors={COURSE_COLORS} size={22} disabled={ro} onChange={n => save('icon', n)} />
            </Field>
            <Field label="Title" htmlFor="cs-title" status={status('title')} className="flex-1">
              <AutoInput id="cs-title" value={c.title} required maxLength={160} disabled={ro} onCommit={v => save('title', { title: v })} />
            </Field>
          </div>
          <Field
            label="Web address"
            htmlFor="cs-slug"
            status={status('slug')}
            hint={
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{link ? link : `Learners open it at …/#/courses/${c.slug}`}</span>
                {link && (
                  <button type="button" onClick={() => copyText(link, 'Learner link copied')} className="shrink-0 text-primary hover:underline">
                    Copy
                  </button>
                )}
              </span>
            }
          >
            <div className="flex items-center">
              <span className="flex h-9 shrink-0 items-center rounded-l-md border border-r-0 border-input bg-subtle px-2.5 text-[14px] text-muted-foreground">/courses/</span>
              <AutoInput id="cs-slug" value={c.slug} required maxLength={80} disabled={ro} className="rounded-l-none font-mono text-[13.5px]" transform={v => v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')} onCommit={v => save('slug', { slug: v.replace(/^-+|-+$/g, '') })} />
            </div>
          </Field>
          <Field label="Summary" htmlFor="cs-summary" status={status('summary')} hint="One or two sentences for catalog cards and search results.">
            <AutoInput id="cs-summary" multiline rows={2} value={c.summary} maxLength={400} disabled={ro} debounce={900} onCommit={v => save('summary', { summary: v })} placeholder="What learners will be able to do after this course." />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title="Description" description="The course page learners read before they start. Markdown works — headings, lists, links." actions={<SaveState status={status('description')} />}>
        <MarkdownEditor value={c.description} disabled={ro} maxLength={20000} onCommit={v => save('description', { description: v })} placeholder={'## Who this is for\n\nEveryone who…'} />
      </SettingsSection>

      <SettingsSection title="What learners will learn" description="Short, concrete outcomes shown as a checklist on the course page. Drag or use ⌥↑ ⌥↓ to reorder." actions={<SaveState status={status('objectives')} />}>
        <ListEditor value={c.objectives} disabled={ro} onCommit={v => save('objectives', { objectives: v })} placeholder="e.g. Spot the signs of a phishing email" addLabel="Add an objective" />
      </SettingsSection>

      <SettingsSection title="Catalog">
        <div className="grid gap-4 rounded-lg border bg-background p-4 sm:grid-cols-2">
          <Field label="Category" status={status('categoryId')}>
            <CategoryPicker
              value={c.categoryId}
              onChange={v => save('categoryId', { categoryId: v })}
              trigger={
                <button type="button" disabled={ro} className={cn(inputClass, 'flex items-center gap-2 text-left hover:bg-accent/40')}>
                  {category ? (
                    <>
                      <span className="leading-none">{category.icon || '•'}</span>
                      <span className="flex-1 truncate">{category.name}</span>
                    </>
                  ) : (
                    <span className="flex-1 text-muted-foreground">No category</span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              }
            />
          </Field>
          <Field label="Level" status={status('level')}>
            <div className="flex h-9 rounded-md border border-input p-0.5" role="radiogroup" aria-label="Level">
              {LEVELS.map(l => (
                <button key={l} type="button" role="radio" disabled={ro} aria-checked={c.level === l} onClick={() => c.level !== l && save('level', { level: l })} className={cn('flex-1 rounded-[4px] text-[13.5px] transition-colors disabled:cursor-not-allowed', c.level === l ? 'bg-accent font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Skills" status={status('skills')} className="sm:col-span-2" hint="Learners can browse the catalog by skill. Press Enter or a comma after each one.">
            <ChipsInput value={c.skills} disabled={ro} suggestions={skillSuggestions} onCommit={v => save('skills', { skills: v })} placeholder="e.g. Phishing, Data protection" />
          </Field>
        </div>
      </SettingsSection>
    </div>
  );
}

function ChoiceCard({ selected, onSelect, icon, title, description, disabled }: { selected: boolean; onSelect: () => void; icon: ReactNode; title: string; description: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn('flex min-w-0 flex-1 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed', selected ? 'border-primary/60 bg-primary/[0.05] ring-1 ring-primary/40' : 'bg-background hover:border-foreground/20 hover:bg-accent/40')}
    >
      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-primary' : 'border-input')} aria-hidden>
        {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className={cn('mt-px shrink-0 [&_svg]:h-4 [&_svg]:w-4', selected ? 'text-primary' : 'text-muted-foreground')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

export function VisibilityChoice({ value, onChange, disabled, kind, status }: { value: 'Catalog' | 'Private'; onChange: (v: 'Catalog' | 'Private') => void; disabled?: boolean; kind: 'course' | 'path'; status?: SaveStatus }) {
  const ws = useWorkspace();
  return (
    <Field label="Who can find it" status={status}>
      <div role="radiogroup" aria-label="Visibility" className="flex flex-col gap-2 sm:flex-row">
        <ChoiceCard
          selected={value === 'Catalog'}
          disabled={disabled}
          onSelect={() => value !== 'Catalog' && onChange('Catalog')}
          icon={<Eye />}
          title="Catalog"
          description={ws.settings.selfEnrollment ? `Anyone in ${ws.settings.academyName} can find this ${kind} and enroll themselves.` : `Listed in the catalog. Self-enrollment is off in Settings, so people still need to be assigned.`}
        />
        <ChoiceCard selected={value === 'Private'} disabled={disabled} onSelect={() => value !== 'Private' && onChange('Private')} icon={<Lock />} title="Private" description={`Hidden from the catalog. Only people you assign — directly, by group or by rule — see it.`} />
      </div>
    </Field>
  );
}

function AccessSection({ detail }: { detail: CourseDetail }) {
  const c = detail.course;
  const { save, status } = useCourseAutosave(c.id);
  const ro = !detail.canEdit;
  return (
    <div>
      <PageTitle title="Access & pacing" description="Who can find the course, whether lessons unlock in order, and when it’s due." />
      <SettingsSection title="Visibility">
        <VisibilityChoice kind="course" value={c.visibility} disabled={ro} status={status('visibility')} onChange={v => save('visibility', { visibility: v })} />
      </SettingsSection>
      <SettingsSection title="Pacing">
        <SettingsCard>
          <SettingsRow label="Lessons unlock in order" htmlFor="cs-seq" status={status('sequential')} description="Learners finish each required lesson before the next one opens. Optional lessons never block.">
            <Switch id="cs-seq" checked={c.sequential} disabled={ro} onCheckedChange={v => save('sequential', { sequential: v })} />
          </SettingsRow>
          <SettingsRow label="Default due window" htmlFor="cs-due" status={status('dueDays')} description={c.dueDays ? `When you enroll people, the due date defaults to ${plural(c.dueDays, 'day')} later. You can still change it each time.` : 'No default — enrollments have no due date unless you pick one.'}>
            <NumberInput id="cs-due" value={c.dueDays} disabled={ro} min={1} max={3650} placeholder="None" suffix="days" className="w-[120px]" onCommit={v => save('dueDays', { dueDays: v })} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

export function CertificatePreview({ title, kind, validityMonths, enabled }: { title: string; kind: 'course' | 'path'; validityMonths: number | null; enabled: boolean }) {
  const ws = useWorkspace();
  const issued = new Date().toISOString();
  const expires = validityMonths ? new Date(new Date().setMonth(new Date().getMonth() + validityMonths)).toISOString() : null;
  return (
    <div className={cn('rounded-lg border bg-subtle/50 p-4 transition-opacity', !enabled && 'opacity-50')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Preview</span>
        <span>Wording and signature come from Settings → Certificates</span>
      </div>
      <CertificateArt
        className="mx-auto max-w-[560px]"
        recipientName={ws.me.name}
        title={title || 'Untitled'}
        kind={kind}
        organizationName={ws.settings.organizationName}
        academyName={ws.settings.academyName}
        certificateTitle={ws.settings.certificateTitle}
        issuedAt={issued}
        expiresAt={expires}
        credentialId="LX7K-9QPM-3RTA"
        signatory={ws.settings.certificateSignatory}
        signatoryTitle={ws.settings.certificateSignatoryTitle}
        logoUrl={ws.settings.logoUrl}
        brandColor={ws.settings.brandColor}
      />
    </div>
  );
}

function CertificateSection({ detail }: { detail: CourseDetail }) {
  const c = detail.course;
  const { save, status } = useCourseAutosave(c.id);
  const ro = !detail.canEdit;
  return (
    <div>
      <PageTitle title="Certificate" description="What learners receive when they complete the course, and how long it stays valid." />
      <SettingsSection title="On completion">
        <SettingsCard>
          <SettingsRow label="Issue a certificate" htmlFor="cs-cert" status={status('certificateEnabled')} description="Learners get a certificate with a verification link the moment they finish. Changing this doesn’t affect certificates already issued.">
            <Switch id="cs-cert" checked={c.certificateEnabled} disabled={ro} onCheckedChange={v => save('certificateEnabled', { certificateEnabled: v })} />
          </SettingsRow>
          <SettingsRow
            label="Valid for"
            htmlFor="cs-valid"
            status={status('certificateValidityMonths')}
            className={cn(!c.certificateEnabled && 'opacity-60')}
            description={c.certificateValidityMonths ? `Certificates expire ${plural(c.certificateValidityMonths, 'month')} after they’re issued. Pair this with a recurring assignment rule to recertify people automatically.` : 'Certificates never expire. Set a number of months for training that must be renewed.'}
          >
            <NumberInput id="cs-valid" value={c.certificateValidityMonths} disabled={ro || !c.certificateEnabled} min={1} max={240} placeholder="Never" suffix="months" className="w-[132px]" onCommit={v => save('certificateValidityMonths', { certificateValidityMonths: v })} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <CertificatePreview title={c.title} kind="course" validityMonths={c.certificateValidityMonths} enabled={c.certificateEnabled} />
    </div>
  );
}

function TeamSection({ detail }: { detail: CourseDetail }) {
  const ws = useWorkspace();
  const c = detail.course;
  const { save, status } = useCourseAutosave(c.id);
  const ro = !detail.canEdit;
  const owner = c.ownerId ? ws.staffById.get(c.ownerId) : undefined;
  const instructors = c.instructorIds.map(id => ws.staffById.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof ws.staffById.get>>[];
  const trigger = 'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-[14px] shadow-2xs hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60';
  return (
    <div>
      <PageTitle title="Team" description="Who is responsible for the course and who can change it." />
      <SettingsSection title="Owner and instructors">
        <div className="space-y-4 rounded-lg border bg-background p-4">
          <Field label="Owner" status={status('ownerId')} hint={ws.isAdmin ? 'The owner gets questions and grading notifications and can edit everything about the course.' : 'Only admins can change the owner.'}>
            <StaffPicker
              allowNone
              noneLabel="Nobody — admins manage it"
              value={c.ownerId}
              onChange={v => save('ownerId', { ownerId: v })}
              trigger={
                <button type="button" disabled={!ws.isAdmin} className={trigger}>
                  {owner ? <PersonAvatar person={owner} size={20} /> : null}
                  <span className={cn('flex-1 truncate', !owner && 'text-muted-foreground')}>{owner ? owner.name : 'Nobody — admins manage it'}</span>
                  {owner && <span className="text-sm text-muted-foreground">{owner.role}</span>}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              }
            />
          </Field>
          <Field label="Instructors" status={status('instructorIds')} hint="Instructors can edit the course, grade its assignments, answer questions and run its live sessions.">
            <StaffMultiPicker
              value={c.instructorIds}
              exclude={c.ownerId ? [c.ownerId] : []}
              onChange={v => save('instructorIds', { instructorIds: v })}
              trigger={
                <button type="button" disabled={ro} className={trigger}>
                  {instructors.length ? <AvatarStack people={instructors} size={20} /> : null}
                  <span className={cn('flex-1 truncate', !instructors.length && 'text-muted-foreground')}>{instructors.length ? instructors.map(i => i.name).join(', ') : 'Add instructors'}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              }
            />
          </Field>
        </div>
      </SettingsSection>
      <SettingsSection title="What each role can do">
        <SettingsCard>
          <RoleRow title="Admins" body="Everything, on every course — including changing owners and deleting courses." />
          <RoleRow title="Owner and instructors" body="Edit this course’s content and settings, publish and archive it, enroll people, grade and answer questions." />
          <RoleRow title="Other instructors" body="See the course and its learners, enroll people and duplicate it, but not change it." />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

function RoleRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[14px] font-medium">{title}</div>
      <div className="mt-0.5 text-[13.5px] text-muted-foreground">{body}</div>
    </div>
  );
}

function DangerSection({ detail, onPublish }: { detail: CourseDetail; onPublish: () => void }) {
  const ws = useWorkspace();
  const life = useCourseLifecycle();
  const course = ws.courseById.get(detail.course.id);
  const c = course ?? { ...detail.course, counts: { enrolled: 0, notStarted: 0, inProgress: 0, completed: 0, overdue: 0 } };
  const ro = !detail.canEdit;
  const enrolled = course?.counts.enrolled ?? 0;
  return (
    <div>
      <PageTitle title="Danger zone" description="Changes that affect whether learners can find, start or keep taking this course." />
      <SettingsSection title="Lifecycle">
        <SettingsCard>
          {c.status === 'Draft' && (
            <SettingsRow label="Publish" description="Put the course in the catalog (or make it assignable, if it’s private). Every lesson is checked first.">
              <button type="button" disabled={ro} className={buttonClass} onClick={onPublish}>
                <Sparkles /> Review and publish…
              </button>
            </SettingsRow>
          )}
          {c.status === 'Published' && (
            <SettingsRow label="Unpublish" description="Back to draft: it leaves the catalog and nobody new can enroll. People already enrolled keep going.">
              <button type="button" disabled={ro} className={buttonClass} onClick={() => life.unpublish(c)}>
                <Undo2 /> Unpublish…
              </button>
            </SettingsRow>
          )}
          <SettingsRow label="Duplicate" description="Copy the details, sections and lessons into a new draft. Learners and discussions stay here.">
            <button type="button" className={buttonClass} onClick={() => life.duplicate(c)}>
              <Copy /> Duplicate
            </button>
          </SettingsRow>
          {c.status === 'Archived' ? (
            <SettingsRow label="Unarchive" description={c.publishedAt ? 'Bring it back published, as long as every lesson can still be completed.' : 'Bring it back as a draft.'}>
              <button type="button" disabled={ro} className={buttonClass} onClick={() => life.unarchive(c)}>
                <ArchiveRestore /> Unarchive
              </button>
            </SettingsRow>
          ) : (
            <SettingsRow label="Archive" description="Hide it from the catalog and lists and stop new enrollments. Learner history, certificates and reports are kept.">
              <button type="button" disabled={ro} className={buttonClass} onClick={() => life.archive(c)}>
                <Archive /> Archive…
              </button>
            </SettingsRow>
          )}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Delete">
        <div className="overflow-hidden rounded-lg border border-tone-danger/30 bg-background">
          <SettingsRow label="Delete this course" description={enrolled > 0 ? `${plural(enrolled, 'person has', 'people have')} enrolled, so it can’t be deleted without erasing training records. Archive it instead.` : 'Permanently delete the course with its sections, lessons, discussions and live sessions. This can’t be undone.'}>
            <button type="button" disabled={ro || enrolled > 0} onClick={() => life.remove(c)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-destructive px-3 text-[14px] font-medium text-destructive-foreground shadow-xs hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5">
              <Trash2 /> Delete course…
            </button>
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  );
}
