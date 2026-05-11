import path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/telemetry/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/telemetry/index.js")>();
  return {
    ...actual,
    captureDownloadImagesCall: vi.fn(),
    captureValidationReject: vi.fn(),
  };
});

// vi.mock factories run before module-scope `const`s are initialized, so the
// mock fn needs to live inside vi.hoisted to be referenceable in the factory.
const { runDownloadFigmaImagesMock } = vi.hoisted(() => ({
  runDownloadFigmaImagesMock: vi.fn(),
}));
vi.mock("~/services/download-figma-images.js", () => ({
  downloadFigmaImages: runDownloadFigmaImagesMock,
}));

import { downloadFigmaImagesTool } from "~/mcp/tools/download-figma-images-tool.js";
import type { ToolExtra } from "~/mcp/progress.js";

const stubFigmaService = {} as Parameters<typeof downloadFigmaImagesTool.handler>[1];

const stubExtra = {
  sendNotification: () => Promise.resolve(),
  signal: AbortSignal.timeout(30_000),
} as unknown as ToolExtra;

const imageDir = path.resolve("/project/root");

const baseParams = {
  fileKey: "abc123",
  densities: ["xhdpi"],
  localPath: "res",
};

describe("download_figma_images onlyExportTagged filter", () => {
  beforeEach(() => {
    runDownloadFigmaImagesMock.mockReset();
    runDownloadFigmaImagesMock.mockResolvedValue({
      downloads: [],
      successCount: { total: 0 },
      duplicatesRemoved: 0,
    });
  });

  it("forwards only export-tagged nodes when onlyExportTagged is true", async () => {
    const result = await downloadFigmaImagesTool.handler(
      {
        ...baseParams,
        nodes: [
          { nodeId: "1:1", fileName: "icon.png", category: "export-tagged" },
          { nodeId: "1:2", fileName: "bg.png", category: "auto-detected" },
          { nodeId: "1:3", fileName: "logo.png", category: "export-tagged" },
        ],
        onlyExportTagged: true,
      },
      stubFigmaService,
      imageDir,
      "stdio",
      "api_key",
      undefined,
      stubExtra,
    );

    expect(result.isError).toBeUndefined();
    expect(runDownloadFigmaImagesMock).toHaveBeenCalledOnce();
    const forwarded = runDownloadFigmaImagesMock.mock.calls[0][1].nodes;
    expect(forwarded.map((n: { nodeId: string }) => n.nodeId)).toEqual([
      "1:1",
      "1:3",
    ]);
  });

  it("returns a friendly notice without hitting Figma when no node matches", async () => {
    const result = await downloadFigmaImagesTool.handler(
      {
        ...baseParams,
        nodes: [
          { nodeId: "1:1", fileName: "bg.png", category: "auto-detected" },
          // Missing category is treated as not export-tagged.
          { nodeId: "1:2", fileName: "logo.png" },
        ],
        onlyExportTagged: true,
      },
      stubFigmaService,
      imageDir,
      "stdio",
      "api_key",
      undefined,
      stubExtra,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { text: string }).text).toContain(
      "No export-tagged nodes to download",
    );
    expect(runDownloadFigmaImagesMock).not.toHaveBeenCalled();
  });

  it("forwards every node when onlyExportTagged is omitted", async () => {
    const result = await downloadFigmaImagesTool.handler(
      {
        ...baseParams,
        nodes: [
          { nodeId: "1:1", fileName: "icon.png", category: "export-tagged" },
          { nodeId: "1:2", fileName: "bg.png", category: "auto-detected" },
        ],
      },
      stubFigmaService,
      imageDir,
      "stdio",
      "api_key",
      undefined,
      stubExtra,
    );

    expect(result.isError).toBeUndefined();
    expect(runDownloadFigmaImagesMock).toHaveBeenCalledOnce();
    const forwarded = runDownloadFigmaImagesMock.mock.calls[0][1].nodes;
    expect(forwarded).toHaveLength(2);
  });
});
