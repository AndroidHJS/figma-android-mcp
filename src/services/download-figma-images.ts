import path from "path";
import type { Transform } from "@figma/rest-api-spec";
import type { FigmaService } from "~/services/figma.js";
import type { ImageProcessingResult } from "~/utils/image-processing.js";
import { ANDROID_DENSITIES, type AndroidDensity } from "~/utils/units.js";
import { tagError } from "~/utils/error-meta.js";
import { deduplicateImages } from "~/utils/dedup-images.js";
import fs from "fs";

/**
 * Structural shape for a single download request. Matches the relevant
 * fields of the tool's zod schema without coupling the core to the schema
 * itself — callers can pass any object that conforms.
 */
export type DownloadImageNode = {
  nodeId: string;
  imageRef?: string;
  gifRef?: string;
  fileName: string;
  needsCropping?: boolean;
  cropTransform?: Transform;
  requiresImageDimensions?: boolean;
  filenameSuffix?: string;
};

export type DownloadFigmaImagesInput = {
  fileKey: string;
  nodes: DownloadImageNode[];
  localPath: string;
  densities: AndroidDensity[];
};

export type PerDensityDownload = {
  density: AndroidDensity;
  filePath: string;
  finalDimensions: { width: number; height: number };
  wasCropped: boolean;
  cssVariables?: string;
};

/** A density bucket that was skipped because Figma could not render at the requested scale. */
export type DensitySkipped = {
  density: AndroidDensity;
  reason: "figma-api-returned-empty" | "figma-api-error";
};

export type DownloadFigmaImagesResult = {
  downloads: Array<{
    perDensity: PerDensityDownload[];
    requestedFileNames: string[];
  }>;
  successCount: Record<string, number>;
  duplicatesRemoved: number;
  /**
   * Maps requested filenames to the actual file on disk.
   * Built from two sources:
   * - Phase 1 request dedup (same imageRef → one download, multiple filenames)
   * - Phase 3 content-hash dedup (different nodes render identically)
   * When a key exists here, the caller should use the value as the real filename.
   */
  aliasMap: Record<string, string>;
  /** Density buckets that were skipped because Figma could not render at the requested scale. */
  fallbacks: DensitySkipped[];
};

export type DownloadImagesOutcome = {
  input: DownloadFigmaImagesInput;
  durationMs: number;
  imageCount: number;
  successCount?: Record<string, number>;
  fallbacks?: DensitySkipped[];
  error?: unknown;
};

export type DownloadFigmaImagesHooks = {
  onDownloadStart?: (downloadCount: number) => void | Promise<void>;
  onDownloadComplete?: () => void;
  onComplete?: (outcome: DownloadImagesOutcome) => void;
};

/**
 * Shared pipeline for "download figma images": resolve the set of unique
 * downloads, invoke the Figma service for each Android density bucket, and
 * return per-density results keyed back to the original requested filenames.
 */
