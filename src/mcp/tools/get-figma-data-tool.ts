import { z } from "zod";
import { FigmaService } from "~/services/figma.js";
import { Logger } from "~/utils/logger.js";
import { sendProgress, startProgressHeartbeat, type ToolExtra } from "~/mcp/progress.js";
import {
  captureGetFigmaDataCall,
  type AuthMode,
  type ClientInfo,
  type Transport,
} from "~/telemetry/index.js";
import { getFigmaData as runGetFigmaData } from "~/services/get-figma-data.js";
import type { OutputPlatform } from "~/config.js";

const parameters = {
  fileKey: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
    .describe(
      "The key of the Figma file to fetch, often found in a provided URL like figma.com/(file|design)/<fileKey>/...",
    ),
  nodeId: z
    .string()
    .regex(
      /^I?\d+[:|-]\d+(?:;\d+[:|-]\d+)*$/,
      "Node ID must be like '1234:5678' or 'I5666:180910;1:10515;1:10336'",
    )
    .optional()
    .describe(
      "The ID of the node to fetch, often found as URL parameter node-id=<nodeId>, always use if provided. Use format '1234:5678' for a standard node, or 'I5666:180910;1:10515;1:10336' for a deeply nested instance node (the semicolon-joined path represents the instance override chain — it's still a single node ID, not multiple nodes).",
    ),
  depth: z
    .number()
    .optional()
    .describe(
      "OPTIONAL. Do NOT use unless explicitly requested by the user. Controls how many levels deep to traverse the node tree.",
    ),
};

const parametersSchema = z.object(parameters);
export type GetFigmaDataParams = z.infer<typeof parametersSchema>;

async function getFigmaData(
  params: GetFigmaDataParams,
  figmaService: FigmaService,
  outputFormat: "yaml" | "json",
  outputPlatform: OutputPlatform,
  transport: Transport,
  authMode: AuthMode,
  clientInfo: ClientInfo | undefined,
  extra: ToolExtra,
) {
  try {
    const { fileKey, nodeId: rawNodeId, depth } = parametersSchema.parse(params);

    // Replace - with : in nodeId for our query — Figma API expects :.
    // MCP-specific input quirk, so it lives here rather than in the shared core.
    const nodeId = rawNodeId?.replace(/-/g, ":");

    Logger.log(
      `Fetching ${depth ? `${depth} layers deep` : "all layers"} of ${
        nodeId ? `node ${nodeId} from file` : `full file`
      } ${fileKey}`,
    );

    let stopFetchHeartbeat: (() => Promise<void>) | undefined;
    let stopSimplifyHeartbeat: (() => Promise<void>) | undefined;

    const result = await runGetFigmaData(figmaService, { fileKey, nodeId, depth }, outputFormat, outputPlatform, {
      onFetchStart: async () => {
        await sendProgress(extra, 0, 3, "Fetching design data from Figma API");
        stopFetchHeartbeat = startProgressHeartbeat(extra, "Waiting for Figma API response");
      },
      onFetchComplete: async () => {
        await stopFetchHeartbeat?.();
      },
      onSimplifyStart: async (progress) => {
        await sendProgress(extra, 1, 3, "Fetched design data, simplifying");
        stopSimplifyHeartbeat = startProgressHeartbeat(
          extra,
          () => `Simplifying design data (${progress.getNodeCount()} nodes processed)`,
        );
      },
      onSimplifyComplete: async () => {
        await stopSimplifyHeartbeat?.();
      },
      onSerializeStart: async () => {
        await sendProgress(extra, 2, 3, "Simplified design, serializing response");
      },
      onComplete: (outcome) =>
        captureGetFigmaDataCall(outcome, { transport, authMode, clientInfo }),
    });

    Logger.log(`Successfully extracted data: ${result.metrics.simplifiedNodeCount} nodes`);
    Logger.log("Sending result to client");

    const content: Array<
      { type: "text"; text: string } | { type: "image"; mimeType: string; data: string }
    > = [{ type: "text" as const, text: result.formatted }];

    if (nodeId) {
      const preview = await figmaService.getNodePreviewImage(fileKey, nodeId);
      if (preview) {
        content.push({ type: "image" as const, mimeType: preview.mimeType, data: preview.base64 });
        content.push({
          type: "text" as const,
          text: "上方图片是该 Figma 设计节点的截图，请对照截图校验生成代码的还原度——重点检查布局、间距、颜色、字体及组件形态。",
        });
      }
    }

    return { content };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error(`Error fetching file ${params.fileKey}:`, message);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error fetching file: ${message}` }],
    };
  }
}

// Export tool configuration
export const getFigmaDataTool = {
  name: "get_figma_data",
  description:
    "Get comprehensive Figma file data. Layout dimensions use dp units, font sizes use sp units. Colors are hex/rgba. Vectors become IMAGE-PNG nodes. Component variants (VARIANT type) are surfaced with full option lists.\n\nCRITICAL — the output includes an `imageAssets` section listing every node that must be downloaded as a PNG. Before writing ANY code, call `download_figma_images` with the nodeIds from `imageAssets`. These are rendered images, not code-drawable elements.\n\nOUTPUT SECTIONS — the output includes a `screen` field (design canvas dimensions in dp) and a `layoutHints` field (responsive layout rules). Layout fields are platform-native: `layout`/`arrangement`/`alignment`/`spacing`/`width`/`height` for Compose, or `orientation`/`gravity`/`layout_width`/`layout_height` for traditional Views. Follow layoutHints and use the layout fields directly in your code.",
  parametersSchema,
  handler: getFigmaData,
} as const;
