import type { SimplifiedLayout } from "~/transformers/layout.js";
import { mapToCompose } from "./compose.js";
import { mapToViews } from "./views.js";
import type { ComposeLayout, Platform, PlatformLayout, ViewsLayout } from "./types.js";

export type { ComposeLayout, ViewsLayout, PlatformLayout, Platform } from "./types.js";

/**
 * Map a CSS-flex layout object to platform-native terminology.
 */
export function mapLayout(layout: SimplifiedLayout, platform: Platform): ComposeLayout | ViewsLayout {
  if (platform === "views") {
    return mapToViews(layout);
  }
  return mapToCompose(layout);
}

/**
 * Transform all SimplifiedLayout entries in globalVars.styles to platform-native
 * equivalents. Nodes reference layout styles by string IDs like `layout_XXXXXX`,
 * so mutating the style values in-place automatically affects all referencing
 * nodes — no tree walk needed.
 */
export function mapLayoutStyles(
  globalVars: { styles: Record<string, unknown> },
  platform: Platform,
): void {
  for (const [key, value] of Object.entries(globalVars.styles)) {
    if (isSimplifiedLayout(value)) {
      const mapped = mapLayout(value, platform);
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(mapped)) {
        if (v !== undefined) {
          clean[k] = v;
        }
      }
      globalVars.styles[key] = clean;
    }
  }
}

function isSimplifiedLayout(value: unknown): value is SimplifiedLayout {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "mode" in value
  );
}
