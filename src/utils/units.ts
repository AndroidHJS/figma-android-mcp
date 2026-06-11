import { AsyncLocalStorage } from "node:async_hooks";
import { pixelRound } from "~/utils/common.js";

/**
 * Android density-independent pixel conversion.
 *
 * The divisor converts Figma px (at the design file's density) into Android dp/sp.
 * Figma files designed at 1× (360dp-wide artboards) map 1:1. Files designed at 2×
 * (720dp-wide) need a divisor of 2 so 16 px → 8 dp.
 *
 * Scoping: the divisor is a property of the design FILE being processed, not of
 * the server. The simplify pipeline yields to the event loop mid-traversal
 * (node-walker's maybeYield), so concurrent HTTP requests interleave — a plain
 * module global would let one request's auto-detected density bleed into
 * another's. Request scoping uses AsyncLocalStorage: `runWithDensityDivisor`
 * pins the divisor for everything (sync or async) inside its callback, and
 * `dpString`/`spString` read it from there. Outside any scope they fall back
 * to the server-config default.
 *
 * Cross-call coupling: `download_figma_images` arrives as a separate MCP call
 * and needs the divisor that was auto-detected when the file's data was
 * fetched. That is served by the per-fileKey registry below — never by
 * leftover global state.
 */

const densityScope = new AsyncLocalStorage<number>();

/** Server-level default from --design-density config. 1 == mdpi == 1× design. */
let defaultDivisor = 1;

/** Whether per-file auto-detection is allowed (config --design-density=auto). */
let autoDetectEnabled = true;

/** One-time init from config at server startup. */
export function setDefaultDensityDivisor(divisor: number, allowAutoDetect: boolean): void {
  if (divisor <= 0) throw new Error(`design density divisor must be positive, got ${divisor}`);
  defaultDivisor = divisor;
  autoDetectEnabled = allowAutoDetect;
}

/**
 * Divisor to use for a design whose root frame is `frameWidth` px wide.
 * Respects an explicit (non-auto) --design-density: auto-detection must not
 * silently override what the user configured.
 */
export function resolveDensityDivisor(frameWidth: number): number {
  return autoDetectEnabled ? guessDesignDensity(frameWidth) : defaultDivisor;
}

/** Run `fn` with `divisor` pinned for all dp/sp conversions inside it. */
export function runWithDensityDivisor<T>(divisor: number, fn: () => T): T {
  if (divisor <= 0) throw new Error(`design density divisor must be positive, got ${divisor}`);
  return densityScope.run(divisor, fn);
}

export function getDesignDensityDivisor(): number {
  return densityScope.getStore() ?? defaultDivisor;
}

// ---------------------------------------------------------------------------
// Per-fileKey density registry
// ---------------------------------------------------------------------------

const FILE_DENSITY_CACHE_LIMIT = 200;
const fileDensity = new Map<string, number>();

/** Record the divisor resolved while simplifying a file, for later download calls. */
export function recordFileDensityDivisor(fileKey: string, divisor: number): void {
  // Refresh insertion order so the eviction below is LRU-ish.
  fileDensity.delete(fileKey);
  fileDensity.set(fileKey, divisor);
  if (fileDensity.size > FILE_DENSITY_CACHE_LIMIT) {
    const oldest = fileDensity.keys().next().value;
    if (oldest !== undefined) fileDensity.delete(oldest);
  }
}

/**
 * Divisor for a file whose data was previously fetched, falling back to the
 * server default when the file was never simplified in this process (e.g. a
 * direct download_figma_images call).
 */
export function getFileDensityDivisor(fileKey: string): number {
  return fileDensity.get(fileKey) ?? defaultDivisor;
}

/**
 * Convert a pixel value to an Android dp string.
 * 16 (at 1× design) → "16dp"
 * 32 (at 2× design) → "16dp"
 */
export function dpString(pxValue: number): string {
  return `${pixelRound(pxValue / getDesignDensityDivisor())}dp`;
}

/**
 * Convert a pixel value to an Android sp string (for font sizes / line heights).
 * 14 (at 1× design) → "14sp"
 * 28 (at 2× design) → "14sp"
 */
export function spString(pxValue: number): string {
  return `${pixelRound(pxValue / getDesignDensityDivisor())}sp`;
}

/**
 * Convert a letter-spacing px value to an em string relative to the font size.
 *
 * Em is the one unit both Android stacks consume directly — View's
 * `android:letterSpacing` is an em multiplier and Compose accepts
 * `TextUnit.Em` — so emitting em removes a unit conversion the LLM would
 * otherwise have to perform (and routinely gets wrong, e.g. copying a "2%"
 * string into a `.sp` field).
 *
 * Three decimals, not pixelRound's two: 0.5px tracking on a 14px font is
 * 0.0357em, and rounding that to 0.04 is a 12% error — visible in dense text.
 *
 * Density-independent: both inputs are px at the same design density, so the
 * divisor cancels out of the ratio.
 */
export function emString(letterSpacingPx: number, fontSizePx: number): string {
  return `${Number((letterSpacingPx / fontSizePx).toFixed(3))}em`;
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
