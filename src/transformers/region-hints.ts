import type { GlobalVars, SimplifiedNode } from "~/extractors/types.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";
import {
  ALIGN_TOLERANCE,
  GAP_TOLERANCE,
  parseDp,
  computeConsistentGap,
  detectCrossAlignment,
} from "~/transformers/layout.js";
import type { ChildLayoutData } from "~/transformers/layout.js";
import {
  isAttachment,
  computeAttachment,
  detectEdgeStraddle,
  type AttachmentInfo,
} from "~/transformers/anchor-inference.js";

/**
 * Minimum ratio of overlap area to the LARGER element's area to be treated as intentional stacking.
 * Using max_area (not min_area) prevents false positives when two wide side-by-side elements
 * happen to share horizontal space (e.g. a 300dp item at x=0 alongside a 120dp item at x=200).
 * At 0.5, only genuine containment — where the inner element covers ≥50% of the container —
 * is flagged as a stack.
 */
const STACK_OVERLAP_THRESHOLD = 0.5;

export interface RegionGroup {
  /** Omitted for singleton (single-child area, no container suggestion needed). */
  mode?: "column" | "row" | "stack";
  childIds: string[];
  childNames: string[];
  /** Uniform gap for multi-child area, undefined when inconsistent. Not set for stack regions. */
  gap?: string;
  /** Recommended Compose container for this region. Stack → Box, Column → Column, Row → Row. */
  composeContainer?: "Box" | "Column" | "Row";
  /** Recommended Views container for this region. Stack → FrameLayout, Column → LinearLayout(vertical), Row → LinearLayout(horizontal). */
  viewsContainer?: "FrameLayout" | "LinearLayout";
  /** For viewsContainer="LinearLayout", the orientation to use. */
  viewsOrientation?: "horizontal" | "vertical";
  /**
   * Cross-axis alignment of the flow's children when they share a center line
   * or far edge rather than the near edge. Column → Compose horizontalAlignment
   * / View gravity; Row → vertical. Absent (near-edge default) for start-aligned
   * flows. Emitted so a centered stack renders centered instead of left-pinned.
   */
  crossAxisAlignment?: "center" | "end";
  /**
   * Stack regions only. childIds order = Figma z-order (bottom→top) — an
   * implicit convention the LLM routinely misses, so it is spelled out in the
   * serialized output rather than left as a code comment.
   */
  zOrder?: string;
  /**
   * Small elements riding on the region's largest member (avatar + VIP badge).
   * Render each inside the host's Box/FrameLayout, aligned to `anchor` with
   * `insets` — not as independent absolutely-positioned siblings.
   *
   * `role: "background"` marks a content-area background layer: a RECTANGLE
   * fully inside the host with other content painted on top of it. It MUST be
   * rendered (a Box/View with the rectangle's fill, behind the content that
   * covers it) — it is functional UI, not skippable decoration.
   */
  attachments?: ({
    childId: string;
    childName: string;
    hostId: string;
    role?: "background" | "straddle";
    /**
     * role="straddle" only: how far the child extends BEYOND the host's edge
     * (which edge: see `anchor`), dp. Restore via the overhang policy —
     * transparent root + sibling offset. Never clip it away, never drop the
     * child, and if its image asset wasn't downloaded, place the solid-color
     * placeholder at this exact straddle position.
     */
    overhang?: string;
  } & AttachmentInfo)[];
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

  const assigned = new Set<ChildDatum>();
  const regions: RegionGroup[] = [];

