import { certificateDate } from './certificateDates';
/**
 * The certificate as a printable HTML document, for PDF rendering on the
 * server (admin and learner apps both use it).
 *
 * It mirrors `ui/CertificateArt.tsx` element for element — same text, frame,
 * washes, seal and revoked stamp — but sized in millimetres for a landscape
 * page instead of container query units, so the PDF renderer never has to
 * support them. A4 landscape has the art's exact 1.414 ratio; on US Letter the
 * certificate is centred at that ratio with a little paper around it.
 */

export type CertificateHtmlProps = {
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
  /** Printed under the credential id when known, e.g. the learner app's /verify link. */
  verifyUrl?: string | null;
  paper?: 'a4' | 'letter';
  /** The issuing organization's time zone, so the printed dates match the app. */
  timeZone?: string;
};

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');



function seal(brand: string, size: string) {
  const dots = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return `<circle cx="${(60 + Math.cos(a) * 52).toFixed(2)}" cy="${(60 + Math.sin(a) * 52).toFixed(2)}" r="6.5" fill="${brand}"/>`;
  }).join('');
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" style="width:${size};height:${size}" aria-hidden="true">
    <defs><radialGradient id="seal-glow" cx="50%" cy="58%" r="45%"><stop offset="0" stop-color="#fde68a"/><stop offset="0.6" stop-color="#f59e0b" stop-opacity="0.35"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></radialGradient></defs>
    ${dots}
    <circle cx="60" cy="60" r="50" fill="${brand}"/>
    <circle cx="60" cy="60" r="43" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="1.2"/>
    <g transform="translate(36 34) scale(0.75)">
      <path d="M25 17.5c0-3.9 3.1-7 7-7s7 3.1 7 7" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
      <rect x="21" y="19" width="22" height="4.5" rx="2.25" fill="#fff"/>
      <path d="M23 24h18l-1.6 20.5a3 3 0 0 1-3 2.8h-8.8a3 3 0 0 1-3-2.8z" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/>
      <circle cx="32" cy="36" r="9" fill="url(#seal-glow)"/>
      <path d="M32 29.5c2.6 3 3.9 5.1 3.9 7.1a3.9 3.9 0 0 1-7.8 0c0-2 1.3-4.1 3.9-7.1z" fill="#fff7e6"/>
      <rect x="24" y="48.5" width="16" height="4" rx="2" fill="#fff"/>
    </g>
  </svg>`;
}

export function certificateHtml(p: CertificateHtmlProps): string {
  const brand = /^#[0-9a-f]{6}$/i.test(p.brandColor ?? '') ? (p.brandColor as string) : '#2f7a55';
  const paper = p.paper ?? 'a4';
  // Page in mm, landscape; the certificate keeps the art's 1.414 ratio.
  const page = paper === 'letter' ? { w: 279.4, h: 215.9 } : { w: 297, h: 210 };
  const W = Math.min(page.w, page.h * 1.414);
  const H = W / 1.414;
  // 1 "cqw" in CertificateArt = 1% of the certificate's width.
  const u = (n: number) => `${((n * W) / 100).toFixed(2)}mm`;
  const serif = "'Source Serif 4', 'Iowan Old Style', Georgia, serif";
  const sans = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
  const certTitle = p.certificateTitle || 'Certificate of Completion';
  const logo = p.logoUrl && /^https:\/\//.test(p.logoUrl)
    ? `<img src="${esc(p.logoUrl)}" alt="" style="height:${u(3.6)};max-width:${u(22)};object-fit:contain"/>`
    : `<span style="font-size:${u(1.45)};font-weight:600;letter-spacing:0.24em;text-transform:uppercase;color:${brand}">${esc(p.organizationName)}</span>`;

  const css = `
    @page { size: ${paper === 'letter' ? 'letter' : 'A4'} landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fffdf8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: ${page.w}mm; height: ${page.h}mm; display: flex; align-items: center; justify-content: center; overflow: hidden; page-break-after: avoid; }
    .cert { position: relative; width: ${W.toFixed(2)}mm; height: ${H.toFixed(2)}mm; background: linear-gradient(180deg, #fffdf8 0%, #fbf7ee 100%); color: #1f1d1a; overflow: hidden; font-family: ${sans}; }
    .abs { position: absolute; }
    .body { position: absolute; inset: ${u(6.5)} ${u(8)}; display: flex; flex-direction: column; align-items: center; text-align: center; }
    .muted { color: #6b645a; }
    .rule { height: ${u(0.1)}; background: rgba(31, 29, 26, 0.2); margin: ${u(0.6)} 0; }
  `;

  const revoked = p.revoked
    ? `<div class="abs" style="inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,253,248,0.55)">
         <span style="transform:rotate(-14deg);border:${u(0.4)} solid #b91c1c;color:#b91c1c;padding:${u(0.8)} ${u(3)};font-size:${u(4.5)};font-weight:700;letter-spacing:0.2em;border-radius:${u(0.8)}">REVOKED</span>
       </div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${esc(certTitle)} — ${esc(p.recipientName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,600;1,8..60,400&display=swap" rel="stylesheet"/>
<style>${css}</style>
</head>
<body>
<div class="page">
  <div class="cert" role="img" aria-label="${esc(certTitle)} awarded to ${esc(p.recipientName)} for ${esc(p.title)}">
    <div class="abs" style="inset:${u(2.4)};border:${u(0.18)} solid ${brand};border-radius:${u(0.6)};opacity:0.85"></div>
    <div class="abs" style="inset:${u(3.1)};border:${u(0.08)} solid ${brand};border-radius:${u(0.4)};opacity:0.35"></div>
    <div class="abs" style="right:-${u(12)};top:-${u(16)};width:${u(46)};height:${u(46)};border-radius:50%;background:radial-gradient(circle, ${brand}1f 0%, transparent 70%)"></div>
    <div class="abs" style="left:-${u(10)};bottom:-${u(18)};width:${u(40)};height:${u(40)};border-radius:50%;background:radial-gradient(circle, #f59e0b14 0%, transparent 70%)"></div>

    <div class="body">
      <div style="display:flex;align-items:center;gap:${u(1.2)};height:${u(4)}">${logo}</div>
      <div style="margin-top:${u(3.2)};font-family:${serif};font-size:${u(4.4)};font-weight:600;letter-spacing:-0.01em;line-height:1.1">${esc(certTitle)}</div>
      <div class="muted" style="margin-top:${u(2.4)};font-size:${u(1.55)};letter-spacing:0.02em">This certifies that</div>
      <div style="margin-top:${u(1.2)};font-family:${serif};font-size:${u(5.6)};font-style:italic;line-height:1.15;max-width:${u(76)};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.recipientName)}</div>
      <div style="width:${u(38)};height:${u(0.12)};background:${brand}66;margin-top:${u(1)}"></div>
      <div class="muted" style="margin-top:${u(2)};font-size:${u(1.55)}">has successfully completed the ${p.kind === 'path' ? 'learning path' : 'course'}</div>
      <div style="margin-top:${u(1)};font-size:${u(2.7)};font-weight:600;line-height:1.25;max-width:${u(72)};letter-spacing:-0.01em">${esc(p.title)}</div>

      <div style="margin-top:auto;width:100%;display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:${u(3)}">
        <div style="text-align:left">
          <div style="font-family:${serif};font-size:${u(2)};font-style:italic;min-height:${u(2.6)}">${esc(p.signatory ?? '')}</div>
          <div class="rule"></div>
          <div class="muted" style="font-size:${u(1.2)}">${esc(p.signatoryTitle || p.academyName || p.organizationName)}</div>
        </div>
        ${seal(brand, u(11))}
        <div style="text-align:right">
          <div style="font-size:${u(1.7)};font-weight:500;min-height:${u(2.6)};line-height:${u(2.6)}">${esc(certificateDate(p.issuedAt, 'long', p.timeZone ?? 'UTC'))}</div>
          <div class="rule"></div>
          <div class="muted" style="font-size:${u(1.2)}">${p.expiresAt ? `Valid until ${esc(certificateDate(p.expiresAt, 'long', p.timeZone ?? 'UTC'))}` : 'Date issued'}</div>
        </div>
      </div>
      <div style="margin-top:${u(2.2)};font-size:${u(1.05)};color:#8a8378;letter-spacing:0.08em">
        CREDENTIAL ID <span style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace;letter-spacing:0.06em;color:#4b463f">${esc(p.credentialId)}</span>
        ${p.verifyUrl ? `<span style="letter-spacing:0.02em"> · Verify at ${esc(p.verifyUrl)}</span>` : ''}
      </div>
    </div>
    ${revoked}
  </div>
</div>
</body>
</html>`;
}

/** A filesystem-safe PDF filename for a certificate. */
export function certificateFilename(p: Pick<CertificateHtmlProps, 'recipientName' | 'title' | 'credentialId'>) {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  return `${safe(`${p.recipientName} - ${p.title}`).slice(0, 90)} - ${safe(p.credentialId)}.pdf`;
}
