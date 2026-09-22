/**
 * Merge tags for email templates: `{{learner_first_name}}` and friends.
 *
 * Unknown tags render as empty rather than leaking braces into an email, and
 * the preview in Settings uses the same function the send path does.
 */

export const MERGE_TAGS: Array<{ tag: string; label: string; sample: string }> = [
  { tag: 'learner_name', label: 'Learner name', sample: 'Priya Natarajan' },
  { tag: 'learner_first_name', label: 'Learner first name', sample: 'Priya' },
  { tag: 'learner_email', label: 'Learner email', sample: 'priya@example.com' },
  { tag: 'organization_name', label: 'Your organization', sample: 'Fernwood Supply Co.' },
  { tag: 'academy_name', label: 'Academy name', sample: 'Fernwood Academy' },
  { tag: 'course_title', label: 'Course or path title', sample: 'Security Awareness Essentials' },
  { tag: 'due_date', label: 'Due date', sample: 'October 15, 2026' },
  { tag: 'days_left', label: 'Days until due', sample: '3 days' },
  { tag: 'course_link', label: 'Link to the course', sample: 'https://learn.example.com/#/courses/…' },
  { tag: 'credential_id', label: 'Certificate credential ID', sample: 'LX7K-9QPM-3RTA' },
  { tag: 'certificate_link', label: 'Link to the certificate', sample: 'https://learn.example.com/#/certificates/…' },
  { tag: 'expires_on', label: 'Certificate expiry date', sample: 'October 15, 2027' },
  { tag: 'grade', label: 'Assignment grade', sample: '88' },
  { tag: 'feedback', label: 'Instructor feedback', sample: 'Clear, well-structured plan — nice work on the risk section.' },
  { tag: 'lesson_title', label: 'Lesson title', sample: 'Write your incident response plan' },
  { tag: 'session_title', label: 'Session title', sample: 'Live Q&A: Handling difficult customers' },
  { tag: 'session_time', label: 'Session date and time', sample: 'October 2, 2026 at 11:00 AM EDT' },
  { tag: 'session_location', label: 'Session location or link', sample: 'Zoom — link in the academy' },
  { tag: 'manager_name', label: 'Manager name', sample: 'Marcus Chen' },
  { tag: 'overdue_list', label: 'Overdue training (manager digest)', sample: '• Dana Ruiz — Security Awareness Essentials (due Sep 30)' },
  { tag: 'academy_link', label: 'Link to the academy', sample: 'https://learn.example.com' },
];

export type MergeContext = Partial<Record<(typeof MERGE_TAGS)[number]['tag'], string>>;

export function renderMerge(template: string, ctx: MergeContext) {
  return (template ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, tag: string) => {
    const v = (ctx as Record<string, string | undefined>)[tag.toLowerCase()];
    return v == null ? '' : String(v);
  });
}

export const sampleMergeContext = (): MergeContext => Object.fromEntries(MERGE_TAGS.map(t => [t.tag, t.sample]));

export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

export function formatDateTime(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timeZone || 'UTC', timeZoneName: 'short' })
      .format(d)
      .replace(/, (\d{1,2}:\d{2})/, ' at $1');
  } catch {
    return d.toUTCString();
  }
}

export function formatLongDay(day: string | null | undefined) {
  if (!day) return '';
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(d);
}
