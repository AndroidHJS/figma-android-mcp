import { z } from "zod";
import type { Node as FigmaDocumentNode } from "@figma/rest-api-spec";
import { FigmaService } from "~/services/figma.js";
import { Logger } from "~/utils/logger.js";
import { sendProgress, startProgressHeartbeat, type ToolExtra } from "~/mcp/progress.js";
import {
  captureGetFigmaDataCall,
  type AuthMode,
  type ClientInfo,
  type Transport,
} from "~/telemetry/index.js";
import { getFigmaNode as runGetFigmaNode } from "~/services/get-figma-node.js";
import { collectFrames } from "~/services/get-figma-section.js";
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
  manifestOnly: z
    .boolean()
    .optional()
    .describe(
      "Only applies when the node is a SECTION. When true, skip frame extraction and return a manifest immediately. " +
      "Use when you plan to call get_figma_node per-frame anyway — each frame then gets its own 300 KB budget with no cross-frame compression, giving higher fidelity. " +
      "Sections with more than 5 frames trigger this automatically.",
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
  const startTime = Date.now();
  // Set after parsing so the catch block knows whether it has valid params for telemetry.
  let telemetryInput: { fileKey: string; nodeId: string } | undefined;
  // Hoisted so the catch block can stop any heartbeat still running when the
  // pipeline throws before its own stop hook fires.
  let stopFetchHeartbeat: (() => Promise<void>) | undefined;
  let stopSimplifyHeartbeat: (() => Promise<void>) | undefined;
  try {
    const { fileKey, nodeId: rawNodeId, depth, includePreview, outputPlatform, manifestOnly } =
      parametersSchema.parse(params);
    const nodeId = rawNodeId.replace(/-/g, ":");
    telemetryInput = { fileKey, nodeId };
    const effectivePlatform = outputPlatform ?? serverOutputPlatform;

    Logger.log(`Fetching node ${nodeId} from file ${fileKey} (auto-routing)`);

    await sendProgress(extra, 0, 3, "Fetching design data from Figma API");
    stopFetchHeartbeat = startProgressHeartbeat(extra, "Waiting for Figma API response");

    const { formatted, rootType, raw } = await runGetFigmaNode(
      figmaService,
      { fileKey, nodeId, depth, manifestOnly },
      outputFormat,
      effectivePlatform,
      {
        onFetched: async () => {
          await stopFetchHeartbeat?.();
          stopFetchHeartbeat = undefined;
        },
        onRouted: async (rt) => {
          Logger.log(`Detected node type: ${rt ?? "unknown"}`);
          await sendProgress(extra, 1, 3, `Detected ${rt === "SECTION" ? "SECTION" : "FRAME"} node, processing`);
        },
        onSimplifyStart: () => {
          stopSimplifyHeartbeat = startProgressHeartbeat(extra, "Simplifying design data");
        },
        onSimplifyComplete: async () => {
          await stopSimplifyHeartbeat?.();
          stopSimplifyHeartbeat = undefined;
        },
        onSerializeStart: async () => {
          await stopSimplifyHeartbeat?.();
          stopSimplifyHeartbeat = undefined;
          await sendProgress(extra, 2, 3, "Simplified design, serializing response");
        },
        onComplete: (outcome) => captureGetFigmaDataCall(outcome, { transport, authMode, clientInfo }),
      },
      skills,
    );

    // The SECTION path has no simplify/serialize hooks of its own; emit its
    // serialize milestone here so progress still reaches 2/3.
    if (rootType === "SECTION") {
      await sendProgress(extra, 2, 3, "Section data processed, serializing");
    }

    const content: ContentBlock[] = [{ type: "text", text: formatted }];

    if (includePreview) {
      if (rootType === "SECTION") {
        // Collect all FRAME descendants (including those nested inside child SECTIONs).
        const sectionDoc = Object.values(raw.data.nodes ?? {})[0]?.document as FigmaDocumentNode | undefined;
        const childFrameIds: string[] = sectionDoc
          ? collectFrames(sectionDoc).frames.map((c) => c.node.id)
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
      } else {
        const preview = await figmaService.getNodePreviewImage(fileKey, nodeId);
        if (preview) {
          content.push({ type: "image", data: preview.base64, mimeType: preview.mimeType });
          content.push({ type: "text", text: "以上为设计稿渲染截图，请对照校验布局、间距、颜色、字体及组件形态。" });
        }
      }
    }

    return { content };
  } catch (error) {
    // Stop any heartbeat that was still running when the pipeline threw.
    await stopFetchHeartbeat?.();
    await stopSimplifyHeartbeat?.();
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error(`Error fetching node ${params.fileKey}/${params.nodeId}:`, message);
    // Fire telemetry for pre-routing errors (e.g. API failure before type detection).
    // The FRAME routing path fires its own telemetry via onComplete; this covers the rest.
    if (telemetryInput) {
      captureGetFigmaDataCall(
        { input: telemetryInput, outputFormat, durationMs: Date.now() - startTime, error },
        { transport, authMode, clientInfo },
      );
    }
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
    "Same-page state frames → ONE screen file with state management (sealed class / enum), NOT separate pages.\n\n" +
    "FILE SPLITTING — For multi-page sections or sections containing dialogs, the header includes a 文件拆分计划 (file splitting plan). " +
    "You MUST create each listed file separately: one Screen file per page group, one Dialog file per dialog (a dialog's multiple states share one file). " +
    "Each frame's `metadata.suggestedFile` names the file its data belongs to. " +
    "Dialog UI goes in its own file (DialogFragment / ModalBottomSheet); the owning page only holds show/hide logic. " +
    "Suggested names keep the designer's original (Chinese) naming — adapt directory and English naming to the project's conventions.\n\n" +
    "MANIFEST MODE — Sections with more than 5 frames return a lightweight manifest instead of full data. " +
    "Follow the manifest instructions to call get_figma_node per frame; each frame then gets its own 300 KB budget with no cross-frame compression.\n\n" +
    "FRAME / COMPONENT / other nodes: returns standard single-node design data. " +
    "Layout dimensions use dp units, font sizes use sp units, letter spacing uses em (use directly: Compose `N.em`, View `android:letterSpacing=\"N\"`). Colors are hex/rgba. textStyle entries with `textTruncation: ENDING` require ellipsis truncation (`maxLines` + `TextOverflow.Ellipsis` / `android:ellipsize=\"end\"`).\n\n" +
    "CRITICAL — the output includes an `imageAssets` section (deduplicated at section level). Before writing ANY code, call `download_figma_images` with those nodeIds.\n\n" +
    "REQUIRED RULES — the response may include a `_REQUIRED_RULES` section listing mandatory skill resources. Read each before generating code.",
  parametersSchema,
  handler: getFigmaNode,
} as const;
