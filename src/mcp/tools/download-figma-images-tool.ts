import path from "path";
import { z } from "zod";
import {
  type AuthMode,
  type ClientInfo,
  captureDownloadImagesCall,
  captureValidationReject,
  type Transport,
} from "~/telemetry/index.js";
import { downloadFigmaImages as runDownloadFigmaImages } from "../../services/download-figma-images.js";
import type { FigmaService } from "../../services/figma.js";
import { type ResolveLocalPathFailureReason, resolveLocalPath } from "../../utils/local-path.js";
import { Logger } from "../../utils/logger.js";
import { sendProgress, startProgressHeartbeat, type ToolExtra } from "../progress.js";
import { ANDROID_DENSITIES, type AndroidDensity } from "~/utils/units.js";

const DENSITY_KEYS = Object.keys(ANDROID_DENSITIES) as AndroidDensity[];

const parameters = {
  fileKey: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
    .describe("The key of the Figma file containing the images"),
  nodes: z
    .object({
      nodeId: z
        .string()
        .regex(
          /^I?\d+[:|-]\d+(?:;\d+[:|-]\d+)*$/,
          "Node ID must be like '1234:5678' or 'I5666:180910;1:10515;1:10336'",
        )
        .describe("The ID of the Figma image node to fetch, formatted as 1234:5678"),
      imageRef: z
        .string()
        .optional()
        .describe(
          "If a node has an imageRef fill, you must include this variable. Leave blank when downloading rendered IMAGE-PNG nodes or animated GIFs (use gifRef instead).",
        ),
      gifRef: z
        .string()
        .optional()
        .describe(
          "If a node has a gifRef fill (animated GIF), you must include this variable to download the animated GIF.",
        ),
      fileName: z
        .string()
        .regex(
          /^[a-z0-9_]+\.png$/,
          "Android resource filenames must use only lowercase letters, numbers, and underscores, ending with .png",
        )
        .describe(
          "The local name for saving the fetched file. Must be lowercase with underscores, ending with .png. Android resource naming convention.",
        ),
      needsCropping: z
        .boolean()
        .optional()
        .describe("Whether this image needs cropping based on its transform matrix"),
      cropTransform: z
        .array(z.array(z.number()))
        .optional()
        .describe("Figma transform matrix for image cropping"),
      requiresImageDimensions: z
        .boolean()
        .optional()
        .describe("Whether this image requires dimension information"),
      filenameSuffix: z
        .string()
        .regex(
          /^[a-z0-9_]+$/,
          "Suffix must contain only lowercase letters, numbers, or underscores",
        )
        .optional()
        .describe(
          "Suffix to add to filename for unique images, provided in the Figma data",
        ),
    })
    .array()
    .describe("The nodes to fetch as images"),
  densities: z
    .array(z.enum(DENSITY_KEYS as [string, ...string[]]))
    .default(["xhdpi", "xxhdpi"])
    .describe(
      "Android density buckets to export. Defaults to xhdpi (2x) and xxhdpi (3x). Each bucket produces a separate PNG in mipmap-{bucket}/.",
    ),
  localPath: z
    .string()
    .describe(
      "The res/ directory to save images in. Provide a path like 'app/src/main/res'. Density subdirectories (mipmap-xhdpi/, mipmap-xxhdpi/) are created automatically.",
    ),
};

const parametersSchema = z.object(parameters);
export type DownloadImagesParams = z.infer<typeof parametersSchema>;

