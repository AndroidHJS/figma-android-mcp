import { describe, expect, it } from "vitest";
import {
  compactDesign,
  collapseRepeats,
  truncateLongTexts,
  truncateDecorativeDetails,
  deepClone,
} from "~/services/compact-design.js";

type JsonNode = Record<string, unknown>;

function card(id: string, title: string): JsonNode {
  return {
    id,
    name: `卡片 ${id}`,
    type: "FRAME",
    layout: "layout_CARD",
    fills: "fill_CARD",
    children: [
      { id: `${id}:t`, name: "标题", type: "TEXT", text: title, textStyle: "ts_TITLE" },
      { id: `${id}:img`, name: "图", type: "IMAGE-PNG", fills: "fill_IMG" },
    ],
  };
}

describe("stage 1 — lossless compaction", () => {
  it("drops defaults and empties but keeps meaningful values", () => {
    const nodes: JsonNode[] = [
      {
        id: "1:1",
        name: "n",
        type: "FRAME",
        opacity: 1,
        strokeWeight: "0dp",
        borderRadius: "0dp 0dp 0dp 0dp",
        strokeDashes: [],
        text: "",
        children: [
          { id: "1:2", name: "kept", type: "FRAME", opacity: 0.5, borderRadius: "8dp" },
        ],
      },
    ];
    const globalVars: JsonNode = { styles: {} };
    compactDesign(nodes, globalVars);

    expect(nodes[0]).toEqual({
      id: "1:1",
      name: "n",
      type: "FRAME",
      children: [{ id: "1:2", name: "kept", type: "FRAME", opacity: 0.5, borderRadius: "8dp" }],
    });
  });

  it("inlines single-use styles and keeps shared ones referenced", () => {
    const nodes: JsonNode[] = [
      { id: "1:1", name: "a", type: "TEXT", textStyle: "ts_ONCE" },
      { id: "1:2", name: "b", type: "FRAME", fills: "fill_SHARED" },
      { id: "1:3", name: "c", type: "FRAME", fills: "fill_SHARED" },
    ];
    const globalVars: JsonNode = {
      styles: {
        ts_ONCE: { fontSize: "14sp" },
        fill_SHARED: ["#FFFFFF"],
        fill_DEAD: ["#000000"],
      },
    };
    compactDesign(nodes, globalVars);

    expect(nodes[0].textStyle).toEqual({ fontSize: "14sp" });
    expect(nodes[1].fills).toBe("fill_SHARED");
    const styles = globalVars.styles as JsonNode;
    expect(styles.fill_SHARED).toEqual(["#FFFFFF"]);
    expect(styles.ts_ONCE).toBeUndefined();
    expect(styles.fill_DEAD).toBeUndefined();
  });
});

describe("stage 2 — repeat collapsing", () => {
  it("collapses identical consecutive siblings, keeping ids and text diffs", () => {
    const parent: JsonNode = {
      id: "0:1",
      name: "列表",
      type: "FRAME",
      children: [card("10:1", "消费贷"), card("10:2", "经营贷"), card("10:3", "房贷")],
    };
    const collapsed = collapseRepeats([parent]);

    expect(collapsed).toBe(2);
    const children = parent.children as JsonNode[];
    // Template keeps full subtree.
    expect(children[0].children).toBeDefined();
    // Followers shrink but keep identity + content.
    expect(children[1]).toEqual({
      id: "10:2",
      name: "卡片 10:2",
      type: "FRAME",
      _repeatOf: "10:1",
      texts: ["经营贷"],
    });
    expect(children[2]._repeatOf).toBe("10:1");
  });

  it("does not collapse structurally different siblings", () => {
    const a = card("10:1", "消费贷");
    const b = card("10:2", "经营贷");
    (b.children as JsonNode[]).push({ id: "10:2:x", name: "角标", type: "RECTANGLE" });
    const parent: JsonNode = { id: "0:1", name: "p", type: "FRAME", children: [a, b] };

    expect(collapseRepeats([parent])).toBe(0);
    expect((parent.children as JsonNode[])[1].children).toBeDefined();
  });
});

describe("stages 2b & 3", () => {
  it("truncates only texts above the limit", () => {
    const long = "字".repeat(250);
    const nodes: JsonNode[] = [
      { id: "1:1", name: "a", type: "TEXT", text: long },
      { id: "1:2", name: "b", type: "TEXT", text: "短" },
    ];
    expect(truncateLongTexts(nodes)).toBe(1);
    expect((nodes[0].text as string).endsWith("... [truncated]")).toBe(true);
    expect(nodes[1].text).toBe("短");
  });

  it("strips decorative leaves to id/name/type with a marker, keeps containers and text", () => {
    const nodes: JsonNode[] = [
      {
        id: "1:1",
        name: "frame",
        type: "FRAME",
        layout: "layout_X",
        children: [
          { id: "1:2", name: "deco", type: "RECTANGLE", fills: "fill_A", borderRadius: "4dp" },
          { id: "1:3", name: "label", type: "TEXT", text: "保留", textStyle: "ts_A" },
        ],
      },
    ];
    expect(truncateDecorativeDetails(nodes)).toBe(1);
    const children = nodes[0].children as JsonNode[];
    expect(children[0]).toEqual({ id: "1:2", name: "deco", type: "RECTANGLE", _truncated: true });
    expect(children[1].textStyle).toBe("ts_A");
    expect(nodes[0].layout).toBe("layout_X");
  });

  it("deepClone produces an independent copy", () => {
    const original = [card("10:1", "x")];
    const clone = deepClone(original);
    (clone[0] as JsonNode).name = "changed";
    expect(original[0].name).toBe("卡片 10:1");
  });
});
