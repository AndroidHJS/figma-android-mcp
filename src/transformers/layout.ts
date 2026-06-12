import { isInAutoLayoutFlow, isFrame, isLayout, isRectangle } from "~/utils/identity.js";
import type {
  Node as FigmaDocumentNode,
  HasFramePropertiesTrait,
  HasLayoutTrait,
} from "@figma/rest-api-spec";
import { generateShorthand, generateVarId, pixelRound } from "~/utils/common.js";
import { dpString, getDesignDensityDivisor } from "~/utils/units.js";
import type { SimplifiedAnchor } from "~/transformers/anchor-inference.js";

export interface SimplifiedLayout {
  mode: "none" | "row" | "column";
  justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "baseline" | "stretch";
  alignItems?: "flex-start" | "flex-end" | "center" | "space-between" | "baseline" | "stretch";
  alignSelf?: "flex-start" | "flex-end" | "center" | "stretch";
  wrap?: boolean;
  gap?: string;
  locationRelativeToParent?: {
    x: string;
    y: string;
  };
  dimensions?: {
    width?: string;
    height?: string;
    aspectRatio?: number;
  };
  padding?: string;
  sizing?: {
    horizontal?: "fixed" | "fill" | "hug";
    vertical?: "fixed" | "fill" | "hug";
  };
  overflowScroll?: ("x" | "y")[];
  /**
   * Present only when false: this frame does NOT clip overflowing children,
   * so child overhang (negative insets) is visible by design and must be
   * restored. Absent means the Figma default (clip) — overflow is invisible
   * in the design and must NOT be "helpfully" un-clipped.
   */
  clipsContent?: false;
  position?: "absolute";
  constraints?: {
    horizontal: "MIN" | "MAX" | "CENTER" | "STRETCH" | "SCALE";
    vertical: "MIN" | "MAX" | "CENTER" | "STRETCH" | "SCALE";
  };
  /** Server-inferred nearest-anchor position for absolutely-positioned children (see anchor-inference.ts). */
  anchor?: SimplifiedAnchor;
}

// Convert Figma's layout config into a more typical flex-like schema
import type { GlobalVars, SimplifiedNode } from "~/extractors/types.js";

export function buildSimplifiedLayout(
  n: FigmaDocumentNode,
  parent?: FigmaDocumentNode,
): SimplifiedLayout {
  const frameValues = buildSimplifiedFrameValues(n);
  const layoutValues = buildSimplifiedLayoutValues(n, parent, frameValues.mode) || {};

  return { ...frameValues, ...layoutValues };
}

function convertJustifyContent(align?: HasFramePropertiesTrait["primaryAxisAlignItems"]) {
  switch (align) {
    case "MIN":
      return undefined;
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "SPACE_BETWEEN":
      return "space-between";
    default:
      return undefined;
  }
}

function convertAlignItems(
  align: HasFramePropertiesTrait["counterAxisAlignItems"] | undefined,
  children: FigmaDocumentNode[],
  mode: "row" | "column",
) {
  // Row cross-axis is vertical; column cross-axis is horizontal
  const crossSizing = mode === "row" ? "layoutSizingVertical" : "layoutSizingHorizontal";
  const allStretch =
    children.length > 0 &&
    children.every(
      (c) =>
        ("layoutPositioning" in c && c.layoutPositioning === "ABSOLUTE") ||
        (crossSizing in c && (c as Record<string, unknown>)[crossSizing] === "FILL"),
    );
  if (allStretch) return "stretch";

  switch (align) {
    case "MIN":
      return undefined;
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "BASELINE":
      return "baseline";
    default:
      return undefined;
  }
}

function convertSelfAlign(align?: HasLayoutTrait["layoutAlign"]) {
  switch (align) {
    case "MIN":
      // MIN, AKA flex-start, is the default alignment
      return undefined;
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "STRETCH":
      return "stretch";
    default:
      return undefined;
  }
}

