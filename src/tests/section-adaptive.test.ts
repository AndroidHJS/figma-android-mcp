import { describe, it, expect } from "vitest";
import type { GetFileNodesResponse, Node as FigmaDocumentNode } from "@figma/rest-api-spec";
import { collectFrames, getFigmaSectionFromRaw } from "~/services/get-figma-section.js";

// ---------------------------------------------------------------------------
// Raw Figma node factories — minimal shapes that satisfy the simplify pipeline
// ---------------------------------------------------------------------------

let idCounter = 0;
const nextId = (): string => `1:${++idCounter}`;

function textNode(name: string, text: string, x: number, y: number): Record<string, unknown> {
  return {
    id: nextId(),
    name,
    type: "TEXT",
    visible: true,
    characters: text,
    absoluteBoundingBox: { x, y, width: 200, height: 20 },
    constraints: { horizontal: "LEFT", vertical: "TOP" },
    fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }],
    style: { fontFamily: "Inter", fontSize: 14, fontWeight: 400 },
  };
}

function frameNode(
  name: string,
  childCount: number,
  uniqueSeed: string,
): Record<string, unknown> {
  const children: Record<string, unknown>[] = [];
  for (let i = 0; i < childCount; i++) {
    // Unique names and texts per child defeat collapseRepeats — the manifest
    // test must stay oversized even after the compression stage runs.
    children.push(
      textNode(
        `text-${uniqueSeed}-${i}`,
        `内容 ${uniqueSeed}-${i} ${"x".repeat(40)}`,
        0,
        i * 24,
      ),
    );
  }
  return {
    id: nextId(),
    name,
    type: "FRAME",
    visible: true,
    clipsContent: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 375, height: Math.max(childCount * 24, 200) },
    constraints: { horizontal: "LEFT", vertical: "TOP" },
    children,
  };
}

function sectionResponse(sectionName: string, children: Record<string, unknown>[]): {
  response: GetFileNodesResponse;
  sectionId: string;
} {
  const sectionId = nextId();
  const section = {
    id: sectionId,
    name: sectionName,
    type: "SECTION",
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 5000, height: 5000 },
    children,
  };
  const response = {
    // Short file name: SimplifiedDesign.name is the FILE name for every
    // frame, and getFrameIdentity prefers the longer of file/frame names —
    // a long synthetic file name would mask the per-frame names.
    name: "F",
    nodes: {
      [sectionId]: {
        document: section,
        components: {},
        componentSets: {},
        schemaVersion: 0,
        styles: {},
      },
    },
  } as unknown as GetFileNodesResponse;
  return { response, sectionId };
}

// ---------------------------------------------------------------------------
// collectFrames
// ---------------------------------------------------------------------------

describe("collectFrames", () => {
  it("collects COMPONENT and COMPONENT_SET as page-like frames", () => {
    const section = {
      id: "s1",
      name: "S",
      type: "SECTION",
      children: [
        { id: "f1", name: "PageFrame", type: "FRAME", children: [] },
        { id: "c1", name: "PageComponent", type: "COMPONENT", children: [] },
        { id: "cs1", name: "PageVariants", type: "COMPONENT_SET", children: [] },
      ],
    } as unknown as FigmaDocumentNode;

    const { frames, skipped } = collectFrames(section);
    expect(frames.map((f) => (f.node as { id: string }).id)).toEqual(["f1", "c1", "cs1"]);
    expect(skipped).toEqual([]);
  });

  it("reports skipped non-frame top-level nodes instead of dropping silently", () => {
    const section = {
      id: "s1",
      name: "S",
      type: "SECTION",
      children: [
        { id: "f1", name: "Page", type: "FRAME", children: [] },
        { id: "g1", name: "随手画的组", type: "GROUP", children: [] },
        { id: "i1", name: "贴纸", type: "INSTANCE", children: [] },
      ],
    } as unknown as FigmaDocumentNode;

    const { frames, skipped } = collectFrames(section);
    expect(frames).toHaveLength(1);
    expect(skipped).toEqual([
      { name: "随手画的组", type: "GROUP" },
      { name: "贴纸", type: "INSTANCE" },
    ]);
  });

  it("records nested section paths for disambiguation", () => {
    const section = {
      id: "s1",
      name: "项目",
      type: "SECTION",
      children: [
        {
          id: "s2",
          name: "订单模块",
          type: "SECTION",
          children: [{ id: "f1", name: "默认", type: "FRAME", children: [] }],
        },
        {
          id: "s3",
          name: "登录模块",
          type: "SECTION",
          children: [{ id: "f2", name: "默认", type: "FRAME", children: [] }],
        },
      ],
    } as unknown as FigmaDocumentNode;

    const { frames } = collectFrames(section);
    expect(frames[0].sectionPath).toEqual(["订单模块"]);
    expect(frames[1].sectionPath).toEqual(["登录模块"]);
  });
});

