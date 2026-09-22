import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BookOpen, Check, Eye, FolderPlus, Keyboard, ListTree, Loader2, Lock, PanelRightClose, PanelRightOpen, Plus, SlidersHorizontal, Sparkles, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { aiGenerateCourse, deleteLesson, reorderOutline, saveLesson, saveSection } from 'zitejs/api';
import { Button } from '@project/components/ui/button';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { Sheet, SheetContent, SheetTitle } from '@project/components/ui/sheet';
import { cn } from '@project/components/lib/utils';
import { defaultSettings, formatMinutes, LESSON_TYPE_META, LESSON_TYPES, type LessonType } from '@project/shared/lessons';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { MOD, useHotkeys } from '../../lib/hotkeys';
import { refreshEverythingSoon, refreshSoon } from '../../lib/mutations';
import { qk, useCourse } from '../../lib/queries';
import type { CourseDetail, CourseLesson, CourseSection } from '../../lib/types';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useWorkspace } from '../../lib/workspace';
import { EmptyState, IconButton, Kbd, Tip } from '../primitives/bits';
import { LessonTypeIcon } from '../primitives/icons';
import { AddLessonMenu } from './AddLessonMenu';
import { AiCourseSheet, type DraftResult } from './AiCourseSheet';
import { Inspector } from './Inspector';
import { LessonEditor } from './LessonEditor';
import {
  applyOrder, applyPositions, buildOutline, issuesFor, lessonLabel, nudgeLesson, orderOf, patchCourse, plural, sameOrder, toPayload, type LessonPatch, type Order,
} from './model';
import { IssuesSummary, Outline, OutlinePane, type OutlineActions } from './Outline';
import { PreviewDialog } from './PreviewDialog';
import { SectionDeleteDialog, type SectionDeleteMode } from './SectionDeleteDialog';
import { useAutosave, type SaveState } from './useAutosave';

type Props = { courseId: string; lessonId?: string | null; /** Bumped by the page header's Preview button. */ previewRequest?: number };

/**
 * The course builder: outline on the left, the selected lesson's editor in
 * the middle, its properties on the right. Every edit autosaves; structure
 * changes (adding, moving, deleting) are optimistic and settle on what the
 * server wrote.
 */
export function CourseBuilder(props: Props) {
  // A different course is a different builder: its own autosave queue, selection and panels.
  return <Builder key={props.courseId} {...props} />;
}

