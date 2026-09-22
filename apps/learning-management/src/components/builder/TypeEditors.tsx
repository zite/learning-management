import { isPast, parseISO } from 'date-fns';
import { CalendarClock, CalendarPlus, ExternalLink, FileText, Info, Link2, Lock, MapPin, Trash2, Users, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@project/components/ui/button';
import { Slider } from '@project/components/ui/slider';
import { cn } from '@project/components/lib/utils';
import { canTrackWatchProgress, fileKind, parseAssignmentSettings, parseEmbedSettings, parseVideoSettings, videoSource } from '@project/shared/lessons';
import { EmbedFrame, FileLesson, VideoEmbed } from '@project/shared/ui/LessonMedia';
import { dateTime } from '../../lib/format';
import type { CourseDetail, CourseLesson } from '../../lib/types';
import { IconButton, Tip } from '../primitives/bits';
import { DropZone, UploadButton, UrlField } from './fields';
import { MarkdownField } from './MarkdownField';
import type { LessonPatch } from './model';
import { AutoTextarea, Field, inputClass, NumberField, Panel, Segmented, textareaClass, ToggleRow } from './ui';

export type EditorProps = {
  lesson: CourseLesson;
  detail: CourseDetail;
  readOnly: boolean;
  onChange: (patch: LessonPatch, opts?: { immediate?: boolean }) => void;
  /** Settings edits read the latest settings, so two quick changes never overwrite each other. */
  onSettings: (update: (current: Record<string, unknown>) => Record<string, unknown>, opts?: { immediate?: boolean }) => void;
};

export function ArticleEditor({ lesson, readOnly, onChange }: EditorProps) {
  return (
    <MarkdownField
      id="lesson-body"
      variant="article"
      value={lesson.body}
      readOnly={readOnly}
      minRows={14}
      onChange={body => onChange({ body })}
      placeholder={'Start writing…\n\nUse the toolbar or type Markdown: ## for a heading, - for a list, **bold**, > for a callout. Paste or drop images anywhere.'}
      emptyPreview="This article is empty."
    />
  );
}

const SOURCE_LABEL: Record<string, string> = { youtube: 'YouTube', vimeo: 'Vimeo', loom: 'Loom', wistia: 'Wistia', file: 'Video file', link: 'Link' };

export function VideoEditor({ lesson, readOnly, onChange, onSettings }: EditorProps) {
  const settings = parseVideoSettings(lesson.settings);
  const source = videoSource(lesson.mediaUrl);
  const gated = settings.requiredWatchShare > 0;
  const hosted = source && source.kind !== 'file';
  return (
    <div className="space-y-5">
      <Panel icon={<Video />} title="Video" description="Paste a link from YouTube, Vimeo, Loom or Wistia, or upload a video file.">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <UrlField
            id="lesson-video-url"
            ariaLabel="Video link"
            value={lesson.mediaUrl}
            readOnly={readOnly}
            placeholder="https://www.youtube.com/watch?v=…"
            onCommit={url => onChange({ mediaUrl: url, mediaName: null })}
          />
          {!readOnly && (
            <UploadButton accept="video/mp4,video/webm,video/quicktime,video/*" maxMb={500} onUploaded={f => onChange({ mediaUrl: f.url, mediaName: f.name }, { immediate: true })}>
              Upload video
            </UploadButton>
          )}
        </div>
        {lesson.mediaUrl && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {source ? (
              source.kind === 'link' ? (
                <span className="text-tone-warning">This link can’t be embedded, so learners get a button that opens it in a new tab.</span>
              ) : (
                <>
                  <span className="chip-soft">{SOURCE_LABEL[source.kind]}</span>
                  {lesson.mediaName && <span className="truncate">{lesson.mediaName}</span>}
                </>
              )
            ) : (
              <span className="text-tone-danger">That isn’t a video link the player recognises.</span>
            )}
          </p>
        )}
        <VideoEmbed url={lesson.mediaUrl} title={lesson.title} />
      </Panel>

      <Panel title="Completion" description="When learners can mark this lesson complete.">
        <ToggleRow
          id="lesson-watch-gate"
          label="Learners must watch before completing"
          description={gated ? `The Complete button unlocks after ${Math.round(settings.requiredWatchShare * 100)}% of the video has played.` : 'Learners can mark the lesson complete whenever they’re ready.'}
          checked={gated}
          disabled={readOnly}
          onChange={on => onSettings(s => ({ ...s, requiredWatchShare: on ? 0.8 : 0 }), { immediate: true })}
        />
        {gated && (
          <div className="flex items-center gap-4 pl-0.5">
            <Slider
              aria-label="Share of the video learners must watch"
              min={10}
              max={100}
              step={5}
              disabled={readOnly}
              value={[Math.round(settings.requiredWatchShare * 100)]}
              onValueChange={([v]) => onSettings(s => ({ ...s, requiredWatchShare: v / 100 }))}
              className="flex-1"
            />
            <span className="w-11 text-right text-[14px] font-medium tabular-nums">{Math.round(settings.requiredWatchShare * 100)}%</span>
          </div>
        )}
        {gated && hosted && !canTrackWatchProgress(lesson.mediaUrl) && (
          <p className="flex gap-2 rounded-lg bg-tone-warning/[0.08] px-3 py-2 text-sm leading-relaxed text-foreground/85">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-warning" />
            {source!.kind === 'link' ? 'Learners open this link in a new tab, so there’s no way to tell how much they watched' : `${SOURCE_LABEL[source!.kind]} players don’t report how much was watched`}, so learners can complete this lesson whenever they’re ready. Watch tracking works for YouTube, Vimeo and uploaded videos.
          </p>
        )}
      </Panel>

      <MarkdownField
        id="lesson-body"
        label="Notes under the video"
        value={lesson.body}
        readOnly={readOnly}
        onChange={body => onChange({ body })}
        placeholder="Key points, a transcript summary or links to go further."
        emptyPreview="No notes."
      />
    </div>
  );
}

