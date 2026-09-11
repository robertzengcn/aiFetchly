/**
 * Committed local-AI runtime release coordinates.
 *
 * The app downloads catalogs from `releaseTag`. CI rebuilds downloadable
 * archives when the fingerprint of Electron / runtime packages / worker
 * packaging changes, or when these version fields are bumped.
 *
 * See docs/ci/local-ai-runtime-release.md.
 */
import { z } from "zod/v4";
import raw from "@/config/localAiRuntimeRelease.json";

const localAiRuntimeReleaseSchema = z
  .object({
    releaseTag: z.string().min(1).max(120),
    runtimeVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "Expected a dotted-triple runtime version."),
    minAppVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "Expected a dotted-triple min app version."),
  })
  .strict();

export type LocalAiRuntimeReleaseConfig = z.infer<
  typeof localAiRuntimeReleaseSchema
>;

export const LOCAL_AI_RUNTIME_RELEASE: LocalAiRuntimeReleaseConfig =
  localAiRuntimeReleaseSchema.parse(raw);
