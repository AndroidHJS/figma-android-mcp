import { describe, expect, it } from "vitest";
import {
  classifyAxis,
  inferAnchors,
  isAttachment,
  computeAttachment,
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
