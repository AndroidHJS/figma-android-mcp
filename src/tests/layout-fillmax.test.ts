import { describe, test, expect } from "vitest";
import { convertFixedChildrenToFillMax } from "~/transformers/layout.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";
import type { GlobalVars, SimplifiedNode } from "~/extractors/types.js";

function makeLayout(overrides: Partial<SimplifiedLayout> = {}): SimplifiedLayout {
  return { mode: "none", ...overrides };
}

function makeNode(overrides: Partial<SimplifiedNode> = {}): SimplifiedNode {
  return { id: "1:1", name: "test", type: "RECTANGLE", ...overrides };
}

function register(
  globalVars: GlobalVars,
  layout: SimplifiedLayout,
  prefix = "layout",
): string {
  const key = `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  globalVars.styles[key] = layout;
  return key;
}

// ============================================================================
// Horizontal conversion (Column parent)
// ============================================================================
describe("convertFixedChildrenToFillMax — Column parent", () => {
  test("converts centered fixed-width child to fillMax + padding (parent alignItems=center)", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp", height: "600dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const updated = globalVars.styles[child.layout!] as SimplifiedLayout;
    expect(updated.sizing?.horizontal).toBe("fill");
    expect(updated.dimensions?.width).toBeUndefined();
    // generateShorthand({top:0,right:30,bottom:0,left:30}) → "0dp 30dp"
    expect(updated.padding).toBe("0dp 30dp");
  });

  test("converts via child alignSelf=center (parent has no alignItems)", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      dimensions: { width: "400dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      alignSelf: "center",
      sizing: { horizontal: "fixed" },
      dimensions: { width: "200dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const updated = globalVars.styles[child.layout!] as SimplifiedLayout;
    expect(updated.sizing?.horizontal).toBe("fill");
    expect(updated.padding).toBe("0dp 100dp"); // (400-200)/2 = 100, horizontal only
  });

  test("skips non-centered child (no alignItems, no alignSelf)", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      dimensions: { width: "360dp" },
    });
    register(globalVars, parentLayout, "parent");

    const childLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({
      id: "1",
      type: "FRAME",
      layout: Object.keys(globalVars.styles).find((k) => k.startsWith("parent"))!,
      children: [child],
    });

    convertFixedChildrenToFillMax([parent], globalVars);

    const unchanged = globalVars.styles[child.layout!] as SimplifiedLayout;
    expect(unchanged.sizing?.horizontal).toBe("fixed");
    expect(unchanged.dimensions?.width).toBe("300dp");
  });

  test("skips auto-layout container child (mode=row)", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      mode: "row",
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", type: "FRAME", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const unchanged = globalVars.styles[child.layout!] as SimplifiedLayout;
    expect(unchanged.sizing?.horizontal).toBe("fixed");
    expect(unchanged.dimensions?.width).toBe("300dp");
    expect(unchanged.padding).toBeUndefined();
  });

  test("converts instance internal child (no longer skipped)", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "I327:1;311:2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const updated = globalVars.styles[child.layout!] as SimplifiedLayout;
    expect(updated.sizing?.horizontal).toBe("fill");
  });

  test("skips absolute-positioned child", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      position: "absolute",
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const unchanged = globalVars.styles[childKey] as SimplifiedLayout;
    expect(unchanged.sizing?.horizontal).toBe("fixed");
  });

  test("skips child width >= parent content width", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "360dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const unchanged = globalVars.styles[childKey] as SimplifiedLayout;
    expect(unchanged.sizing?.horizontal).toBe("fixed");
  });

  test("skips when parent has no dimensions.width", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const unchanged = globalVars.styles[childKey] as SimplifiedLayout;
    expect(unchanged.sizing?.horizontal).toBe("fixed");
  });

  test("skips when child sizing is not fixed", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { horizontal: "fill" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const unchanged = globalVars.styles[childKey] as SimplifiedLayout;
    expect(unchanged.sizing?.horizontal).toBe("fill");
    expect(unchanged.padding).toBeUndefined();
  });

  test("deducts parent padding from content width", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "400dp" },
      padding: "20dp", // all sides → content width = 400 - 20 - 20 = 360
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const updated = globalVars.styles[child.layout!] as SimplifiedLayout;
    expect(updated.sizing?.horizontal).toBe("fill");
    // (400-20-20 - 300) / 2 = (360 - 300) / 2 = 30
    expect(updated.padding).toBe("0dp 30dp");
  });

  test("merges new horizontal padding with existing child padding", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
      padding: "8dp 12dp", // 8 top/bottom, 12 left/right
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const updated = globalVars.styles[child.layout!] as SimplifiedLayout;
    expect(updated.sizing?.horizontal).toBe("fill");
    // existing: 8 top/bottom, 12 left/right
    // new inset: (360-300)/2 = 30
    // merged: 8 top/bottom, 12+30=42 left/right → "8dp 42dp"
    expect(updated.padding).toBe("8dp 42dp");
  });

  test("preserves height when only width is converted", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { horizontal: "fixed", vertical: "fixed" },
      dimensions: { width: "300dp", height: "44dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const updated = globalVars.styles[child.layout!] as SimplifiedLayout;
    expect(updated.dimensions?.width).toBeUndefined();
    expect(updated.dimensions?.height).toBe("44dp");
    expect(updated.sizing?.vertical).toBe("fixed");
  });

  test("removes dimensions entirely when that was the only axis", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const updated = globalVars.styles[child.layout!] as SimplifiedLayout;
    expect(updated.dimensions).toBeUndefined();
  });

  test("does not mutate shared layout (clone)", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout1 = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const pk1 = register(globalVars, parentLayout1);

    const parentLayout2 = makeLayout({
      mode: "column",
      // no alignItems → not centered
      dimensions: { width: "360dp" },
    });
    const pk2 = register(globalVars, parentLayout2);

    const sharedChildLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
    });
    const childKey = register(globalVars, sharedChildLayout);

    // Child in centered parent → should convert
    const child1 = makeNode({ id: "2", layout: childKey });
    const parent1 = makeNode({ id: "1", type: "FRAME", layout: pk1, children: [child1] });

    // Child in non-centered parent → should NOT convert
    const child2 = makeNode({ id: "3", layout: childKey });
    const parent2 = makeNode({ id: "4", type: "FRAME", layout: pk2, children: [child2] });

    convertFixedChildrenToFillMax([parent1, parent2], globalVars);

    // The original shared layout must still be unchanged
    expect(sharedChildLayout.sizing?.horizontal).toBe("fixed");
    expect(sharedChildLayout.dimensions?.width).toBe("300dp");

    // Child1 was cloned and modified → new key
    expect(child1.layout).not.toBe(childKey);
    const converted = globalVars.styles[child1.layout!] as SimplifiedLayout;
    expect(converted.sizing?.horizontal).toBe("fill");

    // Child2 still references original
    expect(child2.layout).toBe(childKey);
  });
});

// ============================================================================
// Vertical conversion (Row parent)
// ============================================================================
describe("convertFixedChildrenToFillMax — Row parent", () => {
  test("converts centered fixed-height child to fillMax + padding (parent alignItems=center)", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "row",
      alignItems: "center",
      dimensions: { width: "360dp", height: "100dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { vertical: "fixed" },
      dimensions: { height: "60dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const updated = globalVars.styles[child.layout!] as SimplifiedLayout;
    expect(updated.sizing?.vertical).toBe("fill");
    expect(updated.dimensions?.height).toBeUndefined();
    // (100-60)/2 = 20, vertical only → "20dp 0dp"
    expect(updated.padding).toBe("20dp 0dp");
  });

  test("skips horizontal conversion in Row parent (preserves fixed width)", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "row",
      alignItems: "center",
      dimensions: { width: "360dp", height: "80dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    const childLayout = makeLayout({
      sizing: { horizontal: "fixed", vertical: "fixed" },
      dimensions: { width: "100dp", height: "44dp" },
    });
    const childKey = register(globalVars, childLayout);

    const child = makeNode({ id: "2", layout: childKey });
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children: [child] });

    convertFixedChildrenToFillMax([parent], globalVars);

    const updated = globalVars.styles[child.layout!] as SimplifiedLayout;
    // Height should be converted (centered vertically)
    expect(updated.sizing?.vertical).toBe("fill");
    // Width should NOT be converted (Row parent only does vertical)
    expect(updated.sizing?.horizontal).toBe("fixed");
    expect(updated.dimensions?.width).toBe("100dp");
  });
});

// ============================================================================
// Recursive / tree-level
// ============================================================================
describe("convertFixedChildrenToFillMax — recursion", () => {
  test("processes nested auto-layout parents", () => {
    const globalVars: GlobalVars = { styles: {} };

    // Outer: Column
    const outerLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const outerKey = register(globalVars, outerLayout);

    // Inner: Row (auto-layout container → skipped for conversion)
    const innerLayout = makeLayout({
      mode: "row",
      alignItems: "center",
      dimensions: { width: "340dp", height: "100dp" },
    });
    const innerKey = register(globalVars, innerLayout);

    // Grandchild: leaf node inside Row
    const leafLayout = makeLayout({
      sizing: { vertical: "fixed" },
      dimensions: { height: "60dp" },
    });
    const leafKey = register(globalVars, leafLayout);

    const leaf = makeNode({ id: "3", type: "TEXT", layout: leafKey });
    const inner = makeNode({ id: "2", type: "FRAME", layout: innerKey, children: [leaf] });
    const outer = makeNode({ id: "1", type: "FRAME", layout: outerKey, children: [inner] });

    convertFixedChildrenToFillMax([outer], globalVars);

    // Inner container should NOT be converted (mode=row, auto-layout skip)
    expect((globalVars.styles[innerKey] as SimplifiedLayout).sizing?.horizontal).toBeUndefined();

    // Leaf should be vertically converted (centered in Row parent)
    const leafUpdated = globalVars.styles[leaf.layout!] as SimplifiedLayout;
    expect(leafUpdated.sizing?.vertical).toBe("fill");
    expect(leafUpdated.padding).toBe("20dp 0dp"); // (100-60)/2, vertical only
  });

  test("only converts qualifying children in a multi-child parent", () => {
    const globalVars: GlobalVars = { styles: {} };

    const parentLayout = makeLayout({
      mode: "column",
      alignItems: "center",
      dimensions: { width: "360dp" },
    });
    const parentKey = register(globalVars, parentLayout);

    // Centered, fixed width → should convert
    const centeredLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "300dp" },
    });
    const centeredKey = register(globalVars, centeredLayout);

    // Edge-aligned but inherits parent alignItems=center → gets converted too
    const edgeLayout = makeLayout({
      sizing: { horizontal: "fixed" },
      dimensions: { width: "200dp" },
    });
    const edgeKey = register(globalVars, edgeLayout);

    // Already fill → should NOT add extra padding
    const fillLayout = makeLayout({
      sizing: { horizontal: "fill" },
    });
    const fillKey = register(globalVars, fillLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "2", layout: centeredKey }),
      makeNode({ id: "3", layout: edgeKey }),
      makeNode({ id: "4", layout: fillKey }),
    ];
    const parent = makeNode({ id: "1", type: "FRAME", layout: parentKey, children });

    convertFixedChildrenToFillMax([parent], globalVars);

    // Centered child converted
    const c = globalVars.styles[children[0].layout!] as SimplifiedLayout;
    expect(c.sizing?.horizontal).toBe("fill");
    expect(c.padding).toBe("0dp 30dp");

    // Edge-aligned child inherits parent alignItems=center → also converted
    const e = globalVars.styles[children[1].layout!] as SimplifiedLayout;
    expect(e.sizing?.horizontal).toBe("fill");

    // Fill child unchanged
    const f = globalVars.styles[children[2].layout!] as SimplifiedLayout;
    expect(f.sizing?.horizontal).toBe("fill");
    expect(f.padding).toBeUndefined();
  });
});
