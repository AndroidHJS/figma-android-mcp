import { describe, expect, it } from "vitest";
import { processInstanceOverrides } from "~/transformers/instance-overrides.js";
import type { SimplifiedNode } from "~/extractors/types.js";

function dropdownInstance(id: string, placeholder: string): SimplifiedNode {
  return {
    id,
    name: "下拉框",
    type: "INSTANCE",
    componentId: "100:1",
    overrides: [{ nodeId: `I${id};5:2`, fields: ["characters"] }],
    children: [
      {
        id: `I${id};5:1`,
        name: "bg",
        type: "RECTANGLE",
        fills: "fill_BG",
        children: undefined,
      },
      { id: `I${id};5:2`, name: "占位文字", type: "TEXT", text: placeholder },
      { id: `I${id};5:3`, name: "箭头", type: "IMAGE-PNG" },
    ],
  };
}

describe("instance overrides", () => {
  it("annotates overridden descendants and resolves text values", () => {
    const inst = dropdownInstance("10:1", "Seleccione su estado civil");
    processInstanceOverrides([inst]);

    expect(inst.overrides).toEqual([
      { nodeId: "I10:1;5:2", fields: ["text"], text: "Seleccione su estado civil" },
    ]);
    expect(inst.children![1].overridden).toEqual(["text"]);
    expect(inst.children![0].overridden).toBeUndefined();
    // Definition not in tree → nothing pruned.
    expect(inst.prunedToOverrides).toBeUndefined();
    expect(inst.children).toHaveLength(3);
  });

  it("prunes non-overridden children when the component definition is in the tree", () => {
    const definition: SimplifiedNode = {
      id: "100:1",
      name: "Dropdown",
      type: "COMPONENT",
      children: [
        { id: "5:1", name: "bg", type: "RECTANGLE" },
        { id: "5:2", name: "占位文字", type: "TEXT", text: "Seleccione" },
        { id: "5:3", name: "箭头", type: "IMAGE-PNG" },
      ],
    };
    const inst = dropdownInstance("10:1", "¿Cuál es tu nivel de estudios?");
    const root: SimplifiedNode = {
      id: "0:1",
      name: "页面",
      type: "FRAME",
      children: [definition, inst],
    };

    processInstanceOverrides([root]);

    expect(inst.prunedToOverrides).toBe(true);
    expect(inst.children!.map((c) => c.id)).toEqual(["I10:1;5:2"]);
    // Definition untouched.
    expect(definition.children).toHaveLength(3);
  });

  it("keeps ancestor branches leading to deep overrides when pruning", () => {
    const definition: SimplifiedNode = { id: "100:1", name: "Card", type: "COMPONENT" };
    const inst: SimplifiedNode = {
      id: "10:2",
      name: "卡片",
      type: "INSTANCE",
      componentId: "100:1",
      overrides: [{ nodeId: "I10:2;7:9", fields: ["fills"] }],
      children: [
        {
          id: "I10:2;7:1",
          name: "wrapper",
          type: "FRAME",
          children: [
            { id: "I10:2;7:9", name: "高亮块", type: "RECTANGLE", fills: "fill_X" },
            { id: "I10:2;7:10", name: "无关", type: "TEXT", text: "默认" },
          ],
        },
        { id: "I10:2;7:2", name: "无关兄弟", type: "FRAME" },
      ],
    };
    processInstanceOverrides([definition, inst]);

    expect(inst.prunedToOverrides).toBe(true);
    expect(inst.children!.map((c) => c.id)).toEqual(["I10:2;7:1"]);
    expect(inst.children![0].children!.map((c) => c.id)).toEqual(["I10:2;7:9"]);
    expect(inst.children![0].children![0].overridden).toEqual(["fills"]);
  });

  it("instances without overrides are untouched", () => {
    const inst: SimplifiedNode = {
      id: "10:3",
      name: "图标",
      type: "INSTANCE",
      componentId: "100:9",
      children: [{ id: "I10:3;1:1", name: "v", type: "IMAGE-PNG" }],
    };
    processInstanceOverrides([inst]);
    expect(inst.children).toHaveLength(1);
    expect(inst.prunedToOverrides).toBeUndefined();
  });
});
