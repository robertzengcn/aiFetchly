/**
 * Validated installer for system dependencies.
 *
 * Executes fixed, pre-approved command templates from the dependency catalog.
 * NEVER accepts free-form commands. Validates dependency_id against catalog
 * before every install attempt.
 *
 * Security guarantees:
 * - Command template is fixed per platform manager
 * - Package name comes from catalog JSON only
 * - dependency_id must exist in catalog
 * - User confirmation is enforced by the caller (Module/IPC)
 */

import { spawnSync } from "child_process";
import type {
  InstallResultStatus,
  DependencyPlatform,
  PlatformCandidate,
} from "@/entityTypes/systemDependencyTypes";
import type { SystemDependencyCatalog } from "@/service/SystemDependencyCatalog";
import { PythonRuntimeWorkerClient } from "@/service/PythonRuntimeWorkerClient";

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Probe whether a binary is available on PATH by running `<binary> --version`.
 */
export function probeBinary(binary: string): boolean {
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf-8",
    timeout: 10_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}

/**
 * Refresh process.env.PATH by spawning a login shell.
 *
 * This captures PATH from the user's shell profile (e.g., ~/.zshrc),
 * which includes Homebrew paths on macOS that GUI apps don't inherit.
 */
/** Known safe shells for PATH refresh. */
const ALLOWED_SHELLS = new Set([
  "/bin/bash",
  "/bin/sh",
  "/bin/zsh",
  "/usr/bin/bash",
  "/usr/bin/sh",
  "/usr/bin/zsh",
]);

/** Validate that a PATH string looks reasonable before assigning it. */
function isValidPathString(pathStr: string): boolean {
  // Must contain at least one path separator
  if (!pathStr.includes("/")) return false;
  // Must only contain PATH-safe characters (Unix paths + colon separator)
  if (!/^[a-zA-Z0-9/._:\-\s]+$/.test(pathStr)) return false;
  // Must contain a known system directory
  if (!pathStr.includes("/usr/bin") && !pathStr.includes("/bin")) return false;
  return true;
}

export function refreshPath(): string {
  // NOTE: This mutates process.env.PATH globally for the entire Electron main process.
  if (process.platform === "darwin" || process.platform === "linux") {
    try {
      const shell = process.env.SHELL || "/bin/bash";
      // Only use known safe shells (C-1 fix)
      if (!ALLOWED_SHELLS.has(shell)) {
        return process.env.PATH ?? "";
      }
      // Use spawnSync instead of execSync to avoid shell interpolation
      const result = spawnSync(shell, ["-l", "-c", "echo $PATH"], {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
      });
      const freshPath = (result.stdout ?? "").trim();
      // Validate PATH content before assigning (H-3 fix)
      if (freshPath.length > 0 && isValidPathString(freshPath)) {
        process.env.PATH = freshPath;
        return freshPath;
      }
    } catch {
      // Fall through to return current PATH
    }
  }
  return process.env.PATH ?? "";
}

/**
 * Check whether a package manager is available on PATH.
 */
function isManagerAvailable(manager: string): boolean {
  const checkCmd =
    process.platform === "win32"
      ? spawnSync(manager, ["--version"], {
          encoding: "utf-8",
          timeout: 10_000,
          windowsHide: true,
        })
      : spawnSync("which", [manager], {
          encoding: "utf-8",
          timeout: 10_000,
        });
  return checkCmd.status === 0;
}

/**
 * Execute a validated install command for a dependency.
 *
 * Returns a typed InstallResultStatus. The command template is fixed
 * per platform manager — the package name is injected from the catalog only.
 */
