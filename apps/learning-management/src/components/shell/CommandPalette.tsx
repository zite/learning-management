import {
  Award, BarChart3, BookOpen, CalendarClock, Check, ClipboardCheck, ExternalLink, GraduationCap, Home, Inbox, Keyboard, Laptop, Layers, MessagesSquare, Moon, Route, Settings, Sparkles, Sun, UserPlus, Users, UsersRound, Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@project/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@project/components/ui/dialog';
import { useAppActions } from '../../lib/app-actions';
import { useSearch } from '../../lib/queries';
import { useTheme } from '../../lib/theme';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { Kbd } from '../primitives/bits';
import { CourseGlyph, LessonTypeIcon } from '../primitives/icons';
import { guardedNavigate } from '../../lib/navGuard';
import { GO_KEYS } from './ShortcutsDialog';

const itemCls = 'h-9 gap-2.5 rounded-md px-2.5 text-[14px] [&_svg]:text-muted-foreground';

const NAV_ICONS: Record<string, typeof Home> = {
  '/home': Home,
  '/inbox': Inbox,
  '/grading': ClipboardCheck,
  '/discussions': MessagesSquare,
  '/courses': BookOpen,
  '/paths': Route,
  '/sessions': CalendarClock,
  '/people': Users,
  '/groups': UsersRound,
  '/enrollments': Layers,
  '/assignments': Workflow,
  '/certificates': Award,
  '/reports': BarChart3,
  '/settings': Settings,
};

/**
 * ⌘K. Find any person, course, lesson, path, group or session; jump anywhere;
 * and start the common actions — enroll people, create a course — without
 * touching the mouse.
 */
export function CommandPalette({ open, onOpenChange, initialQuery = '' }: { open: boolean; onOpenChange: (o: boolean) => void; initialQuery?: string }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const { setPref, pref } = useTheme();
  const [query, setQuery] = useState(initialQuery);
  const { data, isFetching } = useSearch(open ? query : '');

  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  const go = (to: string) => {
    onOpenChange(false);
    guardedNavigate(navigate, app.confirm, to);
  };
  const run = (fn: () => void) => {
    onOpenChange(false);
    setTimeout(fn, 0);
  };

  const q = query.trim().toLowerCase();
  const courses = useMemo(() => (q ? ws.orderedCourses.filter(c => c.title.toLowerCase().includes(q)).slice(0, 6) : []), [ws.orderedCourses, q]);
  const paths = useMemo(() => (q ? ws.orderedPaths.filter(p => p.title.toLowerCase().includes(q)).slice(0, 4) : []), [ws.orderedPaths, q]);
  const groups = useMemo(() => (q ? ws.groups.filter(g => g.name.toLowerCase().includes(q)).slice(0, 4) : []), [ws.groups, q]);
  const views = useMemo(() => (q ? ws.views.filter(v => v.name.toLowerCase().includes(q)).slice(0, 4) : []), [ws.views, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[14vh] max-w-[640px] translate-y-0 gap-0 overflow-hidden p-0 shadow-2xl data-[state=closed]:slide-out-to-top-[2%] data-[state=open]:slide-in-from-top-[2%] sm:rounded-xl [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <Command loop className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search people, courses, lessons — or type a command…" className="h-12 text-[15px]" />
          <CommandList className="max-h-[min(460px,62vh)] p-1.5">
            <CommandEmpty className="py-8 text-center text-[14px] text-muted-foreground">{isFetching ? 'Searching…' : 'No results'}</CommandEmpty>

            {courses.length > 0 && (
              <CommandGroup heading="Courses">
                {courses.map(c => (
                  <CommandItem key={c.id} value={`course ${c.title} ${query}`} className={itemCls} onSelect={() => go(`/courses/${c.id}`)}>
                    <CourseGlyph icon={c.icon} color={c.color} size={18} />
                    <span className="truncate">{c.title}</span>
                    <span className="ml-auto text-sm text-muted-foreground">{c.status === 'Published' ? `${c.counts.enrolled} enrolled` : c.status}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data && q && data.people.length > 0 && (
              <CommandGroup heading="People">
                {data.people.map(p => (
                  <CommandItem key={p.id} value={`person ${p.name} ${p.email} ${query}`} className={itemCls} onSelect={() => go(`/people/${p.id}`)}>
                    <PersonAvatar person={p} size={18} />
                    <span className="truncate">{p.name}</span>
                    <span className="truncate text-sm text-muted-foreground">{p.title || p.email}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {paths.length > 0 && (
              <CommandGroup heading="Learning paths">
                {paths.map(p => (
                  <CommandItem key={p.id} value={`path ${p.title} ${query}`} className={itemCls} onSelect={() => go(`/paths/${p.id}`)}>
                    <CourseGlyph icon={p.icon} color={p.color} size={18} />
                    <span className="truncate">{p.title}</span>
                    <span className="ml-auto text-sm text-muted-foreground">{p.courseIds.length} courses</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data && q && data.lessons.length > 0 && (
              <CommandGroup heading="Lessons">
                {data.lessons.map(l => (
                  <CommandItem key={l.id} value={`lesson ${l.title} ${l.courseTitle} ${query}`} className={itemCls} onSelect={() => go(`/courses/${l.courseId}/content/${l.id}`)}>
                    <LessonTypeIcon type={l.type} className="!h-4 !w-4" />
                    <span className="truncate">{l.title}</span>
                    <span className="ml-auto max-w-[200px] truncate text-sm text-muted-foreground">{l.courseTitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {groups.length > 0 && (
              <CommandGroup heading="Groups">
                {groups.map(g => (
                  <CommandItem key={g.id} value={`group ${g.name} ${query}`} className={itemCls} onSelect={() => go(`/groups/${g.id}`)}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                    <span className="truncate">{g.name}</span>
                    <span className="ml-auto text-sm text-muted-foreground">{g.memberCount} people</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data && q && data.sessions.length > 0 && (
              <CommandGroup heading="Live sessions">
                {data.sessions.map(s => (
                  <CommandItem key={s.id} value={`session ${s.title} ${query}`} className={itemCls} onSelect={() => go(`/sessions/${s.id}`)}>
                    <CalendarClock /> <span className="truncate">{s.title}</span>
                    <span className="ml-auto text-sm text-muted-foreground">{s.startsAt ? new Date(s.startsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {views.length > 0 && (
              <CommandGroup heading="Views">
                {views.map(v => (
                  <CommandItem key={v.id} value={`view ${v.name}`} className={itemCls} onSelect={() => go(`/view/${v.id}`)}>
                    <Layers /> {v.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup heading="Actions">
              <CommandItem value="Enroll people assign training course path" className={itemCls} onSelect={() => run(() => app.openEnroll(app.contextCourseId ? { targetType: 'Course', targetId: app.contextCourseId } : undefined))}>
                <GraduationCap /> Enroll people… <Kbd className="ml-auto">⇧E</Kbd>
              </CommandItem>
              <CommandItem value="Create new course" className={itemCls} onSelect={() => run(() => app.openCreateCourse())}>
                <BookOpen /> New course
              </CommandItem>
              {ws.features.ai && (
                <CommandItem value="Draft a course with AI generate" className={itemCls} onSelect={() => run(() => app.openCreateCourse())}>
                  <Sparkles /> Draft a course with AI
                </CommandItem>
              )}
              <CommandItem value="Create learning path" className={itemCls} onSelect={() => run(() => app.openCreatePath())}>
                <Route /> New learning path
              </CommandItem>
              <CommandItem value="Schedule a live session" className={itemCls} onSelect={() => run(() => app.openCreateSession(app.contextCourseId ?? undefined))}>
                <CalendarClock /> Schedule a live session
              </CommandItem>
              {ws.isAdmin && (
                <CommandItem value="Invite people add learners import" className={itemCls} onSelect={() => run(() => app.openInvite())}>
                  <UserPlus /> Add or invite people
                </CommandItem>
              )}
            </CommandGroup>

            <CommandSeparator className="my-1" />
            <CommandGroup heading="Navigation">
              {GO_KEYS.filter(n => n.to !== '/settings' || ws.isStaff).map(n => {
                const Icon = NAV_ICONS[n.to] ?? Layers;
                return (
                  <CommandItem key={n.to} value={`Go to ${n.label}`} className={itemCls} onSelect={() => go(n.to)}>
                    <Icon /> Go to {n.label}
                    <span className="ml-auto flex items-center gap-1">
                      <Kbd>G</Kbd>
                      <Kbd>{n.key.toUpperCase()}</Kbd>
                    </span>
                  </CommandItem>
                );
              })}
              {ws.settings.learnUrl && (
                <CommandItem value="Open the academy learner app" className={itemCls} onSelect={() => run(() => window.open(ws.settings.learnUrl!, '_blank', 'noopener'))}>
                  <ExternalLink /> Open {ws.settings.academyName}
                </CommandItem>
              )}
            </CommandGroup>

            <CommandGroup heading="Preferences">
              {([['light', 'Switch to light theme', Sun], ['dark', 'Switch to dark theme', Moon], ['system', 'Use system theme', Laptop]] as const).map(([value, label, Icon]) => (
                <CommandItem key={value} value={label} className={itemCls} onSelect={() => run(() => setPref(value))}>
                  <Icon /> {label}
                  {pref === value && <Check className="ml-auto h-3.5 w-3.5" />}
                </CommandItem>
              ))}
              <CommandItem value="Keyboard shortcuts help" className={itemCls} onSelect={() => run(() => app.openShortcuts())}>
                <Keyboard /> Keyboard shortcuts <Kbd className="ml-auto">?</Kbd>
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-2xs text-muted-foreground">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> select</span>
            <span className="ml-auto flex items-center gap-1"><Kbd>esc</Kbd> close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
