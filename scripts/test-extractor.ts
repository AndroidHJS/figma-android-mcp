/**
 * Test script for the design simplification pipeline using a local JSON file.
 *
 * Reads a raw Figma API response (GetFileNodesResponse) from a local file and
 * runs simplifyRawFigmaObject against it, printing the SimplifiedDesign as JSON.
 *
 * Usage:
 *   pnpm tsx scripts/test-extractor.ts [path-to-raw-json]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  simplifyRawFigmaObject,
  allExtractors,
  collapseRasterContainers,
} from "../src/extractors/index.js";

const inputPath = resolve(process.argv[2] || "temp_figma_raw.json");

if (!existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(inputPath, "utf8"));

function isSystemUi(node: { name: string }): boolean {
  const skipNames = new Set([
    "Home Indicator - On Light",
    "status bar/time",
    "StatusBar",
  ]);
  return skipNames.has(node.name);
}

const design = await simplifyRawFigmaObject(raw, allExtractors, {
  afterChildren: collapseRasterContainers,
  nodeFilter: (node) => !isSystemUi(node),
});

console.log(JSON.stringify(design, null, 2));
