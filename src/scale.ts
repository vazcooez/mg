/**
 * Numeric encodings for the property table: bar meters and sequential
 * colour-scale cells.
 *
 * The ramp is a single blue hue with monotone lightness (validated: hue spread
 * 3°, lightness monotone). Categorical gates — CVD adjacent separation, chroma
 * floor — do not apply to a continuous sequential ramp. The one thing that does
 * matter is that the value stays readable on every step, so the label colour is
 * computed from each step's contrast rather than assumed.
 */

/** Light surface: lightest step means "near zero" and recedes toward the page. */
const RAMP_LIGHT = [
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
];

/**
 * Dark surface: steps selected for the dark plane rather than flipped, so the
 * low end recedes into the surface and magnitude reads as "brighter".
 */
const RAMP_DARK = [
  '#0d366b',
  '#104281',
  '#184f95',
  '#1c5cab',
  '#256abf',
  '#2a78d6',
  '#3987e5',
  '#5598e7',
  '#6da7ec',
  '#86b6ef',
];

/*
 * Pure black/white rather than the softer ink tokens: at the ramp's crossover
 * step both inks sit near the 4.5:1 line, and only the maximal pair clears it
 * on every step (worst case ≈ 4.58:1 instead of 4.46:1).
 */
const INK_DARK = '#000000';
const INK_LIGHT = '#ffffff';

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLinear((n >> 16) & 0xff);
  const g = srgbToLinear((n >> 8) & 0xff);
  const b = srgbToLinear(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whichever ink reads better on this step — never a guess. */
export function inkFor(background: string): string {
  return contrast(background, INK_DARK) >= contrast(background, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

export interface Range {
  min: number;
  max: number;
}

/** Normalises a value into 0..1 within a range, tolerating a zero-width range. */
export function fraction(value: number, range: Range): number {
  const span = range.max - range.min;
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.min(1, Math.max(0, (value - range.min) / span));
}

export function rampStep(fractionValue: number, theme: 'dark' | 'light'): string {
  const ramp = theme === 'dark' ? RAMP_DARK : RAMP_LIGHT;
  const i = Math.min(ramp.length - 1, Math.max(0, Math.round(fractionValue * (ramp.length - 1))));
  return ramp[i];
}

export interface ScaleStyle {
  background: string;
  color: string;
}

/** Background + guaranteed-legible label colour for a colour-scale cell. */
export function scaleStyle(value: number, range: Range, theme: 'dark' | 'light'): ScaleStyle {
  const background = rampStep(fraction(value, range), theme);
  return { background, color: inkFor(background) };
}

/** Computes the min/max across a set of numbers, ignoring blanks. */
export function rangeOf(values: Array<number | null>, explicit?: Partial<Range>): Range {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  const min = explicit?.min ?? (nums.length ? Math.min(...nums) : 0);
  const max = explicit?.max ?? (nums.length ? Math.max(...nums) : 1);
  return max > min ? { min, max } : { min, max: min + 1 };
}
