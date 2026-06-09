import type { GetFileNodesResponse, Node as FigmaDocumentNode } from "@figma/rest-api-spec";
import { FigmaService } from "~/services/figma.js";
import {
  simplifyRawFigmaObject,
  allExtractors,
  collapseRasterContainers,
} from "~/extractors/index.js";
import type { SimplifiedDesign, SimplifiedNode, ImageAsset } from "~/extractors/types.js";
import { writeLogs } from "~/utils/logger.js";
import { serializeResult } from "~/utils/serialize.js";
import { isSystemUi } from "~/utils/common.js";
import { type Platform, mapLayoutStyles } from "~/platform-mappers/index.js";
import type { Skill } from "~/skills/types.js";
import {
  inferAutoLayoutFromPositions,
  convertFixedChildrenToFillMax,
} from "~/transformers/layout.js";
import { generateRegionHints } from "~/transformers/region-hints.js";
import { generateLayoutHints } from "~/services/get-figma-data.js";

export type GetFigmaSectionInput = {
  fileKey: string;
  sectionNodeId: string;
  depth?: number;
};

export type GetFigmaSectionResult = {
  formatted: string;
};

// ---------------------------------------------------------------------------
// Frame grouping types & helpers
// ---------------------------------------------------------------------------

type DialogRole = "page" | "dialog";
type DialogConfidence = "high" | "medium";

type FrameGroup = {
  pageName: string;
  frames: SimplifiedDesign[];
  stateLabels: string[];
  sharedRootComponent?: string;
  confidence: "high" | "medium" | "low";
  /** Per-frame dialog role: "page" (full-page UI) or "dialog" (modal/bottom-sheet). */
  dialogRoles: DialogRole[];
  /** Per-frame confidence for the dialog role assignment. */
  dialogConfidences: DialogConfidence[];
};

type StructuralFingerprint = {
  frameIndex: number;
  identityName: string;
  rootChildName?: string;
  rootGrandchildName?: string;
  nodeCount: number;
  parsedPageName: string;
  parsedStateName?: string;
};

/**
 * Pick the most informative name for a frame's identity.
 *
 * When the frame itself has a generic name (e.g. shared among all SECTION
 * frames) but its root child carries the actual page+state distinction,
 * we prefer the root child name. Otherwise the frame name wins.
 */
function getFrameIdentity(frame: SimplifiedDesign): string {
  const rootChild = frame.nodes[0];
  if (!rootChild) return frame.name;

  const rootName = rootChild.name;
  const frameName = frame.name;

  const rootHasDelim = /[-—·_/]/.test(rootName);
  const frameHasDelim = /[-—·_/]/.test(frameName);

  // A name with a delimiter carries page+state information.
  if (rootHasDelim && !frameHasDelim) return rootName;
  // A longer name tends to be more specific.
  if (rootName.length > frameName.length) return rootName;
  return frameName;
}

/**
 * Split a frame identity name into {pageName, stateName} using common
 * designer delimiters. Tries each delimiter at the LAST occurrence so
 * that "订单详情-订单被拒" yields page="订单详情" state="订单被拒".
 *
 * When no delimiter produces two non-empty parts the entire string is
 * treated as the page name (single-state page).
 */
function parsePageIdentity(rawName: string): { pageName: string; stateName?: string } {
  // Ordered from "most intentional" (spaces around delimiter) to "least".
  const delimiters = [" - ", "-", " — ", "—", " · ", "·", " _ ", "_", " / ", "/"];
  for (const delim of delimiters) {
    const lastIdx = rawName.lastIndexOf(delim);
    if (lastIdx > 0) {
      const before = rawName.slice(0, lastIdx).trim();
      const after = rawName.slice(lastIdx + delim.length).trim();
      if (after.length > 0) {
        return { pageName: before, stateName: after };
      }
    }
  }
  return { pageName: rawName };
}

