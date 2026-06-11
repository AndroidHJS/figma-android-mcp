import { describe, expect, it } from "vitest";
import {
  classifyAxis,
  inferAnchors,
  isAttachment,
  computeAttachment,
  detectEdgeStraddle,
} from "~/transformers/anchor-inference.js";
import { generateRegionHints } from "~/transformers/region-hints.js";
import { mapToCompose } from "~/platform-mappers/compose.js";
import { mapToViews } from "~/platform-mappers/views.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";
import type { GlobalVars, SimplifiedNode } from "~/extractors/types.js";

function noneParent(width: number, height: number): SimplifiedLayout {
  return { mode: "none", dimensions: { width: `${width}dp`, height: `${height}dp` } };
}

function absChild(x: number, y: number, w: number, h: number): SimplifiedLayout {
  return {
    mode: "none",
    locationRelativeToParent: { x: `${x}dp`, y: `${y}dp` },
    dimensions: { width: `${w}dp`, height: `${h}dp` },
  };
}

function build(parentLayout: SimplifiedLayout, children: SimplifiedLayout[]) {
  const globalVars: GlobalVars = { styles: { layout_P: parentLayout } };
  const childNodes: SimplifiedNode[] = children.map((c, i) => {
    globalVars.styles[`layout_C${i}`] = c;
    return { id: `1:${i + 10}`, name: `child${i}`, type: "FRAME", layout: `layout_C${i}` };
  });
  const nodes: SimplifiedNode[] = [
    { id: "1:1", name: "parent", type: "FRAME", layout: "layout_P", children: childNodes },
  ];
  return { nodes, globalVars, childNodes };
}

function childLayout(globalVars: GlobalVars, node: SimplifiedNode): SimplifiedLayout {
  return globalVars.styles[node.layout!] as SimplifiedLayout;
}

describe("classifyAxis", () => {
  it("355-wide child in a 375 parent is stretch with 10dp insets, not a left anchor", () => {
    expect(classifyAxis(10, 355, 375)).toEqual({ edge: "stretch", near: 10, far: 10 });
  });

  it("element near the right edge anchors to the far edge", () => {
    // x=297, w=48 in a 375 parent → 30dp from the right
    expect(classifyAxis(297, 48, 375)).toEqual({ edge: "far", far: 30 });
  });

  it("center only wins on near-exact centering", () => {
    expect(classifyAxis(160, 56, 375).edge).toBe("center"); // delta 0.5dp
    expect(classifyAxis(150, 56, 375).edge).toBe("near"); // drifted 13.5dp → nearest edge
  });
});

describe("inferAnchors", () => {
  it("annotates a right-anchored child and the mapper emits align + margin, no offset", () => {
    const { nodes, globalVars, childNodes } = build(noneParent(375, 200), [
      absChild(297, 24, 48, 48),
    ]);
    inferAnchors(nodes, globalVars);

    const layout = childLayout(globalVars, childNodes[0]);
    expect(layout.anchor).toEqual({
      horizontal: "end",
      vertical: "top",
      insets: { end: "30dp", top: "24dp" },
    });

    const compose = mapToCompose(layout);
    expect(compose.anchorAlignment).toBe("TopEnd");
    expect(compose.anchorMargin).toEqual({ end: "30dp", top: "24dp" });
    expect(compose.offset).toBeUndefined();

    const views = mapToViews(layout);
    expect(views.layoutGravity).toBe("end");
    expect(views.layout_marginEnd).toBe("30dp");
    expect(views.layout_marginTop).toBe("24dp");
  });

  it("near-full-width child becomes horizontal stretch → fillMax/match_parent + side insets", () => {
    const { nodes, globalVars, childNodes } = build(noneParent(375, 600), [
      absChild(10, 100, 355, 80),
    ]);
    inferAnchors(nodes, globalVars);

    const layout = childLayout(globalVars, childNodes[0]);
    expect(layout.anchor?.horizontal).toBe("stretch");

    const compose = mapToCompose(layout);
    expect(compose.width).toBe("fillMax");
    expect(compose.anchorMargin?.start).toBe("10dp");
    expect(compose.anchorMargin?.end).toBe("10dp");

    const views = mapToViews(layout);
    expect(views.layout_width).toBe("match_parent");
    expect(views.layout_marginStart).toBe("10dp");
    expect(views.layout_marginEnd).toBe("10dp");
  });

  it("skips children with explicit Figma constraints — designer intent wins", () => {
    const constrained = absChild(297, 24, 48, 48);
    constrained.constraints = { horizontal: "MAX", vertical: "MIN" };
    const { nodes, globalVars, childNodes } = build(noneParent(375, 200), [constrained]);
    inferAnchors(nodes, globalVars);

    expect(childLayout(globalVars, childNodes[0]).anchor).toBeUndefined();
  });

  it("skips low-confidence anchors — element floating mid-space keeps raw coordinates", () => {
    // 1543dp-tall screen; child at y=900 → 580dp from the bottom, 900dp from
    // the top. The nearest edge is "bottom" but the inset exceeds parent×1/3,
    // so the anchor would mislead more than help — none is emitted.
    const { nodes, globalVars, childNodes } = build(noneParent(375, 1543), [
      absChild(32, 900, 311, 63),
    ]);
    inferAnchors(nodes, globalVars);

    const layout = childLayout(globalVars, childNodes[0]);
    expect(layout.anchor).toBeUndefined();
    expect(layout.locationRelativeToParent).toBeDefined();
  });

  it("clones shared layout styles instead of mutating them", () => {
    const shared = absChild(297, 24, 48, 48);
    const { nodes, globalVars, childNodes } = build(noneParent(375, 200), [shared]);
    inferAnchors(nodes, globalVars);

    // Original style untouched; child re-pointed to an annotated clone.
    expect((globalVars.styles.layout_C0 as SimplifiedLayout).anchor).toBeUndefined();
    expect(childNodes[0].layout).not.toBe("layout_C0");
  });
});

