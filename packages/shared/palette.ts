/**
 * The colours the app hands out on its own — course, path, category, group and
 * avatar defaults. Deep, slightly muted pigments that sit on warm paper and
 * carry white text, rather than the stock bright UI swatches. The first entry
 * is the default for anything created without a colour.
 */
export const PALETTE: string[] = [
  '#2f6b55', // pine
  '#34608c', // harbor
  '#c0532a', // ember
  '#a8730f', // ochre
  '#a4445c', // rosewood
  '#1d6f78', // lagoon
  '#5f7a2c', // moss
  '#96583a', // clay
  '#2e4a70', // navy
  '#5b5650', // graphite
];

export const DEFAULT_COLOR = PALETTE[0];

/** Offered to organizations picking a brand colour: wider than the palette, since a brand may be any hue. */
export const BRAND_SWATCHES = ['#2f6b55', '#1d6f78', '#34608c', '#2e4a70', '#4a4f9c', '#6f3f6e', '#a4445c', '#b23a2e', '#c0532a', '#a8730f', '#5f7a2c', '#2b2825'];

/** Stable pick from the palette for a name or id. */
export function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
