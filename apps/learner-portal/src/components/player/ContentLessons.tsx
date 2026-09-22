import { useQueryClient } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { trackLesson } from 'zitejs/api';
import { EmbedFrame, FileLesson, VideoEmbed } from '@project/shared/ui/LessonMedia';
import { Markdown } from '@project/shared/ui/Markdown';
import { ProgressBar } from '../ui';
import type { LessonControls } from './LessonView';
import { playerKeys, type LessonData } from './queries';

/** Reading type, a little larger on a wide screen: this is where people actually read. */
const READING = 'prose-lms max-w-[68ch] sm:text-[17px] sm:leading-[1.75]';

export function ArticleLesson({ controls }: { controls: LessonControls }) {
  const { body } = controls.data.lesson;
  if (!body.trim()) return <p className="text-muted-foreground">This lesson has no written content yet.</p>;
  return <Markdown className={READING}>{body}</Markdown>;
}

export function VideoLesson({ controls }: { controls: LessonControls }) {
  const { data, slug, setGate } = controls;
  const qc = useQueryClient();
  const need = data.video?.requiredWatchShare ?? 0;
  const [watched, setWatched] = useState(data.video?.watched ?? 0);
  const saved = useRef(data.video?.watched ?? 0);
  const lastSent = useRef(0);
  const completed = data.state === 'completed';

  const save = useCallback(
    (share: number) => {
      saved.current = share;
      lastSent.current = Date.now();
      trackLesson({ lessonId: data.lesson.id, courseSlug: slug, state: { watched: Math.min(1, share) } })
        .then(() => qc.setQueryData<LessonData>(playerKeys.lesson(slug, data.lesson.id), prev => (prev?.video ? { ...prev, video: { ...prev.video, watched: Math.max(prev.video.watched, share) } } : prev)))
        .catch(() => undefined);
    },
    [data.lesson.id, slug, qc],
  );

  const onProgress = useCallback(
    (share: number) => {
      setWatched(w => Math.max(w, share));
      // Save at meaningful moments: crossing the requirement, or every 15 seconds of new progress.
      const crossed = need > 0 && share >= need && saved.current < need;
      if (share > saved.current + 0.01 && (crossed || share >= 0.99 || Date.now() - lastSent.current > 15_000)) save(share);
    },
    [need, save],
  );

  useEffect(() => {
    const ready = need <= 0 || watched + 0.005 >= need;
    setGate({ ready, hint: ready ? null : `Watch at least ${Math.round(need * 100)}% of the video to continue` });
  }, [need, watched, setGate]);

  // Whatever was watched but not yet saved goes up when the learner leaves.
  const watchedRef = useRef(watched);
  watchedRef.current = watched;
  useEffect(
    () => () => {
      if (watchedRef.current > saved.current + 0.005) save(watchedRef.current);
    },
    [save],
  );

  return (
    <div>
      <VideoEmbed url={data.lesson.mediaUrl} title={data.lesson.title} onProgress={onProgress} className="shadow-md" />
      {need > 0 && !completed && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border bg-card px-4 py-3" aria-live="polite">
          <Eye className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm">{watched + 0.005 >= need ? 'You’ve watched enough to continue.' : `Watch at least ${Math.round(need * 100)}% to continue`}</p>
            <ProgressBar value={Math.min(1, watched / need)} className="mt-1.5 h-1.5" label="Required viewing" tone={watched + 0.005 >= need ? 'success' : 'primary'} />
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">{Math.round(watched * 100)}%</span>
        </div>
      )}
      {data.lesson.body.trim() && (
        <div className="mt-9">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Notes</h2>
          <Markdown className={READING}>{data.lesson.body}</Markdown>
        </div>
      )}
    </div>
  );
}

export function FileLessonView({ controls }: { controls: LessonControls }) {
  const { data, slug, setGate } = controls;
  const qc = useQueryClient();
  const [opened, setOpened] = useState(Boolean(data.file?.opened) || data.state === 'completed');
  const sent = useRef(opened);

  const onOpen = useCallback(() => {
    setOpened(true);
    if (sent.current) return;
    sent.current = true;
    trackLesson({ lessonId: data.lesson.id, courseSlug: slug, state: { opened: true } })
      .then(() => qc.setQueryData<LessonData>(playerKeys.lesson(slug, data.lesson.id), prev => (prev ? { ...prev, file: { opened: true } } : prev)))
      .catch(() => {
        sent.current = false;
      });
  }, [data.lesson.id, slug, qc]);

  useEffect(() => {
    setGate(opened ? { ready: true, hint: null } : { ready: false, hint: 'Open or download the file to continue' });
  }, [opened, setGate]);

  return (
    <div>
      {data.lesson.body.trim() && <Markdown className={`${READING} mb-7`}>{data.lesson.body}</Markdown>}
      <FileLesson url={data.lesson.mediaUrl} name={data.lesson.mediaName} onOpen={onOpen} className="shadow-sm" />
    </div>
  );
}

export function EmbedLesson({ controls }: { controls: LessonControls }) {
  const { data } = controls;
  return (
    <div>
      {data.lesson.body.trim() && <Markdown className={`${READING} mb-7`}>{data.lesson.body}</Markdown>}
      <EmbedFrame url={data.lesson.mediaUrl} height={data.embed?.height ?? 640} title={data.lesson.title} className="shadow-sm" />
    </div>
  );
}
