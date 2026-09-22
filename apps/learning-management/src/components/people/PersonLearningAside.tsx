import { Award, CalendarClock, Copy, MapPin, Route, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { copyText } from '../../lib/clipboard';
import { shortDate } from '../../lib/format';
import { ProgressBar, Tip } from '../primitives/bits';
import { CourseGlyph, DuePill } from '../primitives/icons';
import type { PersonDetail } from './peopleData';

const CERT_STATE: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-tone-success/[0.1] text-tone-success' },
  expiring: { label: 'Expiring soon', cls: 'bg-tone-warning/[0.12] text-tone-warning' },
  expired: { label: 'Expired', cls: 'bg-tone-danger/[0.1] text-tone-danger' },
  revoked: { label: 'Revoked', cls: 'bg-muted text-muted-foreground line-through decoration-muted-foreground/50' },
};

function Section({ title, icon, count, children, empty }: { title: string; icon: ReactNode; count?: number; children: ReactNode; empty?: string | null }) {
  return (
    <section className="border-b px-4 py-4 last:border-b-0">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-sm font-medium text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
        {icon} {title}
        {count ? <span className="tabular-nums text-muted-foreground/80">{count}</span> : null}
      </h3>
      {empty ? <p className="text-[14px] text-muted-foreground/80">{empty}</p> : children}
    </section>
  );
}

/** Learning paths, certificates and upcoming live sessions, beside the person's course list. */
export function PersonLearningAside({ data }: { data: PersonDetail }) {
  const upcoming = data.sessions;
  const certs = data.certificates;
  const current = new Set<string>();
  // The newest certificate per course or path leads; replaced ones sink to the bottom, muted.
  const ordered = [...certs].sort((a, b) => (b.issuedAt ?? '').localeCompare(a.issuedAt ?? ''));
  const superseded = new Set<string>();
  for (const c of ordered) {
    const key = c.courseId ?? c.pathId ?? c.id;
    if (current.has(key)) superseded.add(c.id);
    else current.add(key);
  }
  const shownCerts = [...ordered.filter(c => !superseded.has(c.id)), ...ordered.filter(c => superseded.has(c.id))];

  return (
    <>
      <Section title="Learning paths" icon={<Route />} count={data.paths.length} empty={data.paths.length ? null : 'Not enrolled in any learning paths.'}>
        <div className="space-y-2">
          {data.paths.map(p => (
            <Link key={p.id} to={`/paths/${p.pathId}`} className="block rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40">
              <div className="flex items-center gap-2">
                <CourseGlyph icon={p.icon} color={p.color} size={20} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{p.title}</span>
                {p.status === 'Completed' ? <span className="text-sm text-tone-success">Done</span> : p.status === 'Withdrawn' ? <span className="text-sm text-muted-foreground">Withdrawn</span> : <DuePill dueDate={p.dueDate} dueState={p.dueState} compact />}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <ProgressBar value={p.progress / 100} tone={p.status === 'Completed' ? 'success' : p.dueState === 'overdue' ? 'danger' : 'primary'} className="h-1" />
                <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                  {p.coursesDone}/{p.coursesTotal} courses
                </span>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Certificates" icon={<Award />} count={certs.length} empty={certs.length ? null : 'No certificates yet. They’re issued when a course or path with certificates is completed.'}>
        <ul className="-mx-1 space-y-0.5">
          {shownCerts.map(c => {
            const meta = CERT_STATE[c.state];
            const old = superseded.has(c.id);
            return (
              <li key={c.id} className={cn('group flex items-start gap-2 rounded-md px-1 py-1.5', old && 'opacity-60')}>
                <Award className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', c.state === 'active' || c.state === 'expiring' ? 'text-flame' : 'text-muted-foreground')} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px]">{c.title}</span>
                    <span className={cn('ml-auto inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-2xs font-medium', old && c.state === 'expired' ? 'bg-muted text-muted-foreground' : meta.cls)}>{old && c.state === 'expired' ? 'Renewed' : meta.label}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-2xs text-muted-foreground">
                    <span className="whitespace-nowrap">Issued {shortDate(c.issuedAt)}</span>
                    {c.expiresAt && <span className={cn('whitespace-nowrap', c.state === 'expired' && !old && 'text-tone-danger', c.state === 'expiring' && 'text-tone-warning')}>· {c.state === 'expired' ? 'Expired' : 'Expires'} {shortDate(c.expiresAt)}</span>}
                  </div>
                  <Tip label="Copy credential ID">
                    <button type="button" onClick={() => copyText(c.credentialId, 'Copied credential ID')} className="mt-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded font-mono text-2xs text-muted-foreground hover:text-foreground">
                      {c.credentialId} <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
                    </button>
                  </Tip>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Upcoming live sessions" icon={<CalendarClock />} count={upcoming.length} empty={upcoming.length ? null : 'Not registered for any upcoming sessions.'}>
        <div className="space-y-1">
          {upcoming.map(s => {
            const d = s.startsAt ? new Date(s.startsAt) : null;
            return (
              <Link key={s.id} to={`/sessions/${s.sessionId}`} className="-mx-1 flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-accent/50">
                <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md border bg-subtle leading-none">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">{d?.toLocaleDateString(undefined, { month: 'short' })}</span>
                  <span className="text-[14px] font-semibold">{d?.getDate()}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[14px]">{s.title}</span>
                    {s.status === 'Waitlisted' && <span className="shrink-0 rounded-full bg-tone-warning/[0.12] px-1.5 text-2xs font-medium text-tone-warning">Waitlist</span>}
                  </span>
                  <span className="flex items-center gap-1 truncate text-2xs text-muted-foreground">
                    {d?.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    {s.location ? (
                      <>
                        {' '}· <MapPin className="h-2.5 w-2.5" /> <span className="truncate">{s.location}</span>
                      </>
                    ) : s.meetingUrl ? (
                      <>
                        {' '}· <Video className="h-2.5 w-2.5" /> Online
                      </>
                    ) : null}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </Section>
    </>
  );
}
