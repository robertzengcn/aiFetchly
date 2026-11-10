import { z } from "zod";
import type {
  PluginMarketplaceError,
  PluginMarketplaceManifest,
} from "@/entityTypes/pluginMarketplaceTypes";

export const MARKETPLACE_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
export const MARKETPLACE_PLUGIN_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
export const MARKETPLACE_LIMITS = {
  maxManifestBytes: 5 * 1024 * 1024,
  maxPlugins: 5000,
  maxStringLength: 4096,
} as const;

const shaRegex = /^[a-f0-9]{40}$/i;

const ownerSchema = z
  .object({
    name: z.string().min(1).max(256),
    email: z.string().email().max(320).optional(),
    url: z.string().url().max(2048).optional(),
  })
  .passthrough();

const entrySourceSchema = z.union([
  z.string().min(1).max(4096),
  z
    .object({
      source: z.literal("github"),
      repo: z.string().min(1).max(512),
      ref: z.string().max(256).optional(),
      sha: z.string().regex(shaRegex).optional(),
    })
    .passthrough(),
  z
    .object({
      source: z.literal("url"),
      url: z.string().min(1).max(4096),
      ref: z.string().max(256).optional(),
      sha: z.string().regex(shaRegex).optional(),
    })
    .passthrough(),
  z
    .object({
      source: z.literal("git-subdir"),
      url: z.string().min(1).max(4096),
      path: z.string().min(1).max(2048),
      ref: z.string().max(256).optional(),
      sha: z.string().regex(shaRegex).optional(),
    })
    .passthrough(),
  z
    .object({
      source: z.literal("npm"),
      package: z.string().min(1).max(512),
      version: z.string().max(256).optional(),
      registry: z.string().url().max(2048).optional(),
    })
    .passthrough(),
]);

const entrySchema = z
  .object({
    name: z.string().regex(MARKETPLACE_PLUGIN_NAME_REGEX).max(256),
    displayName: z.string().max(256).optional(),
    description: z.string().max(2048).optional(),
    version: z.string().max(128).optional(),
    source: entrySourceSchema,
    tags: z.array(z.string().max(64)).max(64).optional(),
    keywords: z.array(z.string().max(64)).max(64).optional(),
    category: z.string().max(128).optional(),
  })
  .passthrough();

const marketplaceSchema = z
  .object({
    name: z.string().regex(MARKETPLACE_NAME_REGEX).max(256),
    owner: ownerSchema,
    description: z.string().max(2048).optional(),
    version: z.string().max(128).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    plugins: z.array(entrySchema).max(MARKETPLACE_LIMITS.maxPlugins),
    renames: z.record(z.string(), z.string().nullable()).optional(),
    allowCrossMarketplaceDependenciesOn: z.array(z.string()).optional(),
  })
  .passthrough();

export type ValidationResult =
  | { success: true; manifest: PluginMarketplaceManifest }
  | { success: false; errors: PluginMarketplaceError[] };

function marketError(
  code: PluginMarketplaceError["code"],
  message: string,
  extras: Partial<PluginMarketplaceError> = {}
): PluginMarketplaceError {
  return { code, message, recoverable: false, ...extras };
}

function containsControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 10 || code === 13 || code <= 31) {
      return true;
    }
  }
  return false;
}

/**
 * Two-stage: (1) zod parse of the raw JSON string, (2) post-schema checks
 * (duplicate entry names, relative-source shape, control chars). Unknown
 * fields are preserved (passthrough) for future Claude compatibility.
 */
export function validateMarketplaceManifest(rawJson: string): ValidationResult {
  if (rawJson.length > MARKETPLACE_LIMITS.maxManifestBytes) {
    return {
      success: false,
      errors: [
        marketError(
          "marketplace-schema-invalid",
          `Manifest exceeds ${MARKETPLACE_LIMITS.maxManifestBytes} bytes.`
        ),
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      success: false,
      errors: [
        marketError(
          "marketplace-manifest-invalid-json",
          "Manifest is not valid JSON."
        ),
      ],
    };
  }

  const zodResult = marketplaceSchema.safeParse(parsed);
  if (!zodResult.success) {
    const msg = zodResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      success: false,
      errors: [marketError("marketplace-schema-invalid", msg)],
    };
  }

  const manifest = zodResult.data as PluginMarketplaceManifest;

  // Post-schema checks.
  const errors: PluginMarketplaceError[] = [];
  const seen = new Set<string>();
  for (const entry of manifest.plugins) {
    if (seen.has(entry.name)) {
      errors.push(
        marketError(
          "marketplace-plugin-entry-invalid",
          `Duplicate plugin entry name "${entry.name}".`,
          { pluginName: entry.name }
        )
      );
    }
    seen.add(entry.name);

    if (typeof entry.source === "string") {
      if (!entry.source.startsWith("./")) {
        errors.push(
          marketError(
            "marketplace-plugin-entry-invalid",
            `Entry "${entry.name}" source must start with "./".`,
            { pluginName: entry.name }
          )
        );
      }
      if (containsControlCharacter(entry.source)) {
        errors.push(
          marketError(
            "marketplace-plugin-entry-invalid",
            `Entry "${entry.name}" source contains control characters.`,
            { pluginName: entry.name }
          )
        );
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }
  return { success: true, manifest };
}
