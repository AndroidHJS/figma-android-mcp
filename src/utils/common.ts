import fs from "fs";
import path from "path";
import { tagError } from "~/utils/error-meta.js";
import { isWithin } from "~/utils/local-path.js";
import { getConnectionErrorCode } from "~/utils/fetch-json.js";

export type StyleId = `${string}_${string}` & { __brand: "StyleId" };

/**
 * Download Figma image and save it locally
 * @param fileName - The filename to save as
 * @param localPath - The local path to save to
 * @param imageUrl - Image URL (images[nodeId])
 * @returns A Promise that resolves to the full file path where the image was saved
 * @throws Error if download fails
 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function fetchWithRetry(
  imageUrl: string,
  retries: number = MAX_RETRIES,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(imageUrl, { method: "GET" });
      return response;
    } catch (error) {
      lastError = error;
      // Only retry on network-level errors (connection refused, timeout, DNS, etc.),
      // not on HTTP error responses (those are returned as ok=false responses).
      if (attempt < retries && getConnectionErrorCode(error)) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export async function downloadFigmaImage(
  fileName: string,
  localPath: string,
  imageUrl: string,
): Promise<string> {
  try {
    // Ensure local path exists
    if (!fs.existsSync(localPath)) {
      fs.mkdirSync(localPath, { recursive: true });
    }

    const fullPath = path.resolve(path.join(localPath, fileName));
    if (!isWithin(localPath, fullPath)) {
      tagError(new Error(`File path escapes target directory: ${fileName}`), {
        category: "invalid_input",
      });
    }

    const response = await fetchWithRetry(imageUrl);

    if (!response.ok) {
      tagError(new Error(`Failed to download image: ${response.statusText}`), {
        category: "image_download",
      });
    }

    const writer = fs.createWriteStream(fullPath);

    const reader = response.body?.getReader();
    if (!reader) {
      tagError(new Error("Failed to get response body"), { category: "image_download" });
    }

    return new Promise((resolve, reject) => {
      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              writer.end();
              break;
            }
            const canContinue = writer.write(value);
            // Handle backpressure: when the internal buffer is full, wait for
            // the drain event before writing more data.
            if (!canContinue) {
              await new Promise<void>((res) => writer.once("drain", res));
            }
          }
        } catch (err) {
          writer.end();
          fs.unlink(fullPath, () => {});
          reject(err);
        }
      };

      writer.on("finish", () => {
        resolve(fullPath);
      });

      writer.on("error", (err) => {
        reader.cancel();
        fs.unlink(fullPath, () => {});
        reject(new Error(`Failed to write image: ${err.message}`));
      });

      processStream();
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const networkCode = getConnectionErrorCode(error);
    if (networkCode) {
      throw new Error(
        `${errorMessage}\n\nCould not connect to the Figma CDN. If your network requires a proxy, ` +
          `set the --proxy flag in your MCP server config or the FIGMA_PROXY environment variable ` +
          `to your proxy URL (e.g. http://proxy:8080).`,
        { cause: error },
      );
    }
    throw new Error(`Error downloading image: ${errorMessage}`, { cause: error });
  }
}

/**
 * Remove keys with empty arrays or empty objects from an object.
 * @param input - The input object or value.
 * @returns The processed object or the original value.
 */
export function removeEmptyKeys<T>(input: T): T {
  // If not an object type or null, return directly
  if (typeof input !== "object" || input === null) {
    return input;
  }

  // Handle array type
  if (Array.isArray(input)) {
    return input.map((item) => removeEmptyKeys(item)) as T;
  }

  // Handle object type
  const result = {} as T;
  for (const key in input) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      const value = input[key];

      // Recursively process nested objects
      const cleanedValue = removeEmptyKeys(value);

      // Skip empty arrays and empty objects
      if (
        cleanedValue !== undefined &&
        !(Array.isArray(cleanedValue) && cleanedValue.length === 0) &&
        !(
          typeof cleanedValue === "object" &&
          cleanedValue !== null &&
          Object.keys(cleanedValue).length === 0
        )
      ) {
        result[key] = cleanedValue;
      }
    }
  }

  return result;
}

/**
 * Generate a 6-character random variable ID
 * @param prefix - ID prefix
 * @returns A 6-character random ID string with prefix
 */
export function generateVarId(prefix: string = "var"): StyleId {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";

  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }

  return `${prefix}_${result}` as StyleId;
}

/**
 * Generate a CSS shorthand for values that come with top, right, bottom, and left
 *
 * input: { top: 10, right: 10, bottom: 10, left: 10 }
 * output: "10px"
 *
 * input: { top: 10, right: 20, bottom: 10, left: 20 }
 * output: "10px 20px"
 *
 * input: { top: 10, right: 20, bottom: 30, left: 40 }
 * output: "10px 20px 30px 40px"
 *
 * @param values - The values to generate the shorthand for
 * @returns The generated shorthand
 */
export function generateShorthand(
  values: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  },
  {
    ignoreZero = true,
    suffix = "dp",
  }: {
    /**
     * If true and all values are 0, return undefined. Defaults to true.
     */
    ignoreZero?: boolean;
    /**
     * The suffix to add to the shorthand. Defaults to "dp".
     */
    suffix?: string;
  } = {},
) {
  const { top, right, bottom, left } = values;
  if (ignoreZero && top === 0 && right === 0 && bottom === 0 && left === 0) {
    return undefined;
  }
  if (top === right && right === bottom && bottom === left) {
    return `${top}${suffix}`;
  }
  if (right === left) {
    if (top === bottom) {
      return `${top}${suffix} ${right}${suffix}`;
    }
    return `${top}${suffix} ${right}${suffix} ${bottom}${suffix}`;
  }
  return `${top}${suffix} ${right}${suffix} ${bottom}${suffix} ${left}${suffix}`;
}

/**
 * Check if an element is visible
 * @param element - The item to check
 * @returns True if the item is visible, false otherwise
 */
export function isVisible(element: { visible?: boolean }): boolean {
  return element.visible ?? true;
}

/**
 * Check if a node name matches a known mobile system UI pattern.
 * Status bars and home indicators are OS-provided elements that appear in
 * Figma mockups as visual reference but are never part of app code.
 */
export function isSystemUi(element: { name?: string }): boolean {
  if (!element.name) return false;
  return /status\s*bar|home\s*indicator/i.test(element.name);
}

/**
 * Convert a Figma node name to a safe Android image filename.
 * Lowercases, replaces non-alphanumeric chars with underscores, appends ".png".
 *
 *   "Home Indicator - On Light" → "home_indicator_on_light.png"
 *   "进度条的 component"      → "component.png"
 *   "Rectangle 378"           → "rectangle_378.png"
 */
export function toImageFileName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_");
  return `${sanitized || "image"}.png`;
}

/**
 * Rounds a number to two decimal places, suitable for pixel value processing.
 * @param num The number to be rounded.
 * @returns The rounded number with two decimal places.
 * @throws TypeError If the input is not a valid number
 */
export function pixelRound(num: number): number {
  if (isNaN(num)) {
    throw new TypeError(`Input must be a valid number`);
  }
  return Number(Number(num).toFixed(2));
}

/**
 * Serialize a value to JSON with sorted object keys so two equal-but-
 * differently-ordered objects produce the same string. Used for cache keys
 * and deep-equality checks where property order isn't a stable guarantee
 * (e.g. partial TypeStyle entries from Figma's styleOverrideTable).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}
