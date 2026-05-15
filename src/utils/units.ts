import { pixelRound } from "~/utils/common.js";

/**
 * Android density-independent pixel conversion.
 *
 * The divisor converts Figma px (at the design file's density) into Android dp/sp.
 * Figma files designed at 1× (360dp-wide artboards) map 1:1. Files designed at 2×
 * (720dp-wide) need a divisor of 2 so 16 px → 8 dp.
 *
 * The divisor is set once at startup from ServerConfig and never changes per
 * request — this is a global assumption about the design file, not a per-node
 * property.
 */

let designDensityDivisor: number = 1;

/** One-time init from config. Default 1 (mdpi == 1× design). */
export function setDesignDensityDivisor(divisor: number): void {
  if (divisor <= 0) throw new Error(`design density divisor must be positive, got ${divisor}`);
  designDensityDivisor = divisor;
}

export function getDesignDensityDivisor(): number {
  return designDensityDivisor;
}

/**
 * Convert a pixel value to an Android dp string.
 * 16 (at 1× design) → "16dp"
 * 32 (at 2× design) → "16dp"
 */
export function dpString(pxValue: number): string {
  return `${pixelRound(pxValue / designDensityDivisor)}dp`;
}

/**
 * Convert a pixel value to an Android sp string (for font sizes / line heights).
 * 14 (at 1× design) → "14sp"
 * 28 (at 2× design) → "14sp"
 */
export function spString(pxValue: number): string {
  return `${pixelRound(pxValue / designDensityDivisor)}sp`;
}

/**
 * Android density buckets and their scale factors relative to 1× (mdpi).
 */
export const ANDROID_DENSITIES: Record<string, number> = {
  ldpi: 0.75,
  mdpi: 1.0,
  hdpi: 1.5,
  xhdpi: 2.0,
  xxhdpi: 3.0,
  xxxhdpi: 4.0,
};

export type AndroidDensity = keyof typeof ANDROID_DENSITIES;

/**
 * Guess the design density from the width of a top-level frame.
 * Returns the divisor to apply to px values:
 *   width ≤ 480 → 1 (1× / mdpi)
 *   width ≤ 900 → 2 (2× / xhdpi)
 *   width > 900 → 3 (3× / xxhdpi)
 */
export function guessDesignDensity(frameWidth: number): number {
  if (frameWidth <= 480) return 1;
  if (frameWidth <= 900) return 2;
  return 3;
}
