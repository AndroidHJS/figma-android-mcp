import type { GlobalVars, SimplifiedNode } from "~/extractors/types.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";
import { parseDp } from "~/transformers/layout.js";

/**
 * Overlay semantics detection — toasts and dialogs baked into static designs.
 *
 * Designers paint transient UI directly into frames: a toast pill floating
 * over a form, or a modal sheet on top of a dimmed copy of another page.
 * Restored literally, the toast becomes a permanently-visible block and the
 * dimmed backdrop gets re-implemented as duplicate static content. Both are
 * semantic errors no amount of styling fidelity can fix, and the overlay
 * nodes also poison structure inference (a toast floating mid-form breaks
 * column detection for the whole frame).
 *
 * Detection is multi-signal with graded confidence — layer names score high
 * but are never required, and when neither names nor visual structure are
 * conclusive NOTHING is touched: a missed overlay degrades to today's
 * behavior, a false positive destroys real content. Err toward missing.
 *
 * Scope: only direct children of each top-level frame are examined. Overlays
 * live at the screen level in practice; scanning deeper trades precision for
 * recall we don't need yet.
 */

export interface OverlayInfo {
  nodeId: string;
  name: string;
  kind: "toast" | "dialog";
  confidence: "high" | "medium";
  /** Dialog only: geometry-derived presentation style. */
  presentation?: "bottomSheet" | "centerDialog";
  /** Dialog only: fill of the removed scrim layer, e.g. "rgba(0,0,0,0.4)". */
  scrim?: string;
  /** Dialog only: backdrop content removed from the output (z-below the scrim). */
  strippedBackdrop?: { nodeIds: string[]; names: string[] };
}

const TOAST_NAME = /toast|snack|轻提示|提示|tips?\b|气泡/i;
const DIALOG_NAME = /dialog|modal|sheet|popup|弹窗|弹层|浮层|蒙层|遮罩|抽屉/i;

/** Max share of parent width/height for a toast candidate. */
const TOAST_MAX_W_RATIO = 0.85;
const TOAST_MAX_H_RATIO = 0.15;
/** Horizontal-center tolerance (dp) for toast candidates. */
const TOAST_CENTER_TOLERANCE = 8;
/** Relative luminance below which a fill counts as "dark". */
const DARK_LUMINANCE = 0.35;
/** Min share of parent area a scrim must cover. */
const SCRIM_COVERAGE = 0.9;

interface NodeGeom {
  node: SimplifiedNode;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  layout: SimplifiedLayout;
}

interface FillColor {
  luminance: number;
  alpha: number;
  raw: string;
}

function parseColor(value: string): FillColor | undefined {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return { luminance: (0.299 * r + 0.587 * g + 0.114 * b) / 255, alpha: 1, raw: value };
  }
  const rgba = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(
    value.trim(),
  );
  if (rgba) {
    const [, r, g, b, a] = rgba;
    return {
      luminance: (0.299 * +r + 0.587 * +g + 0.114 * +b) / 255,
      alpha: a !== undefined ? parseFloat(a) : 1,
      raw: value,
    };
  }
  return undefined;
}

/** First solid color of a node's fill style, resolved through globalVars. */
function resolveSolidFill(node: SimplifiedNode, globalVars: GlobalVars): FillColor | undefined {
  if (!node.fills) return undefined;
  const style = globalVars.styles[node.fills];
  // A fill style may be inlined (array) — both shapes occur in the pipeline.
  const fills = Array.isArray(style) ? style : undefined;
  if (!fills) return undefined;
  for (const fill of fills) {
    if (typeof fill === "string") {
      const color = parseColor(fill);
      if (color) return color;
    }
  }
  return undefined;
}

function geomOf(node: SimplifiedNode, index: number, globalVars: GlobalVars): NodeGeom | undefined {
  if (!node.layout) return undefined;
  const layout = globalVars.styles[node.layout] as SimplifiedLayout | undefined;
  if (!layout?.locationRelativeToParent) return undefined;
  const x = parseDp(layout.locationRelativeToParent.x);
  const y = parseDp(layout.locationRelativeToParent.y);
  const width = parseDp(layout.dimensions?.width);
  const height = parseDp(layout.dimensions?.height);
  if (x === undefined || y === undefined || !width || !height) return undefined;
  return { node, index, x, y, width, height, layout };
}

function firstRadius(node: SimplifiedNode): number {
  if (!node.borderRadius) return 0;
  return parseDp(node.borderRadius.split(" ")[0]) ?? 0;
}

/**
 * Detect overlays in each top-level frame and process them:
 *  - toasts are marked (`overlayRole: "toast"`) but kept in the tree;
 *  - dialog scrims and the backdrop content BELOW them (z-order) are removed,
 *    remaining children are marked `overlayRole: "dialog"`.
 * Marked nodes are skipped by layout inference, anchor inference, and region
 * hints (see their collectors). Returns the overlay descriptions to emit.
 */
