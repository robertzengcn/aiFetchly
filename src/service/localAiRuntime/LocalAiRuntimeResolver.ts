/**
 * Local AI Runtime — resolver.
 *
 * Resolves the active runtime for a capability from on-disk state: reads the
 * active pointer and package manifest, verifies platform/arch/ABI match the
 * running process, and confirms every required file exists beneath the version
 * root (design §15). Returns null for any non-ready condition so callers can
 * reconcile status separately. Never hashes every file on the hot path — the
 * package checksum is verified at install time.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  LocalAiRuntimeId,
  LocalAiRuntimePackageManifest,
  LocalAiRuntimeState,
  LocalAiRuntimeTarget,
  ResolvedLocalAiRuntime,
} from "@/entityTypes/localAiRuntimeTypes";
import type { LocalAiRuntimePathService } from "./LocalAiRuntimePathService";
import type { LocalAiRuntimeStateStore } from "./LocalAiRuntimeStateStore";

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export interface RuntimeDiagnosis {
  state: LocalAiRuntimeState;
  installedVersion?: string;
  manifest?: LocalAiRuntimePackageManifest;
}

export class LocalAiRuntimeResolver {
  constructor(
    private readonly paths: LocalAiRuntimePathService,
    private readonly state: LocalAiRuntimeStateStore,
    private readonly target: LocalAiRuntimeTarget
  ) {}

  /**
   * Reconcile installed state into a coarse lifecycle state for status
   * reporting, distinguishing `ready`, `incompatible`, and `corrupted`. Does
   * NOT fetch the catalog; the caller upgrades `not_installed` to
   * `download_required` when an update is available.
   */
  async diagnose(runtimeId: LocalAiRuntimeId): Promise<RuntimeDiagnosis> {
    const active = await this.state.readActive(runtimeId);
    if (!active) return { state: "not_installed" };

    const manifest = await this.state.readPackageManifest(
      runtimeId,
      active.runtimeVersion
    );
    if (!manifest) {
      return { state: "corrupted", installedVersion: active.runtimeVersion };
    }

    if (
      manifest.platform !== this.target.platform ||
      manifest.arch !== this.target.arch ||
      manifest.nodeModuleAbi !== this.target.nodeModuleAbi
    ) {
      return {
        state: "incompatible",
        installedVersion: active.runtimeVersion,
        manifest,
      };
    }

    const { versionRoot } = this.paths.getRuntimePaths(
      runtimeId,
      active.runtimeVersion
    );
    for (const requiredFile of manifest.requiredFiles) {
      const present = await pathExists(path.join(versionRoot, requiredFile));
      if (!present) {
        return {
          state: "corrupted",
          installedVersion: active.runtimeVersion,
          manifest,
        };
      }
    }
    return {
      state: "ready",
      installedVersion: active.runtimeVersion,
      manifest,
    };
  }

  async resolve(
    runtimeId: LocalAiRuntimeId
  ): Promise<ResolvedLocalAiRuntime | null> {
    const active = await this.state.readActive(runtimeId);
    if (!active) return null;

    const manifest = await this.state.readPackageManifest(
      runtimeId,
      active.runtimeVersion
    );
    if (!manifest) return null;

    // Target compatibility: the installed native runtime must match this process.
    if (manifest.platform !== this.target.platform) return null;
    if (manifest.arch !== this.target.arch) return null;
    if (manifest.nodeModuleAbi !== this.target.nodeModuleAbi) return null;

    const { versionRoot } = this.paths.getRuntimePaths(
      runtimeId,
      active.runtimeVersion
    );

    for (const requiredFile of manifest.requiredFiles) {
      const present = await pathExists(path.join(versionRoot, requiredFile));
      if (!present) return null;
    }

    return {
      runtimeId,
      runtimeVersion: active.runtimeVersion,
      runtimeRoot: versionRoot,
      manifest,
      entryPath: manifest.entryPoint
        ? path.join(versionRoot, manifest.entryPoint)
        : undefined,
      moduleRequirePath: manifest.entryModule
        ? path.join(versionRoot, "package.json")
        : undefined,
    };
  }
}
