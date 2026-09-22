import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { certificatePdf } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import type { CertificateState } from '@project/shared/progress';
import { errorMessage } from '../../lib/errors';
import { copyToClipboard, verifyLink } from '../../lib/learnFormat';
import { certShortDate, certStateText } from '../../lib/certDates';

/** Pieces the certificate list and the certificate page share. */

type Renewal = { id: string; issuedAt: string | null } | null;

/**
 * A certificate's standing as a short phrase and the colour it deserves:
 * quiet while valid, amber when it's about to lapse, red when revoked.
 * An expired one that has been renewed isn't a problem, so it stays quiet.
 */
export function certificateStanding(c: { state: CertificateState; expiresAt: string | null; renewal?: Renewal }) {
  if (c.state === 'expired' && c.renewal)
    return {
      text: `Expired ${certShortDate(c.expiresAt)} · renewed ${certShortDate(c.renewal.issuedAt)}`,
      className: 'text-muted-foreground',
    };
  if (c.state === 'revoked') return { text: 'Revoked', className: 'font-medium text-tone-danger' };
  if (c.state === 'expiring')
    return {
      text: certStateText(c),
      className: 'font-medium text-tone-warning',
    };
  if (c.state === 'expired')
    return {
      text: certStateText(c),
      className: 'font-medium text-foreground/80',
    };
  return { text: certStateText(c), className: 'text-muted-foreground' };
}

export function StandingText({ c, className }: { c: Parameters<typeof certificateStanding>[0]; className?: string }) {
  const s = certificateStanding(c);
  return <span className={cn(s.className, className)}>{s.text}</span>;
}

/** Generates the PDF, then offers it — a new tab can't be opened after an await without a click. */
export function useCertificatePdf(id: string, credentialId: string, knownVerifyUrl: string | null) {
  return useMutation({
    mutationFn: () => {
      const verifyUrl = verifyLink(credentialId, knownVerifyUrl);
      return certificatePdf({
        id,
        verifyUrl: /^https:\/\//.test(verifyUrl) ? verifyUrl : undefined,
      });
    },
    onSuccess: res => {
      toast.success('Your PDF is ready.', {
        action: {
          label: 'Open PDF',
          onClick: () => window.open(res.url, '_blank', 'noopener'),
        },
        duration: 15_000,
      });
    },
    onError: e => toast.error(errorMessage(e, "The PDF couldn't be created. Try again in a moment.")),
  });
}

/** Copy text with a short-lived "copied" state per key. */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (key: string, text: string, message: string) => {
    const ok = await copyToClipboard(text);
    if (!ok) {
      toast.error('Copying didn’t work in this browser. Select the text and copy it instead.');
      return;
    }
    setCopied(key);
    toast.success(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  };
  return { copied, copy };
}
