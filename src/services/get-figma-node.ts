import type { GetFileNodesResponse } from "@figma/rest-api-spec";
import { FigmaService } from "~/services/figma.js";
import type { Platform } from "~/platform-mappers/index.js";
import type { Skill } from "~/skills/types.js";
import {
  getFigmaData,
  type GetFigmaDataOutcome,
  type SimplifyProgress,
} from "~/services/get-figma-data.js";
import { getFigmaSectionFromRaw } from "~/services/get-figma-section.js";

export type RawNodeResult = { data: GetFileNodesResponse; rawSize: number };

export type GetFigmaNodeInput = {
  fileKey: string;
  nodeId: string;
  depth?: number;
  /** Only honored for SECTION nodes — forces manifest output regardless of frame count. */
  manifestOnly?: boolean;
  /** Pre-fetched raw node response — skips the internal getRawNode call. */
  preloadedRaw?: RawNodeResult;
};

/**
 * Hooks for the node pipeline. Fetch is owned by this service (unlike
 * getFigmaData, whose fetch hooks would double-fire on a preloaded raw), so the
 * service exposes its own `onFetched`/`onRouted` and forwards only the
 * simplify/serialize/complete hooks down to the FRAME path.
 */
export type GetFigmaNodeHooks = {
  /** Fires after the raw node response is available (fetched or preloaded). */
  onFetched?: () => void | Promise<void>;
  /** Fires once the root node type is known, before routing. */
  onRouted?: (rootType: string | undefined) => void | Promise<void>;
  onSimplifyStart?: (progress: SimplifyProgress) => void | Promise<void>;
  onSimplifyComplete?: () => void | Promise<void>;
  onSerializeStart?: () => void | Promise<void>;
  /** Fires once the FRAME pipeline completes. Not fired for the SECTION path. */
  onComplete?: (outcome: GetFigmaDataOutcome) => void;
};

export type GetFigmaNodeResult = {
  formatted: string;
  /** Root node type as reported by Figma (e.g. "SECTION", "FRAME"); "UNKNOWN" if absent. */
  rootType: string;
  /** The raw node response, exposed so callers can derive previews without re-fetching. */
  raw: RawNodeResult;
};

/**
 * Unified entry point for a single Figma node: fetch the raw response once,
 * detect the root node type, and route to the matching pipeline — the section
 * pipeline for SECTION nodes, the standard data pipeline otherwise.
 *
 * This is the shared core behind both the `get_figma_node` MCP tool and the
 * `fetch` CLI command; keeping the routing here is what keeps their output
 * identical for the same node. Transport-specific concerns (progress
 * heartbeats, preview screenshots, MCP error envelopes) stay in the callers.
 */
export async function getFigmaNode(
  figmaService: FigmaService,
  input: GetFigmaNodeInput,
  outputFormat: "yaml" | "json",
  outputPlatform: Platform,
  hooks: GetFigmaNodeHooks = {},
  skills?: Skill[],
): Promise<GetFigmaNodeResult> {
  const { fileKey, nodeId, depth, manifestOnly } = input;

  const raw: RawNodeResult =
    input.preloadedRaw ?? (await figmaService.getRawNode(fileKey, nodeId, depth));
  await hooks.onFetched?.();

  const rootEntry = Object.values(raw.data.nodes ?? {})[0];
  const rootType = (rootEntry?.document as Record<string, unknown> | undefined)?.type as
    | string
    | undefined;
  await hooks.onRouted?.(rootType);

  if (rootType === "SECTION") {
    const { formatted } = await getFigmaSectionFromRaw(
      raw.data,
      { fileKey, sectionNodeId: nodeId, depth, manifestOnly },
      outputFormat,
      outputPlatform,
      skills,
    );
    return { formatted, rootType, raw };
  }

  // FRAME / COMPONENT / other → standard pipeline. The raw response is passed
  // through as preloadedRaw, so getFigmaData's own fetch hooks are deliberately
  // left unset here to avoid firing fetch progress twice.
  const { formatted } = await getFigmaData(
    figmaService,
    { fileKey, nodeId, depth, preloadedRaw: raw },
    outputFormat,
    outputPlatform,
    {
      onSimplifyStart: hooks.onSimplifyStart,
      onSimplifyComplete: hooks.onSimplifyComplete,
      onSerializeStart: hooks.onSerializeStart,
      onComplete: hooks.onComplete,
    },
    skills,
  );
  return { formatted, rootType: rootType ?? "UNKNOWN", raw };
}
