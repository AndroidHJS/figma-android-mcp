import type { GetFileResponse, GetFileNodesResponse } from "@figma/rest-api-spec";
import { FigmaService } from "~/services/figma.js";
import {
  simplifyRawFigmaObject,
  allExtractors,
  collapseRasterContainers,
} from "~/extractors/index.js";
import { writeLogs } from "~/utils/logger.js";
import { serializeResult } from "~/utils/serialize.js";
import { tagError } from "~/utils/error-meta.js";
import { isSystemUi } from "~/utils/common.js";
import {
  type GetFigmaDataMetrics,
  measureSimplifiedDesign,
  countNamedStyles,
  detectVariables,
} from "~/services/get-figma-data-metrics.js";
import { type Platform, mapLayoutStyles } from "~/platform-mappers/index.js";
import type { Skill } from "~/skills/types.js";
import {
  inferAutoLayoutFromPositions,
  convertFixedChildrenToFillMax,
} from "~/transformers/layout.js";
import { generateRegionHints } from "~/transformers/region-hints.js";

export type { GetFigmaDataMetrics } from "~/services/get-figma-data-metrics.js";

function generateLayoutHints(screen: { width: string; height: string }, platform: Platform): string[] {
  const w = screen.width;
  const h = screen.height;
  const wNum = parseFloat(w);
  const hNum = parseFloat(h);

  if (platform === "views") {
    return [
      `Screen dimensions: ${w} wide x ${h} tall. Treat this as the baseline design size.`,
      `When node width equals ${w}: Use layout_width="match_parent" instead of layout_width="${wNum}dp".`,
      `When node width does NOT equal ${w}: Use the dp value as-is (e.g., layout_width="343dp").`,
      `When node height equals ${h}: Use layout_height="match_parent" instead of layout_height="${hNum}dp".`,
      `When node height does NOT equal ${h}: Use the dp value as-is.`,
      `When both equal screen dimensions: Use layout_width="match_parent" layout_height="match_parent".`,
      `For content centered in a parent and narrower than the parent: Use layout_gravity="center" layout_width="match_parent" with paddingLeft/paddingRight instead of layout_width="Wdp" + layout_gravity="center", where padding = (parentWidth - childWidth) / 2.`,
      `Parent container: Use FrameLayout as the root container. Child views are positioned via layout_marginStart/layout_marginTop.`,
      `CRITICAL — ConstraintLayout usage: ONLY add app:layout_constraint* attributes when the node's layout data explicitly contains layout_constraintHorizontal or layout_constraintVertical. If these keys are absent from the layout, place the View in a FrameLayout using ONLY layout_width, layout_height, layout_marginStart, and layout_marginTop — never add ConstraintLayout attributes to such nodes.`,
      `Centering without ConstraintLayout: When a node has layout_constraintHorizontal: "center" but no other constraint keys, use android:layout_gravity="center_horizontal" inside a FrameLayout instead of ConstraintLayout.`,
      `FILL CHILD IN HORIZONTAL LINEARLAYOUT: When a child inside a LinearLayout with orientation="horizontal" has layout_width="match_parent" or fill sizing, use android:layout_width="0dp" android:layout_weight="1" instead.`,
      `RIGHT-ANCHORED ELEMENTS: When a node has layout_constraintHorizontal: "MAX", in a FrameLayout use android:layout_gravity="end" with android:layout_marginEnd="Ndp". Do NOT use a fixed width + marginStart to simulate right-alignment.`,
      `Effects — NEVER use android:elevation: boxShadow values use CSS box-shadow syntax (offsetX offsetY blur spread color). They MUST be implemented as Android drawable resources (<layer-list> with <shape> for the shadow layer), not as android:elevation. Specifically: a negative Y offset (e.g., 0dp -3dp ...) means the shadow casts UPWARD — elevation cannot express this. If you are unsure how to convert a boxShadow to a drawable, skip the shadow entirely rather than using elevation.`,
    ];
  }

  return [
    `Screen dimensions: ${w} wide x ${h} tall. Treat this as the baseline design size.`,
    `When node width equals ${w} (screen width): Use .fillMaxWidth() instead of .width(${wNum}.dp).`,
    `When node width does NOT equal ${w}: Use the dp value as-is (e.g., .width(343.dp)).`,
    `When node height equals ${h} (screen height): Use .fillMaxHeight() instead of .height(${hNum}.dp).`,
    `When node height does NOT equal ${h}: Use the dp value as-is.`,
    `When both width and height equal screen dimensions: Use .fillMaxSize() instead of .size(${wNum}.dp, ${hNum}.dp).`,
    `For content centered in a parent and narrower than the parent: Use .fillMaxWidth().padding(horizontal = M.dp) instead of .width(W.dp) + Alignment.CenterHorizontally, where M = (parentWidth - childWidth) / 2.`,
    `FILL CHILD IN ROW: When a node's layout has width: "fillMax" (horizontal sizing = fill) and its parent is a Row, use Modifier.weight(1f) instead of a fixed .width(X.dp). weight(1f) must be inside RowScope. Children without fill sizing keep their fixed width.`,
    `RIGHT-ANCHORED ELEMENTS: When a node's layout has horizontalConstraint: "MAX", place it inside a Box and use Modifier.align(Alignment.CenterEnd).padding(end = N.dp). Do NOT offset or marginStart to simulate right-alignment.`,
    // High-fidelity Compose rules — prevents the most common AI mistakes in Compose code generation
    `ABSOLUTE POSITIONING: When a parent frame has layout mode "none" (no layout/Row/Column field), children use absolute positioning with offset.x and offset.y values. In Compose, place these children inside a Box using Modifier.offset(x = N.dp, y = M.dp). NEVER substitute Column + Spacer for absolute positioning — offset.y IS the exact y-coordinate from the design, not a sequential gap. Spacer heights in a Column are unreliable approximations; use Box + offset instead for pixel-perfect fidelity.`,
    `IMAGE SCALING: Downloaded Figma images are rendered PNGs at specific dp dimensions. Use ContentScale.FillBounds to make the image fill its container exactly (equivalent to ImageView scaleType="fitXY"). Do NOT use ContentScale.Fit — it preserves aspect ratio and will leave gaps when the image's intrinsic ratio differs from the target container size.`,
    `FONT WEIGHT: When text style indicates "bold" or fontWeight is 700, use FontWeight.Bold (weight = 700). Do NOT use FontWeight.SemiBold (weight = 600) unless the design data explicitly specifies semi-bold or fontWeight 600.`,
    `GRADIENT: Default linear gradient in Compose uses Brush.horizontalGradient(startX=0f, endX=1f) for full-width left-to-right. Only set endX < 1f when Figma gradientTransform data explicitly shows a compressed range. Without explicit transform data, use startX=0f, endX=1f.`,
    `Z-ORDER IN BOX: Compose Box draws children in declaration order — later children render on top. When translating a Figma frame where some children overlap others, declare underlay/background elements first, overlay/foreground elements last. Check offset values — a child with a larger offset.y may still need to be behind a child with a smaller offset.y if the Figma z-order says so.`,
  ];
}