// SPACE_BETWEEN computes gaps dynamically — the API returns stale spacing
// values, but Figma's UI shows "Auto". Suppress the affected axis.
function buildGap(n: HasFramePropertiesTrait, mode: "row" | "column"): string | undefined {
  const primaryGap = n.primaryAxisAlignItems === "SPACE_BETWEEN" ? undefined : n.itemSpacing;
  const counterGap =
    n.layoutWrap !== "WRAP" || n.counterAxisAlignContent === "SPACE_BETWEEN"
      ? undefined
      : n.counterAxisSpacing;

  // Map Figma's primary/counter axes to CSS's row/column axes
  const rowGap = mode === "row" ? counterGap : primaryGap;
  const colGap = mode === "row" ? primaryGap : counterGap;

  return gapShorthand(rowGap, colGap);
}

function gapShorthand(row?: number, col?: number): string | undefined {
  if (!row && !col) return undefined;
  if (row && col) return row === col ? dpString(row) : `${dpString(row)} ${dpString(col)}`;
  return dpString((row ?? col)!);
}

// Map Figma LayoutConstraint to CSS-flex terms.
// Defaults (LEFT/TOP) become MIN and are omitted from output.
function simplifyConstraints(
  c?: HasLayoutTrait["constraints"],
): SimplifiedLayout["constraints"] {
  if (!c) return undefined;

  const mapHorizontal = (h: string) => {
    switch (h) {
      case "LEFT":
        return undefined; // default
      case "RIGHT":
        return "MAX";
      case "CENTER":
        return "CENTER";
      case "LEFT_RIGHT":
        return "STRETCH";
      case "SCALE":
        return "SCALE";
    }
  };

  const mapVertical = (v: string) => {
    switch (v) {
      case "TOP":
        return undefined; // default
      case "BOTTOM":
        return "MAX";
      case "CENTER":
        return "CENTER";
      case "TOP_BOTTOM":
        return "STRETCH";
      case "SCALE":
        return "SCALE";
    }
  };

  const h = mapHorizontal(c.horizontal);
  const v = mapVertical(c.vertical);
  if (!h && !v) return undefined;
  return { horizontal: h ?? "MIN", vertical: v ?? "MIN" };
}

// interpret sizing
function convertSizing(
  s?: HasLayoutTrait["layoutSizingHorizontal"] | HasLayoutTrait["layoutSizingVertical"],
) {
  if (s === "FIXED") return "fixed";
  if (s === "FILL") return "fill";
  if (s === "HUG") return "hug";
  return undefined;
}

function buildSimplifiedFrameValues(n: FigmaDocumentNode): SimplifiedLayout | { mode: "none" } {
  if (!isFrame(n)) {
    return { mode: "none" };
  }

  const frameValues: SimplifiedLayout = {
    mode:
      !n.layoutMode || n.layoutMode === "NONE"
        ? "none"
        : n.layoutMode === "HORIZONTAL"
          ? "row"
          : "column",
  };

  const overflowScroll: SimplifiedLayout["overflowScroll"] = [];
  if (n.overflowDirection?.includes("HORIZONTAL")) overflowScroll.push("x");
  if (n.overflowDirection?.includes("VERTICAL")) overflowScroll.push("y");
  if (overflowScroll.length > 0) frameValues.overflowScroll = overflowScroll;

  if (n.clipsContent === false) frameValues.clipsContent = false;

  if (frameValues.mode === "none") {
    return frameValues;
  }

  frameValues.justifyContent = convertJustifyContent(n.primaryAxisAlignItems ?? "MIN");
  frameValues.alignItems = convertAlignItems(
    n.counterAxisAlignItems ?? "MIN",
    n.children,
    frameValues.mode,
  );
  frameValues.alignSelf = convertSelfAlign(n.layoutAlign);

  // Only include wrap if it's set to WRAP, since flex layouts don't default to wrapping
  frameValues.wrap = n.layoutWrap === "WRAP" ? true : undefined;
  frameValues.gap = buildGap(n, frameValues.mode);
  // gather padding (density-scaled — raw Figma px must be divided by density divisor)
  if (n.paddingTop || n.paddingBottom || n.paddingLeft || n.paddingRight) {
    const divisor = getDesignDensityDivisor();
    frameValues.padding = generateShorthand({
      top: pixelRound((n.paddingTop ?? 0) / divisor),
      right: pixelRound((n.paddingRight ?? 0) / divisor),
      bottom: pixelRound((n.paddingBottom ?? 0) / divisor),
      left: pixelRound((n.paddingLeft ?? 0) / divisor),
    });
  }

  return frameValues;
}

