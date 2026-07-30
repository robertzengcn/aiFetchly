/**
 * Local AI Runtime — Zod validation schemas for untrusted network/disk JSON.
 *
 * All downloaded JSON is parsed as `unknown` and validated before use
 * (PRD §12.1 / design §8). Type assertions alone are insufficient at the
 * network boundary.
 */
import { z } from "zod";
import semver from "semver";
import {
  LOCAL_AI_RUNTIME_ARTIFACT_PREFIX,
  LOCAL_AI_RUNTIME_IDS,
} from "@/entityTypes/localAiRuntimeTypes";

const runtimeIdSchema = z.enum(LOCAL_AI_RUNTIME_IDS);

const runtimePlatformSchema = z.enum(["win32", "darwin"]);
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

/** Expected archive filename for a runtime target. */
export function expectedArchiveFileName(
  runtimeId: string,
  platform: string,
  arch: string,
  version: string
): string {
  const prefix = runtimeId === "voice-sherpa" ? "voice" : "embedding";
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
