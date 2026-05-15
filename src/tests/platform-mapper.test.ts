import { describe, test, expect } from "vitest";
import { mapToCompose } from "~/platform-mappers/compose.js";
import { mapToViews } from "~/platform-mappers/views.js";
import { mapLayoutStyles } from "~/platform-mappers/index.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";

function makeLayout(overrides: Partial<SimplifiedLayout> = {}): SimplifiedLayout {
  return {
    mode: "row",
    ...overrides,
  };
}

// ============================================================================
// Compose mapper
// ============================================================================
describe("mapToCompose", () => {
  describe("layout direction", () => {
    test("row → layout: Row", () => {
      expect(mapToCompose(makeLayout({ mode: "row" }))).toHaveProperty("layout", "Row");
    });
    test("column → layout: Column", () => {
      expect(mapToCompose(makeLayout({ mode: "column" }))).toHaveProperty("layout", "Column");
    });
    test("none → no layout field", () => {
      expect(mapToCompose(makeLayout({ mode: "none" }))).not.toHaveProperty("layout");
    });
  });

  describe("arrangement (main axis)", () => {
    test.each([
      ["flex-start", undefined],
      ["flex-end", "End"],
      ["center", "Center"],
      ["space-between", "SpaceBetween"],
    ] as const)("%s → %s", (flex, compose) => {
      expect(mapToCompose(makeLayout({ justifyContent: flex })).arrangement).toBe(compose);
    });
  });

  describe("alignment (cross axis, context-dependent)", () => {
    test.each([
      // Row
      ["flex-start", "row", undefined],
      ["flex-end", "row", "Bottom"],
      ["center", "row", "CenterVertically"],
      ["stretch", "row", "Stretch"],
      ["baseline", "row", "Baseline"],
      // Column
      ["flex-start", "column", undefined],
      ["flex-end", "column", "End"],
      ["center", "column", "CenterHorizontally"],
      ["stretch", "column", "Stretch"],
      ["baseline", "column", "Baseline"],
    ] as const)("%s in %s → %s", (flex, mode, compose) => {
      expect(mapToCompose(makeLayout({ mode, alignItems: flex })).alignment).toBe(compose);
    });
  });

  describe("selfAlignment (context-dependent)", () => {
    test.each([
      ["flex-start", "row", "Top"],
      ["flex-end", "row", "Bottom"],
      ["center", "row", "Center"],
      ["stretch", "row", "Stretch"],
      ["flex-start", "column", "Start"],
      ["flex-end", "column", "End"],
      ["center", "column", "Center"],
    ] as const)("%s in %s → %s", (flex, mode, compose) => {
      expect(mapToCompose(makeLayout({ mode, alignSelf: flex })).selfAlignment).toBe(compose);
    });
  });

  describe("spacing", () => {
    test("gap → spacing", () => {
      expect(mapToCompose(makeLayout({ gap: "16dp" }))).toHaveProperty("spacing", "16dp");
    });
  });

  describe("padding", () => {
    test("1-value shorthand → all sides", () => {
      expect(mapToCompose(makeLayout({ padding: "16dp" })).padding).toEqual({
        top: "16dp", end: "16dp", bottom: "16dp", start: "16dp",
      });
    });
    test("2-value shorthand", () => {
      expect(mapToCompose(makeLayout({ padding: "12dp 8dp" })).padding).toEqual({
        top: "12dp", end: "8dp", bottom: "12dp", start: "8dp",
      });
    });
    test("4-value shorthand", () => {
      expect(mapToCompose(makeLayout({ padding: "16dp 12dp 8dp 4dp" })).padding).toEqual({
        top: "16dp", end: "12dp", bottom: "8dp", start: "4dp",
      });
    });
  });

  describe("width / height", () => {
    test("sizing fill → fillMax", () => {
      const result = mapToCompose(makeLayout({
        sizing: { horizontal: "fill", vertical: "fill" },
      }));
      expect(result.width).toBe("fillMax");
      expect(result.height).toBe("fillMax");
    });
    test("sizing hug → wrapContent", () => {
      const result = mapToCompose(makeLayout({
        sizing: { horizontal: "hug", vertical: "hug" },
      }));
      expect(result.width).toBe("wrapContent");
      expect(result.height).toBe("wrapContent");
    });
    test("sizing fixed + dimension → dp value", () => {
      const result = mapToCompose(makeLayout({
        sizing: { horizontal: "fixed", vertical: "fixed" },
        dimensions: { width: "360dp", height: "48dp" },
      }));
      expect(result.width).toBe("360dp");
      expect(result.height).toBe("48dp");
    });
    test("non-auto-layout: dimensions only → dp value", () => {
      const result = mapToCompose(makeLayout({
        mode: "none",
        dimensions: { width: "360dp", height: "200dp" },
      }));
      expect(result.width).toBe("360dp");
      expect(result.height).toBe("200dp");
    });
  });

  describe("scroll", () => {
    test("x → horizontal", () => {
      expect(mapToCompose(makeLayout({ overflowScroll: ["x"] })).scroll).toBe("horizontal");
    });
    test("y → vertical", () => {
      expect(mapToCompose(makeLayout({ overflowScroll: ["y"] })).scroll).toBe("vertical");
    });
    test("both", () => {
      expect(mapToCompose(makeLayout({ overflowScroll: ["x", "y"] })).scroll).toBe("both");
    });
  });

  describe("constraints", () => {
    test("MIN (default) → undefined", () => {
      const result = mapToCompose(makeLayout({
        mode: "none",
        constraints: { horizontal: "MIN", vertical: "MIN" },
      }));
      expect(result.horizontalConstraint).toBeUndefined();
      expect(result.verticalConstraint).toBeUndefined();
    });
    test("MAX → end / bottom", () => {
      const result = mapToCompose(makeLayout({
        mode: "none",
        constraints: { horizontal: "MAX", vertical: "MAX" },
      }));
      expect(result.horizontalConstraint).toBe("end");
      expect(result.verticalConstraint).toBe("bottom");
    });
    test("CENTER → center", () => {
      const result = mapToCompose(makeLayout({
        mode: "none",
        constraints: { horizontal: "CENTER", vertical: "CENTER" },
      }));
      expect(result.horizontalConstraint).toBe("center");
      expect(result.verticalConstraint).toBe("center");
    });
    test("STRETCH → stretch", () => {
      const result = mapToCompose(makeLayout({
        mode: "none",
        constraints: { horizontal: "STRETCH", vertical: "STRETCH" },
      }));
      expect(result.horizontalConstraint).toBe("stretch");
      expect(result.verticalConstraint).toBe("stretch");
    });
    test("SCALE → scale", () => {
      const result = mapToCompose(makeLayout({
        mode: "none",
        constraints: { horizontal: "SCALE", vertical: "SCALE" },
      }));
      expect(result.horizontalConstraint).toBe("scale");
      expect(result.verticalConstraint).toBe("scale");
    });
  });

  describe("other fields", () => {
    test("wrap", () => {
      expect(mapToCompose(makeLayout({ wrap: true }))).toHaveProperty("wrap", true);
    });
    test("position absolute", () => {
      expect(mapToCompose(makeLayout({ position: "absolute" }))).toHaveProperty("position", "absolute");
    });
    test("locationRelativeToParent → offset", () => {
      expect(mapToCompose(makeLayout({
        locationRelativeToParent: { x: "16dp", y: "8dp" },
      })).offset).toEqual({ x: "16dp", y: "8dp" });
    });
    test("aspectRatio", () => {
      expect(mapToCompose(makeLayout({
        dimensions: { aspectRatio: 1.5 },
      }))).toHaveProperty("aspectRatio", 1.5);
    });
  });
});

