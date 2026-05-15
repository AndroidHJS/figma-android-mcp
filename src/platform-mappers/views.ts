import type { SimplifiedLayout } from "~/transformers/layout.js";
import type { ViewsLayout } from "./types.js";

/**
 * Map a CSS-flex `SimplifiedLayout` to Android traditional View XML attributes.
 *
 * Uses standard View layout_* name conventions so output reads naturally
 * alongside XML resource definitions.
 */
export function mapToViews(layout: SimplifiedLayout): ViewsLayout {
  const result: ViewsLayout = {};

  // orientation
  if (layout.mode === "row") {
    result.orientation = "horizontal";
  } else if (layout.mode === "column") {
    result.orientation = "vertical";
  }
  // mode "none" → no container properties

  // gravity — combines justifyContent and alignItems for LinearLayout
  if (layout.mode !== "none") {
    const mainGravity = mapViewsMainGravity(layout.justifyContent);
    const crossGravity = mapViewsCrossGravity(layout.alignItems ?? "flex-start", layout.mode);
    if (mainGravity || crossGravity) {
      result.gravity = [crossGravity, mainGravity]
        .filter(Boolean)
        .join("|");
    }
  }

  // layout_gravity (alignSelf equivalent)
  if (layout.alignSelf) {
    result.layoutGravity = mapViewsSelfGravity(layout.alignSelf, layout.mode);
  }

  // gap
  if (layout.gap) {
    result.gap = layout.gap;
  }

  // padding — CSS shorthand → individual attributes
  if (layout.padding) {
    const p = parsePaddingViews(layout.padding);
    if (p.start) result.paddingStart = p.start;
    if (p.top) result.paddingTop = p.top;
    if (p.end) result.paddingEnd = p.end;
    if (p.bottom) result.paddingBottom = p.bottom;
  }

  // width / height
  if (layout.sizing) {
    result.layout_width = mapViewsSizing(layout.sizing.horizontal, layout.dimensions?.width);
    result.layout_height = mapViewsSizing(layout.sizing.vertical, layout.dimensions?.height);
  } else if (layout.dimensions?.width || layout.dimensions?.height) {
    result.layout_width = layout.dimensions.width;
    result.layout_height = layout.dimensions.height;
  }

  // aspectRatio
  if (layout.dimensions?.aspectRatio) {
    result.aspectRatio = layout.dimensions.aspectRatio;
  }

  // scroll
  if (layout.overflowScroll?.length) {
    result.scroll = mapViewsScroll(layout.overflowScroll);
  }

  // absolute positioning
  if (layout.position === "absolute") {
    result.position = "absolute";
  }
  if (layout.locationRelativeToParent) {
    result.layout_marginStart = layout.locationRelativeToParent.x;
    result.layout_marginTop = layout.locationRelativeToParent.y;
  }

  // wrap
  if (layout.wrap) {
    result.isFlow = true;
  }

  // constraints (non-AutoLayout positioning)
  if (layout.constraints) {
    result.layout_constraintHorizontal = mapViewsConstraintHorizontal(layout.constraints.horizontal);
    result.layout_constraintVertical = mapViewsConstraintVertical(layout.constraints.vertical);
  }

  return result;
}

function mapViewsMainGravity(value: string | undefined): string | undefined {
  switch (value) {
    case "flex-start":
      return undefined; // default
    case "flex-end":
      return "end";
    case "center":
      return "center";
    default:
      return undefined;
  }
}

function mapViewsCrossGravity(value: string, mode: "none" | "row" | "column"): string | undefined {
  const isHorizontal = mode === "row";

  switch (value) {
    case "flex-start":
      return undefined; // default
    case "flex-end":
      return isHorizontal ? "bottom" : "end";
    case "center":
      return isHorizontal ? "center_vertical" : "center_horizontal";
    default:
      return undefined;
  }
}

function mapViewsSelfGravity(
  value: string,
  mode: "none" | "row" | "column",
): string | undefined {
  const isHorizontal = mode === "row";

  switch (value) {
    case "flex-start":
      return isHorizontal ? "top" : "start";
    case "flex-end":
      return isHorizontal ? "bottom" : "end";
    case "center":
      return "center";
    default:
      return undefined;
  }
}

function mapViewsSizing(
  sizing: string | undefined,
  dimension: string | undefined,
): ViewsLayout["layout_width"] {
  if (sizing === "fill") return "match_parent";
  if (sizing === "hug") return "wrap_content";
  if (dimension) return dimension;
  return undefined;
}

function mapViewsScroll(overflow: ("x" | "y")[]): ViewsLayout["scroll"] {
  if (overflow.includes("x") && overflow.includes("y")) return "both";
  if (overflow.includes("x")) return "horizontal";
  return "vertical";
}

function mapViewsConstraintHorizontal(value: string): ViewsLayout["layout_constraintHorizontal"] {
  switch (value) {
    case "MIN":
      return undefined;
    case "MAX":
      return "right";
    case "CENTER":
      return "center";
    case "STRETCH":
      return "stretch";
    case "SCALE":
      return "scale";
  }
}

function mapViewsConstraintVertical(value: string): ViewsLayout["layout_constraintVertical"] {
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

// Parse CSS shorthand into individual padding values
function parsePaddingViews(shorthand: string): {
  start?: string;
  top?: string;
  end?: string;
  bottom?: string;
} {
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
