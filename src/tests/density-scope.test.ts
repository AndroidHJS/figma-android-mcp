import { describe, expect, it } from "vitest";
import {
  dpString,
  getFileDensityDivisor,
  recordFileDensityDivisor,
  resolveDensityDivisor,
  runWithDensityDivisor,
  setDefaultDensityDivisor,
} from "~/utils/units.js";

describe("density divisor scoping", () => {
  it("isolates concurrent conversions — one request's divisor never bleeds into another", async () => {
    setDefaultDensityDivisor(1, true);

    // Two "requests" interleaving at await points, like the node-walker's
    // maybeYield does under HTTP concurrency. The 2× design must keep
    // dividing by 2 even while the 1× design runs in parallel.
    const at2x = runWithDensityDivisor(2, async () => {
      const before = dpString(32);
      await new Promise((r) => setImmediate(r));
      const after = dpString(32);
      return { before, after };
    });
    const at1x = runWithDensityDivisor(1, async () => {
      await new Promise((r) => setImmediate(r));
      return dpString(32);
    });

    const [two, one] = await Promise.all([at2x, at1x]);
    expect(two).toEqual({ before: "16dp", after: "16dp" });
    expect(one).toBe("32dp");
  });

  it("falls back to the server default outside any request scope", () => {
    setDefaultDensityDivisor(2, false);
    expect(dpString(32)).toBe("16dp");
    setDefaultDensityDivisor(1, true);
  });

  it("auto-detects from frame width only when config allows it", () => {
    setDefaultDensityDivisor(2, false);
    // Explicit --design-density=xhdpi: a 720px-wide frame must NOT override it.
    expect(resolveDensityDivisor(720)).toBe(2);

    setDefaultDensityDivisor(1, true);
    expect(resolveDensityDivisor(720)).toBe(2); // auto: 720px → 2×
    expect(resolveDensityDivisor(360)).toBe(1); // auto: 360px → 1×
  });

  it("serves download calls from the per-file registry, not leftover request state", () => {
    setDefaultDensityDivisor(1, true);
    recordFileDensityDivisor("fileA", 2);
    recordFileDensityDivisor("fileB", 3);

    expect(getFileDensityDivisor("fileA")).toBe(2);
    expect(getFileDensityDivisor("fileB")).toBe(3);
    // Never-simplified file → server default.
    expect(getFileDensityDivisor("unknown")).toBe(1);
  });
});
