import type { Node as FigmaDocumentNode } from "@figma/rest-api-spec";
import { isVisible, toImageFileName } from "~/utils/common.js";
import { hasValue } from "~/utils/identity.js";
import type { Style } from "@figma/rest-api-spec";
import type {
  ExtractorFn,
  ImageAsset,
  NodeCounter,
  TraversalContext,
  TraversalOptions,
  TraversalState,
  GlobalVars,
  SimplifiedNode,
} from "./types.js";

// Yield the event loop every N nodes so heartbeats, SIGINT, and
// other async work can run during large file processing.
const YIELD_INTERVAL = 100;

async function maybeYield(counter: NodeCounter): Promise<void> {
  counter.count++;
  if (counter.count % YIELD_INTERVAL === 0) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * Extract data from Figma nodes using a flexible, single-pass approach.
 *
 * @param nodes - The Figma nodes to process
 * @param extractors - Array of extractor functions to apply during traversal
 * @param options - Traversal options (filtering, depth limits, etc.)
 * @param globalVars - Global variables for style deduplication
 * @returns Object containing processed nodes and updated global variables
 */
export async function extractFromDesign(
  nodes: FigmaDocumentNode[],
  extractors: ExtractorFn[],
  options: TraversalOptions = {},
  globalVars: GlobalVars = { styles: {} },
  extraStyles?: Record<string, Style>,
): Promise<{
  nodes: SimplifiedNode[];
  globalVars: GlobalVars;
  traversalState: TraversalState;
}> {
  const context: TraversalContext = {
    globalVars,
    extraStyles,
    currentDepth: 0,
    traversalState: { componentPropertyDefinitions: {}, tsCounter: 0, imageAssets: [] },
    nodeCounter: options.nodeCounter ?? { count: 0 },
  };

  const processedNodes: SimplifiedNode[] = [];
  for (const node of nodes) {
    if (!shouldProcessNode(node, context, options)) continue;
    const result = await processNodeWithExtractors(node, extractors, context, options);
    if (result !== null) processedNodes.push(result);
  }

  return {
    nodes: processedNodes,
    globalVars: context.globalVars,
    traversalState: context.traversalState,
  };
}

/**
 * Process a single node with all provided extractors in one pass.
 */
async function processNodeWithExtractors(
  node: FigmaDocumentNode,
  extractors: ExtractorFn[],
  context: TraversalContext,
  options: TraversalOptions,
): Promise<SimplifiedNode | null> {
  if (!shouldProcessNode(node, context, options)) {
    return null;
  }

  await maybeYield(context.nodeCounter);

  // Always include base metadata
  const result: SimplifiedNode = {
    id: node.id,
    name: node.name,
    type: node.type === "VECTOR" || hasExportSettings(node) ? "IMAGE-PNG" : node.type,
  };

  // Apply all extractors to this node in a single pass
  for (const extractor of extractors) {
    extractor(node, result, context);
  }

  // Handle children recursively
  if (shouldTraverseChildren(node, context, options)) {
    const childContext: TraversalContext = {
      ...context,
      currentDepth: context.currentDepth + 1,
      parent: node,
      // COMPONENT nodes define properties; INSTANCE nodes resolve them
      insideComponentDefinition:
        node.type === "COMPONENT" || node.type === "COMPONENT_SET"
          ? true
          : node.type === "INSTANCE"
            ? false
            : context.insideComponentDefinition,
    };

    // Use the same pattern as the existing parseNode function
    if (hasValue("children", node) && node.children.length > 0) {
      const children: SimplifiedNode[] = [];
      for (const child of node.children) {
        if (!shouldProcessNode(child, childContext, options)) continue;
        const processed = await processNodeWithExtractors(child, extractors, childContext, options);
        if (processed !== null) children.push(processed);
      }

      if (children.length > 0) {
        // Allow custom logic to modify parent and control which children to include
        const childrenToInclude = options.afterChildren
          ? options.afterChildren(node, result, children)
          : children;

        if (childrenToInclude.length > 0) {
          result.children = childrenToInclude;
        }
      }
    }
  }

  // If the node ended up as IMAGE-PNG (from VECTOR → IMAGE-PNG mapping,
  // collapseRasterContainers, or exportSettings), flag it for download
  // so the AI doesn't try to recreate it with code.
  if (result.type === "IMAGE-PNG") {
    const existingIdx = context.traversalState.imageAssets.findIndex(
      (a) => a.nodeId === node.id,
    );
    if (existingIdx === -1) {
      const isExportTagged = hasExportSettings(node);
      context.traversalState.imageAssets.push({
        nodeId: node.id,
        name: node.name,
        category: isExportTagged ? "export-tagged" : "auto-detected",
        reason: isExportTagged ? "node has exportSettings" : "IMAGE-PNG node",
        suggestedFileName: toImageFileName(node.name),
      });
    } else if (hasExportSettings(node)) {
      // visualsExtractor may have already added this node with "contains image fills";
      // exportSettings is the designer's explicit signal and takes priority for both
      // the human-readable reason and the machine-readable category.
      context.traversalState.imageAssets[existingIdx].category = "export-tagged";
      context.traversalState.imageAssets[existingIdx].reason =
        "node has exportSettings";
    }
  }

  return result;
}

/**
 * Determine if a node should be processed based on filters.
 */
function shouldProcessNode(
  node: FigmaDocumentNode,
  context: TraversalContext,
  options: TraversalOptions,
): boolean {
  if (!isVisible(node)) {
    // Rescue hidden nodes controlled by a boolean property inside component definitions
    const hasVisibleRef =
      "componentPropertyReferences" in node &&
      node.componentPropertyReferences &&
      typeof node.componentPropertyReferences === "object" &&
      "visible" in node.componentPropertyReferences;
    if (!(hasVisibleRef && context.insideComponentDefinition)) {
      return false;
    }
  }

  if (options.nodeFilter && !options.nodeFilter(node)) {
    return false;
  }

  return true;
}

function hasExportSettings(node: FigmaDocumentNode): boolean {
  return (
    "exportSettings" in node &&
    Array.isArray(node.exportSettings) &&
    node.exportSettings.length > 0
  );
}

/**
 * Determine if we should traverse into a node's children.
 */
function shouldTraverseChildren(
  node: FigmaDocumentNode,
  context: TraversalContext,
  options: TraversalOptions,
): boolean {
  // Nodes with exportSettings are designer-intended images —
  // don't recurse into children; the whole subtree is one PNG.
  if (hasExportSettings(node)) return false;

  // Check depth limit
  if (options.maxDepth !== undefined && context.currentDepth >= options.maxDepth) {
    return false;
  }

  return true;
}
