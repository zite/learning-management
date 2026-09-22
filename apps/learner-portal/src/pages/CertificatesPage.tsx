import { Award, Check, Compass, Download, Link2, RotateCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { StandingText, useCertificatePdf, useCopy } from '../components/me/certificates';
import { CertificateThumb, LoadError, PageHeader } from '../components/kit';
import { Button, Card, Container, EmptyState, LinkButton, SectionHeading, Skeleton } from '../components/ui';
import { certShortDate } from '../lib/certDates';
import { useMyCertificates, type CertificateOrg, type MyCertificates } from '../lib/learn';
import { verifyLink } from '../lib/learnFormat';
import { useMe } from '../lib/queries';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Cert = MyCertificates['certificates'][number];

export function CertificatesPage() {
  const q = useMyCertificates();
  const me = useMe();
  useDocumentTitle('Certificates');

  const current = q.data?.certificates.filter(c => c.state === 'active' || c.state === 'expiring') ?? [];
  const past = q.data?.certificates.filter(c => c.state === 'expired' || c.state === 'revoked') ?? [];

  return (
    <div>
      <PageHeader title="Certificates" description="Proof of what you've completed. Download a PDF, share a verification link, or add one to your LinkedIn profile." />
      <Container className="py-8 sm:py-10">
        {q.isPending ? (
          <div aria-hidden>
            <Skeleton className="mb-4 h-7 w-40" />
            <ul className="divide-y border-y">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 py-5 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-x-5">
                  <Skeleton className="aspect-[1.414/1] rounded-md" />
                  <div className="space-y-2 pt-1">
                    <Skeleton className="h-5 w-2/3 max-w-xs" />
                    <Skeleton className="h-4 w-1/2 max-w-[14rem]" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} title="Your certificates didn't load" />
        ) : q.data.certificates.length === 0 ? (
          <Card>
            <EmptyState
              icon={Award}
              title="No certificates yet"
              action={
                <>
                  <LinkButton to="/learning">Go to my learning</LinkButton>
                  {me.data?.features.selfEnrollment && (
                    <LinkButton to="/catalog" variant="secondary">
                      <Compass /> Explore the catalog
                    </LinkButton>
                  )}
                </>
              }
            >
              Finish a course or learning path that awards a certificate and it will appear here, ready to download, print or share.
            </EmptyState>
          </Card>
        ) : (
          <div className="space-y-12">
            {current.length > 0 ? (
              <CertificateList id="current" title="Current" list={current} org={q.data.org} />
            ) : (
              <section aria-labelledby="certs-current">
                <SectionHeading id="certs-current" count={0}>
                  Current
                </SectionHeading>
                <p className="text-[15px] text-muted-foreground">None of your certificates are current.</p>
                {past.some(c => c.state === 'expired' && !c.renewal && c.slug) && <p className="mt-1 text-[15px] text-muted-foreground">Retake an expired course below to earn a new one.</p>}
              </section>
            )}
            {past.length > 0 && <CertificateList id="past" title="Expired and revoked" list={past} org={q.data.org} />}
          </div>
        )}
      </Container>
    </div>
  );
}

function CertificateList({ id, title, list, org }: { id: string; title: string; list: Cert[]; org: CertificateOrg }) {
  return (
    <section aria-labelledby={`certs-${id}`}>
      <SectionHeading id={`certs-${id}`} count={list.length}>
        {title}
      </SectionHeading>
      <ul className="-mt-4 divide-y">
        {list.map(c => (
          <CertificateRow key={c.id} c={c} org={org} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One certificate as a row: a small copy of the certificate itself, what it's
 * for and when it was issued, its standing as quiet text, and the one or two
 * things you'd do with it — share and download while it's current, renew or
 * find the replacement once it isn't.
 */
function CertificateRow({ c, org }: { c: Cert; org: CertificateOrg }) {
  const lapsed = c.state === 'expired' || c.state === 'revoked';
  const current = !lapsed;
  const to = `/certificates/${c.id}`;
  const pdf = useCertificatePdf(c.id, c.credentialId, c.verifyUrl);
  const { copied, copy } = useCopy();

  return (
    <li className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 py-5 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-center sm:gap-x-5">
      <Link to={to} tabIndex={-1} aria-hidden className="block self-start overflow-hidden rounded-md shadow-xs ring-1 ring-black/[0.06] transition-shadow hover:shadow-md dark:ring-white/10">
        <CertificateThumb cert={c} org={org} className={cn(lapsed && 'opacity-70 grayscale-[0.5]')} />
      </Link>
      <div className="min-w-0 self-start sm:pt-1">
        <h3 className="font-serif text-[17px] font-semibold leading-snug">
          <Link to={to} className="rounded decoration-foreground/25 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
            {c.title}
          </Link>
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {c.kind === 'path' ? 'Learning path' : 'Course'} · Issued {certShortDate(c.issuedAt)}
        </p>
        <p className="mt-1 text-sm">
          <StandingText c={c} />
        </p>
      </div>
      <div className={cn('col-start-2 mt-2 flex flex-wrap items-center gap-1 sm:col-start-3 sm:mt-0 sm:justify-end sm:gap-2 sm:pl-4', current && '-ml-3 sm:ml-0')}>
        {current ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => copy('link', verifyLink(c.credentialId, c.verifyUrl), 'Verification link copied. Anyone with it can confirm this certificate is genuine.')}
              aria-label={`Copy the verification link for ${c.title}`}
            >
              {copied ? <Check /> : <Link2 />} {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => pdf.mutate()} loading={pdf.isPending} aria-label={`Download ${c.title} certificate as a PDF`}>
              {!pdf.isPending && <Download />} Download PDF
            </Button>
          </>
        ) : c.renewal ? (
          <LinkButton to={`/certificates/${c.renewal.id}`} variant="secondary" size="sm">
            View current
          </LinkButton>
        ) : c.state === 'expired' && c.slug ? (
          <LinkButton to={`/${c.kind === 'path' ? 'paths' : 'courses'}/${c.slug}`} variant="secondary" size="sm" aria-label={`Recertify in ${c.title}`}>
            <RotateCw /> Recertify
          </LinkButton>
        ) : null}
      </div>
    </li>
  );
}
