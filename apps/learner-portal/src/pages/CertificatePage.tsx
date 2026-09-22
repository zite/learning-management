import { ArrowRight, Check, Copy, Download, ExternalLink, Linkedin, Printer, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StandingText, useCertificatePdf, useCopy } from '../components/me/certificates';
import { CertificateThumb, LoadError } from '../components/kit';
import { Alert, BackLink, Button, Container, LinkButton, PageSkeleton } from '../components/ui';
import { certLongDate } from '../lib/certDates';
import { useCertificate, type CertificateDetail } from '../lib/learn';
import { linkedInUrl, verifyLink } from '../lib/learnFormat';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function CertificatePage() {
  const { id } = useParams();
  const q = useCertificate(id);
  useDocumentTitle(q.data ? `${q.data.certificate.title} certificate` : q.isError ? 'Certificate not found' : null);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError)
    return (
      <LoadError
        error={q.error}
        onRetry={() => q.refetch()}
        title="This certificate didn't load"
        notFoundTitle="We couldn't find that certificate"
        notFoundBody="It may belong to someone else, or the link may be mistyped."
        action={<LinkButton to="/certificates">See my certificates</LinkButton>}
      />
    );
  return <CertificateView d={q.data} />;
}

const focusLink = 'rounded underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35';

function CertificateView({ d }: { d: CertificateDetail }) {
  const c = d.certificate;
  const verifyUrl = verifyLink(c.credentialId, d.verifyUrl);
  const { copied, copy } = useCopy();
  const pdf = useCertificatePdf(c.id, c.credentialId, d.verifyUrl);
  const revoked = c.state === 'revoked';
  const lapsed = revoked || c.state === 'expired';
  const kindWord = c.kind === 'path' ? 'learning path' : 'course';
  const subjectLink = c.slug ? `/${c.kind === 'path' ? 'paths' : 'courses'}/${c.slug}` : null;

  return (
    <div>
      <style>{'@media print { @page { size: landscape; margin: 10mm; } }'}</style>
      <Container className="py-6 sm:py-8 print:p-0">
        <div className="no-print">
          <BackLink to={c.isMine ? '/certificates' : '/team'}>{c.isMine ? 'Certificates' : 'My team'}</BackLink>
          <h1 className="mt-5 font-serif text-3xl font-semibold leading-tight sm:text-[34px]">{c.title}</h1>
          <p className="mt-1.5 text-[15px] text-muted-foreground">
            {c.kind === 'path' ? 'Learning path' : 'Course'} certificate · Awarded to {c.recipientName} on {certLongDate(c.issuedAt)}
            {/* Lapsed certificates say so in the notice below instead. */}
            {!lapsed && (
              <>
                <span aria-hidden> · </span>
                <StandingText c={c} />
              </>
            )}
          </p>
        </div>

        {revoked && (
          <Alert tone="danger" title="This certificate has been revoked" className="no-print mt-6">
            {c.revokedAt ? `It was revoked on ${certLongDate(c.revokedAt)}. ` : ''}
            {c.revokedReason ? `Reason: ${c.revokedReason.replace(/\.?$/, '.')} ` : ''}
            It no longer verifies as valid.
            {c.isMine ? ' Contact your learning team if you think this is a mistake.' : ''}
          </Alert>
        )}
        {c.state === 'expired' &&
          (c.renewal ? (
            <Alert
              tone="info"
              title={`This certificate expired on ${certLongDate(c.expiresAt)}`}
              className="no-print mt-6"
              action={
                <LinkButton to={`/certificates/${c.renewal.id}`} size="sm" variant="secondary">
                  View current certificate <ArrowRight />
                </LinkButton>
              }
            >
              {c.isMine ? 'You' : c.recipientName} renewed it on {certLongDate(c.renewal.issuedAt)}, so the newer certificate is the one to share.
            </Alert>
          ) : (
            <Alert
              tone="warning"
              title={`This certificate expired on ${certLongDate(c.expiresAt)}`}
              className="no-print mt-6"
              action={
                subjectLink && c.isMine ? (
                  <LinkButton to={subjectLink} size="sm" variant="secondary">
                    <RotateCw /> Recertify
                  </LinkButton>
                ) : undefined
              }
            >
              Verification shows it as expired. {c.isMine ? `Complete the ${kindWord} again to earn a current certificate.` : `${c.recipientName} needs to complete the ${kindWord} again to earn a current one.`}
            </Alert>
          ))}

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] print:mt-0 print:block">
          <div className="min-w-0">
            <div className="rounded-2xl bg-muted/60 p-3 sm:p-8 print:rounded-none print:bg-transparent print:p-0">
              <CertificateThumb cert={c} org={d.org} className="mx-auto max-w-4xl" />
            </div>
          </div>

          <aside className="no-print space-y-6" aria-label="Certificate actions and details">
            <div className="grid gap-2">
              <Button onClick={() => pdf.mutate()} loading={pdf.isPending}>
                {!pdf.isPending && <Download />} Download PDF
              </Button>
              {pdf.data && (
                <a href={pdf.data.url} target="_blank" rel="noreferrer" className={`flex items-center justify-center gap-1.5 py-1 text-sm font-medium text-primary ${focusLink}`}>
                  Open {pdf.data.filename.length > 36 ? 'the PDF' : pdf.data.filename} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
              {!revoked && (
                <Button variant="secondary" onClick={() => copy('link', verifyUrl, 'Verification link copied. Anyone with it can confirm this certificate is genuine.')}>
                  {copied === 'link' ? <Check /> : <Copy />} {copied === 'link' ? 'Copied' : 'Copy verification link'}
                </Button>
              )}
              {c.isMine && !lapsed && (
                <a
                  href={linkedInUrl({
                    title: c.title,
                    organizationName: d.org.organizationName,
                    issuedAt: c.issuedAt,
                    expiresAt: c.expiresAt,
                    credentialId: c.credentialId,
                    verifyUrl,
                  })}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-[15px] font-medium shadow-2xs transition-colors hover:border-foreground/25 hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                >
                  <Linkedin className="h-4 w-4 text-[#0a66c2] dark:text-[#70b5f9]" aria-hidden /> Add to LinkedIn
                </a>
              )}
              <Button variant="ghost" onClick={() => window.print()}>
                <Printer /> Print
              </Button>
            </div>

            <dl className="divide-y rounded-xl border bg-card text-sm shadow-2xs">
              <Detail label="Credential ID">
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="whitespace-nowrap font-mono text-[13px]">{c.credentialId}</span>
                  <button
                    type="button"
                    onClick={() => copy('id', c.credentialId, 'Credential ID copied.')}
                    className="-my-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                    aria-label="Copy credential ID"
                  >
                    {copied === 'id' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </span>
              </Detail>
              <Detail label="Awarded to">{c.recipientName}</Detail>
              <Detail label={c.kind === 'path' ? 'Path' : 'Course'}>
                {subjectLink ? (
                  <Link to={subjectLink} className={focusLink}>
                    {c.title}
                  </Link>
                ) : (
                  c.title
                )}
              </Detail>
              <Detail label="Issued">{certLongDate(c.issuedAt)}</Detail>
              <Detail label={c.state === 'expired' ? 'Expired' : 'Expires'}>{c.expiresAt ? certLongDate(c.expiresAt) : 'Never'}</Detail>
              {c.score != null && <Detail label="Score">{Math.round(c.score)}%</Detail>}
              <Detail label="Issued by">{d.org.organizationName}</Detail>
              <Detail label="Verification">
                <a href={verifyUrl} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 text-primary ${focusLink}`}>
                  Public page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </Detail>
            </dl>
          </aside>
        </div>
      </Container>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-3 px-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
