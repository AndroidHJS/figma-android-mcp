import { z } from "zod";
import type { GetFileNodesResponse, Node as FigmaDocumentNode } from "@figma/rest-api-spec";
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
import { getFigmaSectionFromRaw, collectFrames } from "~/services/get-figma-section.js";
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
    .describe(
      "The ID of the node to fetch, found as URL parameter node-id=<nodeId>. Use format '1234:5678' for a standard node.",
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
      "设为 true 以获取该节点的渲染截图（PNG，2x 分辨率），仅对非 SECTION 节点有效。" +
      "适用场景：需对照截图校验布局、间距、颜色、字体、组件形态。省略时默认不拉取。",
    ),
  outputPlatform: z
    .enum(["compose", "views"])
    .optional()
    .describe(
      'Output platform style: "compose" for Jetpack Compose layout fields, "views" for traditional Android Views layout fields. Falls back to the server-level --output-platform setting when omitted.',
    ),
};

const parametersSchema = z.object(parameters);
export type GetFigmaNodeParams = z.infer<typeof parametersSchema>;

async function getFigmaNode(
  params: GetFigmaNodeParams,
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
    const { fileKey, nodeId: rawNodeId, depth, includePreview, outputPlatform } =
      parametersSchema.parse(params);

    const nodeId = rawNodeId.replace(/-/g, ":");
    const effectivePlatform = outputPlatform ?? serverOutputPlatform;

    Logger.log(`Fetching node ${nodeId} from file ${fileKey} (auto-routing)`);

    // Step 1: fetch raw data once — shared by both routing paths
    await sendProgress(extra, 0, 3, "Fetching design data from Figma API");
    const stopFetchHeartbeat = startProgressHeartbeat(extra, "Waiting for Figma API response");
    let rawResult: { data: GetFileNodesResponse; rawSize: number };
    try {
      rawResult = await figmaService.getRawNode(fileKey, nodeId, depth) as {
        data: GetFileNodesResponse;
        rawSize: number;
      };
    } finally {
      await stopFetchHeartbeat();
    }

    // Step 2: detect node type from raw response — no second API call needed
    const rootEntry = Object.values(rawResult.data.nodes ?? {})[0];
    const rootType = (rootEntry?.document as Record<string, unknown>)?.type as string | undefined;

    Logger.log(`Detected node type: ${rootType ?? "unknown"}`);

    await sendProgress(extra, 1, 3, `Detected ${rootType === "SECTION" ? "SECTION" : "FRAME"} node, processing`);

    const content: ContentBlock[] = [];

    if (rootType === "SECTION") {
      // Route to section pipeline
      const result = await getFigmaSectionFromRaw(
        rawResult.data,
        { fileKey, sectionNodeId: nodeId, depth },
        outputFormat,
        effectivePlatform,
        skills,
      );
      await sendProgress(extra, 2, 3, "Section data processed, serializing");
      content.push({ type: "text", text: result.formatted });

      if (includePreview) {
        // Collect all FRAME descendants (including those nested inside child SECTIONs).
        const sectionDoc = Object.values(rawResult.data.nodes ?? {})[0]?.document as FigmaDocumentNode | undefined;
        const childFrameIds: string[] = sectionDoc
          ? collectFrames(sectionDoc).map((c) => c.id)
          : [];

        const previews = await Promise.all(
          childFrameIds.map((fid) =>
            figmaService.getNodePreviewImage(fileKey, fid).then((img) => ({ fid, img })),
          ),
        );

        for (const { fid, img } of previews) {
          if (img) {
            content.push({ type: "text", text: `--- 帧 ${fid} 效果图 ---` });
            content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
          }
        }

        if (previews.some(({ img }) => img)) {
          content.push({ type: "text", text: "以上为各状态/页面 Frame 的渲染截图，请对照校验每个状态的布局、间距、颜色与组件形态。" });
        }
      }
    } else {
      // Route to standard data pipeline — pass pre-fetched data to skip re-fetch
      const stopSimplifyHeartbeat = startProgressHeartbeat(
        extra,
        "Simplifying design data",
      );
      let stopSimplifyDone = false;
      const result = await runGetFigmaData(
        figmaService,
        { fileKey, nodeId, depth, preloadedRaw: rawResult },
        outputFormat,
        effectivePlatform,
        {
          onFetchStart: async () => { /* already fetched */ },
          onFetchComplete: async () => { /* already fetched */ },
          onSimplifyComplete: async () => {
            stopSimplifyDone = true;
            await stopSimplifyHeartbeat();
          },
          onSerializeStart: async () => {
            if (!stopSimplifyDone) await stopSimplifyHeartbeat();
            await sendProgress(extra, 2, 3, "Simplified design, serializing response");
          },
          onComplete: (outcome) => captureGetFigmaDataCall(outcome, { transport, authMode, clientInfo }),
        },
        skills,
      );

      Logger.log(`Successfully extracted data: ${result.metrics.simplifiedNodeCount} nodes`);
      content.push({ type: "text", text: result.formatted });

      if (includePreview) {
        const preview = await figmaService.getNodePreviewImage(fileKey, nodeId);
        if (preview) {
          content.push({ type: "image", data: preview.base64, mimeType: preview.mimeType });
          content.push({ type: "text", text: "以上为设计稿渲染截图，请对照校验布局、间距、颜色、字体及组件形态。" });
        }
      }
    }

    return { content };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error(`Error fetching node ${params.fileKey}/${params.nodeId}:`, message);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error fetching node: ${message}` }],
    };
  }
}

export const getFigmaNodeTool = {
  name: "get_figma_node",
  description:
    "Unified entry point for any Figma node URL — auto-detects node type and routes accordingly.\n\n" +
    "SECTION nodes (multiple FRAMEs as UI states, e.g. default/loading/error/empty/success): returns grouped multi-state frame data with state analysis. " +
    "AI should generate ONE page with state management (sealed class / enum) rather than separate pages.\n\n" +
    "FRAME / COMPONENT / other nodes: returns standard single-node design data identical to get_figma_data. " +
    "Layout dimensions use dp units, font sizes use sp units, letter spacing uses em (use directly: Compose `N.em`, View `android:letterSpacing=\"N\"`). Colors are hex/rgba. textStyle entries with `textTruncation: ENDING` require ellipsis truncation (`maxLines` + `TextOverflow.Ellipsis` / `android:ellipsize=\"end\"`).\n\n" +
    "CRITICAL — the output includes an `imageAssets` section. Before writing ANY code, call `download_figma_images` with those nodeIds.\n\n" +
    "REQUIRED RULES — the response may include a `_REQUIRED_RULES` section listing mandatory skill resources. Read each before generating code.",
  parametersSchema,
  handler: getFigmaNode,
} as const;
