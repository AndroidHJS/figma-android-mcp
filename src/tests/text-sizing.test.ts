import { describe, it, expect } from "vitest";
import type { Node as FigmaDocumentNode } from "@figma/rest-api-spec";
import { buildSimplifiedLayout } from "~/transformers/layout.js";

/**
 * applyTextSizingIntent — fixed text pixels must not become hard widths
 * (they clip on device), while wrap bases and truncation boxes stay fixed.
 * Dimensions are always kept for the geometry passes; only sizing changes.
 */

const parent = {
  id: "0:1",
  name: "Screen",
  type: "FRAME",
  clipsContent: true,
  absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 800 },
} as unknown as FigmaDocumentNode;

function textNode(style: Record<string, unknown>, height = 20): FigmaDocumentNode {
  return {
    id: "1:1",
    name: "Label",
    type: "TEXT",
    absoluteBoundingBox: { x: 10, y: 10, width: 93, height },
    constraints: { horizontal: "LEFT", vertical: "TOP" },
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "FIXED",
    style,
  } as unknown as FigmaDocumentNode;
}

describe("text sizing intent", () => {
  it("WIDTH_AND_HEIGHT → hug both axes, dimensions kept for geometry", () => {
    const layout = buildSimplifiedLayout(textNode({ textAutoResize: "WIDTH_AND_HEIGHT" }), parent);
    expect(layout.sizing?.horizontal).toBe("hug");
    expect(layout.sizing?.vertical).toBe("hug");
    expect(layout.dimensions?.width).toBe("93dp");
  });

  it("HEIGHT (multi-line wrap basis) → width stays fixed, height hugs", () => {
    const layout = buildSimplifiedLayout(
      textNode({ textAutoResize: "HEIGHT", lineHeightPx: 20 }, 60),
      parent,
    );
    expect(layout.sizing?.horizontal).toBe("fixed");
    expect(layout.sizing?.vertical).toBe("hug");
    expect(layout.dimensions?.width).toBe("93dp");
  });

  it("textTruncation ENDING → untouched (the fixed box is the intent)", () => {
    const layout = buildSimplifiedLayout(
      textNode({ textAutoResize: "NONE", textTruncation: "ENDING", lineHeightPx: 20 }),
      parent,
    );
    expect(layout.sizing?.horizontal).toBe("fixed");
    expect(layout.sizing?.vertical).toBe("fixed");
  });

  it("NONE single-line (the 'Ajukan' clipping case) → hug both axes", () => {
    const layout = buildSimplifiedLayout(
      textNode({ textAutoResize: "NONE", lineHeightPx: 20 }, 20),
      parent,
    );
    expect(layout.sizing?.horizontal).toBe("hug");
    expect(layout.sizing?.vertical).toBe("hug");
  });

  it("NONE multi-line → width kept as wrap basis", () => {
    const layout = buildSimplifiedLayout(
      textNode({ textAutoResize: "NONE", lineHeightPx: 20 }, 60),
      parent,
    );
    expect(layout.sizing?.horizontal).toBe("fixed");
  });

  it("explicit FILL is never downgraded to hug", () => {
    const node = textNode({ textAutoResize: "WIDTH_AND_HEIGHT" });
    (node as unknown as Record<string, unknown>).layoutSizingHorizontal = "FILL";
    const layout = buildSimplifiedLayout(node, parent);
    expect(layout.sizing?.horizontal).toBe("fill");
    expect(layout.sizing?.vertical).toBe("hug");
  });

  it("single-line heuristic falls back to fontSize when lineHeightPx is absent", () => {
    const layout = buildSimplifiedLayout(
      textNode({ textAutoResize: "NONE", fontSize: 14 }, 20),
      parent,
    );
    expect(layout.sizing?.horizontal).toBe("hug");
  });

  it("non-TEXT nodes are unaffected", () => {
    const rect = {
      id: "1:2",
      name: "Box",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 0, y: 0, width: 93, height: 20 },
      constraints: { horizontal: "LEFT", vertical: "TOP" },
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
    } as unknown as FigmaDocumentNode;
    const layout = buildSimplifiedLayout(rect, parent);
    expect(layout.sizing?.horizontal).toBe("fixed");
    expect(layout.dimensions?.width).toBe("93dp");
  });
});
