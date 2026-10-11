/**
 * Local AI Runtime — Zod validation schemas for untrusted network/disk JSON.
 *
 * All downloaded JSON is parsed as `unknown` and validated before use
 * (PRD §12.1 / design §8). Type assertions alone are insufficient at the
 * network boundary.
 */
import { z } from "zod";
import semver from "semver";
import { LocalAiRuntimeError } from "@/entityTypes/localAiRuntimeTypes";
import { LOCAL_AI_MODEL_PACKAGE_LIMITS } from "@/service/localAiRuntime/localAiRuntimeConstants";
import {
  LOCAL_AI_RUNTIME_ARTIFACT_PREFIX,
  LOCAL_AI_RUNTIME_ENTRY_RULES,
  LOCAL_AI_RUNTIME_IDS,
  LOCAL_AI_RUNTIME_IDS_V2,
  type GroundingModelManifest,
  type LocalAiRuntimeCatalogV2,
  type LocalAiRuntimeId,
  type ModelCatalogEntryV2,
  type NativeRuntimeCatalogEntryV2,
} from "@/entityTypes/localAiRuntimeTypes";

const runtimeIdSchema = z.enum(LOCAL_AI_RUNTIME_IDS);

const runtimePlatformSchema = z.enum(["win32", "darwin", "linux"]);
const runtimeArchSchema = z.enum(["x64", "arm64"]);

const semverSchema = z
  .string()
  .refine(
    (value) => semver.valid(value) !== null,
    "Expected a valid semantic version."
  );

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 hex digest.");

/**
 * A safe relative path inside a runtime archive: non-empty, no NUL, no
 * absolute/drive/UNC prefixes, no traversal, no backslash escapes. Forward
 * slashes are the canonical ZIP separator.
 */
export function isSafeRelativeRuntimePath(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\0")) return false;
  if (looksAbsolutePathLike(value)) return false;
  // Reject backslashes: ZIP names use forward slashes; a backslash is a strong
  // signal of an escaping attempt on Windows and is never a legit separator.
  if (value.includes("\\")) return false;
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return false;
    if (isWindowsReservedDeviceName(segment)) return false;
  }
  return true;
}

/** Reject Unix-absolute, Windows drive, and UNC path prefixes. */
function looksAbsolutePathLike(value: string): boolean {
  if (value.startsWith("/")) return true;
  if (value.startsWith("\\")) return true;
  // Windows drive prefix (C:\) or UNC (\\server\share)
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith("\\\\")) return true;
  return false;
}

const RESERVED_DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

function isWindowsReservedDeviceName(segment: string): boolean {
  // Device names may have an extension (CON.txt) but no directory form.
  const base = segment.split(".")[0].toUpperCase();
  return RESERVED_DEVICE_NAMES.has(base);
}

const relativeRuntimePathSchema = z
  .string()
  .min(1)
  .refine(isSafeRelativeRuntimePath, "Expected a safe relative runtime path.");

/** Expected archive filename for a runtime target (prefix-driven, §7.3). */
export function expectedArchiveFileName(
  runtimeId: string,
  platform: string,
  arch: string,
  version: string
): string {
  const prefix =
    LOCAL_AI_RUNTIME_ARTIFACT_PREFIX[runtimeId as LocalAiRuntimeId] ??
    (runtimeId === "voice-sherpa" ? "voice" : "embedding");
  return `${prefix}-runtime-${platform}-${arch}-${version}.zip`;
}

const dependenciesRecordSchema = z.record(z.string(), z.string());

const runtimeCatalogEntryBase = {
  runtimeId: runtimeIdSchema,
  runtimeVersion: semverSchema,
  platform: runtimePlatformSchema,
  arch: runtimeArchSchema,
  downloadUrl: z.string().url(),
  archiveFileName: z.string().min(1).max(180),
  archiveSizeBytes: z.number().int().positive(),
  installedSizeBytes: z.number().int().positive(),
  sha256: sha256Schema,
  electronVersion: semverSchema,
  nodeModuleAbi: z
    .string()
    .regex(/^\d+$/, "Expected a numeric Node module ABI."),
  minAppVersion: semverSchema,
  maxAppVersion: semverSchema.optional(),
  entryPoint: relativeRuntimePathSchema.optional(),
  entryModule: z.string().min(1).max(120).optional(),
  requiredFiles: z.array(relativeRuntimePathSchema).min(1).max(5000),
  dependencies: dependenciesRecordSchema,
};