// ============================================================================
// Views mapper
// ============================================================================
describe("mapToViews", () => {
  describe("orientation", () => {
    test("row → horizontal", () => {
      expect(mapToViews(makeLayout({ mode: "row" }))).toHaveProperty("orientation", "horizontal");
    });
    test("column → vertical", () => {
      expect(mapToViews(makeLayout({ mode: "column" }))).toHaveProperty("orientation", "vertical");
    });
    test("none → no orientation", () => {
      expect(mapToViews(makeLayout({ mode: "none" }))).not.toHaveProperty("orientation");
    });
  });

  describe("gravity", () => {
    test("center + center → center_vertical|center (row)", () => {
      expect(mapToViews(makeLayout({
        mode: "row",
        justifyContent: "center",
        alignItems: "center",
      })).gravity).toBe("center_vertical|center");
    });
    test("flex-end + center → center_vertical|end (row)", () => {
      expect(mapToViews(makeLayout({
        mode: "row",
        justifyContent: "flex-end",
        alignItems: "center",
      })).gravity).toBe("center_vertical|end");
    });
    test("center column", () => {
      expect(mapToViews(makeLayout({
        mode: "column",
        justifyContent: "center",
        alignItems: "center",
      })).gravity).toBe("center_horizontal|center");
    });
    test("defaults omitted", () => {
      expect(mapToViews(makeLayout({
        mode: "row",
        justifyContent: "flex-start",
        alignItems: "flex-start",
      })).gravity).toBeUndefined();
    });
  });

  describe("layoutGravity (alignSelf)", () => {
    test("flex-start in row → top", () => {
      expect(mapToViews(makeLayout({
        mode: "row",
        alignSelf: "flex-start",
      })).layoutGravity).toBe("top");
    });
    test("flex-end in column → end", () => {
      expect(mapToViews(makeLayout({
        mode: "column",
        alignSelf: "flex-end",
      })).layoutGravity).toBe("end");
    });
  });

  describe("layout_width/layout_height", () => {
    test("fill → match_parent", () => {
      const result = mapToViews(makeLayout({
        sizing: { horizontal: "fill", vertical: "fill" },
      }));
      expect(result.layout_width).toBe("match_parent");
      expect(result.layout_height).toBe("match_parent");
    });
    test("hug → wrap_content", () => {
      const result = mapToViews(makeLayout({
        sizing: { horizontal: "hug", vertical: "hug" },
      }));
      expect(result.layout_width).toBe("wrap_content");
      expect(result.layout_height).toBe("wrap_content");
    });
    test("fixed + dimension → dp value", () => {
      const result = mapToViews(makeLayout({
        sizing: { horizontal: "fixed", vertical: "fixed" },
        dimensions: { width: "360dp", height: "48dp" },
      }));
      expect(result.layout_width).toBe("360dp");
      expect(result.layout_height).toBe("48dp");
    });
  });

  describe("padding", () => {
    test("shorthand → individual attributes", () => {
      const result = mapToViews(makeLayout({ padding: "16dp 12dp 8dp 4dp" }));
      expect(result.paddingTop).toBe("16dp");
      expect(result.paddingEnd).toBe("12dp");
      expect(result.paddingBottom).toBe("8dp");
      expect(result.paddingStart).toBe("4dp");
    });
  });

  describe("scroll", () => {
    test("both → both", () => {
      expect(mapToViews(makeLayout({ overflowScroll: ["x", "y"] })).scroll).toBe("both");
    });
  });

  describe("constraints", () => {
    test("MIN (default) → undefined", () => {
      const result = mapToViews(makeLayout({
        mode: "none",
        constraints: { horizontal: "MIN", vertical: "MIN" },
      }));
      expect(result.layout_constraintHorizontal).toBeUndefined();
      expect(result.layout_constraintVertical).toBeUndefined();
    });
    test("MAX → right / bottom", () => {
      const result = mapToViews(makeLayout({
        mode: "none",
        constraints: { horizontal: "MAX", vertical: "MAX" },
      }));
      expect(result.layout_constraintHorizontal).toBe("right");
      expect(result.layout_constraintVertical).toBe("bottom");
    });
    test("CENTER → center", () => {
      const result = mapToViews(makeLayout({
        mode: "none",
        constraints: { horizontal: "CENTER", vertical: "CENTER" },
      }));
      expect(result.layout_constraintHorizontal).toBe("center");
      expect(result.layout_constraintVertical).toBe("center");
    });
    test("STRETCH → stretch", () => {
      const result = mapToViews(makeLayout({
        mode: "none",
        constraints: { horizontal: "STRETCH", vertical: "STRETCH" },
      }));
      expect(result.layout_constraintHorizontal).toBe("stretch");
      expect(result.layout_constraintVertical).toBe("stretch");
    });
    test("SCALE → scale", () => {
      const result = mapToViews(makeLayout({
        mode: "none",
        constraints: { horizontal: "SCALE", vertical: "SCALE" },
      }));
      expect(result.layout_constraintHorizontal).toBe("scale");
      expect(result.layout_constraintVertical).toBe("scale");
    });
  });
});