export function detectAndProcessOverlays(
  nodes: SimplifiedNode[],
  globalVars: GlobalVars,
): OverlayInfo[] {
  const overlays: OverlayInfo[] = [];
  for (const root of nodes) {
    if (!root.children || root.children.length < 2) continue;
    const rootLayout = root.layout
      ? (globalVars.styles[root.layout] as SimplifiedLayout | undefined)
      : undefined;
    const pw = parseDp(rootLayout?.dimensions?.width);
    const ph = parseDp(rootLayout?.dimensions?.height);
    if (!pw || !ph) continue;

    const dialog = processDialog(root, pw, ph, globalVars);
    if (dialog) overlays.push(dialog);

    overlays.push(...detectToasts(root, pw, ph, globalVars));
  }
  return overlays;
}

// ---------------------------------------------------------------------------
// Dialog: scrim split
// ---------------------------------------------------------------------------

function isScrim(
  g: NodeGeom,
  pw: number,
  ph: number,
  globalVars: GlobalVars,
  frameNameHit: boolean,
): boolean {
  if (g.width < SCRIM_COVERAGE * pw || g.height < SCRIM_COVERAGE * ph) return false;
  if (g.node.children && g.node.children.length > 0) return false;
  const color = resolveSolidFill(g.node, globalVars);
  if (!color || color.luminance > DARK_LUMINANCE) return false;
  // Semi-transparency alone is conclusive; an opaque dark sheet needs a name
  // signal (its own or the frame's) — a solid dark full-frame rect is
  // otherwise just a page background.
  if (color.alpha < 0.95) return true;
  return DIALOG_NAME.test(g.node.name) || frameNameHit;
}

function processDialog(
  root: SimplifiedNode,
  pw: number,
  ph: number,
  globalVars: GlobalVars,
): OverlayInfo | undefined {
  const children = root.children!;
  const geoms = children
    .map((c, i) => geomOf(c, i, globalVars))
    .filter((g): g is NodeGeom => g !== undefined);

  const frameNameHit = DIALOG_NAME.test(root.name);
  const scrim = geoms.find((g) => isScrim(g, pw, ph, globalVars, frameNameHit));
  if (!scrim) return undefined;

  const above = children.slice(scrim.index + 1);
  if (above.length === 0) return undefined; // nothing to present — don't touch

  // The dialog body: largest node above the scrim.
  const aboveGeoms = above
    .map((c, i) => geomOf(c, scrim.index + 1 + i, globalVars))
    .filter((g): g is NodeGeom => g !== undefined);
  const body = aboveGeoms.reduce<NodeGeom | undefined>(
    (best, g) => (!best || g.width * g.height > best.width * best.height ? g : best),
    undefined,
  );
  if (!body) return undefined;

  const below = children.slice(0, scrim.index);
  const scrimColor = resolveSolidFill(scrim.node, globalVars);

  // Mutate: drop backdrop + scrim, keep dialog content, mark it.
  root.children = above;
  for (const c of above) c.overlayRole = "dialog";

  const reachesBottom = body.y + body.height >= 0.95 * ph;
  const presentation: OverlayInfo["presentation"] =
    reachesBottom && body.width >= 0.9 * pw ? "bottomSheet" : "centerDialog";

  const info: OverlayInfo = {
    nodeId: body.node.id,
    name: body.node.name,
    kind: "dialog",
    confidence: frameNameHit ? "high" : "medium",
    presentation,
  };
  if (scrimColor) info.scrim = scrimColor.raw;
  if (below.length > 0) {
    info.strippedBackdrop = {
      nodeIds: below.map((c) => c.id),
      names: below.map((c) => c.name),
    };
  }
  return info;
}

// ---------------------------------------------------------------------------
// Toast detection
// ---------------------------------------------------------------------------

function detectToasts(
  root: SimplifiedNode,
  pw: number,
  ph: number,
  globalVars: GlobalVars,
): OverlayInfo[] {
  const children = root.children!;
  const result: OverlayInfo[] = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.overlayRole) continue;
    // TEXT fills are text color — a dark label named "提示" is a caption,
    // not a toast container.
    if (child.type === "TEXT") continue;
    const g = geomOf(child, i, globalVars);
    if (!g) continue;

    const nameHit = TOAST_NAME.test(child.name);

    const small = g.width <= TOAST_MAX_W_RATIO * pw && g.height <= TOAST_MAX_H_RATIO * ph;
    if (!small) continue; // hard requirement either way — a huge "toast" is something else

    const color = resolveSolidFill(child, globalVars);
    const dark = color !== undefined && color.luminance <= DARK_LUMINANCE;
    const pill = firstRadius(child) >= g.height / 3;
    const centered = Math.abs(g.x + g.width / 2 - pw / 2) <= TOAST_CENTER_TOLERANCE;
    const topZ = i >= children.length - 2;

    const visualScore = [dark, pill, centered, topZ].filter(Boolean).length;

    let confidence: OverlayInfo["confidence"] | undefined;
    if (nameHit && visualScore >= 2) confidence = "high";
    else if (nameHit) confidence = "medium";
    else if (visualScore === 4) confidence = "medium"; // visual-only must be unanimous
    if (!confidence) continue;

    child.overlayRole = "toast";
    result.push({ nodeId: child.id, name: child.name, kind: "toast", confidence });
  }
  return result;
}
