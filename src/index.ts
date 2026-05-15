// Re-export extractor types only
export type { SimplifiedDesign, ImageAsset } from "./extractors/types.js";

// Flexible extractor system
export type {
  ExtractorFn,
  TraversalContext,
  TraversalOptions,
  GlobalVars,
  StyleTypes,
} from "./extractors/index.js";

export {
  extractFromDesign,
  simplifyRawFigmaObject,
  layoutExtractor,
  textExtractor,
  visualsExtractor,
  componentExtractor,
  allExtractors,
  layoutAndText,
  contentOnly,
  visualsOnly,
  layoutOnly,
  collapseRasterContainers,
} from "./extractors/index.js";

export { inferAutoLayoutFromPositions } from "./transformers/layout.js";