export const localAiRuntimeCatalogEntrySchema = z
  .object(runtimeCatalogEntryBase)
  .strict()
  .superRefine((entry, ctx) => {
    const prefix = LOCAL_AI_RUNTIME_ARTIFACT_PREFIX[entry.runtimeId];

    if (entry.runtimeId === "embedding-xenova" && !entry.entryPoint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entryPoint"],
        message: "entryPoint is required for embedding-xenova runtimes.",
      });
    }
    if (entry.runtimeId === "voice-sherpa" && !entry.entryModule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entryModule"],
        message: "entryModule is required for voice-sherpa runtimes.",
      });
    }
    if (entry.entryPoint && entry.runtimeId !== "embedding-xenova") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entryPoint"],
        message: "entryPoint is only permitted for embedding-xenova runtimes.",
      });
    }
    if (entry.entryModule && entry.runtimeId !== "voice-sherpa") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entryModule"],
        message: "entryModule is only permitted for voice-sherpa runtimes.",
      });
    }
    if (
      entry.maxAppVersion &&
      semver.gt(entry.minAppVersion, entry.maxAppVersion)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAppVersion"],
        message: "maxAppVersion must not be less than minAppVersion.",
      });
    }
    const expected = expectedArchiveFileName(
      entry.runtimeId,
      entry.platform,
      entry.arch,
      entry.runtimeVersion
    );
    if (entry.archiveFileName !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["archiveFileName"],
        message: `archiveFileName must be "${expected}".`,
      });
    }
    if (!entry.downloadUrl.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["downloadUrl"],
        message: "downloadUrl must use HTTPS in production catalogs.",
      });
    }
  });