/** Count total nodes in a SimplifiedNode tree (including root). */
function countNodes(nodes: SimplifiedNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    if (node.children) {
      count += countNodes(node.children);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Dialog / modal detection helpers
// (placed here so they are available to both the grouping pipeline and the
//  per-group dialog-role detection below)
// ---------------------------------------------------------------------------

/**
 * Keywords that strongly suggest a frame is a dialog/modal/bottom-sheet
 * rather than a full page. Matched case-insensitively against the frame
 * identity name and state hint.
 */
const DIALOG_KEYWORDS = [
  "弹窗", "对话框", "提示框", "确认框", "底部弹窗", "弹出",
  "浮层", "半屏", "半弹窗", "弹框",
  "dialog", "modal", "popup", "alert", "bottomsheet", "bottom sheet",
  "bottom-sheet", "overlay", "snackbar", "toast",
];

function isDialogName(name: string): boolean {
  const lower = name.toLowerCase();
  return DIALOG_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Parse a dp string like "375dp" to a number.
 * Returns NaN for unrecognised formats.
 */
function parseDp(value: string): number {
  const num = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : NaN;
}

/**
 * Detect a dialog scrim overlay — the semi-transparent RECTANGLE that
 * designers place as the first child of the root FRAME to dim background
 * content behind a dialog / bottom-sheet.
 *
 * Pattern: nodes[0].children[0] is a RECTANGLE with opacity < 1.0.
 * This is a strong signal because full-page frames never have a scrim.
 */
function hasScrimOverlay(nodes: SimplifiedNode[]): boolean {
  const rootChild = nodes[0];
  if (!rootChild?.children || rootChild.children.length === 0) return false;
  const first = rootChild.children[0];
  return (
    first.type === "RECTANGLE" &&
    first.opacity !== undefined &&
    first.opacity < 1.0
  );
}

function computeFingerprint(frame: SimplifiedDesign, index: number): StructuralFingerprint {
  const rootChild = frame.nodes[0];
  const identityName = getFrameIdentity(frame);
  const { pageName, stateName } = parsePageIdentity(identityName);

  // For dialog frames with a scrim overlay, skip the scrim rectangle and use
  // the next child as the structural signal. Full-page frames always use the
  // first child directly (unchanged from original behaviour).
  let rootGrandchildName = rootChild?.children?.[0]?.name;
  if (
    hasScrimOverlay(frame.nodes) &&
    rootChild?.children &&
    rootChild.children.length >= 2
  ) {
    rootGrandchildName = rootChild.children[1]?.name;
  }

  return {
    frameIndex: index,
    identityName,
    rootChildName: rootChild?.name,
    rootGrandchildName,
    nodeCount: countNodes(frame.nodes),
    parsedPageName: pageName,
    parsedStateName: stateName,
  };
}

/**
 * Cluster frames into page groups using name-based grouping with structural
 * validation via the root skeleton component (nodes[0].children[0].name).
 *
 * Decision matrix:
 *   Name-same + root-same  → HIGH     (same page, different states)
 *   Name-same + root-diff  → LOW      (ambiguous — ask AI)
 *   Name-diff + root-same  → MEDIUM   (structural match despite naming — merged)
 *   Name-diff + root-diff  → separate groups (different pages)
 */
function groupFrames(frames: SimplifiedDesign[]): FrameGroup[] {
  const fingerprints = frames.map((f, i) => computeFingerprint(f, i));

  // Primary: group by parsedPageName.
  const nameGroups = new Map<string, StructuralFingerprint[]>();
  for (const fp of fingerprints) {
    const existing = nameGroups.get(fp.parsedPageName);
    if (existing) {
      existing.push(fp);
    } else {
      nameGroups.set(fp.parsedPageName, [fp]);
    }
  }

  const groups: FrameGroup[] = [];

  for (const [pageName, members] of nameGroups) {
    // Dialog frames inherently have different internal structure from page
    // frames (scrim + popup vs full layout). Their differing root component
    // name should not penalise the group's confidence — it's expected.
    const isDialogLike = members.map((m) => {
      const f = frames[m.frameIndex];
      const identityName = getFrameIdentity(f);
      const stateHint = f.nodes[0]?.name;
      return (
        isDialogName(identityName) ||
        (stateHint !== undefined && isDialogName(stateHint)) ||
        hasScrimOverlay(f.nodes)
      );
    });

    // Only count root-component diversity from non-dialog frames.
    const pageOnlyComponents = new Set(
      members
        .filter((_m, i) => !isDialogLike[i])
        .map((m) => m.rootGrandchildName)
        .filter(Boolean),
    );
    const effectiveComponents =
      pageOnlyComponents.size > 0
        ? pageOnlyComponents
        : new Set(
            members.map((m) => m.rootGrandchildName).filter(Boolean),
          );
    const confidence: FrameGroup["confidence"] =
      effectiveComponents.size <= 1 ? "high" : "low";

    // Prefer a non-dialog frame as the shared-component reference so
    // downstream merge logic compares the actual page component, not a
    // dialog-scrim rectangle.
    const referenceMember =
      members.find((_m, i) => !isDialogLike[i]) ?? members[0];

    groups.push({
      pageName,
      frames: members.map((m) => frames[m.frameIndex]),
      stateLabels: members.map((m) => m.parsedStateName ?? m.identityName),
      sharedRootComponent: referenceMember?.rootGrandchildName,
      confidence,
      dialogRoles: [],
      dialogConfidences: [],
    });
  }

  // Secondary: frames in different name groups that share the same root
  // skeleton component are likely the same page despite naming differences.
  // Merge them and downgrade to MEDIUM confidence.
  return mergeByNameMissStructureMatch(groups);
}

/**
 * Root skeleton component names that are too generic to serve as a reliable
 * structural signal.  "Container", "Group", etc. appear in nearly every
 * Figma frame — sharing one of these does NOT indicate two groups belong
 * to the same page.
 */
const GENERIC_ROOT_NAMES = new Set([
  "container",
  "group",
  "frame",
  "page",
  "root",
  "wrapper",
  "content",
  "main",
  "view",
  "screen",
  "body",
  "section",
  "block",
  "box",
]);

function isGenericComponentName(name: string): boolean {
  return GENERIC_ROOT_NAMES.has(name.toLowerCase());
}

/**
 * Detect name-group pairs that share the same root skeleton component and
 * merge them.  This catches cases where a designer used inconsistent naming
 * (e.g. "订单-默认" and "详情-默认") but the same base component
 * (e.g. "OrderDetailBase") reveals they belong together.
 *
 * Generic component names (Container, Group, etc.) are excluded — they
 * appear in too many unrelated frames to be a meaningful signal.
 */
function mergeByNameMissStructureMatch(
  groups: FrameGroup[],
): FrameGroup[] {
  if (groups.length <= 1) return groups;

  // Build a map from rootComponent → list of group indices.
  const compToGroups = new Map<string, number[]>();
  for (let i = 0; i < groups.length; i++) {
    const comp = groups[i].sharedRootComponent;
    if (!comp || isGenericComponentName(comp)) continue;
    const existing = compToGroups.get(comp);
    if (existing) {
      existing.push(i);
    } else {
      compToGroups.set(comp, [i]);
    }
  }

  // Collect indices of groups that need merging.
  const mergedIndices = new Set<number>();
  const merges: number[][] = [];

  for (const [, groupIndices] of compToGroups) {
    if (groupIndices.length > 1) {
      merges.push(groupIndices);
      for (const idx of groupIndices) {
        mergedIndices.add(idx);
      }
    }
  }

  if (merges.length === 0) return groups;

  // Build the result: merged groups + unmerged groups.
  const result: FrameGroup[] = [];

  for (const mergeSet of merges) {
    const first = groups[mergeSet[0]];
    const merged: FrameGroup = {
      pageName: mergeSet.map((i) => groups[i].pageName).join(" / "),
      frames: mergeSet.flatMap((i) => groups[i].frames),
      stateLabels: mergeSet.flatMap((i) => groups[i].stateLabels),
      sharedRootComponent: first.sharedRootComponent,
      confidence: "medium",
      dialogRoles: [],
      dialogConfidences: [],
    };
    result.push(merged);
  }

  for (let i = 0; i < groups.length; i++) {
    if (!mergedIndices.has(i)) {
      result.push(groups[i]);
    }
  }

  return result;
}

/**
 * Merge small dialog-only groups back into their parent page groups when the
 * dialog group's pageName is a compound name whose prefix matches the parent.
 *
 * This handles cases like "提单-取消双授信-挽留弹窗" (parsed as pageName
 * "提单-取消双授信") which is clearly a dialog belonging to the "提单" page.
 * The last-delimiter parsePageIdentity strategy splits at the final "-",
 * producing a multi-level page name that should be collapsed back.
 *
 * Only applies when the dialog group is majority-dialog and the parent group
 * is majority-page — prevents merging two unrelated dialog groups.
 */
function mergeDialogOrphans(groups: FrameGroup[]): FrameGroup[] {
  if (groups.length <= 1) return groups;

  const absorbed = new Set<number>();

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];

    // Only consider small dialog-majority groups.
    const dialogCount = g.dialogRoles.filter((r) => r === "dialog").length;
    if (dialogCount === 0 || dialogCount < g.frames.length * 0.5) continue;

    // Only when pageName contains a delimiter (compound names).
    if (!/[-—·_/]/.test(g.pageName)) continue;

    // Find best parent group by longest prefix match.
    let bestMatch: { index: number; len: number } | null = null;
    for (let j = 0; j < groups.length; j++) {
      if (i === j || absorbed.has(j)) continue;
      const other = groups[j];

      for (const delim of [
        "-",
        " — ",
        "—",
        " · ",
        "·",
        " _ ",
        "_",
        " / ",
        "/",
      ]) {
        if (g.pageName.startsWith(other.pageName + delim)) {
          if (!bestMatch || other.pageName.length > bestMatch.len) {
            bestMatch = { index: j, len: other.pageName.length };
          }
          break;
        }
      }
    }

    if (bestMatch !== null) {
      const parent = groups[bestMatch.index];
      parent.frames.push(...g.frames);
      parent.stateLabels.push(...g.stateLabels);
      parent.dialogRoles.push(...g.dialogRoles);
      parent.dialogConfidences.push(...g.dialogConfidences);
      // Only downgrade confidence when non-dialog frames are absorbed —
      // dialogs having different structure from page frames is expected.
      const allDialogs = g.dialogRoles.every((r) => r === "dialog");
      if (!allDialogs) parent.confidence = "medium";
      absorbed.add(i);
    }
  }

  return groups.filter((_g, i) => !absorbed.has(i));
}

// ---------------------------------------------------------------------------
// Dialog / modal detection — continued
// ---------------------------------------------------------------------------
// (DIALOG_KEYWORDS, isDialogName, parseDp, hasScrimOverlay moved before
//  computeFingerprint so they are available to the grouping pipeline.)
// ---------------------------------------------------------------------------

/**
 * Determine per-frame dialog roles for a group using three signals:
 *
 * 1. Name keywords (high confidence) — matches Chinese/English dialog terms
 *    in the frame identity or state hint.
 * 2. Scrim overlay (high confidence) — nodes[0].children[0] is a RECTANGLE
 *    with opacity < 1.0, the standard Figma pattern for dialog scrims.
 * 3. Size comparison (medium confidence) — when a frame is significantly
 *    narrower AND shorter than the group's maximum dimensions, it's likely
 *    a dialog. Only applied when the group contains ≥2 frames (need peers
 *    for comparison).
 */
function detectDialogRoles(
  frames: SimplifiedDesign[],
): { roles: DialogRole[]; confidences: DialogConfidence[] } {
  const roles: DialogRole[] = [];
  const confidences: DialogConfidence[] = [];
  const hasPeers = frames.length >= 2;

  // Compute group max dimensions for size-based detection.
  let maxW = 0;
  let maxH = 0;
  if (hasPeers) {
    for (const f of frames) {
      if (f.screen) {
        const w = parseDp(f.screen.width);
        const h = parseDp(f.screen.height);
        if (w > maxW) maxW = w;
        if (h > maxH) maxH = h;
      }
    }
  }

  for (const f of frames) {
    // Signal 1: name keywords (highest priority).
    const identityName = getFrameIdentity(f);
    const stateHint = f.nodes[0]?.name;
    if (isDialogName(identityName) || (stateHint && isDialogName(stateHint))) {
      roles.push("dialog");
      confidences.push("high");
      continue;
    }

    // Signal 2: scrim overlay (semi-transparent RECTANGLE backdrop).
    if (hasScrimOverlay(f.nodes)) {
      roles.push("dialog");
      confidences.push("high");
      continue;
    }

    // Signal 3: size comparison (only when peers exist and we have screen data).
    if (hasPeers && f.screen && maxW > 0 && maxH > 0) {
      const w = parseDp(f.screen.width);
      const h = parseDp(f.screen.height);
      if (!Number.isNaN(w) && !Number.isNaN(h)) {
        if (w < 0.9 * maxW && h < 0.85 * maxH) {
          roles.push("dialog");
          confidences.push("medium");
          continue;
        }
      }
    }

    roles.push("page");
    confidences.push("high");
  }

  return { roles, confidences };
}

// ---------------------------------------------------------------------------
// Header block
// ---------------------------------------------------------------------------

/**
 * Build the AI guidance header.
 *
 * Three rendering modes:
 * 1. Single group, HIGH confidence  — same-page states (current behaviour).
 * 2. Multiple groups                — per-group listing with confidence.
 * 3. Single group, LOW confidence   — uncertain, ask AI to verify.
 */
function buildHeaderBlock(
  sectionName: string,
  groups: FrameGroup[],
  imageAssets: ImageAsset[],
): string {
  const totalFrames = groups.reduce((sum, g) => sum + g.frames.length, 0);
  const isMultiPage = groups.length > 1;
  const hasUncertain = groups.some((g) => g.confidence !== "high");
  const hasDialog = groups.some((g) => g.dialogRoles.some((r) => r === "dialog"));

  const assetLines: string[] = [];
  if (imageAssets.length > 0) {
    const maxShow = Math.min(imageAssets.length, 10);
    for (let i = 0; i < maxShow; i++) {
      const a = imageAssets[i];
      assetLines.push(`#   - ${a.name} (${a.category})`);
    }
    if (imageAssets.length > maxShow) {
      assetLines.push(`#   ... (${imageAssets.length - maxShow} more)`);
    }
  }

  const lines: string[] = [
    "# ============================================================",
    `# Section: ${sectionName}`,
    `# 包含 ${totalFrames} 个 Frame`,
    "#",
  ];

  if (isMultiPage) {
    lines.push(
      `# 按命名规律分为 ${groups.length} 个页面/功能模块：`,
      "#",
    );

    let globalIdx = 0;
    for (const g of groups) {
      const parts: string[] = [];
      if (g.confidence === "medium") parts.push("中置信度，请验证");
      else if (g.confidence === "low") parts.push("低置信度，请验证");
      if (g.sharedRootComponent) parts.push(`共享 ${g.sharedRootComponent}`);
      const detail = parts.length > 0 ? ` — ${parts.join(" · ")}` : "";

      const countLabel =
        g.frames.length > 1
          ? `${g.frames.length} 个状态 Frame`
          : "1 个 Frame (单状态)";

      lines.push(`# [${g.pageName}] ${countLabel}${detail}:`);

      for (let j = 0; j < g.frames.length; j++) {
        globalIdx++;
        const f = g.frames[j];
        const rootChildName = f.nodes[0]?.name;
        const stateHint =
          rootChildName && rootChildName !== f.name
            ? `  → ${rootChildName}`
            : "";
        const dialogTag =
          g.dialogRoles[j] === "dialog"
            ? `  🎭 对话框${g.dialogConfidences[j] === "medium" ? " (尺寸偏小)" : ""}`
            : "";
        lines.push(`#   ${globalIdx}. ${f.name}${stateHint}${dialogTag}`);
      }
      lines.push("#");
    }
  } else {
    const g = groups[0];
    if (g.confidence === "high") {
      const evidence = g.sharedRootComponent
        ? `命名一致 + 共享根组件 ${g.sharedRootComponent}`
        : "命名一致";
      lines.push(`# ${evidence}`);
      lines.push("# 推断为同一页面的不同状态：");
    } else if (g.confidence === "medium") {
      // Merged from multiple name groups that share a root skeleton component.
      // The pageName was joined with " / " in mergeByNameMissStructureMatch.
      const evidence = g.sharedRootComponent
        ? `命名不同但共享根组件 ${g.sharedRootComponent}，结构合并推断为同一页面`
        : "命名不同但结构相似，推断为同一页面";
      lines.push(`# ${evidence}：`);
    } else {
      lines.push("# 命名同组但根组件不同，请验证是否为同一页面：");
    }
    lines.push("#");

    for (let i = 0; i < g.frames.length; i++) {
      const f = g.frames[i];
      const rootChildName = f.nodes[0]?.name;
      const stateHint =
        rootChildName && rootChildName !== f.name
          ? `  → ${rootChildName}`
          : "";
      const dialogTag =
        g.dialogRoles[i] === "dialog"
          ? `  🎭 对话框${g.dialogConfidences[i] === "medium" ? " (尺寸偏小)" : ""}`
          : "";
      lines.push(`#   ${i + 1}. ${f.name}${stateHint}${dialogTag}`);
    }
    lines.push("#");
  }

  lines.push(
    "# AI 生成指引：",
  );

  if (isMultiPage) {
    lines.push(
      "# - 每个 [页面名] 组内 → 1 个页面 + sealed class/enum 状态管理",
      "# - 不同 [页面名] 组之间 → 各自独立生成页面",
    );
    if (hasUncertain) {
      lines.push(
        "# - 标注\"低/中置信度\"的组 → 请交叉验证 Frame 实际结构后决定归属",
      );
    }
  } else if (groups[0].confidence === "medium") {
    // Single group from structural merge — naming actually differs.
    lines.push(
      "# - 命名不同但共享根组件，结构合并为一组",
      "# - 请交叉验证各 Frame 的实际功能后决定是否应拆分",
    );
  } else if (groups[0].confidence === "low") {
    lines.push(
      "# - 命名同组但根组件不一致，可能为不同页面",
      "# - 请交叉验证各 Frame 的实际结构后决定归属",
    );
  } else {
    lines.push(
      "# - 这些 Frame 是同一页面的不同 UI 状态，生成一个页面即可",
      "# - 共享的布局元素提取为基础骨架，各状态差异用条件渲染",
      "# - 状态变量用 sealed class / enum 定义",
    );
  }

  if (hasDialog) {
    lines.push(
      "# - 🎭 标注为对话框的 Frame → 用 DialogFragment / ModalBottomSheet 实现",
      "#   而非完整页面（Activity/Fragment），但仍属于所属页面组的状态管理",
    );
  }

  lines.push(
    "# - layoutHints / regionHints 以每组第一个 Frame 为准",
    "# - 文本内容、颜色差异等参照对应状态的 Frame 数据",
    "#",
    `# imageAssets (已去重，跨状态共享${imageAssets.length === 0 ? " — 无" : ""}):`,
    ...assetLines,
    "# ============================================================",
    "",
    "",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Figma API helpers (unchanged)
// ---------------------------------------------------------------------------

/**
 * Collect direct FRAME children of a SECTION node.
 * Only returns immediate children whose type is "FRAME" — nested sections
 * are NOT recursed into; the caller can query them separately.
 */
function collectFrames(sectionNode: FigmaDocumentNode): FigmaDocumentNode[] {
  if (!("children" in sectionNode) || !Array.isArray((sectionNode as Record<string, unknown>).children)) {
    return [];
  }

  const children = (sectionNode as Record<string, unknown>).children as FigmaDocumentNode[];
  return children.filter((child) => (child as Record<string, unknown>).type === "FRAME");
}

/**
 * Construct a synthetic GetFileNodesResponse so that a single FRAME child
 * can be passed through the existing simplifyRawFigmaObject pipeline without
 * any modification to the extraction logic. Components, componentSets, and
 * styles are carried over from the parent SECTION response so INSTANCE
 * resolution and named-style lookups work correctly.
 */
function makeFrameResponse(
  apiResponse: GetFileNodesResponse,
  frameNode: FigmaDocumentNode,
): GetFileNodesResponse {
  const sectionEntry = Object.entries(apiResponse.nodes)[0];
  const sectionNodeData = sectionEntry?.[1];

  return {
    name: apiResponse.name,
    nodes: {
      [frameNode.id]: {
        document: frameNode,
        components: (sectionNodeData?.components ?? {}) as Record<string, unknown>,
        componentSets: (sectionNodeData?.componentSets ?? {}) as Record<string, unknown>,
        schemaVersion: sectionNodeData?.schemaVersion ?? 0,
        styles: sectionNodeData?.styles ?? {},
      },
    },
  } as GetFileNodesResponse;
}

/**
 * Process a single FRAME through the full extraction and post-processing
 * pipeline, returning the SimplifiedDesign ready for serialization.
 */
async function processFrame(
  frame: FigmaDocumentNode,
  apiResponse: GetFileNodesResponse,
  depth: number | undefined,
  outputPlatform: Platform,
): Promise<SimplifiedDesign> {
  const nodeCounter = { count: 0 };
  const syntheticResponse = makeFrameResponse(apiResponse, frame);

  const simplified = await simplifyRawFigmaObject(syntheticResponse, allExtractors, {
    maxDepth: depth,
    afterChildren: collapseRasterContainers,
    nodeCounter,
    nodeFilter: (node) => !isSystemUi(node),
  });

  inferAutoLayoutFromPositions(simplified.nodes, simplified.globalVars);
  convertFixedChildrenToFillMax(simplified.nodes, simplified.globalVars);
  mapLayoutStyles(simplified.globalVars, outputPlatform);

  writeLogs("figma-section-frame-simplified.json", simplified);
  return simplified;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Fetch a Figma SECTION node, extract all child FRAMEs, cluster them into
 * page groups via naming + structural analysis, and produce a combined
 * output that helps the AI generate the correct number of pages.
 *
 * Only ONE Figma API call is made — the SECTION subtree is fetched once.
 */
export async function getFigmaSection(
  figmaService: FigmaService,
  input: GetFigmaSectionInput,
  outputFormat: "yaml" | "json",
  outputPlatform: Platform,
  skills?: Skill[],
): Promise<GetFigmaSectionResult> {
  const { fileKey, sectionNodeId, depth } = input;

  // 1. Fetch the SECTION node — single API call
  const rawResult = await figmaService.getRawNode(fileKey, sectionNodeId, depth);
  const apiResponse = rawResult.data as GetFileNodesResponse;
  writeLogs("figma-section-raw.json", apiResponse);

  // 2. Validate the root node is a SECTION
  const sectionEntry = Object.entries(apiResponse.nodes)[0];
  if (!sectionEntry || !sectionEntry[1]) {
    throw new Error(
      `Node ${sectionNodeId} was not found in the Figma file. Check the file key and node ID.`,
    );
  }

  const sectionNodeData = sectionEntry[1];
  const sectionNode = sectionNodeData.document;

  const sectionType = (sectionNode as Record<string, unknown>).type;
  if (sectionType !== "SECTION") {
    throw new Error(
      `Node "${(sectionNode as Record<string, unknown>).name ?? sectionNodeId}" is type "${sectionType}", not SECTION. Use get_figma_data for non-SECTION nodes.`,
    );
  }

  const sectionName = (sectionNode as Record<string, unknown>).name as string;

  // 3. Collect direct FRAME children
  const frames = collectFrames(sectionNode);
  if (frames.length === 0) {
    throw new Error(
      `SECTION "${sectionName}" contains no FRAME children. A SECTION must contain at least one FRAME.`,
    );
  }

  // 4. Process each FRAME through the extraction pipeline
  const simplifiedFrames: SimplifiedDesign[] = [];
  const allImageAssets = new Map<string, ImageAsset>();

  for (const frame of frames) {
    const simplified = await processFrame(frame, apiResponse, depth, outputPlatform);

    // Deduplicate image assets by nodeId across frames
    for (const asset of simplified.imageAssets) {
      if (!allImageAssets.has(asset.nodeId)) {
        allImageAssets.set(asset.nodeId, asset);
      }
    }

    simplifiedFrames.push(simplified);
  }

  // 5. Cluster frames into page groups
  const groups = groupFrames(simplifiedFrames);

  // 5a. Detect dialog/modal frames within each group
  for (const g of groups) {
    const { roles, confidences } = detectDialogRoles(g.frames);
    g.dialogRoles = roles;
    g.dialogConfidences = confidences;
  }

  // 5b. Merge small dialog-only groups back into their parent page groups
  //     when the dialog group's pageName is a compound name prefixed by the
  //     parent (e.g. "提单-取消双授信" → merge into "提单").
  const mergedGroups = mergeDialogOrphans(groups);

  // 6. Build output
  const dedupedAssets = Array.from(allImageAssets.values());

  // Global _REQUIRED_RULES (skills) — included once, not per frame
  const _REQUIRED_RULES = skills
    ?.filter((s) => s.category !== "workflow")
    .map((s) => ({
      uri: `skill://${s.name}`,
      summary: s.description,
    }));

  const isYaml = outputFormat === "yaml";
  const sep = isYaml ? "\n---\n" : "\n";

  // Header: grouped frame overview + AI guidance + deduplicated imageAssets
  let output = buildHeaderBlock(sectionName, mergedGroups, dedupedAssets);

  // Per-frame blocks — iterate through groups so we can label each block
  // with its group context.
  const blocks: string[] = [];
  let globalFrameNum = 0;

  for (const group of mergedGroups) {
    const isMultiPage = mergedGroups.length > 1;
    // A single group formed by structural merge still needs group context
    // in labels and metadata so the AI knows naming actually differs.
    const needsGroupContext = isMultiPage || group.confidence === "medium";

    for (let i = 0; i < group.frames.length; i++) {
      globalFrameNum++;
      const frame = group.frames[i];
      const { nodes, globalVars, screen } = frame;

      // The first root child often carries the actual state distinction when
      // all frames share the same SECTION-level name (e.g. "订单详情-审核中").
      const rootChildName = nodes[0]?.name;
      const stateHint =
        rootChildName && rootChildName !== frame.name
          ? rootChildName
          : undefined;

      const layoutHints = screen ? generateLayoutHints(screen, outputPlatform) : [];
      const regionHints = generateRegionHints(nodes, globalVars);

      const displayName = stateHint
        ? `${frame.name} → ${stateHint}`
        : frame.name;

      // Block label: include group context for multi-page sections.
      let blockHeader: string;
      if (needsGroupContext) {
        blockHeader = isYaml
          ? `# ---- [${group.pageName}] 状态 ${i + 1}/${group.frames.length}: ${displayName} ----`
          : "";
      } else {
        blockHeader = isYaml
          ? `# ---- 状态 ${globalFrameNum}/${simplifiedFrames.length}: ${displayName} ----`
          : "";
      }

      const result: Record<string, unknown> = {
        metadata: {
          name: frame.name,
          ...(stateHint ? { stateHint } : {}),
          ...(needsGroupContext
            ? { pageGroup: group.pageName, groupConfidence: group.confidence }
            : {}),
          dialogRole: group.dialogRoles[i],
          ...(group.dialogRoles[i] === "dialog"
            ? { dialogConfidence: group.dialogConfidences[i] }
            : {}),
        },
        nodes,
        globalVars,
        screen,
        layoutHints,
        regionHints,
      };

      let serialized = serializeResult(result, outputFormat);

      if (isYaml) {
        const frameAssets =
          frame.imageAssets.length > 0
            ? frame.imageAssets
                .map((a) => `#   - ${a.name} (${a.category})`)
                .join("\n")
            : "";
        const frameHeader = frameAssets
          ? `${blockHeader}\n# imageAssets for this state:\n${frameAssets}\n${serialized}`
          : `${blockHeader}\n${serialized}`;
        blocks.push(frameHeader);
      } else {
        blocks.push(serialized);
      }
    }
  }

  output += blocks.join(sep);

  // Append global _REQUIRED_RULES
  if (_REQUIRED_RULES && _REQUIRED_RULES.length > 0) {
    const rulesBlock = isYaml
      ? `\n\n# ============================================================\n# _REQUIRED_RULES (global constraints)\n# ============================================================\n${serializeResult({ _REQUIRED_RULES }, outputFormat)}`
      : `\n${serializeResult({ _REQUIRED_RULES }, outputFormat)}`;
    output += rulesBlock;
  }

  // Append global imageAssets list
  if (dedupedAssets.length > 0) {
    const assetsBlock = isYaml
      ? `\n\n# ============================================================\n# imageAssets (deduplicated, shared across all states)\n# ============================================================\n${serializeResult({ imageAssets: dedupedAssets }, outputFormat)}`
      : `\n${serializeResult({ imageAssets: dedupedAssets }, outputFormat)}`;
    output += assetsBlock;
  }

  return { formatted: output };
}
