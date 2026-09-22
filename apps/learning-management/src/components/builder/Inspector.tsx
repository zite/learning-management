import { Check, ChevronDown, CircleCheck, Copy, FolderOpen, Lock, Trash2, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@project/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { LESSON_TYPE_META, LESSON_TYPES, type LessonType } from '@project/shared/lessons';
import { timeAgo } from '../../lib/format';
import type { CourseLesson, CourseSection } from '../../lib/types';
import { Keys, Tip } from '../primitives/bits';
import { LessonTypeIcon } from '../primitives/icons';
import { plural, readingMinutes } from './model';
import { NumberField, ToggleRow } from './ui';

/** The selected lesson's properties, what's stopping it being ready, and its actions. */
export function Inspector({ lesson, sections, sequential, readOnly, issues, onChange, onChangeType, onMove, onDuplicate, onDelete }: {
  lesson: CourseLesson;
  sections: CourseSection[];
  sequential: boolean;
  readOnly: boolean;
  issues: string[];
  onChange: (patch: Partial<Pick<CourseLesson, 'durationMinutes' | 'optional'>>, opts?: { immediate?: boolean }) => void;
  onChangeType: (type: LessonType) => void;
  onMove: (sectionId: string | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const section = sections.find(s => s.id === lesson.sectionId) ?? null;
  const reading = lesson.type === 'Article' ? readingMinutes(lesson.body) : null;
  // Only when the article has outgrown its duration — a short read with time set aside to reflect is fine.
  const suggest = reading && reading.minutes > lesson.durationMinutes ? reading.minutes : null;

  return (
    <div className="pb-6">
      <Group title="Lesson">
        <Prop label="Type">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild disabled={readOnly}>
              <button type="button" className="ghost-chip h-8 w-full justify-between gap-2 px-2 text-[14px] disabled:pointer-events-none">
                <span className="flex min-w-0 items-center gap-2">
                  <LessonTypeIcon type={lesson.type} />
                  <span className="truncate">{lesson.type}</span>
                </span>
                {!readOnly && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-2xs font-medium text-muted-foreground">Change lesson type</DropdownMenuLabel>
              {LESSON_TYPES.map(t => (
                <DropdownMenuItem key={t} onSelect={() => t !== lesson.type && onChangeType(t)} className="items-start gap-2 py-1.5">
                  <LessonTypeIcon type={t} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px]">{t}</span>
                    <span className="block text-2xs text-muted-foreground">{LESSON_TYPE_META[t].description}</span>
                  </span>
                  {t === lesson.type && <Check className="mt-0.5 h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Prop>
        <Prop label="Section">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild disabled={readOnly}>
              <button type="button" className="ghost-chip h-8 w-full justify-between gap-2 px-2 text-[14px] disabled:pointer-events-none">
                <span className={cn('flex min-w-0 items-center gap-2', !section && 'text-muted-foreground')}>
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{section ? section.title || 'Untitled section' : 'No section'}</span>
                </span>
                {!readOnly && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[320px] w-60 overflow-y-auto">
              <DropdownMenuLabel className="text-2xs font-medium text-muted-foreground">Move to section</DropdownMenuLabel>
              {sections.map(s => (
                <DropdownMenuItem key={s.id} onSelect={() => s.id !== lesson.sectionId && onMove(s.id)} className="gap-2 text-[14px]">
                  <span className="min-w-0 flex-1 truncate">{s.title || 'Untitled section'}</span>
                  {s.id === lesson.sectionId && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
              {sections.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => lesson.sectionId && onMove(null)} className="gap-2 text-[14px]">
                <span className="min-w-0 flex-1 text-muted-foreground">No section</span>
                {!lesson.sectionId && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Prop>
        <Prop label="Duration">
          <div className="flex items-center gap-2">
            <NumberField
              ariaLabel="Duration in minutes"
              value={lesson.durationMinutes}
              min={0}
              max={1440}
              suffix="min"
              disabled={readOnly}
              className="w-[92px]"
              inputClassName="h-8"
              onChange={v => v != null && onChange({ durationMinutes: v })}
            />
            {suggest && !readOnly && (
              <Tip label={`About ${suggest} min to read ${plural(reading!.words, 'word')}`}>
                <button type="button" className="text-2xs font-medium text-primary hover:underline" onClick={() => onChange({ durationMinutes: suggest }, { immediate: true })}>
                  Use {suggest} min
                </button>
              </Tip>
            )}
          </div>
        </Prop>
        <div className="pt-2">
          <ToggleRow
            id="lesson-optional"
            label="Optional"
            description="Optional lessons don’t count toward completion."
            checked={lesson.optional}
            disabled={readOnly}
            onChange={optional => onChange({ optional }, { immediate: true })}
          />
        </div>
      </Group>

      <Group title="Ready for learners">
        {issues.length ? (
          <ul className="space-y-1.5">
            {issues.map(i => (
              <li key={i} className="flex gap-2 text-[14px] leading-snug">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-warning" />
                <span>{i}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-[14px] text-tone-success">
            <CircleCheck className="h-3.5 w-3.5" /> Nothing to fix
          </p>
        )}
      </Group>

      <Group title="Learners">
        <p className="text-[14px]">{lesson.completedCount ? `${plural(lesson.completedCount, 'person has', 'people have')} completed it` : 'Nobody has completed it yet'}</p>
        {sequential && (
          <p className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" /> This course unlocks lessons in order{lesson.optional ? '. Optional lessons never block the next one.' : ', so learners reach this after the required lessons above it.'}
          </p>
        )}
        {lesson.updatedAt && <p className="text-sm text-muted-foreground">Last edited {timeAgo(lesson.updatedAt)}</p>}
      </Group>

      {!readOnly && (
        <div className="space-y-0.5 px-2 pt-3">
          <>
            <Button variant="ghost" size="sm" className="h-9 w-full justify-start gap-2 px-2 text-[14px] text-muted-foreground" onClick={onDuplicate}>
              <Copy className="!h-3.5 !w-3.5" /> Duplicate lesson
            </Button>
            <Button variant="ghost" size="sm" className="h-9 w-full justify-between gap-2 px-2 text-[14px] text-tone-danger hover:bg-tone-danger/[0.08] hover:text-tone-danger" onClick={onDelete}>
              <span className="inline-flex items-center gap-2"><Trash2 className="!h-3.5 !w-3.5" /> Delete lesson</span>
              <Keys keys={['⌫']} />
            </Button>
          </>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5 border-b px-4 py-4">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2">
      <span className="text-[13.5px] text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
