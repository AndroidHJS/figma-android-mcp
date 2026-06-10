/**
 * Output-size compression for `get_figma_data` (docs/plan-output-size-limit.md).
 *
 * Complex designs can serialize past the MCP tool-result token limit, at which
 * point the LLM cannot read the design at all. Compression is staged and only
 * applied when the serialized output exceeds the size limit — simple designs
 * pass through untouched:
 *
 *   Stage 1 (lossless)  — drop default/empty fields, inline single-use styles.
 *   Stage 2 (structure) — collapse repeated sibling subtrees, truncate long text.
 *   Stage 3 (lossy)     — strip styling detail from decorative leaves.
 *
 * Invariant across ALL stages: every node's id/name/type stays in the output.
 * The UI-restoration use case cannot tolerate missing widgets; that is why
 * plain depth truncation was rejected (see the plan doc).
 *
 * Everything here operates on deep-cloned plain JSON, never on the
 * SimplifiedDesign the rest of the pipeline owns — compression is a
 * serialization-time concern and must not leak into extractors or mappers.
 */

type JsonNode = Record<string, unknown>;

/** Node fields that reference entries in globalVars.styles by key. */
const STYLE_REF_FIELDS = ["fills", "styles", "strokes", "effects", "layout", "textStyle"] as const;

const MAX_TEXT_LENGTH = 200;

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Stage 1 — lossless
// ---------------------------------------------------------------------------

/** True for values whose presence adds no information for code generation. */
function isDefaultEntry(key: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (key === "opacity" && value === 1) return true;
  if (key === "strokeWeight" && value === "0dp") return true;
  if (key === "borderRadius" && typeof value === "string" && /^0dp( 0dp)*$/.test(value)) {
    return true;
  }
  return false;
}

/** Recursively remove default/empty entries from a plain JSON tree, in place. */
function stripDefaults(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripDefaults(item);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const obj = value as JsonNode;
  for (const key of Object.keys(obj)) {
    if (isDefaultEntry(key, obj[key])) {
      delete obj[key];
      continue;
    }
    stripDefaults(obj[key]);
    // Re-check after recursion: a child object may have emptied out.
    const v = obj[key];
    if (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) {
      delete obj[key];
    }
  }
}

function countStyleRefs(nodes: JsonNode[], counts: Map<string, number>): void {
  for (const node of nodes) {
    for (const field of STYLE_REF_FIELDS) {
      const ref = node[field];
      if (typeof ref === "string") {
        counts.set(ref, (counts.get(ref) ?? 0) + 1);
      }
    }
    if (Array.isArray(node.children)) {
      countStyleRefs(node.children as JsonNode[], counts);
    }
  }
}

function inlineSingleUseStyles(
  nodes: JsonNode[],
  styles: JsonNode,
  singleUse: Set<string>,
): void {
  for (const node of nodes) {
    for (const field of STYLE_REF_FIELDS) {
      const ref = node[field];
      if (typeof ref === "string" && singleUse.has(ref)) {
        node[field] = styles[ref];
        delete styles[ref];
      }
    }
    if (Array.isArray(node.children)) {
      inlineSingleUseStyles(node.children as JsonNode[], styles, singleUse);
    }
  }
}

/**
 * Stage 1: lossless compaction. Mutates the (cloned) tree in place.
 * No widget and no style information is lost — only zero-information bytes.
 */
export function compactDesign(nodes: JsonNode[], globalVars: JsonNode): void {
  stripDefaults(nodes);
  stripDefaults(globalVars);

  const styles = globalVars.styles as JsonNode | undefined;
  if (!styles) return;

  const counts = new Map<string, number>();
  countStyleRefs(nodes, counts);

  const singleUse = new Set<string>();
  for (const key of Object.keys(styles)) {
    if (counts.get(key) === 1) singleUse.add(key);
  }
  if (singleUse.size > 0) {
    inlineSingleUseStyles(nodes, styles, singleUse);
  }
  // Styles never referenced by any surviving node are dead weight.
  for (const key of Object.keys(styles)) {
    if (!counts.has(key)) delete styles[key];
  }
}

// ---------------------------------------------------------------------------
// Stage 2 — structure compression
// ---------------------------------------------------------------------------

/** Minimum subtree size for repeat collapsing — collapsing trivia saves nothing. */
const MIN_REPEAT_SUBTREE_NODES = 3;

function subtreeNodeCount(node: JsonNode): number {
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const child of node.children as JsonNode[]) count += subtreeNodeCount(child);
  }
  return count;
}

