import type { SimplifiedLayout } from "~/transformers/layout.js";
import { parseDp } from "~/transformers/layout.js";
import type { ComposeLayout, ComposePadding } from "./types.js";

/**
 * Map a CSS-flex `SimplifiedLayout` to Android Jetpack Compose-native fields.
 *
 * Alignment values are context-dependent: for a Row container, cross-axis
 * alignment maps to Top/CenterVertically/Bottom; for a Column container,
 * it maps to Start/CenterHorizontally/End.
 */
export function mapToCompose(layout: SimplifiedLayout): ComposeLayout {
  const result: ComposeLayout = {};

  // layout direction
  if (layout.mode === "row") {
    result.layout = "Row";
  } else if (layout.mode === "column") {
    result.layout = "Column";
  }
  // mode "none" → no layout field

  // arrangement (main-axis) — only for auto-layout containers
  if (layout.justifyContent && layout.mode !== "none") {
    result.arrangement = mapArrangement(layout.justifyContent);
  }

  // alignment (cross-axis, context-dependent)
  if (layout.alignItems && layout.mode !== "none") {
    result.alignment = mapAlignment(layout.alignItems, layout.mode);
  }

  // self alignment (context-dependent on parent)
  if (layout.alignSelf) {
    result.selfAlignment = mapSelfAlignment(layout.alignSelf, layout.mode);
  }

  // spacing
  if (layout.gap) {
    result.spacing = layout.gap;
  }

  // padding: CSS shorthand → Compose named object
  if (layout.padding) {
    result.padding = parsePadding(layout.padding);
  }

  // width / height — merge sizing + dimensions
  if (layout.sizing) {
    result.width = mapSizing(layout.sizing.horizontal, layout.dimensions?.width);
    result.height = mapSizing(layout.sizing.vertical, layout.dimensions?.height);
  } else if (layout.dimensions?.width || layout.dimensions?.height) {
    // non-auto-layout frames only have dimensions
    result.width = layout.dimensions.width;
    result.height = layout.dimensions.height;
  }

  if (layout.dimensions?.aspectRatio) {
    result.aspectRatio = layout.dimensions.aspectRatio;
  }

  // scroll
  if (layout.overflowScroll?.length) {
    result.scroll = mapScroll(layout.overflowScroll);
  }

  // absolute positioning — a server-inferred anchor supersedes the raw offset:
  // emitting both would hand the LLM two competing positioning systems.
  if (layout.position === "absolute") {
    result.position = "absolute";
  }
  if (layout.anchor) {
    applyAnchorToCompose(layout.anchor, result);
  } else if (layout.locationRelativeToParent) {
    result.offset = layout.locationRelativeToParent;
  }

  // wrap
  if (layout.wrap) {
    result.wrap = true;
  }

  // constraints (non-AutoLayout positioning)
  if (layout.constraints) {
    result.horizontalConstraint = mapConstraintHorizontal(layout.constraints.horizontal);
    result.verticalConstraint = mapConstraintVertical(layout.constraints.vertical);
  }

  // Only return if there's something meaningful
  if (Object.keys(result).length === 0) return result;
  return result;
}

/**
 * Map a SimplifiedAnchor onto Compose Box semantics: alignment + edge padding.
 * Stretch axes become fillMax sizing with both insets as padding; for the
 * alignment name a stretched axis reads as Top/Start (irrelevant once filled).
 */
