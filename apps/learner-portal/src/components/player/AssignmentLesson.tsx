import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, FileText, Loader2, Paperclip, RotateCcw, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { submitAssignment } from 'zitejs/api';
import { uploadFile } from 'zitejs/upload';
import { cn } from '@project/components/lib/utils';
import { fileSize, Markdown } from '@project/shared/ui/Markdown';
import { errorMessage } from '../../lib/errors';
import { shortDateTime, timeAgo } from '../../lib/format';
import { MOD } from '../../lib/hotkeys';
import { Button, StatusPill, textareaClass, type Tone } from '../ui';
import { ConfirmDialog, Kbd } from './bits';
import type { LessonControls } from './LessonView';
import { playerKeys, refreshProgressEverywhere, type AssignmentData } from './queries';

/**
 * An assignment: the brief, everything handed in so far with the instructor's
 * feedback, and — when it's the learner's turn — a composer that keeps a
 * draft on this device until it's submitted.
 */

type UploadItem = { key: string; name: string; size: number; type: string; url: string | null; status: 'uploading' | 'done' | 'error'; error?: string };
type Draft = { body: string; files: Array<{ name: string; size: number; type: string; url: string }> };

const MAX_FILES = 10;
const MAX_BYTES = 50 * 1024 * 1024;

const STATUS: Record<string, { label: string; tone: Tone }> = {
  Submitted: { label: 'Waiting for review', tone: 'info' },
  'Needs revision': { label: 'Needs revision', tone: 'warning' },
  Passed: { label: 'Passed', tone: 'success' },
};

const readDraft = (key: string): Draft | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
};

