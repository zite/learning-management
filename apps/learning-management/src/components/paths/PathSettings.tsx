import { AlertOctagon, Archive, ArchiveRestore, Award, ChevronDown, Gauge, Route, Sparkles, Trash2, Undo2, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { COURSE_COLORS, COURSE_ICONS } from '../../lib/constants';
import { copyText } from '../../lib/clipboard';
import { plural } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { CategoryPicker, StaffPicker } from '../pickers/pickers';
import { learnerUrl } from '../courses/CourseBits';
import { CertificatePreview, ReadOnlyNote, SettingsFrame, VisibilityChoice } from '../courses/CourseSettings';
import { AutoInput, buttonClass, CoverImageField, Field, IconColorPicker, inputClass, MarkdownEditor, NumberInput, PageTitle, SaveState, SettingsCard, SettingsRow, SettingsSection } from '../courses/fields';
import { usePathLifecycle } from './PathActions';
import { usePathAutosave, type PathDetail } from './pathData';

const SECTIONS: Array<{ key: string; label: string; icon: ReactNode }> = [
  { key: 'details', label: 'Details', icon: <Route /> },
  { key: 'access', label: 'Access & pacing', icon: <Gauge /> },
  { key: 'certificate', label: 'Certificate', icon: <Award /> },
  { key: 'team', label: 'Owner', icon: <Users /> },
  { key: 'danger', label: 'Danger zone', icon: <AlertOctagon /> },
];

/** Sections live in `?section=` — path routes stop at the tab. */
export function PathSettings({ detail, onPublish }: { detail: PathDetail; onPublish: () => void }) {
  const [params, setParams] = useSearchParams();
  const section = params.get('section');
  const key = SECTIONS.some(s => s.key === section) ? section! : 'details';
  return (
    <SettingsFrame label="Path settings" sections={SECTIONS} section={key} onSection={k => setParams(k === 'details' ? {} : { section: k }, { replace: true })}>
      {!detail.canEdit && key !== 'danger' && <ReadOnlyNote kind="path" />}
      {key === 'details' && <Details detail={detail} />}
      {key === 'access' && <Access detail={detail} />}
      {key === 'certificate' && <Certificate detail={detail} />}
      {key === 'team' && <Owner detail={detail} />}
      {key === 'danger' && <Danger detail={detail} onPublish={onPublish} />}
    </SettingsFrame>
  );
}

function Details({ detail }: { detail: PathDetail }) {
  const ws = useWorkspace();
  const p = detail.path;
  const { save, status } = usePathAutosave(p.id);
  const ro = !detail.canEdit;
  const category = p.categoryId ? ws.categoryById.get(p.categoryId) : undefined;
  const link = learnerUrl(ws.settings.learnUrl, 'paths', p.slug);
  return (
    <div>
      <PageTitle title="Details" description="How the path appears in the catalog and at the top of its page." />
      <SettingsSection title="Cover and identity">
        <div className="space-y-4 rounded-lg border bg-background p-4">
          <Field label="Cover image" status={status('coverImageUrl')}>
            <CoverImageField value={p.coverImageUrl} title={p.title} color={p.color} disabled={ro} onCommit={url => save('coverImageUrl', { coverImageUrl: url })} />
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Icon" status={status('icon')} className="shrink-0">
              <IconColorPicker icon={p.icon} color={p.color} icons={COURSE_ICONS} colors={COURSE_COLORS} size={22} disabled={ro} onChange={n => save('icon', n)} />
            </Field>
            <Field label="Title" htmlFor="ps-title" status={status('title')} className="flex-1">
              <AutoInput id="ps-title" value={p.title} required maxLength={160} disabled={ro} onCommit={v => save('title', { title: v })} />
            </Field>
          </div>
          <Field
            label="Web address"
            htmlFor="ps-slug"
            status={status('slug')}
            hint={
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{link ?? `Learners open it at …/#/paths/${p.slug}`}</span>
                {link && (
                  <button type="button" onClick={() => copyText(link, 'Learner link copied')} className="shrink-0 text-primary hover:underline">
                    Copy
                  </button>
                )}
              </span>
            }
          >
            <div className="flex items-center">
              <span className="flex h-9 shrink-0 items-center rounded-l-md border border-r-0 border-input bg-subtle px-2.5 text-[14px] text-muted-foreground">/paths/</span>
              <AutoInput id="ps-slug" value={p.slug} required maxLength={80} disabled={ro} className="rounded-l-none font-mono text-[13.5px]" transform={v => v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')} onCommit={v => save('slug', { slug: v.replace(/^-+|-+$/g, '') })} />
            </div>
          </Field>
          <Field label="Summary" htmlFor="ps-summary" status={status('summary')} hint="Shown on catalog cards and when the path is assigned.">
            <AutoInput id="ps-summary" multiline rows={2} value={p.summary} maxLength={400} disabled={ro} debounce={900} onCommit={v => save('summary', { summary: v })} placeholder="Who it’s for and what they’ll be ready to do." />
          </Field>
          <Field label="Category" status={status('categoryId')}>
            <CategoryPicker
              value={p.categoryId}
              onChange={v => save('categoryId', { categoryId: v })}
              trigger={
                <button type="button" disabled={ro} className={cn(inputClass, 'flex max-w-[280px] items-center gap-2 text-left hover:bg-accent/40')}>
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
        </div>
      </SettingsSection>
      <SettingsSection title="Description" description="The path page learners read before they start. Markdown works." actions={<SaveState status={status('description')} />}>
        <MarkdownEditor value={p.description} disabled={ro} maxLength={20000} onCommit={v => save('description', { description: v })} placeholder={'## Who this path is for\n\n…'} />
      </SettingsSection>
    </div>
  );
}

function Access({ detail }: { detail: PathDetail }) {
  const p = detail.path;
  const { save, status } = usePathAutosave(p.id);
  const ro = !detail.canEdit;
  return (
    <div>
      <PageTitle title="Access & pacing" description="Who can find the path, whether its courses unlock in order, and when it’s due." />
      <SettingsSection title="Visibility">
        <VisibilityChoice kind="path" value={p.visibility} disabled={ro} status={status('visibility')} onChange={v => save('visibility', { visibility: v })} />
      </SettingsSection>
      <SettingsSection title="Pacing">
        <SettingsCard>
          <SettingsRow label="Courses unlock in order" htmlFor="ps-seq" status={status('sequential')} description="Learners finish each required course before the next one opens. Optional courses never block.">
            <Switch id="ps-seq" checked={p.sequential} disabled={ro} onCheckedChange={v => save('sequential', { sequential: v })} />
          </SettingsRow>
          <SettingsRow label="Default due window" htmlFor="ps-due" status={status('dueDays')} description={p.dueDays ? `When you enroll people, the path — and every course in it — is due ${plural(p.dueDays, 'day')} later by default.` : 'No default — enrollments have no due date unless you pick one.'}>
            <NumberInput id="ps-due" value={p.dueDays} disabled={ro} min={1} max={3650} placeholder="None" suffix="days" className="w-[120px]" onCommit={v => save('dueDays', { dueDays: v })} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

function Certificate({ detail }: { detail: PathDetail }) {
  const p = detail.path;
  const { save, status } = usePathAutosave(p.id);
  const ro = !detail.canEdit;
  return (
    <div>
      <PageTitle title="Certificate" description="What learners receive when they complete every required course in the path." />
      <SettingsSection title="On completion">
        <SettingsCard>
          <SettingsRow label="Issue a path certificate" htmlFor="ps-cert" status={status('certificateEnabled')} description={`In addition to any course certificates. ${plural(detail.certificates.issued, 'path certificate')} issued so far.`}>
            <Switch id="ps-cert" checked={p.certificateEnabled} disabled={ro} onCheckedChange={v => save('certificateEnabled', { certificateEnabled: v })} />
          </SettingsRow>
          <SettingsRow label="Valid for" htmlFor="ps-valid" status={status('certificateValidityMonths')} className={cn(!p.certificateEnabled && 'opacity-60')} description={p.certificateValidityMonths ? `Certificates expire ${plural(p.certificateValidityMonths, 'month')} after they’re issued.` : 'Certificates never expire.'}>
            <NumberInput id="ps-valid" value={p.certificateValidityMonths} disabled={ro || !p.certificateEnabled} min={1} max={240} placeholder="Never" suffix="months" className="w-[132px]" onCommit={v => save('certificateValidityMonths', { certificateValidityMonths: v })} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <CertificatePreview title={p.title} kind="path" validityMonths={p.certificateValidityMonths} enabled={p.certificateEnabled} />
    </div>
  );
}

function Owner({ detail }: { detail: PathDetail }) {
  const ws = useWorkspace();
  const p = detail.path;
  const { save, status } = usePathAutosave(p.id);
  const owner = p.ownerId ? ws.staffById.get(p.ownerId) : undefined;
  return (
    <div>
      <PageTitle title="Owner" description="Who is responsible for the path." />
      <SettingsSection title="Owner">
        <div className="rounded-lg border bg-background p-4">
          <Field label="Owner" status={status('ownerId')} hint={ws.isAdmin ? 'The owner and admins can change the path’s courses, settings and lifecycle. Other instructors can view it and enroll people.' : 'Only admins can change the owner.'}>
            <StaffPicker
              allowNone
              noneLabel="Nobody — admins manage it"
              value={p.ownerId}
              onChange={v => save('ownerId', { ownerId: v })}
              trigger={
                <button type="button" disabled={!ws.isAdmin} className="flex h-9 w-full max-w-[360px] items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-[14px] shadow-2xs hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60">
                  {owner && <PersonAvatar person={owner} size={20} />}
                  <span className={cn('flex-1 truncate', !owner && 'text-muted-foreground')}>{owner?.name ?? 'Nobody — admins manage it'}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              }
            />
          </Field>
        </div>
      </SettingsSection>
    </div>
  );
}

function Danger({ detail, onPublish }: { detail: PathDetail; onPublish: () => void }) {
  const ws = useWorkspace();
  const life = usePathLifecycle();
  const listed = ws.pathById.get(detail.path.id);
  const p = listed ?? { ...detail.path, courseIds: detail.courses.map(c => c.courseId), counts: { ...detail.counts } };
  const ro = !detail.canEdit;
  const everyone = detail.counts.enrolled + detail.counts.withdrawn;
  return (
    <div>
      <PageTitle title="Danger zone" description="Changes that affect whether people can find, join or keep working through this path." />
      <SettingsSection title="Lifecycle">
        <SettingsCard>
          {p.status === 'Draft' && (
            <SettingsRow label="Publish" description="Put the path in the catalog (or make it assignable, if it’s private). Every course in it must be published.">
              <button type="button" disabled={ro} className={buttonClass} onClick={onPublish}>
                <Sparkles /> Review and publish…
              </button>
            </SettingsRow>
          )}
          {p.status === 'Published' && (
            <SettingsRow label="Unpublish" description="Back to draft: it leaves the catalog and nobody new can enroll. People already on it keep going.">
              <button type="button" disabled={ro} className={buttonClass} onClick={() => life.unpublish(p)}>
                <Undo2 /> Unpublish…
              </button>
            </SettingsRow>
          )}
          {p.status === 'Archived' ? (
            <SettingsRow label="Unarchive" description={p.publishedAt ? 'Bring it back published, as long as all its courses are published.' : 'Bring it back as a draft.'}>
              <button type="button" disabled={ro} className={buttonClass} onClick={() => life.unarchive(p)}>
                <ArchiveRestore /> Unarchive
              </button>
            </SettingsRow>
          ) : (
            <SettingsRow label="Archive" description="Hide it from the catalog and lists and stop new enrollments. Progress, certificates and history are kept.">
              <button type="button" disabled={ro} className={buttonClass} onClick={() => life.archive(p)}>
                <Archive /> Archive…
              </button>
            </SettingsRow>
          )}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Delete">
        <div className="overflow-hidden rounded-lg border border-tone-danger/30 bg-background">
          <SettingsRow label="Delete this path" description={everyone > 0 ? `${plural(everyone, 'person has', 'people have')} enrolled, so it can’t be deleted without erasing training records. Archive it instead.` : 'Permanently delete the path and its course list. The courses themselves aren’t affected.'}>
            <button type="button" disabled={ro || everyone > 0} onClick={() => life.remove(p)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-destructive px-3 text-[14px] font-medium text-destructive-foreground shadow-xs hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5">
              <Trash2 /> Delete path…
            </button>
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  );
}