// ============================================================================
// mapLayoutStyles (globalVars integration)
// ============================================================================
describe("mapLayoutStyles", () => {
  test("replaces SimplifiedLayout entries in globalVars.styles", () => {
    const globalVars = {
      styles: {
        layout_ABC: { mode: "row", justifyContent: "center", alignItems: "center", gap: "16dp" } as unknown,
        fill_XYZ: { type: "SOLID", color: "#FF0000" } as unknown,
        layout_DEF: { mode: "column", alignItems: "flex-end" } as unknown,
      },
    };

    mapLayoutStyles(globalVars, "compose");

    // Layout entries replaced with Compose-native
    expect(globalVars.styles.layout_ABC).toHaveProperty("layout", "Row");
    expect(globalVars.styles.layout_ABC).toHaveProperty("arrangement", "Center");
    expect(globalVars.styles.layout_ABC).toHaveProperty("alignment", "CenterVertically");
    expect(globalVars.styles.layout_ABC).toHaveProperty("spacing", "16dp");
    expect(globalVars.styles.layout_ABC).not.toHaveProperty("mode");
    expect(globalVars.styles.layout_ABC).not.toHaveProperty("justifyContent");

    expect(globalVars.styles.layout_DEF).toHaveProperty("layout", "Column");
    expect(globalVars.styles.layout_DEF).toHaveProperty("alignment", "End");

    // Non-layout entries left untouched
    expect(globalVars.styles.fill_XYZ).toEqual({ type: "SOLID", color: "#FF0000" });
  });

  test("views platform replaces with Views-native", () => {
    const globalVars = {
      styles: {
        layout_ABC: { mode: "row", justifyContent: "center", alignItems: "center" } as unknown,
      },
    };

    mapLayoutStyles(globalVars, "views");

    expect(globalVars.styles.layout_ABC).toHaveProperty("orientation", "horizontal");
    expect(globalVars.styles.layout_ABC).toHaveProperty("gravity", "center_vertical|center");
    expect(globalVars.styles.layout_ABC).not.toHaveProperty("mode");
  });

  test("does not touch non-layout objects", () => {
    const globalVars = {
      styles: {
        fill_ABC: { type: "SOLID" },
        style_DEF: { fontSize: "14sp" },
      },
    };

    mapLayoutStyles(globalVars, "compose");
    expect(globalVars.styles.fill_ABC).toEqual({ type: "SOLID" });
    expect(globalVars.styles.style_DEF).toEqual({ fontSize: "14sp" });
  });
});
