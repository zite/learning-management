import { useEffect } from 'react';
import { brandTokens } from '@project/shared/brand';

export { brandTokens, contrast, hexToRgb } from '@project/shared/brand';

/** Writes the brand tokens into a style tag, so both themes switch with no JavaScript. */
export function useBrand(hex: string | null | undefined) {
  useEffect(() => {
    if (!hex) return;
    const t = brandTokens(hex);
    let el = document.getElementById('lms-brand') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'lms-brand';
      document.head.appendChild(el);
    }
    el.textContent =
      `:root{--primary:${t.light.primary};--ring:${t.light.primary};--primary-foreground:${t.light.foreground};--brand:${hex};}` +
      `.dark{--primary:${t.dark.primary};--ring:${t.dark.primary};--primary-foreground:${t.dark.foreground};}`;

    // The tab icon picks up the brand too. The platform injects its own <link rel=icon>, so replace it from here.
    const mark =
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="${hex}"/>` +
          '<path d="M25 17.5c0-3.9 3.1-7 7-7s7 3.1 7 7" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><rect x="21" y="19" width="22" height="4.5" rx="2.25" fill="#fff"/>' +
          '<path d="M23 24h18l-1.6 20.5a3 3 0 0 1-3 2.8h-8.8a3 3 0 0 1-3-2.8z" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/>' +
          '<path d="M32 29.5c2.6 3 3.9 5.1 3.9 7.1a3.9 3.9 0 0 1-7.8 0c0-2 1.3-4.1 3.9-7.1z" fill="#fde68a"/><rect x="24" y="48.5" width="16" height="4" rx="2" fill="#fff"/></svg>',
      );
    document.querySelectorAll("link[rel~='icon']").forEach(n => n.remove());
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = mark;
    document.head.appendChild(link);
  }, [hex]);
}