export async function downloadFigmaImages(
  figmaService: FigmaService,
  input: DownloadFigmaImagesInput,
  hooks: DownloadFigmaImagesHooks = {},
): Promise<DownloadFigmaImagesResult> {
  const startedAt = Date.now();
  const imageCount = input.nodes.length;
  let successCount: Record<string, number> | undefined;
  let fallbacks: DensitySkipped[] | undefined;
  let caughtError: unknown;

  try {
    const { fileKey, nodes, localPath, densities } = input;

    // Resolve the set of unique downloads and track which requested
    // filenames each one satisfies (so the caller can render aliases).
    const downloadItems: Array<{
      fileName: string;
      needsCropping: boolean;
      cropTransform?: Transform;
      requiresImageDimensions: boolean;
      imageRef?: string;
      gifRef?: string;
      nodeId?: string;
    }> = [];
    const downloadToRequests = new Map<number, string[]>();
    const seenDownloads = new Map<string, number>();

    for (const rawNode of nodes) {
      const { nodeId: rawNodeId, ...node } = rawNode;

      // Replace - with : in nodeId for our query — Figma API expects :.
      const nodeId = rawNodeId?.replace(/-/g, ":");

      let finalFileName = node.fileName;
      if (node.filenameSuffix && !finalFileName.includes(node.filenameSuffix)) {
        const ext = finalFileName.split(".").pop();
        const nameWithoutExt = finalFileName.substring(0, finalFileName.lastIndexOf("."));
        finalFileName = `${nameWithoutExt}-${node.filenameSuffix}.${ext}`;
      }

      const downloadItem = {
        fileName: finalFileName,
        needsCropping: node.needsCropping || false,
        cropTransform: node.cropTransform,
        requiresImageDimensions: node.requiresImageDimensions || false,
      };

      if (node.gifRef) {
        const downloadIndex = downloadItems.length;
        downloadItems.push({ ...downloadItem, gifRef: node.gifRef });
        downloadToRequests.set(downloadIndex, [finalFileName]);
      } else if (node.imageRef) {
        const uniqueKey = `${node.imageRef}-${node.filenameSuffix || "none"}`;

        if (!node.filenameSuffix && seenDownloads.has(uniqueKey)) {
          const downloadIndex = seenDownloads.get(uniqueKey)!;
          const requests = downloadToRequests.get(downloadIndex)!;
          if (!requests.includes(finalFileName)) {
            requests.push(finalFileName);
          }

          if (downloadItem.requiresImageDimensions) {
            downloadItems[downloadIndex].requiresImageDimensions = true;
          }
        } else {
          const downloadIndex = downloadItems.length;
          downloadItems.push({ ...downloadItem, imageRef: node.imageRef });
          downloadToRequests.set(downloadIndex, [finalFileName]);
          seenDownloads.set(uniqueKey, downloadIndex);
        }
      } else {
        const downloadIndex = downloadItems.length;
        downloadItems.push({ ...downloadItem, nodeId });
        downloadToRequests.set(downloadIndex, [finalFileName]);
      }
    }

    const totalPerDensity = downloadItems.length * densities.length;
    await hooks.onDownloadStart?.(totalPerDensity);

    // Download per density bucket
    const allResults: Array<PerDensityDownload[]> = downloadItems.map(() => []);
    fallbacks = [];

    for (const density of densities) {
      const scale = ANDROID_DENSITIES[density];
      const densityDir = path.join(localPath, `mipmap-${density}`);
      fs.mkdirSync(densityDir, { recursive: true });

      let densityResults: ImageProcessingResult[] = [];
      let failed = false;
      let reason: "figma-api-returned-empty" | "figma-api-error" = "figma-api-returned-empty";

      try {
        densityResults = await figmaService.downloadImages(
          fileKey,
          densityDir,
          downloadItems,
          { pngScale: scale },
        );
      } catch (error) {
        tagError(error, { phase: "download" });
        failed = true;
        reason = "figma-api-error";
      }

      if (failed || densityResults.length === 0) {
        try { fs.rmdirSync(densityDir); } catch { /* directory not empty or in use, leave it */ }
        fallbacks.push({ density, reason });
        continue;
      }

      for (let i = 0; i < densityResults.length; i++) {
        allResults[i].push({
          density,
          filePath: densityResults[i].filePath,
          finalDimensions: densityResults[i].finalDimensions,
          wasCropped: densityResults[i].wasCropped,
          cssVariables: densityResults[i].cssVariables,
        });
      }
    }

    hooks.onDownloadComplete?.();

    // Deduplicate identical images by content hash
    const dedupResult = deduplicateImages(allResults);

    successCount = {};
    let totalSuccess = 0;
    for (const perItem of dedupResult.results) {
      for (const r of perItem) {
        successCount[r.density] = (successCount[r.density] || 0) + 1;
        totalSuccess++;
      }
    }
    const successForOutcome: Record<string, number> = { ...successCount, total: totalSuccess };

    const downloads = dedupResult.results.map((perDensity, index) => ({
      perDensity,
      requestedFileNames: downloadToRequests.get(dedupResult.keptIndices[index]) ?? [],
    }));

    // Build combined alias map: every filename the caller might reference → actual file on disk.
    const aliasMap: Record<string, string> = {};

    // Phase 1: same imageRef produced one download for multiple requested filenames.
    for (const download of downloads) {
      const [primary, ...aliases] = download.requestedFileNames;
      for (const alias of aliases) {
        aliasMap[alias] = primary;
      }
    }

    // Phase 3: content-hash dedup merged different downloads into one file.
    Object.assign(aliasMap, dedupResult.dedupMap);

    return {
      downloads,
      successCount: successForOutcome,
      duplicatesRemoved: dedupResult.duplicateCount,
      aliasMap,
      fallbacks,
    };
  } catch (error) {
    caughtError = error;
    throw error;
  } finally {
    if (hooks.onComplete) {
      try {
        hooks.onComplete({
          input,
          durationMs: Date.now() - startedAt,
          imageCount,
          successCount,
          fallbacks,
          error: caughtError,
        });
      } catch {
        // intentionally empty
      }
    }
  }
}
