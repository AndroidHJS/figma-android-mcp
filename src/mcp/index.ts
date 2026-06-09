import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OutputPlatform } from "../config.js";
import { FigmaService, type FigmaAuthOptions } from "../services/figma.js";
import { Logger } from "../utils/logger.js";
import { authMode, type AuthMode, type ClientInfo, type Transport } from "~/telemetry/index.js";
import { installValidationRejectCapture } from "./validation-capture.js";
import type { ToolExtra } from "./progress.js";
import {
  downloadFigmaImagesTool,
  getFigmaDataTool,
  getFigmaSectionTool,
  getSkillTool,
  type DownloadImagesParams,
  type GetFigmaDataParams,
  type GetFigmaSectionParams,
} from "./tools/index.js";
import { registerSkillResources } from "./resources/skills-resource.js";
import { loadSkills } from "../skills/index.js";
import type { Skill } from "../skills/types.js";

const serverInfo = {
  name: "Figma MCP Server",
  version: process.env.NPM_PACKAGE_VERSION ?? "unknown",
  description:
    "When a Figma link is provided and the user asks to generate UI code, use this server. Call `get_figma_data` to fetch design data directly. Only when the user explicitly requests high-fidelity restoration or effect comparison (高还原 / 效果图对比), call `get_skill(\"figma-android-mcp-skill\")` to activate the full 7-step workflow.",
};

type ServerTransport = Extract<Transport, "stdio" | "http">;

export type CreateServerOptions = {
  transport: ServerTransport;
  outputFormat?: "yaml" | "json";
  outputPlatform?: OutputPlatform;
  skipImageDownloads?: boolean;
  imageDir?: string;
  skillsDir?: string;
};

function createServer(
  authOptions: FigmaAuthOptions,
  { transport, outputFormat = "yaml", outputPlatform = "compose", skipImageDownloads = false, imageDir, skillsDir }: CreateServerOptions,
) {
  const server = new McpServer(serverInfo, {
    instructions:
      "Call `get_skill` without a name to discover available skills and their triggers. Use `get_figma_data` for normal Figma→UI tasks. Use `get_skill(\"figma-android-mcp-skill\")` only for high-fidelity restoration with effect comparison (效果图对比/高还原). Use `get_skill(\"android-layout\")` for layout constraints when writing Android code.",
  });
  const figmaService = new FigmaService(authOptions);
  const mode = authMode(authOptions);
  const skills = loadSkills(skillsDir);

  const getClientInfo = (): ClientInfo | undefined => {
    const info = server.server.getClientVersion();
    if (!info) return undefined;
    return { name: info.name, version: info.version };
  };

  registerTools(server, figmaService, {
    transport,
    authMode: mode,
    outputFormat,
    outputPlatform,
    skipImageDownloads,
    imageDir,
    getClientInfo,
    skills,
  });

  registerSkillResources(server, skills);

  installValidationRejectCapture(server, { transport, authMode: mode, getClientInfo });

  Logger.isHTTP = transport !== "stdio";

  return server;
}

type RegisterToolsOptions = {
  transport: ServerTransport;
  authMode: AuthMode;
  outputFormat: "yaml" | "json";
  outputPlatform: OutputPlatform;
  skipImageDownloads: boolean;
  imageDir?: string;
  getClientInfo: () => ClientInfo | undefined;
  skills: Skill[];
};

function registerTools(
  server: McpServer,
  figmaService: FigmaService,
  options: RegisterToolsOptions,
): void {
  server.registerTool(
    getFigmaDataTool.name,
    {
      title: "Get Figma Data",
      description: getFigmaDataTool.description,
      inputSchema: getFigmaDataTool.parametersSchema,
      annotations: { readOnlyHint: true },
    },
    (params: GetFigmaDataParams, extra: ToolExtra) =>
      getFigmaDataTool.handler(
        params,
        figmaService,
        options.outputFormat,
        options.outputPlatform,
        options.transport,
        options.authMode,
        options.getClientInfo(),
        extra,
        options.skills,
      ),
  );

  server.registerTool(
    getFigmaSectionTool.name,
    {
      title: "Get Figma Section",
      description: getFigmaSectionTool.description,
      inputSchema: getFigmaSectionTool.parametersSchema,
      annotations: { readOnlyHint: true },
    },
    (params: GetFigmaSectionParams, extra: ToolExtra) =>
      getFigmaSectionTool.handler(
        params,
        figmaService,
        options.outputFormat,
        options.outputPlatform,
        extra,
        options.skills,
      ),
  );

  server.registerTool(
    getSkillTool.name,
    {
      title: "Get Skill Content",
      description: getSkillTool.description,
      inputSchema: getSkillTool.parametersSchema,
      annotations: { readOnlyHint: true },
    },
    (params: { name?: string }) =>
      getSkillTool.handler(params, options.skills),
  );

  if (!options.skipImageDownloads) {
    server.registerTool(
      downloadFigmaImagesTool.name,
      {
        title: "Download Figma Images",
        description: downloadFigmaImagesTool.getDescription(options.imageDir),
        inputSchema: downloadFigmaImagesTool.parametersSchema,
        annotations: { openWorldHint: true },
      },
      (params: DownloadImagesParams, extra: ToolExtra) =>
        downloadFigmaImagesTool.handler(
          params,
          figmaService,
          options.imageDir,
          options.transport,
          options.authMode,
          options.getClientInfo(),
          extra,
        ),
    );
  }
}

export { createServer };
