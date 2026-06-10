import { describe, expect, it } from "vitest";
import { detectAndProcessOverlays } from "~/transformers/overlay-detection.js";
import { generateRegionHints } from "~/transformers/region-hints.js";
import type { GlobalVars, SimplifiedNode } from "~/extractors/types.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";

let keySeq = 0;

function makeNode(
  globalVars: GlobalVars,
  opts: {
    id: string;
    name: string;
    type?: string;
    x: number;
    y: number;
    w: number;
    h: number;
    fill?: string;
    radius?: string;
    children?: SimplifiedNode[];
  },
): SimplifiedNode {
  const layoutKey = `layout_t${keySeq++}`;
  const layout: SimplifiedLayout = {
    mode: "none",
    locationRelativeToParent: { x: `${opts.x}dp`, y: `${opts.y}dp` },
    dimensions: { width: `${opts.w}dp`, height: `${opts.h}dp` },
  };
  globalVars.styles[layoutKey] = layout;

  const node: SimplifiedNode = {
    id: opts.id,
    name: opts.name,
    type: opts.type ?? "FRAME",
    layout: layoutKey,
  };
  if (opts.fill) {
    const fillKey = `fill_t${keySeq++}`;
    globalVars.styles[fillKey] = [opts.fill];
    node.fills = fillKey;
  }
  if (opts.radius) node.borderRadius = opts.radius;
  if (opts.children) node.children = opts.children;
  return node;
}

function makeRoot(globalVars: GlobalVars, name: string, children: SimplifiedNode[]): SimplifiedNode {
  const layoutKey = `layout_root${keySeq++}`;
  globalVars.styles[layoutKey] = {
    mode: "none",
    dimensions: { width: "375dp", height: "700dp" },
  } as SimplifiedLayout;
  return { id: "0:1", name, type: "FRAME", layout: layoutKey, children };
}

describe("toast detection", () => {
  it("detects a named dark pill toast and marks it without removing it", () => {
    const gv: GlobalVars = { styles: {} };
    const form = makeNode(gv, { id: "1:1", name: "表单", x: 16, y: 100, w: 343, h: 400 });
    const toast = makeNode(gv, {
      id: "1:2", name: "toast-发送成功", x: 87, y: 430, w: 200, h: 40,
      fill: "#3C3C43", radius: "20dp",
    });
    const root = makeRoot(gv, "短信验证码发送-中间态", [form, toast]);

    const overlays = detectAndProcessOverlays([root], gv);

    expect(overlays).toEqual([
      { nodeId: "1:2", name: "toast-发送成功", kind: "toast", confidence: "high" },
    ]);
    expect(root.children).toHaveLength(2); // kept in tree
    expect(toast.overlayRole).toBe("toast");
  });

  it("detects an unnamed toast only when ALL visual signals agree", () => {
    const gv: GlobalVars = { styles: {} };
    // dark + pill + centered + top z → unanimous visual match
    const toast = makeNode(gv, {
      id: "1:2", name: "Frame 427", x: 87, y: 430, w: 200, h: 40,
      fill: "#333333", radius: "20dp",
    });
    const form = makeNode(gv, { id: "1:1", name: "内容", x: 16, y: 100, w: 343, h: 300 });
    const root = makeRoot(gv, "页面", [form, toast]);

    const overlays = detectAndProcessOverlays([root], gv);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].confidence).toBe("medium");
  });

  it("does not flag a light card or an off-center dark element without a name", () => {
    const gv: GlobalVars = { styles: {} };
    const lightCard = makeNode(gv, {
      id: "1:1", name: "卡片", x: 87, y: 430, w: 200, h: 40, fill: "#FFFFFF", radius: "20dp",
    });
    const darkLeft = makeNode(gv, {
      id: "1:2", name: "标签", x: 10, y: 430, w: 200, h: 40, fill: "#333333", radius: "20dp",
    });
    const root = makeRoot(gv, "页面", [lightCard, darkLeft]);

    expect(detectAndProcessOverlays([root], gv)).toHaveLength(0);
  });
});

