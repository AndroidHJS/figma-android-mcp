import { describe, expect, it } from "vitest";
import { buildBuiltInSkills, filterByPlatform, loadSkills } from "~/skills/index.js";

function androidLayout(platform: "compose" | "views"): string {
  const skill = buildBuiltInSkills(platform).find((s) => s.name === "android-layout");
  if (!skill) throw new Error("android-layout skill missing");
  return skill.content;
}

describe("android-layout platform filtering", () => {
  // NOTE: assertion strings must be platform-EXCLUSIVE. `drawCircle`/`layout_weight`
  // appear in shared sections (纯色占位 / 宽度响应式表), so they can't probe filtering.
  it("compose output drops View-only rules and keeps Compose-only rules", () => {
    const content = androidLayout("compose");
    // Compose-only rules present
    expect(content).toContain("ContentScale");
    expect(content).toContain("Brush.horizontalGradient");
    expect(content).toContain("absoluteOffset");
    // View-only rules removed
    expect(content).not.toContain("android:elevation");
    expect(content).not.toContain("ConstraintLayout 过度使用");
    expect(content).not.toContain("RecyclerView 必须带");
    expect(content).not.toContain("tools:listitem");
  });

  it("views output drops Compose-only rules and keeps View-only rules", () => {
    const content = androidLayout("views");
    // View-only rules present
    expect(content).toContain("android:elevation");
    expect(content).toContain("ConstraintLayout 过度使用");
    expect(content).toContain("RecyclerView 必须带");
    expect(content).toContain("tools:listitem");
    // Compose-only rules removed
    expect(content).not.toContain("ContentScale");
    expect(content).not.toContain("Brush.horizontalGradient");
    expect(content).not.toContain("absoluteOffset");
  });

  // The dual-content sections (布局表/纯色占位/反模式 bullets/列表写法/文本还原/
  // overlay/overhang) are now split too, so a single-platform output should carry
  // essentially no syntax from the other platform.
  it("views output carries no Compose syntax from the previously-shared sections", () => {
    const content = androidLayout("views");
    for (const tok of [
      "Modifier.",
      "LazyColumn",
      "SnackbarHost",
      "ModalBottomSheet",
      "LaunchedEffect",
      "TextOverflow",
      "@Composable",
    ]) {
      expect(content).not.toContain(tok);
    }
  });

  it("compose output carries no View syntax from the previously-shared sections", () => {
    const content = androidLayout("compose");
    for (const tok of [
      "android:layout_",
      "LinearLayout",
      "BottomSheetDialog",
      "RecyclerView",
      "match_parent",
    ]) {
      expect(content).not.toContain(tok);
    }
  });

  it("shared rules survive on both platforms", () => {
    for (const platform of ["compose", "views"] as const) {
      const content = androidLayout(platform);
      expect(content).toContain("宽度响应式规则");
      expect(content).toContain("列表识别规则");
      expect(content).toContain("strings.xml"); // 首尾空格 — 通用
    }
  });

  it("leaves no stray platform markers in output", () => {
    for (const platform of ["compose", "views"] as const) {
      expect(androidLayout(platform)).not.toMatch(/<!--\/?(?:compose|views)-->/);
    }
  });

  it("filterByPlatform keeps unmarked text and strips the other platform's block", () => {
    const raw = "shared\n\n<!--compose-->C-only<!--/compose-->\n\n<!--views-->V-only<!--/views-->";
    expect(filterByPlatform(raw, "compose")).toBe("shared\n\nC-only");
    expect(filterByPlatform(raw, "views")).toBe("shared\n\nV-only");
  });

  it("loadSkills threads platform into built-in skills", () => {
    const compose = loadSkills(undefined, "compose").find((s) => s.name === "android-layout");
    const views = loadSkills(undefined, "views").find((s) => s.name === "android-layout");
    expect(compose?.content).toContain("ContentScale");
    expect(views?.content).toContain("android:elevation");
  });
});
