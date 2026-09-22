import { AlertTriangle, BadgeCheck, Search, ShieldQuestion, XCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { normaliseCredentialId } from '@project/shared/progress';
import { CertificateArt } from '@project/shared/ui/CertificateArt';
import { AcademyMark } from '../components/kit';
import { Button, Card, Skeleton, inputClass } from '../components/ui';
import { useSession } from '../lib/auth';
import { errorMessage } from '../lib/errors';
import { certLongDate } from '../lib/certDates';
import { useVerification, type Verification } from '../lib/learn';
import { useAcademy } from '../lib/queries';

/**
 * Public certificate verification. An employer, auditor or client with a
 * credential ID confirms a certificate is genuine and current — no account
 * needed. Only what a verifier needs is shown.
 */
export function VerifyPage() {
  const { credentialId: raw } = useParams();
  const credentialId = raw ? normaliseCredentialId(decodeURIComponent(raw)) : '';
  const academy = useAcademy();
  // A full ID is three blocks of four; anything shorter can't match, so say so instead of looking.
  const complete = credentialId.length === 14;
  const q = useVerification(complete ? credentialId : undefined);
  const { user } = useSession();

  useEffect(() => {
    const name = academy.data?.academyName ?? 'Academy';
    document.title = credentialId ? `Verify ${credentialId} · ${name}` : `Verify a certificate · ${name}`;
  }, [credentialId, academy.data?.academyName]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4 sm:px-6">
          <span className="flex min-w-0 items-center gap-2.5">
            <AcademyMark size={30} />
            <span className="min-w-0">
              <span className="block truncate font-serif text-[17px] font-semibold leading-tight">{academy.data?.academyName ?? ' '}</span>
              <span className="block truncate text-xs text-muted-foreground">{academy.data?.organizationName ?? ''}</span>
            </span>
          </span>
          {user && (
            <Link to="/" className="ml-auto rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
              Go to the academy
            </Link>
          )}
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-faint">Certificate verification</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight sm:text-4xl">{credentialId ? 'Is this certificate genuine?' : 'Verify a certificate'}</h1>
        <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">Enter the credential ID printed at the bottom of a {academy.data?.organizationName ?? ''} certificate to confirm who earned it, what for, and whether it’s still valid.</p>

        <VerifyForm initial={credentialId} incomplete={Boolean(credentialId) && !complete} />

        {complete && (
          <div className="mt-8" aria-live="polite">
            {q.isPending ? (
              <Card className="p-6" aria-label="Checking the certificate">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="mt-4 h-5 w-2/3" />
                <Skeleton className="mt-6 h-40 w-full rounded-lg" />
              </Card>
            ) : q.isError ? (
              <Card className="p-6">
                <p className="font-semibold">We couldn't check that certificate</p>
                <p className="mt-1 text-[15px] text-muted-foreground">{errorMessage(q.error, 'Check your connection and try again.')}</p>
                <Button variant="secondary" className="mt-4" onClick={() => q.refetch()}>
                  Try again
                </Button>
              </Card>
            ) : (
              <Result v={q.data} />
            )}
          </div>
        )}
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span>Verification is provided by {(academy.data?.organizationName ?? 'the issuing organization').replace(/\.$/, '')}.</span>
        </div>
      </footer>
    </div>
  );
}

const INCOMPLETE = 'A credential ID has 12 letters and numbers, like LX7K-9QPM-3RTA.';

function VerifyForm({ initial, incomplete }: { initial: string; incomplete: boolean }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(incomplete ? INCOMPLETE : null);
  const navigate = useNavigate();
  useEffect(() => {
    setValue(initial);
    setError(incomplete ? INCOMPLETE : null);
  }, [initial, incomplete]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = normaliseCredentialId(value);
    if (id.replace(/-/g, '').length !== 12) {
      setError(INCOMPLETE);
      document.getElementById('credential-id')?.focus();
      return;
    }
    setError(null);
    navigate(`/verify/${id}`);
  };

  return (
    <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <label htmlFor="credential-id" className="sr-only">
          Credential ID
        </label>
        <input
          id="credential-id"
          value={value}
          onChange={e => {
            setValue(normaliseCredentialId(e.target.value));
            setError(null);
          }}
          placeholder="XXXX-XXXX-XXXX"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? 'credential-id-error' : undefined}
          className={inputClass('h-12 font-mono text-base uppercase tracking-[0.12em]')}
        />
        {error && (
          <p id="credential-id-error" role="alert" className="mt-1.5 text-sm text-tone-danger">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" className="sm:w-auto">
        <Search /> Verify
      </Button>
    </form>
  );
}

const RESULT: Record<'valid' | 'expiring' | 'expired' | 'revoked' | 'missing', { icon: LucideIcon; title: string; tone: string; ring: string }> = {
  valid: {
    icon: BadgeCheck,
    title: 'Valid certificate',
    tone: 'text-tone-success',
    ring: 'border-tone-success/25 bg-tone-success/[0.05]',
  },
  expiring: {
    icon: BadgeCheck,
    title: 'Valid certificate',
    tone: 'text-tone-success',
    ring: 'border-tone-success/25 bg-tone-success/[0.05]',
  },
  expired: {
    icon: AlertTriangle,
    title: 'This certificate has expired',
    tone: 'text-tone-warning',
    ring: 'border-tone-warning/25 bg-tone-warning/[0.05]',
  },
  revoked: {
    icon: XCircle,
    title: 'This certificate was revoked',
    tone: 'text-tone-danger',
    ring: 'border-tone-danger/25 bg-tone-danger/[0.05]',
  },
  missing: {
    icon: ShieldQuestion,
    title: 'No certificate matches this ID',
    tone: 'text-muted-foreground',
    ring: 'border-border bg-card',
  },
};

function Result({ v }: { v: Verification }) {
  const key = !v.found ? 'missing' : v.state === 'active' ? 'valid' : (v.state ?? 'missing');
  const r = RESULT[key];
  const lead = !v.found
    ? `We couldn't find a certificate with the ID ${v.credentialId}. Check it against the certificate: IDs never use the characters O, I, 0 or 1, so one of those usually means a typo.`
    : key === 'revoked'
      ? `${v.organizationName} revoked this certificate${v.revokedAt ? ` on ${certLongDate(v.revokedAt)}` : ''}. It should not be relied on.`
      : key === 'expired'
        ? `It was genuinely issued by ${v.organizationName}, but it expired on ${certLongDate(v.expiresAt)}.${v.renewed ? ` ${v.recipientName} has since earned a newer certificate for this ${v.kind === 'path' ? 'learning path' : 'course'} — ask them for its credential ID.` : ''}`
        : `${v.organizationName} issued this certificate and it is currently valid${v.expiresAt ? ` until ${certLongDate(v.expiresAt)}` : ''}.`;

  return (
    <div className="space-y-6 animate-fade-up">
      <div className={cn('flex gap-3.5 rounded-xl border p-5', r.ring)}>
        <r.icon className={cn('mt-0.5 h-6 w-6 shrink-0', r.tone)} aria-hidden />
        <div className="min-w-0">
          <h2 className="font-serif text-xl font-semibold leading-snug">{r.title}</h2>
          <p className="mt-1 text-[15px] text-foreground/85">{lead}</p>
        </div>
      </div>

      {v.found && (
        <>
          <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
            <Fact label="Awarded to">{v.recipientName}</Fact>
            <Fact label={v.kind === 'path' ? 'Learning path' : 'Course'}>{v.title}</Fact>
            <Fact label="Issued by">
              {v.organizationName}
              <span className="block text-sm font-normal text-muted-foreground">{v.academyName}</span>
            </Fact>
            <Fact label="Credential ID">
              <span className="font-mono">{v.credentialId}</span>
            </Fact>
            <Fact label="Issued">{certLongDate(v.issuedAt)}</Fact>
            <Fact label={key === 'revoked' ? 'Revoked' : key === 'expired' ? 'Expired' : 'Valid until'}>{key === 'revoked' ? (v.revokedAt ? certLongDate(v.revokedAt) : 'Yes') : v.expiresAt ? certLongDate(v.expiresAt) : 'Does not expire'}</Fact>
          </dl>
          <div className="rounded-2xl bg-muted/60 p-3 sm:p-6">
            <CertificateArt
              recipientName={v.recipientName ?? ''}
              title={v.title ?? ''}
              kind={v.kind ?? 'course'}
              organizationName={v.organizationName}
              academyName={v.academyName}
              certificateTitle={v.certificateTitle}
              issuedAt={v.issuedAt}
              expiresAt={v.expiresAt}
              credentialId={v.credentialId}
              signatory={v.signatory || null}
              signatoryTitle={v.signatoryTitle || null}
              logoUrl={v.logoUrl}
              brandColor={v.brandColor}
              revoked={key === 'revoked'}
              className={key === 'expired' ? 'opacity-80' : undefined}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-card px-4 py-3.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-medium">{children}</dd>
    </div>
  );
}