describe("dialog scrim split", () => {
  it("strips backdrop + scrim, keeps dialog content, infers centerDialog (带宿主弹窗)", () => {
    const gv: GlobalVars = { styles: {} };
    const backdropPage = makeNode(gv, { id: "2:1", name: "Datos básicos 页面副本", x: 0, y: 0, w: 375, h: 700 });
    const scrim = makeNode(gv, {
      id: "2:2", name: "Rectangle 9", x: 0, y: 0, w: 375, h: 700, fill: "rgba(0,0,0,0.4)",
    });
    const card = makeNode(gv, {
      id: "2:3", name: "选择器卡片", x: 28, y: 180, w: 319, h: 320, fill: "#FFFFFF", radius: "16dp",
    });
    const closeBtn = makeNode(gv, { id: "2:4", name: "关闭", x: 320, y: 150, w: 24, h: 24 });
    const root = makeRoot(gv, "选择所在省市", [backdropPage, scrim, card, closeBtn]);

    const overlays = detectAndProcessOverlays([root], gv);

    expect(overlays).toHaveLength(1);
    const d = overlays[0];
    expect(d.kind).toBe("dialog");
    expect(d.nodeId).toBe("2:3");
    expect(d.presentation).toBe("centerDialog");
    expect(d.scrim).toBe("rgba(0,0,0,0.4)");
    expect(d.strippedBackdrop).toEqual({ nodeIds: ["2:1"], names: ["Datos básicos 页面副本"] });

    // Tree mutated: backdrop + scrim gone, card + close button kept & marked.
    expect(root.children!.map((c) => c.id)).toEqual(["2:3", "2:4"]);
    expect(card.overlayRole).toBe("dialog");
    expect(closeBtn.overlayRole).toBe("dialog");
  });

  it("handles an opaque scrim with no backdrop via the frame name signal (通用弹窗)", () => {
    const gv: GlobalVars = { styles: {} };
    const scrim = makeNode(gv, {
      id: "3:1", name: "bg", x: 0, y: 0, w: 375, h: 700, fill: "#4A4F5A",
    });
    const sheet = makeNode(gv, {
      id: "3:2", name: "教育程度", x: 0, y: 340, w: 375, h: 360, fill: "#FFFFFF", radius: "16dp 16dp 0dp 0dp",
    });
    const root = makeRoot(gv, "信息选择-通用弹窗", [scrim, sheet]);

    const overlays = detectAndProcessOverlays([root], gv);

    expect(overlays).toHaveLength(1);
    expect(overlays[0].presentation).toBe("bottomSheet");
    expect(overlays[0].confidence).toBe("high");
    expect(overlays[0].strippedBackdrop).toBeUndefined(); // nothing below the scrim
    expect(root.children!.map((c) => c.id)).toEqual(["3:2"]);
  });

  it("does not treat an opaque dark background as a scrim without any name signal", () => {
    const gv: GlobalVars = { styles: {} };
    const bg = makeNode(gv, { id: "4:1", name: "背景", x: 0, y: 0, w: 375, h: 700, fill: "#1A1A2E" });
    const content = makeNode(gv, { id: "4:2", name: "内容", x: 16, y: 100, w: 343, h: 400 });
    const root = makeRoot(gv, "深色主题首页", [bg, content]);

    expect(detectAndProcessOverlays([root], gv)).toHaveLength(0);
    expect(root.children).toHaveLength(2); // untouched
  });
});

describe("inference exclusion", () => {
  it("marked toast no longer participates in region grouping", () => {
    const gv: GlobalVars = { styles: {} };
    const a = makeNode(gv, { id: "5:1", name: "块A", x: 16, y: 100, w: 343, h: 100 });
    const b = makeNode(gv, { id: "5:2", name: "块B", x: 16, y: 250, w: 343, h: 100 });
    const toast = makeNode(gv, {
      id: "5:3", name: "toast", x: 87, y: 200, w: 200, h: 40, fill: "#333333", radius: "20dp",
    });
    const root = makeRoot(gv, "页面", [a, b, toast]);

    detectAndProcessOverlays([root], gv);
    const hints = generateRegionHints([root], gv);

    // Without exclusion the toast overlaps both blocks and would force a
    // stack region; with exclusion A/B form a clean column.
    const allIds = hints.flatMap((h) => h.regions.flatMap((r) => r.childIds));
    expect(allIds).not.toContain("5:3");
  });
});