// ---------------------------------------------------------------------------
// Adaptive output
// ---------------------------------------------------------------------------

describe("section adaptive output", () => {
  it("small section stays in full mode (no manifest)", async () => {
    const { response } = sectionResponse("小节", [
      frameNode("页面A-默认", 3, "a"),
      frameNode("页面A-加载中", 3, "b"),
    ]);

    const result = await getFigmaSectionFromRaw(
      response,
      { fileKey: "FK", sectionNodeId: "ignored" },
      "yaml",
      "views",
    );

    expect(result.formatted).not.toContain("manifestMode");
    expect(result.formatted).toContain("# ---- ");
    expect(result.formatted).toContain("nodes:");
  });

  it("oversized heterogeneous section switches to manifest mode", async () => {
    // 12 unrelated pages × 300 unique text nodes each — far past 300KB even
    // after compression (unique names/texts defeat repeat collapsing).
    const frames: Record<string, unknown>[] = [];
    for (let p = 0; p < 12; p++) {
      frames.push(frameNode(`页面${p}`, 300, `p${p}`));
    }
    const { response } = sectionResponse("全项目", frames);

    const result = await getFigmaSectionFromRaw(
      response,
      { fileKey: "FK", sectionNodeId: "ignored" },
      "yaml",
      "views",
    );
    const out = result.formatted;

    // Manifest: small, no frame data, carries grouping + re-fetch protocol.
    expect(out).toContain("manifestMode: true");
    expect(out).toContain("fileKey: FK");
    expect(out).toContain("get_figma_data");
    expect(out).not.toContain("# ---- ");
    expect(Buffer.byteLength(out, "utf8") / 1024).toBeLessThan(300);

    // Every page appears with a nodeId for re-fetching.
    for (let p = 0; p < 12; p++) {
      expect(out).toContain(`页面${p}`);
    }
    expect(out).toContain("nodeId:");
  });

  it("manifest marks likely non-page frames", async () => {
    const frames: Record<string, unknown>[] = [];
    for (let p = 0; p < 11; p++) {
      frames.push(frameNode(`页面${p}`, 300, `p${p}`));
    }
    frames.push(frameNode("色板规范", 300, "guide"));
    const { response } = sectionResponse("全项目", frames);

    const result = await getFigmaSectionFromRaw(
      response,
      { fileKey: "FK", sectionNodeId: "ignored" },
      "yaml",
      "views",
    );

    expect(result.formatted).toContain("manifestMode: true");
    expect(result.formatted).toContain("nonPageSuspect: true");
  });

  it("nested-section frames with identical names land in separate groups", async () => {
    const orderModule = {
      id: nextId(),
      name: "订单模块",
      type: "SECTION",
      visible: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 1000 },
      children: [frameNode("默认", 3, "order")],
    };
    const loginModule = {
      id: nextId(),
      name: "登录模块",
      type: "SECTION",
      visible: true,
      absoluteBoundingBox: { x: 2000, y: 0, width: 1000, height: 1000 },
      children: [frameNode("默认", 3, "login")],
    };
    const { response } = sectionResponse("项目", [orderModule, loginModule]);

    const result = await getFigmaSectionFromRaw(
      response,
      { fileKey: "FK", sectionNodeId: "ignored" },
      "yaml",
      "views",
    );

    // Path-prefixed page names keep the two "默认" frames apart.
    expect(result.formatted).toContain("订单模块/默认");
    expect(result.formatted).toContain("登录模块/默认");
  });

  it("skipped top-level nodes are reported in the header", async () => {
    const { response } = sectionResponse("小节", [
      frameNode("页面A", 3, "a"),
      frameNode("页面B", 3, "b"),
      { id: nextId(), name: "孤立组件", type: "COMPONENT_SET_THUMBNAIL", children: [] },
    ]);

    const result = await getFigmaSectionFromRaw(
      response,
      { fileKey: "FK", sectionNodeId: "ignored" },
      "yaml",
      "views",
    );

    expect(result.formatted).toContain("跳过 1 个非 Frame 顶层节点");
    expect(result.formatted).toContain("孤立组件");
  });
});
