import type { GlobalVars, SimplifiedNode } from "~/extractors/types.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";
import {
  ALIGN_TOLERANCE,
  GAP_TOLERANCE,
  parseDp,
  computeConsistentGap,
} from "~/transformers/layout.js";
import type { ChildLayoutData } from "~/transformers/layout.js";

export interface RegionGroup {
  /** Omitted for singleton (single-child area, no container suggestion needed). */
  mode?: "column" | "row";
  childIds: string[];
  childNames: string[];
  /** Uniform gap for multi-child area, undefined when inconsistent. */
  gap?: string;
}

export interface RegionHint {
  parentId: string;
  parentName: string;
  regions: RegionGroup[];
}

interface ChildDatum {
  node: SimplifiedNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Walk the simplified node tree and generate per-parent region grouping hints.
 *
 * Parents whose layout mode is already "column" or "row" are skipped — they
 * already express a clear layout direction. Only `mode: "none"` parents with
 * at least 2 eligible children are analyzed.
 *
 * Regions are identified by alignment-based grouping: children aligned on the
 * x-axis form candidate Column groups, and unassigned children aligned on the
 * y-axis form candidate Row groups. Any remaining children become singletons.
 * A RegionHint is only emitted when at least 2 regions are detected.
 */
export function generateRegionHints(
  nodes: SimplifiedNode[],
  globalVars: GlobalVars,
): RegionHint[] {
  const hints: RegionHint[] = [];
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      const hint = processParent(node, globalVars);
      if (hint) hints.push(hint);
      hints.push(...generateRegionHints(node.children, globalVars));
    }
  }
  return hints;
}

function processParent(parent: SimplifiedNode, globalVars: GlobalVars): RegionHint | null {
  if (!parent.layout) return null;

  const parentLayout = globalVars.styles[parent.layout] as SimplifiedLayout | undefined;
  if (!parentLayout || parentLayout.mode !== "none") return null;

  const eligible = collectEligible(parent.children!, globalVars);
  if (eligible.length < 2) return null;

  const assigned = new Set<number>();
  const regions: RegionGroup[] = [];

  // Step C: anchor grouping by x → Column candidates
  const xGroups = groupByAlignment(eligible, "x");
  for (const group of xGroups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.y - b.y);
    if (hasOverlap(sorted, "column")) continue;
    for (const d of group) assigned.add(eligible.indexOf(d));
    regions.push(buildFlowRegion(sorted, "column"));
  }

  // Step D: anchor grouping by y → Row candidates (unassigned only)
  const unassigned = eligible.filter((_, i) => !assigned.has(i));
  const yGroups = groupByAlignment(unassigned, "y");
  for (const group of yGroups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.x - b.x);
    if (hasOverlap(sorted, "row")) continue;
    for (const d of group) assigned.add(eligible.indexOf(d));
    regions.push(buildFlowRegion(sorted, "row"));
  }

  // Step E: remaining unassigned → singletons
  for (let i = 0; i < eligible.length; i++) {
    if (!assigned.has(i)) {
      const d = eligible[i];
      regions.push({
        childIds: [d.node.id],
        childNames: [d.node.name],
      });
    }
  }

  // Step F: only emit when at least 2 regions
  if (regions.length < 2) return null;

  return {
    parentId: parent.id,
    parentName: parent.name,
    regions,
  };
}

function collectEligible(
  children: SimplifiedNode[],
  globalVars: GlobalVars,
): ChildDatum[] {
  const result: ChildDatum[] = [];
  for (const child of children) {
    if (!child.layout) continue;
    const layout = globalVars.styles[child.layout] as SimplifiedLayout | undefined;
    if (!layout || !layout.locationRelativeToParent) continue;
    if (layout.position === "absolute") continue;

    const x = parseDp(layout.locationRelativeToParent.x);
    const y = parseDp(layout.locationRelativeToParent.y);
    const width = parseDp(layout.dimensions?.width);
    const height = parseDp(layout.dimensions?.height);
    if (x === undefined || y === undefined) continue;

    result.push({ node: child, x, y, width: width ?? 0, height: height ?? 0 });
  }
  return result;
}

/**
 * Anchor-based grouping: sort by target axis, then assign each item to the
 * first group whose anchor (first item's coordinate) is within ALIGN_TOLERANCE.
 * Avoids the boundary-fracture problem of simple Math.round bucketing.
 */
function groupByAlignment(
  data: ChildDatum[],
  axis: "x" | "y",
): ChildDatum[][] {
  const sorted = [...data].sort((a, b) => a[axis] - b[axis]);
  const groups: ChildDatum[][] = [];
  for (const item of sorted) {
    const group = groups.find(
      (g) => Math.abs(g[0][axis] - item[axis]) <= ALIGN_TOLERANCE,
    );
    if (group) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups;
}

function hasOverlap(sorted: ChildDatum[], mode: "column" | "row"): boolean {
  for (let i = 0; i < sorted.length - 1; i++) {
    const curEnd =
      mode === "column" ? sorted[i].y + sorted[i].height : sorted[i].x + sorted[i].width;
    const nextStart = mode === "column" ? sorted[i + 1].y : sorted[i + 1].x;
    if (curEnd > nextStart) return true;
  }
  return false;
}

function buildFlowRegion(group: ChildDatum[], mode: "column" | "row"): RegionGroup {
  const layoutData: ChildLayoutData[] = group.map((d) => ({
    node: d.node,
    layout: { mode: "none" } as SimplifiedLayout,
    x: d.x,
    y: d.y,
    width: d.width,
    height: d.height,
  }));

  const gap = computeConsistentGap(layoutData, mode);

  return {
    mode,
    childIds: group.map((d) => d.node.id),
    childNames: group.map((d) => d.node.name),
    gap,
  };
}

// Re-export for test visibility
export { collectEligible };
