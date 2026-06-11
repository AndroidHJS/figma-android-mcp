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
import type { Skill } from "~/skills/types.js";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";

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
  includePreview: z
    .boolean()
    .optional()
    .describe(
      "设为 true 以获取该节点的渲染截图（PNG，2x 分辨率），嵌入 MCP 响应的 image 内容块。" +
      "适用场景：你需要根据设计稿生成 UI 代码，需对照截图校验布局、间距、颜色、字体、组件形态。" +
      "不适用场景：仅查看节点元数据、探索设计结构、提取数值信息。省略时默认不拉取。",
    ),
  outputPlatform: z
    .enum(["compose", "views"])
    .optional()
    .describe(
      "Output platform style: \"compose\" for Jetpack Compose layout fields, \"views\" for traditional Android Views layout fields. Falls back to the server-level --output-platform setting when omitted.",
    ),
};

const parametersSchema = z.object(parameters);
export type GetFigmaDataParams = z.infer<typeof parametersSchema>;

async function getFigmaData(
  params: GetFigmaDataParams,
  figmaService: FigmaService,
  outputFormat: "yaml" | "json",
  serverOutputPlatform: OutputPlatform,
  transport: Transport,
  authMode: AuthMode,
  clientInfo: ClientInfo | undefined,
  extra: ToolExtra,
  skills?: Skill[],
) {
  try {
    const { fileKey, nodeId: rawNodeId, depth, includePreview, outputPlatform } = parametersSchema.parse(params);

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

    const effectivePlatform = outputPlatform ?? serverOutputPlatform;

    const result = await runGetFigmaData(figmaService, { fileKey, nodeId, depth }, outputFormat, effectivePlatform, {
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
    }, skills);

    Logger.log(`Successfully extracted data: ${result.metrics.simplifiedNodeCount} nodes`);
    Logger.log("Sending result to client");

    const content: ContentBlock[] = [
      { type: "text", text: result.formatted },
    ];

    if (nodeId && includePreview) {
      const preview = await figmaService.getNodePreviewImage(fileKey, nodeId);
      if (preview) {
        content.push({
          type: "image",
          data: preview.base64,
          mimeType: preview.mimeType,
        });
        content.push({
          type: "text",
          text: "以上为设计稿渲染截图，请对照校验布局、间距、颜色、字体及组件形态。",
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
    "Get comprehensive Figma file data. Layout dimensions use dp units, font sizes use sp units, letter spacing uses em (use directly: Compose `N.em`, View `android:letterSpacing=\"N\"`). Colors are hex/rgba. textStyle entries with `textTruncation: ENDING` require ellipsis truncation (`maxLines` + `TextOverflow.Ellipsis` / `android:ellipsize=\"end\"`). Vectors become IMAGE-PNG nodes. Component variants (VARIANT type) are surfaced with full option lists.\n\nCRITICAL — the output includes an `imageAssets` section listing every node that must be downloaded as a PNG. Before writing ANY code, call `download_figma_images` with the nodeIds from `imageAssets`. These are rendered images, not code-drawable elements.\n\nOUTPUT SECTIONS — the output includes a `screen` field (design canvas dimensions in dp), a `layoutHints` field (responsive layout rules), and a `regionHints` field (per-parent grouping of free-form children into stack/column/row regions). In stack regions, `attachments` list elements to nest inside their host's Box/FrameLayout at the given anchor+insets; an attachment with role: \"background\" is a content-area background layer that MUST be rendered as a surface behind the content covering it — never skip it. Layout fields are platform-native: `layout`/`arrangement`/`alignment`/`spacing`/`width`/`height` for Compose, or `orientation`/`gravity`/`layout_width`/`layout_height` for traditional Views. Follow layoutHints and use the layout fields directly in your code.\n\nREQUIRED RULES — The response includes a `_REQUIRED_RULES` section listing mandatory constraint resources. Before generating ANY code, you MUST read each `skill://{name}` MCP resource listed there and follow its constraints strictly. These rules override conflicting general practices.\n\nINSTANCE OVERRIDES — INSTANCE nodes may carry an `overrides` list describing which descendants deviate from the component definition and in which fields (with resolved `text` for copy changes); deviating descendants are marked `overridden`. An instance with `prunedToOverrides: true` had its non-overridden children omitted because the COMPONENT definition node appears elsewhere in this output — read the structure from that definition and apply the instance's `overrides` as diffs. Implement one shared composable/view per component and pass the per-instance differences as parameters.\n\nPREVIEW — Set includePreview to true when fetching a specific node for UI code generation. The response will include a rendered PNG screenshot for visual verification. Omit to skip the image and reduce latency/bandwidth.",
  parametersSchema,
  handler: getFigmaData,
} as const;