function applyAnchorToCompose(
  anchor: NonNullable<SimplifiedLayout["anchor"]>,
  result: ComposeLayout,
): void {
  const v = anchor.vertical === "stretch" ? "top" : anchor.vertical;
  const h = anchor.horizontal === "stretch" ? "start" : anchor.horizontal;

  const vName = v === "top" ? "Top" : v === "bottom" ? "Bottom" : "Center";
  const hName = h === "start" ? "Start" : h === "end" ? "End" : "Center";
  result.anchorAlignment = vName === "Center" && hName === "Center" ? "Center" : `${vName}${hName}`;

  if (anchor.horizontal === "stretch") result.width = "fillMax";
  if (anchor.vertical === "stretch") result.height = "fillMax";

  if (anchor.insets) {
    // Negative insets mean the child pokes past the parent's edge. Compose
    // padding crashes on negative values, so overhang is split into its own
    // field with the sign flipped; the overhang policy teaches the restore.
    const margin: ComposePadding = {};
    const overhang: ComposePadding = {};
    for (const side of ["start", "top", "end", "bottom"] as const) {
      const value = anchor.insets[side];
      if (value === undefined) continue;
      const n = parseDp(value);
      if (n !== undefined && n < 0) overhang[side] = `${Math.round(-n * 100) / 100}dp`;
      else margin[side] = value;
    }
    if (Object.keys(margin).length > 0) result.anchorMargin = margin;
    if (Object.keys(overhang).length > 0) result.anchorOverhang = overhang;
  }
}

function mapArrangement(value: string): ComposeLayout["arrangement"] {
  switch (value) {
    case "flex-end":
      return "End";
    case "center":
      return "Center";
    case "space-between":
      return "SpaceBetween";
    default:
      return undefined;
  }
}

function mapAlignment(value: string, mode: "none" | "row" | "column"): string | undefined {
  const isRow = mode === "row";

  switch (value) {
    case "flex-start":
      return undefined; // default
    case "flex-end":
      return isRow ? "Bottom" : "End";
    case "center":
      return isRow ? "CenterVertically" : "CenterHorizontally";
    case "stretch":
      return "Stretch";
    case "baseline":
      return "Baseline";
    default:
      return undefined;
  }
}

function mapSelfAlignment(value: string, mode: "none" | "row" | "column"): string {
  const isRow = mode === "row";

  switch (value) {
    case "flex-start":
      return isRow ? "Top" : "Start";
    case "flex-end":
      return isRow ? "Bottom" : "End";
    case "center":
      return "Center";
    case "stretch":
      return "Stretch";
    default:
      return value;
  }
}

function mapSizing(
  sizing: string | undefined,
  dimension: string | undefined,
): ComposeLayout["width"] {
  if (sizing === "fill") return "fillMax";
  if (sizing === "hug") return "wrapContent";
  if (dimension) return dimension;
  return undefined;
}

function mapScroll(overflow: ("x" | "y")[]): ComposeLayout["scroll"] {
  if (overflow.includes("x") && overflow.includes("y")) return "both";
  if (overflow.includes("x")) return "horizontal";
  return "vertical";
}

function mapConstraintHorizontal(value: string): ComposeLayout["horizontalConstraint"] {
  switch (value) {
    case "MIN":
      return undefined;
    case "MAX":
      return "end";
    case "CENTER":
      return "center";
    case "STRETCH":
      return "stretch";
    case "SCALE":
      return "scale";
  }
}

function mapConstraintVertical(value: string): ComposeLayout["verticalConstraint"] {
  switch (value) {
    case "MIN":
      return undefined;
    case "MAX":
      return "bottom";
    case "CENTER":
      return "center";
    case "STRETCH":
      return "stretch";
    case "SCALE":
      return "scale";
  }
}

// CSS shorthand: "T R B L" → Compose {start, top, end, bottom}
function parsePadding(shorthand: string): ComposeLayout["padding"] {
  const parts = shorthand.split(" ");
  if (parts.length === 1) {
    return { top: parts[0], end: parts[0], bottom: parts[0], start: parts[0] };
  }
  if (parts.length === 2) {
    return { top: parts[0], end: parts[1], bottom: parts[0], start: parts[1] };
  }
  if (parts.length === 3) {
    return { top: parts[0], end: parts[1], bottom: parts[2], start: parts[1] };
  }
  if (parts.length === 4) {
    return { top: parts[0], end: parts[1], bottom: parts[2], start: parts[3] };
  }
  return {};
}