function buildSimplifiedLayoutValues(
  n: FigmaDocumentNode,
  parent: FigmaDocumentNode | undefined,
  mode: "row" | "column" | "none",
): SimplifiedLayout | undefined {
  if (!isLayout(n)) return undefined;

  const layoutValues: SimplifiedLayout = { mode };

  layoutValues.sizing = {
    horizontal: convertSizing(n.layoutSizingHorizontal),
    vertical: convertSizing(n.layoutSizingVertical),
  };

  // Only include positioning-related properties if parent layout isn't flex or if the node is absolute
  if (
    // If parent is a frame but not an AutoLayout, or if the node is absolute, include positioning-related properties
    isFrame(parent) &&
    !isInAutoLayoutFlow(n, parent)
  ) {
    if (n.layoutPositioning === "ABSOLUTE") {
      layoutValues.position = "absolute";
    }
    if (n.absoluteBoundingBox && parent.absoluteBoundingBox) {
      layoutValues.locationRelativeToParent = {
        x: dpString(n.absoluteBoundingBox.x - parent.absoluteBoundingBox.x),
        y: dpString(n.absoluteBoundingBox.y - parent.absoluteBoundingBox.y),
      };
    }
    layoutValues.constraints = simplifyConstraints((n as HasLayoutTrait).constraints);
  }

  // Handle dimensions based on layout growth and alignment
  if (isRectangle("absoluteBoundingBox", n)) {
    const dimensions: { width?: string; height?: string; aspectRatio?: number } = {};

    // Only include dimensions that aren't meant to stretch
    if (mode === "row") {
      // AutoLayout row, only include dimensions if the node is not growing
      if (!n.layoutGrow && n.layoutSizingHorizontal == "FIXED")
        dimensions.width = dpString(n.absoluteBoundingBox.width);
      if (n.layoutAlign !== "STRETCH" && n.layoutSizingVertical == "FIXED")
        dimensions.height = dpString(n.absoluteBoundingBox.height);
    } else if (mode === "column") {
      // AutoLayout column, only include dimensions if the node is not growing
      if (n.layoutAlign !== "STRETCH" && n.layoutSizingHorizontal == "FIXED")
        dimensions.width = dpString(n.absoluteBoundingBox.width);
      if (!n.layoutGrow && n.layoutSizingVertical == "FIXED")
        dimensions.height = dpString(n.absoluteBoundingBox.height);

      if (n.preserveRatio) {
        dimensions.aspectRatio = n.absoluteBoundingBox?.width / n.absoluteBoundingBox?.height;
      }
    } else {
      // Node is not an AutoLayout. Include dimensions if the node is not growing (which it should never be)
      if (!n.layoutSizingHorizontal || n.layoutSizingHorizontal === "FIXED") {
        dimensions.width = dpString(n.absoluteBoundingBox.width);
      }
      if (!n.layoutSizingVertical || n.layoutSizingVertical === "FIXED") {
        dimensions.height = dpString(n.absoluteBoundingBox.height);
      }
    }

    if (Object.keys(dimensions).length > 0) {
      layoutValues.dimensions = dimensions;
    }
  }

  if (n.type === "TEXT") {
    applyTextSizingIntent(n, layoutValues);
  }

  return layoutValues;
}

/**
 * Text boxes get their designer-intended sizing instead of literal pixels.
 *
 * Fixed text dimensions translate into hard layout_width values that CLIP on
 * device — runtime fonts render wider than the design baseline, and "Ajukan"
 * becomes "Ajuka". The skill rule "text width is content-driven" loses to
 * explicit data ("93dp" in front of the LLM wins), so the fix is to stop
 * emitting fixed sizing where it isn't intent:
 *
 *   - textAutoResize WIDTH_AND_HEIGHT → the box hugs its content; its
 *     width/height are incidental. Sizing becomes hug on both axes.
 *   - textAutoResize HEIGHT → width is the wrap basis (multi-line text);
 *     keep it, height hugs.
 *   - textTruncation ENDING / textAutoResize TRUNCATE → the fixed box IS
 *     the intent; untouched (text rules emit maxLines + ellipsize).
 *   - NONE or absent → usually an accidentally-fixed single-line label.
 *     Single-line (height ≈ one line-height) → hug both axes; taller boxes
 *     keep their width as the wrap basis.
 *
 * `dimensions` are deliberately KEPT: anchor inference, region hints, and
 * straddle detection all consume them for geometry. Only `sizing` changes —
 * the platform mappers prefer sizing over dimensions, so the LLM sees
 * wrap_content while the analysis passes keep exact bounds.
 */
