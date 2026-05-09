import { describe, test, expect } from "vitest";
import { inferAutoLayoutFromPositions } from "~/transformers/layout.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";
import type { GlobalVars, SimplifiedNode } from "~/extractors/types.js";

function makeLayout(overrides: Partial<SimplifiedLayout> = {}): SimplifiedLayout {
  return {
    mode: "none",
    ...overrides,
  };
}

function makeNode(overrides: Partial<SimplifiedNode> = {}): SimplifiedNode {
  return {
    id: "1:1",
    name: "test",
    type: "FRAME",
    ...overrides,
  };
}

/** Register a layout in globalVars and return its key. */
function register(globalVars: GlobalVars, layout: SimplifiedLayout, prefix = "layout"): string {
  const key = `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  globalVars.styles[key] = layout;
  return key;
}

// ============================================================================
// Column inference
// ============================================================================
describe("inferAutoLayoutFromPositions — Column", () => {
  test("converts vertical stack with same x-offset to Column", () => {
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "16dp", y: "0dp" },
      dimensions: { width: "100dp", height: "40dp" },
    });
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "16dp", y: "48dp" },
      dimensions: { width: "100dp", height: "40dp" },
    });

    const child1Key = register(globalVars, child1Layout);
    const child2Key = register(globalVars, child2Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: child1Key }),
      makeNode({ id: "2", layout: child2Key }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    // Parent should now be a Column
    expect(parentLayout.mode).toBe("column");
    // Children should no longer have locationRelativeToParent
    expect(child1Layout.locationRelativeToParent).toBeUndefined();
    expect(child2Layout.locationRelativeToParent).toBeUndefined();
  });

  test("sets gap when spacing is consistent", () => {
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "100dp", height: "20dp" },
    });
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "28dp" },
      dimensions: { width: "100dp", height: "20dp" },
    });
    const child3Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "56dp" },
      dimensions: { width: "100dp", height: "20dp" },
    });

    const c1 = register(globalVars, child1Layout);
    const c2 = register(globalVars, child2Layout);
    const c3 = register(globalVars, child3Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: c1 }),
      makeNode({ id: "2", layout: c2 }),
      makeNode({ id: "3", layout: c3 }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    expect(parentLayout.mode).toBe("column");
    // Gaps: 28-20=8, 56-48=8 → consistent 8dp
    expect(parentLayout.gap).toBe("8dp");
  });

  test("does NOT set gap when spacing is inconsistent", () => {
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "100dp", height: "20dp" },
    });
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "40dp" }, // gap = 20
      dimensions: { width: "100dp", height: "20dp" },
    });
    const child3Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "68dp" }, // gap = 8
      dimensions: { width: "100dp", height: "20dp" },
    });

    const c1 = register(globalVars, child1Layout);
    const c2 = register(globalVars, child2Layout);
    const c3 = register(globalVars, child3Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: c1 }),
      makeNode({ id: "2", layout: c2 }),
      makeNode({ id: "3", layout: c3 }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    expect(parentLayout.mode).toBe("column");
    expect(parentLayout.gap).toBeUndefined();
  });

  test("does NOT infer Column when x-offsets differ too much", () => {
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "100dp", height: "40dp" },
    });
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "20dp", y: "48dp" }, // x differs by 20dp
      dimensions: { width: "100dp", height: "40dp" },
    });

    const c1 = register(globalVars, child1Layout);
    const c2 = register(globalVars, child2Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: c1 }),
      makeNode({ id: "2", layout: c2 }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    // Should NOT be converted
    expect(parentLayout.mode).toBe("none");
    expect(child1Layout.locationRelativeToParent).toBeDefined();
    expect(child2Layout.locationRelativeToParent).toBeDefined();
  });

  test("does NOT infer Column when children overlap", () => {
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "100dp", height: "40dp" },
    });
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "20dp" }, // overlaps with child1 (ends at 40)
      dimensions: { width: "100dp", height: "40dp" },
    });

    const c1 = register(globalVars, child1Layout);
    const c2 = register(globalVars, child2Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: c1 }),
      makeNode({ id: "2", layout: c2 }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    expect(parentLayout.mode).toBe("none");
  });

  test("fewer than 2 eligible children → no inference", () => {
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "100dp", height: "40dp" },
    });

    const c1 = register(globalVars, child1Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [makeNode({ id: "1", layout: c1 })];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    expect(parentLayout.mode).toBe("none");
  });
});

// ============================================================================
// Row inference
// ============================================================================
describe("inferAutoLayoutFromPositions — Row", () => {
  test("converts horizontal stack with same y-offset to Row", () => {
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "8dp" },
      dimensions: { width: "40dp", height: "40dp" },
    });
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "48dp", y: "8dp" },
      dimensions: { width: "40dp", height: "40dp" },
    });

    const c1 = register(globalVars, child1Layout);
    const c2 = register(globalVars, child2Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: c1 }),
      makeNode({ id: "2", layout: c2 }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    expect(parentLayout.mode).toBe("row");
    expect(child1Layout.locationRelativeToParent).toBeUndefined();
    expect(child2Layout.locationRelativeToParent).toBeUndefined();
  });

  test("sets gap for Row when spacing is consistent", () => {
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "24dp", height: "24dp" },
    });
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "32dp", y: "0dp" },
      dimensions: { width: "24dp", height: "24dp" },
    });
    const child3Layout = makeLayout({
      locationRelativeToParent: { x: "64dp", y: "0dp" },
      dimensions: { width: "24dp", height: "24dp" },
    });

    const c1 = register(globalVars, child1Layout);
    const c2 = register(globalVars, child2Layout);
    const c3 = register(globalVars, child3Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: c1 }),
      makeNode({ id: "2", layout: c2 }),
      makeNode({ id: "3", layout: c3 }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    expect(parentLayout.mode).toBe("row");
    // Gaps: 32-24=8, 64-56=8 → consistent 8dp
    expect(parentLayout.gap).toBe("8dp");
  });

  test("does NOT infer Row when y-offsets differ too much", () => {
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "40dp", height: "40dp" },
    });
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "48dp", y: "20dp" }, // y differs by 20dp
      dimensions: { width: "40dp", height: "40dp" },
    });

    const c1 = register(globalVars, child1Layout);
    const c2 = register(globalVars, child2Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: c1 }),
      makeNode({ id: "2", layout: c2 }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    expect(parentLayout.mode).toBe("none");
  });
});

// ============================================================================
// Edge cases
// ============================================================================
describe("inferAutoLayoutFromPositions — edge cases", () => {
  test("skips children with position: absolute", () => {
    const globalVars: GlobalVars = { styles: {} };

    const absChildLayout = makeLayout({
      position: "absolute",
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "50dp", height: "50dp" },
    });
    // Only one eligible child → not enough for inference
    const eligibleLayout = makeLayout({
      locationRelativeToParent: { x: "16dp", y: "0dp" },
      dimensions: { width: "100dp", height: "40dp" },
    });

    const absKey = register(globalVars, absChildLayout);
    const eligibleKey = register(globalVars, eligibleLayout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: absKey }),
      makeNode({ id: "2", layout: eligibleKey }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    // Only 1 eligible child → no inference
    expect(parentLayout.mode).toBe("none");
    // Absolute child keeps its offset
    expect(absChildLayout.locationRelativeToParent).toBeDefined();
  });

  test("skips already-auto-layout parents", () => {
    const globalVars: GlobalVars = { styles: {} };

    const childLayout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "100dp", height: "40dp" },
    });
    const c1 = register(globalVars, childLayout);

    // Parent is already a Row (auto-layout)
    const parentLayout = makeLayout({ mode: "row", gap: "8dp" });
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [makeNode({ id: "1", layout: c1 })];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    // Should remain Row, unchanged
    expect(parentLayout.mode).toBe("row");
  });

  test("removes constraints from inferred children", () => {
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "100dp", height: "40dp" },
      constraints: { horizontal: "MIN", vertical: "MIN" },
    });
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "48dp" },
      dimensions: { width: "100dp", height: "40dp" },
      constraints: { horizontal: "CENTER", vertical: "MIN" },
    });

    const c1 = register(globalVars, child1Layout);
    const c2 = register(globalVars, child2Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: c1 }),
      makeNode({ id: "2", layout: c2 }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    expect(parentLayout.mode).toBe("column");
    expect(child1Layout.constraints).toBeUndefined();
    expect(child2Layout.constraints).toBeUndefined();
  });

  test("recursively infers nested layouts", () => {
    const globalVars: GlobalVars = { styles: {} };

    // Grandchild level
    const gc1Layout = makeLayout({
      locationRelativeToParent: { x: "8dp", y: "0dp" },
      dimensions: { width: "50dp", height: "20dp" },
    });
    const gc2Layout = makeLayout({
      locationRelativeToParent: { x: "8dp", y: "28dp" },
      dimensions: { width: "50dp", height: "20dp" },
    });

    const gc1Key = register(globalVars, gc1Layout);
    const gc2Key = register(globalVars, gc2Layout);

    const childLayout = makeLayout();
    const childKey = register(globalVars, childLayout);

    const grandchildren: SimplifiedNode[] = [
      makeNode({ id: "gc1", layout: gc1Key }),
      makeNode({ id: "gc2", layout: gc2Key }),
    ];
    const child = makeNode({ id: "c1", layout: childKey, children: grandchildren });

    // Root level
    const rootLayout = makeLayout();
    const rootKey = register(globalVars, rootLayout);

    const root = makeNode({ id: "root", layout: rootKey, children: [child] });

    inferAutoLayoutFromPositions([root], globalVars);

    // Grandchild level should be inferred as Column
    expect(childLayout.mode).toBe("column");
    expect(gc1Layout.locationRelativeToParent).toBeUndefined();
    expect(gc2Layout.locationRelativeToParent).toBeUndefined();

    // Root shouldn't change (only 1 child)
    expect(rootLayout.mode).toBe("none");
  });

  test("Column preferred over Row when both possible", () => {
    // x-offsets same, y-offsets same → Column tried first and succeeds
    const globalVars: GlobalVars = { styles: {} };

    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "0dp" },
      dimensions: { width: "40dp", height: "20dp" },
    });
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "0dp", y: "28dp" },
      dimensions: { width: "40dp", height: "20dp" },
    });

    const c1 = register(globalVars, child1Layout);
    const c2 = register(globalVars, child2Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: c1 }),
      makeNode({ id: "2", layout: c2 }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    // Column detection is tried first and succeeds
    expect(parentLayout.mode).toBe("column");
  });
});

// ============================================================================
// Children without locationRelativeToParent
// ============================================================================
describe("inferAutoLayoutFromPositions — mixed children", () => {
  test("only considers children with locationRelativeToParent", () => {
    const globalVars: GlobalVars = { styles: {} };

    // Has offset
    const child1Layout = makeLayout({
      locationRelativeToParent: { x: "16dp", y: "0dp" },
      dimensions: { width: "100dp", height: "40dp" },
    });
    // Also has offset
    const child2Layout = makeLayout({
      locationRelativeToParent: { x: "16dp", y: "48dp" },
      dimensions: { width: "100dp", height: "40dp" },
    });
    // No offset (e.g., already in a flex flow, or text without layout)
    const child3Layout = makeLayout({
      dimensions: { width: "20dp", height: "20dp" },
    });

    const c1 = register(globalVars, child1Layout);
    const c2 = register(globalVars, child2Layout);
    const c3 = register(globalVars, child3Layout);

    const parentLayout = makeLayout();
    const parentKey = register(globalVars, parentLayout);

    const children: SimplifiedNode[] = [
      makeNode({ id: "1", layout: c1 }),
      makeNode({ id: "2", layout: c2 }),
      makeNode({ id: "3", layout: c3 }),
    ];
    const parent = makeNode({ id: "0", layout: parentKey, children });

    inferAutoLayoutFromPositions([parent], globalVars);

    // Two eligible children → Column inferred
    expect(parentLayout.mode).toBe("column");
    expect(child1Layout.locationRelativeToParent).toBeUndefined();
    expect(child2Layout.locationRelativeToParent).toBeUndefined();
    // Child 3 unchanged (never had offset)
    expect(child3Layout.locationRelativeToParent).toBeUndefined();
  });
});
