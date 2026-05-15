/**
 * Test script for the design simplification pipeline using a local JSON file.
 *
 * Reads a raw Figma API response (GetFileNodesResponse) from a local file and
 * runs simplifyRawFigmaObject against it, printing the SimplifiedDesign as JSON.
 *
 * Usage:
 *   pnpm tsx src/tests/test-extractor.ts [path-to-raw-json] [--platform views]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  simplifyRawFigmaObject,
  allExtractors,
  collapseRasterContainers,
} from "../extractors/index.js";
import { mapLayoutStyles, type Platform } from "../platform-mappers/index.js";

const args = process.argv.slice(2);
const platformIndex = args.indexOf("--platform");
const platform: Platform = platformIndex !== -1
  ? (args[platformIndex + 1] as Platform) ?? "compose"
  : "compose";
const inputPath = resolve(args.filter((_, i) => i !== platformIndex && i !== platformIndex + 1)[0] || "temp_figma_raw.json");

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

mapLayoutStyles(design.globalVars, platform);
console.log(JSON.stringify(design, null, 2));
