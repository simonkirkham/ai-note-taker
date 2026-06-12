import { describe, expect, it } from 'vitest';
import {
  MIN_IMAGE_WIDTH,
  PRESET_WIDTHS,
  clampWidth,
  presetWidth,
} from '../lib/imageResize';

describe('clampWidth', () => {
  it('returns the desired width when no caps are known', () => {
    expect(clampWidth(480)).toBe(480);
  });

  it('caps to the natural width (never upscales past the source)', () => {
    expect(clampWidth(720, 400)).toBe(400);
  });

  it('caps to the editor content width', () => {
    expect(clampWidth(720, 2000, 600)).toBe(600);
  });

  it('caps to whichever of natural / content width is smaller', () => {
    expect(clampWidth(720, 500, 600)).toBe(500);
    expect(clampWidth(720, 800, 600)).toBe(600);
  });

  it('never collapses below the minimum width', () => {
    expect(clampWidth(10)).toBe(MIN_IMAGE_WIDTH);
    expect(clampWidth(720, 10)).toBe(MIN_IMAGE_WIDTH);
  });

  it('ignores a zero / unknown cap rather than clamping to it', () => {
    expect(clampWidth(480, 0, 0)).toBe(480);
    expect(clampWidth(480, undefined, undefined)).toBe(480);
  });

  it('returns an integer', () => {
    expect(Number.isInteger(clampWidth(480.6, 333.3, 600))).toBe(true);
  });
});

describe('presetWidth', () => {
  it('maps Small / Medium / Large to their clamped pixel widths', () => {
    expect(presetWidth('Small', 0, 0)).toBe(PRESET_WIDTHS.Small);
    expect(presetWidth('Medium', 0, 0)).toBe(PRESET_WIDTHS.Medium);
    expect(presetWidth('Large', 0, 0)).toBe(PRESET_WIDTHS.Large);
  });

  it('clamps a preset to the natural / content width', () => {
    expect(presetWidth('Large', 300, 0)).toBe(300);
    expect(presetWidth('Large', 0, 500)).toBe(500);
  });

  it('maps Original to null (clears the width — render at natural size)', () => {
    expect(presetWidth('Original', 0, 0)).toBeNull();
  });
});