export function FileEditor({ lesson, readOnly, onChange }: EditorProps) {
  const kind = fileKind(lesson.mediaName || lesson.mediaUrl);
  return (
    <div className="space-y-5">
      <Panel icon={<FileText />} title="File" description="A PDF, slide deck, spreadsheet or document. PDFs and images open right in the lesson.">
        {!lesson.mediaUrl && !readOnly ? (
          <DropZone accept="*/*" maxMb={200} title="Drop a file here, or choose one" hint="PDF, PowerPoint, Word, Excel, images — up to 200 MB" onUploaded={f => onChange({ mediaUrl: f.url, mediaName: f.name }, { immediate: true })} />
        ) : lesson.mediaUrl ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Field label="Name learners see" htmlFor="lesson-file-name" className="min-w-0 flex-1">
              <input
                id="lesson-file-name"
                className={inputClass}
                value={lesson.mediaName ?? ''}
                readOnly={readOnly}
                maxLength={300}
                placeholder={decodeURIComponent(lesson.mediaUrl.split('/').pop()?.split('?')[0] ?? 'Document')}
                onChange={e => onChange({ mediaName: e.target.value })}
              />
            </Field>
            {!readOnly && (
              <div className="flex items-center gap-1.5 sm:self-end">
                <UploadButton accept="*/*" onUploaded={f => onChange({ mediaUrl: f.url, mediaName: f.name }, { immediate: true })}>
                  Replace
                </UploadButton>
                <Tip label="Remove the file">
                  <IconButton aria-label="Remove the file" className="h-8 w-8" onClick={() => onChange({ mediaUrl: null, mediaName: null }, { immediate: true })}>
                    <Trash2 />
                  </IconButton>
                </Tip>
              </div>
            )}
          </div>
        ) : null}
        <Field label={lesson.mediaUrl ? 'Link' : 'Or link to a file'} htmlFor="lesson-file-url" hint={kind === 'other' && lesson.mediaUrl ? 'Learners get Open and Download buttons for this kind of file.' : undefined}>
          <div className="flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <UrlField id="lesson-file-url" ariaLabel="File link" value={lesson.mediaUrl} readOnly={readOnly} placeholder="https://drive.example.com/handbook.pdf" onCommit={url => onChange({ mediaUrl: url })} />
          </div>
        </Field>
        {lesson.mediaUrl && <FileLesson url={lesson.mediaUrl} name={lesson.mediaName} />}
      </Panel>
      <MarkdownField
        id="lesson-body"
        label="Notes"
        value={lesson.body}
        readOnly={readOnly}
        onChange={body => onChange({ body })}
        placeholder="What to look for in the document, or which pages matter most."
        emptyPreview="No notes."
      />
    </div>
  );
}

