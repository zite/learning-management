import { certificateDate, certificateDaysUntil } from '@project/shared/certificateDates';
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { certificatePdf, listCertificates, updateCertificate, type ListCertificatesInputType, type ListCertificatesOutputType } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { refreshSoon } from '../../lib/mutations';
import { qk } from '../../lib/queries';

export type CertificateRow = ListCertificatesOutputType['rows'][number];
export type CertificateState = CertificateRow['state'];
export type CertificateFilters = Omit<ListCertificatesInputType, 'limit' | 'offset'>;

export const PAGE = 100;

export const certificateKeys = {
  list: (f: CertificateFilters) => [...qk.certificatesRoot, 'list', f] as const,
};

/** Pages of certificates; counts come with every page. */
export function useCertificates(filters: CertificateFilters) {
  return useInfiniteQuery({
    queryKey: certificateKeys.list(filters),
    queryFn: ({ pageParam }) => listCertificates({ ...filters, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.total && last.rows.length === PAGE ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    staleTime: 20_000,
  });
}

/**
 * Certificate dates in the issuing organization's time zone, the same dates the
 * certificate and its PDF print (see packages/shared/certificateDates).
 */
export function certDate(iso: string | null | undefined, style: 'short' | 'long' = 'short') {
  return certificateDate(iso, style);
}

/**
 * "Expiring in 12 days", "Expired Aug 3", "Valid until Sep 2027", "No expiry",
 * "Revoked Sep 2". Only states that need attention carry a tone; it's text
 * colour, not a pill, so the column reads as one aligned list.
 */
export function expiryLabel(c: Pick<CertificateRow, 'state' | 'expiresAt' | 'revokedAt'>) {
  if (c.state === 'revoked') return { text: c.revokedAt ? `Revoked ${certDate(c.revokedAt)}` : 'Revoked', tone: 'text-tone-danger' };
  if (!c.expiresAt) return { text: 'No expiry', tone: 'text-muted-foreground' };
  const days = certificateDaysUntil(c.expiresAt);
  if (c.state === 'expired') return { text: `Expired ${certDate(c.expiresAt)}`, tone: 'text-tone-danger' };
  if (c.state === 'expiring') return { text: days <= 1 ? 'Expires tomorrow' : `Expiring in ${days} days`, tone: 'text-tone-warning' };
  return { text: `Valid until ${certificateDate(c.expiresAt, 'month')}`, tone: 'text-muted-foreground' };
}

export function useCertificateActions() {
  const qc = useQueryClient();

  const patchCaches = useCallback(
    (row: CertificateRow) =>
      qc.setQueriesData<{ pages: ListCertificatesOutputType[]; pageParams: number[] }>({ queryKey: qk.certificatesRoot }, old =>
        old ? { ...old, pages: old.pages.map(p => ({ ...p, rows: p.rows.map(r => (r.id === row.id ? row : r)) })) } : old,
      ),
    [qc],
  );

  const update = useCallback(
    async (row: CertificateRow, action: 'revoke' | 'restore', reason?: string) => {
      try {
        const res = await updateCertificate({ id: row.id, action, reason });
        patchCaches(res.certificate);
        toast.success(action === 'revoke' ? 'Certificate revoked' : 'Certificate restored', { description: action === 'revoke' ? `${row.personName} was told, and the verification page now shows it as revoked.` : 'It verifies as valid again.' });
        qc.invalidateQueries({ queryKey: qk.certificatesRoot });
        refreshSoon(qc, [qk.bootstrap, qk.enrollmentRoot, qk.personRoot, qk.homeRoot], 600);
        return res.certificate;
      } catch (e) {
        toast.error(errorMessage(e, action === 'revoke' ? "Couldn't revoke the certificate" : "Couldn't restore the certificate"));
        return null;
      }
    },
    [qc, patchCaches],
  );

  /** Popups opened after an await are blocked, so the PDF opens from the toast's button. */
  const downloadPdf = useCallback(async (row: Pick<CertificateRow, 'id' | 'title'>, paper: 'letter' | 'a4' = 'letter') => {
    const toastId = toast.loading('Preparing the PDF…');
    try {
      const res = await certificatePdf({ id: row.id, paper });
      toast.success('Certificate PDF is ready', { id: toastId, description: res.filename, action: { label: 'Open PDF', onClick: () => window.open(res.url, '_blank', 'noopener') }, duration: 15_000 });
      return res;
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't create the PDF"), { id: toastId });
      return null;
    }
  }, []);

  return useMemo(() => ({ update, downloadPdf }), [update, downloadPdf]);
}