function applyTextSizingIntent(n: FigmaDocumentNode, layoutValues: SimplifiedLayout): void {
  const style = ("style" in n ? n.style : undefined) as
    | {
        textAutoResize?: string;
        textTruncation?: string;
        lineHeightPx?: number;
        fontSize?: number;
      }
    | undefined;
  if (!style) return;
  if (style.textTruncation === "ENDING" || style.textAutoResize === "TRUNCATE") return;

  const sizing = (layoutValues.sizing ??= {});
  // Never override an explicit FILL/HUG from the API — only "fixed"/absent,
  // where the literal pixels are the thing we distrust.
  const canHug = (v?: string): boolean => v === undefined || v === "fixed";

  if (style.textAutoResize === "WIDTH_AND_HEIGHT") {
    if (canHug(sizing.horizontal)) sizing.horizontal = "hug";
    if (canHug(sizing.vertical)) sizing.vertical = "hug";
    return;
  }
  if (style.textAutoResize === "HEIGHT") {
    if (canHug(sizing.vertical)) sizing.vertical = "hug";
    return;
  }

  // NONE / absent: single-line heuristic. 1.6× tolerates line-height
  // rounding and small vertical padding without catching 2-line text.
  const height = isRectangle("absoluteBoundingBox", n) ? n.absoluteBoundingBox.height : undefined;
  const line = style.lineHeightPx ?? (style.fontSize ? style.fontSize * 1.4 : undefined);
  if (height !== undefined && line !== undefined && height <= line * 1.6) {
    if (canHug(sizing.horizontal)) sizing.horizontal = "hug";
    if (canHug(sizing.vertical)) sizing.vertical = "hug";
  }
}

// ---------------------------------------------------------------------------
// Layout inference — detect Column/Row patterns from absolute positions
// ---------------------------------------------------------------------------

/** Tolerance (in dp) for treating x or y offsets as "aligned". */
export const ALIGN_TOLERANCE = 4;

/** Tolerance (in dp) for treating gaps between children as "consistent". */
export const GAP_TOLERANCE = 3;

/** Extract the numeric value from a dp string like "8dp" or "16.5dp". */
export function parseDp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
}

export interface ChildLayoutData {
  node: SimplifiedNode;
  layout: SimplifiedLayout;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Walk the simplified node tree and convert non-auto-layout frames whose
 * children form recognizable Column or Row patterns into flex layouts.
 *
 * Mutates `globalVars.styles` in-place — children that are folded into an
 * inferred flex layout have `locationRelativeToParent` and `constraints`
 * removed from their layout styles.
 */
export function inferAutoLayoutFromPositions(
  nodes: SimplifiedNode[],
  globalVars: GlobalVars,
): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      inferForNode(node, globalVars);
      inferAutoLayoutFromPositions(node.children, globalVars);
    }
  }
}

function inferForNode(parent: SimplifiedNode, globalVars: GlobalVars): void {
  if (!parent.layout) return;

  const parentLayout = globalVars.styles[parent.layout] as SimplifiedLayout | undefined;
  if (!parentLayout || parentLayout.mode !== "none") return;

  const childData = collectEligibleChildren(parent.children!, globalVars);
  if (childData.length < 2) return;

  if (tryInferColumn(childData, parentLayout)) return;
  tryInferRow(childData, parentLayout);
}

function collectEligibleChildren(
  children: SimplifiedNode[],
  globalVars: GlobalVars,
): ChildLayoutData[] {
  const result: ChildLayoutData[] = [];
  for (const child of children) {
    if (!child.layout) continue;
    // Transient overlays float above the page — including them breaks
    // column/row detection for the real content beneath.
    if (child.overlayRole) continue;
    const layout = globalVars.styles[child.layout] as SimplifiedLayout | undefined;
    if (!layout || !layout.locationRelativeToParent) continue;
    if (layout.position === "absolute") continue;

    const x = parseDp(layout.locationRelativeToParent.x);
    const y = parseDp(layout.locationRelativeToParent.y);
    const width = parseDp(layout.dimensions?.width);
    const height = parseDp(layout.dimensions?.height);
    if (x === undefined || y === undefined) continue;

    result.push({ node: child, layout, x, y, width: width ?? 0, height: height ?? 0 });
  }
  return result;
}

