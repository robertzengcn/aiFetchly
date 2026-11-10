/**
 * Skill installation worker protocol (design §15.2).
 *
 * Zod-validated discriminated union used in BOTH directions between the
 * main process and the skill-installation utility process. Requests carry
 * operation ids, serialized limits, and structured arguments — never
 * database paths, secret-store handles, renderer handles, or global roots.
 * The worker NEVER touches SQLite / Electron safeStorage / renderer objects
 * (CLAUDE.md worker boundary).
 */

import { z } from "zod";

export const SKILL_INSTALLATION_WORKER_TYPE = "skill-installation";

export const stagePackageRequestSchema = z.object({
  type: z.literal("stage-package"),
  requestId: z.string().min(1),
  /** Absolute path to the acquired (untrusted) source root. */
  sourceRoot: z.string().min(1),
  /** Absolute path under app-owned staging to copy into. */
  targetRoot: z.string().min(1),
  limits: z.object({
    maxFiles: z.number().int().positive(),
    maxTotalBytes: z.number().int().positive(),
    maxDepth: z.number().int().positive(),
  }),
});

export const stagePackageResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("staged"),
    requestId: z.string(),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    /** SHA-256 over the sorted target tree (immutable version identity). */
    contentHash: z.string().length(64),
  }),
  z.object({
    type: z.literal("error"),
    requestId: z.string(),
    /** SOURCE_LIMIT_EXCEEDED | STAGE_IO_FAILED */
    code: z.string().min(1),
    message: z.string(),
  }),
]);

export type StagePackageRequest = z.infer<typeof stagePackageRequestSchema>;
export type StagePackageResponse = z.infer<typeof stagePackageResponseSchema>;

export class SkillInstallationWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SkillInstallationWorkerError";
  }
}