export const localAiRuntimeCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogVersion: semverSchema,
    releaseTag: z.string().min(1),
    publishedAt: z.string().min(1),
    runtimes: z.array(localAiRuntimeCatalogEntrySchema),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    // No duplicate (runtimeId, platform, arch) entries for the same version.
    const seen = new Set<string>();
    for (let i = 0; i < catalog.runtimes.length; i++) {
      const entry = catalog.runtimes[i];
      const key = `${entry.runtimeId}|${entry.platform}|${entry.arch}|${entry.runtimeVersion}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimes", i],
          message: `Duplicate catalog entry for ${key}.`,
        });
      }
      seen.add(key);
    }
  });

export const localAiRuntimePackageManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runtimeId: runtimeIdSchema,
    runtimeVersion: semverSchema,
    platform: runtimePlatformSchema,
    arch: runtimeArchSchema,
    electronVersion: semverSchema,
    nodeModuleAbi: z.string().regex(/^\d+$/),
    entryPoint: relativeRuntimePathSchema.optional(),
    entryModule: z.string().min(1).max(120).optional(),
    requiredFiles: z.array(relativeRuntimePathSchema).min(1).max(5000),
    dependencies: dependenciesRecordSchema,
    build: z
      .object({
        commit: z.string().min(1),
        workflowRunId: z.string().min(1),
        builtAt: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const localAiRuntimeActiveStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    runtimeId: runtimeIdSchema,
    runtimeVersion: semverSchema,
    activatedAt: z.string().min(1),
    packageSha256: sha256Schema,
    previousVersion: semverSchema.optional(),
  })
  .strict();

export {
  runtimeIdSchema,
  runtimePlatformSchema,
  runtimeArchSchema,
  semverSchema,
  sha256Schema,
  relativeRuntimePathSchema,
};

/* ------------------------------------------------------------------------- */
/* Catalog v2 (computer-use design §7.3).                                    */
/*                                                                           */
/* Forward compatibility: the parser reads `runtimes` as unknown[]. Entries  */
/* whose runtimeId is not in this app's allowlist, or whose packageKind this */
/* app does not know, are SKIPPED (and reported) — a future catalog entry    */
/* can never break this app. A malformed entry with a KNOWN id still rejects */
/* the whole catalog. The v1 schema above keeps its exact shape for the      */
/* release compatibility test (CU-INST-15).                                   */
/* ------------------------------------------------------------------------- */

const runtimeIdV2Schema = z.enum(LOCAL_AI_RUNTIME_IDS_V2);

const executionProviderSchema = z.enum(["dml", "coreml", "cpu"]);

const modelLicenseSchema = z
  .object({
    model: z.string().min(1).max(80),
    baseModel: z.string().min(1).max(80),
    baseModelId: z.string().min(1).max(200),
  })
  .strict();

const modelPackageFileSchema = z
  .object({
    path: relativeRuntimePathSchema,
    url: z.string().url(),
    sizeBytes: z.number().int().positive(),
    sha256: sha256Schema,
  })
  .strict()
  .superRefine((file, ctx) => {
    if (!file.url.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Model file URLs must use HTTPS.",
      });
    }
  });

export const nativeRuntimeCatalogEntryV2Schema = z
  .object({
    ...runtimeCatalogEntryBase,
    runtimeId: runtimeIdV2Schema,
    packageKind: z.literal("native_runtime"),
    executionProviders: z.array(executionProviderSchema).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    applyEntryRules(ctx, entry.runtimeId, entry.entryPoint, entry.entryModule);
    if (
      entry.executionProviders &&
      entry.runtimeId !== "grounding-onnxruntime"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executionProviders"],
        message: "executionProviders is only permitted for grounding-onnxruntime.",
      });
    }
    if (entry.runtimeId === "grounding-onnxruntime" && !entry.executionProviders) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executionProviders"],
        message: "grounding-onnxruntime must declare its execution providers.",
      });
    }
    if (
      entry.maxAppVersion &&
      semver.gt(entry.minAppVersion, entry.maxAppVersion)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAppVersion"],
        message: "maxAppVersion must not be less than minAppVersion.",
      });
    }
    const expected = expectedArchiveFileName(
      entry.runtimeId,
      entry.platform,
      entry.arch,
      entry.runtimeVersion
    );
    if (entry.archiveFileName !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["archiveFileName"],
        message: `archiveFileName must be "${expected}".`,
      });
    }
  });

function applyEntryRules(
  ctx: z.RefinementCtx,
  runtimeId: LocalAiRuntimeId,
  entryPoint: string | undefined,
  entryModule: string | undefined
): void {
  const rules = LOCAL_AI_RUNTIME_ENTRY_RULES[runtimeId];
  if (rules.entryPoint === "required" && !entryPoint) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["entryPoint"],
      message: `entryPoint is required for ${runtimeId}.`,
    });
  }
  if (rules.entryPoint === "forbidden" && entryPoint !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["entryPoint"],
      message: `entryPoint is not permitted for ${runtimeId}.`,
    });
  }
  if (rules.entryModule === "required" && !entryModule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["entryModule"],
      message: `entryModule is required for ${runtimeId}.`,
    });
  }
  if (rules.entryModule === "forbidden" && entryModule !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["entryModule"],
      message: `entryModule is not permitted for ${runtimeId}.`,
    });
  }
}

export const modelCatalogEntryV2Schema = z
  .object({
    packageKind: z.literal("model"),
    runtimeId: runtimeIdV2Schema,
    runtimeVersion: semverSchema,
    platform: z.literal("any"),
    arch: z.literal("any"),
    minAppVersion: semverSchema,
    maxAppVersion: semverSchema.optional(),
    downloadSizeBytes: z.number().int().positive(),
    installedSizeBytes: z.number().int().positive(),
    minSystemMemoryBytes: z.number().int().positive(),
    groundingContractVersion: z.number().int().positive(),
    groundingAdapterId: z.string().min(1).max(120),
    groundingAdapterVersion: semverSchema,
    modelArchitecture: z.string().min(1).max(120),
    modelManifestVersion: z.number().int().positive(),
    preprocessingRevision: z.string().min(1).max(120),
    decodingRevision: z.string().min(1).max(120),
    calibrationRevision: z.string().min(1).max(120),
    requiresRuntime: z
      .object({
        runtimeId: z.literal("grounding-onnxruntime"),
        minVersion: semverSchema,
      })
      .strict(),
    supportedExecutionProviders: z
      .array(executionProviderSchema)
      .min(1),
    license: modelLicenseSchema,
    manifestSha256: sha256Schema,
    files: z.array(modelPackageFileSchema).min(1),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (
      entry.maxAppVersion &&
      semver.gt(entry.minAppVersion, entry.maxAppVersion)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAppVersion"],
        message: "maxAppVersion must not be less than minAppVersion.",
      });
    }
    // Unique file paths.
    const seen = new Set<string>();
    for (let i = 0; i < entry.files.length; i++) {
      const file = entry.files[i];
      if (seen.has(file.path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", i, "path"],
          message: `Duplicate file path "${file.path}".`,
        });
      }
      seen.add(file.path);
    }
    // manifest.json present with its hash equal to manifestSha256.
    const manifestFile = entry.files.find((f) => f.path === "manifest.json");
    if (!manifestFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "manifest.json must be present in the file set.",
      });
    } else if (manifestFile.sha256 !== entry.manifestSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manifestSha256"],
        message: "manifestSha256 must equal the manifest.json file hash.",
      });
    }
    // Local ceilings (§7.5): the catalog may lower but never raise them.
    if (entry.files.length > LOCAL_AI_MODEL_PACKAGE_LIMITS.maxFiles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: `File count exceeds the local ceiling of ${LOCAL_AI_MODEL_PACKAGE_LIMITS.maxFiles}.`,
      });
    }
    let total = 0;
    for (let i = 0; i < entry.files.length; i++) {
      const file = entry.files[i];
      total += file.sizeBytes;
      if (file.sizeBytes > LOCAL_AI_MODEL_PACKAGE_LIMITS.maxFileBytes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", i, "sizeBytes"],
          message: "Single file exceeds the local ceiling.",
        });
      }
    }
    if (total > LOCAL_AI_MODEL_PACKAGE_LIMITS.maxTotalBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "Total size exceeds the local ceiling.",
      });
    }
    if (total !== entry.downloadSizeBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["downloadSizeBytes"],
        message: "downloadSizeBytes must equal the sum of file sizes.",
      });
    }
    if (entry.installedSizeBytes < entry.downloadSizeBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["installedSizeBytes"],
        message: "installedSizeBytes must not be below the download size.",
      });
    }
  });

const catalogV2EnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
    catalogVersion: semverSchema,
    releaseTag: z.string().min(1),
    publishedAt: z.string().min(1),
    runtimes: z.array(z.unknown()),
  })
  .strict();

export interface CatalogV2ParseResult {
  readonly catalog: LocalAiRuntimeCatalogV2;
  /** runtimeIds (or packageKind labels) skipped as unknown to this app. */
  readonly skipped: readonly string[];
}

/**
 * Parse a v2 catalog document with unknown-entry skipping (§7.3). Throws
 * `LocalAiRuntimeError("runtime_catalog_invalid")` when the envelope or any
 * KNOWN entry is malformed. `AIFETCHLY_RUNTIME_CATALOG_URL` v2 sources must
 * parse through this function; a v1 document fails with a diagnostic naming
 * the schema version.
 */
export function parseLocalAiRuntimeCatalogV2(
  input: unknown
): CatalogV2ParseResult {
  const envelope = catalogV2EnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    const isV1 =
      typeof input === "object" &&
      input !== null &&
      (input as { schemaVersion?: unknown }).schemaVersion === 1;
    throw new LocalAiRuntimeError(
      "runtime_catalog_invalid",
      isV1
        ? "Runtime catalog is a v1 document; a v2 catalog is required."
        : `Runtime catalog v2 envelope invalid: ${envelope.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}`
    );
  }
  const skipped: string[] = [];
  const entries: LocalAiRuntimeCatalogV2["runtimes"][number][] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < envelope.data.runtimes.length; i++) {
    const raw = envelope.data.runtimes[i];
    const record =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)
        : null;
    const runtimeId =
      record?.runtimeId !== undefined ? String(record.runtimeId) : "(missing)";
    const packageKind =
      record?.packageKind !== undefined
        ? String(record.packageKind)
        : "(missing)";

    if (!LOCAL_AI_RUNTIME_IDS_V2.includes(runtimeId as never)) {
      // Unknown to this app: skip, never reject (forward compatibility).
      skipped.push(runtimeId);
      continue;
    }
    if (packageKind === "model") {
      const parsed = modelCatalogEntryV2Schema.safeParse(raw);
      if (!parsed.success) {
        throw new LocalAiRuntimeError(
          "runtime_catalog_invalid",
          `Known model entry ${runtimeId} is malformed: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}`
        );
      }
      entries.push(parsed.data as ModelCatalogEntryV2);
    } else if (packageKind === "native_runtime") {
      const parsed = nativeRuntimeCatalogEntryV2Schema.safeParse(raw);
      if (!parsed.success) {
        throw new LocalAiRuntimeError(
          "runtime_catalog_invalid",
          `Known runtime entry ${runtimeId} is malformed: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}`
        );
      }
      entries.push(parsed.data as NativeRuntimeCatalogEntryV2);
    } else {
      // Known id with a package kind this app does not implement: skip.
      skipped.push(`${runtimeId}:${packageKind}`);
    }

    const key = `${runtimeId}|${packageKind}`;
    if (seenKeys.has(key)) {
      throw new LocalAiRuntimeError(
        "runtime_catalog_invalid",
        `Duplicate catalog entry for ${key}.`
      );
    }
    seenKeys.add(key);
  }

  return {
    catalog: {
      schemaVersion: 2,
      catalogVersion: envelope.data.catalogVersion,
      releaseTag: envelope.data.releaseTag,
      publishedAt: envelope.data.publishedAt,
      runtimes: entries,
    },
    skipped,
  };
}

/** Producer-side model manifest (manifest.json inside a model package). */
export const groundingModelManifestSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    modelArchitecture: z.string().min(1).max(120),
    runtimeId: runtimeIdV2Schema,
    runtimeVersion: semverSchema,
    modelManifestVersion: z.number().int().positive(),
    groundingContractVersion: z.number().int().positive(),
    groundingAdapterId: z.string().min(1).max(120),
    groundingAdapterVersion: semverSchema,
    preprocessingRevision: z.string().min(1).max(120),
    decodingRevision: z.string().min(1).max(120),
    calibrationRevision: z.string().min(1).max(120),
    files: z.array(modelPackageFileSchema).min(1),
    license: modelLicenseSchema,
  })
  .strict();

export type GroundingModelManifestInput = z.infer<typeof groundingModelManifestSchema>;
