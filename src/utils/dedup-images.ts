import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { PerDensityDownload } from "~/services/download-figma-images.js";

export type DedupResult = {
  results: PerDensityDownload[][];
  /** Original indices of download items that survived dedup (non-empty after removing duplicates). */
  keptIndices: number[];
  duplicateCount: number;
  /**
   * Maps removed filenames (basename) → kept filenames (basename).
   * When a file is deleted because its content hash matches an earlier file,
   * this records which filename to use instead.
   */
  dedupMap: Record<string, string>;
};

/**
 * Scans downloaded image files by SHA256 hash and removes duplicates.
 * When multiple files share the same hash, the first one (by insertion order)
 * is kept and the rest are deleted from disk.
 */
export function deduplicateImages(allResults: PerDensityDownload[][]): DedupResult {
  const hashToFirst = new Map<string, PerDensityDownload>();
  let duplicateCount = 0;
  const dedupMap: Record<string, string> = {};

  for (const perItem of allResults) {
    for (let i = perItem.length - 1; i >= 0; i--) {
      const entry = perItem[i];
      const filePath = entry.filePath;
      if (!filePath || !fs.existsSync(filePath)) continue;

      const hash = sha256File(filePath);
      const existing = hashToFirst.get(hash);
      if (existing) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // File already gone or locked; skip
        }
        duplicateCount++;
        const removedName = path.basename(filePath);
        const keptName = path.basename(existing.filePath);
        if (removedName !== keptName) {
          dedupMap[removedName] = keptName;
        }
        perItem.splice(i, 1);
      } else {
        hashToFirst.set(hash, entry);
      }
    }
  }

  const results: PerDensityDownload[][] = [];
  const keptIndices: number[] = [];
  for (let i = 0; i < allResults.length; i++) {
    if (allResults[i].length > 0) {
      results.push(allResults[i]);
      keptIndices.push(i);
    }
  }

  return { results, keptIndices, duplicateCount, dedupMap };
}

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}
