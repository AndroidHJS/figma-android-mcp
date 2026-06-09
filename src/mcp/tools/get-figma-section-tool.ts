import { z } from "zod";
import { FigmaService } from "~/services/figma.js";
import { Logger } from "~/utils/logger.js";
import type { ToolExtra } from "~/mcp/progress.js";
import type { OutputPlatform } from "~/config.js";
import type { Skill } from "~/skills/types.js";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { getFigmaSection as runGetFigmaSection } from "~/services/get-figma-section.js";

const parameters = {
  fileKey: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
    .describe(
      "The key of the Figma file to fetch, often found in a provided URL like figma.com/(file|design)/<fileKey>/...",
    ),
  sectionNodeId: z
    .string()
    .regex(
      /^I?\d+[:|-]\d+(?:;\d+[:|-]\d+)*$/,
      "Node ID must be like '1234:5678' or 'I5666:180910;1:10515;1:10336'",
    )
    .describe(
      "The ID of the SECTION node to fetch. SECTIONS contain multiple FRAMEs that are typically different states of the same page (default/loading/error/empty/success).",
    ),
  depth: z
    .number()
    .optional()
    .describe(
      "OPTIONAL. Do NOT use unless explicitly requested. Controls how many levels deep to traverse the node tree.",
    ),
  outputPlatform: z
    .enum(["compose", "views"])
    .optional()
    .describe(
      'Output platform style: "compose" for Jetpack Compose layout fields, "views" for traditional Android Views layout fields. Falls back to the server-level --output-platform setting when omitted.',
    ),
};

const parametersSchema = z.object(parameters);
export type GetFigmaSectionParams = z.infer<typeof parametersSchema>;

async function getFigmaSection(
  params: GetFigmaSectionParams,
  figmaService: FigmaService,
  outputFormat: "yaml" | "json",
  serverOutputPlatform: OutputPlatform,
  extra: ToolExtra,
  skills?: Skill[],
) {
  try {
    const { fileKey, sectionNodeId: rawNodeId, depth, outputPlatform } =
      parametersSchema.parse(params);

    // Replace - with : in nodeId — Figma API expects :.
    const sectionNodeId = rawNodeId.replace(/-/g, ":");

    Logger.log(
      `Fetching SECTION ${sectionNodeId} from file ${fileKey}${depth ? ` (depth: ${depth})` : ""}`,
    );

    const effectivePlatform = outputPlatform ?? serverOutputPlatform;

    const result = await runGetFigmaSection(
      figmaService,
      { fileKey, sectionNodeId, depth },
      outputFormat,
      effectivePlatform,
      skills,
    );

    Logger.log("Successfully extracted section data");

    const content: ContentBlock[] = [
      { type: "text", text: result.formatted },
    ];

    return { content };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error(`Error fetching section ${params.fileKey}/${params.sectionNodeId}:`, message);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error fetching section: ${message}` }],
    };
  }
}

export const getFigmaSectionTool = {
  name: "get_figma_section",
  description:
    "Fetch all FRAMEs within a Figma SECTION node. SECTIONS group multiple FRAMEs that are typically different states of the same page (e.g. default / loading / error / empty / success). The output lists all frame names at the top for easy pattern recognition, then provides complete design data per frame. AI should generate ONE page with state management (sealed class / enum) rather than separate pages.\n\nCRITICAL — The output includes a deduplicated `imageAssets` section at the bottom. Before writing code, call `download_figma_images` with those nodeIds. Per-frame `imageAssets` are also shown in each frame block for reference.",
  parametersSchema,
  handler: getFigmaSection,
} as const;
