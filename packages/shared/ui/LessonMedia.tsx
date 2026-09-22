import { Download, ExternalLink, FileText, FileSpreadsheet, FileImage, Presentation, PlayCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { fileKind, videoSource } from '../lessons';

/**
 * Lesson media, rendered the same in the builder's preview and the learner's
 * player: video (YouTube, Vimeo, Loom, Wistia or a file), a document with an
 * inline PDF viewer, and an embedded page.
 *
 * `onProgress` reports the share of a video watched (0–1) where the source
 * lets us know — native files report continuously; hosted players report
 * "started" as a small share, since cross-origin iframes don't expose time.
 */

export function VideoEmbed({ url, title, className, onProgress }: { url: string | null | undefined; title?: string; className?: string; onProgress?: (share: number) => void }) {
  const src = videoSource(url);
  const videoRef = useRef<HTMLVideoElement>(null);
  const best = useRef(0);
  const report = (share: number) => {
    if (!onProgress || share <= best.current + 0.02) return;
    best.current = share;
    onProgress(share);
  };

  if (!src) {
    return (
      <div className={cn('flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/50 text-sm text-muted-foreground', className)}>
        <PlayCircle className="h-8 w-8 opacity-50" />
        {url ? 'That video link isn’t supported. Use YouTube, Vimeo, Loom, Wistia or a direct .mp4 link.' : 'No video yet'}
      </div>
    );
  }
  if (src.kind === 'file') {
    return (
      <video
        ref={videoRef}
        src={src.src}
        controls
        playsInline
        preload="metadata"
        className={cn('aspect-video w-full rounded-xl bg-black', className)}
        onTimeUpdate={e => {
          const v = e.currentTarget;
          if (v.duration) report(v.currentTime / v.duration);
        }}
        onEnded={() => report(1)}
      >
        <track kind="captions" />
      </video>
    );
  }
  if (src.kind === 'link') {
    return (
      <a href={src.src} target="_blank" rel="noreferrer noopener" onClick={() => report(0.5)} className={cn('flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border bg-muted/40 text-sm hover:bg-muted', className)}>
        <PlayCircle className="h-10 w-10 text-primary" />
        <span className="inline-flex items-center gap-1.5 font-medium">
          Open the video <ExternalLink className="h-3.5 w-3.5" />
        </span>
      </a>
    );
  }
  return <HostedPlayer src={src.src} kind={src.kind} title={title} className={className} onShare={report} />;
}

/**
 * Hosted players live in cross-origin iframes, so progress comes from their
 * postMessage protocols: YouTube's widget API ("listening" → `infoDelivery`
 * with currentTime/duration, enabled by `enablejsapi=1` on the embed URL) and
 * Vimeo's player API (`addEventListener: timeupdate` → seconds/duration).
 * Other hosts (Loom, Wistia) only tell us the learner started playing, which
 * is reported as a small share — so a watch requirement can't gate them.
 */
function HostedPlayer({ src, kind, title, className, onShare }: { src: string; kind: string; title?: string; className?: string; onShare: (share: number) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const report = useRef(onShare);
  report.current = onShare;
  const origin = (() => {
    try {
      return new URL(src).origin;
    } catch {
      return '*';
    }
  })();

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const subscribe = () => {
      const w = frame.contentWindow;
      if (!w) return;
      if (kind === 'youtube') w.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), origin);
      if (kind === 'vimeo') {
        w.postMessage(JSON.stringify({ method: 'addEventListener', value: 'timeupdate' }), origin);
        w.postMessage(JSON.stringify({ method: 'addEventListener', value: 'ended' }), origin);
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      let data: Record<string, unknown> | null = null;
      try {
        data = typeof e.data === 'string' ? JSON.parse(e.data) : (e.data as Record<string, unknown>);
      } catch {
        return;
      }
      if (!data) return;
      if (kind === 'youtube' && data.event === 'infoDelivery') {
        const info = (data.info ?? {}) as { currentTime?: number; duration?: number; playerState?: number };
        if (info.playerState === 0) report.current(1);
        else if (info.currentTime && info.duration) report.current(Math.min(1, info.currentTime / info.duration));
      }
      if (kind === 'vimeo') {
        if (data.event === 'ready') subscribe();
        if (data.event === 'ended') report.current(1);
        const d = (data.data ?? {}) as { seconds?: number; duration?: number };
        if (data.event === 'timeupdate' && d.seconds && d.duration) report.current(Math.min(1, d.seconds / d.duration));
      }
    };
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', subscribe);
    // An iframe steals focus when its player is clicked: the window blurs while the pointer is over it.
    const onBlur = () => {
      if (document.activeElement === frame && kind !== 'youtube' && kind !== 'vimeo') report.current(0.1);
    };
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('message', onMessage);
      frame.removeEventListener('load', subscribe);
      window.removeEventListener('blur', onBlur);
    };
  }, [kind, origin]);

  return (
    <div className={cn('relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-sm', className)}>
      <iframe ref={ref} src={src} title={title ?? 'Video'} className="absolute inset-0 h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
    </div>
  );
}

export { canTrackWatchProgress } from '../lessons';

const FILE_ICONS = { pdf: FileText, image: FileImage, slides: Presentation, doc: FileText, sheet: FileSpreadsheet, video: PlayCircle, other: FileText };

const FILE_KIND_LABEL: Record<ReturnType<typeof fileKind>, string> = { pdf: 'PDF', image: 'Image', slides: 'Slides', doc: 'Document', sheet: 'Spreadsheet', video: 'Video', other: 'File' };

// Seeing a PDF or image inline counts as opening it, the same as clicking Open or Download.
export function FileLesson({ url, name, className, onOpen, inline = true }: { url: string | null | undefined; name?: string | null; className?: string; onOpen?: () => void; inline?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!url) return <div className={cn('rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground', className)}>No file yet</div>;
  const kind = fileKind(name || url);
  const Icon = FILE_ICONS[kind];
  const label = name || decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? 'Document');
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card', className)}>
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label}</span>
          <span className="block text-xs text-muted-foreground">{FILE_KIND_LABEL[kind]}</span>
        </span>
        <a href={url} target="_blank" rel="noreferrer noopener" onClick={onOpen} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-accent">
          <ExternalLink className="h-3.5 w-3.5" /> Open
        </a>
        <a href={url} download onClick={onOpen} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-accent">
          <Download className="h-3.5 w-3.5" /> Download
        </a>
      </div>
      {inline && kind === 'pdf' && !failed && <iframe src={`${url}#view=FitH`} title={label} className="h-[70vh] min-h-[420px] w-full bg-muted" onError={() => setFailed(true)} onLoad={onOpen} />}
      {inline && kind === 'image' && <img src={url} alt={label} className="max-h-[70vh] w-full bg-muted object-contain" onLoad={onOpen} />}
    </div>
  );
}

export function EmbedFrame({ url, height = 640, title, className }: { url: string | null | undefined; height?: number; title?: string; className?: string }) {
  if (!url || !/^https:\/\//.test(url)) return <div className={cn('rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground', className)}>{url ? 'Embedded pages must use https://' : 'No page to embed yet'}</div>;
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card', className)}>
      <iframe src={url} title={title ?? 'Embedded page'} className="w-full" style={{ height }} loading="lazy" allow="clipboard-write; fullscreen" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" />
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">{url.replace(/^https:\/\//, '')}</span>
        <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex shrink-0 items-center gap-1 font-medium hover:text-foreground">
          Open in a new tab <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
