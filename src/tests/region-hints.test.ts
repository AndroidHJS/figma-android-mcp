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
