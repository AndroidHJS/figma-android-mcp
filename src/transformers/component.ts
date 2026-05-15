import type { Component, ComponentSet } from "@figma/rest-api-spec";

export interface SimplifiedPropertyDefinition {
  type: string;
  defaultValue: boolean | string;
  variantOptions?: string[];
  preferredValues?: { type: string; key: string }[];
}

export interface SimplifiedComponentDefinition {
  id: string;
  key: string;
  name: string;
  componentSetId?: string;
  propertyDefinitions?: Record<string, SimplifiedPropertyDefinition>;
  variantAssignments?: Record<string, string>;
}

export interface SimplifiedComponentSetDefinition {
  id: string;
  key: string;
  name: string;
  description?: string;
  propertyDefinitions?: Record<string, SimplifiedPropertyDefinition>;
}

/**
 * Strip the #nodeId suffix from Figma property names.
 * "On Sale#341:0" → "On Sale"
 */
export function stripPropertyNameSuffix(name: string): string {
  const hashIndex = name.indexOf("#");
  return hashIndex === -1 ? name : name.substring(0, hashIndex);
}

/**
 * Simplify componentPropertyDefinitions from the raw Figma format to a flat
 * Record of property name → default value. Handles BOOLEAN, TEXT, VARIANT,
 * and INSTANCE_SWAP types.
 */
export function simplifyPropertyDefinitions(
  definitions: Record<string, { type: string; defaultValue: boolean | string; variantOptions?: string[]; preferredValues?: { type: string; key: string }[] }>,
): Record<string, SimplifiedPropertyDefinition> {
  const result: Record<string, SimplifiedPropertyDefinition> = {};
  for (const [name, def] of Object.entries(definitions)) {
    if (def.type === "BOOLEAN" || def.type === "TEXT" || def.type === "VARIANT" || def.type === "INSTANCE_SWAP") {
      const simplified: SimplifiedPropertyDefinition = {
        type: def.type.toLowerCase(),
        defaultValue: def.defaultValue,
      };
      if (def.type === "VARIANT" && def.variantOptions) {
        simplified.variantOptions = def.variantOptions;
      }
      if (def.type === "INSTANCE_SWAP" && def.preferredValues) {
        simplified.preferredValues = def.preferredValues;
      }
      result[stripPropertyNameSuffix(name)] = simplified;
    }
  }
  return result;
}

/**
 * Simplify componentPropertyReferences from the raw Figma format.
 * Strips #nodeId suffixes from property names and renames "characters" key to "text"
 * to match SimplifiedNode's text field.
 */
export function simplifyPropertyReferences(
  references: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(references)) {
    const outputKey = key === "characters" ? "text" : key;
    result[outputKey] = stripPropertyNameSuffix(value);
  }
  return result;
}

/**
 * Simplify instance componentProperties from the verbose Figma format to a flat
 * Record of property name → value. Handles BOOLEAN, TEXT, VARIANT, and INSTANCE_SWAP.
 */
export function simplifyComponentProperties(
  properties: Record<string, { type: string; value: boolean | string }>,
): Record<string, boolean | string> {
  const result: Record<string, boolean | string> = {};
  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type === "BOOLEAN" || prop.type === "TEXT" || prop.type === "VARIANT" || prop.type === "INSTANCE_SWAP") {
      result[stripPropertyNameSuffix(name)] = prop.value;
    }
  }
  return result;
}

/**
 * Parse Figma's variant-axis encoding from a COMPONENT name inside a COMPONENT_SET.
 * Figma encodes variant assignments as "Size=Medium, State=Default" in the name.
 * Returns undefined if there are no assignments (standalone component or malformed name).
 *
 * If a property value contains a comma, this parsing will mis-split; but Figma's own
 * naming conventions prevent commas in variant values, so we don't over-engineer here.
 */
export function parseVariantNameAssignments(name: string): Record<string, string> | undefined {
  if (!name.includes("=")) return undefined;
  const result: Record<string, string> = {};
  const parts = name.split(", ");
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) return undefined;
    const key = part.substring(0, eqIndex).trim();
    const value = part.substring(eqIndex + 1).trim();
    // Strip potential #nodeId suffix from the value (e.g. "Medium#1:0" → "Medium")
    result[stripPropertyNameSuffix(key)] = stripPropertyNameSuffix(value);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Remove unnecessary component properties and convert to simplified format.
 */
export function simplifyComponents(
  aggregatedComponents: Record<string, Component>,
  propertyDefinitions?: Record<string, Record<string, SimplifiedPropertyDefinition>>,
): Record<string, SimplifiedComponentDefinition> {
  return Object.fromEntries(
    Object.entries(aggregatedComponents).map(([id, comp]) => {
      const simplified: SimplifiedComponentDefinition = {
        id,
        key: comp.key,
        name: comp.name,
        componentSetId: comp.componentSetId,
        ...(propertyDefinitions?.[id] && {
          propertyDefinitions: propertyDefinitions[id],
        }),
      };

      // Parse variant-axis assignments for components inside a COMPONENT_SET
      if (comp.componentSetId) {
        const assignments = parseVariantNameAssignments(comp.name);
        if (assignments) {
          simplified.variantAssignments = assignments;
        }
      }

      return [id, simplified];
    }),
  );
}

/**
 * Remove unnecessary component set properties and convert to simplified format.
 */
export function simplifyComponentSets(
  aggregatedComponentSets: Record<string, ComponentSet>,
  propertyDefinitions?: Record<string, Record<string, SimplifiedPropertyDefinition>>,
): Record<string, SimplifiedComponentSetDefinition> {
  return Object.fromEntries(
    Object.entries(aggregatedComponentSets).map(([id, set]) => [
      id,
      {
        id,
        key: set.key,
        name: set.name,
        description: set.description,
        ...(propertyDefinitions?.[id] && {
          propertyDefinitions: propertyDefinitions[id],
        }),
      },
    ]),
  );
}
