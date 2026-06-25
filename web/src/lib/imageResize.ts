// Width maths for resizing an inline note image. Pure + framework-free so the
// clamp logic is unit-tested in isolation and reused by both the preset control
// (28-A) and the drag handle (28-B).

export const PRESET_WIDTHS = { Small: 240, Medium: 480, Large: 720 } as const;

// Never let an image collapse to an unusable sliver.
export const MIN_IMAGE_WIDTH = 48;

export type PresetSize = keyof typeof PRESET_WIDTHS | 'Original';

// Clamp a desired pixel width to [MIN_IMAGE_WIDTH, min(natural, content)].
// A natural/content width of 0 or undefined means "unknown" and is ignored as a
// cap (e.g. natural width before the image has loaded, content width in jsdom).
export function clampWidth(desired: number, naturalWidth?: number, contentWidth?: number): number {
  const caps = [naturalWidth, contentWidth].filter((c): c is number => !!c && c > 0);
  const upper = caps.length > 0 ? Math.min(...caps) : Number.POSITIVE_INFINITY;
  return Math.round(Math.max(MIN_IMAGE_WIDTH, Math.min(desired, upper)));
}

// The clamped pixel width for a preset, or null for "Original" (clears the width
// → the image renders at its natural size).
export function presetWidth(
  size: PresetSize,
  naturalWidth?: number,
  contentWidth?: number,
): number | null {
  if (size === 'Original') return null;
  return clampWidth(PRESET_WIDTHS[size], naturalWidth, contentWidth);
}

// The clamped width for a live corner drag: the width at drag start plus the
// horizontal pointer delta, clamped to the same [min, natural, content] bounds as
// the presets. Aspect ratio is preserved implicitly — only width is set and the
// <img> keeps its intrinsic ratio (height: auto).
export function nextWidthFromDrag(
  startWidth: number,
  deltaX: number,
  naturalWidth?: number,
  contentWidth?: number,
): number {
  return clampWidth(startWidth + deltaX, naturalWidth, contentWidth);
}
