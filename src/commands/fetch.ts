import { type Command, command } from "cleye";
import { loadEnvFile, resolveAuth, requireGlobalCredentials, resolveSkillsDir, UsageError, type OutputPlatform } from "~/config.js";
import { FigmaService } from "~/services/figma.js";
import { parseFigmaUrl } from "~/utils/figma-url.js";
import { authMode, initTelemetry, captureGetFigmaDataCall, shutdown } from "~/telemetry/index.js";
import { getFigmaData } from "~/services/get-figma-data.js";
import { getFigmaNode } from "~/services/get-figma-node.js";
import { loadSkills } from "~/skills/index.js";

export const fetchCommand: Command = command(
  {
    name: "fetch",
    description: "Fetch simplified Figma data and print to stdout",
    parameters: ["[url]"],
    flags: {
      fileKey: {
        type: String,
        description: "Figma file key (overrides URL)",
      },
      nodeId: {
        type: String,
        description: "Node ID, format 1234:5678 (overrides URL)",
      },
      depth: {
        type: Number,
        description: "Tree traversal depth",
      },
      json: {
        type: Boolean,
        description: "Output JSON instead of YAML",
      },
      figmaApiKey: {
        type: String,
        description: "Figma API key",
      },
      figmaOauthToken: {
        type: String,
        description: "Figma OAuth token",
      },
      env: {
        type: String,
        description: "Path to .env file",
      },
      noTelemetry: {
        type: Boolean,
        description: "Disable usage telemetry",
      },
      outputPlatform: {
        type: String,
        description: "Output platform: compose (default) or views",
      },
      skillsDir: {
        type: String,
        description:
          "Path to a directory containing custom skill markdown files. Skills provide constraints and best practices for Figma-to-code conversion.",
      },
    },
  },
  (argv) => {
    run(argv.flags, argv._)
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      })
      .finally(() => shutdown());
  },
);

async function run(
  flags: {
    fileKey?: string;
    nodeId?: string;
    depth?: number;
    json?: boolean;
    figmaApiKey?: string;
    figmaOauthToken?: string;
    env?: string;
    noTelemetry?: boolean;
    outputPlatform?: string;
    skillsDir?: string;
  },
  positionals: string[],
) {
  const url = positionals[0];
  let fileKey = flags.fileKey;
  let nodeId = flags.nodeId;

  if (url) {
    try {
      const parsed = parseFigmaUrl(url);
      fileKey ??= parsed.fileKey;
      nodeId ??= parsed.nodeId;
    } catch (error) {
      if (!fileKey) throw error;
      // fileKey provided via flag — malformed URL is non-fatal
    }
  }

  if (!fileKey) {
    throw new UsageError("Either a Figma URL or --file-key is required");
  }

  loadEnvFile(flags.env);
  const auth = resolveAuth(flags);
  // The fetch CLI has no per-request credential channel (unlike HTTP mode).
  // Fail fast so the user gets an actionable error instead of an HTTP-shaped
  // one from `getAuthHeaders`.
  requireGlobalCredentials(auth);

  // Initialize telemetry only after input validation succeeds, so every
  // captured event corresponds to an actual fetch attempt (not a usage error).
  initTelemetry({
    optOut: flags.noTelemetry,
    immediateFlush: true,
    redactFromErrors: [auth.figmaApiKey, auth.figmaOAuthToken],
  });

  const mode = authMode(auth);
  const outputFormat = flags.json ? "json" : "yaml";
  const outputPlatform: OutputPlatform = (flags.outputPlatform as OutputPlatform) ?? "compose";
  const figmaService = new FigmaService(auth);
  // Load skills (built-in + optional custom dir) just like the MCP server, so
  // CLI output carries the same `_REQUIRED_RULES` section.
  const skills = loadSkills(resolveSkillsDir(flags.skillsDir), outputPlatform);
  const onComplete = (outcome: Parameters<typeof captureGetFigmaDataCall>[0]) =>
    captureGetFigmaDataCall(outcome, { transport: "cli", authMode: mode });

  // With a nodeId, route through the same SECTION/FRAME auto-detection the
  // MCP `get_figma_node` tool uses, so CLI output matches MCP output. Without
  // one (whole-file fetch), getRawNode can't be used — fall back to the
  // standard file pipeline.
  const formatted = nodeId
    ? (
        await getFigmaNode(
          figmaService,
          { fileKey, nodeId, depth: flags.depth },
          outputFormat,
          outputPlatform,
          { onComplete },
          skills,
        )
      ).formatted
    : (
        await getFigmaData(
          figmaService,
          { fileKey, depth: flags.depth },
          outputFormat,
          outputPlatform,
          { onComplete },
          skills,
        )
      ).formatted;

  console.log(formatted);
}