// ---- Column detection ------------------------------------------------------

function tryInferColumn(data: ChildLayoutData[], parentLayout: SimplifiedLayout): boolean {
  const xValues = data.map((d) => d.x);
  if (Math.max(...xValues) - Math.min(...xValues) > ALIGN_TOLERANCE) return false;

  const sorted = [...data].sort((a, b) => a.y - b.y);

  for (let i = 0; i < sorted.length - 1; i++) {
    const curBottom = sorted[i].y + sorted[i].height;
    if (curBottom > sorted[i + 1].y) return false;
  }

  parentLayout.mode = "column";

  const gap = computeConsistentGap(sorted, "column");
  if (gap !== undefined) parentLayout.gap = gap;

  for (const d of data) {
    delete d.layout.locationRelativeToParent;
    delete d.layout.constraints;
  }

  return true;
}

// ---- Row detection ---------------------------------------------------------

function tryInferRow(data: ChildLayoutData[], parentLayout: SimplifiedLayout): boolean {
  const yValues = data.map((d) => d.y);
  if (Math.max(...yValues) - Math.min(...yValues) > ALIGN_TOLERANCE) return false;

  const sorted = [...data].sort((a, b) => a.x - b.x);

  for (let i = 0; i < sorted.length - 1; i++) {
    const curRight = sorted[i].x + sorted[i].width;
    if (curRight > sorted[i + 1].x) return false;
  }

  parentLayout.mode = "row";

  const gap = computeConsistentGap(sorted, "row");
  if (gap !== undefined) parentLayout.gap = gap;

  for (const d of data) {
    delete d.layout.locationRelativeToParent;
    delete d.layout.constraints;
  }

  return true;
}

// ---- Gap computation -------------------------------------------------------

export function computeConsistentGap(
  sorted: ChildLayoutData[],
  mode: "column" | "row",
): string | undefined {
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const curEnd = mode === "column"
      ? sorted[i].y + sorted[i].height
      : sorted[i].x + sorted[i].width;
    const nextStart = mode === "column" ? sorted[i + 1].y : sorted[i + 1].x;
    gaps.push(nextStart - curEnd);
  }

  if (gaps.length === 0) return undefined;

  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  if (max - min > GAP_TOLERANCE) return undefined;

  return dpString(Math.round(min));
}

// ---------------------------------------------------------------------------
// Fill-max-width conversion — convert centered fixed-width/height children
// inside auto-layout parents to fill + padding for responsive layout.
// ---------------------------------------------------------------------------

interface PaddingValues {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Parse CSS padding shorthand (e.g. "8dp", "16dp 12dp") to numeric values. */
function parsePaddingShorthand(padding: string | undefined): PaddingValues {
  if (!padding) return { top: 0, right: 0, bottom: 0, left: 0 };
  const parts = padding.split(" ").map((p) => parseFloat(p));
  if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  if (parts.length === 3) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
}

interface ContentDims {
  width?: number;
  height?: number;
}

/** Compute parent content area by subtracting padding from outer dimensions. */
function computeParentContentDims(parentLayout: SimplifiedLayout): ContentDims {
  const outerWidth = parseDp(parentLayout.dimensions?.width);
  const outerHeight = parseDp(parentLayout.dimensions?.height);
  const pad = parsePaddingShorthand(parentLayout.padding);

  return {
    width: outerWidth !== undefined ? outerWidth - pad.left - pad.right : undefined,
    height: outerHeight !== undefined ? outerHeight - pad.top - pad.bottom : undefined,
  };
}

/**
 * Walk the simplified node tree and convert centered fixed-width/height
 * children inside auto-layout parents to fill + padding.
 *
 * Mutates `globalVars.styles` — cloned layouts are stored under new keys and
 * affected nodes updated to reference the new key.
 */
export function convertFixedChildrenToFillMax(
  nodes: SimplifiedNode[],
  globalVars: GlobalVars,
): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0 && node.layout) {
      const parentLayout = globalVars.styles[node.layout] as SimplifiedLayout | undefined;
      if (parentLayout && (parentLayout.mode === "row" || parentLayout.mode === "column")) {
        const parentDims = computeParentContentDims(parentLayout);
        tryConvertChildren(node.children, parentLayout, parentDims, globalVars);
      }
    }
    if (node.children) {
      convertFixedChildrenToFillMax(node.children, globalVars);
    }
  }
}

