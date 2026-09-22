import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { saveLesson } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { qk } from '../../lib/queries';
import type { CourseDetail, CourseLesson } from '../../lib/types';
import { patchCourse, type LessonPatch } from './model';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 650;
const MAX_WAIT_MS = 3000;

/**
 * Autosave for lesson edits.
 *
 * Every keystroke lands in a per-lesson `pending` patch immediately, and the
 * builder renders the cached course with pending and in-flight patches laid
 * over it — so a refetch that lands mid-typing can never flash old text, and
 * switching lessons never loses anything (patches are keyed by lesson, not by
 * whichever editor is open). A short debounce turns a burst of typing into one
 * request; one request per lesson is in flight at a time, so saves can't
 * arrive out of order.
 *
 * Client errors (no permission, lesson deleted, invalid value) revert the edit
 * with a toast. Network and server errors keep the edit and retry with backoff.
 */
export function useAutosave(courseId: string) {
  const qc = useQueryClient();
  const store = useRef({
    pending: new Map<string, LessonPatch>(),
    inflight: new Map<string, LessonPatch>(),
    firstPendingAt: 0,
    timer: 0 as number | ReturnType<typeof setTimeout>,
    retryTimer: 0 as number | ReturnType<typeof setTimeout>,
    failures: 0,
    waiters: [] as Array<() => void>,
  });
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const bump = useCallback(() => setVersion(v => v + 1), []);

  const settle = useCallback(() => {
    const s = store.current;
    if (s.pending.size || s.inflight.size) return;
    const waiters = s.waiters.splice(0);
    waiters.forEach(w => w());
  }, []);

  const send = useCallback(
    async (lessonId: string) => {
      const s = store.current;
      if (s.inflight.has(lessonId)) return;
      const patch = s.pending.get(lessonId);
      if (!patch) return;
      s.pending.delete(lessonId);
      s.inflight.set(lessonId, patch);
      setState('saving');
      let retryLater = false;
      try {
        const res = await saveLesson({ action: 'update', id: lessonId, patch });
        // A refetch that started before this save finished would carry the old text.
        await qc.cancelQueries({ queryKey: qk.course(courseId) });
        patchCourse(qc, courseId, d => ({
          ...d,
          course: { ...d.course, estimatedMinutes: res.estimatedMinutes },
          // Keep what was typed (the server may tidy it, e.g. drop a blank checklist item still being filled in) and the
          // outline position the client has, which may include a move that's still on its way.
          lessons: d.lessons.map(l => (l.id === lessonId ? ({ ...l, ...res.lesson, ...patch, position: l.position, sectionId: l.sectionId } as CourseLesson) : l)),
        }));
        s.failures = 0;
        setSavedAt(Date.now());
      } catch (e) {
        const message = String((e as Error)?.message ?? '');
        const status = Number(message.match(/\((\d{3})\)/)?.[1] ?? 0);
        if (status >= 400 && status < 500) {
          toast.error(errorMessage(e, 'Couldn’t save that change'));
          // The change can't ever be saved: drop it (and anything typed after it that depends on it).
          s.pending.delete(lessonId);
          if (status === 404) void qc.invalidateQueries({ queryKey: qk.course(courseId) });
        } else {
          s.pending.set(lessonId, { ...patch, ...(s.pending.get(lessonId) ?? {}) });
          s.failures += 1;
          retryLater = true;
          if (s.failures === 1) toast.error(errorMessage(e, 'Couldn’t save your changes — retrying'), { id: `autosave-${courseId}` });
          window.clearTimeout(s.retryTimer as number);
          s.retryTimer = window.setTimeout(() => {
            for (const id of [...s.pending.keys()]) void send(id);
          }, Math.min(30_000, 1500 * 2 ** Math.min(4, s.failures - 1)));
        }
      } finally {
        s.inflight.delete(lessonId);
        bump();
        if (!retryLater && s.pending.has(lessonId)) void send(lessonId);
        else if (retryLater) setState('error');
        else if (!s.inflight.size && !s.pending.size) setState(s.failures ? 'error' : 'saved');
        settle();
      }
    },
    [qc, courseId, bump, settle],
  );

  const flush = useCallback((): Promise<void> => {
    const s = store.current;
    window.clearTimeout(s.timer as number);
    s.firstPendingAt = 0;
    for (const id of [...s.pending.keys()]) void send(id);
    if (!s.pending.size && !s.inflight.size) return Promise.resolve();
    return new Promise(resolve => s.waiters.push(resolve));
  }, [send]);

  /** Record an edit. `immediate` skips the debounce (toggles, uploads, picks). */
  const edit = useCallback(
    (lessonId: string, patch: LessonPatch, opts: { immediate?: boolean } = {}) => {
      const s = store.current;
      s.pending.set(lessonId, { ...(s.pending.get(lessonId) ?? {}), ...patch });
      if (!s.firstPendingAt) s.firstPendingAt = Date.now();
      setState('saving');
      bump();
      window.clearTimeout(s.timer as number);
      if (opts.immediate || Date.now() - s.firstPendingAt > MAX_WAIT_MS) void flush();
      else s.timer = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [bump, flush],
  );

  /** Forget unsaved edits for a lesson (it was deleted, or its type changed and reset them). */
  const discard = useCallback(
    (lessonId: string) => {
      store.current.pending.delete(lessonId);
      bump();
      settle();
    },
    [bump, settle],
  );

  /** The course with every unsaved and in-flight edit applied. */
  const overlay = useCallback((detail: CourseDetail | undefined): CourseDetail | undefined => {
    const s = store.current;
    if (!detail || (!s.pending.size && !s.inflight.size)) return detail;
    return {
      ...detail,
      lessons: detail.lessons.map(l => {
        const a = s.inflight.get(l.id);
        const b = s.pending.get(l.id);
        return a || b ? ({ ...l, ...a, ...b } as CourseLesson) : l;
      }),
    };
  }, []);

  const hasUnsaved = useCallback(() => store.current.pending.size > 0 || store.current.inflight.size > 0, []);

  // Leaving the page with edits on their way: send them, and ask the browser to hold on.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return;
      void flush();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flush, hasUnsaved]);

  // Unmounting (another tab of the course, another page) still sends what was typed.
  useEffect(() => () => void flush(), [flush]);

  return useMemo(() => ({ edit, flush, discard, overlay, hasUnsaved, state, savedAt, version }), [edit, flush, discard, overlay, hasUnsaved, state, savedAt, version]);
}