  // Step B.5: detect deliberate z-order stacking before column/row grouping
  const stackGroups = buildStackGroups(eligible);
  for (const group of stackGroups) {
    for (const d of group) assigned.add(d);
    const region: RegionGroup = {
      mode: "stack",
      childIds: group.map((d) => d.node.id),
      childNames: group.map((d) => d.node.name),
      composeContainer: "Box",
      viewsContainer: "FrameLayout",
      zOrder:
        "childIds are listed bottom→top — declare children in exactly this order so later ones draw on top",
    };

    // Attachment annotation: small members riding on the group's largest
    // member get a host-relative anchor so the LLM nests them with the host
    // instead of positioning them independently from the region root.
    const host = group.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    const attachments: NonNullable<RegionGroup["attachments"]> = [];
    for (const d of group) {
      if (d === host) continue;
      // Straddle is checked before plain attachment: a child can satisfy
      // both (the dialog-illustration case), and the straddle entry carries
      // strictly more information (the overhang amount).
      const straddle = detectEdgeStraddle(host, d);
      if (straddle) {
        attachments.push({
          childId: d.node.id,
          childName: d.node.name,
          hostId: host.node.id,
          role: "straddle",
          overhang: straddle.overhang,
          ...computeAttachment(host, d),
        });
      } else if (isAttachment(host, d)) {
        attachments.push({
          childId: d.node.id,
          childName: d.node.name,
          hostId: host.node.id,
          ...computeAttachment(host, d),
        });
      } else if (isBackgroundLayer(d, host, group)) {
        // Content-area backgrounds (e.g. an inner data-panel rectangle inside
        // a card) fail isAttachment's size-disparity gate by design — they are
        // too large relative to the host. Without an attachment entry the LLM
        // sees only a bare RECTANGLE and routinely drops it, losing a visible
        // surface. Containment + being painted over is a stronger signal of
        // "background layer" than size disparity, so it gets its own check.
        attachments.push({
          childId: d.node.id,
          childName: d.node.name,
          hostId: host.node.id,
          role: "background",
          ...computeAttachment(host, d),
        });
      }
    }
    if (attachments.length > 0) region.attachments = attachments;

    regions.push(region);
  }