function tryConvertChildren(
  children: SimplifiedNode[],
  parentLayout: SimplifiedLayout,
  parentDims: ContentDims,
  globalVars: GlobalVars,
): void {
  for (const child of children) {
    if (!child.layout) continue;

    const childLayout = globalVars.styles[child.layout] as SimplifiedLayout | undefined;
    if (!childLayout) continue;
    if (childLayout.mode === "row" || childLayout.mode === "column") continue;
    if (childLayout.position === "absolute") continue;

    if (parentLayout.mode === "column") {
      tryConvertHorizontal(child, childLayout, parentLayout, parentDims, globalVars);
    } else {
      tryConvertVertical(child, childLayout, parentLayout, parentDims, globalVars);
    }
  }
}

function tryConvertHorizontal(
  child: SimplifiedNode,
  childLayout: SimplifiedLayout,
  parentLayout: SimplifiedLayout,
  parentDims: ContentDims,
  globalVars: GlobalVars,
): void {
  if (childLayout.sizing?.horizontal !== "fixed") return;
  if (!childLayout.dimensions?.width) return;
  if (parentDims.width === undefined || parentDims.width <= 0) return;

  const childWidth = parseFloat(childLayout.dimensions.width);
  if (isNaN(childWidth) || childWidth >= parentDims.width) return;

  const isCentered = parentLayout.alignItems === "center" || childLayout.alignSelf === "center";
  if (!isCentered) return;

  const paddingEach = Math.round((parentDims.width - childWidth) / 2);
  if (paddingEach <= 0) return;

  const clone: SimplifiedLayout = { ...childLayout };
  clone.sizing = { ...clone.sizing, horizontal: "fill" };
  if (clone.dimensions) {
    const { width: _w, ...rest } = clone.dimensions;
    clone.dimensions = Object.keys(rest).length > 0 ? rest : undefined;
  }

  const existing = parsePaddingShorthand(clone.padding);
  clone.padding = generateShorthand({
    top: existing.top,
    right: existing.right + paddingEach,
    bottom: existing.bottom,
    left: existing.left + paddingEach,
  });

  const newKey = generateVarId("layout");
  globalVars.styles[newKey] = clone;
  child.layout = newKey;
}

function tryConvertVertical(
  child: SimplifiedNode,
  childLayout: SimplifiedLayout,
  parentLayout: SimplifiedLayout,
  parentDims: ContentDims,
  globalVars: GlobalVars,
): void {
  if (childLayout.sizing?.vertical !== "fixed") return;
  if (!childLayout.dimensions?.height) return;
  if (parentDims.height === undefined || parentDims.height <= 0) return;

  const childHeight = parseFloat(childLayout.dimensions.height);
  if (isNaN(childHeight) || childHeight >= parentDims.height) return;

  const isCentered = parentLayout.alignItems === "center" || childLayout.alignSelf === "center";
  if (!isCentered) return;

  const paddingEach = Math.round((parentDims.height - childHeight) / 2);
  if (paddingEach <= 0) return;

  const clone: SimplifiedLayout = { ...childLayout };
  clone.sizing = { ...clone.sizing, vertical: "fill" };
  if (clone.dimensions) {
    const { height: _h, ...rest } = clone.dimensions;
    clone.dimensions = Object.keys(rest).length > 0 ? rest : undefined;
  }

  const existing = parsePaddingShorthand(clone.padding);
  clone.padding = generateShorthand({
    top: existing.top + paddingEach,
    right: existing.right,
    bottom: existing.bottom + paddingEach,
    left: existing.left,
  });

  const newKey = generateVarId("layout");
  globalVars.styles[newKey] = clone;
  child.layout = newKey;
}