describe("attachment detection", () => {
  const avatar = { x: 16, y: 24, width: 56, height: 56 };
  const badge = { x: 56, y: 64, width: 20, height: 20 }; // riding avatar's bottom-right

  it("badge on avatar corner is an attachment despite small overlap of the host", () => {
    expect(isAttachment(avatar, badge)).toBe(true);
  });

  it("similar-size overlapping siblings are not attachments", () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 50, y: 50, width: 90, height: 90 };
    expect(isAttachment(a, b)).toBe(false);
  });

  it("computes host-relative anchor for the attached element", () => {
    const info = computeAttachment(avatar, badge);
    expect(info.anchor).toBe("bottomEnd");
    expect(info.insets).toEqual({ end: "-4dp", bottom: "-4dp" }); // overhangs the corner
  });

  it("region hints group host + attachment into a stack with attachment metadata", () => {
    const { nodes, globalVars } = build(noneParent(375, 200), [
      absChild(16, 24, 56, 56), // avatar
      absChild(56, 64, 20, 20), // badge
      absChild(200, 30, 120, 40), // unrelated sibling → second region
    ]);
    const hints = generateRegionHints(nodes, globalVars);

    expect(hints).toHaveLength(1);
    const stack = hints[0].regions.find((r) => r.mode === "stack");
    expect(stack).toBeDefined();
    expect(stack!.childIds).toEqual(["1:10", "1:11"]);
    expect(stack!.attachments).toHaveLength(1);
    expect(stack!.attachments![0]).toMatchObject({
      childId: "1:11",
      hostId: "1:10",
      anchor: "bottomEnd",
    });
  });
});

// ============================================================================
// detectEdgeStraddle — banner/illustration riding a host's edge
// ============================================================================
describe("detectEdgeStraddle", () => {
  // Dialog sheet 343x420 with a banner 320x90 poking 40dp above its top edge.
  const sheet = { x: 16, y: 200, width: 343, height: 420 };

  it("detects a banner straddling the host's top edge", () => {
    const banner = { x: 28, y: 160, width: 320, height: 90 };
    const result = detectEdgeStraddle(sheet, banner);
    expect(result).toEqual({ side: "top", overhang: "40dp" });
  });

  it("detects a bottom-edge straddle symmetrically", () => {
    const tag = { x: 100, y: 590, width: 160, height: 60 }; // 30 in, 30 out
    const result = detectEdgeStraddle(sheet, tag);
    expect(result).toEqual({ side: "bottom", overhang: "30dp" });
  });

  it("rejects similar-size siblings (negative-gap card list guard)", () => {
    const cardA = { x: 0, y: 0, width: 300, height: 120 };
    const cardB = { x: 0, y: 110, width: 300, height: 120 }; // overlaps 10dp
    expect(detectEdgeStraddle(cardA, cardB)).toBeUndefined();
    expect(detectEdgeStraddle(cardB, cardA)).toBeUndefined();
  });

  it("rejects sub-threshold pokes (alignment noise)", () => {
    const chip = { x: 100, y: 196, width: 100, height: 40 }; // only 4dp above
    expect(detectEdgeStraddle(sheet, chip)).toBeUndefined();
  });

  it("rejects fully contained children", () => {
    const inner = { x: 40, y: 260, width: 200, height: 80 };
    expect(detectEdgeStraddle(sheet, inner)).toBeUndefined();
  });

  it("rejects children mostly outside the host horizontally", () => {
    const off = { x: 300, y: 160, width: 200, height: 90 }; // pokes out the right side
    expect(detectEdgeStraddle(sheet, off)).toBeUndefined();
  });

  it("rejects a child poking out both top and bottom", () => {
    const tall = { x: 100, y: 180, width: 150, height: 470 };
    expect(detectEdgeStraddle(sheet, tall)).toBeUndefined();
  });
});
