import type { SimplifiedNode } from "~/extractors/types.js";

/**
 * INSTANCE override processing.
 *
 * The Figma API reports, per instance, which descendant nodes deviate from
 * the component definition and in which fields (`overrides`). Without this,
 * every instance serializes as a full subtree indistinguishable from its
 * siblings — the LLM cannot tell "this dropdown customized its placeholder"
 * from "this is just what the component looks like", and five instances of
 * one component cost five full subtrees of output.
 *
 * Two transformations, applied per instance:
 *
 *  1. ANNOTATE — overridden descendants get `overridden: [fields]`, and the
 *     instance's `overrides` list is enriched with the resolved text value
 *     for character overrides (the single most common case: same component,
 *     different copy).
 *
 *  2. PRUNE (conditional) — when the component's DEFINITION node is present
 *     in the same fetched tree, the instance's children are reduced to the
 *     branches that contain overridden nodes and the instance is marked
 *     `prunedToOverrides: true`: structure lives in the definition, the
 *     instance carries only its diffs. When the definition is NOT in the
 *     tree (it lives on another page), nothing is pruned — hiding children
 *     with no definition to fall back on would destroy the only structural
 *     source the LLM has.
 */

/** Figma raw field names → simplified-output field names. */
const FIELD_NAMES: Record<string, string> = {
  characters: "text",
  cornerRadius: "borderRadius",
  rectangleCornerRadii: "borderRadius",
  style: "textStyle",
};

export interface InstanceOverride {
  nodeId: string;
  fields: string[];
  /** Resolved text content when the override includes `text`. */
  text?: string;
}

function mapFields(fields: string[]): string[] {
  return fields.map((f) => FIELD_NAMES[f] ?? f);
}

/** Collect ids of COMPONENT definition nodes present in the fetched tree. */
function collectComponentDefinitionIds(nodes: SimplifiedNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.type === "COMPONENT") out.add(node.id);
    if (node.children) collectComponentDefinitionIds(node.children, out);
  }
}

function findById(nodes: SimplifiedNode[], id: string): SimplifiedNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const hit = findById(node.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Mark overridden descendants; returns true if any annotation landed. */
function annotateDescendants(
  children: SimplifiedNode[],
  byId: Map<string, string[]>,
): boolean {
  let any = false;
  for (const node of children) {
    const fields = byId.get(node.id);
    if (fields) {
      node.overridden = fields;
      any = true;
    }
    if (node.children) {
      any = annotateDescendants(node.children, byId) || any;
    }
  }
  return any;
}

/** Keep only branches that contain overridden nodes (or nested overriding instances). */
function pruneToOverridden(children: SimplifiedNode[]): SimplifiedNode[] {
  const kept: SimplifiedNode[] = [];
  for (const child of children) {
    const keptGrandchildren = child.children ? pruneToOverridden(child.children) : [];
    const selfRelevant = child.overridden !== undefined || child.overrides !== undefined;
    if (selfRelevant || keptGrandchildren.length > 0) {
      if (child.children) {
        if (keptGrandchildren.length > 0) child.children = keptGrandchildren;
        else delete child.children;
      }
      kept.push(child);
    }
  }
  return kept;
}

/**
 * Process all INSTANCE nodes in the tree. Mutates nodes in place.
 * Runs before overlay detection and layout inference — pruning changes the
 * child sets those passes reason about.
 */
export function processInstanceOverrides(nodes: SimplifiedNode[]): void {
  const definitionIds = new Set<string>();
  collectComponentDefinitionIds(nodes, definitionIds);
  walk(nodes, definitionIds);
}

function walk(nodes: SimplifiedNode[], definitionIds: Set<string>): void {
  for (const node of nodes) {
    if (node.type === "INSTANCE" && node.overrides && node.overrides.length > 0) {
      processInstance(node, definitionIds);
    }
    if (node.children) walk(node.children, definitionIds);
  }
}

function processInstance(instance: SimplifiedNode, definitionIds: Set<string>): void {
  const overrides = instance.overrides!;
  const byId = new Map<string, string[]>();
  for (const o of overrides) {
    byId.set(o.nodeId, mapFields(o.fields));
  }

  if (instance.children) {
    annotateDescendants(instance.children, byId);
  }

  // Enrich the summary with resolved values — text is the high-value one.
  for (const o of overrides) {
    o.fields = mapFields(o.fields);
    if (o.fields.includes("text") && instance.children) {
      const target = findById(instance.children, o.nodeId);
      if (target?.text !== undefined) o.text = target.text;
    }
  }

  // Prune only when the definition is available as a structural fallback.
  if (instance.componentId && definitionIds.has(instance.componentId) && instance.children) {
    const before = countNodes(instance.children);
    const pruned = pruneToOverridden(instance.children);
    if (pruned.length > 0) instance.children = pruned;
    else delete instance.children;
    if (countNodes(instance.children ?? []) < before) {
      instance.prunedToOverrides = true;
    }
  }
}

function countNodes(nodes: SimplifiedNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n++;
    if (node.children) n += countNodes(node.children);
  }
  return n;
}
