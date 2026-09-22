import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Award, Check, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { rateCourse } from 'zitejs/api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { CertificateArt } from '@project/shared/ui/CertificateArt';
import { firstName } from '@project/shared/merge';
import { errorMessage } from '../../lib/errors';
import { Button, textareaClass } from '../ui';
import { prefersReducedMotion, StarInput } from './bits';
import { playerKeys, type CertificateInfo, type Player } from './queries';

/**
 * The moment a course is finished: a little ceremony, the certificate they
 * just earned, a chance to say how it was, and where to go next.
 */

// The academy's own colour, warm amber and paper — a celebration that still looks like the academy.
const CONFETTI_COLORS = ['hsl(var(--primary))', 'hsl(var(--primary) / 0.55)', '#e8a317', '#f3d9a4', 'hsl(var(--foreground) / 0.18)'];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.9,
        duration: 2.6 + Math.random() * 2.2,
        rotate: Math.random() * 720 - 360,
        drift: Math.random() * 160 - 80,
        size: 6 + Math.random() * 7,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: Math.random() > 0.65,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <style>{`@keyframes lms-confetti{0%{transform:translate3d(0,-10vh,0) rotate(0);opacity:1}85%{opacity:1}100%{transform:translate3d(var(--drift),105vh,0) rotate(var(--rot));opacity:0}}`}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={
            {
              position: 'absolute',
              top: 0,
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              borderRadius: p.round ? '999px' : '2px',
              background: p.color,
              animation: `lms-confetti ${p.duration}s cubic-bezier(0.25, 0.6, 0.4, 1) ${p.delay}s both`,
              '--drift': `${p.drift}px`,
              '--rot': `${p.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function Celebration({ open, onOpenChange, player, certificate }: { open: boolean; onOpenChange: (open: boolean) => void; player: Player; certificate: CertificateInfo | null }) {
  const reduced = prefersReducedMotion();
  const name = firstName(player.learner.name);
  const lessons = player.lessons.filter(l => !l.optional).length || player.lessons.length;
  const next = player.path?.nextCourse;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby="celebration-description"
          className="fixed inset-0 z-[60] overflow-y-auto bg-background focus:outline-none data-[state=open]:animate-fade-in"
          onOpenAutoFocus={e => {
            e.preventDefault();
            (document.getElementById('celebration-primary') as HTMLElement | null)?.focus();
          }}
        >
          {!reduced && <Confetti />}

          <DialogPrimitive.Close className="absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close and keep reviewing the course">
            <X className="h-5 w-5" aria-hidden />
          </DialogPrimitive.Close>

          <div className="relative mx-auto flex min-h-full max-w-2xl flex-col items-center px-5 pb-16 pt-16 text-center sm:pt-24">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Course complete</p>
            <DialogPrimitive.Title className="mt-2 font-serif text-[2.1rem] font-semibold leading-tight sm:text-5xl">You completed {player.course.title}</DialogPrimitive.Title>
            <DialogPrimitive.Description id="celebration-description" className="mx-auto mt-3 max-w-md text-[16px] text-muted-foreground">
              {`All ${lessons} lesson${lessons === 1 ? '' : 's'} done${name ? `. Well done, ${name}` : ''}.`} {certificate ? 'Your certificate is ready.' : ''}
            </DialogPrimitive.Description>

            {certificate && (
              <div className="mt-8 w-full max-w-lg animate-fade-up" style={{ animationDelay: '180ms' }}>
                <Link to={`/certificates/${certificate.id}`} className="block rounded-[1.2cqw] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" aria-label="Open your certificate">
                  <CertificateArt
                    recipientName={certificate.recipientName || player.learner.name}
                    title={certificate.title || player.course.title}
                    organizationName={player.academy.organizationName}
                    academyName={player.academy.academyName}
                    certificateTitle={player.academy.certificateTitle}
                    issuedAt={certificate.issuedAt}
                    expiresAt={certificate.expiresAt}
                    credentialId={certificate.credentialId}
                    signatory={player.academy.certificateSignatory}
                    signatoryTitle={player.academy.certificateSignatoryTitle}
                    logoUrl={player.academy.logoUrl}
                    brandColor={player.academy.brandColor}
                  />
                </Link>
              </div>
            )}

            <div className="mt-8 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
              {certificate ? (
                <Link id="celebration-primary" to={`/certificates/${certificate.id}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-base font-medium text-primary-foreground shadow-xs hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
                  <Award className="h-[18px] w-[18px]" aria-hidden /> View certificate
                </Link>
              ) : next ? (
                <Link id="celebration-primary" to={`/courses/${next.slug}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-base font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                  Next: {next.title} <ArrowRight className="h-[18px] w-[18px]" aria-hidden />
                </Link>
              ) : null}
              <Link id={certificate || next ? undefined : 'celebration-primary'} to="/learning" className="inline-flex h-12 items-center justify-center rounded-lg border bg-background px-6 text-base font-medium hover:bg-accent">
                Back to my learning
              </Link>
            </div>
            {certificate && next && (
              <Link to={`/courses/${next.slug}`} className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-medium text-primary hover:underline">
                Up next in {player.path?.title}: {next.title} <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )}

            <div className="mt-12 w-full max-w-md rounded-2xl border bg-card p-5 text-left shadow-sm sm:p-6">
              <RatingForm player={player} compact />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function RatingForm({ player, compact, onDone }: { player: Player; compact?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(player.enrollment?.rating ?? 0);
  const [review, setReview] = useState(player.enrollment?.review ?? '');
  const [sent, setSent] = useState(false);
  const mutation = useMutation({
    mutationFn: () => rateCourse({ courseSlug: player.course.slug, rating, review: review.trim() || undefined }),
    onSuccess: res => {
      setSent(true);
      qc.setQueryData<Player>(playerKeys.player(player.course.slug), prev => (prev?.enrollment ? { ...prev, enrollment: { ...prev.enrollment, rating: res.rating, review: res.review } } : prev));
      for (const root of ['course', 'learning', 'catalog']) void qc.invalidateQueries({ queryKey: [root] });
      if (!compact) toast.success('Thanks for rating the course.');
      onDone?.();
    },
    onError: e => toast.error(errorMessage(e, "Couldn't save your rating. Try again.")),
  });

  if (sent && compact) {
    return (
      <div className="flex items-center gap-3 py-2" role="status">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-tone-success text-white dark:text-[hsl(30_8%_7%)]" aria-hidden>
          <Check className="h-3 w-3" strokeWidth={3.2} />
        </span>
        <p className="text-[15px]">Thanks — your feedback helps shape this course.</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (rating) mutation.mutate();
      }}
    >
      <p className="text-center text-[16px] font-semibold">How was this course?</p>
      <p className="mb-2 text-center text-sm text-muted-foreground">Your rating goes to the people who made it.</p>
      <StarInput value={rating} onChange={setRating} />
      {rating > 0 && (
        <div className="mt-3 animate-fade-in">
          <label htmlFor="course-review" className="text-sm font-medium">
            Anything to add? <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="course-review"
            value={review}
            onChange={e => setReview(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && rating && !mutation.isPending) {
                e.preventDefault();
                mutation.mutate();
              }
            }}
            maxLength={2000} rows={3} placeholder="What worked, what could be better…" className={textareaClass('mt-1.5 min-h-[88px] text-[15px]')} />
          <Button type="submit" className="mt-3 w-full" loading={mutation.isPending}>
            {player.enrollment?.rating ? 'Update rating' : 'Send rating'}
          </Button>
        </div>
      )}
    </form>
  );
}

export function RatingDialog({ open, onOpenChange, player }: { open: boolean; onOpenChange: (open: boolean) => void; player: Player }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-xl p-6">
        <DialogTitle className="sr-only">Rate {player.course.title}</DialogTitle>
        <DialogDescription className="sr-only">Pick one to five stars and optionally leave a review.</DialogDescription>
        <RatingForm player={player} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
