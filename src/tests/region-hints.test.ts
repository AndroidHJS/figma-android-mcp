import { describe, test, expect } from "vitest";
import { generateRegionHints } from "~/transformers/region-hints.js";
import type { RegionHint } from "~/transformers/region-hints.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";
import type { GlobalVars, SimplifiedNode } from "~/extractors/types.js";

function makeLayout(overrides: Partial<SimplifiedLayout> = {}): SimplifiedLayout {
  return { mode: "none", ...overrides };
}

function makeNode(overrides: Partial<SimplifiedNode> = {}): SimplifiedNode {
  return { id: "1:1", name: "test", type: "FRAME", ...overrides };
}

function register(globalVars: GlobalVars, layout: SimplifiedLayout): string {
  const key = `layout_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  globalVars.styles[key] = layout;
  return key;
}

function childNode(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  globalVars: GlobalVars,
  overrides: Partial<SimplifiedLayout> = {},
): SimplifiedNode {
  const layout = makeLayout({
    locationRelativeToParent: { x: `${x}dp`, y: `${y}dp` },
    dimensions: { width: `${width}dp`, height: `${height}dp` },
    ...overrides,
  });
  const key = register(globalVars, layout);
  return makeNode({ id, name, type: "FRAME", layout: key });
}

// ============================================================================
// Test 1: Two Column regions (x=0 group + x=200 group)
// ============================================================================
test("two Column regions by x-alignment", () => {
  const globalVars: GlobalVars = { styles: {} };

  // x=0 group: 3 children in a column
  const c1 = childNode("1", "Header", 0, 0, 300, 44, globalVars);
  const c2 = childNode("2", "Subheader", 0, 52, 300, 32, globalVars);
  const c3 = childNode("3", "Divider", 0, 92, 300, 1, globalVars);

  // x=200 group: 2 children in a column
  const c4 = childNode("4", "SideTop", 200, 0, 120, 50, globalVars);
  const c5 = childNode("5", "SideBot", 200, 60, 120, 50, globalVars);

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "Page",
    type: "FRAME",
    layout: parentKey,
    children: [c1, c2, c3, c4, c5],
  });

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(1);
  expect(hints[0].parentId).toBe("p1");
  expect(hints[0].regions).toHaveLength(2);

  const col1 = hints[0].regions.find((r) => r.mode === "column" && r.childIds.includes("1"));
  expect(col1).toBeDefined();
  expect(col1!.childIds).toEqual(["1", "2", "3"]);
  expect(col1!.childNames).toEqual(["Header", "Subheader", "Divider"]);

  const col2 = hints[0].regions.find((r) => r.mode === "column" && r.childIds.includes("4"));
  expect(col2).toBeDefined();
  expect(col2!.childIds).toEqual(["4", "5"]);
});

// ============================================================================
// Test 2: Column + Row mixed
// ============================================================================
test("Column + Row mixed regions", () => {
  const globalVars: GlobalVars = { styles: {} };

  // x=0 group: 2 column children
  const c1 = childNode("1", "Top", 0, 0, 200, 40, globalVars);
  const c2 = childNode("2", "Bottom", 0, 48, 200, 40, globalVars);

  // y=100 group: 2 row children (unassigned after column grouping)
  const c3 = childNode("3", "Left", 50, 100, 80, 40, globalVars);
  const c4 = childNode("4", "Right", 140, 100, 80, 40, globalVars);

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "Mixed",
    type: "FRAME",
    layout: parentKey,
    children: [c1, c2, c3, c4],
  });

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(1);
  expect(hints[0].regions).toHaveLength(2);

  const col = hints[0].regions.find((r) => r.mode === "column");
  expect(col).toBeDefined();
  expect(col!.childIds).toEqual(["1", "2"]);

  const row = hints[0].regions.find((r) => r.mode === "row");
  expect(row).toBeDefined();
  expect(row!.childIds).toEqual(["3", "4"]);
});

// ============================================================================
// Test 3: Column + 1 singleton
// ============================================================================
test("Column + singleton", () => {
  const globalVars: GlobalVars = { styles: {} };

  const c1 = childNode("1", "Item1", 0, 0, 300, 40, globalVars);
  const c2 = childNode("2", "Item2", 0, 48, 300, 40, globalVars);
  // This one is alone at a different x — cannot form column or row with others
  const c3 = childNode("3", "Floating", 200, 200, 60, 60, globalVars);

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "List",
    type: "FRAME",
    layout: parentKey,
    children: [c1, c2, c3],
  });

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(1);
  expect(hints[0].regions).toHaveLength(2);

  const col = hints[0].regions.find((r) => r.mode === "column");
  expect(col).toBeDefined();

  const singleton = hints[0].regions.find((r) => !r.mode);
  expect(singleton).toBeDefined();
  expect(singleton!.childIds).toEqual(["3"]);
  expect(singleton!.gap).toBeUndefined();
});

// ============================================================================
// Test 4: Single region — no hint (all children in same Column)
// ============================================================================
test("no hint when all children in single region", () => {
  const globalVars: GlobalVars = { styles: {} };

  const c1 = childNode("1", "A", 0, 0, 300, 44, globalVars);
  const c2 = childNode("2", "B", 0, 52, 300, 44, globalVars);
  const c3 = childNode("3", "C", 0, 104, 300, 44, globalVars);

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "SingleCol",
    type: "FRAME",
    layout: parentKey,
    children: [c1, c2, c3],
  });

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(0);
});

// ============================================================================
// Test 5: Parent already inferred as Column → skipped
// ============================================================================
test("skips parent already inferred as Column", () => {
  const globalVars: GlobalVars = { styles: {} };

  const c1 = childNode("1", "A", 0, 0, 300, 40, globalVars);
  const c2 = childNode("2", "B", 200, 0, 100, 40, globalVars);

  const parentLayout = makeLayout({ mode: "column" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "AlreadyColumn",
    type: "FRAME",
    layout: parentKey,
    children: [c1, c2],
  });

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(0);
});

// ============================================================================
// Test 6: position="absolute" children are excluded
// ============================================================================
test("excludes absolute-positioned children", () => {
  const globalVars: GlobalVars = { styles: {} };

  const c1 = childNode("1", "Normal", 0, 0, 300, 40, globalVars);
  const c2 = childNode("2", "Normal2", 0, 48, 300, 40, globalVars);
  // Absolute child — should be ignored
  const c3 = childNode("3", "Absolute", 200, 0, 60, 60, globalVars, { position: "absolute" });

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "WithAbsolute",
    type: "FRAME",
    layout: parentKey,
    children: [c1, c2, c3],
  });

  const hints = generateRegionHints([parent], globalVars);
  // Only c1 and c2 are eligible, forming a single region → no hint
  expect(hints).toHaveLength(0);
});

// ============================================================================
// Test 7: Recursive — two levels each with multi-region
// ============================================================================
test("recursive nested multi-region parents", () => {
  const globalVars: GlobalVars = { styles: {} };

  // Inner parent's children — placed at different x AND y so neither
  // Column nor Row grouping captures them together → 2 singletons → 2 regions
  const ic1 = childNode("i1", "InnerA", 0, 0, 100, 30, globalVars);
  const ic2 = childNode("i2", "InnerB", 200, 60, 100, 30, globalVars);

  const innerLayout = makeLayout({ mode: "none" });
  const innerKey = register(globalVars, innerLayout);
  const inner = makeNode({
    id: "inner",
    name: "InnerFrame",
    type: "FRAME",
    layout: innerKey,
    children: [ic1, ic2],
  });

  // Outer parent's children
  const oc1 = childNode("o1", "OuterA", 0, 0, 300, 44, globalVars);
  const oc2 = childNode("o2", "OuterB", 0, 52, 300, 44, globalVars);
  const oc3 = childNode("o3", "OuterC", 200, 100, 100, 40, globalVars); // forms singleton with inner

  const outerLayout = makeLayout({ mode: "none" });
  const outerKey = register(globalVars, outerLayout);
  const outer = makeNode({
    id: "outer",
    name: "OuterFrame",
    type: "FRAME",
    layout: outerKey,
    children: [oc1, oc2, inner, oc3],
  });

  const hints = generateRegionHints([outer], globalVars);

  // Outer has its own hint
  const outerHint = hints.find((h) => h.parentId === "outer");
  expect(outerHint).toBeDefined();
  expect(outerHint!.regions.length).toBeGreaterThanOrEqual(2);

  // Inner also has its own hint
  const innerHint = hints.find((h) => h.parentId === "inner");
  expect(innerHint).toBeDefined();
  expect(innerHint!.regions).toHaveLength(2);
});

// ============================================================================
// Test 8: Consistent gap in region
// ============================================================================
test("consistent gap is detected", () => {
  const globalVars: GlobalVars = { styles: {} };

  const c1 = childNode("1", "A", 0, 0, 300, 40, globalVars);
  const c2 = childNode("2", "B", 0, 52, 300, 40, globalVars); // gap = 12
  const c3 = childNode("3", "C", 0, 104, 300, 40, globalVars); // gap = 12

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "ConsistentGap",
    type: "FRAME",
    layout: parentKey,
    children: [c1, c2, c3],
  });

  // All 3 in same column → single region → no hint
  // Need two columns to trigger output
  const c4 = childNode("4", "Side1", 200, 0, 100, 40, globalVars);
  const c5 = childNode("5", "Side2", 200, 52, 100, 40, globalVars);
  parent.children!.push(c4, c5);

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(1);

  const col1 = hints[0].regions.find((r) => r.childIds.includes("1"));
  expect(col1).toBeDefined();
  expect(col1!.gap).toBe("12dp");

  const col2 = hints[0].regions.find((r) => r.childIds.includes("4"));
  expect(col2).toBeDefined();
  expect(col2!.gap).toBe("12dp");
});

// ============================================================================
// Test 9: Inconsistent gap → undefined
// ============================================================================
test("inconsistent gap yields undefined", () => {
  const globalVars: GlobalVars = { styles: {} };

  // gap between c1-c2 = 12, c2-c3 = 30 → spread = 18 > GAP_TOLERANCE(3)
  const c1 = childNode("1", "A", 0, 0, 300, 40, globalVars);
  const c2 = childNode("2", "B", 0, 52, 300, 40, globalVars);
  const c3 = childNode("3", "C", 0, 122, 300, 40, globalVars);

  // Second column to trigger output
  const c4 = childNode("4", "Side", 200, 0, 100, 40, globalVars);

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "InconsistentGap",
    type: "FRAME",
    layout: parentKey,
    children: [c1, c2, c3, c4],
  });

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(1);

  const col1 = hints[0].regions.find((r) => r.childIds.includes("1"));
  expect(col1).toBeDefined();
  expect(col1!.gap).toBeUndefined();
});

// ============================================================================
// Test 10: Eligible children < 2 → no hint
// ============================================================================
test("no hint when fewer than 2 eligible children", () => {
  const globalVars: GlobalVars = { styles: {} };

  const c1 = childNode("1", "Only", 0, 0, 300, 40, globalVars);

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "SingleChild",
    type: "FRAME",
    layout: parentKey,
    children: [c1],
  });

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(0);
});

// ============================================================================
// Test 11: Full containment → stack region
// ============================================================================
test("full containment produces stack region", () => {
  const globalVars: GlobalVars = { styles: {} };

  // Card fully contains Content (overlap ratio = 100%)
  const card = childNode("card", "Card", 0, 0, 360, 120, globalVars);
  const content = childNode("content", "Content", 16, 16, 328, 88, globalVars);
  // Footer is unrelated — needed to produce regions.length >= 2
  const footer = childNode("footer", "Footer", 0, 140, 360, 56, globalVars);

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "Screen",
    type: "FRAME",
    layout: parentKey,
    children: [card, content, footer],
  });

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(1);

  const stack = hints[0].regions.find((r) => r.mode === "stack");
  expect(stack).toBeDefined();
  expect(stack!.childIds).toEqual(["card", "content"]);
  expect(stack!.gap).toBeUndefined();

  // footer becomes singleton (or column), and together with stack → 2 regions
  expect(hints[0].regions.length).toBeGreaterThanOrEqual(2);
});

// ============================================================================
// Test 12: Stack + column coexist
// ============================================================================
test("stack and column regions coexist", () => {
  const globalVars: GlobalVars = { styles: {} };

  // Two fully-overlapping nodes → stack
  const bg = childNode("bg", "CardBg", 0, 0, 300, 100, globalVars);
  const overlay = childNode("overlay", "CardOverlay", 0, 0, 300, 100, globalVars);

  // Two vertically-stacked nodes below → column
  const title = childNode("title", "Title", 0, 120, 300, 40, globalVars);
  const body = childNode("body", "Body", 0, 168, 300, 40, globalVars);

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "Card",
    type: "FRAME",
    layout: parentKey,
    children: [bg, overlay, title, body],
  });

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(1);
  expect(hints[0].regions).toHaveLength(2);

  const stack = hints[0].regions.find((r) => r.mode === "stack");
  expect(stack).toBeDefined();
  expect(stack!.childIds).toEqual(["bg", "overlay"]);
  // z-order is an explicit field, not an implicit array-order convention
  expect(stack!.zOrder).toContain("bottom→top");

  const col = hints[0].regions.find((r) => r.mode === "column");
  expect(col).toBeDefined();
  expect(col!.childIds).toEqual(["title", "body"]);
  expect(col!.zOrder).toBeUndefined();
});

// ============================================================================
// Test 12.5: Contained RECTANGLE painted over by content → background attachment
// ============================================================================
test("contained RECTANGLE painted over by content becomes a background attachment", () => {
  const globalVars: GlobalVars = { styles: {} };

  // Card host 360x200. Inner data-area bg 328x100 — too large for the
  // attachment size-disparity gate (area ratio 0.456 > 0.3) but fully
  // contained, with the Amount text painted on top of it.
  const card = childNode("card", "CardBg", 0, 0, 360, 200, globalVars);
  const innerLayout = makeLayout({
    locationRelativeToParent: { x: "16dp", y: "90dp" },
    dimensions: { width: "328dp", height: "100dp" },
  });
  const innerBg = makeNode({
    id: "inner",
    name: "DataAreaBg",
    type: "RECTANGLE",
    layout: register(globalVars, innerLayout),
  });
  const amount = childNode("amount", "Amount", 24, 110, 100, 20, globalVars);
  // Footer → second region so the hint is emitted
  const footer = childNode("footer", "Footer", 0, 220, 360, 56, globalVars);

  const parentKey = register(globalVars, makeLayout());
  const parent = makeNode({
    id: "p1",
    name: "Screen",
    type: "FRAME",
    layout: parentKey,
    children: [card, innerBg, amount, footer],
  });

  const hints = generateRegionHints([parent], globalVars);
  expect(hints).toHaveLength(1);

  const stack = hints[0].regions.find((r) => r.mode === "stack");
  expect(stack).toBeDefined();
  expect(stack!.childIds).toEqual(["card", "inner", "amount"]);

  const bg = stack!.attachments?.find((a) => a.childId === "inner");
  expect(bg).toBeDefined();
  expect(bg!.role).toBe("background");
  expect(bg!.hostId).toBe("card");

  // The text riding on the inner bg keeps its normal (role-less) attachment.
  const text = stack!.attachments?.find((a) => a.childId === "amount");
  expect(text).toBeDefined();
  expect(text!.role).toBeUndefined();
});

// ============================================================================
// Test 12.6: Contained non-RECTANGLE is never marked as background
// ============================================================================
test("contained non-RECTANGLE is not marked as background", () => {
  const globalVars: GlobalVars = { styles: {} };

  // Same geometry as 12.5 but the inner layer is a FRAME — could be
  // foreground content, so geometry alone must not flag it.
  const card = childNode("card", "CardBg", 0, 0, 360, 200, globalVars);
  const inner = childNode("inner", "InnerPanel", 16, 90, 328, 100, globalVars);
  const amount = childNode("amount", "Amount", 24, 110, 100, 20, globalVars);
  const footer = childNode("footer", "Footer", 0, 220, 360, 56, globalVars);

  const parentKey = register(globalVars, makeLayout());
  const parent = makeNode({
    id: "p1",
    name: "Screen",
    type: "FRAME",
    layout: parentKey,
    children: [card, inner, amount, footer],
  });

  const hints = generateRegionHints([parent], globalVars);
  const stack = hints[0].regions.find((r) => r.mode === "stack");
  expect(stack).toBeDefined();
  expect(stack!.childIds).toContain("inner");
  expect(stack!.attachments?.some((a) => a.childId === "inner")).toBe(false);
});

// ============================================================================
// Test 13: Micro-overlap below threshold → not a stack
// ============================================================================
test("micro-overlap below threshold is not treated as stack", () => {
  const globalVars: GlobalVars = { styles: {} };

  // RowA bottom bleeds 2dp into RowB top: overlap=360×2=720, min_area=360×44=15840, ratio≈4.5%
  const rowA = childNode("a", "RowA", 0, 0, 360, 44, globalVars);
  const rowB = childNode("b", "RowB", 0, 42, 360, 44, globalVars);

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "List",
    type: "FRAME",
    layout: parentKey,
    children: [rowA, rowB],
  });

  const hints = generateRegionHints([parent], globalVars);
  // No stack region should be produced
  const allRegions = hints.flatMap((h) => h.regions);
  expect(allRegions.every((r) => r.mode !== "stack")).toBe(true);
});

// ============================================================================
// Test 14: Zero-size element (missing dimensions) → no crash, no stack
// ============================================================================
test("zero-size element does not crash and is not stacked", () => {
  const globalVars: GlobalVars = { styles: {} };

  // NodeA has no dimensions → width=0, height=0
  const nodeA = childNode("a", "Ghost", 0, 0, 0, 0, globalVars);
  const nodeB = childNode("b", "Real", 0, 0, 300, 100, globalVars);
  // Third node to allow regions.length >= 2 if a hint were emitted
  const nodeC = childNode("c", "Other", 0, 120, 300, 40, globalVars);

  const parentLayout = makeLayout({ mode: "none" });
  const parentKey = register(globalVars, parentLayout);
  const parent = makeNode({
    id: "p1",
    name: "Frame",
    type: "FRAME",
    layout: parentKey,
    children: [nodeA, nodeB, nodeC],
  });

  // Must not throw
  expect(() => generateRegionHints([parent], globalVars)).not.toThrow();

  const hints = generateRegionHints([parent], globalVars);
  const allRegions = hints.flatMap((h) => h.regions);
  // Zero-size nodeA cannot form a significant overlap with anything
  expect(allRegions.every((r) => r.mode !== "stack")).toBe(true);
});
