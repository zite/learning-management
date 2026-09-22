import type { QueryClient } from '@tanstack/react-query';
import type { ReorderOutlineOutputType } from 'zitejs/api';
import { lessonIssues, parseSettings, type AnyLessonSettings, type LessonType } from '@project/shared/lessons';
import { qk } from '../../lib/queries';
import type { CourseDetail, CourseLesson, CourseSection } from '../../lib/types';

/**
 * The builder's view of a course: the outline in the one order every surface
 * uses (lessons outside any section first, then sections by position, lessons
 * by position inside each), plus the small pure operations drags and keyboard
 * moves are made of.
 */

export type LessonPatch = Partial<Pick<CourseLesson, 'title' | 'body' | 'mediaUrl' | 'mediaName' | 'settings' | 'durationMinutes' | 'optional'>>;

export type OutlineGroup = { section: CourseSection | null; lessons: CourseLesson[] };

export type Positions = ReorderOutlineOutputType['positions'];

/** An outline order: sections in order, and each group's lesson ids (`null` = outside any section). */
export type Order = { sectionIds: string[]; groups: Map<string | null, string[]> };

const byPosition = <T extends { position: number }>(items: T[]) =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.position - b.item.position || a.index - b.index)
    .map(x => x.item);

export function buildOutline(detail: Pick<CourseDetail, 'sections' | 'lessons'>) {
  const sections = byPosition(detail.sections);
  const known = new Set(sections.map(s => s.id));
  const lessons = byPosition(detail.lessons);
  const groups: OutlineGroup[] = [{ section: null, lessons: lessons.filter(l => !l.sectionId || !known.has(l.sectionId)) }];
  for (const s of sections) groups.push({ section: s, lessons: lessons.filter(l => l.sectionId === s.id) });
  const ordered = groups.flatMap(g => g.lessons);
  return { groups, ordered, sections };
}

export function orderOf(groups: OutlineGroup[]): Order {
  return {
    sectionIds: groups.filter(g => g.section).map(g => g.section!.id),
    groups: new Map(groups.map(g => [g.section?.id ?? null, g.lessons.map(l => l.id)])),
  };
}

export function sameOrder(a: Order, b: Order) {
  if (a.sectionIds.join() !== b.sectionIds.join()) return false;
  const keys = new Set([...a.groups.keys(), ...b.groups.keys()]);
  for (const k of keys) if ((a.groups.get(k) ?? []).join() !== (b.groups.get(k) ?? []).join()) return false;
  return true;
}

/** Write an order into the cached course (optimistic). */
export function applyOrder(detail: CourseDetail, order: Order): CourseDetail {
  const sectionPos = new Map(order.sectionIds.map((id, i) => [id, i]));
  const lessonPos = new Map<string, { sectionId: string | null; position: number }>();
  for (const [sectionId, ids] of order.groups) ids.forEach((id, i) => lessonPos.set(id, { sectionId, position: i }));
  return {
    ...detail,
    sections: detail.sections.map(s => (sectionPos.has(s.id) ? { ...s, position: sectionPos.get(s.id)! } : s)),
    lessons: detail.lessons.map(l => (lessonPos.has(l.id) ? { ...l, ...lessonPos.get(l.id)! } : l)),
  };
}

/**
 * Settle the cache on the positions the server wrote. Rows the response doesn't
 * mention are left alone — they may have been created a moment ago by another
 * request — so removals are always explicit.
 */
export function applyPositions(detail: CourseDetail, positions: Positions, remove: { lessonIds?: string[]; sectionIds?: string[] } = {}): CourseDetail {
  const s = new Map(positions.sections.map(p => [p.id, p]));
  const l = new Map(positions.lessons.map(p => [p.id, p]));
  const goneLessons = new Set(remove.lessonIds ?? []);
  const goneSections = new Set(remove.sectionIds ?? []);
  return {
    ...detail,
    sections: detail.sections.filter(x => !goneSections.has(x.id)).map(x => (s.has(x.id) ? { ...x, position: s.get(x.id)!.position } : x)),
    lessons: detail.lessons.filter(x => !goneLessons.has(x.id)).map(x => (l.has(x.id) ? { ...x, sectionId: l.get(x.id)!.sectionId, position: l.get(x.id)!.position } : x)),
  };
}

export function toPayload(courseId: string, order: Order) {
  return {
    courseId,
    sections: order.sectionIds.map(id => ({ id, lessonIds: order.groups.get(id) ?? [] })),
    unsectionedLessonIds: order.groups.get(null) ?? [],
  };
}

export function cloneOrder(order: Order): Order {
  return { sectionIds: [...order.sectionIds], groups: new Map([...order.groups].map(([k, v]) => [k, [...v]])) };
}

/**
 * Move a lesson one step up or down the whole outline. At the edge of a
 * section it crosses into the neighbouring one (end of the previous, start of
 * the next), the way people expect ⌥↑/⌥↓ to behave.
 */
export function nudgeLesson(order: Order, lessonId: string, dir: -1 | 1): Order | null {
  const next = cloneOrder(order);
  const keys: Array<string | null> = [null, ...next.sectionIds];
  const gi = keys.findIndex(k => (next.groups.get(k) ?? []).includes(lessonId));
  if (gi < 0) return null;
  const list = next.groups.get(keys[gi])!;
  const i = list.indexOf(lessonId);
  if (dir === -1 && i > 0) {
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    return next;
  }
  if (dir === 1 && i < list.length - 1) {
    [list[i + 1], list[i]] = [list[i], list[i + 1]];
    return next;
  }
  const target = gi + dir;
  if (target < 0 || target >= keys.length) return null;
  list.splice(i, 1);
  const dest = next.groups.get(keys[target]) ?? [];
  if (dir === -1) dest.push(lessonId);
  else dest.unshift(lessonId);
  next.groups.set(keys[target], dest);
  return next;
}

export function patchCourse(qc: QueryClient, courseId: string, fn: (d: CourseDetail) => CourseDetail) {
  qc.setQueryData<CourseDetail>(qk.course(courseId), old => (old ? fn(old) : old));
}

export function issuesFor(lesson: Pick<CourseLesson, 'type' | 'title' | 'body' | 'mediaUrl' | 'settings'>) {
  // Normalise first, the way the server stores it: a half-typed checklist item doesn't count as an item.
  return lessonIssues({ ...lesson, settings: parseSettings(lesson.type as LessonType, lesson.settings) as AnyLessonSettings });
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** ~220 words a minute, never under a minute for something with words in it. */
export function readingMinutes(markdown: string) {
  const words = wordCount(markdown);
  return { words, minutes: words ? Math.max(1, Math.round(words / 220)) : 0 };
}

export function wordCount(markdown: string) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|~-]/g, ' ');
  return text.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

export const lessonLabel = (l: Pick<CourseLesson, 'title'>) => l.title.trim() || 'Untitled lesson';