export function AssignmentLesson({ controls }: { controls: LessonControls }) {
  const { data, setPrimary, setGate } = controls;
  const a = data.assignment!;
  const waiting = a.submissions.find(s => s.status === 'Submitted');
  const passed = a.submissions.find(s => s.status === 'Passed');
  const latest = a.submissions[0];

  useEffect(() => {
    setGate({
      ready: false,
      hint: passed || data.state === 'completed' ? null : waiting ? 'Your submission is waiting for review' : latest?.status === 'Needs revision' ? 'Revise and resubmit to complete this lesson' : 'Completes when your submission is graded as passed',
    });
  }, [passed, waiting, latest?.status, data.state, setGate]);

  return (
    <div className="space-y-8">
      <section aria-labelledby="brief-heading">
        <h2 id="brief-heading" className="sr-only">
          Instructions
        </h2>
        {data.lesson.body.trim() ? <Markdown className="prose-lms max-w-[68ch] sm:text-[17px]">{data.lesson.body}</Markdown> : null}
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{a.submissionType === 'text' ? 'Written answer' : a.submissionType === 'file' ? 'File upload' : 'Written answer and a file'}</span>
          <span aria-hidden>·</span>
          <span>Pass mark {a.passingGrade}/100</span>
          <span aria-hidden>·</span>
          <span>Graded by your instructor</span>
        </p>
      </section>

      {latest && <LatestStatus submission={latest} completed={data.state === 'completed'} />}

      {a.canSubmit && <Composer key={a.submissions.length} controls={controls} assignment={a} setPrimary={setPrimary} />}

      {a.submissions.length > 0 && (
        <section aria-labelledby="submissions-heading">
          <h2 id="submissions-heading" className="mb-2 text-sm font-medium text-muted-foreground">
            {a.submissions.length === 1 ? 'Your submission' : `Your submissions · ${a.submissions.length}`}
          </h2>
          <ol className="space-y-3">
            {a.submissions.map((s, i) => (
              <li key={s.id}>
                <SubmissionCard submission={s} meta={STATUS[s.status] ?? STATUS.Submitted} defaultOpen={i === 0 && s.status === 'Submitted'} showFeedback={i > 0} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/** Where the latest submission stands, with the instructor's feedback where the learner will read it — above the composer, not below. */
function LatestStatus({ submission: s, completed }: { submission: AssignmentData['submissions'][number]; completed: boolean }) {
  if (s.status === 'Submitted') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border bg-card px-5 py-4 shadow-xs" role="status">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 text-[15px]">
          <p className="font-medium">Waiting for review</p>
          <p className="mt-0.5 text-muted-foreground">
            You submitted {s.attempt > 1 ? `attempt ${s.attempt} ` : ''}
            {timeAgo(s.submittedAt)}. You’ll get a notification when it’s graded — keep going with the course meanwhile.
          </p>
        </div>
      </div>
    );
  }
  const revision = s.status === 'Needs revision';
  return (
    <section aria-label={revision ? 'Your instructor asked for changes' : 'Your grade'} className={cn('rounded-2xl border bg-card shadow-xs', revision ? 'border-tone-warning/35' : 'border-tone-success/30')}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-1 pt-4">
        <p className={cn('min-w-0 flex-1 text-[15px] font-medium', revision ? 'text-tone-warning' : 'text-tone-success')}>{revision ? 'Needs revision' : completed ? 'Passed — this lesson is complete' : 'Passed'}</p>
        {s.grade != null && <span className="text-[15px] font-semibold tabular-nums">{s.grade}/100</span>}
      </header>
      <div className="px-5 pb-4">
        <p className="text-sm text-muted-foreground">
          Attempt {s.attempt}
          {s.gradedByName ? ` · graded by ${s.gradedByName}` : ''}
          {s.gradedAt ? ` ${timeAgo(s.gradedAt)}` : ''}
        </p>
        {s.feedback.trim() ? (
          <Markdown compact className="mt-2 max-w-[68ch] text-[15px] leading-relaxed">
            {s.feedback}
          </Markdown>
        ) : (
          <p className="mt-2 text-[15px] text-muted-foreground">{revision ? 'Revise your work below and submit it again.' : 'No written feedback.'}</p>
        )}
      </div>
    </section>
  );
}

function SubmissionCard({ submission: s, meta, defaultOpen, showFeedback }: { submission: AssignmentData['submissions'][number]; meta: { label: string; tone: Tone }; defaultOpen: boolean; showFeedback: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <article className="rounded-xl border bg-card shadow-xs">
      <header className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-4 py-3">
        <p className="min-w-0 text-[15px] font-medium">
          Attempt {s.attempt}
          <span className="block truncate text-sm font-normal text-muted-foreground">Submitted {s.submittedAt ? shortDateTime(s.submittedAt) : ''}</span>
        </p>
        <span className="text-sm font-semibold tabular-nums">{s.grade != null && s.status !== 'Submitted' ? `${s.grade}/100` : ''}</span>
        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
      </header>
      {showFeedback && (s.feedback.trim() || s.status === 'Needs revision') && s.status !== 'Submitted' && (
        <div className={cn('mx-4 mb-3 rounded-lg px-4 py-3 text-[15px]', s.status === 'Passed' ? 'bg-tone-success/[0.06]' : 'bg-tone-warning/[0.07]')}>
          <p className="text-xs font-medium text-muted-foreground">
            Feedback{s.gradedByName ? ` from ${s.gradedByName}` : ''}
            {s.gradedAt ? ` · ${timeAgo(s.gradedAt)}` : ''}
          </p>
          {s.feedback.trim() ? <Markdown compact className="mt-1 leading-relaxed">{s.feedback}</Markdown> : <p className="mt-1 text-muted-foreground">Revise your work and submit it again.</p>}
        </div>
      )}
      <div className="border-t px-4 py-2">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="min-h-9 text-sm font-medium text-muted-foreground hover:text-foreground">
          {open ? 'Hide what you submitted' : 'Show what you submitted'}
        </button>
        {open && (
          <div className="pb-2 pt-1 animate-fade-in">
            {s.body.trim() && <Markdown className="prose-lms text-[15px]">{s.body}</Markdown>}
            {s.files.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {s.files.map((f, i) => (
                  <li key={i}>
                    <a href={f.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-[16rem] items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm hover:bg-accent">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{fileSize(f.size)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Composer({ controls, assignment: a, setPrimary }: { controls: LessonControls; assignment: AssignmentData; setPrimary: LessonControls['setPrimary'] }) {
  const { data, slug } = controls;
  const qc = useQueryClient();
  const draftKey = `lms:assignment:${data.lesson.id}`;
  const revision = a.submissions[0]?.status === 'Needs revision';
  const [initial] = useState(() => readDraft(draftKey));
  // Revising starts from what was handed in last time, not a blank page (a draft on this device wins).
  const [start] = useState<Draft>(() => initial ?? (revision ? { body: a.submissions[0].body, files: a.submissions[0].files } : { body: '', files: [] }));
  const prefilled = !initial && revision && Boolean(start.body.trim() || start.files.length);
  const [body, setBody] = useState(start.body);
  const [files, setFiles] = useState<UploadItem[]>(() => start.files.map((f, i) => ({ ...f, key: `d${i}`, status: 'done' as const })));
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState<number | null>(initial ? Date.now() : null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyId = useId();
  const needsText = a.submissionType !== 'file';
  const needsFile = a.submissionType !== 'text';
  const uploading = files.some(f => f.status === 'uploading');
  const doneFiles = files.filter(f => f.status === 'done' && f.url);
  const unchanged = body === start.body && doneFiles.length === start.files.length && doneFiles.every((f, i) => f.url === start.files[i]?.url);

  // Drafts stay on this device until submitted — but only once the learner has actually changed something.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        if (unchanged && !initial) return;
        if (!body.trim() && !doneFiles.length) localStorage.removeItem(draftKey);
        else {
          const draft: Draft = { body, files: doneFiles.map(f => ({ name: f.name, size: f.size, type: f.type, url: f.url! })) };
          localStorage.setItem(draftKey, JSON.stringify(draft));
          setDraftSaved(Date.now());
        }
      } catch {
        /* storage blocked */
      }
    }, 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, files, draftKey]);

  useEffect(() => {
    if (initial) toast('We restored your draft from this device.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const room = MAX_FILES - files.length;
    const picked = Array.from(list).slice(0, Math.max(0, room));
    if (list.length > room) toast.error(`You can attach up to ${MAX_FILES} files.`);
    for (const file of picked) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
      if (file.size > MAX_BYTES) {
        setFiles(prev => [...prev, { key, name: file.name, size: file.size, type: file.type, url: null, status: 'error', error: 'Larger than 50 MB' }]);
        continue;
      }
      setFiles(prev => [...prev, { key, name: file.name, size: file.size, type: file.type, url: null, status: 'uploading' }]);
      uploadFile({ data: file, filename: file.name })
        .then(({ fileUrl }) => {
          if (!fileUrl) throw new Error('The upload service did not return a link');
          setFiles(prev => prev.map(f => (f.key === key ? { ...f, url: fileUrl, status: 'done' } : f)));
        })
        .catch(e => setFiles(prev => prev.map(f => (f.key === key ? { ...f, status: 'error', error: errorMessage(e, 'Upload failed') } : f))));
    }
    setProblem(null);
  };

  const validate = () => {
    if (uploading) return 'Wait for your files to finish uploading.';
    if (needsText && !body.trim()) return 'Write your answer before submitting.';
    if (needsFile && !doneFiles.length) return 'Attach at least one file before submitting.';
    if (files.some(f => f.status === 'error')) return 'Remove the files that didn’t upload before submitting.';
    if (prefilled && unchanged) return 'This is the same as your last submission. Make the changes your instructor asked for, then resubmit.';
    return null;
  };

  const mutation = useMutation({
    mutationFn: () => submitAssignment({ lessonId: data.lesson.id, courseSlug: slug, body: needsText ? body : '', files: needsFile ? doneFiles.map(f => ({ name: f.name, url: f.url!, size: f.size, type: f.type })) : [] }),
    onSuccess: () => {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      setConfirmOpen(false);
      toast.success('Submitted. Your instructor has been notified.');
      refreshProgressEverywhere(qc, slug);
      void qc.invalidateQueries({ queryKey: playerKeys.lesson(slug, data.lesson.id) });
    },
    onError: e => {
      setConfirmOpen(false);
      toast.error(errorMessage(e, "Your submission didn't go through. Your draft is safe — try again."));
    },
  });

  const requestSubmit = () => {
    const p = validate();
    setProblem(p);
    if (p) return;
    setConfirmOpen(true);
  };
  const requestRef = useRef(requestSubmit);
  requestRef.current = requestSubmit;
  useEffect(() => {
    setPrimary(() => requestRef.current());
    return () => setPrimary(null);
  }, [setPrimary]);

  return (
    <section aria-labelledby="composer-heading" className="rounded-2xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
        <div className="min-w-0">
          <h2 id="composer-heading" className="text-[16px] font-semibold">
            {revision ? 'Revise and resubmit' : 'Your submission'}
          </h2>
          {prefilled && <p className="text-sm text-muted-foreground">Your last submission is filled in. Edit it, then resubmit.</p>}
        </div>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {draftSaved ? 'Draft saved on this device' : ''}
        </span>
      </header>

      <div className="space-y-5 px-5 py-5">
        {needsText && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <label htmlFor={bodyId} className="text-[15px] font-medium">
                Your answer
              </label>
              <div role="tablist" aria-label="Editor mode" className="inline-flex rounded-lg bg-muted p-0.5">
                {(['write', 'preview'] as const).map(t => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('h-8 rounded-md px-3 text-sm font-medium capitalize transition-colors', tab === t ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {tab === 'write' ? (
              <textarea
                id={bodyId}
                value={body}
                onChange={e => {
                  setBody(e.target.value);
                  setProblem(null);
                }}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    requestSubmit();
                  }
                }}
                maxLength={20000}
                placeholder="Write your answer. Markdown works: **bold**, - lists, ## headings."
                className={textareaClass('min-h-[220px] text-[16px]')}
                aria-invalid={problem && needsText && !body.trim() ? true : undefined}
              />
            ) : (
              <div className="min-h-[220px] rounded-lg border bg-background px-4 py-3">{body.trim() ? <Markdown className="prose-lms text-[15px]">{body}</Markdown> : <p className="text-muted-foreground">Nothing to preview yet.</p>}</div>
            )}
            <p className="mt-1.5 text-right text-xs tabular-nums text-faint">{body.length.toLocaleString()} / 20,000</p>
          </div>
        )}

        {needsFile && (
          <div>
            <p className="text-[15px] font-medium">Files</p>
            <p className="text-sm text-muted-foreground">Up to {MAX_FILES} files, 50 MB each.</p>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              className="mt-2 flex flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed bg-background px-4 py-6 text-center"
            >
              <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">Drag files here, or</p>
              <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={files.length >= MAX_FILES}>
                Choose files
              </Button>
              <input ref={inputRef} type="file" multiple className="sr-only" tabIndex={-1} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            {files.length > 0 && (
              <ul className="mt-3 space-y-2">
                {files.map(f => (
                  <li key={f.key} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', f.status === 'error' && 'border-tone-danger/30 bg-tone-danger/[0.04]')}>
                    {f.status === 'uploading' ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : <FileText className={cn('h-4 w-4 shrink-0', f.status === 'error' ? 'text-tone-danger' : 'text-muted-foreground')} aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{f.name}</span>
                      <span className={cn('block text-xs', f.status === 'error' ? 'text-tone-danger' : 'text-muted-foreground')}>{f.status === 'uploading' ? 'Uploading…' : f.status === 'error' ? f.error : fileSize(f.size)}</span>
                    </span>
                    <button type="button" onClick={() => setFiles(prev => prev.filter(x => x.key !== f.key))} className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Remove ${f.name}`}>
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {problem && (
          <p role="alert" className="text-sm text-tone-danger">
            {problem}
          </p>
        )}
      </div>

      <footer className="flex flex-col-reverse gap-2 border-t bg-subtle px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Your instructor sees it as soon as you submit.</p>
        <Button size="lg" onClick={requestSubmit} loading={mutation.isPending} disabled={uploading}>
          {revision ? <RotateCcw aria-hidden /> : null}
          {revision ? 'Resubmit' : 'Submit for review'}
          <Kbd className="ml-1 hidden border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground sm:inline-flex">{MOD}↵</Kbd>
        </Button>
      </footer>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={revision ? 'Resubmit your work?' : 'Submit for review?'}
        description="You can’t edit a submission once it’s in. If your instructor asks for changes, you’ll be able to submit again."
        confirmLabel={revision ? 'Resubmit' : 'Submit'}
        pending={mutation.isPending}
        onConfirm={() => mutation.mutate()}
      />
    </section>
  );
}
