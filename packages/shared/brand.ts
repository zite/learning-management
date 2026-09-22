/**
 * The organization's brand colour, made safe to use everywhere — shared by the
 * learner app (which applies it at runtime) and the admin Settings preview.
 *
 * Shared components use `text-primary` for links and `bg-primary` with
 * `text-primary-foreground` for buttons, so `--primary` itself must read at
 * 4.5:1 on the page background in both themes. A pale brand colour is
 * darkened for light mode and every brand colour is lightened for dark mode,
 * keeping its hue, and the button text is whichever of white or near-black
 * contrasts more.
 */

type RGB = [number, number, number];
type HSL = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const NEAR_BLACK: RGB = [15, 15, 20];
const DARK_BG: HSL = [240, 5, 9];

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: RGB): HSL {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToRgb([h, s, l]: HSL): RGB {
  const ss = s / 100;
  const ll = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function luminance([r, g, b]: RGB) {
  const c = [r, g, b].map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: RGB, b: RGB) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const hsl = ([h, s, l]: HSL) => `${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%`;

function foregroundFor(rgb: RGB) {
  return contrast(WHITE, rgb) >= contrast(NEAR_BLACK, rgb) ? '0 0% 100%' : '240 10% 6%';
}

export function brandTokens(hex: string) {
  const rgb = hexToRgb(hex) ?? hexToRgb('#2f7a55')!;
  const [h, s, l] = rgbToHsl(rgb);

  let light: HSL = [h, s, l];
  while (contrast(hslToRgb(light), WHITE) < 4.6 && light[2] > 4) light = [h, s, light[2] - 1];

  const darkBg = hslToRgb(DARK_BG);
  let dark: HSL = [h, Math.min(s, 88), Math.max(l, 64)];
  while (contrast(hslToRgb(dark), darkBg) < 7 && dark[2] < 96) dark = [h, dark[1], dark[2] + 1];

  return {
    light: { primary: hsl(light), foreground: foregroundFor(hslToRgb(light)) },
    dark: { primary: hsl(dark), foreground: foregroundFor(hslToRgb(dark)) },
    raw: hex,
  };
}

// ── Preview helpers (Settings) ─────────────────────────────────────────────

/** "162 52% 22%" → [r, g, b]. */
export function hslStringToRgb(value: string): RGB {
  const [h, s, l] = value.replace(/%/g, '').split(/\s+/).map(Number);
  return hslToRgb([h, s, l]);
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
export const rgbToHex = ([r, g, b]: RGB) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** Did the learner app have to shift the colour for a theme, and by how much contrast does it land? */
export function brandReport(hex: string) {
  const t = brandTokens(hex);
  const original = hexToRgb(hex) ?? hexToRgb('#2f7a55')!;
  const unchanged = hsl(rgbToHsl(original));
  const light = hslStringToRgb(t.light.primary);
  const dark = hslStringToRgb(t.dark.primary);
  const darkBg = hslToRgb(DARK_BG);
  return {
    tokens: t,
    light: { hex: rgbToHex(light), adjusted: t.light.primary !== unchanged, ratio: contrast(light, WHITE), text: t.light.foreground === '0 0% 100%' ? 'white' : 'dark' },
    dark: { hex: rgbToHex(dark), adjusted: t.dark.primary !== unchanged, ratio: contrast(dark, darkBg), text: t.dark.foreground === '0 0% 100%' ? 'white' : 'dark' },
  };
}