function Builder({ courseId, lessonId, previewRequest = 0 }: Props) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = useCourse(courseId);
  const autosave = useAutosave(courseId);
  const large = useMediaQuery('(min-width: 1024px)');
  const wide = useMediaQuery('(min-width: 1280px)');

  const detail = useMemo(() => autosave.overlay(query.data), [query.data, autosave.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const outline = useMemo(() => (detail ? buildOutline(detail) : null), [detail]);
  const canEdit = Boolean(detail?.canEdit);
  const readOnly = !canEdit;
  const selected = detail && lessonId ? detail.lessons.find(l => l.id === lessonId) ?? null : null;

  const [addOpen, setAddOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingSection, setDeletingSection] = useState<CourseSection | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [outlineSheet, setOutlineSheet] = useState(false);
  const [inspectorSheet, setInspectorSheet] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  // The lesson whose title should take focus when its editor appears (a lesson just created), cleared once it has.
  const [focusTitleId, setFocusTitleId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    try {
      return localStorage.getItem('lms:builder:inspector') !== 'closed';
    } catch {
      return true;
    }
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const issues = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of detail?.lessons ?? []) {
      const found = issuesFor(l);
      if (found.length) m.set(l.id, found);
    }
    return m;
  }, [detail]);
  const issueCount = [...issues.values()].reduce((s, list) => s + list.length, 0);

  const latestDetail = useCallback(() => autosave.overlay(qc.getQueryData<CourseDetail>(qk.course(courseId))), [autosave, qc, courseId]);

  // ── Selection ───────────────────────────────────────────────────────────
  const go = useCallback(
    (id: string | null, opts: { replace?: boolean } = {}) => {
      void autosave.flush();
      navigate(id ? `/courses/${courseId}/content/${id}` : `/courses/${courseId}/content`, { replace: opts.replace });
    },
    [autosave, navigate, courseId],
  );

  // Lessons deleted here, whose page we're already navigating away from (the route can update after the cache does).
  const leaving = useRef(new Set<string>());

  // Land on the first lesson; leave a lesson that no longer exists.
  useEffect(() => {
    if (!outline || !detail) return;
    if (lessonId && detail.lessons.some(l => l.id === lessonId)) return;
    if (lessonId && leaving.current.has(lessonId)) return;
    const first = outline.ordered[0];
    if (first) go(first.id, { replace: true });
    else if (lessonId) go(null, { replace: true });
  }, [outline, lessonId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [lessonId]);

  // The page header's Preview opens the lesson that's selected (or the first one).
  const lastPreviewRequest = useRef(previewRequest);
  useEffect(() => {
    if (previewRequest === lastPreviewRequest.current) return;
    lastPreviewRequest.current = previewRequest;
    if (!outline?.ordered.length) return;
    void autosave.flush();
    if (!selected) go(outline.ordered[0].id, { replace: true });
    setPreviewOpen(true);
  }, [previewRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Draft with AI" from the create-course dialog lands here with ?ai=1.
  useEffect(() => {
    if (!detail || params.get('ai') !== '1') return;
    if (ws.features.ai && detail.canEdit) setAiOpen(true);
    setParams(
      p => {
        const next = new URLSearchParams(p);
        next.delete('ai');
        return next;
      },
      { replace: true },
    );
  }, [detail?.course.id, params]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lesson edits (autosaved) ────────────────────────────────────────────
  const onChange = useCallback(
    (patch: LessonPatch, opts?: { immediate?: boolean }) => {
      if (!lessonId || readOnly) return;
      autosave.edit(lessonId, patch, opts);
      if (patch.optional !== undefined) refreshEverythingSoon(qc, 2500);
      else if (patch.durationMinutes !== undefined) refreshSoon(qc, [qk.bootstrap], 3000);
    },
    [autosave, lessonId, readOnly, qc],
  );

  const onSettings = useCallback(
    (update: (current: Record<string, unknown>) => Record<string, unknown>, opts?: { immediate?: boolean }) => {
      if (!lessonId || readOnly) return;
      const current = latestDetail()?.lessons.find(l => l.id === lessonId);
      if (!current) return;
      autosave.edit(lessonId, { settings: update(current.settings) }, opts);
    },
    [autosave, latestDetail, lessonId, readOnly],
  );

  // ── Structure ───────────────────────────────────────────────────────────
  const addLesson = async (type: LessonType, target?: { sectionId: string | null }) => {
    if (!detail || !outline || readOnly || creating) return;
    let sectionId: string | null;
    let afterLessonId: string | undefined;
    if (target) {
      sectionId = target.sectionId;
    } else if (selected) {
      sectionId = selected.sectionId;
      afterLessonId = selected.id;
    } else {
      sectionId = outline.sections[outline.sections.length - 1]?.id ?? null;
    }
    setCreating(true);
    const toastId = window.setTimeout(() => toast.loading(`Adding ${LESSON_TYPE_META[type].label.toLowerCase()}…`, { id: 'builder-add' }), 500);
    try {
      await autosave.flush();
      const res = await saveLesson({ action: 'create', courseId, type, sectionId, afterLessonId });
      await qc.cancelQueries({ queryKey: qk.course(courseId) });
      patchCourse(qc, courseId, d => applyPositions({ ...d, course: { ...d.course, estimatedMinutes: res.estimatedMinutes }, lessons: [...d.lessons.filter(l => l.id !== res.lesson.id), res.lesson] }, res.positions!));
      toast.dismiss('builder-add');
      go(res.lesson.id);
      setFocusTitleId(res.lesson.id);
      setOutlineSheet(false);
      refreshSoon(qc, [qk.bootstrap], 1500);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t add the lesson'), { id: 'builder-add' });
    } finally {
      window.clearTimeout(toastId);
      setCreating(false);
    }
  };

  const addSection = async () => {
    if (!detail || readOnly) return;
    try {
      const res = await saveSection({ action: 'create', courseId, title: 'New section' });
      await qc.cancelQueries({ queryKey: qk.course(courseId) });
      patchCourse(qc, courseId, d => applyPositions({ ...d, sections: [...d.sections.filter(s => s.id !== res.section!.id), res.section!] }, res.positions));
      setRenamingId(res.section!.id);
      window.setTimeout(() => document.querySelector(`[data-section-row="${res.section!.id}"]`)?.scrollIntoView({ block: 'nearest' }), 50);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t add the section'));
    }
  };

  const updateSection = async (id: string, patch: { title?: string; description?: string }) => {
    const before = qc.getQueryData<CourseDetail>(qk.course(courseId))?.sections.find(s => s.id === id);
    if (!before) return;
    await qc.cancelQueries({ queryKey: qk.course(courseId) });
    patchCourse(qc, courseId, d => ({ ...d, sections: d.sections.map(s => (s.id === id ? { ...s, ...patch } : s)) }));
    try {
      const res = await saveSection({ action: 'update', id, ...patch });
      patchCourse(qc, courseId, d => ({ ...d, sections: d.sections.map(s => (s.id === id ? { ...s, title: res.section!.title, description: res.section!.description } : s)) }));
    } catch (e) {
      patchCourse(qc, courseId, d => ({ ...d, sections: d.sections.map(s => (s.id === id ? { ...s, title: before.title, description: before.description } : s)) }));
      toast.error(errorMessage(e, 'Couldn’t update the section'));
    }
  };

  const removeSection = async (section: CourseSection, mode: SectionDeleteMode) => {
    const lessonIds = (outline?.groups.find(g => g.section?.id === section.id)?.lessons ?? []).map(l => l.id);
    try {
      lessonIds.forEach(id => mode === 'delete_lessons' && autosave.discard(id));
      const res = await saveSection({ action: 'delete', id: section.id, mode });
      await qc.cancelQueries({ queryKey: qk.course(courseId) });
      patchCourse(qc, courseId, d => applyPositions({ ...d, course: { ...d.course, estimatedMinutes: res.estimatedMinutes } }, res.positions, { sectionIds: [section.id], lessonIds: res.deletedLessonIds }));
      setDeletingSection(null);
      toast.success(res.deletedLessonIds.length ? `Deleted “${section.title}” and ${plural(res.deletedLessonIds.length, 'lesson')}` : `Deleted “${section.title}”`);
      if (res.deletedLessonIds.length) refreshEverythingSoon(qc, 400);
      else refreshSoon(qc, [qk.bootstrap], 1500);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t delete the section'));
    }
  };

  // Reorders go out one at a time; a burst of moves sends only the latest order once the previous lands.
  const reorderRef = useRef<{ busy: boolean; next: Order | null; base: CourseDetail | null }>({ busy: false, next: null, base: null });
  const reorder = useCallback(
    async (order: Order) => {
      const current = qc.getQueryData<CourseDetail>(qk.course(courseId));
      if (!current || readOnly) return;
      if (sameOrder(orderOf(buildOutline(current).groups), order)) return;
      const st = reorderRef.current;
      if (!st.busy && !st.next) st.base = current;
      await qc.cancelQueries({ queryKey: qk.course(courseId) });
      patchCourse(qc, courseId, d => applyOrder(d, order));
      st.next = order;
      if (st.busy) return;
      st.busy = true;
      try {
        while (st.next) {
          const sending: Order = st.next;
          st.next = null;
          const res = await reorderOutline(toPayload(courseId, sending));
          if (!st.next) patchCourse(qc, courseId, d => applyPositions(d, res.positions));
        }
        st.base = null;
      } catch (e) {
        if (st.base) qc.setQueryData(qk.course(courseId), st.base);
        st.next = null;
        st.base = null;
        toast.error(errorMessage(e, 'Couldn’t save the new order'));
        void qc.invalidateQueries({ queryKey: qk.course(courseId) });
      } finally {
        st.busy = false;
      }
    },
    [qc, courseId, readOnly],
  );

  const moveSelected = (dir: -1 | 1) => {
    if (!outline || !selected) return;
    const next = nudgeLesson(orderOf(outline.groups), selected.id, dir);
    if (next) void reorder(next);
  };

  const moveToSection = (sectionId: string | null) => {
    if (!outline || !selected) return;
    const order = orderOf(outline.groups);
    for (const [k, ids] of order.groups) order.groups.set(k, ids.filter(id => id !== selected.id));
    order.groups.set(sectionId, [...(order.groups.get(sectionId) ?? []), selected.id]);
    void reorder(order);
    const title = sectionId ? outline.sections.find(s => s.id === sectionId)?.title || 'Untitled section' : null;
    toast.success(title ? `Moved to “${title}”` : 'Moved out of its section');
  };

  const changeType = async (type: LessonType) => {
    if (!selected || readOnly) return;
    const s = selected.settings as Record<string, unknown>;
    const loses =
      (selected.type === 'Quiz' && Array.isArray(s.questions) && (s.questions as Array<{ prompt?: string }>).some(q => q.prompt?.trim()))
        ? 'its questions'
        : selected.type === 'Checklist' && Array.isArray(s.items) && (s.items as Array<{ text?: string }>).some(i => i.text?.trim())
          ? 'its checklist items'
          : selected.type === 'Assignment' && typeof s.rubric === 'string' && s.rubric.trim()
            ? 'its grading rubric'
            : null;
    const ok = await app.confirm({
      title: `Change this lesson to ${LESSON_TYPE_META[type].label === 'Article' ? 'an' : 'a'} ${LESSON_TYPE_META[type].label.toLowerCase()}?`,
      description: `${loses ? `This removes ${loses}. ` : ''}The title and text stay${selected.mediaUrl ? ', and so does the link' : ''}.${selected.completedCount ? ` ${plural(selected.completedCount, 'learner')} already completed it — their completion is kept.` : ''}`,
      confirmLabel: `Change to ${LESSON_TYPE_META[type].label}`,
      destructive: Boolean(loses),
    });
    if (!ok) return;
    const id = selected.id;
    await autosave.flush();
    autosave.discard(id);
    const before = qc.getQueryData<CourseDetail>(qk.course(courseId))?.lessons.find(l => l.id === id);
    await qc.cancelQueries({ queryKey: qk.course(courseId) });
    patchCourse(qc, courseId, d => ({ ...d, lessons: d.lessons.map(l => (l.id === id ? { ...l, type, settings: defaultSettings(type) as Record<string, unknown> } : l)) }));
    try {
      const res = await saveLesson({ action: 'update', id, patch: { type } });
      patchCourse(qc, courseId, d => ({ ...d, lessons: d.lessons.map(l => (l.id === id ? { ...l, ...res.lesson, position: l.position, sectionId: l.sectionId } : l)) }));
    } catch (e) {
      if (before) patchCourse(qc, courseId, d => ({ ...d, lessons: d.lessons.map(l => (l.id === id ? before : l)) }));
      toast.error(errorMessage(e, 'Couldn’t change the lesson type'));
    }
  };

  const duplicate = async () => {
    if (!selected || readOnly) return;
    try {
      await autosave.flush();
      const res = await saveLesson({ action: 'duplicate', id: selected.id });
      await qc.cancelQueries({ queryKey: qk.course(courseId) });
      patchCourse(qc, courseId, d => applyPositions({ ...d, course: { ...d.course, estimatedMinutes: res.estimatedMinutes }, lessons: [...d.lessons.filter(l => l.id !== res.lesson.id), res.lesson] }, res.positions!));
      go(res.lesson.id);
      toast.success('Lesson duplicated');
      refreshSoon(qc, [qk.bootstrap], 1500);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t duplicate the lesson'));
    }
  };

  const busyDelete = useRef(false);
  const removeLesson = async (lesson: CourseLesson) => {
    if (readOnly || busyDelete.current || !outline) return;
    busyDelete.current = true;
    try {
      let impact: Awaited<ReturnType<typeof deleteLesson>>['impact'] | null = null;
      try {
        impact = (await deleteLesson({ ids: [lesson.id], dryRun: true })).impact;
      } catch {
        impact = null;
      }
      const parts: string[] = [];
      if (impact && impact.learners > 0) {
        const done = impact.completed;
        const started = impact.inProgress;
        parts.push(
          done && started
            ? `${plural(done, 'learner')} completed this lesson and ${plural(started, 'more')} ${started === 1 ? 'has' : 'have'} started it.`
            : done
              ? `${plural(done, 'learner')} completed this lesson.`
              : `${plural(started, 'learner')} ${started === 1 ? 'has' : 'have'} started this lesson.`,
        );
        parts.push('Their records stay in the history, but everyone’s course progress is recalculated without it — some learners may finish the course as a result.');
      }
      if (impact?.ungraded) parts.push(`${plural(impact.ungraded, 'submission')} waiting for grading won’t count any more.`);
      if (impact?.sessions) parts.push(`${plural(impact.sessions, 'session')} linked to it will stay on the course.`);
      if (!parts.length) parts.push('This can’t be undone.');
      const ok = await app.confirm({
        title: `Delete “${lessonLabel(lesson)}”?`,
        description: parts.join(' '),
        confirmLabel: 'Delete lesson',
        destructive: true,
      });
      if (!ok) return;

      const index = outline.ordered.findIndex(l => l.id === lesson.id);
      const neighbour = outline.ordered[index + 1] ?? outline.ordered[index - 1] ?? null;
      autosave.discard(lesson.id);
      const snapshot = qc.getQueryData<CourseDetail>(qk.course(courseId));
      await qc.cancelQueries({ queryKey: qk.course(courseId) });
      if (lesson.id === lessonId) {
        leaving.current.add(lesson.id);
        go(neighbour?.id ?? null, { replace: true });
      }
      patchCourse(qc, courseId, d => ({ ...d, lessons: d.lessons.filter(l => l.id !== lesson.id) }));
      const toastId = toast.loading(impact?.learners ? 'Deleting and recalculating progress…' : 'Deleting lesson…');
      try {
        const res = await deleteLesson({ ids: [lesson.id] });
        patchCourse(qc, courseId, d => applyPositions({ ...d, course: { ...d.course, estimatedMinutes: res.estimatedMinutes } }, res.positions!, { lessonIds: res.deletedIds }));
        toast.success(`Deleted “${lessonLabel(lesson)}”`, { id: toastId, description: res.recomputed ? `Updated progress for ${plural(res.recomputed, 'enrollment')}.` : undefined });
        refreshEverythingSoon(qc, 300);
      } catch (e) {
        if (snapshot) qc.setQueryData(qk.course(courseId), snapshot);
        toast.error(errorMessage(e, 'Couldn’t delete the lesson'), { id: toastId });
      }
    } finally {
      busyDelete.current = false;
    }
  };

  // ── Sessions ────────────────────────────────────────────────────────────
  const watchSession = useRef<number | null>(null);
  const scheduleSession = () => {
    app.openCreateSession(courseId);
    // The session dialog belongs to the shell; refresh this course's sessions once it closes.
    if (watchSession.current) window.clearInterval(watchSession.current);
    const started = Date.now();
    let seenOpen = false;
    watchSession.current = window.setInterval(() => {
      const open = Boolean(document.querySelector('[role="dialog"][data-state="open"]'));
      if (open) seenOpen = true;
      if ((seenOpen && !open) || Date.now() - started > 30 * 60_000) {
        window.clearInterval(watchSession.current!);
        watchSession.current = null;
        void qc.invalidateQueries({ queryKey: qk.course(courseId) });
      }
    }, 700);
  };
  useEffect(() => () => void (watchSession.current && window.clearInterval(watchSession.current)), []);

  // ── AI ──────────────────────────────────────────────────────────────────
  const onDrafted = async (res: DraftResult) => {
    refreshSoon(qc, [qk.bootstrap], 800);
    // Wait for the new lessons to be in the cache, or selecting one would bounce back to the first lesson.
    await qc.invalidateQueries({ queryKey: qk.course(courseId) });
    if (res.lessonIds[0]) go(res.lessonIds[0]);
  };
  const onUndoDraft = async (res: DraftResult) => {
    try {
      res.lessonIds.forEach(id => autosave.discard(id));
      await aiGenerateCourse({ courseId, undo: { sectionIds: res.sectionIds, lessonIds: res.lessonIds, filled: res.filled } });
      await qc.invalidateQueries({ queryKey: qk.course(courseId) });
      refreshSoon(qc, [qk.bootstrap], 500);
      toast.success('Draft removed');
      return true;
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t undo the draft'));
      return false;
    }
  };

  // ── Keyboard ────────────────────────────────────────────────────────────
  const step = (dir: -1 | 1) => {
    if (!outline?.ordered.length) return;
    const i = outline.ordered.findIndex(l => l.id === lessonId);
    const next = outline.ordered[Math.max(0, Math.min(outline.ordered.length - 1, i < 0 ? 0 : i + dir))];
    if (next && next.id !== lessonId) go(next.id, { replace: true });
  };
  const alertOpen = () => Boolean(document.querySelector('[role="alertdialog"]'));
  useHotkeys(
    {
      j: () => step(1),
      k: () => step(-1),
      down: () => step(1),
      up: () => step(-1),
      'alt+down': () => canEdit && moveSelected(1),
      'alt+up': () => canEdit && moveSelected(-1),
      a: () => canEdit && (large ? setAddOpen(true) : setOutlineSheet(true)),
      'mod+s': () => {
        if (alertOpen()) return;
        void autosave.flush();
      },
      'mod+shift+p': () => !alertOpen() && selected && setPreviewOpen(o => !o),
      backspace: () => canEdit && selected && void removeLesson(selected),
    },
    { enabled: Boolean(detail) && !aiOpen && !deletingSection, allowInInputs: ['mod+s', 'mod+shift+p'] },
  );

  // ── Render ──────────────────────────────────────────────────────────────
  if (query.isError && !query.data) {
    const notFound = /not found|no longer exists|404/i.test(String((query.error as Error)?.message ?? ''));
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          icon={<BookOpen />}
          title={notFound ? 'This course doesn’t exist' : 'The course couldn’t be loaded'}
          description={notFound ? 'It may have been deleted.' : errorMessage(query.error, 'Check your connection and try again.')}
          action={notFound ? undefined : <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button>}
        />
      </div>
    );
  }
  if (!detail || !outline) return <BuilderSkeleton />;

  const ownerName = detail.course.ownerId ? ws.staffById.get(detail.course.ownerId)?.name : null;
  const totalMinutes = detail.lessons.reduce((s, l) => s + l.durationMinutes, 0);
  const learnUrl = ws.settings.learnUrl;
  const empty = detail.lessons.length === 0;
  const section = selected?.sectionId ? outline.sections.find(s => s.id === selected.sectionId) : null;

  const outlineActions: OutlineActions = {
    onSelect: id => {
      go(id);
      setOutlineSheet(false);
    },
    onReorder: order => void reorder(order),
    onAddLesson: (sectionId, type) => void addLesson(type, { sectionId }),
    onAddSection: () => void addSection(),
    onRenameSection: (id, title) => void updateSection(id, { title }),
    onDescribeSection: (id, description) => void updateSection(id, { description }),
    onDeleteSection: s => {
      const count = outline.groups.find(g => g.section?.id === s.id)?.lessons.length ?? 0;
      if (count) setDeletingSection(s);
      else void removeSection(s, 'move_lessons');
    },
  };

  const addMenu = (trigger: ReactNode, controlled: boolean) => (
    <AddLessonMenu
      open={controlled ? addOpen : undefined}
      onOpenChange={controlled ? setAddOpen : undefined}
      onPick={type => void addLesson(type)}
      align="start"
      label={selected ? `Add after “${lessonLabel(selected)}”` : 'Add a lesson'}
      extra={
        <DropdownMenuItem className="gap-2.5 px-2 text-[14px]" onSelect={() => void addSection()}>
          <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" /> Add a section
        </DropdownMenuItem>
      }
    >
      {trigger}
    </AddLessonMenu>
  );

  const outlinePane = (inSheet: boolean) => (
    <OutlinePane
      className="h-full"
      header={
        <>
          <span className="text-sm font-medium text-muted-foreground">Outline</span>
          <span className="text-2xs tabular-nums text-muted-foreground/80">{detail.lessons.length || ''}</span>
          <span className="ml-auto flex items-center gap-0.5">
            {canEdit && (
              <>
              <Tip label="Add section">
                <IconButton aria-label="Add section" onClick={() => void addSection()}>
                  <FolderPlus />
                </IconButton>
              </Tip>
              {addMenu(
                <IconButton aria-label="Add lesson" disabled={creating}>
                  {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                </IconButton>,
                !inSheet,
              )}
              </>
            )}
            {inSheet && (
              <IconButton aria-label="Close outline" onClick={() => setOutlineSheet(false)}>
                <X />
              </IconButton>
            )}
          </span>
        </>
      }
      footer={
        <>
          <div className="flex items-center gap-2 py-1.5 pl-4 pr-2 text-sm text-muted-foreground">
            <span className="tabular-nums">{plural(detail.lessons.length, 'lesson')}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{formatMinutes(totalMinutes)}</span>
            <Tip
              side="top"
              label={
                <span className="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-1.5 py-0.5">
                  {(
                    [
                      ['Next / previous lesson', ['J', 'K']],
                      ['Move lesson up / down', ['⌥', '↑', '↓']],
                      ['Add a lesson', ['A']],
                      ['Preview as a learner', [MOD, '⇧', 'P']],
                      ['Save now', [MOD, 'S']],
                      ['Delete lesson', ['⌫']],
                    ] as Array<[string, string[]]>
                  )
                    .filter(([label]) => canEdit || label.startsWith('Next') || label.startsWith('Preview'))
                    .map(([label, keys]) => (
                      <span key={label} className="contents">
                        <span>{label}</span>
                        <span className="flex justify-end gap-1">{keys.map(k => <Kbd key={k}>{k}</Kbd>)}</span>
                      </span>
                    ))}
                </span>
              }
            >
              <IconButton size="sm" aria-label="Keyboard shortcuts" className="ml-auto">
                <Keyboard />
              </IconButton>
            </Tip>
          </div>
          {issueCount > 0 && (
            <Popover open={issuesOpen} onOpenChange={setIssuesOpen}>
              <PopoverTrigger asChild>
                <div>
                  <IssuesSummary count={issueCount} onClick={() => setIssuesOpen(o => !o)} />
                </div>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="max-h-[360px] w-[320px] overflow-y-auto p-1">
                {outline.ordered
                  .filter(l => issues.has(l.id))
                  .map(l => (
                    <button
                      key={l.id}
                      type="button"
                      className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-accent"
                      onClick={() => {
                        setIssuesOpen(false);
                        setOutlineSheet(false);
                        go(l.id);
                      }}
                    >
                      <span className="flex items-center gap-2 text-[14px] font-medium">
                        <LessonTypeIcon type={l.type} /> <span className="truncate">{lessonLabel(l)}</span>
                      </span>
                      {issues.get(l.id)!.map(i => (
                        <span key={i} className="mt-0.5 block pl-[22px] text-sm text-muted-foreground">{i}</span>
                      ))}
                    </button>
                  ))}
              </PopoverContent>
            </Popover>
          )}
        </>
      }
    >
      <Outline courseId={courseId} groups={outline.groups} selectedId={lessonId ?? null} canEdit={canEdit} issues={issues} renamingId={renamingId} setRenamingId={setRenamingId} actions={outlineActions} />
      {canEdit && !empty && (
        <div className="px-2 pb-4">
          {addMenu(
            <button type="button" className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-[14px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Add lesson <Kbd className="ml-auto">A</Kbd>
            </button>,
            false,
          )}
        </div>
      )}
    </OutlinePane>
  );

  const inspector = selected && (
    <Inspector
      lesson={selected}
      sections={outline.sections}
      sequential={detail.course.sequential}
      readOnly={readOnly}
      issues={issues.get(selected.id) ?? []}
      onChange={onChange}
      onChangeType={t => void changeType(t)}
      onMove={moveToSection}
      onDuplicate={() => void duplicate()}
      onDelete={() => void removeLesson(selected)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {readOnly && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-subtle px-4 py-2 text-[13.5px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">
            You can view this course, but only {ownerName ? <span className="font-medium text-foreground">{ownerName}</span> : 'its owner'}, its instructors or an admin can change it.
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {large && <aside className="flex w-[280px] shrink-0 flex-col border-r">{outlinePane(false)}</aside>}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-1.5 border-b bg-background px-2 sm:px-3">
            {!large && (
              <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-[13.5px]" onClick={() => setOutlineSheet(true)} aria-label="Show outline">
                <ListTree className="!h-4 !w-4" /> <span className="hidden sm:inline">Outline</span>
              </Button>
            )}
            {selected ? (
              <div className="flex min-w-0 items-center gap-1.5 text-[14px]">
                {section && (
                  <>
                    <span className="hidden max-w-[200px] truncate text-muted-foreground md:inline">{section.title || 'Untitled section'}</span>
                    <span className="hidden text-muted-foreground/60 md:inline">›</span>
                  </>
                )}
                <LessonTypeIcon type={selected.type} />
                <span className={cn('truncate font-medium', !selected.title.trim() && 'text-muted-foreground')}>{lessonLabel(selected)}</span>
              </div>
            ) : (
              <span className="truncate text-[14px] text-muted-foreground">{empty ? 'No lessons yet' : 'Choose a lesson'}</span>
            )}
            <SaveIndicator state={autosave.state} readOnly={readOnly} onRetry={() => void autosave.flush()} />

            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {!large && canEdit && (
                <AddLessonMenu onPick={type => void addLesson(type)} align="end" label={selected ? `Add after “${lessonLabel(selected)}”` : 'Add a lesson'}>
                  <IconButton aria-label="Add lesson" disabled={creating}>
                    {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                  </IconButton>
                </AddLessonMenu>
              )}
              {ws.features.ai && canEdit && (
                <Tip label="Draft sections and lessons with AI">
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-[13.5px]" onClick={() => setAiOpen(true)}>
                    <Sparkles className="!h-3.5 !w-3.5 text-tone-accent" /> <span className="hidden md:inline">Draft with AI</span>
                  </Button>
                </Tip>
              )}
              {/* On wider screens the page header's Preview does this. */}
              {selected && (
                <IconButton aria-label="Preview as a learner" className="sm:hidden" onClick={() => setPreviewOpen(true)}>
                  <Eye />
                </IconButton>
              )}
              {selected &&
                (wide ? (
                  <Tip label={inspectorOpen ? 'Hide lesson details' : 'Show lesson details'}>
                    <IconButton
                      aria-label={inspectorOpen ? 'Hide lesson details' : 'Show lesson details'}
                      onClick={() =>
                        setInspectorOpen(o => {
                          try {
                            localStorage.setItem('lms:builder:inspector', o ? 'closed' : 'open');
                          } catch {
                            /* private mode */
                          }
                          return !o;
                        })
                      }
                    >
                      {inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
                    </IconButton>
                  </Tip>
                ) : (
                  <Tip label="Lesson details">
                    <IconButton aria-label="Lesson details" onClick={() => setInspectorSheet(true)}>
                      <SlidersHorizontal />
                    </IconButton>
                  </Tip>
                ))}
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-canvas">
            {selected ? (
              <LessonEditor key={selected.id} lesson={selected} detail={detail} readOnly={readOnly} onChange={onChange} onSettings={onSettings} focusTitle={focusTitleId === selected.id} onTitleFocused={() => setFocusTitleId(null)} onSchedule={scheduleSession} />
            ) : empty ? (
              <EmptyCourse
                title={detail.course.title}
                canEdit={canEdit}
                hasSections={outline.sections.length > 0}
                ai={ws.features.ai && canEdit}
                creating={creating}
                onAdd={type => void addLesson(type, { sectionId: outline.sections[0]?.id ?? null })}
                onAddSection={() => void addSection()}
                onDraft={() => setAiOpen(true)}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        {wide && selected && inspectorOpen && <aside className="w-[300px] shrink-0 overflow-y-auto border-l bg-background">{inspector}</aside>}
      </div>

      {!large && (
        <Sheet open={outlineSheet} onOpenChange={setOutlineSheet}>
          <SheetContent side="left" className="flex w-[300px] max-w-[88vw] flex-col gap-0 p-0 [&>button.absolute]:hidden" onOpenAutoFocus={e => e.preventDefault()}>
            <SheetTitle className="sr-only">Course outline</SheetTitle>
            {outlinePane(true)}
          </SheetContent>
        </Sheet>
      )}
      {!wide && selected && (
        <Sheet open={inspectorSheet} onOpenChange={setInspectorSheet}>
          <SheetContent side="right" className="flex w-[320px] max-w-[92vw] flex-col gap-0 p-0 sm:max-w-[320px] [&>button.absolute]:hidden">
            <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
              <SheetTitle className="text-[14px] font-medium">Lesson details</SheetTitle>
              <Button variant="ghost" size="sm" className="h-8 px-2.5 text-[13.5px]" onClick={() => setInspectorSheet(false)}>Done</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{inspector}</div>
          </SheetContent>
        </Sheet>
      )}

      <PreviewDialog open={previewOpen && Boolean(selected)} onOpenChange={setPreviewOpen} detail={detail} lessonId={lessonId ?? null} onNavigate={id => go(id, { replace: true })} learnUrl={learnUrl} />
      <SectionDeleteDialog
        section={deletingSection}
        lessons={deletingSection ? outline.groups.find(g => g.section?.id === deletingSection.id)?.lessons ?? [] : []}
        onOpenChange={o => !o && setDeletingSection(null)}
        onConfirm={mode => (deletingSection ? removeSection(deletingSection, mode) : Promise.resolve())}
      />
      {ws.features.ai && canEdit && (
        <AiCourseSheet
          open={aiOpen}
          onOpenChange={setAiOpen}
          detail={detail}
          onDrafted={onDrafted}
          onUndo={onUndoDraft}
          onOpenLesson={id => {
            setAiOpen(false);
            go(id);
          }}
        />
      )}
    </div>
  );
}

function SaveIndicator({ state, readOnly, onRetry }: { state: SaveState; readOnly: boolean; onRetry: () => void }) {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (state !== 'saved') return;
    setFresh(true);
    const t = window.setTimeout(() => setFresh(false), 2500);
    return () => window.clearTimeout(t);
  }, [state]);
  if (readOnly) {
    return (
      <span className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
        <Lock className="h-3 w-3" /> View only
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="ml-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="h-3 w-3 animate-spin" /> <span className="hidden sm:inline">Saving…</span>
      </span>
    );
  }
  if (state === 'error') {
    return (
      <button type="button" onClick={onRetry} className="ml-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-sm font-medium text-tone-danger hover:bg-tone-danger/[0.08]">
        <AlertTriangle className="h-3 w-3" /> Not saved · Retry
      </button>
    );
  }
  if (state === 'saved') {
    return (
      <Tip label="Every change saves automatically" keys={[MOD, 'S']}>
        <span className={cn('ml-1 inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm transition-colors', fresh ? 'text-foreground' : 'text-muted-foreground')} aria-live="polite">
          <Check className={cn('h-3 w-3', fresh && 'text-tone-success')} /> <span className="hidden sm:inline">Saved</span>
        </span>
      </Tip>
    );
  }
  return null;
}

function EmptyCourse({ title, canEdit, hasSections, ai, creating, onAdd, onAddSection, onDraft }: {
  title: string;
  canEdit: boolean;
  hasSections: boolean;
  ai: boolean;
  creating: boolean;
  onAdd: (type: LessonType) => void;
  onAddSection: () => void;
  onDraft: () => void;
}) {
  if (!canEdit) return <EmptyState icon={<BookOpen />} title="This course has no lessons yet" description="Once its owner adds lessons, they’ll appear here." />;
  return (
    <div className="mx-auto w-full max-w-[680px] px-5 py-12 sm:py-16 animate-fade-up">
      <div className="text-center">
        <h2 className="text-[18px] font-semibold tracking-tight">Build “{title || 'your course'}”</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[14px] text-muted-foreground">
          {hasSections ? 'Your sections are ready. Add the first lesson — you can drag lessons between sections any time.' : 'Start with a lesson. Mix articles, videos, quizzes and hands-on work; group them into sections when the course grows.'}
        </p>
        {ai && (
          <Button size="sm" className="mt-5 h-9 gap-1.5 text-[14px]" onClick={onDraft}>
            <Sparkles className="!h-3.5 !w-3.5" /> Draft this course with AI
          </Button>
        )}
      </div>
      <p className="mb-2 mt-9 text-sm font-medium text-muted-foreground">{ai ? 'Or add your first lesson' : 'Add your first lesson'}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {LESSON_TYPES.map(type => (
          <button
            key={type}
            type="button"
            disabled={creating}
            onClick={() => onAdd(type)}
            className="group flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left shadow-2xs transition-[border-color,box-shadow] hover:border-foreground/25 hover:shadow-xs disabled:opacity-60"
          >
            <LessonTypeIcon type={type} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-[14px] font-medium">{LESSON_TYPE_META[type].label}</span>
              <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{LESSON_TYPE_META[type].description}</span>
            </span>
          </button>
        ))}
      </div>
      {!hasSections && (
        <div className="mt-5 text-center">
          <button type="button" onClick={onAddSection} className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground hover:text-foreground">
            <FolderPlus className="h-3.5 w-3.5" /> Start with a section instead
          </button>
        </div>
      )}
    </div>
  );
}

function BuilderSkeleton() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="hidden w-[280px] shrink-0 space-y-2.5 border-r px-4 py-4 lg:block">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className={cn('skeleton h-3.5', i % 4 === 0 ? 'mt-4 w-24' : '')} style={i % 4 === 0 ? undefined : { width: `${55 + ((i * 17) % 35)}%` }} />
        ))}
      </div>
      <div className="min-w-0 flex-1 bg-canvas">
        <div className="h-11 border-b bg-background" />
        <div className="mx-auto max-w-[800px] space-y-4 px-8 pt-9">
          <div className="skeleton h-3 w-32" />
          <div className="skeleton h-8 w-2/3" />
          <div className="skeleton mt-6 h-[320px] w-full rounded-xl" />
        </div>
      </div>
      <div className="hidden w-[300px] shrink-0 space-y-3 border-l px-4 py-4 xl:block">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-3.5" style={{ width: `${40 + ((i * 23) % 50)}%` }} />
        ))}
      </div>
    </div>
  );
}
