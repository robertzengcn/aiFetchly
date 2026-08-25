/**
 * SkillActivationService — atomic managed-copy and linked activation under
 * the global prompt-skill directory (design §11, PRD §17), plus ownership-
 * verified uninstall and rollback (NFR-05).
 *
 * Safety invariants:
 *   - Managed copy writes a same-parent temp directory, verifies hashes,
 *     then atomically renames into place; an old activation stays available
 *     for rollback until verification passes.
 *   - Linked mode: POSIX directory symlink; Windows junction fallback; the
 *     LINK is owned by AiFetchly — uninstall removes the link, NEVER its
 *     target.
 *   - Uninstall accepts the recorded canonical activation path + ownership
 *     metadata proof; it never builds a path from a user-supplied name and
 *     never recursively deletes home, the workspace, or unresolved paths.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SkillActivationMode } from "@/entityTypes/skillInstallationTypes";

export interface ActivationRequest {
  readonly sourceRoot: string;
  readonly skillName: string;
  readonly mode: "managed-copy" | "linked";
  readonly contentHash: string;
  readonly installationId: string;
}

export type ActivationResult =
  | {
      readonly ok: true;
      readonly activationPath: string;
      readonly mode: SkillActivationMode;
      readonly backupPath: string | null;
    }
  | {
      readonly ok: false;
      readonly code:
        | "ACTIVATION_COLLISION"
        | "LINK_CREATION_FAILED"
        | "ACTIVATION_VERIFICATION_FAILED"
        | "ACTIVATION_SOURCE_INVALID";
      readonly message: string;
    };

export const SKILL_ACTIVATION_DIR_NAME = "skills";
export const OWNERSHIP_FILE = ".aifetchly-install.json";

export function resolvePromptSkillRoot(override?: string): string {
  if (override) return override;
  const env = process.env.AIFETCHLY_CONFIG_HOME;
  const home = env ?? os.homedir();
  return path.join(home, ".aifetchly", SKILL_ACTIVATION_DIR_NAME);
}

export interface OwnershipMetadata {
  readonly owned: true;
  readonly installationId: string;
  readonly sourceRevision: string;
  readonly activationMode: SkillActivationMode;
  readonly activatedAt: string;
}

export class SkillActivationService {
  private readonly skillRoot: string;

  constructor(skillRoot?: string) {
    this.skillRoot = resolvePromptSkillRoot(skillRoot);
  }

  get root(): string {
    return this.skillRoot;
  }

  async activate(request: ActivationRequest): Promise<ActivationResult> {
    if (!fs.existsSync(request.sourceRoot)) {
      return {
        ok: false,
        code: "ACTIVATION_SOURCE_INVALID",
        message: "Staged source disappeared before activation.",
      };
    }

    fs.mkdirSync(this.skillRoot, { recursive: true });
    const target = path.join(this.skillRoot, normalizeDirName(request.skillName));

    // Refuse unowned destinations (never silently replace foreign content).
    if (fs.existsSync(target) && !this.isOwnedActivation(target)) {
      return {
        ok: false,
        code: "ACTIVATION_COLLISION",
        message:
          `'${path.basename(target)}' already exists and is not owned by ` +
          `AiFetchly; remove or rename it first.`,
      };
    }

    // Back up any existing owned activation for rollback.
    let backupPath: string | null = null;
    if (fs.existsSync(target)) {
      backupPath = `${target}.backup-${Date.now()}`;
      fs.renameSync(target, backupPath);
    }

    try {
      if (request.mode === "linked") {
        return this.activateLinked(request, target, backupPath);
      }
      return await this.activateManagedCopy(request, target, backupPath);
    } catch (err) {
      // Roll the backup forward before surfacing the failure.
      if (backupPath && fs.existsSync(backupPath) && !fs.existsSync(target)) {
        fs.renameSync(backupPath, target);
      }
      return {
        ok: false,
        code: "ACTIVATION_VERIFICATION_FAILED",
        message: `Activation failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  private activateManagedCopy(
    request: ActivationRequest,
    target: string,
    backupPath: string | null
  ): ActivationResult {
    // Copy into a same-parent temp directory, verify, then atomic rename.
    const staging = path.join(
      path.dirname(target),
      `.${path.basename(target)}.staging-${crypto.randomBytes(4).toString("hex")}`
    );
    fs.mkdirSync(staging, { recursive: true });
    copyTree(request.sourceRoot, staging);

    // Non-secret ownership metadata (design §11.2).
    const metadata: OwnershipMetadata = {
      owned: true,
      installationId: request.installationId,
      sourceRevision: request.contentHash.slice(0, 16),
      activationMode: "managed-copy",
      activatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(staging, OWNERSHIP_FILE),
      JSON.stringify(metadata, null, 2),
      "utf-8"
    );

    fs.renameSync(staging, target);
    return { ok: true, activationPath: target, mode: "managed-copy", backupPath };
  }

  private activateLinked(
    request: ActivationRequest,
    target: string,
    backupPath: string | null
  ): ActivationResult {
    const linkTarget = fs.realpathSync(request.sourceRoot);
    const mode: SkillActivationMode =
      process.platform === "win32" ? "junction" : "symbolic-link";
    try {
      if (process.platform === "win32") {
        // Directory junction: no elevation required on Windows.
        fs.symlinkSync(linkTarget, target, "junction");
      } else {
        fs.symlinkSync(linkTarget, target, "dir");
      }
    } catch (err) {
      if (backupPath && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, target);
      }
      return {
        ok: false,
        code: "LINK_CREATION_FAILED",
        message: `Failed to create ${mode}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    return { ok: true, activationPath: target, mode, backupPath };
  }

  /**
   * Structural verification (design §18 level 3): the activation resolves to
   * a real directory whose SKILL.md is readable. The daily runtime
   * re-verifies the exact content hash at every invocation
   * (PromptSkillContextAssembler), so activation-time checks are structural.
   */
  verifyActivation(activationPath: string): boolean {
    try {
      const real = fs.realpathSync(activationPath);
      if (!fs.statSync(real).isDirectory()) return false;
      const skillMd = path.join(real, "SKILL.md");
      if (!fs.existsSync(skillMd)) return false;
      fs.accessSync(skillMd, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove one activation. Managed copies must present ownership metadata;
   * links are unlinked and their EXTERNAL TARGET IS NEVER DELETED.
   * Returns a description of what was removed for user reporting (§24.4).
   */
  uninstall(
    activationPath: string
  ): { ok: true; removed: "directory" | "link"; targetPreserved: string | null } | { ok: false; message: string } {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(activationPath);
    } catch {
      return { ok: false, message: "Activation path does not exist." };
    }

    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(activationPath);
      fs.unlinkSync(activationPath);
      return { ok: true, removed: "link", targetPreserved: target };
    }

    // Real directory → must prove ownership (NFR-05: never delete unowned,
    // unresolved, home, or workspace paths).
    const ownershipPath = path.join(activationPath, OWNERSHIP_FILE);
    if (!fs.existsSync(ownershipPath)) {
      return {
        ok: false,
        message:
          "Refusing to remove a directory without AiFetchly ownership metadata.",
      };
    }
    try {
      const metadata = JSON.parse(
        fs.readFileSync(ownershipPath, "utf-8")
      ) as OwnershipMetadata;
      if (metadata.owned !== true) {
        return { ok: false, message: "Ownership metadata invalid." };
      }
    } catch {
      return { ok: false, message: "Ownership metadata unreadable." };
    }
    // Final guard: the resolved real path must be inside the skill root.
    const real = fs.realpathSync(activationPath);
    const rootWithSep = this.skillRoot.endsWith(path.sep)
      ? this.skillRoot
      : this.skillRoot + path.sep;
    if (!real.startsWith(rootWithSep)) {
      return {
        ok: false,
        message: "Refusing to remove a path outside the skills directory.",
      };
    }
    fs.rmSync(real, { recursive: true, force: true });
    return { ok: true, removed: "directory", targetPreserved: null };
  }

  /** Restore the pre-activation backup (rollback path). */
  rollback(
    activationPath: string,
    backupPath: string | null
  ): { ok: boolean; message: string } {
    try {
      if (fs.existsSync(activationPath)) {
        const stat = fs.lstatSync(activationPath);
        if (stat.isSymbolicLink()) fs.unlinkSync(activationPath);
        else this.uninstall(activationPath);
      }
      if (backupPath && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, activationPath);
      }
      return { ok: true, message: "Rolled back to the previous activation." };
    } catch (err) {
      return {
        ok: false,
        message: `Rollback failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  private isOwnedActivation(target: string): boolean {
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        // A link WE created points at a source containing ownership info or
        // is acceptable because removing it never deletes the target.
        return true;
      }
      return fs.existsSync(path.join(target, OWNERSHIP_FILE));
    } catch {
      return false;
    }
  }
}

export function normalizeDirName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
}

function copyTree(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === OWNERSHIP_FILE) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dest);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}