  // Step C: anchor grouping by x → Column candidates
  const xGroups = groupByAlignment(eligible.filter((d) => !assigned.has(d)), "x");
  for (const group of xGroups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.y - b.y);
    if (hasOverlap(sorted, "column")) continue;
    for (const d of group) assigned.add(d);
    regions.push(buildFlowRegion(sorted, "column"));
  }

  // Step D: anchor grouping by y → Row candidates (unassigned only)
  const yGroups = groupByAlignment(eligible.filter((d) => !assigned.has(d)), "y");
  for (const group of yGroups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.x - b.x);
    if (hasOverlap(sorted, "row")) continue;
    for (const d of group) assigned.add(d);
    regions.push(buildFlowRegion(sorted, "row"));
  }

  // Step E: remaining unassigned → singletons
  for (const d of eligible) {
    if (!assigned.has(d)) {
      regions.push({
        childIds: [d.node.id],
        childNames: [d.node.name],
      });
    }
  }

  // Step F: only emit when at least 2 regions — except a lone stack with
  // attachments (e.g. a dialog that is exactly banner + sheet): the container
  // choice, z-order, and straddle/attachment data are the whole point there,
  // and skipping the hint is what left dialogs structureless.
  if (regions.length < 2 && !regions.some((r) => r.mode === "stack" && r.attachments?.length)) {
    return null;
  }

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
    // Toasts must not be grouped with the static content they float over —
    // their position comes from the toast/snackbar API. Dialog content, by
    // contrast, DOES need internal structure analysis: after processDialog
    // the scrim and backdrop are removed, so dialog siblings can only group
    // with each other, and skipping them left the most fidelity-sensitive
    // part of the screen without hints. (Anchor inference still skips dialog
    // nodes — their screen position belongs to the dialog API, not margins.)
    if (child.overlayRole === "toast") continue;
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
 * Anchor-based clustering: sort by `key`, then assign each item to the first
 * group whose anchor (first item's key) is within ALIGN_TOLERANCE. Avoids the
 * boundary-fracture problem of simple Math.round bucketing.
 */
function clusterBy(data: ChildDatum[], key: (d: ChildDatum) => number): ChildDatum[][] {
  const sorted = [...data].sort((a, b) => key(a) - key(b));
  const groups: ChildDatum[][] = [];
  for (const item of sorted) {
    const group = groups.find((g) => Math.abs(key(g[0]) - key(item)) <= ALIGN_TOLERANCE);
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups;
}

/**
 * Group children that share an alignment line along `axis` (near edge first,
 * then center line). The near-edge pass is the original behavior; centered
 * stacks share a center line but differing near edges, so they scatter into
 * singletons there. Re-clustering only those singletons by center recovers
 * centered columns/rows without disturbing the near-edge groups. Far-edge
 * alignment is left to buildFlowRegion's per-group detection — a dedicated
 * pass adds little once center is covered.
 */
function groupByAlignment(
  data: ChildDatum[],
  axis: "x" | "y",
): ChildDatum[][] {
  const nearGroups = clusterBy(data, (d) => d[axis]);

  const result: ChildDatum[][] = [];
  const singletons: ChildDatum[] = [];
  for (const g of nearGroups) {
    if (g.length >= 2) result.push(g);
    else singletons.push(g[0]);
  }

  const center = (d: ChildDatum) => (axis === "x" ? d.x + d.width / 2 : d.y + d.height / 2);
  result.push(...clusterBy(singletons, center));
  return result;
}

function overlapArea(a: ChildDatum, b: ChildDatum): number {
  const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

/**
 * Containment tolerance (dp). Coordinates pass through px→dp conversion and
 * rounding, so an edge-flush inner rectangle can mathematically poke a
 * fraction of a dp outside its host.
 */
const CONTAINMENT_TOLERANCE = 2;

function isContained(host: ChildDatum, d: ChildDatum): boolean {
  return (
    d.x >= host.x - CONTAINMENT_TOLERANCE &&
    d.y >= host.y - CONTAINMENT_TOLERANCE &&
    d.x + d.width <= host.x + host.width + CONTAINMENT_TOLERANCE &&
    d.y + d.height <= host.y + host.height + CONTAINMENT_TOLERANCE
  );
}

/**
 * A background layer is a RECTANGLE fully inside the host that other group
 * members are painted over (group order preserves Figma z-order, bottom→top,
 * so only members AFTER it in the group can cover it). Restricted to
 * RECTANGLE because that is the only type whose role is unambiguous from
 * geometry alone — a contained FRAME or IMAGE may be foreground content.
 */
function isBackgroundLayer(d: ChildDatum, host: ChildDatum, group: ChildDatum[]): boolean {
  if (d.node.type !== "RECTANGLE") return false;
  if (!isContained(host, d)) return false;
  const idx = group.indexOf(d);
  return group.some((m, i) => i > idx && m !== host && overlapArea(m, d) > 0);
}

/**
 * Order-agnostic straddle test for stack grouping: the larger element is the
 * host candidate. The size gate inside detectEdgeStraddle keeps similar-size
 * siblings (negative-gap lists) from chaining into one mega-stack.
 */
function straddles(a: ChildDatum, b: ChildDatum): boolean {
  const [host, rider] = a.width * a.height >= b.width * b.height ? [a, b] : [b, a];
  return detectEdgeStraddle(host, rider) !== undefined;
}

function isSignificantOverlap(a: ChildDatum, b: ChildDatum): boolean {
  const area = overlapArea(a, b);
  if (area <= 0) return false;
  const larger = Math.max(a.width * a.height, b.width * b.height);
  return larger > 0 && area / larger > STACK_OVERLAP_THRESHOLD;
}

/** Union-find connected components for overlapping child nodes. */
function buildStackGroups(eligible: ChildDatum[]): ChildDatum[][] {
  const parent = eligible.map((_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (x: number, y: number) => { parent[find(x)] = find(y); };

  for (let i = 0; i < eligible.length; i++)
    for (let j = i + 1; j < eligible.length; j++)
      if (
        isSignificantOverlap(eligible[i], eligible[j]) ||
        isAttachment(eligible[i], eligible[j]) ||
        straddles(eligible[i], eligible[j])
      )
        union(i, j);

  const groups = new Map<number, number[]>();
  for (let i = 0; i < eligible.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }
  // Only multi-node groups; preserve original array order (= Figma z-order).
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => g.map((i) => eligible[i]));
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

  // Cross axis is horizontal for a column, vertical for a row.
  const alignment = detectCrossAlignment(
    group.map((d) => (mode === "column" ? d.x : d.y)),
    group.map((d) => (mode === "column" ? d.width : d.height)),
  );
  const crossAxisAlignment =
    alignment?.edge === "center" ? "center" : alignment?.edge === "end" ? "end" : undefined;

  return {
    mode,
    childIds: group.map((d) => d.node.id),
    childNames: group.map((d) => d.node.name),
    gap,
    composeContainer: mode === "column" ? "Column" : "Row",
    viewsContainer: "LinearLayout",
    viewsOrientation: mode === "column" ? "vertical" : "horizontal",
    crossAxisAlignment,
  };
}