export function executeInstall(
  platform: DependencyPlatform,
  candidate: PlatformCandidate
): { status: InstallResultStatus; stderr: string; durationMs: number } {
  const startTime = Date.now();

  let command: string;
  let args: string[];

  switch (candidate.manager) {
    case "brew":
      command = "brew";
      args = ["install", candidate.package];
      break;
    case "apt":
      command = "sudo";
      args = ["apt-get", "install", "-y", candidate.package];
      break;
    case "winget":
      command = "winget";
      args = [
        "install",
        "--id",
        candidate.package,
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--silent",
      ];
      break;
    default:
      return {
        status: "unsupported_platform",
        stderr: "",
        durationMs: Date.now() - startTime,
      };
  }

  const result = spawnSync(command, args, {
    encoding: "utf-8",
    timeout: INSTALL_TIMEOUT_MS,
    windowsHide: true,
  });

  const durationMs = Date.now() - startTime;
  const stderr = result.stderr ?? "";

  // Parse exit codes per platform
  if (result.status === 0) {
    return { status: "installed", stderr: "", durationMs };
  }

  // Handle "already installed" cases
  if (candidate.manager === "brew" && /already installed/i.test(stderr)) {
    return { status: "already_installed", stderr: "", durationMs };
  }
  if (
    candidate.manager === "apt" &&
    /already the newest version/i.test(String(result.stdout ?? ""))
  ) {
    return { status: "already_installed", stderr: "", durationMs };
  }

  // Handle permission denied
  if (
    candidate.manager === "apt" &&
    (/password/i.test(stderr) || /E: Could not get lock/i.test(stderr))
  ) {
    return { status: "permission_denied", stderr, durationMs };
  }
  if (candidate.manager === "winget") {
    const code = result.status ?? -1;
    if (code === -1978335209) {
      // COMMAND_REQUIRES_ADMIN
      return { status: "permission_denied", stderr, durationMs };
    }
    if (code === -1978335135) {
      // PACKAGE_ALREADY_INSTALLED
      return { status: "already_installed", stderr: "", durationMs };
    }
  }

  return { status: "installation_failed", stderr, durationMs };
}

/**
 * Main installer class that orchestrates the full install flow:
 * validate → pre-probe → check manager → execute → post-probe → PATH refresh.
 */
export class SystemDependencyInstaller {
  private readonly catalog: SystemDependencyCatalog;
  private readonly platform: DependencyPlatform;

  constructor(catalog: SystemDependencyCatalog, platform: DependencyPlatform) {
    this.catalog = catalog;
    this.platform = platform;
  }

  /**
   * Install a dependency by its catalog ID.
   *
   * Returns a typed result with should_retry flag.
   */
  install(dependencyId: string): {
    status: InstallResultStatus;
    details: string;
    stderr: string;
    durationMs: number;
    shouldRetry: boolean;
  } {
    // Step 1: Validate against catalog
    const entry = this.catalog.getById(dependencyId);
    if (!entry) {
      return {
        status: "unsupported_platform",
        details: `Dependency "${dependencyId}" not found in catalog`,
        stderr: "",
        durationMs: 0,
        shouldRetry: false,
      };
    }

    // Step 2: Check platform support
    const candidate = this.catalog.getPlatformCandidate(
      dependencyId,
      this.platform
    );
    if (!candidate) {
      return {
        status: "unsupported_platform",
        details: `No install candidate for platform "${this.platform}"`,
        stderr: "",
        durationMs: 0,
        shouldRetry: false,
      };
    }

    // Step 3: Pre-probe binary
    if (probeBinary(entry.probe)) {
      return {
        status: "already_installed",
        details: `Binary "${entry.probe}" is already available`,
        stderr: "",
        durationMs: 0,
        shouldRetry: true,
      };
    }

    // Step 4: Check package manager availability
    if (!isManagerAvailable(candidate.manager)) {
      return {
        status: "installer_not_found",
        details: `Package manager "${candidate.manager}" not found on PATH`,
        stderr: "",
        durationMs: 0,
        shouldRetry: false,
      };
    }

    // Step 5: Execute install
    const result = executeInstall(this.platform, candidate);

    if (
      result.status !== "installed" &&
      result.status !== "already_installed"
    ) {
      return {
        status: result.status,
        details: `Install failed with status: ${result.status}`,
        stderr: result.stderr,
        durationMs: result.durationMs,
        shouldRetry: false,
      };
    }

    // Step 6: PATH refresh + dispose worker + post-probe
    refreshPath();

    // Dispose the Python runtime worker so it restarts with the updated PATH
    try {
      PythonRuntimeWorkerClient.getInstance().dispose();
    } catch {
      // Worker may not be initialized — safe to ignore
    }

    if (probeBinary(entry.probe)) {
      return {
        status: "installed",
        details: `Successfully installed "${dependencyId}" — "${entry.probe}" is available`,
        stderr: "",
        durationMs: result.durationMs,
        shouldRetry: true,
      };
    }

    // Binary still not found after PATH refresh
    return {
      status: "path_issue",
      details: `Installed "${dependencyId}" but "${entry.probe}" is not on PATH. Try restarting the app.`,
      stderr: "",
      durationMs: result.durationMs,
      shouldRetry: false,
    };
  }
}
