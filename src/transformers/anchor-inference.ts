import type { GlobalVars, SimplifiedNode } from "~/extractors/types.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";
import { parseDp } from "~/transformers/layout.js";
import { generateVarId } from "~/utils/common.js";

/**
 * Anchor inference for absolutely-positioned children.
 *
 * Children of mode-"none" parents carry raw coordinates (x=297, y=24). An LLM
 * translating those literally anchors everything to the top-left: an element
 * 30dp from the right edge of a 375dp design becomes "x=297", and on a 411dp
 * device it sits 66dp from the right instead of 30dp. This pass re-expresses
 * each child's position as its NEAREST anchor (9-grid) plus an inset, turning
 * "x=297" into "end, inset 30dp" — a deterministic, responsive expression
 * computed server-side instead of guessed by the LLM.
 *
 * Precedence (mirrors positioning-policy.ts):
 *   - Explicit Figma constraints win — the designer declared intent; skip.
 *   - Axis size ≥ 85% of parent → "stretch" (fill + both insets), which is the
 *     fillMaxWidth + horizontal padding treatment for near-full-width content.
 *   - Otherwise the nearest of start-edge / center / end-edge wins.
 *   - "center" is only chosen when the centering is near-exact (≤2dp drift);
 *     otherwise the nearest edge wins. This keeps the platform mapping clean —
 *     "centered but nudged 13dp left" is not a pattern either Compose or
 *     FrameLayout expresses well, and a nearby edge inset renders identically
 *     at baseline while staying sane on other widths.
 */

/** Axis share of parent at/above which the child is treated as stretching. */
export const STRETCH_RATIO = 0.85;

/** Max drift (dp) from exact center for the center anchor to be chosen. */
export const CENTER_SNAP_DP = 2;

/**
 * Max edge inset as a share of the parent's axis size for an edge anchor to
 * be emitted. An element floating mid-space in a tall parent (e.g. 580dp from
 * the bottom of a 1543dp screen) technically has a nearest edge, but the
 * resulting anchor is semantically meaningless — the LLM reads "bottom:
 * 580dp" as an intentional bottom attachment and produces nonsense on other
 * screen heights. Above this ratio the annotation is skipped entirely: raw
 * coordinates stay, and region hints remain the source of structure.
 *
 * 1/3 keeps the "centered but nudged" case (see CENTER_SNAP_DP comment),
 * whose insets approach but stay under parent×1/3.
 */
export const ANCHOR_MAX_INSET_RATIO = 1 / 3;

export interface SimplifiedAnchor {
  horizontal: "start" | "center" | "end" | "stretch";
  vertical: "top" | "center" | "bottom" | "stretch";
  /** Insets from the anchored edge(s), dp. Absent for centered axes. */
  insets?: { start?: string; end?: string; top?: string; bottom?: string };
}

function dp(n: number): string {
  return `${Math.round(n * 100) / 100}dp`;
}

type AxisEdge = "near" | "center" | "far" | "stretch";

interface AxisClass {
  edge: AxisEdge;
  /** Inset from near edge (start/top), set for near & stretch. */
  near?: number;
  /** Inset from far edge (end/bottom), set for far & stretch. */
  far?: number;
}

/**
 * Classify one axis of a child against its parent.
 * `pos` is the child's offset from the parent's near edge, `size` the child's
 * extent, `parentSize` the parent's extent — all dp.
 */
export function classifyAxis(pos: number, size: number, parentSize: number): AxisClass {
  const gapNear = pos;
  const gapFar = parentSize - (pos + size);
  const centerDelta = pos + size / 2 - parentSize / 2;

  if (size >= STRETCH_RATIO * parentSize) {
    return { edge: "stretch", near: gapNear, far: gapFar };
  }
  if (Math.abs(centerDelta) <= CENTER_SNAP_DP) {
    return { edge: "center" };
  }
  return Math.abs(gapNear) <= Math.abs(gapFar)
    ? { edge: "near", near: gapNear }
    : { edge: "far", far: gapFar };
}

/**
 * Center and stretch classifications are always confident — they're chosen by
 * strict criteria. Edge anchors are only confident when the element actually
 * hugs that edge (inset within ANCHOR_MAX_INSET_RATIO of the parent size).
 * Overhang (negative inset) counts by magnitude.
 */
function isAxisConfident(axis: AxisClass, parentSize: number): boolean {
  if (axis.edge === "center" || axis.edge === "stretch") return true;
  const inset = axis.edge === "near" ? axis.near! : axis.far!;
  return Math.abs(inset) <= ANCHOR_MAX_INSET_RATIO * parentSize;
}

function buildAnchor(h: AxisClass, v: AxisClass): SimplifiedAnchor {
  const insets: NonNullable<SimplifiedAnchor["insets"]> = {};
  if (h.near !== undefined) insets.start = dp(h.near);
  if (h.far !== undefined) insets.end = dp(h.far);
  if (v.near !== undefined) insets.top = dp(v.near);
  if (v.far !== undefined) insets.bottom = dp(v.far);

  const horizontal =
    h.edge === "stretch" ? "stretch" : h.edge === "center" ? "center" : h.edge === "far" ? "end" : "start";
  const vertical =
    v.edge === "stretch" ? "stretch" : v.edge === "center" ? "center" : v.edge === "far" ? "bottom" : "top";

  const anchor: SimplifiedAnchor = { horizontal, vertical };
  if (Object.keys(insets).length > 0) anchor.insets = insets;
  return anchor;
}