/**
 * Structural fingerprint: everything that defines a node's shape and styling,
 * excluding per-instance content (id, name, text) so repeated list items with
 * different copy still match.
 */
function structureSignature(node: JsonNode): string {
  const rest: JsonNode = { ...node };
  delete rest.id;
  delete rest.name;
  delete rest.text;
  delete rest.children;
  const childSigs = Array.isArray(node.children)
    ? (node.children as JsonNode[]).map(structureSignature)
    : [];
  return JSON.stringify({ rest: sortedEntries(rest), childSigs });
}

function sortedEntries(obj: JsonNode): [string, unknown][] {
  return Object.keys(obj)
    .sort()
    .map((k) => [k, obj[k]]);
}

/** All text content in a subtree, in traversal order. */
function collectTexts(node: JsonNode, out: string[]): void {
  if (typeof node.text === "string") out.push(node.text);
  if (Array.isArray(node.children)) {
    for (const child of node.children as JsonNode[]) collectTexts(child, out);
  }
}

/**
 * Stage 2a: collapse consecutive siblings with identical structure. The first
 * occurrence keeps its full subtree; followers shrink to id/name/type plus a
 * `_repeatOf` pointer and their subtree's text content, which is all the LLM
 * needs to instantiate the template per item.
 */
export function collapseRepeats(nodes: JsonNode[]): number {
  let collapsed = 0;

  for (const node of nodes) {
    if (!Array.isArray(node.children)) continue;
    const children = node.children as JsonNode[];

    let i = 0;
    while (i < children.length) {
      const template = children[i];
      const sig = structureSignature(template);
      let j = i + 1;
      while (j < children.length && structureSignature(children[j]) === sig) {
        j++;
      }
      const groupSize = j - i;
      if (groupSize >= 2 && subtreeNodeCount(template) >= MIN_REPEAT_SUBTREE_NODES) {
        for (let k = i + 1; k < j; k++) {
          const texts: string[] = [];
          collectTexts(children[k], texts);
          const replacement: JsonNode = {
            id: children[k].id,
            name: children[k].name,
            type: children[k].type,
            _repeatOf: template.id,
          };
          if (texts.length > 0) replacement.texts = texts;
          children[k] = replacement;
          collapsed++;
        }
      }
      i = j;
    }

    // Recurse into surviving full subtrees (collapsed ones have no children).
    collapsed += collapseRepeats(children.filter((c) => c._repeatOf === undefined));
  }

  return collapsed;
}

/**
 * Stage 2b: truncate text content past MAX_TEXT_LENGTH chars. Handles both
 * `text` and the `texts` arrays on collapsed repeats, so it is correct
 * regardless of whether it runs before or after collapseRepeats.
 */
export function truncateLongTexts(nodes: JsonNode[]): number {
  let truncated = 0;
  const cut = (s: string) => `${s.slice(0, MAX_TEXT_LENGTH)}... [truncated]`;
  for (const node of nodes) {
    if (typeof node.text === "string" && node.text.length > MAX_TEXT_LENGTH) {
      node.text = cut(node.text);
      truncated++;
    }
    if (Array.isArray(node.texts)) {
      node.texts = (node.texts as unknown[]).map((t) => {
        if (typeof t === "string" && t.length > MAX_TEXT_LENGTH) {
          truncated++;
          return cut(t);
        }
        return t;
      });
    }
    if (Array.isArray(node.children)) {
      truncated += truncateLongTexts(node.children as JsonNode[]);
    }
  }
  return truncated;
}

// ---------------------------------------------------------------------------
// Stage 3 — lossy truncation of decorative detail (last resort)
// ---------------------------------------------------------------------------

/** Leaf types whose styling detail is expendable — they ship as images anyway. */
const DECORATIVE_LEAF_TYPES = new Set(["IMAGE-PNG", "RECTANGLE"]);

/**
 * Stage 3: strip everything but id/name/type from decorative leaves, marking
 * them `_truncated: true` so the LLM knows to re-fetch the node for detail.
 * Containers, text, and component instances keep full fidelity.
 */
export function truncateDecorativeDetails(nodes: JsonNode[]): number {
  let truncated = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (Array.isArray(node.children)) {
      truncated += truncateDecorativeDetails(node.children as JsonNode[]);
      continue;
    }
    const type = node.type;
    if (typeof type === "string" && DECORATIVE_LEAF_TYPES.has(type)) {
      const hadDetail = Object.keys(node).length > 3;
      if (hadDetail) {
        nodes[i] = { id: node.id, name: node.name, type: node.type, _truncated: true };
        truncated++;
      }
    }
  }
  return truncated;
}