async function downloadFigmaImages(
  params: DownloadImagesParams,
  figmaService: FigmaService,
  imageDir: string | undefined,
  transport: Transport,
  authMode: AuthMode,
  clientInfo: ClientInfo | undefined,
  extra: ToolExtra,
) {
  try {
    const { fileKey, nodes, localPath, densities } = parametersSchema.parse(params);

    // Resolve localPath against the configured image directory.
    const baseDir = imageDir ?? process.cwd();
    const resolution = resolveLocalPath(localPath, baseDir);
    if (!resolution.ok) {
      const details = rejectionDetails(resolution.reason, localPath, baseDir);
      captureValidationReject(
        {
          tool: "download_figma_images",
          field: "localPath",
          rule: details.rule,
          message: details.telemetryMessage,
        },
        { transport, authMode, clientInfo },
      );
      return {
        isError: true,
        content: [{ type: "text" as const, text: details.userMessage }],
      };
    }
    const resolvedPath = resolution.resolvedPath;

    await sendProgress(extra, 0, 3, "Resolving image downloads");

    let stopHeartbeat: (() => void) | undefined;
    const { downloads, successCount } = await runDownloadFigmaImages(
      figmaService,
      { fileKey, nodes, localPath: resolvedPath, densities },
      {
        onDownloadStart: async (downloadCount) => {
          await sendProgress(extra, 1, 3, `Resolved ${downloadCount} images, downloading`);
          stopHeartbeat = startProgressHeartbeat(extra, "Downloading images");
        },
        onDownloadComplete: () => {
          stopHeartbeat?.();
        },
        onComplete: (outcome) =>
          captureDownloadImagesCall(outcome, {
            transport,
            authMode,
            clientInfo,
          }),
      },
    );

    await sendProgress(extra, 2, 3, "Formatting response");

    const totalSuccess = successCount.total ?? 0;
    const densityCounts = DENSITY_KEYS
      .filter((d) => successCount[d])
      .map((d) => `${d}: ${successCount[d]}`)
      .join(", ");

    const MAX_LIST_ITEMS = 20;
    const imagesList = downloads.slice(0, MAX_LIST_ITEMS)
      .map(({ perDensity, requestedFileNames }) => {
        const lines = perDensity.map((d) => {
          const fn = path.basename(d.filePath);
          const dims = `${d.finalDimensions.width}x${d.finalDimensions.height}`;
          const cropStatus = d.wasCropped ? " (cropped)" : "";
          return `  mipmap-${d.density}/${fn}: ${dims}${cropStatus}`;
        });
        const baseFile = requestedFileNames[0] ?? perDensity[0]?.filePath;
        return `- ${path.basename(baseFile)}:\n${lines.join("\n")}`;
      })
      .join("\n");

    const overflow =
      downloads.length > MAX_LIST_ITEMS
        ? `\n... (${downloads.length - MAX_LIST_ITEMS} more)`
        : "";

    return {
      content: [
        {
          type: "text" as const,
          text: `Downloaded ${totalSuccess} images (${densityCounts}) to \`${resolvedPath}\`:\n${imagesList}${overflow}`,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.error(`Error downloading images from ${params.fileKey}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Failed to download images: ${message}`,
        },
      ],
    };
  }
}

function getDescription(imageDir?: string) {
  const baseDir = imageDir ?? process.cwd();
  return `Download Android-density PNG variants of Figma image, icon, and IMAGE-PNG nodes. Defaults to xhdpi (2x) and xxhdpi (3x). Files are saved under <localPath>/mipmap-{bucket}/ relative to the server's image directory: ${baseDir}`;
}

function rejectionDetails(
  reason: ResolveLocalPathFailureReason,
  localPath: string,
  baseDir: string,
): {
  rule: ResolveLocalPathFailureReason;
  userMessage: string;
  telemetryMessage: string;
} {
  switch (reason) {
    case "drive_letter_on_posix":
      return {
        rule: reason,
        telemetryMessage: `Drive-letter path on POSIX server: ${localPath}`,
        userMessage:
          `Invalid path: "${localPath}" starts with a Windows drive letter, but this server is running on POSIX. ` +
          `The server's image directory is "${baseDir}"; pass a path relative to it (e.g., "app/src/main/res").`,
      };
    case "outside_image_dir": {
      const leadingSlashHint = /^[/\\]/.test(localPath)
        ? ` If you meant a directory inside the image directory, drop the leading slash (e.g., use "${localPath.replace(/^[/\\]+/, "")}").`
        : "";
      return {
        rule: reason,
        telemetryMessage: `Path resolves outside allowed image directory: ${localPath}`,
        userMessage:
          `Invalid path: "${localPath}" resolves outside the allowed image directory. ` +
          `The server's image directory is "${baseDir}". Provide a path relative to this directory.` +
          leadingSlashHint,
      };
    }
  }
}

export const downloadFigmaImagesTool = {
  name: "download_figma_images",
  getDescription,
  parametersSchema,
  handler: downloadFigmaImages,
} as const;
