import { ArrowUpRight, Ban, ChevronDown, Copy, Download, Link2, Route, Undo2, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@project/components/ui/sheet';
import { cn } from '@project/components/lib/utils';
import { CertificateArt } from '@project/shared/ui/CertificateArt';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { dateTime } from '../../lib/format';
import { MOD } from '../../lib/hotkeys';
import { useWorkspace } from '../../lib/workspace';
import { PersonAvatar } from '../primitives/Avatar';
import { IconButton, Kbd, Tip } from '../primitives/bits';
import { CourseGlyph } from '../primitives/icons';
import { certDate, expiryLabel, useCertificateActions, type CertificateRow } from './data';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-3 py-2 text-[14px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export const verifyUrl = (learnUrl: string | null, credentialId: string) => (learnUrl ? `${learnUrl.replace(/\/+$/, '')}/#/verify/${credentialId}` : null);

/**
 * One certificate as the learner and an auditor see it, with what admins can
 * do about it: download, share the verification link, revoke or restore.
 */
export function CertificateSheet({ certificate: c, onClose, onChange }: { certificate: CertificateRow | null; onClose: () => void; onChange: (next: CertificateRow) => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { update, downloadPdf } = useCertificateActions();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const cert = c;
  const verify = cert ? verifyUrl(ws.settings.learnUrl, cert.credentialId) : null;

  return (
    <Sheet open={Boolean(c)} onOpenChange={o => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-[min(720px,100vw)] flex-col gap-0 p-0 outline-none sm:max-w-none [&>button:first-child]:hidden"
        // Focus the panel, not the close button, so it doesn't open with a focus ring on ✕. Tab still moves through the actions.
        onOpenAutoFocus={e => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <SheetTitle className="sr-only">Certificate</SheetTitle>
        {cert && (
          <>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
              <Link to={cert.personId ? `/people/${cert.personId}` : '#'} onClick={onClose} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
                <PersonAvatar person={{ name: cert.personName, color: cert.personColor, avatarUrl: cert.personAvatarUrl, status: cert.personStatus }} size={20} />
                <span className="truncate text-[14px] font-medium">{cert.personName}</span>
              </Link>
              <span className="text-muted-foreground/60">›</span>
              <span className="flex min-w-0 items-center gap-2 px-1.5">
                <CourseGlyph icon={cert.targetIcon} color={cert.targetColor} size={18} />
                <span className="truncate text-[14px]">{cert.title}</span>
              </span>
              <IconButton className="ml-auto" aria-label="Close" onClick={onClose}>
                <X />
              </IconButton>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="bg-subtle/60 px-4 py-6 sm:px-8">
                <CertificateArt
                  recipientName={cert.recipientName || cert.personName}
                  title={cert.title}
                  kind={cert.kind}
                  organizationName={ws.settings.organizationName}
                  academyName={ws.settings.academyName}
                  certificateTitle={ws.settings.certificateTitle}
                  issuedAt={cert.issuedAt}
                  expiresAt={cert.expiresAt}
                  credentialId={cert.credentialId}
                  signatory={ws.settings.certificateSignatory || null}
                  signatoryTitle={ws.settings.certificateSignatoryTitle || null}
                  logoUrl={ws.settings.logoUrl}
                  brandColor={ws.settings.brandColor}
                  revoked={cert.status === 'Revoked'}
                  className="mx-auto max-w-[620px]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 border-y px-4 py-3 sm:px-6">
                <div className="inline-flex rounded-md shadow-xs">
                  <button type="button" onClick={() => downloadPdf(cert)} className="inline-flex h-9 items-center gap-1.5 rounded-l-md bg-primary px-3 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">
                    <Download className="h-3.5 w-3.5" /> Download PDF
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label="Choose paper size" className="inline-flex h-9 items-center rounded-r-md border-l border-primary-foreground/20 bg-primary px-1.5 text-primary-foreground hover:bg-primary/90">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      <DropdownMenuItem className="text-[14px]" onSelect={() => downloadPdf(cert, 'letter')}>
                        US Letter, landscape
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-[14px]" onSelect={() => downloadPdf(cert, 'a4')}>
                        A4, landscape
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Tip label={verify ? verify : 'Open the Learner Portal once so its address is recorded here'}>
                  <span>
                    <button type="button" disabled={!verify} onClick={() => verify && copyText(verify, 'Verification link copied')} className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50">
                      <Link2 className="h-3.5 w-3.5" /> Copy verification link
                    </button>
                  </span>
                </Tip>
                {ws.isAdmin && (
                  <div className="ml-auto">
                    {cert.status === 'Revoked' ? (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!(await app.confirm({ title: 'Restore this certificate?', description: `It becomes valid again and verifies as ${cert.state === 'revoked' && cert.expiresAt && Date.parse(cert.expiresAt) < Date.now() ? 'expired' : 'active'} for anyone checking ${cert.credentialId}.`, confirmLabel: 'Restore certificate' }))) return;
                          const next = await update(cert, 'restore');
                          if (next) onChange(next);
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Restore
                      </button>
                    ) : (
                      <button type="button" onClick={() => setRevokeOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/30 bg-background px-3 text-[14px] text-destructive shadow-2xs hover:bg-destructive/[0.06]">
                        <Ban className="h-3.5 w-3.5" /> Revoke…
                      </button>
                    )}
                  </div>
                )}
              </div>

              <dl className="divide-y px-4 sm:px-6">
                <Field label="Recipient">
                  {cert.personId ? (
                    <Link to={`/people/${cert.personId}`} onClick={onClose} className="inline-flex items-center gap-1 hover:underline">
                      {cert.personName}
                      <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
                    </Link>
                  ) : (
                    cert.recipientName
                  )}
                  {cert.personEmail && <div className="truncate text-sm text-muted-foreground">{cert.personEmail}</div>}
                </Field>
                <Field label="Credential ID">
                  <button type="button" onClick={() => copyText(cert.credentialId, 'Credential ID copied')} className="group inline-flex items-center gap-1.5 font-mono text-[13.5px] tracking-wide hover:text-primary">
                    {cert.credentialId}
                    <Copy className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </Field>
                <Field label={cert.kind === 'path' ? 'Learning path' : 'Course'}>
                  <Link to={cert.kind === 'path' ? `/paths/${cert.pathId}` : `/courses/${cert.courseId}`} onClick={onClose} className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
                    {cert.kind === 'path' && <Route className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="truncate">{cert.title}</span>
                  </Link>
                </Field>
                <Field label="Issued">
                  {cert.issuedAt ? certDate(cert.issuedAt, 'long') : '—'}
                  {cert.issuedByName && <span className="text-muted-foreground"> · by {cert.issuedByName}</span>}
                </Field>
                <Field label="Status">
                  {(() => {
                    const e = expiryLabel(cert);
                    const label = cert.state === 'active' ? 'Active' : cert.state === 'expiring' ? 'Expiring soon' : cert.state === 'expired' ? 'Expired' : 'Revoked';
                    const dot = cert.state === 'active' ? 'bg-tone-success' : cert.state === 'expiring' ? 'bg-tone-warning' : 'bg-tone-danger';
                    return (
                      <span className="inline-flex flex-wrap items-center gap-x-2">
                        <span className={cn('inline-flex items-center gap-1.5 font-medium', cert.state !== 'active' && e.tone)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
                          {label}
                        </span>
                        {cert.state !== 'revoked' && <span className="text-muted-foreground">{cert.expiresAt ? `${cert.state === 'expired' ? 'Expired' : 'Valid until'} ${certDate(cert.expiresAt, 'long')}` : 'Never expires'}</span>}
                      </span>
                    );
                  })()}
                </Field>
                {cert.status === 'Revoked' && (
                  <Field label="Revoked">
                    {cert.revokedAt ? dateTime(cert.revokedAt) : 'Revoked'}
                    {cert.revokedReason && <div className="mt-0.5 text-muted-foreground">“{cert.revokedReason}”</div>}
                  </Field>
                )}
                {cert.score != null && (
                  <Field label="Score">
                    <span className="tabular-nums">{Math.round(cert.score)}%</span>
                  </Field>
                )}
                {cert.enrollmentId && (
                  <Field label="Record">
                    {cert.kind === 'course' ? (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          app.openEnrollment(cert.enrollmentId!);
                        }}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        Open the enrollment <ArrowUpRight className="h-3 w-3" />
                      </button>
                    ) : (
                      <Link to={`/paths/${cert.pathId}/learners`} onClick={onClose} className="inline-flex items-center gap-1 text-primary hover:underline">
                        See path progress <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    )}
                  </Field>
                )}
              </dl>
            </div>
            <RevokeDialog
              open={revokeOpen}
              onOpenChange={setRevokeOpen}
              certificate={cert}
              onRevoked={next => {
                onChange(next);
                setRevokeOpen(false);
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RevokeDialog({ open, onOpenChange, certificate: c, onRevoked }: { open: boolean; onOpenChange: (o: boolean) => void; certificate: CertificateRow; onRevoked: (c: CertificateRow) => void }) {
  const { update } = useCertificateActions();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setBusy(false);
    }
  }, [open]);
  const valid = reason.trim().length >= 3;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const next = await update(c, 'revoke', reason.trim());
    if (next) onRevoked(next);
    else setBusy(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md gap-0 p-0 sm:rounded-xl"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader className="px-5 pb-2 pt-4 text-left">
          <DialogTitle className="text-[16px]">Revoke {c.personName}’s certificate?</DialogTitle>
          <DialogDescription className="text-[14px]">
            {c.title} · <span className="font-mono">{c.credentialId}</span>. Anyone verifying it will see it’s revoked, and {c.personName.split(' ')[0]} is told why. You can restore it later.
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 pb-4 pt-2">
          <label htmlFor="revoke-reason" className="mb-1.5 block text-sm font-medium text-muted-foreground">
            Reason
          </label>
          <textarea
            id="revoke-reason"
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="e.g. Issued in error during the spring import"
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-[14px] shadow-2xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
              <Kbd>{MOD}</Kbd>
              <Kbd>↵</Kbd> to revoke
            </span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
                Cancel
              </button>
              <button type="button" disabled={!valid || busy} onClick={submit} className="h-9 rounded-md bg-destructive px-3 text-[14px] font-medium text-destructive-foreground shadow-xs hover:bg-destructive/90 disabled:opacity-50">
                {busy ? 'Revoking…' : 'Revoke certificate'}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
