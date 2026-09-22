import { Clock, FolderOpen } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatMinutes, LESSON_TYPE_META, type LessonType } from '@project/shared/lessons';
import type { CourseDetail, CourseLesson } from '../../lib/types';
import { LessonTypeIcon } from '../primitives/icons';
import { ChecklistEditor } from './ChecklistEditor';
import { QuizEditor } from './QuizEditor';
import { ArticleEditor, AssignmentEditor, EmbedEditor, FileEditor, LiveSessionEditor, VideoEditor, type EditorProps } from './TypeEditors';
import { AutoTextarea } from './ui';

/**
 * The center column: a big inline title, then the editor for the lesson's
 * type. Keyed by lesson, so switching lessons starts each editor fresh (edits
 * themselves live in the autosave queue, not here).
 */
export function LessonEditor({ lesson, detail, readOnly, onChange, onSettings, focusTitle, onTitleFocused, onSchedule }: EditorProps & { focusTitle: boolean; onTitleFocused: () => void; onSchedule: () => void }) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const section = lesson.sectionId ? detail.sections.find(s => s.id === lesson.sectionId) : null;

  useEffect(() => {
    if (!focusTitle || readOnly) return;
    onTitleFocused();
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusTitle, readOnly]);

  const props: EditorProps = { lesson, detail, readOnly, onChange, onSettings };
  const type = lesson.type as LessonType;

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pb-28 pt-6 sm:px-8 sm:pt-9">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground/80">
          <LessonTypeIcon type={type} /> {LESSON_TYPE_META[type].label}
        </span>
        {section && (
          <span className="inline-flex min-w-0 items-center gap-1 md:hidden">
            <FolderOpen className="h-3 w-3 shrink-0" /> <span className="truncate">{section.title || 'Untitled section'}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Clock className="h-3 w-3" /> {formatMinutes(lesson.durationMinutes)}
        </span>
        {lesson.optional && <span className="chip-soft">Optional</span>}
      </div>
      <AutoTextarea
        id="lesson-title"
        ref={titleRef}
        value={lesson.title}
        readOnly={readOnly}
        maxLength={200}
        aria-label="Lesson title"
        placeholder="Lesson title"
        className="-mx-1 block w-[calc(100%+0.5rem)] resize-none rounded-md bg-transparent px-1 text-[24px] font-semibold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50 focus-visible:bg-background/60 sm:text-[26px]"
        onChange={e => onChange({ title: e.target.value.replace(/\n/g, ' ') })}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const next = document.querySelector<HTMLElement>('#lesson-editor-body textarea, #lesson-editor-body input:not([type="file"])');
            next?.focus();
          }
        }}
      />
      <div id="lesson-editor-body" className="mt-6">
        {type === 'Article' && <ArticleEditor {...props} />}
        {type === 'Video' && <VideoEditor {...props} />}
        {type === 'File' && <FileEditor {...props} />}
        {type === 'Embed' && <EmbedEditor {...props} />}
        {type === 'Quiz' && <QuizEditor {...props} />}
        {type === 'Assignment' && <AssignmentEditor {...props} />}
        {type === 'Checklist' && <ChecklistEditor {...props} />}
        {type === 'Live session' && <LiveSessionEditor {...props} onSchedule={onSchedule} />}
      </div>
    </div>
  );
}
