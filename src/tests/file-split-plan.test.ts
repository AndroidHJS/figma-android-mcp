import { describe, expect, it } from "vitest";
import { buildFileSplitPlan, type FrameGroup } from "~/services/get-figma-section.js";
import type { SimplifiedDesign } from "~/extractors/types.js";

/**
 * Minimal SimplifiedDesign factory — buildFileSplitPlan only reads `name`
 * and `nodes` (for frame identity), and uses object identity as the
 * assignment map key.
 */
function makeFrame(name: string): SimplifiedDesign {
  return {
    name,
    nodes: [],
    globalVars: { styles: {} },
    imageAssets: [],
  } as unknown as SimplifiedDesign;
}

function makeGroup(opts: {
  pageName: string;
  frames: SimplifiedDesign[];
  stateLabels: string[];
  dialogRoles: FrameGroup["dialogRoles"];
}): FrameGroup {
  return {
    pageName: opts.pageName,
    frames: opts.frames,
    stateLabels: opts.stateLabels,
    confidence: "high",
    dialogRoles: opts.dialogRoles,
    dialogConfidences: opts.dialogRoles.map(() => "high" as const),
  };
}

describe("buildFileSplitPlan", () => {
  it("returns undefined for a single page group with no dialogs (no-split case)", () => {
    const group = makeGroup({
      pageName: "订单详情",
      frames: [makeFrame("订单详情-默认"), makeFrame("订单详情-加载中")],
      stateLabels: ["默认", "加载中"],
      dialogRoles: ["page", "page"],
    });
    expect(buildFileSplitPlan([group])).toBeUndefined();
  });

  it("plans one Screen file per page group and assigns every state frame to it", () => {
    const orderFrames = [makeFrame("订单详情-默认"), makeFrame("订单详情-异常")];
    const listFrames = [makeFrame("订单列表-默认")];
    const plan = buildFileSplitPlan([
      makeGroup({
        pageName: "订单详情",
        frames: orderFrames,
        stateLabels: ["默认", "异常"],
        dialogRoles: ["page", "page"],
      }),
      makeGroup({
        pageName: "订单列表",
        frames: listFrames,
        stateLabels: ["默认"],
        dialogRoles: ["page"],
      }),
    ])!;

    expect(plan.files.map((f) => f.fileName)).toEqual([
      "订单详情Screen.kt",
      "订单列表Screen.kt",
    ]);
    expect(plan.files[0].kind).toBe("screen");
    expect(plan.files[0].stateLabels).toEqual(["默认", "异常"]);
    expect(plan.assignments.get(orderFrames[1])).toBe("订单详情Screen.kt");
    expect(plan.assignments.get(listFrames[0])).toBe("订单列表Screen.kt");
  });

  it("splits a dialog frame into its own Dialog file named after the dialog, not the page", () => {
    const pageFrame = makeFrame("订单详情-默认");
    const dialogFrame = makeFrame("订单详情-挽留弹窗");
    const plan = buildFileSplitPlan([
      makeGroup({
        pageName: "订单详情",
        frames: [pageFrame, dialogFrame],
        stateLabels: ["默认", "挽留弹窗"],
        dialogRoles: ["page", "dialog"],
      }),
    ])!;

    expect(plan.files.map((f) => f.fileName)).toEqual([
      "订单详情Screen.kt",
      "挽留弹窗Dialog.kt",
    ]);
    expect(plan.files[1].kind).toBe("dialog");
    expect(plan.assignments.get(pageFrame)).toBe("订单详情Screen.kt");
    expect(plan.assignments.get(dialogFrame)).toBe("挽留弹窗Dialog.kt");
  });

  it("aggregates a multi-state dialog into one file instead of one file per state", () => {
    // Shape produced by mergeDialogOrphans: the absorbed orphan group's
    // stateLabels only carry the state ("默认"/"错误") — the dialog's own
    // name must come from the frame identity, not the labels.
    const d1 = makeFrame("订单详情-挽留弹窗-默认");
    const d2 = makeFrame("订单详情-挽留弹窗-错误");
    const plan = buildFileSplitPlan([
      makeGroup({
        pageName: "订单详情",
        frames: [makeFrame("订单详情-默认"), d1, d2],
        stateLabels: ["默认", "默认", "错误"],
        dialogRoles: ["page", "dialog", "dialog"],
      }),
    ])!;

    const dialogFiles = plan.files.filter((f) => f.kind === "dialog");
    expect(dialogFiles).toHaveLength(1);
    expect(dialogFiles[0].fileName).toBe("挽留弹窗Dialog.kt");
    expect(dialogFiles[0].stateLabels).toEqual(["默认", "错误"]);
    expect(plan.assignments.get(d1)).toBe("挽留弹窗Dialog.kt");
    expect(plan.assignments.get(d2)).toBe("挽留弹窗Dialog.kt");
  });

  it("sanitizes path separators that merged pageNames contain", () => {
    // mergeByNameMissStructureMatch joins pageNames with " / " — a literal
    // slash must never survive into a suggested file name.
    const plan = buildFileSplitPlan([
      makeGroup({
        pageName: "订单 / 详情",
        frames: [makeFrame("订单-默认")],
        stateLabels: ["默认"],
        dialogRoles: ["page"],
      }),
      makeGroup({
        pageName: "首页",
        frames: [makeFrame("首页-默认")],
        stateLabels: ["默认"],
        dialogRoles: ["page"],
      }),
    ])!;

    expect(plan.files[0].fileName).toBe("订单详情Screen.kt");
  });

  it("suffixes a counter when two groups sanitize to the same file name", () => {
    const plan = buildFileSplitPlan([
      makeGroup({
        pageName: "订单/详情",
        frames: [makeFrame("a")],
        stateLabels: ["a"],
        dialogRoles: ["page"],
      }),
      makeGroup({
        pageName: "订单详情",
        frames: [makeFrame("b")],
        stateLabels: ["b"],
        dialogRoles: ["page"],
      }),
    ])!;

    expect(plan.files.map((f) => f.fileName)).toEqual([
      "订单详情Screen.kt",
      "订单详情2Screen.kt",
    ]);
  });
});