export type GetFigmaDataInput = {
  fileKey: string;
  nodeId?: string;
  depth?: number;
};

export type GetFigmaDataResult = {
  formatted: string;
  metrics: GetFigmaDataMetrics;
};

export type GetFigmaDataOutcome = {
  input: GetFigmaDataInput;
  outputFormat: "yaml" | "json";
  durationMs: number;
  metrics?: GetFigmaDataMetrics;
  error?: unknown;
};

/**
 * Live progress reader exposed to onSimplifyStart so callers can render
 * heartbeats showing real-time node counts. Closes over the per-call counter
 * the walker is incrementing — no module-global state involved.
 */
export type SimplifyProgress = {
  getNodeCount: () => number;
};

export type GetFigmaDataHooks = {
  onFetchStart?: () => void | Promise<void>;
  onFetchComplete?: () => void | Promise<void>;
  onSimplifyStart?: (progress: SimplifyProgress) => void | Promise<void>;
  onSimplifyComplete?: () => void | Promise<void>;
  onSerializeStart?: () => void | Promise<void>;
  /**
   * Fires exactly once per call, after the pipeline completes (success or
   * failure). Lets shells observe outcomes without embedding telemetry
   * bookkeeping in the core. Observer errors are swallowed silently — a
   * broken observer must never break the pipeline.
   */
  onComplete?: (outcome: GetFigmaDataOutcome) => void;
};

/**
 * Shared pipeline for "get figma data": fetch raw response, simplify, serialize.
 * Used by both the MCP `get_figma_data` tool and the `fetch` CLI command, which
 * differ only in how they wrap this pipeline (progress notifications vs. plain
 * stdout) and how they report errors (MCP envelope vs. process exit).
 *
 * Hooks are optional — the MCP tool uses them to drive progress heartbeats; the
 * CLI passes none.
 */
