import type {
  GetImagesResponse,
  GetFileResponse,
  GetFileNodesResponse,
  GetImageFillsResponse,
  Transform,
} from "@figma/rest-api-spec";
import { downloadAndProcessImage, type ImageProcessingResult } from "~/utils/image-processing.js";
import { Logger, writeLogs } from "~/utils/logger.js";
import { fetchJSON } from "~/utils/fetch-json.js";
import { getErrorMeta } from "~/utils/error-meta.js";
import { buildForbiddenMessage, buildRateLimitMessage } from "./errors/index.js";

export type FigmaAuthOptions = {
  figmaApiKey: string;
  figmaOAuthToken: string;
  useOAuth: boolean;
};

export class FigmaService {
  private readonly apiKey: string;
  private readonly oauthToken: string;
  private readonly useOAuth: boolean;
  private readonly baseUrl = "https://api.figma.com/v1";

  constructor({ figmaApiKey, figmaOAuthToken, useOAuth }: FigmaAuthOptions) {
    this.apiKey = figmaApiKey || "";
    this.oauthToken = figmaOAuthToken || "";
    this.useOAuth = !!useOAuth && !!this.oauthToken;
  }

  private getAuthHeaders(): Record<string, string> {
    if (this.useOAuth) {
      Logger.log("Using OAuth Bearer token for authentication");
      return { Authorization: `Bearer ${this.oauthToken}` };
    }

    if (!this.apiKey) {
      throw new Error(
        "Figma API authentication is required. Configure FIGMA_API_KEY or FIGMA_OAUTH_TOKEN on the server, or send X-Figma-Token on the HTTP request.",
      );
    }

    Logger.log("Using Personal Access Token for authentication");
    return { "X-Figma-Token": this.apiKey };
  }

  /**
   * Filters out null values from Figma image responses. This ensures we only work with valid image URLs.
   */
  private filterValidImages(
    images: { [key: string]: string | null } | undefined,
  ): Record<string, string> {
    if (!images) return {};
    return Object.fromEntries(Object.entries(images).filter(([, value]) => !!value)) as Record<
      string,
      string
    >;
  }

  private async request<T>(endpoint: string): Promise<T> {
    const { data } = await this.requestWithSize<T>(endpoint);
    return data;
  }

