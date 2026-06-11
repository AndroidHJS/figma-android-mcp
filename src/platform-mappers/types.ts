/** Platforms supported by the layout mapper. */
export type Platform = "compose" | "views";

export interface ComposeLayout {
  layout?: "Row" | "Column";
  arrangement?: "Start" | "End" | "Center" | "SpaceBetween" | "SpaceAround" | "SpaceEvenly";
  /** Context-dependent: Row→"Top"|"CenterVertically"|"Bottom"|"Stretch"|"Baseline", Column→"Start"|"CenterHorizontally"|"End"|"Stretch"|"Baseline" */
  alignment?: string;
  /** Context-dependent: Row→"Top"|"Bottom"|"Center"|"Stretch", Column→"Start"|"End"|"Center"|"Stretch" */
  selfAlignment?: string;
  spacing?: string;
  padding?: ComposePadding;
  width?: "fillMax" | "wrapContent" | string;
  height?: "fillMax" | "wrapContent" | string;
  aspectRatio?: number;
  position?: "absolute";
  offset?: ComposeOffset;
  /** Server-inferred Box alignment for absolutely-positioned children, e.g. "BottomEnd". Use Modifier.align(Alignment.<value>) + padding(anchorMargin) instead of offset. */
  anchorAlignment?: string;
  /** Insets from the anchored edges, to apply as padding alongside anchorAlignment. Always non-negative. */
  anchorMargin?: ComposePadding;
  /**
   * How far the child visibly extends PAST the parent's edge(s), dp
   * (positive values). Split out of anchorMargin because Compose padding
   * crashes on negatives. Restore via the overhang policy (transparent-root
   * restructure) — never as negative padding/offset hacks.
   */
  anchorOverhang?: ComposePadding;
  scroll?: "horizontal" | "vertical" | "both";
  wrap?: true;
  /** Non-AutoLayout constraint: how this node anchors/responds to parent resizing. */
  horizontalConstraint?: "start" | "end" | "center" | "stretch" | "scale";
  verticalConstraint?: "top" | "bottom" | "center" | "stretch" | "scale";
}

export interface ComposePadding {
  start?: string;
  top?: string;
  end?: string;
  bottom?: string;
}

export interface ComposeOffset {
  x: string;
  y: string;
}

export interface ViewsLayout {
  orientation?: "horizontal" | "vertical";
  /** Combined gravity value, e.g. "center_vertical|end" */
  gravity?: string;
  /**
   * Main-axis distribution that LinearLayout gravity cannot express.
   * "spaceBetween" → translate to weight-based spacers or a ConstraintLayout
   * chain (spread_inside); dropping it silently was a major fidelity loss.
   */
  mainAxisArrangement?: "spaceBetween";
  /**
   * Cross-axis alignment that LinearLayout gravity cannot express.
   * "stretch" → children fill the cross axis (match_parent on that axis);
   * "baseline" → text baseline alignment in a horizontal LinearLayout.
   */
  crossAxisAlignment?: "stretch" | "baseline";
  /** Layout gravity for the element itself (alignSelf equivalent) */
  layoutGravity?: string;
  gap?: string;
  paddingStart?: string;
  paddingTop?: string;
  paddingEnd?: string;
  paddingBottom?: string;
  layout_width?: "match_parent" | "wrap_content" | string;
  layout_height?: "match_parent" | "wrap_content" | string;
  aspectRatio?: number;
  position?: "absolute";
  layout_marginStart?: string;
  layout_marginTop?: string;
  layout_marginEnd?: string;
  layout_marginBottom?: string;
  /**
   * How far the child visibly extends PAST the parent's edge(s), dp
   * (positive values). Split out of layout_margin* because negative margins
   * get clipped by default (clipChildren) and clip-disabling chains are
   * fragile. Restore via the overhang policy (transparent-root restructure).
   */
  anchorOverhang?: { start?: string; top?: string; end?: string; bottom?: string };
  scroll?: "horizontal" | "vertical" | "both";
  isFlow?: true;
  /** Non-AutoLayout constraint: how this node anchors/responds to parent resizing. */
  layout_constraintHorizontal?: "start" | "end" | "center" | "stretch" | "scale";
  layout_constraintVertical?: "top" | "bottom" | "center" | "stretch" | "scale";
}

export type PlatformLayout = ComposeLayout | ViewsLayout;
