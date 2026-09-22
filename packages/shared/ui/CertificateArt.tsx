import type { CSSProperties } from 'react';
import { certificateDate } from '../certificateDates';

/**
 * The certificate itself, as a learner, their manager or an auditor sees it.
 *
 * Deliberately paper-coloured in both themes (it's a document, not UI), sized
 * with container query units so it scales from a thumbnail to full width
 * without re-layout, and made of plain elements so it prints cleanly. The
 * server-side PDF (certificateHtml) mirrors this layout.
 */

export type CertificateArtProps = {
  recipientName: string;
  title: string;
  kind?: 'course' | 'path';
  organizationName: string;
  academyName?: string;
  certificateTitle?: string;
  issuedAt: string | null;
  expiresAt?: string | null;
  credentialId: string;
  signatory?: string | null;
  signatoryTitle?: string | null;
  logoUrl?: string | null;
  brandColor?: string;
  revoked?: boolean;
  /** The issuing organization's zone; defaults to the one the app set (see certificateDates). */
  timeZone?: string;
  className?: string;
  style?: CSSProperties;
};


export function CertificateArt(p: CertificateArtProps) {
  const brand = p.brandColor || '#2f7a55';
  const serif = "'Source Serif 4', 'Iowan Old Style', Georgia, serif";
  const sans = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  return (
    <div className={p.className} style={{ containerType: 'inline-size', ...p.style }}>
      <div
        role="img"
        aria-label={`${p.certificateTitle ?? 'Certificate of Completion'} awarded to ${p.recipientName} for ${p.title}`}
        style={{
          position: 'relative',
          aspectRatio: '1.414 / 1',
          width: '100%',
          background: 'linear-gradient(180deg, #fffdf8 0%, #fbf7ee 100%)',
          color: '#1f1d1a',
          borderRadius: '1.2cqw',
          boxShadow: '0 1px 2px rgb(0 0 0 / 0.06), 0 12px 32px rgb(0 0 0 / 0.10)',
          overflow: 'hidden',
          fontFamily: sans,
        }}
      >
        {/* Frame */}
        <div style={{ position: 'absolute', inset: '2.4cqw', border: `0.18cqw solid ${brand}`, borderRadius: '0.6cqw', opacity: 0.85 }} />
        <div style={{ position: 'absolute', inset: '3.1cqw', border: `0.08cqw solid ${brand}`, borderRadius: '0.4cqw', opacity: 0.35 }} />
        {/* Corner wash */}
        <div style={{ position: 'absolute', right: '-12cqw', top: '-16cqw', width: '46cqw', height: '46cqw', borderRadius: '50%', background: `radial-gradient(circle, ${brand}1f 0%, transparent 70%)` }} />
        <div style={{ position: 'absolute', left: '-10cqw', bottom: '-18cqw', width: '40cqw', height: '40cqw', borderRadius: '50%', background: `radial-gradient(circle, #f59e0b14 0%, transparent 70%)` }} />

        <div style={{ position: 'absolute', inset: '6.5cqw 8cqw', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.2cqw', height: '4cqw' }}>
            {p.logoUrl ? (
              <img src={p.logoUrl} alt="" style={{ height: '3.6cqw', maxWidth: '22cqw', objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: '1.45cqw', fontWeight: 600, letterSpacing: '0.24em', textTransform: 'uppercase', color: brand }}>{p.organizationName}</span>
            )}
          </div>
          <div style={{ marginTop: '3.2cqw', fontFamily: serif, fontSize: '4.4cqw', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.1 }}>{p.certificateTitle ?? 'Certificate of Completion'}</div>
          <div style={{ marginTop: '2.4cqw', fontSize: '1.55cqw', color: '#6b645a', letterSpacing: '0.02em' }}>This certifies that</div>
          <div style={{ marginTop: '1.2cqw', fontFamily: serif, fontSize: '5.6cqw', fontStyle: 'italic', lineHeight: 1.15, maxWidth: '76cqw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.recipientName}</div>
          <div style={{ width: '38cqw', height: '0.12cqw', background: `${brand}66`, marginTop: '1cqw' }} />
          <div style={{ marginTop: '2cqw', fontSize: '1.55cqw', color: '#6b645a' }}>has successfully completed the {p.kind === 'path' ? 'learning path' : 'course'}</div>
          <div style={{ marginTop: '1cqw', fontSize: '2.7cqw', fontWeight: 600, lineHeight: 1.25, maxWidth: '72cqw', letterSpacing: '-0.01em' }}>{p.title}</div>

          <div style={{ marginTop: 'auto', width: '100%', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'end', gap: '3cqw' }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontFamily: serif, fontSize: '2cqw', fontStyle: 'italic', minHeight: '2.6cqw' }}>{p.signatory ?? ''}</div>
              <div style={{ height: '0.1cqw', background: '#1f1d1a33', margin: '0.6cqw 0' }} />
              <div style={{ fontSize: '1.2cqw', color: '#6b645a' }}>{p.signatoryTitle || p.academyName || p.organizationName}</div>
            </div>
            <Seal brand={brand} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.7cqw', fontWeight: 500, minHeight: '2.6cqw', lineHeight: '2.6cqw' }}>{certificateDate(p.issuedAt, 'long', p.timeZone)}</div>
              <div style={{ height: '0.1cqw', background: '#1f1d1a33', margin: '0.6cqw 0' }} />
              <div style={{ fontSize: '1.2cqw', color: '#6b645a' }}>{p.expiresAt ? `Valid until ${certificateDate(p.expiresAt, 'long', p.timeZone)}` : 'Date issued'}</div>
            </div>
          </div>
          <div style={{ marginTop: '2.2cqw', fontSize: '1.05cqw', color: '#8a8378', letterSpacing: '0.08em' }}>
            CREDENTIAL ID <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.06em', color: '#4b463f' }}>{p.credentialId}</span>
          </div>
        </div>

        {p.revoked && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgb(255 253 248 / 0.55)' }}>
            <span style={{ transform: 'rotate(-14deg)', border: '0.4cqw solid #b91c1c', color: '#b91c1c', padding: '0.8cqw 3cqw', fontSize: '4.5cqw', fontWeight: 700, letterSpacing: '0.2em', borderRadius: '0.8cqw' }}>REVOKED</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Seal({ brand }: { brand: string }) {
  return (
    <svg viewBox="0 0 120 120" style={{ width: '11cqw', height: '11cqw' }} aria-hidden>
      <defs>
        <radialGradient id="seal-glow" cx="50%" cy="58%" r="45%">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="0.6" stopColor="#f59e0b" stopOpacity="0.35" />
          <stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
      </defs>
      {Array.from({ length: 24 }).map((_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return <circle key={i} cx={60 + Math.cos(a) * 52} cy={60 + Math.sin(a) * 52} r={6.5} fill={brand} />;
      })}
      <circle cx="60" cy="60" r="50" fill={brand} />
      <circle cx="60" cy="60" r="43" fill="none" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.2" />
      <g transform="translate(36 34) scale(0.75)">
        <path d="M25 17.5c0-3.9 3.1-7 7-7s7 3.1 7 7" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
        <rect x="21" y="19" width="22" height="4.5" rx="2.25" fill="#fff" />
        <path d="M23 24h18l-1.6 20.5a3 3 0 0 1-3 2.8h-8.8a3 3 0 0 1-3-2.8z" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinejoin="round" />
        <circle cx="32" cy="36" r="9" fill="url(#seal-glow)" />
        <path d="M32 29.5c2.6 3 3.9 5.1 3.9 7.1a3.9 3.9 0 0 1-7.8 0c0-2 1.3-4.1 3.9-7.1z" fill="#fff7e6" />
        <rect x="24" y="48.5" width="16" height="4" rx="2" fill="#fff" />
      </g>
    </svg>
  );
}