/**
 * Compact anchor name for hints/regions, e.g. "bottomEnd", "topStart", "center".
 */
export function anchorName(h: AxisEdge, v: AxisEdge): string {
  const vName = v === "far" ? "bottom" : v === "near" || v === "stretch" ? "top" : "center";
  const hName = h === "far" ? "End" : h === "near" || h === "stretch" ? "Start" : "Center";
  if (vName === "center" && hName === "Center") return "center";
  return `${vName}${hName}`;
}

/**
 * Walk the simplified tree and annotate children of mode-"none" parents with
 * inferred anchors. Mutates `globalVars.styles` via the clone-to-new-key
 * pattern — layout styles are deduplicated by value and may be shared across
 * parents of DIFFERENT sizes, so writing the anchor into the shared style
 * would leak one parent's geometry into another's children.
 */
export function inferAnchors(nodes: SimplifiedNode[], globalVars: GlobalVars): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      annotateChildren(node, globalVars);
      inferAnchors(node.children, globalVars);
    }
  }
}

function annotateChildren(parent: SimplifiedNode, globalVars: GlobalVars): void {
  if (!parent.layout) return;
  const parentLayout = globalVars.styles[parent.layout] as SimplifiedLayout | undefined;
  if (!parentLayout || parentLayout.mode !== "none") return;

  const pw = parseDp(parentLayout.dimensions?.width);
  const ph = parseDp(parentLayout.dimensions?.height);
  if (!pw || pw <= 0 || !ph || ph <= 0) return;

  for (const child of parent.children!) {
    if (!child.layout) continue;
    // Transient overlays are positioned by their trigger (toast/dialog APIs),
    // not by static anchors.
    if (child.overlayRole) continue;
    const childLayout = globalVars.styles[child.layout] as SimplifiedLayout | undefined;
    if (!childLayout?.locationRelativeToParent) continue;
    // Explicit Figma constraints are the designer's declared intent — the
    // platform mappers already translate them; inferring on top would emit
    // two competing positioning systems for one node.
    if (childLayout.constraints) continue;
    if (childLayout.anchor) continue;

    const x = parseDp(childLayout.locationRelativeToParent.x);
    const y = parseDp(childLayout.locationRelativeToParent.y);
    const cw = parseDp(childLayout.dimensions?.width) ?? 0;
    const chH = parseDp(childLayout.dimensions?.height) ?? 0;
    if (x === undefined || y === undefined) continue;

    const h = classifyAxis(x, cw, pw);
    const v = classifyAxis(y, chH, ph);

    // Low-confidence anchors are worse than none: a wrong-but-plausible
    // "bottom: 580dp" misleads the LLM, while raw coordinates at least get
    // grouped by region hints.
    if (!isAxisConfident(h, pw) || !isAxisConfident(v, ph)) continue;

    const clone: SimplifiedLayout = { ...childLayout, anchor: buildAnchor(h, v) };
    const newKey = generateVarId("layout");
    globalVars.styles[newKey] = clone;
    child.layout = newKey;
  }
}

// ---------------------------------------------------------------------------
// Attachment detection — shared with region-hints
// ---------------------------------------------------------------------------

/** Overlap must cover at least this share of the SMALLER element's area. */
export const ATTACHMENT_OVERLAP_OF_SMALLER = 0.5;

/** The smaller element's area must be at most this share of the larger's. */
export const ATTACHMENT_SIZE_RATIO = 0.3;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlapArea(a: Bounds, b: Bounds): number {
  const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

/**
 * True when a small element rides on a much larger host (avatar + VIP badge).
 * The stack threshold (overlap / LARGER area) misses this case by design — a
 * 20dp badge covers ~12% of a 56dp avatar — so attachment uses the SMALLER
 * element's coverage plus a size-disparity gate to avoid pairing similar-size
 * siblings that merely touch.
 */
export function isAttachment(a: Bounds, b: Bounds): boolean {
  const area = overlapArea(a, b);
  if (area <= 0) return false;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const smaller = Math.min(areaA, areaB);
  const larger = Math.max(areaA, areaB);
  if (smaller <= 0 || larger <= 0) return false;
  return area / smaller >= ATTACHMENT_OVERLAP_OF_SMALLER && smaller / larger <= ATTACHMENT_SIZE_RATIO;
}

export interface AttachmentInfo {
  /** 9-grid anchor of the attached element relative to its host, e.g. "bottomEnd". */
  anchor: string;
  /** Insets (dp) from the host's anchored edges. May be negative when overhanging. */
  insets?: { start?: string; end?: string; top?: string; bottom?: string };
}

/** Compute where `child` sits on `host`, expressed as host-relative anchor + insets. */
export function computeAttachment(host: Bounds, child: Bounds): AttachmentInfo {
  const h = classifyAxis(child.x - host.x, child.width, host.width);
  const v = classifyAxis(child.y - host.y, child.height, host.height);
  const anchor = buildAnchor(h, v);
  return { anchor: anchorName(h.edge, v.edge), insets: anchor.insets };
}
