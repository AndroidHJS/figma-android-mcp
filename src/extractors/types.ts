import type { Node as FigmaDocumentNode, Style } from "@figma/rest-api-spec";
import type { SimplifiedTextStyle } from "~/transformers/text.js";
import type { SimplifiedLayout } from "~/transformers/layout.js";
import type { SimplifiedFill, SimplifiedStroke } from "~/transformers/style.js";
import type { SimplifiedEffects } from "~/transformers/effects.js";
import type {
  SimplifiedComponentDefinition,
  SimplifiedComponentSetDefinition,
  SimplifiedPropertyDefinition,
} from "~/transformers/component.js";

export type StyleTypes =
  | SimplifiedTextStyle
  | SimplifiedFill[]
  | SimplifiedLayout
  | SimplifiedStroke
  | SimplifiedEffects
  | string;

export type GlobalVars = {
  styles: Record<string, StyleTypes>;
};

export interface TraversalContext {
  globalVars: GlobalVars;
  extraStyles?: Record<string, Style>;
  currentDepth: number;
  parent?: FigmaDocumentNode;
  insideComponentDefinition?: boolean;
  traversalState: TraversalState;
  /**
   * Per-call mutable counter shared with the caller. Lives on the context so
   * walker recursion can increment it without touching module-global state —
   * concurrent extractFromDesign calls (e.g. overlapping HTTP requests) each
   * own their counter and never collide.
   */
  nodeCounter: NodeCounter;
}

/**
 * Mutable progress counter passed into traversal. Callers can read `count`
 * during traversal (for live progress indicators) and after it returns
 * (as the final node-walked metric).
 */
export type NodeCounter = { count: number };

export interface ImageAsset {
  nodeId: string;
  name: string;
  /**
   * Coarse grouping that callers can act on without parsing the free-form `reason`.
   * `export-tagged` = designer-marked Export Settings (must ship as an asset).
   * `auto-detected` = vectors / image fills the walker inferred could be PNGs.
   */
  category: "export-tagged" | "auto-detected";
  reason: "IMAGE-PNG node" | "contains image fills" | "node has exportSettings";
  suggestedFileName: string;
}

export interface TraversalState {
  componentPropertyDefinitions: Record<string, Record<string, SimplifiedPropertyDefinition>>;
  /**
   * Sequential counter for inline text-style override IDs (`ts1`, `ts2`, ...).
   * Lives on the traversal state so every text node in a run shares the same
   * namespace, which lets `{tsN}…{/tsN}` references appear inline in text
   * content with short, readable identifiers.
   */
  tsCounter: number;
  /**
   * Nodes that should be downloaded as PNG images via `download_figma_images`
   * rather than recreated with code. Collected during traversal so the AI sees
   * a clear "download these before writing code" checklist.
   */
  imageAssets: ImageAsset[];
}

export interface TraversalOptions {
  maxDepth?: number;
  nodeFilter?: (node: FigmaDocumentNode) => boolean;
  /**
   * Called after children are processed, allowing modification of the parent node
   * and control over which children to include in the output.
   *
   * @param node - Original Figma node
   * @param result - SimplifiedNode being built (can be mutated)
   * @param children - Processed children
   * @returns Children to include (return empty array to omit children)
   */
  afterChildren?: (
    node: FigmaDocumentNode,
    result: SimplifiedNode,
    children: SimplifiedNode[],
  ) => SimplifiedNode[];
  /**
   * Optional caller-supplied counter. The walker increments it as it processes
   * nodes, so callers that need a live readout (e.g. progress heartbeats) or a
   * post-call metric can read from the same object. If omitted, the walker
   * creates its own internal counter.
   */
  nodeCounter?: NodeCounter;
  /**
   * Figma file key of the design being simplified. Used to record the
   * resolved density divisor per file so a later `download_figma_images`
   * call can compute correct PNG scales without relying on leftover state
   * from a previous request.
   */
  fileKey?: string;
}

/**
 * An extractor function that can modify a SimplifiedNode during traversal.
 *
 * @param node - The current Figma node being processed
 * @param result - SimplifiedNode object being built—this can be mutated inside the extractor
 * @param context - Traversal context including globalVars and parent info. This can also be mutated inside the extractor.
 */
export type ExtractorFn = (
  node: FigmaDocumentNode,
  result: SimplifiedNode,
  context: TraversalContext,
) => void;

export interface ScreenDimensions {
  width: string;
  height: string;
}

export interface SimplifiedDesign {
  name: string;
  /** Design canvas dimensions extracted from the root node. Only present for nodeId-based fetches. */
  screen?: ScreenDimensions;
  nodes: SimplifiedNode[];
  components: Record<string, SimplifiedComponentDefinition>;
  componentSets: Record<string, SimplifiedComponentSetDefinition>;
  globalVars: GlobalVars;
  /** Nodes that should be downloaded as PNG — call `download_figma_images` with these nodeIds before writing code. */
  imageAssets: ImageAsset[];
}

export interface SimplifiedNode {
  id: string;
  name: string;
  type: string; // e.g. FRAME, TEXT, INSTANCE, RECTANGLE, etc.
  // text
  text?: string;
  textStyle?: string;
  /**
   * The numeric font weight that `**bold**` inside `text` maps to. Only emitted
   * when a text node has per-character bold overrides heavier than its base
   * `style.fontWeight`, so the consumer knows how to realize markdown bold.
   */
  boldWeight?: number;
  // appearance
  fills?: string;
  styles?: string;
  strokes?: string;
  // Non-stylable stroke properties are kept on the node when stroke uses a named color style
  strokeWeight?: string;
  strokeDashes?: number[];
  strokeWeights?: string;
  effects?: string;
  opacity?: number;
  borderRadius?: string;
  // layout & alignment
  layout?: string;
  componentId?: string;
  componentProperties?: Record<string, boolean | string>;
  componentPropertyReferences?: Record<string, string>;
  // children
  children?: SimplifiedNode[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
