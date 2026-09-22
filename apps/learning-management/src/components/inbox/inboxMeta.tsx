import {
  AtSign, Bell, CalendarCheck, ClipboardCheck, FileInput, GraduationCap, MessageCircleQuestion, Star, TriangleAlert, Workflow, type LucideIcon,
} from 'lucide-react';
import { cn } from '@project/components/lib/utils';
import { Avatar } from '../primitives/Avatar';
import type { InboxItem } from './inboxData';

type Tone = 'info' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral' | 'flame';

export const TYPE_META: Record<string, { icon: LucideIcon; label: string; tone: Tone }> = {
  submission_received: { icon: FileInput, label: 'Submission to grade', tone: 'info' },
  question_posted: { icon: MessageCircleQuestion, label: 'Learner question', tone: 'accent' },
  course_completed: { icon: GraduationCap, label: 'Course completed', tone: 'success' },
  course_rated: { icon: Star, label: 'Course rated', tone: 'flame' },
  report_overdue: { icon: TriangleAlert, label: 'Overdue training', tone: 'danger' },
  session_registration: { icon: CalendarCheck, label: 'Session registration', tone: 'success' },
  rule_ran: { icon: Workflow, label: 'Assignment rule ran', tone: 'neutral' },
  mention: { icon: AtSign, label: 'Mention', tone: 'accent' },
  submission_graded: { icon: ClipboardCheck, label: 'Submission graded', tone: 'success' },
};

export const typeMeta = (type: string) => TYPE_META[type] ?? { icon: Bell, label: 'Update', tone: 'neutral' as Tone };

const TONE_TEXT: Record<Tone, string> = {
  info: 'text-tone-info',
  accent: 'text-tone-accent',
  success: 'text-tone-success',
  warning: 'text-tone-warning',
  danger: 'text-tone-danger',
  neutral: 'text-muted-foreground',
  flame: 'text-flame',
};

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  const meta = typeMeta(type);
  const Icon = meta.icon;
  return <Icon className={cn(TONE_TEXT[meta.tone], className)} strokeWidth={2.25} />;
}

/** Who did it — or the system bell — with the kind of event badged on the corner. */
export function ActorAvatar({ item, size = 28 }: { item: InboxItem; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {item.actorName ? (
        <Avatar name={item.actorName} src={item.actorAvatarUrl} color={item.actorColor} size={size} />
      ) : (
        <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full border bg-subtle text-muted-foreground" style={{ width: size, height: size }}>
          <Bell style={{ width: size * 0.5, height: size * 0.5 }} />
        </span>
      )}
      <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border bg-background shadow-xs">
        <TypeIcon type={item.type} className="h-2.5 w-2.5" />
      </span>
    </span>
  );
}

/** "Brandon Kowalski submitted …" → the actor's name, then what they did, so the name can carry the weight. */
export function splitTitle(item: Pick<InboxItem, 'title' | 'actorName'>): { actor: string | null; rest: string } {
  const name = item.actorName?.trim();
  if (name && item.title.startsWith(name)) return { actor: name, rest: item.title.slice(name.length) };
  return { actor: null, rest: item.title };
}

/** What "Open" does, named for where it goes. Only in-app routes count. */
export function destinationFor(item: InboxItem): { to: string; label: string } | null {
  const link = item.link?.trim();
  if (!link || !link.startsWith('/')) return null;
  if (link.startsWith('/grading/')) return { to: link, label: 'Grade submission' };
  if (link.startsWith('/grading')) return { to: link, label: 'Open grading' };
  if (link.startsWith('/discussions')) return { to: link, label: link.includes('thread=') ? 'Answer question' : 'Open discussions' };
  if (link.startsWith('/courses/')) return { to: link, label: item.courseTitle ? `Open ${item.courseTitle}` : 'Open course' };
  if (link.startsWith('/paths/')) return { to: link, label: item.pathTitle ? `Open ${item.pathTitle}` : 'Open path' };
  if (link.startsWith('/sessions')) return { to: link, label: 'Open session' };
  if (link.startsWith('/people/')) return { to: link, label: 'Open profile' };
  if (link.startsWith('/assignments')) return { to: link, label: 'Open assignment rules' };
  if (link.startsWith('/enrollments')) return { to: link, label: 'Open enrollments' };
  if (link.startsWith('/certificates')) return { to: link, label: 'Open certificates' };
  if (link.startsWith('/reports')) return { to: link, label: 'Open reports' };
  return { to: link, label: 'Open' };
}