  /**
   * Like `request`, but also surfaces the raw response body size so callers
   * can record it for telemetry. Only used by endpoints whose payload size
   * we care about (`getRawFile` / `getRawNode`); image-fetching endpoints
   * continue to use `request` unchanged.
   */
  private async requestWithSize<T>(endpoint: string): Promise<{ data: T; rawSize: number }> {
    try {
      Logger.log(`Calling ${this.baseUrl}${endpoint}`);
      const headers = this.getAuthHeaders();

      return await fetchJSON<T & { status?: number }>(`${this.baseUrl}${endpoint}`, {
        headers,
        redactFromResponseBody: [this.apiKey, this.oauthToken],
      });
    } catch (error) {
      const meta = getErrorMeta(error);
      if (meta.http_status === 429) {
        throw new Error(buildRateLimitMessage(error), { cause: error });
      }
      if (meta.http_status === 403) {
        throw new Error(buildForbiddenMessage(endpoint, error), { cause: error });
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to make request to Figma API endpoint '${endpoint}': ${errorMessage}`,
        { cause: error },
      );
    }
  }

  /**
   * Gets download URLs for image fills without downloading them.
   *
   * @returns Map of imageRef to download URL
   */
  async getImageFillUrls(fileKey: string): Promise<Record<string, string>> {
    const endpoint = `/files/${fileKey}/images`;
    const response = await this.request<GetImageFillsResponse>(endpoint);
    return response.meta.images || {};
  }

  /**
   * Gets download URLs for rendered nodes as PNG only.
   *
   * @returns Map of node ID to download URL
   */
  async getNodeRenderUrls(
    fileKey: string,
    nodeIds: string[],
    pngScale: number = 2,
  ): Promise<Record<string, string>> {
    if (nodeIds.length === 0) return {};
    const endpoint = `/images/${fileKey}?ids=${nodeIds.join(",")}&format=png&scale=${pngScale}`;
    const response = await this.request<GetImagesResponse>(endpoint);
    return this.filterValidImages(response.images);
  }

  /**
   * Download images as PNG with post-processing support.
   * All rendered nodes are fetched as PNG at the specified scale.
   */
  async downloadImages(
    fileKey: string,
    localPath: string,
    items: Array<{
      imageRef?: string;
      gifRef?: string;
      nodeId?: string;
      fileName: string;
      needsCropping?: boolean;
      cropTransform?: Transform;
      requiresImageDimensions?: boolean;
    }>,
    options: { pngScale?: number } = {},
  ): Promise<ImageProcessingResult[]> {
    if (items.length === 0) return [];

    const resolvedPath = localPath;
    const { pngScale = 2 } = options;
    const downloadPromises: Promise<ImageProcessingResult[]>[] = [];

    // Separate items by type: image/gif fills vs rendered nodes
    const imageFills = items.filter(
      (item): item is typeof item & ({ imageRef: string } | { gifRef: string }) =>
        !!item.imageRef || !!item.gifRef,
    );
    const renderNodes = items.filter(
      (item): item is typeof item & { nodeId: string } => !!item.nodeId,
    );

    // Download image fills (static images and animated GIFs) with processing
    if (imageFills.length > 0) {
      const fillUrls = await this.getImageFillUrls(fileKey);
      const fillDownloads = imageFills
        .map(
          ({
            imageRef,
            gifRef,
            fileName,
            needsCropping,
            cropTransform,
            requiresImageDimensions,
          }) => {
            const fillRef = gifRef ?? imageRef;
            const imageUrl = fillRef ? fillUrls[fillRef] : undefined;
            return imageUrl
              ? downloadAndProcessImage(
                  fileName,
                  resolvedPath,
                  imageUrl,
                  needsCropping,
                  cropTransform,
                  requiresImageDimensions,
                )
              : null;
          },
        )
        .filter((promise): promise is Promise<ImageProcessingResult> => promise !== null);

      if (fillDownloads.length > 0) {
        downloadPromises.push(Promise.all(fillDownloads));
      }
    }

    // All rendered nodes are downloaded as PNG
    if (renderNodes.length > 0) {
      const pngUrls = await this.getNodeRenderUrls(
        fileKey,
        renderNodes.map((n) => n.nodeId),
        pngScale,
      );
      const pngDownloads = renderNodes
        .map(({ nodeId, fileName, needsCropping, cropTransform, requiresImageDimensions }) => {
          const imageUrl = pngUrls[nodeId];
          return imageUrl
            ? downloadAndProcessImage(
                fileName,
                resolvedPath,
                imageUrl,
                needsCropping,
                cropTransform,
                requiresImageDimensions,
              )
            : null;
        })
        .filter((promise): promise is Promise<ImageProcessingResult> => promise !== null);

      if (pngDownloads.length > 0) {
        downloadPromises.push(Promise.all(pngDownloads));
      }
    }

    const results = await Promise.all(downloadPromises);
    return results.flat();
  }

  /**
   * Get raw Figma API response for a file (for use with flexible extractors).
   *
   * Returns the parsed body alongside the raw body size in bytes so callers
   * can record payload size in telemetry.
   */
  async getRawFile(
    fileKey: string,
    depth?: number | null,
  ): Promise<{ data: GetFileResponse; rawSize: number }> {
    const endpoint = `/files/${fileKey}${depth ? `?depth=${depth}` : ""}`;
    Logger.log(`Retrieving raw Figma file: ${fileKey} (depth: ${depth ?? "default"})`);

    const result = await this.requestWithSize<GetFileResponse>(endpoint);
    writeLogs("figma-raw.json", result.data);

    return result;
  }

  /**
   * Get raw Figma API response for specific nodes (for use with flexible extractors).
   *
   * Returns the parsed body alongside the raw body size in bytes so callers
   * can record payload size in telemetry.
   */
  async getRawNode(
    fileKey: string,
    nodeId: string,
    depth?: number | null,
  ): Promise<{ data: GetFileNodesResponse; rawSize: number }> {
    const endpoint = `/files/${fileKey}/nodes?ids=${nodeId}${depth ? `&depth=${depth}` : ""}`;
    Logger.log(
      `Retrieving raw Figma node: ${nodeId} from ${fileKey} (depth: ${depth ?? "default"})`,
    );

    const result = await this.requestWithSize<GetFileNodesResponse>(endpoint);
    writeLogs("figma-raw.json", result.data);

    return result;
  }

  /**
   * 将 Figma 节点渲染为 PNG 并以 base64 返回，用于在 YAML 设计数据旁提供视觉参考。
   * 任何失败均返回 null，调用方可优雅降级。
   */
  async getNodePreviewImage(
    fileKey: string,
    nodeId: string,
  ): Promise<{ base64: string; mimeType: "image/png" } | null> {
    try {
      const normalizedId = nodeId.replace(/-/g, ":");
      const endpoint = `/images/${fileKey}?ids=${normalizedId}&format=png&scale=2`;
      const response = await this.request<GetImagesResponse>(endpoint);
      const validImages = this.filterValidImages(response.images);
      const imageUrl = validImages[normalizedId];
      if (!imageUrl) return null;

      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) return null;

      const arrayBuffer = await imageResponse.arrayBuffer();
      return { base64: Buffer.from(arrayBuffer).toString("base64"), mimeType: "image/png" };
    } catch {
      return null;
    }
  }
}
