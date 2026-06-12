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
import { inferAnchors } from "~/transformers/anchor-inference.js";
import { detectAndProcessOverlays } from "~/transformers/overlay-detection.js";
import { processInstanceOverrides } from "~/transformers/instance-overrides.js";
import { generateRegionHints } from "~/transformers/region-hints.js";
import { generateLayoutHints, OUTPUT_SIZE_LIMIT_KB } from "~/services/get-figma-data.js";
import {
  compactDesign,
  collapseRepeats,
  truncateLongTexts,
  deepClone,
} from "~/services/compact-design.js";

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

export type FrameGroup = {
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
 * Frames that are probably NOT pages: designer backups, old iterations,
 * style guides, component showcases. In whole-project sections these get
 * grouped and generated as bogus pages. Heuristic ANNOTATES only — never
 * drops: a false "non-page" label costs a confirmation question, a falsely
 * dropped page costs silent data loss.
 */
const NON_PAGE_NAME =
  /备份|旧版|废弃|存档|草稿|勿用|copy\b|backup|deprecated|draft|old\b|规范|色板|组件库|组件展示|图标库|styleguide|style\s*guide|design\s*system|palette|tokens?\b/i;

function isLikelyNonPage(name: string): boolean {
  return NON_PAGE_NAME.test(name);
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

function computeFingerprint(
  frame: SimplifiedDesign,
  index: number,
  pathPrefix?: string,
): StructuralFingerprint {
  const rootChild = frame.nodes[0];
  const identityName = getFrameIdentity(frame);
  const parsed = parsePageIdentity(identityName);
  // Nested-section path becomes part of the page identity so "订单模块/默认"
  // and "登录模块/默认" land in different groups despite identical frame names.
  const pageName = pathPrefix ? `${pathPrefix}/${parsed.pageName}` : parsed.pageName;
  const stateName = parsed.stateName;

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
function groupFrames(
  frames: SimplifiedDesign[],
  sectionPaths?: Map<SimplifiedDesign, string[]>,
): FrameGroup[] {
  const fingerprints = frames.map((f, i) =>
    computeFingerprint(f, i, sectionPaths?.get(f)?.join("/") || undefined),
  );

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
// File splitting plan
// ---------------------------------------------------------------------------

export type PlannedFile = {
  /** Suggested file name only — no directory. The server doesn't know the
   * project's package structure, and LLMs follow concrete paths literally,
   * so emitting a `ui/...` prefix would get copied into the wrong place. */
  fileName: string;
  kind: "screen" | "dialog";
  /** Owning page group. */
  pageName: string;
  /** State labels of the frames this file covers. */
  stateLabels: string[];
};

export type FileSplitPlan = {
  files: PlannedFile[];
  /** Frame → planned file name, keyed by frame object identity. */
  assignments: Map<SimplifiedDesign, string>;
};

/**
 * Strip path separators and whitespace so a pageName like "订单 / 详情"
 * (produced by mergeByNameMissStructureMatch joining with " / ") can't break
 * the suggested file name. Windows-reserved characters are removed for the
 * same reason.
 */
function sanitizeFileBaseName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, "");
}

/**
 * Derive the dialog's own name from a frame identity by stripping the owning
 * page's name prefix, then dropping a trailing state segment.
 *
 *   "订单详情-挽留弹窗"      (page "订单详情") → "挽留弹窗"
 *   "订单详情-挽留弹窗-默认" (page "订单详情") → "挽留弹窗"
 *
 * Group stateLabels can't be used here: a multi-state dialog arrives via
 * mergeDialogOrphans, whose labels were parsed in the orphan group's context
 * and only carry the state ("默认") — naming the file off them would produce
 * "默认Dialog.kt".
 */
function dialogBaseName(frame: SimplifiedDesign, groupPageName: string): string {
  let identity = getFrameIdentity(frame);
  if (identity.startsWith(groupPageName)) {
    identity = identity.slice(groupPageName.length).replace(/^[\s\-—·_/]+/, "");
  }
  if (identity.length === 0) return "";
  return parsePageIdentity(identity).pageName;
}

/**
 * Build the file splitting plan for a section's frame groups.
 *
 * Mapping: each group's page-role frames → one Screen file; dialog-role
 * frames → one Dialog file per distinct dialog name (a dialog's multiple
 * states share one file). No Components file is planned — how a page
 * organizes its internal skeleton is the same decision whether or not other
 * pages exist, and the skeleton-extraction guidance already covers it.
 *
 * Returns undefined for the no-split case (single group, no dialogs):
 * same-page states stay a single sealed-class file, and emitting a
 * one-entry plan would just add noise for the LLM to overweight.
 */
export function buildFileSplitPlan(groups: FrameGroup[]): FileSplitPlan | undefined {
  const hasDialog = groups.some((g) => g.dialogRoles.includes("dialog"));
  if (groups.length <= 1 && !hasDialog) return undefined;

  const files: PlannedFile[] = [];
  const assignments = new Map<SimplifiedDesign, string>();
  const usedNames = new Set<string>();

  // Two groups can sanitize to the same base ("订单/详情" vs "订单详情") —
  // suffix a counter rather than silently pointing two pages at one file.
  const uniqueFileName = (base: string, suffix: string): string => {
    let candidate = `${base}${suffix}`;
    let n = 2;
    while (usedNames.has(candidate)) {
      candidate = `${base}${n}${suffix}`;
      n++;
    }
    usedNames.add(candidate);
    return candidate;
  };

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const base = sanitizeFileBaseName(group.pageName) || `Page${gi + 1}`;

    const pageIndices = group.frames
      .map((_, i) => i)
      .filter((i) => group.dialogRoles[i] !== "dialog");

    if (pageIndices.length > 0) {
      const screenFile: PlannedFile = {
        fileName: uniqueFileName(base, "Screen.kt"),
        kind: "screen",
        pageName: group.pageName,
        stateLabels: pageIndices.map((i) => group.stateLabels[i]),
      };
      files.push(screenFile);
      for (const i of pageIndices) {
        assignments.set(group.frames[i], screenFile.fileName);
      }
    }

    // Dialog frames, aggregated by dialog name so a dialog's states share
    // one file. Scoped per group — same-named dialogs under different pages
    // are different dialogs.
    const dialogFilesByBase = new Map<string, PlannedFile>();
    for (let i = 0; i < group.frames.length; i++) {
      if (group.dialogRoles[i] !== "dialog") continue;
      const dialogBase =
        sanitizeFileBaseName(dialogBaseName(group.frames[i], group.pageName)) || base;
      let file = dialogFilesByBase.get(dialogBase);
      if (!file) {
        file = {
          fileName: uniqueFileName(dialogBase, "Dialog.kt"),
          kind: "dialog",
          pageName: group.pageName,
          stateLabels: [],
        };
        dialogFilesByBase.set(dialogBase, file);
        files.push(file);
      }
      file.stateLabels.push(group.stateLabels[i]);
      assignments.set(group.frames[i], file.fileName);
    }
  }

  return { files, assignments };
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
  filePlan: FileSplitPlan | undefined,
  skipped: CollectedFrames["skipped"] = [],
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

  // Skipped nodes are reported, never silently dropped — a COMPONENT-built
  // page landing here is the user's only chance to notice it's missing.
  if (skipped.length > 0) {
    lines.push(
      `# ⚠️ 跳过 ${skipped.length} 个非 Frame 顶层节点（不参与生成，如其中有页面请告知）：`,
    );
    const maxShow = Math.min(skipped.length, 8);
    for (let i = 0; i < maxShow; i++) {
      lines.push(`#   - ${skipped[i].name} (${skipped[i].type})`);
    }
    if (skipped.length > maxShow) lines.push(`#   ... (${skipped.length - maxShow} more)`);
    lines.push("#");
  }

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
        const nonPageTag = isLikelyNonPage(f.name) ? "  ⚠️ 疑似非页面帧（备份/规范/组件库），请确认" : "";
        lines.push(`#   ${globalIdx}. ${f.name}${stateHint}${dialogTag}${nonPageTag}`);
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
      const nonPageTag = isLikelyNonPage(f.name) ? "  ⚠️ 疑似非页面帧（备份/规范/组件库），请确认" : "";
      lines.push(`#   ${i + 1}. ${f.name}${stateHint}${dialogTag}${nonPageTag}`);
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
      hasDialog
        ? "# - page 帧是同一页面的不同 UI 状态，生成一个页面；对话框帧拆为独立文件"
        : "# - 这些 Frame 是同一页面的不同 UI 状态，生成一个页面即可",
      "# - 共享的布局元素提取为基础骨架，各状态差异用条件渲染",
      "# - 状态变量用 sealed class / enum 定义",
    );
  }

  if (hasDialog) {
    lines.push(
      "# - 🎭 标注为对话框的 Frame → 拆为独立文件，用 DialogFragment / ModalBottomSheet 实现",
      "#   弹窗 UI 本体不写进页面文件；所属页面持有显示/隐藏逻辑并触发弹出",
    );
  }

  if (filePlan) {
    lines.push(
      "#",
      "# 文件拆分计划 —— 必须按下列清单分别生成独立文件（目录与英文命名按项目惯例调整）：",
    );
    for (let i = 0; i < filePlan.files.length; i++) {
      const f = filePlan.files[i];
      const desc =
        f.kind === "screen"
          ? `页面${f.stateLabels.length > 1 ? `（${f.stateLabels.length} 个状态，sealed class 管理）` : ""}`
          : `对话框${f.stateLabels.length > 1 ? `（${f.stateLabels.length} 个状态）` : ""}`;
      lines.push(`#   ${i + 1}. ${f.fileName} — ${desc}`);
    }
    lines.push("#   每帧 metadata.suggestedFile 标明该帧数据归属哪个文件");
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

/** A page-like node collected from a SECTION, with its nested-section path. */
export type CollectedFrame = {
  node: FigmaDocumentNode;
  /**
   * Names of nested SECTIONs from the root section down to this frame
   * (empty for direct children). Disambiguates same-named frames across
   * modules ("订单模块/默认" vs "登录模块/默认") — without it the
   * name-based grouping merges them into one bogus page group.
   */
  sectionPath: string[];
};

export type CollectedFrames = {
  frames: CollectedFrame[];
  /**
   * Top-level nodes that are neither frame-like nor SECTION. Surfaced in
   * the output header — silently skipping is how COMPONENT-built pages
   * used to vanish from section output with no warning.
   */
  skipped: { name: string; type: string }[];
};

/**
 * COMPONENT / COMPONENT_SET carry full frame traits and designers do build
 * pages as components. INSTANCE is deliberately excluded: top-level
 * instances inside sections are usually decorations/stickers, and a missed
 * page-instance still shows up in the skipped warning for the user to see.
 */
const FRAME_LIKE_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET"]);

/**
 * Collect all page-like descendants of a SECTION node, recursing into nested
 * SECTIONs. Designers often group frames by page/feature inside child
 * SECTIONs (e.g. "登录注册" → "登录页" → frames); a flat scan would miss
 * every frame and fail with "no FRAME children".
 */
export function collectFrames(
  sectionNode: FigmaDocumentNode,
  sectionPath: string[] = [],
): CollectedFrames {
  if (!("children" in sectionNode) || !Array.isArray((sectionNode as Record<string, unknown>).children)) {
    return { frames: [], skipped: [] };
  }

  const frames: CollectedFrame[] = [];
  const skipped: CollectedFrames["skipped"] = [];
  const children = (sectionNode as Record<string, unknown>).children as FigmaDocumentNode[];

  for (const child of children) {
    const c = child as Record<string, unknown>;
    const type = String(c.type);
    if (FRAME_LIKE_TYPES.has(type)) {
      frames.push({ node: child, sectionPath });
    } else if (type === "SECTION") {
      const nested = collectFrames(child, [...sectionPath, String(c.name ?? "")]);
      frames.push(...nested.frames);
      skipped.push(...nested.skipped);
    } else {
      skipped.push({ name: String(c.name ?? ""), type });
    }
  }

  return { frames, skipped };
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
  fileKey?: string,
): Promise<SimplifiedDesign> {
  const nodeCounter = { count: 0 };
  const syntheticResponse = makeFrameResponse(apiResponse, frame);

  const simplified = await simplifyRawFigmaObject(syntheticResponse, allExtractors, {
    maxDepth: depth,
    afterChildren: collapseRasterContainers,
    nodeCounter,
    nodeFilter: (node) => !isSystemUi(node),
    fileKey,
  });

  processInstanceOverrides(simplified.nodes);

  const overlays = detectAndProcessOverlays(simplified.nodes, simplified.globalVars);
  if (overlays.length > 0) simplified.overlays = overlays;

  inferAutoLayoutFromPositions(simplified.nodes, simplified.globalVars);
  convertFixedChildrenToFillMax(simplified.nodes, simplified.globalVars);
  inferAnchors(simplified.nodes, simplified.globalVars);
  mapLayoutStyles(simplified.globalVars, outputPlatform);

  writeLogs("figma-section-frame-simplified.json", simplified);
  return simplified;
}

// ---------------------------------------------------------------------------
// Adaptive output — manifest mode
// ---------------------------------------------------------------------------

/** One serialized frame block plus the metadata manifest mode needs. */
type FrameRender = {
  block: string;
  sizeBytes: number;
  frame: SimplifiedDesign;
  suggestedFile?: string;
};

type ManifestParams = {
  sectionName: string;
  fileKey: string;
  groups: FrameGroup[];
  filePlan: FileSplitPlan | undefined;
  skipped: CollectedFrames["skipped"];
  /** Latest (compressed) renders — their sizes predict per-frame fetch cost. */
  renders: FrameRender[];
  requiredRules: { uri: string; summary: string }[] | undefined;
  outputFormat: "yaml" | "json";
  fullSizeKb: number;
};

/**
 * Manifest mode — the L2 degradation for sections whose data cannot fit one
 * tool result even compressed (a whole-project section of heterogeneous
 * pages). Ships NO frame design data; instead ships everything the section
 * pass uniquely computes — grouping, dialog roles, file split plan,
 * deduplicated assets — plus per-frame nodeIds and re-fetch instructions, so
 * the LLM generates page by page. An explicit partial answer beats a
 * silently truncated "complete" one, and one-context-20-pages generation
 * would be an attention disaster even if the data fit.
 */
function buildManifestOutput(p: ManifestParams): string {
  const isYaml = p.outputFormat === "yaml";
  const totalFrames = p.groups.reduce((sum, g) => sum + g.frames.length, 0);
  const sizeByFrame = new Map<SimplifiedDesign, number>();
  for (const r of p.renders) sizeByFrame.set(r.frame, r.sizeBytes);

  const lines: string[] = [];
  if (isYaml) {
    lines.push(
      "# ============================================================",
      `# Section: ${p.sectionName} — 清单模式（manifest）`,
      `# 完整数据约 ${p.fullSizeKb}KB，压缩后仍超过单次输出上限 ${OUTPUT_SIZE_LIMIT_KB}KB。`,
      "# 本响应不含 Frame 设计数据，仅含分组清单与续取指令。",
    );
    if (p.skipped.length > 0) {
      lines.push(
        `# ⚠️ 跳过 ${p.skipped.length} 个非 Frame 顶层节点（如其中有页面请告知）：` +
          p.skipped.slice(0, 5).map((s) => ` ${s.name}[${s.type}]`).join(","),
      );
    }
    lines.push("# ============================================================");
  }

  const payload: Record<string, unknown> = {
    manifestMode: true,
    section: p.sectionName,
    fileKey: p.fileKey,
    totalFrames,
    instructions: [
      "输出超限，已切换清单模式。按以下流程逐页生成，禁止凭记忆或项目已有代码补齐未拉取的页面：",
      `1. 按 groups 顺序，对每个 frame 调用 get_figma_data(fileKey="${p.fileKey}", nodeId=<frame.nodeId>) 获取该页完整数据`,
      "2. 每获取一页立即生成到该帧的 suggestedFile，完成后再取下一页；维护一份已完成清单，逐页勾选，中断后从未勾选项继续",
      "3. 文件归属以本清单 files 为准；imageAssets 以本清单为准（单页数据缺少 section 级去重信息），下载按 group 分批，避免一次请求过多触发限流",
      "4. 标 oversized: true 的帧，单页拉取仍可能触发有损压缩：优先用该页数据中的 regionHints 区域分组，配合 depth 参数分次拉取子树后再拼装",
      "5. 标 nonPageSuspect: true 的帧疑似备份/规范/组件库，生成前先与用户确认",
    ],
    ...(p.filePlan
      ? {
          files: p.filePlan.files.map((f) => ({
            fileName: f.fileName,
            kind: f.kind,
            pageName: f.pageName,
            stateLabels: f.stateLabels,
          })),
        }
      : {}),
    groups: p.groups.map((g) => {
      // Per-group asset union (deduped by nodeId) — the full list, unlike the
      // capped header preview: in manifest mode this IS the asset manifest.
      const groupAssets = new Map<string, ImageAsset>();
      for (const f of g.frames) {
        for (const a of f.imageAssets) {
          if (!groupAssets.has(a.nodeId)) groupAssets.set(a.nodeId, a);
        }
      }
      return {
        pageName: g.pageName,
        confidence: g.confidence,
        frames: g.frames.map((f, i) => {
          const sizeKb = Math.round(((sizeByFrame.get(f) ?? 0) / 1024) * 10) / 10;
          // nodes[0] IS the frame node; f.name is the FILE name (identical
          // for every frame) — useless as a manifest label.
          const frameName = f.nodes[0]?.name ?? f.name;
          return {
            nodeId: f.nodes[0]?.id,
            name: frameName,
            stateLabel: g.stateLabels[i],
            dialogRole: g.dialogRoles[i],
            ...(p.filePlan?.assignments.get(f)
              ? { suggestedFile: p.filePlan.assignments.get(f) }
              : {}),
            approxSizeKb: sizeKb,
            ...(sizeKb > OUTPUT_SIZE_LIMIT_KB ? { oversized: true } : {}),
            ...(isLikelyNonPage(frameName) ? { nonPageSuspect: true } : {}),
          };
        }),
        ...(groupAssets.size > 0
          ? {
              imageAssets: Array.from(groupAssets.values()).map((a) => ({
                nodeId: a.nodeId,
                name: a.name,
                category: a.category,
                suggestedFileName: a.suggestedFileName,
              })),
            }
          : {}),
      };
    }),
    ...(p.requiredRules && p.requiredRules.length > 0
      ? { _REQUIRED_RULES: p.requiredRules }
      : {}),
  };

  const serialized = serializeResult(payload, p.outputFormat);
  return isYaml ? `${lines.join("\n")}\n${serialized}` : serialized;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Process an already-fetched SECTION node response. Accepts pre-loaded raw
 * data so callers that already have the response (e.g. get_figma_node router)
 * can avoid a second API round-trip.
 */
export async function getFigmaSectionFromRaw(
  apiResponse: GetFileNodesResponse,
  input: GetFigmaSectionInput,
  outputFormat: "yaml" | "json",
  outputPlatform: Platform,
  skills?: Skill[],
): Promise<GetFigmaSectionResult> {
  const { sectionNodeId, depth } = input;
  writeLogs("figma-section-raw.json", apiResponse);

  // Validate the root node is a SECTION
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

  // 3. Collect page-like children (FRAME / COMPONENT / COMPONENT_SET)
  const collected = collectFrames(sectionNode);
  const frames = collected.frames;
  if (frames.length === 0) {
    const skippedHint =
      collected.skipped.length > 0
        ? ` (${collected.skipped.length} non-frame top-level nodes were skipped: ${collected.skipped
            .slice(0, 5)
            .map((s) => `${s.name}[${s.type}]`)
            .join(", ")})`
        : "";
    throw new Error(
      `SECTION "${sectionName}" contains no FRAME children. A SECTION must contain at least one FRAME.${skippedHint}`,
    );
  }

  // 4. Process each FRAME through the extraction pipeline
  const simplifiedFrames: SimplifiedDesign[] = [];
  const sectionPaths = new Map<SimplifiedDesign, string[]>();
  const allImageAssets = new Map<string, ImageAsset>();

  for (const cf of frames) {
    const simplified = await processFrame(cf.node, apiResponse, depth, outputPlatform, input.fileKey);

    // Deduplicate image assets by nodeId across frames
    for (const asset of simplified.imageAssets) {
      if (!allImageAssets.has(asset.nodeId)) {
        allImageAssets.set(asset.nodeId, asset);
      }
    }

    if (cf.sectionPath.length > 0) sectionPaths.set(simplified, cf.sectionPath);
    simplifiedFrames.push(simplified);
  }

  // 5. Cluster frames into page groups
  const groups = groupFrames(simplifiedFrames, sectionPaths);

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

  // 5c. File splitting plan — undefined for the no-split case (single page
  //     group, no dialogs), which keeps simple sections byte-identical to the
  //     pre-split output.
  const filePlan = buildFileSplitPlan(mergedGroups);

  // 6. Build output — adaptive: full → per-frame compression → manifest.
  // The section path used to concatenate frames with NO size check, bypassing
  // the serializeWithSizeLimit protection get_figma_data has. Past the MCP
  // client's tool-result limit the client truncates at an arbitrary byte:
  // trailing frames vanish silently. Degrade explicitly instead.
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
  const header = buildHeaderBlock(
    sectionName,
    mergedGroups,
    dedupedAssets,
    filePlan,
    collected.skipped,
  );

  const rulesBlock =
    _REQUIRED_RULES && _REQUIRED_RULES.length > 0
      ? isYaml
        ? `\n\n# ============================================================\n# _REQUIRED_RULES (global constraints)\n# ============================================================\n${serializeResult({ _REQUIRED_RULES }, outputFormat)}`
        : `\n${serializeResult({ _REQUIRED_RULES }, outputFormat)}`
      : "";

  const assetsBlock =
    dedupedAssets.length > 0
      ? isYaml
        ? `\n\n# ============================================================\n# imageAssets (deduplicated, shared across all states)\n# ============================================================\n${serializeResult({ imageAssets: dedupedAssets }, outputFormat)}`
        : `\n${serializeResult({ imageAssets: dedupedAssets }, outputFormat)}`
      : "";

  // Per-frame blocks — iterate through groups so we can label each block
  // with its group context. `compress` applies the lossless + structural
  // compression stages per frame (hints are computed from the original
  // nodes BEFORE compaction — node ids survive it, so references stay valid).
  const renderBlocks = (compress: boolean): FrameRender[] => {
    const renders: FrameRender[] = [];
    let globalFrameNum = 0;

    for (const group of mergedGroups) {
      const isMultiPage = mergedGroups.length > 1;
      // A single group formed by structural merge still needs group context
      // in labels and metadata so the AI knows naming actually differs.
      const needsGroupContext = isMultiPage || group.confidence === "medium";

      for (let i = 0; i < group.frames.length; i++) {
        globalFrameNum++;
        const frame = group.frames[i];
        const { screen } = frame;

        // The first root child often carries the actual state distinction when
        // all frames share the same SECTION-level name (e.g. "订单详情-审核中").
        const rootChildName = frame.nodes[0]?.name;
        const stateHint =
          rootChildName && rootChildName !== frame.name
            ? rootChildName
            : undefined;

        const layoutHints = screen ? generateLayoutHints(screen, outputPlatform) : [];
        const regionHints = generateRegionHints(frame.nodes, frame.globalVars);

        let nodes = frame.nodes;
        let globalVars = frame.globalVars;
        const compressionNotes: string[] = [];
        if (compress) {
          nodes = deepClone(frame.nodes) as typeof frame.nodes;
          globalVars = deepClone(frame.globalVars) as typeof frame.globalVars;
          compactDesign(
            nodes as unknown as Record<string, unknown>[],
            globalVars as unknown as Record<string, unknown>,
          );
          const truncated = truncateLongTexts(nodes as unknown as Record<string, unknown>[]);
          if (truncated > 0) {
            compressionNotes.push("Text values ending in '... [truncated]' were shortened for size.");
          }
          const collapsed = collapseRepeats(nodes as unknown as Record<string, unknown>[]);
          if (collapsed > 0) {
            compressionNotes.push(
              "_repeatOf: identical sibling structure collapsed — reuse the referenced template's layout; only name/texts differ.",
            );
          }
        }

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

        const suggestedFile = filePlan?.assignments.get(frame);

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
            ...(suggestedFile ? { suggestedFile } : {}),
          },
          nodes,
          globalVars,
          screen,
          layoutHints,
          regionHints,
          ...(compressionNotes.length > 0 ? { _compressionNotes: compressionNotes } : {}),
        };

        const serialized = serializeResult(result, outputFormat);

        let block: string;
        if (isYaml) {
          // Per-frame file attribution as a comment line, mirroring
          // metadata.suggestedFile. Attribution lines instead of FILE N/M
          // bracket markers: frames map many-to-one onto files and dialog
          // frames interleave with page frames inside a group, so bracket
          // pairs would either repeat or force reordering the output.
          if (suggestedFile) {
            blockHeader = `${blockHeader}\n# 归属文件: ${suggestedFile}`;
          }
          const frameAssets =
            frame.imageAssets.length > 0
              ? frame.imageAssets
                  .map((a) => `#   - ${a.name} (${a.category})`)
                  .join("\n")
              : "";
          block = frameAssets
            ? `${blockHeader}\n# imageAssets for this state:\n${frameAssets}\n${serialized}`
            : `${blockHeader}\n${serialized}`;
        } else {
          block = serialized;
        }

        renders.push({
          block,
          sizeBytes: Buffer.byteLength(block, "utf8"),
          frame,
          suggestedFile,
        });
      }
    }
    return renders;
  };

  const overLimit = (s: string): boolean =>
    Buffer.byteLength(s, "utf8") / 1024 > OUTPUT_SIZE_LIMIT_KB;

  let renders = renderBlocks(false);
  let assembled = header + renders.map((r) => r.block).join(sep) + rulesBlock + assetsBlock;
  const fullSizeKb = Math.round(Buffer.byteLength(assembled, "utf8") / 1024);

  if (overLimit(assembled)) {
    renders = renderBlocks(true);
    const note = isYaml
      ? `# 注：完整输出约 ${fullSizeKb}KB 超过 ${OUTPUT_SIZE_LIMIT_KB}KB 上限，已应用压缩（详见各帧 _compressionNotes）\n`
      : "";
    assembled = header + note + renders.map((r) => r.block).join(sep) + rulesBlock + assetsBlock;
  }

  if (overLimit(assembled)) {
    return {
      formatted: buildManifestOutput({
        sectionName,
        fileKey: input.fileKey,
        groups: mergedGroups,
        filePlan,
        skipped: collected.skipped,
        renders,
        requiredRules: _REQUIRED_RULES,
        outputFormat,
        fullSizeKb,
      }),
    };
  }

  return { formatted: assembled };
}

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
  const rawResult = await figmaService.getRawNode(fileKey, sectionNodeId, depth);
  return getFigmaSectionFromRaw(rawResult.data as GetFileNodesResponse, input, outputFormat, outputPlatform, skills);
}