export async function getFigmaData(
  figmaService: FigmaService,
  input: GetFigmaDataInput,
  outputFormat: "yaml" | "json",
  outputPlatform: Platform,
  hooks: GetFigmaDataHooks = {},
  skills?: Skill[],
): Promise<GetFigmaDataResult> {
  const { fileKey, nodeId, depth } = input;
  const startedAt = Date.now();
  let metrics: GetFigmaDataMetrics | undefined;
  let caughtError: unknown;
  // Per-call counter shared with the walker. Lives in the call closure so
  // overlapping HTTP requests each have their own — no module-global state.
  const nodeCounter = { count: 0 };

  try {
    await hooks.onFetchStart?.();
    let rawResult: { data: GetFileResponse | GetFileNodesResponse; rawSize: number };
    const fetchStart = Date.now();
    try {
      if (nodeId) {
        rawResult = await figmaService.getRawNode(fileKey, nodeId, depth);
      } else {
        rawResult = await figmaService.getRawFile(fileKey, depth);
      }
    } catch (error) {
      tagError(error, { phase: "fetch" });
    } finally {
      await hooks.onFetchComplete?.();
    }
    const fetchMs = Date.now() - fetchStart;
    const rawApiResponse = rawResult.data;
    const rawSizeKb = rawResult.rawSize / 1024;

    await hooks.onSimplifyStart?.({ getNodeCount: () => nodeCounter.count });
    let simplifiedDesign;
    const simplifyStart = Date.now();
    try {
      simplifiedDesign = await simplifyRawFigmaObject(rawApiResponse, allExtractors, {
        maxDepth: depth,
        afterChildren: collapseRasterContainers,
        nodeCounter,
        nodeFilter: (node) => !isSystemUi(node),
      });
    } catch (error) {
      tagError(error, { phase: "simplify" });
    } finally {
      await hooks.onSimplifyComplete?.();
    }
    const simplifyMs = Date.now() - simplifyStart;

    // Infer auto-layout (Column/Row) from absolute positions for
    // non-auto-layout frames whose children form recognizable patterns.
    inferAutoLayoutFromPositions(simplifiedDesign.nodes, simplifiedDesign.globalVars);

    // Convert centered fixed-width/height children to fill + padding so the
    // output directly expresses responsive layout instead of fixed dimensions.
    convertFixedChildrenToFillMax(simplifiedDesign.nodes, simplifiedDesign.globalVars);

    // Generate per-parent region grouping hints for parents whose children
    // don't form a single Column/Row (mode still "none" after inference).
    const regionHints = generateRegionHints(simplifiedDesign.nodes, simplifiedDesign.globalVars);

    writeLogs("figma-simplified.json", simplifiedDesign);

    const rawNodeCount = nodeCounter.count;
    const hasVariables = detectVariables(rawApiResponse);
    const namedStyleCount = countNamedStyles(rawApiResponse);
    const measured = measureSimplifiedDesign(simplifiedDesign);

    await hooks.onSerializeStart?.();
    const serializeStart = Date.now();
    let formatted: string;
    try {
      const { nodes, globalVars, imageAssets, screen, ...metadata } = simplifiedDesign;

      // Transform layout style values to platform-native terminology.
      // Nodes reference layout styles by string ID, so replacing values in
      // globalVars automatically updates the output for all referencing nodes.
      mapLayoutStyles(globalVars, outputPlatform);

      const layoutHints = screen ? generateLayoutHints(screen, outputPlatform) : [];
      const _REQUIRED_RULES = skills?.map((s) => ({
        uri: `skill://${s.name}`,
        summary: s.description,
      }));

      const result = { metadata, nodes, globalVars, imageAssets, screen, layoutHints, regionHints, _REQUIRED_RULES };
      formatted = serializeResult(result, outputFormat);
    } catch (error) {
      tagError(error, { phase: "serialize" });
    }
    const simplifiedSizeKb = Buffer.byteLength(formatted, "utf8") / 1024;
    const serializeMs = Date.now() - serializeStart;

    metrics = {
      rawSizeKb,
      simplifiedSizeKb,
      rawNodeCount,
      simplifiedNodeCount: measured.simplifiedNodeCount,
      maxDepth: measured.maxDepth,
      namedStyleCount,
      componentCount: measured.componentCount,
      instanceCount: measured.instanceCount,
      textNodeCount: measured.textNodeCount,
      imageNodeCount: measured.imageNodeCount,
      componentPropertyCount: measured.componentPropertyCount,
      hasVariables,
      fetchMs,
      simplifyMs,
      serializeMs,
    };
    return { formatted, metrics };
  } catch (error) {
    caughtError = error;
    throw error;
  } finally {
    if (hooks.onComplete) {
      // Observer errors must never break the pipeline — e.g. a telemetry
      // failure should not mask the tool's real result or its original error.
      try {
        hooks.onComplete({
          input,
          outputFormat,
          durationMs: Date.now() - startedAt,
          metrics,
          error: caughtError,
        });
      } catch {
        // intentionally empty
      }
    }
  }
}