export function EmbedEditor({ lesson, readOnly, onChange, onSettings }: EditorProps) {
  const settings = parseEmbedSettings(lesson.settings);
  return (
    <div className="space-y-5">
      <Panel icon={<ExternalLink />} title="Page to embed" description="Any secure page that allows embedding — a prototype, a form, a simulation or an interactive demo.">
        <UrlField id="lesson-embed-url" ariaLabel="Page address" requireHttps value={lesson.mediaUrl} readOnly={readOnly} placeholder="https://" onCommit={url => onChange({ mediaUrl: url })} />
        <Field label="Height" htmlFor="lesson-embed-height">
          <div className="flex items-center gap-3">
            <Slider aria-label="Embed height" min={240} max={1600} step={20} disabled={readOnly} value={[settings.height]} onValueChange={([v]) => onSettings(s => ({ ...s, height: v }))} className="flex-1" />
            <NumberField id="lesson-embed-height" ariaLabel="Height in pixels" value={settings.height} min={240} max={1600} suffix="px" disabled={readOnly} className="w-24" onChange={v => v != null && onSettings(s => ({ ...s, height: v }))} />
          </div>
        </Field>
        <EmbedFrame url={lesson.mediaUrl} height={Math.min(settings.height, 720)} title={lesson.title} />
        {settings.height > 720 && <p className="text-sm text-muted-foreground">Shown at 720px here; learners see the full {settings.height}px.</p>}
      </Panel>
      <MarkdownField
        id="lesson-body"
        label="Instructions"
        value={lesson.body}
        readOnly={readOnly}
        onChange={body => onChange({ body })}
        placeholder="Tell learners what to do on the page and what to look for."
        emptyPreview="No instructions."
      />
    </div>
  );
}

export function AssignmentEditor({ lesson, readOnly, onChange, onSettings }: EditorProps) {
  const settings = parseAssignmentSettings(lesson.settings);
  return (
    <div className="space-y-5">
      <MarkdownField
        id="lesson-body"
        variant="article"
        label="Instructions"
        value={lesson.body}
        readOnly={readOnly}
        minRows={8}
        onChange={body => onChange({ body })}
        placeholder={'What should learners do, and what does a great submission look like?\n\nBe specific about length, format and what graders look for.'}
        emptyPreview="No instructions yet."
      />
      <Panel title="Submission and grading">
        <Field label="What learners submit">
          <Segmented
            value={settings.submissionType}
            disabled={readOnly}
            onChange={v => onSettings(s => ({ ...s, submissionType: v }), { immediate: true })}
            ariaLabel="What learners submit"
            options={[
              { value: 'text', label: 'Written response' },
              { value: 'file', label: 'File upload' },
              { value: 'text_and_file', label: 'Both' },
            ]}
            className="max-w-full overflow-x-auto scrollbar-none"
          />
        </Field>
        <Field label="Passing grade" htmlFor="lesson-passing-grade" hint="Graders give each submission a grade from 0 to 100. At or above this, it passes and the lesson is complete.">
          <div className="flex items-center gap-3">
            <Slider aria-label="Passing grade" min={0} max={100} step={5} disabled={readOnly} value={[settings.passingGrade]} onValueChange={([v]) => onSettings(s => ({ ...s, passingGrade: v }))} className="flex-1" />
            <NumberField id="lesson-passing-grade" ariaLabel="Passing grade" value={settings.passingGrade} min={0} max={100} suffix="%" disabled={readOnly} className="w-20" onChange={v => v != null && onSettings(s => ({ ...s, passingGrade: v }))} />
          </div>
        </Field>
      </Panel>
      <Panel icon={<Lock />} title="Grading rubric" description="Only instructors and admins see this, next to each submission they grade.">
        <AutoTextarea
          id="lesson-rubric"
          aria-label="Grading rubric"
          value={settings.rubric}
          readOnly={readOnly}
          minRows={4}
          maxLength={10000}
          placeholder={'Pass: covers all three steps and names a real example.\nNeeds revision: misses the escalation step.'}
          className={textareaClass}
          onChange={e => {
            const rubric = e.target.value;
            onSettings(s => ({ ...s, rubric }));
          }}
        />
      </Panel>
    </div>
  );
}

