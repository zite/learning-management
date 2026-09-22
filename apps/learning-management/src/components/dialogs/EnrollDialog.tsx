import { CalendarDays, GraduationCap, Plus, Route, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import type { EnrollIntent } from '../../lib/app-actions';
import { addDays, shortDate } from '../../lib/format';
import { useEnrollmentActions } from '../../lib/mutations';
import { usePeopleSearch } from '../../lib/queries';
import type { PersonLite } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { Kbd, LabelDot } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { CoursePicker, DatePicker, GroupPicker, PathPicker, PersonPicker } from '../pickers/pickers';

/**
 * Assign a course or learning path to people and groups, with a due date.
 * Opened from anywhere (a course, a person, a group, a list selection, ⇧E).
 * Enrolling is idempotent on the server, so re-running it for a group after
 * new people join only adds the newcomers.
 */
export function EnrollDialog({ open, onOpenChange, intent }: { open: boolean; onOpenChange: (o: boolean) => void; intent?: EnrollIntent }) {
  const ws = useWorkspace();
  const { assign } = useEnrollmentActions();
  const [targetType, setTargetType] = useState<'Course' | 'Path'>('Course');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [known, setKnown] = useState<Map<string, PersonLite>>(new Map());
  const { data: resolved } = usePeopleSearch('', { ids: personIds.filter(id => !known.has(id)), enabled: open && personIds.some(id => !known.has(id)) });

  useEffect(() => {
    if (!resolved) return;
    setKnown(prev => {
      const next = new Map(prev);
      for (const p of resolved.people) next.set(p.id, p);
      return next;
    });
  }, [resolved]);

  useEffect(() => {
    if (!open) return;
    const t = intent?.targetType ?? 'Course';
    setTargetType(t);
    setTargetId(intent?.targetId ?? null);
    setPersonIds(intent?.personIds ?? []);
    setGroupIds(intent?.groupIds ?? []);
    setSendEmail(true);
    setBusy(false);
  }, [open, intent]);

  const target = targetType === 'Course' ? (targetId ? ws.courseById.get(targetId) : undefined) : targetId ? ws.pathById.get(targetId) : undefined;
  useEffect(() => {
    // Default the due date from the course or path's own window.
    if (!open) return;
    setDueDate(target?.dueDays ? addDays(target.dueDays) : null);
  }, [open, targetId, targetType, target?.dueDays]);

  const groupPeople = useMemo(() => groupIds.reduce((n, id) => n + (ws.groupById.get(id)?.memberCount ?? 0), 0), [groupIds, ws.groupById]);
  const unpublished = target && target.status !== 'Published';
  const canSubmit = Boolean(target) && !unpublished && (personIds.length > 0 || groupIds.length > 0) && !busy;

  const submit = async () => {
    if (!canSubmit || !target) return;
    setBusy(true);
    try {
      await assign({ targetType, targetId: target.id, personIds, groupIds, dueDate, sendEmail }, target.title);
      onOpenChange(false);
    } catch {
      setBusy(false);
    }
  };

  const chipBtn = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-2 text-[13.5px] text-muted-foreground hover:border-foreground/30 hover:text-foreground';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[560px] gap-0 p-0 sm:rounded-xl"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader className="border-b px-5 pb-3.5 pt-4">
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <GraduationCap className="h-4 w-4 text-muted-foreground" /> Enroll people
          </DialogTitle>
          <DialogDescription className="text-[14px]">Assign a course or learning path. People already enrolled are skipped.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-5 py-4">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Training</span>
              <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label="Enroll in">
                {(['Course', 'Path'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={targetType === t}
                    onClick={() => {
                      setTargetType(t);
                      setTargetId(null);
                    }}
                    className={cn('flex h-6 items-center gap-1.5 rounded px-2 text-sm', targetType === t ? 'bg-accent font-medium text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground')}
                  >
                    {t === 'Course' ? 'Course' : <><Route className="h-3 w-3" /> Learning path</>}
                  </button>
                ))}
              </div>
            </div>
            {targetType === 'Course' ? (
              <CoursePicker
                publishedOnly
                value={targetId}
                onChange={v => setTargetId(v)}
                trigger={
                  <button type="button" className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-input bg-background px-3 text-left text-[14px] shadow-2xs hover:bg-accent/40">
                    {target ? <CourseGlyph icon={target.icon} color={target.color} size={20} /> : <span className="h-5 w-5 rounded-[5px] border border-dashed border-input" />}
                    <span className={cn('flex-1 truncate', !target && 'text-muted-foreground')}>{target?.title ?? 'Choose a course…'}</span>
                  </button>
                }
              />
            ) : (
              <PathPicker
                publishedOnly
                value={targetId}
                onChange={v => setTargetId(v)}
                trigger={
                  <button type="button" className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-input bg-background px-3 text-left text-[14px] shadow-2xs hover:bg-accent/40">
                    {target ? <CourseGlyph icon={target.icon} color={target.color} size={20} /> : <span className="h-5 w-5 rounded-[5px] border border-dashed border-input" />}
                    <span className={cn('flex-1 truncate', !target && 'text-muted-foreground')}>{target?.title ?? 'Choose a learning path…'}</span>
                    {target && 'courseIds' in target && <span className="text-sm text-muted-foreground">{target.courseIds.length} courses</span>}
                  </button>
                }
              />
            )}
            {unpublished && <p className="mt-1.5 text-sm text-tone-warning">Publish this {targetType === 'Course' ? 'course' : 'path'} before enrolling people.</p>}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Who</span>
              {(personIds.length > 0 || groupIds.length > 0) && (
                <span className="text-sm tabular-nums text-muted-foreground">
                  {personIds.length > 0 && `${personIds.length} ${personIds.length === 1 ? 'person' : 'people'}`}
                  {personIds.length > 0 && groupIds.length > 0 && ' + '}
                  {groupIds.length > 0 && `${groupIds.length} group${groupIds.length === 1 ? '' : 's'} (${groupPeople} people)`}
                </span>
              )}
            </div>
            <div className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background p-2">
              {groupIds.map(id => {
                const g = ws.groupById.get(id);
                if (!g) return null;
                return (
                  <span key={id} className="chip h-8 bg-subtle pr-1">
                    <LabelDot color={g.color} />
                    {g.name}
                    <span className="text-muted-foreground">· {g.memberCount}</span>
                    <button type="button" onClick={() => setGroupIds(ids => ids.filter(x => x !== id))} aria-label={`Remove ${g.name}`} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              {personIds.map(id => {
                const p = known.get(id);
                return (
                  <span key={id} className="chip h-8 bg-subtle pl-1 pr-1">
                    <PersonAvatar person={p ?? { name: '…' }} size={18} />
                    {p?.name ?? 'Loading…'}
                    <button type="button" onClick={() => setPersonIds(ids => ids.filter(x => x !== id))} aria-label={`Remove ${p?.name ?? 'person'}`} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              <PersonPicker
                multiple
                value={personIds}
                onChange={setPersonIds}
                onPeopleSeen={people =>
                  setKnown(prev => {
                    if (people.every(p => prev.get(p.id) === p)) return prev;
                    const next = new Map(prev);
                    for (const p of people) next.set(p.id, p);
                    return next;
                  })
                }
                trigger={<button type="button" className={chipBtn}><Plus className="h-3.5 w-3.5" /> People</button>}
              />
              <GroupPicker value={groupIds} onChange={setGroupIds} trigger={<button type="button" className={chipBtn}><UsersRound className="h-3.5 w-3.5" /> Groups</button>} />
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium text-muted-foreground">Due date</div>
              <DatePicker
                value={dueDate}
                onChange={setDueDate}
                clearLabel="No due date"
                trigger={
                  <button type="button" className="flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-[14px] shadow-2xs hover:bg-accent/40">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className={cn(!dueDate && 'text-muted-foreground')}>{dueDate ? shortDate(dueDate) : 'No due date'}</span>
                  </button>
                }
              />
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5">
              <Switch checked={sendEmail} onCheckedChange={setSendEmail} className="mt-0.5" />
              <span>
                <span className="block text-[14px] font-medium">Notify by email</span>
                <span className="block text-sm text-muted-foreground">Sends the “{targetType === 'Course' ? 'Course' : 'Path'} assigned” template</span>
              </span>
            </label>
          </section>
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-subtle/60 px-5 py-3">
          <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>↵</Kbd> to enroll
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
              Cancel
            </button>
            <button type="button" disabled={!canSubmit} onClick={submit} className="h-9 rounded-md bg-primary px-3.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
              {busy ? 'Enrolling…' : 'Enroll'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