export function LiveSessionEditor({ lesson, detail, readOnly, onChange, onSchedule }: EditorProps & { onSchedule: () => void }) {
  const linked = detail.sessions.filter(s => s.lessonId === lesson.id);
  const unlinked = detail.sessions.filter(s => !s.lessonId);
  const upcoming = linked.filter(s => s.status !== 'Cancelled' && !(s.endsAt ? isPast(parseISO(s.endsAt)) : s.startsAt ? isPast(parseISO(s.startsAt)) : false));
  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-xl border bg-tone-info/[0.05] px-4 py-3 text-[14px] leading-relaxed">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-tone-info" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">How learners complete this lesson</p>
          <p className="text-muted-foreground">
            Learners register for one of the sessions below. When an instructor marks them <span className="font-medium text-foreground">Attended</span>, the lesson is complete.
            {linked.length === 0 && ' Until a session is scheduled, learners can mark this lesson complete themselves.'}
          </p>
        </div>
      </div>

      <Panel
        icon={<CalendarClock />}
        title="Sessions"
        description={linked.length ? `${linked.length} linked · ${upcoming.length} upcoming` : 'No sessions are linked to this lesson yet.'}
        action={
          !readOnly && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[13.5px]" onClick={onSchedule}>
              <CalendarPlus className="!h-3.5 !w-3.5" /> Schedule a session
            </Button>
          )
        }
      >
        {linked.length ? (
          <ul className="-my-1 divide-y">
            {linked.map(s => {
              const ended = s.status !== 'Cancelled' && (s.endsAt ? isPast(parseISO(s.endsAt)) : s.startsAt ? isPast(parseISO(s.startsAt)) : false);
              const full = s.capacity != null && s.registered >= s.capacity;
              return (
                <li key={s.id}>
                  <Link to={`/sessions/${s.id}`} className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent">
                    <span className={cn('flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg border bg-background text-center leading-none', s.status === 'Cancelled' && 'opacity-60')}>
                      <span className="text-[10px] font-medium uppercase text-muted-foreground">{s.startsAt ? parseISO(s.startsAt).toLocaleString(undefined, { month: 'short' }) : '—'}</span>
                      <span className="mt-0.5 text-[14px] font-semibold tabular-nums">{s.startsAt ? parseISO(s.startsAt).getDate() : ''}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[14px] font-medium', s.status === 'Cancelled' && 'text-muted-foreground line-through')}>{s.title || lesson.title || 'Session'}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                        <span>{s.startsAt ? dateTime(s.startsAt) : 'No date yet'}</span>
                        {(s.location || s.meetingUrl) && (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{s.location || 'Online'}</span>
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={cn('chip-soft', s.status === 'Cancelled' ? 'text-tone-danger' : ended ? 'text-muted-foreground' : 'text-tone-success')}>{s.status === 'Cancelled' ? 'Cancelled' : ended ? 'Ended' : 'Upcoming'}</span>
                      <span className={cn('inline-flex items-center gap-1 text-2xs tabular-nums', full ? 'text-tone-warning' : 'text-muted-foreground')}>
                        <Users className="h-3 w-3" />
                        {s.registered}
                        {s.capacity != null ? ` / ${s.capacity}` : ''} registered
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center">
            <p className="text-[14px] font-medium">Nothing scheduled</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Schedule a session for this lesson so learners can register. You can add several dates for different shifts or locations.</p>
          </div>
        )}
        {unlinked.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {unlinked.length === 1 ? '1 other session of this course isn’t' : `${unlinked.length} other sessions of this course aren’t`} linked to a lesson.{' '}
            <Link to={`/sessions/${unlinked[0].id}`} className="font-medium text-foreground underline-offset-2 hover:underline">
              Open {unlinked.length === 1 ? 'it' : 'the first'}
            </Link>{' '}
            to link it here.
          </p>
        )}
      </Panel>

      <MarkdownField
        id="lesson-body"
        label="Details for learners"
        value={lesson.body}
        readOnly={readOnly}
        onChange={body => onChange({ body })}
        placeholder="What the session covers, how to prepare and what to bring."
        emptyPreview="No details."
      />
    </div>
  );
}
